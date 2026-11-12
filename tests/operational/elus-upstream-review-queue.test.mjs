import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewQueue, markdownReviewQueue } from "../../scripts/elus-upstream-review-queue.mjs";

const A="a".repeat(40), B="b".repeat(40), C="c".repeat(40), HASH="d".repeat(64);
const sample=()=>({
  tool:"elus-upstream-reconcile",mode:"read_only",refs:{base:A,target:B,fork:C},
  totals:{changed:3,contract_requires_review:2,conflict_requires_review:1},
  gate:"manual_review_required",dependency_scan:{complete:false,unresolved_count:2,unresolved_reasons:["computed_module_specifier"]},
  files:[
    {path:"lib/agenda/servicos/motivos.ts",status:"contract_requires_review",preliminary_status:"safe_to_prepare",
      impact:"application_code",signals:["exported_contract_change"],
      candidate_analysis:{review_bucket:"potential_compatibility_manual_review"}},
    {path:"lib/env.ts",status:"conflict_requires_review",impact:"auth_api_tenancy",signals:["tenant_isolation"]},
    {path:"lib/ai/runtime/agent.ts",status:"contract_requires_review",impact:"ai_agent_contract",signals:["managed_ai"]},
  ],
});
test("sorts review-only items, without ever authorizing promotion",()=>{
  const q=buildReviewQueue(sample(),HASH);
  assert.deepEqual(q.entries.map(x=>x.bucket),[
    "potential_manual_compatibility","fork_conflicts","security_and_runtime",
  ]);
  assert.ok(q.entries.every(item=>item.authorization==="none"&&item.manual_review_required));
  assert.equal(q.policy.auto_apply,false);
  assert.equal(q.dependency_scan.complete,false);
  assert.match(markdownReviewQueue(q),/Nenhuma promoção automática foi autorizada/);
});
test("refuses missing source proofs and bad integrity",()=>{
  const no=sample();no.refs.base="main";
  assert.throws(()=>buildReviewQueue(no,HASH),/INVALID_PINNED_REFS/);
  const altered=sample();altered.totals.changed=99;
  assert.throws(()=>buildReviewQueue(altered,HASH),/INVALID_PLAN_COUNTS/);
  const duplicate=sample();duplicate.files[0].path=duplicate.files[1].path;
  assert.throws(()=>buildReviewQueue(duplicate,HASH),/INVALID_PATH_OR_STATUS/);
  const traversal=sample();traversal.files[0].path="../.env";
  assert.throws(()=>buildReviewQueue(traversal,HASH),/INVALID_PATH_OR_STATUS/);
  const count=sample();count.totals.contract_requires_review=1;
  assert.throws(()=>buildReviewQueue(count,HASH),/STATUS_TOTAL_MISMATCH/);
});
test("schema review stays blocked, with full group accounting",()=>{
  const p=sample();
  p.files.push({path:"supabase/baseline.sql",status:"protected_requires_review",
    impact:"database_schema",signals:["uninspectable_content"]});
  p.totals.changed++;
  p.totals.protected_requires_review=1;
  const q=buildReviewQueue(p,HASH);
  assert.equal(q.totals.groups.schema_review,1);
  assert.equal(q.totals.changed,4);
  assert.equal(q.entries.find(x=>x.path==="supabase/baseline.sql").authorization,"none");
});
