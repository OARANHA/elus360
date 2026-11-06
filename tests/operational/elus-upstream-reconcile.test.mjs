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

test("reconciliacao inclui hooks reais em grafo transitivo protegido",()=>{
  const f=fixture(),prior=process.cwd();
  try {
    process.chdir(f.cwd);
    mkdirSync(join(f.cwd,"hooks"),{recursive:true});
    writeFileSync(join(f.cwd,"hooks/useSafe.ts"),'import "@/components/safe"; export const useSafe=()=>true;');
    writeFileSync(join(f.cwd,"lib/auth/guard.ts"),'import {useSafe} from "@/hooks/useSafe"; export const guard=useSafe;');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","fork runtime hooks chain");
    const report=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    const file=report.files.find(x=>x.path==="components/safe.tsx");
    assert.equal(file.status,"contract_requires_review");
    assert.ok(file.signals.includes("protected_reverse_dependency"));
    assert.ok(file.protected_importers.includes("lib/auth/guard.ts"));
  }finally{process.chdir(prior);rmSync(f.cwd,{recursive:true,force:true});}
});
test("arquivo de teste excluido pelo tsconfig nao contamina grafo runtime",()=>{
  const f=fixture(),prior=process.cwd();
  try{
    process.chdir(f.cwd);
    writeFileSync(join(f.cwd,"lib/waha-auth.test.ts"),'test("nul",()=>{const text="a\\0b";});');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","fork excluded test source");
    const report=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    assert.equal(report.dependency_scan.complete,true,JSON.stringify(report.dependency_scan));
    assert.equal(report.files.find(x=>x.path==="components/safe.tsx").status,"safe_to_prepare");
  }finally{process.chdir(prior);rmSync(f.cwd,{recursive:true,force:true});}
});

test("recursos CSS e JSON existentes no Git encerram aresta, sem mascarar module ausente",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",resolveJsonModule:true,paths:{"@/*":["./*"]}}});
  const sources=[
    {path:"app/layout.tsx",content:'import "./globals.css"; export const layout=1;'},
    {path:"curso/receitas.ts",content:'import data from "./receitas.json"; export const x=data;'}
  ];
  const complete=dependencyGraph(sources,config,["app/globals.css","curso/receitas.json"]);
  assert.equal(complete.complete,true,JSON.stringify(complete.unresolved));
  assert.equal(complete.verified_resources,2);
  const missing=dependencyGraph(sources,config,["app/globals.css"]);
  assert.equal(missing.complete,false);
  assert.ok(missing.unresolved.some(x=>x.specifier==="./receitas.json"));
});
test("entrypoints Sentry seguem dependencias TS protegidas, sem ignorar modulo ausente",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}});
  const sources=[
    {path:"lib/auth/policy.ts",content:"export const policy=1;"},
    {path:"sentry.server.config.ts",content:'import "@/lib/auth/policy";'},
    {path:"instrumentation.ts",content:'export async function register(){return import("./sentry.server.config");}'}
  ];
  const graph=dependencyGraph(sources,config);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  assert.deepEqual(transitiveProtectedDependents(["lib/auth/policy.ts"],sources,graph).get("lib/auth/policy"),undefined);
  const missing=dependencyGraph(sources.filter(x=>x.path!=="sentry.server.config.ts"),config);
  assert.equal(missing.complete,false);
  assert.ok(missing.unresolved.some(x=>x.specifier==="./sentry.server.config"));
});

test("mudancas no layout raiz e recursos nao executaveis nunca sao safe_to_prepare",async()=>{
  const {auditPath}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  assert.ok(auditPath("app/globals.css","100644").includes("non_source_asset"));
  assert.ok(auditPath("curso/espanhol-demonstracao.json","100644").includes("non_source_asset"));
  const f=fixture(),prior=process.cwd();
  try {
    process.chdir(f.cwd);
    git(f.cwd,"checkout","-q",f.target);
    mkdirSync(join(f.cwd,"app"),{recursive:true});
    writeFileSync(join(f.cwd,"app/layout.tsx"),"export const metadata={title:'Upstream'};");
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","layout-upstream-change");
    const report=reconcile(f.base,git(f.cwd,"rev-parse","HEAD"),f.fork);
    assert.equal(report.files.find(v=>v.path==="app/layout.tsx").status,"contract_requires_review");
  }finally{process.chdir(prior);rmSync(f.cwd,{recursive:true,force:true});}
});

test("scanner pinado reconhece CSS Git regular e bloqueia recurso removido",()=>{
  const f=fixture(),prior=process.cwd();
  try{
    process.chdir(f.cwd);
    writeFileSync(join(f.cwd,"components/theme.ts"),'import "./theme.css"; export const theme=true;');
    writeFileSync(join(f.cwd,"components/theme.css"),".theme { color: #fff; }");
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","fork CSS resource");
    const withResource=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    assert.equal(withResource.dependency_scan.complete,true,JSON.stringify(withResource.dependency_scan));
    assert.equal(withResource.files.find(x=>x.path==="components/safe.tsx").status,"safe_to_prepare");
    git(f.cwd,"rm","-q","components/theme.css");
    git(f.cwd,"commit","-qm","fork CSS missing");
    const withoutResource=reconcile(f.base,f.target,git(f.cwd,"rev-parse","HEAD"));
    assert.equal(withoutResource.dependency_scan.complete,false);
    const candidate=withoutResource.files.find(x=>x.path==="components/safe.tsx");
    assert.equal(candidate.status,"contract_requires_review");
    assert.ok(candidate.signals.includes("dependency_analysis_incomplete"));
  }finally{process.chdir(prior);rmSync(f.cwd,{recursive:true,force:true});}
});

test("import computado em fonte runtime bloqueia candidato ordinario e prepare",()=>{
  const f=fixture(),previous=process.cwd();
  try {
    process.chdir(f.cwd);
    mkdirSync(join(f.cwd,"curso"),{recursive:true});
    writeFileSync(join(f.cwd,"curso/runtime.ts"),'export async function carregar(nome){return import(nome)}');
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","dynamic source in fork");
    const sha=git(f.cwd,"rev-parse","HEAD");
    const report=reconcile(f.base,f.target,sha);
    const candidate=report.files.find(file=>file.path==="components/safe.tsx");
    assert.equal(report.dependency_scan.complete,false);
    assert.ok(report.dependency_scan.unresolved_reasons.includes("computed_module_specifier"));
    assert.equal(candidate.status,"contract_requires_review");
    assert.ok(candidate.signals.includes("dependency_analysis_incomplete"));
    assert.equal(report.totals.safe_to_prepare??0,0);
  }finally{process.chdir(previous);rmSync(f.cwd,{recursive:true,force:true});}
});
test("cobertura reversa adicionada nao remove arestas ou consumidores protegidos",async()=>{
  const {dependencyGraph,transitiveProtectedDependents}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}});
  const base=[
    {path:"components/shared.ts",content:"export const x=1;"},
    {path:"hooks/useShared.ts",content:'export {x} from "@/components/shared";'},
    {path:"lib/auth/guard.ts",content:'import {x} from "@/hooks/useShared"; export const guard=x;'}
  ];
  const expanded=[...base,
    {path:"sentry.server.config.ts",content:'import "@/lib/auth/guard";'},
    {path:"instrumentation.ts",content:'import("./sentry.server.config");'}
  ];
  const before=dependencyGraph(base,config);
  const after=dependencyGraph(expanded,config);
  assert.equal(before.complete,true,JSON.stringify(before.unresolved));
  assert.equal(after.complete,true,JSON.stringify(after.unresolved));
  assert.ok(after.edge_count>=before.edge_count);
  const prev=transitiveProtectedDependents(["components/shared.ts"],base,before).get("components/shared");
  const next=transitiveProtectedDependents(["components/shared.ts"],expanded,after).get("components/shared");
  assert.deepEqual(prev,["lib/auth/guard.ts"]);
  assert.deepEqual(next,prev);
  assert.ok(after.reverse.get("lib/auth/guard.ts").has("sentry.server.config.ts"));
  assert.ok(after.reverse.get("sentry.server.config.ts").has("instrumentation.ts"));
});

test("comparacao exata do conjunto de arestas nao oculta regressao do grafo",async()=>{
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}});
  const baseline=[
    {path:"components/shared.ts",content:"export const x=1;"},
    {path:"hooks/useShared.ts",content:'export {x} from "@/components/shared";'},
    {path:"lib/auth/guard.ts",content:'import {x} from "@/hooks/useShared";'},
  ];
  const added=[
    ...baseline,
    {path:"sentry.server.config.ts",content:'import "@/lib/auth/guard";'},
    {path:"instrumentation.ts",content:'import("./sentry.server.config");'}
  ];
  const pairs=g=>new Set([...g.reverse].flatMap(([target,users])=>[...users].map(user=>JSON.stringify([target,user]))));
  const oldGraph=dependencyGraph(baseline,config),newGraph=dependencyGraph(added,config);
  const oldPairs=pairs(oldGraph),newPairs=pairs(newGraph);
  assert.equal(oldGraph.complete,true,JSON.stringify(oldGraph.unresolved));
  assert.equal(newGraph.complete,true,JSON.stringify(newGraph.unresolved));
  assert.equal(oldGraph.edge_count,2);
  assert.equal(newGraph.edge_count,4);
  for(const edge of oldPairs) assert.ok(newPairs.has(edge),"aresta anterior perdida: "+edge);
  // Deliberate reverse-graph regression must be detected by exact pair comparison.
  const mutated=added.map(s=>s.path==="hooks/useShared.ts"?{...s,content:"export const x=0;"}:s);
  const lostPairs=pairs(dependencyGraph(mutated,config));
  assert.ok([...oldPairs].some(edge=>!lostPairs.has(edge)));
});

test("matriz semantica: assinatura, permissao, tenant e IA alterados sem novos imports exigem revisao",async()=>{
  const {contractSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const changes=[
    {id:"auth_policy",path:"components/policy.ts",before:"export function canAccess(role:string){return role==='admin';}",after:"export function canAccess(role:string){return true;}"},
    {id:"rbac_signature",path:"components/role.ts",before:"export function authorize(role:'admin'|'member'){return role==='admin';}",after:"export function authorize(role:string){return true;}"},
    {id:"tenant_filter",path:"components/tenant.ts",before:"export const allowed=(tenant:string,row:{tenant:string})=>row.tenant===tenant;",after:"export const allowed=(tenant:string,row:{tenant:string})=>true;"},
    {id:"ai_governance",path:"components/agent.ts",before:"export function chooseModel(grant:boolean){return grant?'approved':'blocked';}",after:"export function chooseModel(grant:boolean){return 'anything';}"},
    {id:"api_payload",path:"components/endpoint.ts",before:"export const serialize=(x:number)=>({ok:x});",after:"export const serialize=(x:number)=>({raw:x});"},
    {id:"export_removal",path:"components/contracts.ts",before:"export function allowed(){return false;}",after:"function allowed(){return false;}"},
  ];
  for(const row of changes) {
    const signals=contractSignals(row.path,row.before,row.after);
    assert.ok(signals.includes("exported_contract_change"),row.id+": "+JSON.stringify(signals));
  }
  assert.deepEqual(contractSignals("components/plain.ts","const x=1;","const x=2;"),[]);
});
test("integracao Git triadica: export mutado sem import nao vira safe_to_prepare",()=>{
  const f=fixture(),prior=process.cwd();
  try {
    process.chdir(f.cwd);
    git(f.cwd,"checkout","-q",f.base);
    writeFileSync(join(f.cwd,"components/safe.tsx"),"export function allow(){return true;}");
    git(f.cwd,"add",".");
    git(f.cwd,"commit","-qm","base exported function");
    const baseSha=git(f.cwd,"rev-parse","HEAD");
    writeFileSync(join(f.cwd,"components/safe.tsx"),"export function allow(){return false;}");
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","upstream modifies contract");
    const targetSha=git(f.cwd,"rev-parse","HEAD");
    const result=reconcile(baseSha,targetSha,baseSha);
    const changed=result.files.find(v=>v.path==="components/safe.tsx");
    assert.equal(changed.status,"contract_requires_review");
    assert.ok(changed.signals.includes("exported_contract_change"));
    assert.equal(result.totals.safe_to_prepare??0,0);
  }finally{process.chdir(prior);rmSync(f.cwd,{recursive:true,force:true});}
});
test("resolucao independente TypeScript Program/CompilerHost concorda com grafo AST em aliases encadeados",async()=>{
  const ts=(await import("typescript")).default;
  const {dependencyGraph}=await import("../../scripts/elus-upstream-dependency-risk.mjs");
  const config=JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"],"#domain/*":["lib/domain/*"]}}});
  const sources=[
    {path:"components/shared.ts",content:"export const x=1;"},
    {path:"lib/domain/barrel.ts",content:'export {x} from "@/components/shared";'},
    {path:"lib/auth/guard.ts",content:'import {x} from "#domain/barrel";export const guard=x;'},
    {path:"lib/rbac/check.ts",content:'export {guard} from "@/lib/auth/guard";'},
    {path:"app/api/v1/ai/route.ts",content:'import {guard} from "@/lib/rbac/check";export const POST=()=>guard;'},
    {path:"lib/mcp/handler.ts",content:'import {guard} from "@/lib/auth/guard";export const handle=()=>guard;'}
  ];
  const graph=dependencyGraph(sources,config);
  assert.equal(graph.complete,true,JSON.stringify(graph.unresolved));
  const options={module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,baseUrl:"/virtual",paths:{"@/*":["./*"],"#domain/*":["lib/domain/*"]},noLib:true};
  const files=new Map(sources.map(s=>["/virtual/"+s.path,s.content]));
  const baseHost=ts.createCompilerHost(options);
  const dirs=new Set(["/virtual"]);
  for(const name of files.keys()){let d=name.substring(0,name.lastIndexOf("/"));while(d.length>1&&!dirs.has(d)){dirs.add(d);d=d.substring(0,d.lastIndexOf("/"));}}
  baseHost.fileExists=name=>files.has(name);
  baseHost.readFile=name=>files.get(name);
  baseHost.directoryExists=name=>dirs.has(name);
  baseHost.getCurrentDirectory=()=>"/virtual";
  baseHost.getSourceFile=(name,language)=>files.has(name)?ts.createSourceFile(name,files.get(name),language,true):undefined;
  const program=ts.createProgram({rootNames:[...files.keys()],options,host:baseHost});
  let compared=0;
  for(const [name] of files){
    const file=program.getSourceFile(name);
    for(const node of file.statements) {
      if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node)) continue;
      if(!node.moduleSpecifier) continue;
      const resolved=program.getResolvedModuleFromModuleSpecifier(node.moduleSpecifier,file)?.resolvedModule;
      assert.ok(resolved,"CompilerHost could not resolve "+node.moduleSpecifier.text);
      const target=resolved.resolvedFileName.slice("/virtual/".length);
      const importer=name.slice("/virtual/".length);
      assert.ok(graph.reverse.get(target)?.has(importer),importer+" -> "+target);
      compared++;
    }
  }
  assert.equal(compared,5);
});

test("prepare em worktree isolada aplica apenas mudanca ordinaria e preserva contrato exportado",()=>{
  const f=fixture(),prior=process.cwd(),out=join(tmpdir(),"elus-semantic-prepared-"+process.pid+"-"+Date.now());
  try {
    process.chdir(f.cwd);
    git(f.cwd,"checkout","-q",f.base);
    writeFileSync(join(f.cwd,"components/safe.tsx"),"export function allow(role:string){return role==='admin';}");
    writeFileSync(join(f.cwd,"components/plain.ts"),"const ordinary=1;");
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","base semantic worktree");
    const base=git(f.cwd,"rev-parse","HEAD");
    writeFileSync(join(f.cwd,"components/safe.tsx"),"export function allow(role:string){return true;}");
    writeFileSync(join(f.cwd,"components/plain.ts"),"const ordinary=2;");
    git(f.cwd,"add",".");git(f.cwd,"commit","-qm","upstream with contract and ordinary edits");
    const target=git(f.cwd,"rev-parse","HEAD");
    const report=reconcile(base,target,base);
    assert.equal(report.files.find(x=>x.path==="components/safe.tsx").status,"contract_requires_review");
    assert.equal(report.files.find(x=>x.path==="components/plain.ts").status,"safe_to_prepare");
    const output=prepare(base,target,base,out);
    assert.equal(output.preparedFiles,1);
    assert.equal(readFileSync(join(out,"components/plain.ts"),"utf8"),"const ordinary=2;");
    assert.equal(readFileSync(join(out,"components/safe.tsx"),"utf8"),"export function allow(role:string){return role==='admin';}");
    assert.equal(readFileSync(join(f.cwd,"components/plain.ts"),"utf8"),"const ordinary=2;");
    const reportFile=JSON.parse(readFileSync(join(out,".elus-upstream/report.json"),"utf8"));
    assert.deepEqual(reportFile.preparedFiles,["components/plain.ts"]);
  }finally {
    process.chdir(f.cwd);
    if(existsSync(out)) git(f.cwd,"worktree","remove","--force",out);
    process.chdir(prior);
    rmSync(f.cwd,{recursive:true,force:true});
  }
});

test("reexport nominal preservado nao oculta alteracao na funcao interna exportada",async()=>{
  const {contractSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const before="function canManage(role:string){return role==='admin';}\nexport {canManage};";
  const after="function canManage(role:string){return true;}\nexport {canManage};";
  const signals=contractSignals("components/access.ts",before,after);
  assert.ok(signals.includes("exported_module_internal_change"),JSON.stringify(signals));
  const parseFailure=contractSignals("components/access.ts","export function canManage(){return true;}","export function canManage( {");
  assert.ok(parseFailure.includes("semantic_analysis_incomplete"),JSON.stringify(parseFailure));
});
test("endpoint real sem import novo: permissao e resposta HTTP alteradas requerem revisao",async()=>{
  const {contractSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const before="export async function PATCH(req:Request){ if(!req.headers.get('x-role')) return new Response('denied',{status:403}); return Response.json({ok:true}); }";
  const after="export async function PATCH(req:Request){ return Response.json({ok:true}); }";
  const signals=contractSignals("app/api/v1/ai/agents/[id]/versions/[vid]/route.ts",before,after);
  assert.ok(signals.includes("exported_contract_change"));
  assert.ok(signals.length>=1);
});

test("contrato CommonJS alterado sem imports nao recebe classificador seguro",async()=>{
  const {contractSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const before="function check(r){return r==='admin';} module.exports={check};";
  const after="function check(r){return true;} module.exports={check};";
  const signals=contractSignals("components/access.cjs",before,after);
  assert.ok(signals.includes("exported_module_internal_change"),JSON.stringify(signals));
  const direct=contractSignals("components/access.cjs","module.exports=function check(){return false;}","module.exports=function check(){return true;}");
  assert.ok(direct.includes("exported_contract_change"),JSON.stringify(direct));
});

test("simulacao DeskcommCRM v1-v2-v3 preserva correcoes ELUS no fork e aplica somente patches ordinarios",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"elus-upstream-multiversion-"));
  const previous=process.cwd(),out=join(tmpdir(),"elus-upstream-multiversion-out-"+process.pid+"-"+Date.now());
  const set=(path,content)=>{const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content);};
  const commit=label=>{git(cwd,"add",".");git(cwd,"commit","-qm",label);return git(cwd,"rev-parse","HEAD");};
  try{
    git(cwd,"init","-q");git(cwd,"config","user.name","ELUS Tests");git(cwd,"config","user.email","tests@example.invalid");
    set("tsconfig.json",JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}}));
    set("components/ordinary.ts","const ordinary=1;");
    set("components/fork-custom.ts","const elusCorrectedValue=1;");
    set("lib/auth/require-role.ts","export function requireRole(role:string){return role==='admin';}");
    set("lib/tenant/scope.ts","export function scoped(id:string,row:{org:string}){return row.org===id;}");
    set("lib/ai/agent-policy.ts","export function allowAgent(granted:boolean){return granted;}");
    set("app/api/v1/ai/agents/route.ts","export async function PATCH(){return new Response('denied',{status:403});}");
    set("lib/elus360/identity.ts","export const identity='elus-owned';");
    const upstreamV1=commit("DeskcommCRM v1");
    // Simulate upstream v2: ordinary improvement + changes to security and ELUS-owned surfaces.
    set("components/ordinary.ts","const ordinary=2;");
    set("components/fork-custom.ts","const elusCorrectedValue=2;");
    set("lib/auth/require-role.ts","export function requireRole(role:string){return true;}");
    set("lib/tenant/scope.ts","export function scoped(id:string,row:{org:string}){return true;}");
    set("lib/ai/agent-policy.ts","export function allowAgent(granted:boolean){return true;}");
    set("app/api/v1/ai/agents/route.ts","export async function PATCH(){return Response.json({ok:true});}");
    set("lib/elus360/identity.ts","export const identity='upstream-override';");
    const upstreamV2=commit("DeskcommCRM v2 contract mutations");
    // v3 is a second upstream update; the ordinary improvement remains eligible.
    set("components/ordinary.ts","const ordinary=3;");
    const upstreamV3=commit("DeskcommCRM v3 ordinary improvement");
    git(cwd,"checkout","-q",upstreamV1);
    set("components/fork-custom.ts","const elusCorrectedValue='FIXED_BY_ELUS';");
    set("lib/elus360/identity.ts","export const identity='elus-owned-v2';");
    const fork=commit("ELUS-owned bugfix and isolated customization");
    process.chdir(cwd);
    const report=reconcile(upstreamV1,upstreamV3,fork);
    const status=Object.fromEntries(report.files.map(file=>[file.path,file.status]));
    assert.equal(status["components/ordinary.ts"],"safe_to_prepare");
    assert.equal(status["components/fork-custom.ts"],"conflict_requires_review");
    assert.equal(status["lib/elus360/identity.ts"],"protected_requires_review");
    for(const path of ["lib/auth/require-role.ts","lib/tenant/scope.ts","lib/ai/agent-policy.ts","app/api/v1/ai/agents/route.ts"])
      assert.equal(status[path],"contract_requires_review",path);
    assert.equal(report.gate,"manual_review_required");
    const beforeFork=git(cwd,"rev-parse","HEAD");
    const prepared=prepare(upstreamV1,upstreamV3,fork,out);
    assert.equal(prepared.preparedFiles,1);
    assert.equal(readFileSync(join(out,"components/ordinary.ts"),"utf8"),"const ordinary=3;");
    assert.equal(readFileSync(join(out,"components/fork-custom.ts"),"utf8"),"const elusCorrectedValue='FIXED_BY_ELUS';");
    assert.equal(readFileSync(join(out,"lib/elus360/identity.ts"),"utf8"),"export const identity='elus-owned-v2';");
    assert.equal(readFileSync(join(out,"lib/auth/require-role.ts"),"utf8"),"export function requireRole(role:string){return role==='admin';}");
    assert.equal(readFileSync(join(out,"lib/tenant/scope.ts"),"utf8"),"export function scoped(id:string,row:{org:string}){return row.org===id;}");
    assert.equal(readFileSync(join(out,"lib/ai/agent-policy.ts"),"utf8"),"export function allowAgent(granted:boolean){return granted;}");
    assert.equal(readFileSync(join(out,"app/api/v1/ai/agents/route.ts"),"utf8"),"export async function PATCH(){return new Response('denied',{status:403});}");
    const reportJson=JSON.parse(readFileSync(join(out,".elus-upstream/report.json"),"utf8"));
    assert.deepEqual(reportJson.preparedFiles,["components/ordinary.ts"]);
    assert.equal(git(cwd,"rev-parse","HEAD"),beforeFork);
    assert.equal(git(cwd,"status","--porcelain"),"");
  }finally{
    process.chdir(cwd);
    if(existsSync(out)) git(cwd,"worktree","remove","--force",out);
    process.chdir(previous);
    rmSync(cwd,{recursive:true,force:true});
  }
});

test("bootstrap nao exportado que altera autorizacao ou inicializacao exige revisao sem novos imports",async()=>{
  const {contractSignals}=await import("../../scripts/elus-upstream-contract-risk.mjs");
  const rows=[
    ["components/bootstrap.ts","registerRoutes({requiresRole:true});","registerRoutes({requiresRole:false});"],
    ["components/auth-init.ts","const auth=initializeAuth({checkTenant:true});","const auth=initializeAuth({checkTenant:false});"],
    ["components/ai-init.ts","if(allowAI) configureAgent({approvedOnly:true});","if(allowAI) configureAgent({approvedOnly:false});"],
  ];
  for(const [path,before,after] of rows){
    const signals=contractSignals(path,before,after);
    assert.ok(signals.includes("module_initialization_change"),path+" "+JSON.stringify(signals));
  }
  assert.deepEqual(contractSignals("components/plain.ts","const ordinary=1;","const ordinary=2;"),[]);
});

test("mesmo arquivo mistura melhoria legitima e enfraquecimento RBAC: bloqueio atomico com fork corrigido",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"elus-upstream-mixed-"));
  const prior=process.cwd(),out=join(tmpdir(),"elus-upstream-mixed-out-"+process.pid+"-"+Date.now());
  const set=(path,content)=>{const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content);};
  const commit=name=>{git(cwd,"add",".");git(cwd,"commit","-qm",name);return git(cwd,"rev-parse","HEAD");};
  const baseMixed="export function authorize(role:string){return role==='admin';}\nconst uiVersion=1;\n";
  const upstreamMixed="export function authorize(role:string){return true;}\nconst uiVersion=2;\n";
  const baseShared="const upstreamPart=1;\nconst elusFixedPart=1;\n";
  const forkShared="const upstreamPart=1;\nconst elusFixedPart='ELUS_CORRECTED';\n";
  const upstreamShared="const upstreamPart=2;\nconst elusFixedPart=1;\n";
  try{
    git(cwd,"init","-q");git(cwd,"config","user.name","ELUS Tests");git(cwd,"config","user.email","tests@example.invalid");
    set("tsconfig.json",JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}}));
    set("components/ordinary.ts","const ordinary=1;\n");
    set("components/mixed.ts",baseMixed);
    set("components/shared-correction.ts",baseShared);
    const base=commit("DeskcommCRM base");
    set("components/ordinary.ts","const ordinary=2;\n");
    set("components/mixed.ts",upstreamMixed);
    set("components/shared-correction.ts",upstreamShared);
    const target=commit("DeskcommCRM upstream mixed safe and unsafe changes");
    git(cwd,"checkout","-q",base);
    set("components/shared-correction.ts",forkShared);
    const fork=commit("ELUS preserved fix in other hunk");
    process.chdir(cwd);
    const report=reconcile(base,target,fork);
    const byPath=Object.fromEntries(report.files.map(f=>[f.path,f]));
    assert.equal(byPath["components/ordinary.ts"].status,"safe_to_prepare");
    assert.equal(byPath["components/mixed.ts"].status,"contract_requires_review");
    assert.ok(byPath["components/mixed.ts"].signals.includes("exported_contract_change"));
    assert.equal(byPath["components/shared-correction.ts"].status,"conflict_requires_review");
    assert.equal(report.totals.safe_to_prepare,1);
    const headBefore=git(cwd,"rev-parse","HEAD");
    const worktree=prepare(base,target,fork,out);
    assert.equal(worktree.preparedFiles,1);
    assert.equal(readFileSync(join(out,"components/ordinary.ts"),"utf8"),"const ordinary=2;\n");
    assert.equal(readFileSync(join(out,"components/mixed.ts"),"utf8"),baseMixed);
    assert.equal(readFileSync(join(out,"components/shared-correction.ts"),"utf8"),forkShared);
    assert.equal(git(cwd,"rev-parse","HEAD"),headBefore);
    assert.equal(git(cwd,"status","--porcelain"),"");
    const manifest=JSON.parse(readFileSync(join(out,".elus-upstream/report.json"),"utf8"));
    assert.deepEqual(manifest.preparedFiles,["components/ordinary.ts"]);
    assert.equal(manifest.files.find(f=>f.path==="components/mixed.ts").status,"contract_requires_review");
  } finally {
    process.chdir(cwd);
    if(existsSync(out)) git(cwd,"worktree","remove","--force",out);
    process.chdir(prior);
    rmSync(cwd,{recursive:true,force:true});
  }
});

test("mudancas perigosas distribuidas por arquivos e importacao transitiva bloqueiam candidato ligado, mas nao independente",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"elus-upstream-batch-risk-"));
  const prior=process.cwd(),out=join(tmpdir(),"elus-upstream-batch-out-"+process.pid+"-"+Date.now());
  const set=(path,body)=>{const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,body);};
  const commit=title=>{git(cwd,"add",".");git(cwd,"commit","-qm",title);return git(cwd,"rev-parse","HEAD");};
  try{
    git(cwd,"init","-q");git(cwd,"config","user.name","ELUS Tests");git(cwd,"config","user.email","tests@example.invalid");
    set("tsconfig.json",JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}}));
    set("components/shared.ts","export const flag=true;");
    set("hooks/useFlag.ts",'export {flag} from "@/components/shared";');
    set("components/feature.ts",'import {flag} from "@/hooks/useFlag";const ui=1;');
    set("components/unsafe.ts",'import {flag} from "@/hooks/useFlag";export function authorize(role:string){return role==="admin"&&flag;}');
    set("components/ordinary.ts","const unrelated=1;");
    const base=commit("DeskcommCRM baseline shared hook");
    set("components/feature.ts",'import {flag} from "@/hooks/useFlag";const ui=2;');
    set("components/unsafe.ts",'import {flag} from "@/hooks/useFlag";export function authorize(role:string){return true;}');
    set("components/ordinary.ts","const unrelated=2;");
    const target=commit("DeskcommCRM legit component plus indirect RBAC bypass");
    git(cwd,"checkout","-q",base);
    process.chdir(cwd);
    const report=reconcile(base,target,base);
    const byPath=Object.fromEntries(report.files.map(x=>[x.path,x]));
    assert.equal(report.dependency_scan.complete,true,JSON.stringify(report.dependency_scan));
    assert.equal(byPath["components/unsafe.ts"].status,"contract_requires_review");
    assert.ok(byPath["components/unsafe.ts"].signals.includes("exported_contract_change"));
    assert.equal(byPath["components/feature.ts"].status,"contract_requires_review");
    assert.ok(byPath["components/feature.ts"].signals.includes("unsafe_changed_dependency_chain"));
    assert.deepEqual(byPath["components/feature.ts"].unsafe_changed_neighbors,["components/unsafe.ts"]);
    assert.equal(byPath["components/ordinary.ts"].status,"safe_to_prepare");
    const originalHead=git(cwd,"rev-parse","HEAD");
    const prepared=prepare(base,target,base,out);
    assert.equal(prepared.preparedFiles,1);
    assert.equal(readFileSync(join(out,"components/ordinary.ts"),"utf8"),"const unrelated=2;");
    assert.equal(readFileSync(join(out,"components/feature.ts"),"utf8"),'import {flag} from "@/hooks/useFlag";const ui=1;');
    assert.equal(readFileSync(join(out,"components/unsafe.ts"),"utf8"),'import {flag} from "@/hooks/useFlag";export function authorize(role:string){return role==="admin"&&flag;}');
    assert.equal(git(cwd,"rev-parse","HEAD"),originalHead);
    assert.equal(git(cwd,"status","--porcelain"),"");
  }finally {
    process.chdir(cwd);
    if(existsSync(out))git(cwd,"worktree","remove","--force",out);
    process.chdir(prior);
    rmSync(cwd,{recursive:true,force:true});
  }
});
