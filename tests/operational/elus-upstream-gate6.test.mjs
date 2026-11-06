import test from "node:test";
import assert from "node:assert/strict";
import { buildGate6, REVIEW12 } from "../../scripts/elus-upstream-gate6-evidence.mjs";

const refs=Object.freeze({
  base:"ba24d4d366b7caf056b88553e0ed434cb0fb46de",
  target:"ca37cb7f2a35c1a0f6abc968139dd263b20ccb36",
  fork:"749aaf8fbb25b46dddd9138219e2ac032cc83336"
});
function fixture(){
 const modules=Array.from({length:45},(_,i)=>{
   const path="lib/new-upstream-"+i+".ts";
   return {path,approval:"none",source_in_target:true,source_in_fork:false,
     original_status:"contract_requires_review",
     direct_consumer_count:i===0?3:0,
     direct_protected_consumers:i===0?["app/api/protected/route.ts"]:[],
     transitive_protected_consumer_count:i===0?4:0,
     imports_protected:i===1?["lib/auth/server.ts"]:[],
     imports_changed_target_files:[],
     target_ast_unresolved:[],
     required_checks:["module_contract_review"]};
 });
 const candidates=REVIEW12.map((x,i)=>({
   path:x.path,approval:"none",actual_status:"contract_requires_review",
   oid:{base:"a".repeat(40),fork:"a".repeat(40),target:"b".repeat(40)},
   diff:"-export const before=true;\n+export const after=true;",
   added_lines:1,removed_lines:1}));
 const comparisons=REVIEW12.map(x=>({
   path:x.path,approval:"none",fork_distance:2,target_distance:3,
   target_first_hop_directions:["imports"]}));
 const plan={refs:{...refs},mode:"read_only",gate:"manual_review_required",
   totals:{changed:787,contract_requires_review:545,protected_requires_review:235,conflict_requires_review:7},
   dependency_scan:{complete:false,unresolved_count:1},
   files:modules.map(x=>({path:x.path,status:x.original_status}))};
 const gate5={refs:{...refs},mode:"read_only",authorization:"none",
   triad12:{candidates},target_graph:{
     modules,distance_comparison_12:comparisons,
     target_graph:{sources:3279,module_edges:15702,
       complete:false,unresolved_count:2,
       unresolved_examples:[{path:"curso/semear-demonstracao.ts",reason:"computed_module_specifier"}]}
   }};
 return {plan,gate5};
}
test("Gate6 mantém 12 decisões de revisão e 45 módulos sem autorização",()=>{
 const {plan,gate5}=fixture();
 const result=buildGate6(plan,gate5);
 assert.equal(result.status,"manual_review_required");
 assert.equal(result.authorization,"none");
 assert.equal(result.counts.reviewed12,12);
 assert.equal(result.counts.new_modules,45);
 assert.equal(result.counts.safe_to_prepare,0);
 assert.equal(result.counts.decisions.compatible_for_human_review,2);
 assert.equal(result.counts.decisions.requires_adaptation,5);
 assert.equal(result.counts.decisions.blocked_pending_contract_proof,5);
 assert.equal(result.review12.every(x=>x.authorization==="none"&&x.tests.length>1),true);
 assert.equal(result.review45.every(x=>x.authorization==="none"),true);
 assert.equal(result.review45[0].risk_tier,"high_priority_contract_review");
 assert.equal(result.review45[1].risk_tier,"high_priority_contract_review");
 assert.equal(result.review45[2].risk_tier,"new_module_interface_review");
});
test("Gate6 preserva inconclusões de imports computados sem promover candidatos",()=>{
 const {plan,gate5}=fixture();
 const r=buildGate6(plan,gate5);
 assert.equal(r.graph_complete,false);
 assert.equal(r.computed_imports.fork_unresolved,1);
 assert.equal(r.computed_imports.target_unresolved,2);
 assert.equal(r.computed_imports.target_sites[0].path,"curso/semear-demonstracao.ts");
 assert.equal(r.counts.safe_to_prepare,0);
});
test("Gate6 reprova autorização inserida no plano e referências divergentes",()=>{
 const {plan,gate5}=fixture();
 const other=fixture();
 assert.notStrictEqual(plan.refs,gate5.refs);
 assert.notStrictEqual(plan.refs,other.plan.refs);
 assert.notStrictEqual(gate5.refs,other.gate5.refs);
 plan.totals.safe_to_prepare=1;
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_FAIL_CLOSED_INPUT/);
 plan.totals.safe_to_prepare=0;
 plan.files[0].status="safe_to_prepare";
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_FAIL_CLOSED_INPUT/);
 plan.files[0].status="contract_requires_review";
 gate5.refs.target="0".repeat(40);
 assert.equal(plan.refs.target,refs.target);
 assert.equal(other.plan.refs.target,refs.target);
 assert.equal(other.gate5.refs.target,refs.target);
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_REF_MISMATCH/);
});
test("Gate6 reprova 12 candidatos com fork divergente, aprovação ou diff vazio",()=>{
 const {plan,gate5}=fixture();
 gate5.triad12.candidates[0].oid.fork="c".repeat(40);
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_UNTRUSTED_TRIAD/);
 gate5.triad12.candidates[0].oid.fork="a".repeat(40);
 gate5.triad12.candidates[0].approval="safe_to_prepare";
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_UNTRUSTED_TRIAD/);
 gate5.triad12.candidates[0].approval="none";
 gate5.triad12.candidates[0].diff="";
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_UNTRUSTED_TRIAD/);
});
test("Gate6 reprova origem nova não comprovada e contagens erradas",()=>{
 const {plan,gate5}=fixture();
 gate5.target_graph.modules[5].source_in_fork=true;
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_NEW_SOURCE_PROVENANCE/);
 gate5.target_graph.modules[5].source_in_fork=false;
 gate5.target_graph.modules.pop();
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_COUNT_MISMATCH/);
});
test("Gate6 rejeita grafo falsamente completo",()=>{
 const {plan,gate5}=fixture();
 gate5.target_graph.target_graph.complete=true;
 assert.throws(()=>buildGate6(plan,gate5),/GATE6_FALSE_AST_COMPLETENESS/);
});
