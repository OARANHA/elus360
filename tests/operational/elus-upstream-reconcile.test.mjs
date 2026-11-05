import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {execFileSync} from "node:child_process";
import {reconcile} from "../../scripts/elus-upstream-reconcile.mjs";

function git(cwd,...args) { return execFileSync("git",args,{cwd,encoding:"utf8"}).trim(); }
function fixture() {
  const cwd=mkdtempSync(join(tmpdir(),"elus-reconcile-"));
  git(cwd,"init","-q");git(cwd,"config","user.name","Tests");git(cwd,"config","user.email","test@example.invalid");
  function set(path, content) { const full=join(cwd,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content); }
  function commit(label){git(cwd,"add",".");git(cwd,"commit","-qm",label);return git(cwd,"rev-parse","HEAD");}
  set("components/a.tsx","old");set("lib/auth/guard.ts","old");set("lib/elus360/policy.ts","old");set("app/app/p.tsx","old");set("app/app/delete.tsx","old");
  const base=commit("base");
  set("components/a.tsx","upstream");set("lib/auth/guard.ts","upstream");set("lib/elus360/policy.ts","upstream");set("app/app/p.tsx","upstream");rmSync(join(cwd,"app/app/delete.tsx"));
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
    assert.equal(statuses["lib/auth/guard.ts"],"contract_requires_review");
    assert.equal(statuses["lib/elus360/policy.ts"],"protected_requires_review");
    assert.equal(statuses["app/app/p.tsx"],"conflict_requires_review");
    assert.equal(statuses["app/app/delete.tsx"],"deletion_requires_review");
    assert.equal(p.gate,"manual_review_required");
    assert.equal(p.totals.changed,5);
  } finally {process.chdir(previous);rmSync(f.cwd,{recursive:true,force:true});}
});
test("caminho ordinario novo somente e seguro quando nao customizado",()=>{
  const f=fixture();const old=process.cwd();try {
    process.chdir(f.cwd);const p=reconcile(f.base,f.target,f.fork);
    assert.equal(p.files.filter(x=>x.status==="safe_to_prepare").length,0);
  }finally{process.chdir(old);rmSync(f.cwd,{recursive:true,force:true});}
});
