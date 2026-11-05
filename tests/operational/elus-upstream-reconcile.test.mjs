import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {execFileSync} from "node:child_process";
import {reconcile, prepare} from "../../scripts/elus-upstream-reconcile.mjs";

function git(cwd,...args) { return execFileSync("git",args,{cwd,encoding:"utf8"}).trim(); }
function fixture() {
  const cwd=mkdtempSync(join(tmpdir(),"elus-reconcile-"));
  git(cwd,"init","-q");git(cwd,"config","user.name","Tests");git(cwd,"config","user.email","test@example.invalid");
  function set(path, content) { const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content); }
  function commit(label){git(cwd,"add",".");git(cwd,"commit","-qm",label);return git(cwd,"rev-parse","HEAD");}
  set("tsconfig.json",JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}}));
  set("components/a.tsx","old");set("components/permission.tsx","old");set("components/img.svg","old");set("app/admin/dashboard.tsx","old");set("app/(public)/login/page.tsx","old");set("components/safe.tsx","old");set("lib/auth/guard.ts","old");set("lib/elus360/policy.ts","old");set("app/app/p.tsx","old");set("app/app/delete.tsx","old");
  const base=commit("base");
  set("components/a.tsx","upstream");set("components/permission.tsx","provider model");set("components/img.svg","new");set("app/admin/dashboard.tsx","new");set("app/(public)/login/page.tsx","new");set("components/safe.tsx","upstream");set("lib/auth/guard.ts","upstream");set("lib/elus360/policy.ts","upstream");set("app/app/p.tsx","upstream");rmSync(join(cwd,"app/app/delete.tsx"));
  const target=commit("target");
  git(cwd,"checkout","-q",base);set("components/a.tsx","upstream");set("app/app/p.tsx","elus-custom");const fork=commit("fork");
  return {cwd,base,target,fork};
}
test("tripla separa integrado, seguro, conflito, contrato, extensao e exclusao",()=> {
  const f=fixture();const previous=process.cwd();
  try{
    process.chdir(f.cwd);
    const p=reconcile(f.base,f.target,f.fork);
    const statuses=Object.fromEntries(p.files.map(x=>[x.path,x.status]));
    assert.equal(statuses["components/a.tsx"],"already_integrated");
    assert.equal(statuses["components/safe.tsx"],"safe_to_prepare");
    assert.equal(statuses["components/permission.tsx"],"contract_requires_review");
    assert.equal(statuses["components/img.svg"],"contract_requires_review");
    assert.equal(statuses["app/admin/dashboard.tsx"],"contract_requires_review");
    assert.equal(statuses["app/(public)/login/page.tsx"],"contract_requires_review");
    assert.ok(p.files.find(x=>x.path==="components/permission.tsx").signals.includes("managed_ai"));
    assert.ok(p.files.find(x=>x.path==="components/permission.tsx").suggested_checks.includes("ai_managed_grants_negative"));
    assert.equal(statuses["lib/auth/guard.ts"],"contract_requires_review");
    assert.equal(statuses["lib/elus360/policy.ts"],"protected_requires_review");
    assert.equal(statuses["app/app/p.tsx"],"conflict_requires_review");
    assert.equal(statuses["app/app/delete.tsx"],"deletion_requires_review");
    assert.equal(p.gate,"manual_review_required");
    assert.equal(p.totals.changed,10);
  } finally {process.chdir(previous);rmSync(f.cwd,{recursive:true,force:true});}
});
test("caminho ordinario novo somente e seguro quando nao customizado",()=>{
  const f=fixture();const old=process.cwd();try {
    process.chdir(f.cwd);const p=reconcile(f.base,f.target,f.fork);
    assert.equal(p.files.filter(x=>x.status==="safe_to_prepare").length,1);
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});

test("prepare aplica apenas safe em detached worktree e preserva fork e contratos",()=>{
  const f=fixture(), old=process.cwd(), out=join(tmpdir(),"elus-prepared-"+Date.now()+"-"+process.pid);
  try {
    process.chdir(f.cwd);
    const p=prepare(f.base,f.target,f.fork,out);
    assert.equal(p.preparedFiles,1);
    assert.equal(readFileSync(join(out,"components/safe.tsx"),"utf8"),"upstream");
    assert.equal(readFileSync(join(out,"lib/auth/guard.ts"),"utf8"),"old");
    assert.equal(readFileSync(join(out,"app/app/p.tsx"),"utf8"),"elus-custom");
    assert.equal(readFileSync(join(f.cwd,"components/safe.tsx"),"utf8"),"old");
    const r=JSON.parse(readFileSync(join(out,".elus-upstream/report.json"),"utf8"));
    assert.deepEqual(r.preparedFiles,["components/safe.tsx"]);
  } finally {
    process.chdir(f.cwd);
    if(existsSync(out)) git(f.cwd,"worktree","remove","--force",out);
    process.chdir(old);
    rmSync(f.cwd,{recursive:true,force:true});
  }
});

test("contratos ocultos em componentes aparentemente seguros exigem revisao",()=>{
  const f=fixture(),old=process.cwd();
  try {
    process.chdir(f.cwd);
    const plan=reconcile(f.base,f.target,f.fork);
    assert.equal(plan.files.find(x=>x.path==="components/permission.tsx").status,"contract_requires_review");
    assert.ok(plan.files.find(x=>x.path==="components/img.svg").signals.includes("non_source_asset"));
  } finally {process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});
test("prepare rejeita checkout sujo antes de criar worktree",()=>{
  const f=fixture(),old=process.cwd(),out=join(tmpdir(),"elus-dirty-"+process.pid+"-"+Date.now());
  try {
    process.chdir(f.cwd);
    writeFileSync(join(f.cwd,"components/a.tsx"),"changed outside commit");
    assert.throws(()=>prepare(f.base,f.target,f.fork,out),/WORKTREE_NOT_CLEAN/);
    assert.equal(existsSync(out),false);
  } finally {process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});

test("selecao de checks exige revisao para auth e tenants mesmo fora de pastas protegidas",async()=>{
  const {contractSignals, checksForSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const flags=contractSignals("components/general.tsx","export const x = 1;","export const x = getUser() + organization_id");
  assert.ok(flags.includes("authentication_authorization"));
  assert.ok(flags.includes("tenant_isolation"));
  const gates=checksForSignals(flags);
  assert.ok(gates.includes("auth_rbac_mfa_negative"));
  assert.ok(gates.includes("cross_tenant_rls_negative"));
});
test("arquivos executaveis ou nao codigo nunca sao preparaveis automaticamente",async()=>{
  const {auditPath}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  assert.deepEqual(auditPath("components/x.tsx","120000"),["non_regular_git_object"]);
  assert.deepEqual(auditPath("components/photo.svg","100644"),["non_source_asset"]);
});

test("dependencia protegida impede promover componente genericamente seguro",()=>{
  const f=fixture(),old=process.cwd();
  try {
    process.chdir(f.cwd);
    const adapter=join(f.cwd,"lib/elus360/adapter.ts");
    writeFileSync(adapter,'import { helper } from "@/components/safe";\nexport const x=helper;\n');
    git(f.cwd,"add","lib/elus360/adapter.ts");
    git(f.cwd,"commit","-qm","fork uses upstream helper");
    const fork=git(f.cwd,"rev-parse","HEAD");
    const report=reconcile(f.base,f.target,fork);
    const file=report.files.find(item=>item.path==="components/safe.tsx");
    assert.equal(file.status,"contract_requires_review");
    assert.ok(file.signals.includes("protected_reverse_dependency"));
    assert.deepEqual(file.protected_importers,["lib/elus360/adapter.ts"]);
    assert.ok(file.suggested_checks.includes("review_protected_importers"));
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});
test("nova rota mutavel de IA ausente do inventario e sempre sinalizada",()=>{
  const f=fixture(),old=process.cwd();
  try {
    process.chdir(f.cwd);
    git(f.cwd,"checkout","-q",f.target);
    const path="app/api/v1/ai/unstable/route.ts";
    const full=join(f.cwd,path);
    mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,'export async function PATCH() { return Response.json({ok:true}); }\n');
    git(f.cwd,"add",path);
    git(f.cwd,"commit","-qm","upstream adds route");
    const target=git(f.cwd,"rev-parse","HEAD");
    const report=reconcile(f.base,target,f.fork);
    const file=report.files.find(item=>item.path===path);
    assert.equal(file.status,"contract_requires_review");
    assert.ok(file.signals.includes("uninventoried_ai_surface"));
    assert.ok(report.uninventoried_ai_paths.includes(path));
    assert.ok(file.suggested_checks.includes("review_ai_write_surface_inventory"));
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});
test("analisador puro reconhece imports alias e relativos e descarta pacotes externos",async()=>{
  const {sourceModule, directProtectedDependents, uninventoriedAiSurfaces}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  assert.equal(sourceModule("@/components/safe","lib/elus360/adapter.ts"),"components/safe");
  assert.equal(sourceModule("../../components/safe","lib/elus360/adapter.ts"),"components/safe");
  assert.equal(sourceModule("react","lib/elus360/adapter.ts"),null);
  const imports=directProtectedDependents(["components/safe.tsx"],[
    {path:"lib/elus360/adapter.ts",content:'export { helper } from "@/components/safe";'},
    {path:"components/other.tsx",content:'import X from "@/components/safe";'},
    {path:"components/safe.tsx",content:"export const helper = 1;"}
  ]);
  assert.deepEqual(imports.get("components/safe"),["lib/elus360/adapter.ts"]);
  assert.deepEqual(uninventoriedAiSurfaces(
    ["app/api/v1/ai/providers/route.ts","app/api/v1/ai/new/route.ts"],
    {surfaces:[{path:"app/api/v1/ai/providers/route.ts"}]}
  ),["app/api/v1/ai/new/route.ts"]);
});

test("cadeia transitiva protege arquivo comum mesmo com intermediario nao protegido",()=>{
  const f=fixture(),old=process.cwd();
  try{
    process.chdir(f.cwd);
    const intermediary=join(f.cwd,"components/intermediary.tsx");
    writeFileSync(intermediary,'import { helper } from "@/components/safe";\nexport const y=helper;\n');
    writeFileSync(join(f.cwd,"lib/elus360/adapter.ts"),'import { y } from "@/components/intermediary";\nexport const x=y;\n');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","protected via intermediary");
    const report=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    const file=report.files.find(v=>v.path==="components/safe.tsx");
    assert.equal(file.status,"contract_requires_review");
    assert.deepEqual(file.protected_importers,["lib/elus360/adapter.ts"]);
    assert.ok(file.signals.includes("protected_reverse_dependency"));
    assert.equal(report.dependency_scan.scope,"typescript_ast_transitive_imports");
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});
test("ciclos de imports nao causam loop nem descartam consumidor protegido",async()=>{
  const {transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const graph=[
    {path:"components/a.tsx",content:'import "@/components/b";'},
    {path:"components/b.tsx",content:'import "@/components/a"; import "@/components/safe";'},
    {path:"lib/elus360/core.ts",content:'import "@/components/a";'},
    {path:"components/safe.tsx",content:"export const x=1;"},
  ];
  const map=transitiveProtectedDependents(["components/safe.tsx"],graph);
  assert.deepEqual(map.get("components/safe"),["lib/elus360/core.ts"]);
});

test("AST resolve reexport, require, import dinamico literal e arquivo index",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const sources=[
    {path:"components/shared/index.ts",content:"export const token=1;"},
    {path:"components/middle.ts",content:'export {token} from "./shared";'},
    {path:"lib/elus360/consumer.ts",content:'export async function load(){ return await import("@/components/middle"); }'},
  ];
  const graph=dependencyGraph(sources);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  assert.deepEqual(transitiveProtectedDependents(["components/shared/index.ts"],sources).get("components/shared"),["lib/elus360/consumer.ts"]);
});
test("imports locais ausentes e computados impedem declaracao de analise completa",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const cases=[
    {path:"lib/elus360/a.ts",content:'import x from "@/components/not-present";'},
    {path:"components/x.ts",content:'export async function x(mod){return import(mod);}'},
    {path:"components/y.ts",content:'export * from "~/some-alias";'},
  ];
  const result=dependencyGraph(cases);
  assert.equal(result.complete,false);
  assert.ok(result.unresolved.some(e=>e.reason==="unresolved_local_module"));
  assert.ok(result.unresolved.some(e=>e.reason==="computed_module_specifier"));
});
test("grafo AST ignora imports falsos em comentarios e strings",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const graph=dependencyGraph([
    {path:"components/a.ts",content:'// import "@/missing";\nexport const x = "require(\\\"@/missing\\\")";'},
  ]);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
});
test("reconciliacao falha fechada quando modulo local da arvore nao resolve",()=>{
  const f=fixture(),old=process.cwd();
  try {
    process.chdir(f.cwd);
    writeFileSync(join(f.cwd,"lib/elus360/adapter.ts"),'import "@/components/missing";');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","unresolved path");
    const report=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    const candidate=report.files.find(file=>file.path==="components/safe.tsx");
    assert.equal(report.dependency_scan.complete,false);
    assert.equal(candidate.status,"contract_requires_review");
    assert.ok(candidate.signals.includes("dependency_analysis_incomplete"));
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});

test("AST bloqueia import protegido introduzido pelo upstream",async()=>{
  const {changedModuleSignals}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const before="export const healthy = true;";
  const after='import {guard} from "@/lib/auth/guard"; export const healthy=guard;';
  assert.ok(changedModuleSignals("components/ordinary.tsx",before,after).includes("protected_module_import_change"));
  const dynamic='export function f(spec) {return import(spec);}';
  assert.ok(changedModuleSignals("components/ordinary.tsx",before,dynamic).includes("dependency_analysis_incomplete"));
  assert.deepEqual(changedModuleSignals("components/ordinary.tsx",before,'// import "@/lib/auth/guard"; export const x=1;'),[]);
});
test("reconciliador nao prepara arquivo com novo import auth mesmo sem palavras-chave antigas",()=>{
  const f=fixture(),old=process.cwd();
  try{
    process.chdir(f.cwd);
    git(f.cwd,"checkout","-q",f.target);
    writeFileSync(join(f.cwd,"components/safe.tsx"),'import {guard} from "@/lib/auth/guard"; export const safe=guard;');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","upstream-import-auth");
    const changedTarget=git(f.cwd,"rev-parse","HEAD");
    const report=reconcile(f.base,changedTarget,f.fork);
    const candidate=report.files.find(v=>v.path==="components/safe.tsx");
    assert.equal(candidate.status,"contract_requires_review");
    assert.ok(candidate.signals.includes("protected_module_import_change"));
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});

test("arquivo e index coexistentes bloqueiam resolucao ambigua",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const graph=dependencyGraph([
    {path:"components/widget.ts",content:"export const x=1;"},
    {path:"components/widget/index.ts",content:"export const y=2;"},
    {path:"lib/elus360/consumer.ts",content:'import "@/components/widget";'}
  ]);
  assert.equal(graph.complete,false);
  assert.ok(graph.unresolved.some(x=>x.reason==="ambiguous_local_module"));
});
test("aliases locais desconhecidos nao sao tratados como packages externos",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const graph=dependencyGraph([
    {path:"components/demo.ts",content:'import "~/internal/protected";'},
    {path:"components/demo2.ts",content:'import "#private/helper";'}
  ]);
  assert.equal(graph.complete,false);
  assert.equal(graph.unresolved.filter(x=>x.reason==="unsupported_local_specifier").length,2);
});
test("grafo longo preserva integridade de caminhos e ciclos dentro de limite",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const sources=[{path:"components/start.ts",content:"export const start=1;"}];
  for(let i=0;i<360;i++) sources.push({
    path:"components/chain"+i+".ts",
    content:'import "@/components/'+(i===0?"start":"chain"+(i-1))+'";'
  });
  sources.push({path:"lib/elus360/entry.ts",content:'import "@/components/chain359";'});
  const begin=performance.now();
  const graph=dependencyGraph(sources);
  const dependents=transitiveProtectedDependents(["components/start.ts"],sources,graph);
  const elapsed=performance.now()-begin;
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  assert.deepEqual(dependents.get("components/start"),["lib/elus360/entry.ts"]);
  assert.ok(elapsed<15000,"grafo sintetico excessivamente lento: "+elapsed.toFixed(0)+"ms");
});

test("AST detecta dependencias usadas apenas em tipos importados",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const sources=[
    {path:"components/domain.ts",content:"export interface Domain {id:string}"},
    {path:"app/api/v1/orders/route.ts",content:'type Domain = import("@/components/domain").Domain; export type {Domain};'}
  ];
  const graph=dependencyGraph(sources);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  assert.deepEqual(transitiveProtectedDependents(["components/domain.ts"],sources,graph).get("components/domain"),["app/api/v1/orders/route.ts"]);
});
test("modulos de autenticacao, acoes e MCP fazem parte dos consumidores protegidos",async()=>{
  const {transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const sources=[
    {path:"components/shared.ts",content:"export const x=1;"},
    {path:"app/actions/example.ts",content:'import "@/components/shared";'},
    {path:"lib/mcp/example.ts",content:'import "@/components/shared";'},
    {path:"components/auth/example.ts",content:'import "@/components/shared";'}
  ];
  assert.deepEqual(transitiveProtectedDependents(["components/shared.ts"],sources).get("components/shared"),[
    "app/actions/example.ts","components/auth/example.ts","lib/mcp/example.ts"
  ]);
});

test("tsconfig paths, baseUrl e reexports encadeados preservam o consumidor protegido",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const tsconfig=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",baseUrl:".",paths:{"#domain/*":["components/domain/*"],"@/*":["./*"]}}});
  const sources=[
    {path:"components/domain/index.ts",content:"export const value=1;"},
    {path:"components/barrel.ts",content:'export {value} from "#domain/index";'},
    {path:"lib/auth/guard.ts",content:'import {value} from "@/components/barrel";'},
  ];
  const graph=dependencyGraph(sources,tsconfig);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  assert.deepEqual(transitiveProtectedDependents(["components/domain/index.ts"],sources,graph).get("components/domain"),["lib/auth/guard.ts"]);
});
test("tsconfig invalido e import computado bloqueiam grafo com configuracao real",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const sources=[{path:"components/a.ts",content:'export async function fn(x){return import(x)}'}];
  assert.equal(dependencyGraph(sources,"{INVALID_JSON").complete,false);
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}});
  const result=dependencyGraph(sources,config);
  assert.equal(result.complete,false);
  assert.ok(result.unresolved.some(x=>x.reason==="computed_module_specifier"));
});
test("alias configurado mas nao resolvido exige revisao em vez de tratar como pacote",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"#secure/*":["lib/secure/*"]}}});
  const result=dependencyGraph([{path:"components/a.ts",content:'import "#secure/missing";'}],config);
  assert.equal(result.complete,false);
  assert.ok(result.unresolved.some(x=>x.reason==="unresolved_configured_module"));
});

test("alias de tsconfig que aponta para auth e governanca e bloqueado na entrada upstream",async()=>{
  const {changedModuleSignals}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",baseUrl:".",paths:{"$security/*":["lib/auth/*"],"$governance/*":["lib/elus360/ai-managed/*"]}}});
  for(const spec of ["$security/guard","$governance/policy","lib/auth/server"]) {
    const signals=changedModuleSignals("components/ordinary.tsx","export const a=1;",'import "'+spec+'";',config);
    assert.ok(signals.includes("protected_module_import_change"),spec);
  }
});
test("falha de parse e import computado preservam fail-closed",async()=>{
  const {dependencyGraph,changedModuleSignals}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}});
  const malformed=dependencyGraph([{path:"components/a.ts",content:"export function broken( {"}],config);
  assert.equal(malformed.complete,false);
  assert.ok(malformed.unresolved.some(e=>e.reason==="typescript_parse_failed"));
  const computed=changedModuleSignals("components/a.ts","export const x=1;","export const y=import(target);",config);
  assert.ok(computed.includes("dependency_analysis_incomplete"));
});

test("tsconfig extends sem suporte nao libera integracao automatica",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const cfg=JSON.stringify({extends:"./tsconfig.base.json",compilerOptions:{moduleResolution:"bundler",module:"esnext"}});
  const graph=dependencyGraph([{path:"components/a.ts",content:"export const a=1;"}],cfg);
  assert.equal(graph.complete,false);
  assert.ok(graph.unresolved.some(e=>e.reason==="unsupported_tsconfig_extends"));
});

test("grafo TS com aliases e cadeias protegidas nunca promove candidatos com import computado",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"],"#internal/*":["lib/*"]}}});
  const sources=[
    {path:"components/low.ts",content:"export const value=1;"},
    {path:"components/middle.ts",content:'export * from "@/components/low";'},
    {path:"lib/auth/check.ts",content:'import {value} from "@/components/middle"; export const check=value;'},
    {path:"lib/rbac/check.ts",content:'export {check} from "#internal/auth/check";'},
    {path:"app/api/v1/ai/routes/route.ts",content:'import {check} from "#internal/rbac/check"; export const GET=()=>check;'},
    {path:"components/dynamic.ts",content:"export async function load(key){return import(key);}"},
  ];
  const graph=dependencyGraph(sources,config);
  assert.equal(graph.complete,false);
  assert.ok(graph.unresolved.some(x=>x.reason==="computed_module_specifier"));
  assert.deepEqual(transitiveProtectedDependents(["components/low.ts"],sources,graph).get("components/low"),[
    "app/api/v1/ai/routes/route.ts","lib/auth/check.ts","lib/rbac/check.ts"
  ]);
});

test("alias hash para contrato protegido gera sinais de contrato e incompletude",async()=>{
  const {changedModuleSignals}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"#secure/*":["lib/auth/*"]}}});
  const signals=changedModuleSignals("components/ordinary.ts","export const x=1;",'import "#secure/guard";',config);
  assert.ok(signals.includes("protected_module_import_change"));
  assert.ok(signals.includes("dependency_analysis_incomplete"));
});
