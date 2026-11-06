import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyzeTargetSources, examineTriad, buildGate5Report } from "../../scripts/elus-upstream-gate5-evidence.mjs";

function fakePlan() {
  const files=[];
  for(let i=0;i<45;i++) {
    files.push({path:"components/new-gate5-"+i+".ts",status:"contract_requires_review",
      candidate_analysis:{fork_graph_absence_reason:"new_upstream_source_not_in_fork"}});
  }
  for(let i=45;i<787;i++) files.push({path:"docs/noise-"+i+".md",
    status:i<57?"contract_requires_review":"protected_requires_review",
    preliminary_status:i<57?"safe_to_prepare":"protected_requires_review",
    ...(i<57?{candidate_analysis:{review_bucket:"potential_compatibility_manual_review",
      dependency_graph:{nearest_hard_risk:null}}}:{})});
  return {mode:"read_only",gate:"manual_review_required",totals:{changed:787},
    files};
}
const config=JSON.stringify({compilerOptions:{
  module:"esnext",moduleResolution:"bundler",paths:{"@/*":["./*"]}
}});
test("Gate5 inspeciona os 45 modulos no target e diferencia dependente protegido direto e transitivo",()=>{
  const plan=fakePlan();
  const sources=plan.files.slice(0,45).map(x=>({path:x.path,content:"export const flag = 1;"}));
  sources[0].content='import {guard} from "@/lib/auth/guard"; export const flag = guard;';
  sources[1].content='import {flag} from "./new-gate5-0"; export const other = flag;';
  sources.push(
    {path:"lib/auth/guard.ts",content:"export const guard = true;"},
    {path:"components/bridge.ts",content:'import {other} from "./new-gate5-1"; export const value=other;'},
    {path:"app/api/v1/ai/tools/route.ts",content:'import {value} from "@/components/bridge"; export const GET=()=>value;'}
  );
  const result=analyzeTargetSources({sources,config,plan});
  const m0=result.modules[0],m1=result.modules[1];
  assert.equal(result.target_graph.complete,true,JSON.stringify(result.target_graph));
  assert.equal(result.summary.new_production_modules,45);
  assert.equal(result.distance_comparison_12.length,12);
  assert.ok(result.distance_comparison_12.every(x=>x.approval==="none"));
  assert.ok(m0.imports_protected.includes("lib/auth/guard.ts"));
  assert.equal(m1.direct_protected_consumers.length,0);
  assert.ok(m0.transitive_protected_consumer_count>0);
  assert.ok(m1.transitive_protected_consumer_count>0);
  assert.equal(m0.approval,"none");
  assert.equal(result.summary.modules_without_static_consumers>0,true);
});
test("Gate5 nao declara AST completo quando target possui import computado",()=>{
  const plan=fakePlan();
  const sources=plan.files.slice(0,45).map(x=>({path:x.path,content:"export const flag = 1;"}));
  sources[2].content='export function load(name: string) { return import(name); }';
  const result=analyzeTargetSources({sources,config,plan});
  assert.equal(result.target_graph.complete,false);
  assert.ok(result.target_graph.unresolved_reasons.includes("computed_module_specifier"));
  assert.equal(result.summary.new_production_modules,45);
  assert.ok(result.modules[2].target_ast_unresolved.length>0);
  assert.ok(result.modules.every(m=>m.approval==="none"));
});
test("Gate5 recusa inventario de modulo novo ausente no target e contagem errada",()=>{
  const plan=fakePlan();
  const sources=plan.files.slice(0,44).map(x=>({path:x.path,content:"export const flag = 1;"}));
  assert.throws(()=>analyzeTargetSources({sources,config,plan}),/TARGET_NEW_SOURCE_MISSING/);
  plan.files[0].candidate_analysis={fork_graph_absence_reason:"existing_test_excluded"};
  assert.throws(()=>analyzeTargetSources({sources,config,plan}),/UNEXPECTED_NEW_PRODUCTION_COUNT/);
});
function git(cwd,...args){return execFileSync("git",args,{cwd,encoding:"utf8"}).trim();}
test("Gate5 exige diffs triadicos reais e nunca aprova os 12 por semelhança",()=>{
  const dir=mkdtempSync(join(tmpdir(),"elus-gate5-"));
  const prior=process.cwd();
  try {
    git(dir,"init","-q");git(dir,"config","user.email","test@example.invalid");
    git(dir,"config","user.name","Gate5 test");
    for(let i=0;i<12;i++) {
      const path="lib/feature-"+i+".ts";
      mkdirSync(dirname(join(dir,path)),{recursive:true});
      writeFileSync(join(dir,path),"export const value = "+i+";\n");
    }
    git(dir,"add",".");git(dir,"commit","-qm","base");
    const base=git(dir,"rev-parse","HEAD");
    const files=[];
    for(let i=0;i<12;i++) {
      const path="lib/feature-"+i+".ts";
      writeFileSync(join(dir,path),"export const value = "+(i+1)+";\n");
      files.push({path,status:"contract_requires_review",signals:["exported_contract_change"],
        suggested_checks:["runtime_contract_regression"],
        candidate_analysis:{review_bucket:"potential_compatibility_manual_review",
          ast_precision:{executed:true},dependency_graph:{nearest_hard_risk:null}}});
    }
    git(dir,"add",".");git(dir,"commit","-qm","target");
    const target=git(dir,"rev-parse","HEAD");
    process.chdir(dir);
    const report=examineTriad({plan:{files},base,target,fork:base});
    assert.equal(report.count,12);
    assert.ok(report.candidates.every(x=>x.approval==="none"&&x.fork_same_as_base));
    assert.ok(report.candidates.every(x=>x.diff.includes("+export const value")));
    git(dir,"checkout","-q",base);
    writeFileSync(join(dir,"lib/feature-3.ts"),"export const value = 999;\n");
    git(dir,"add",".");git(dir,"commit","-qm","fork customization");
    const fork=git(dir,"rev-parse","HEAD");
    assert.throws(()=>examineTriad({plan:{files},base,target,fork}),/TRIAD_PROVENANCE_MISMATCH/);
  } finally {
    process.chdir(prior);rmSync(dir,{recursive:true,force:true});
  }
});
test("Gate5 falha fechado com SHA divergente ou plano que contem aprovacoes",()=>{
  const ref="1".repeat(40),base="2".repeat(40),target="3".repeat(40);
  const p={refs:{base,target,fork:ref},mode:"read_only",gate:"candidate_analysis_ready",
    totals:{changed:787,safe_to_prepare:1},files:Array(787).fill({})};
  assert.throws(()=>buildGate5Report({base,target,fork:ref,plan:p}),/NOT_FAIL_CLOSED/);
  p.gate="manual_review_required";p.totals.safe_to_prepare=0;
  assert.throws(()=>buildGate5Report({base,target,fork:"4".repeat(40),plan:p}),/REF_MISMATCH/);
});
