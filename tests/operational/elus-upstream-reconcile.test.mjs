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
  set("components/a.tsx","old");set("components/permission.tsx","old");set("components/img.svg","old");set("components/safe.tsx","old");set("lib/auth/guard.ts","old");set("lib/elus360/policy.ts","old");set("app/app/p.tsx","old");set("app/app/delete.tsx","old");
  const base=commit("base");
  set("components/a.tsx","upstream");set("components/permission.tsx","provider model");set("components/img.svg","new");set("components/safe.tsx","upstream");set("lib/auth/guard.ts","upstream");set("lib/elus360/policy.ts","upstream");set("app/app/p.tsx","upstream");rmSync(join(cwd,"app/app/delete.tsx"));
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
    assert.ok(p.files.find(x=>x.path==="components/permission.tsx").signals.includes("managed_ai"));
    assert.ok(p.files.find(x=>x.path==="components/permission.tsx").suggested_checks.includes("ai_managed_grants_negative"));
    assert.equal(statuses["lib/auth/guard.ts"],"contract_requires_review");
    assert.equal(statuses["lib/elus360/policy.ts"],"protected_requires_review");
    assert.equal(statuses["app/app/p.tsx"],"conflict_requires_review");
    assert.equal(statuses["app/app/delete.tsx"],"deletion_requires_review");
    assert.equal(p.gate,"manual_review_required");
    assert.equal(p.totals.changed,8);
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
