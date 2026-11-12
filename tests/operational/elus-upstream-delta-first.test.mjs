import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {deltaDecision,localCustomizationConsumers} from "../../scripts/elus-upstream-delta-policy.mjs";
import {reconcile,prepare} from "../../scripts/elus-upstream-reconcile.mjs";
const a="a".repeat(40),b="b".repeat(40),c="c".repeat(40);
function decide(path,fork=a,target=b){return deltaDecision({path,baseOid:a,targetOid:target,forkOid:fork,baseMode:"100644",targetMode:target===null?null:"100644",forkMode:fork===null?null:"100644"});}
test("delta-first separa arquivos originais, customizados e gates",()=>{
  assert.equal(decide("lib/auth/ordinary.ts"),"stage_direct_candidate");
  assert.equal(decide("app/app/ai/agents/page.tsx"),"stage_direct_candidate");
  assert.equal(decide("components/shared.ts",c),"review_fork_overlap");
  assert.equal(decide("components/shared.ts",b),"already_integrated");
  assert.equal(decide("components/shared.ts",a,null),"review_upstream_deletion");
  assert.equal(decide("supabase/baseline.sql"),"review_database_schema");
  assert.equal(decide(".github/workflows/ci.yml"),"review_distribution_contract");
  assert.equal(decide("lib/elus360/ai-managed/policy.ts"),"review_elus_namespace");
  assert.equal(decide("../escape.ts"),"review_invalid_path");
  assert.equal(deltaDecision({path:"components/symlink.ts",baseOid:a,targetOid:b,forkOid:a,baseMode:"100644",targetMode:"120000",forkMode:"100644"}),"review_git_object_mode");
});
test("rastreia consumidores locais transitivos",()=>{
  const graph={reverse:new Map([["components/shared.ts",new Set(["components/bridge.ts"])],["components/bridge.ts",new Set(["lib/elus360/adapter.ts"])]])};
  assert.deepEqual(localCustomizationConsumers(["components/shared.ts"],["lib/elus360/adapter.ts"],graph).get("components/shared.ts"),["lib/elus360/adapter.ts"]);
});
const git=(cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
test("integração triádica prepara código original sem tocar em governança, SQL ou fork",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"elus-delta-")),old=process.cwd();
  const set=(p,v)=>{const f=join(cwd,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,v);};
  const commit=m=>{git(cwd,"add",".");git(cwd,"commit","-qm",m);return git(cwd,"rev-parse","HEAD");};
  const out=join(tmpdir(),"elus-delta-staged-"+process.pid+"-"+Date.now());
  try{
    git(cwd,"init","-q");git(cwd,"config","user.name","Tests");git(cwd,"config","user.email","test@example.invalid");
    set("tsconfig.json",JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}}}));
    set("lib/auth/original.ts","export const value=1;\n");
    set("components/clean.ts","export const clean=1;\n");
    set("components/custom.ts","export const custom=1;\n");
    set("components/dependency.ts","export const dependency=1;\n");
    set("supabase/baseline.sql","SELECT 1;\n");
    const base=commit("base");
    set("lib/auth/original.ts","export const value=2;\n");
    set("components/clean.ts","export const clean=2;\n");
    set("components/custom.ts","export const custom=2;\n");
    set("components/dependency.ts","export const dependency=2;\n");
    set("components/new.ts","export const novidade=1;\n");
    set("supabase/baseline.sql","SELECT 2;\n");
    const target=commit("target");
    git(cwd,"checkout","-q",base);
    set("components/custom.ts","export const custom=100;\n");
    set("lib/elus360/adapter.ts",'import {dependency} from "@/components/dependency"; export const x=dependency;\n');
    const fork=commit("fork");
    process.chdir(cwd);
    const plan=reconcile(base,target,fork,{deltaFirst:true});
    const by=Object.fromEntries(plan.files.map(f=>[f.path,f.delta_first.decision]));
    assert.equal(by["lib/auth/original.ts"],"stage_direct_candidate");
    assert.equal(by["components/clean.ts"],"stage_direct_candidate");
    assert.equal(by["components/new.ts"],"stage_direct_candidate");
    assert.equal(by["components/custom.ts"],"review_fork_overlap");
    assert.equal(by["components/dependency.ts"],"review_customization_dependency");
    assert.equal(by["supabase/baseline.sql"],"review_database_schema");
    assert.equal(plan.delta_first.staged_candidate_paths,3);
    const prepared=prepare(base,target,fork,out,{deltaFirst:true});
    assert.equal(prepared.preparedFiles,3);
    // Regressao real: git diff do worktree omitia arquivos NOVOS, apesar de
    // "preparedFiles" declara-los. Publicar sempre o patch completo.
    const patch=readFileSync(join(out,".elus-upstream","direct-candidate.patch"));
    const patchText=patch.toString("utf8");
    assert.match(patchText,/diff --git a\/components\/new\.ts b\/components\/new\.ts/);
    assert.match(patchText,/new file mode 100644/);
    assert.match(patchText,/diff --git a\/components\/clean\.ts b\/components\/clean\.ts/);
    assert.doesNotMatch(patchText,/diff --git a\/components\/custom\.ts /);
    const audit=JSON.parse(readFileSync(join(out,".elus-upstream","report.json"),"utf8"));
    assert.equal(audit.preparedPatchPaths,3);
    assert.equal(audit.preparedPatchBytes,patch.length);
    assert.equal(audit.preparedPatchSha256,createHash("sha256").update(patch).digest("hex"));
    assert.equal(prepared.preparedPatchSha256,audit.preparedPatchSha256);
    assert.equal(readFileSync(join(out,"components/clean.ts"),"utf8"),"export const clean=2;\n");
    assert.equal(readFileSync(join(out,"lib/auth/original.ts"),"utf8"),"export const value=2;\n");
    assert.equal(readFileSync(join(out,"components/custom.ts"),"utf8"),"export const custom=100;\n");
    assert.equal(readFileSync(join(out,"components/dependency.ts"),"utf8"),"export const dependency=1;\n");
    assert.equal(readFileSync(join(out,"supabase/baseline.sql"),"utf8"),"SELECT 1;\n");
    assert.equal(existsSync(join(out,"lib/elus360/adapter.ts")),true);
    assert.equal(readFileSync(join(cwd,"components/clean.ts"),"utf8"),"export const clean=1;\n");
  }finally{
    process.chdir(cwd);if(existsSync(out))git(cwd,"worktree","remove","--force",out);
    process.chdir(old);rmSync(cwd,{recursive:true,force:true});
  }
});

test("workflow usa SHA real da PR e publica patch incluindo arquivos nao rastreados",()=>{
  const workflow=readFileSync(new URL("../../.github/workflows/elus360-upstream-reconcile.yml",import.meta.url),"utf8");
  assert.match(workflow,/PR_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow,/git cat-file -e "\$PR_HEAD\^\{commit\}"/);
  assert.doesNotMatch(workflow,/fork=\$\(git rev-parse HEAD\)/);
  assert.match(workflow,/elus-upstream-candidate\/\.elus-upstream\/direct-candidate\.patch/);
  assert.doesNotMatch(workflow,/git -C "\$RUNNER_TEMP\/elus-upstream-candidate" diff/);
});
