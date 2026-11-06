import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../../scripts/elus-upstream-gate10-inventory.mjs";
import { classifyInventory, classifyOccurrence } from "../../scripts/elus-upstream-gate10-classify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
test("Gate 10: todas as ocorrencias recebem classificacao, sem declarar aprovacao", () => {
  const raw = scanRepository(root);
  const result = classifyInventory(raw);
  assert.equal(result.classifiedCount, result.sourceMatchCount);
  assert.equal(result.items.some(x => x.security_approved !== false), false);
  assert.ok(result.items.every(x => x.classification && x.priority));
});
test("Gate 10: separa snapshot, migrations, ferramentas, runtime e indiretas", () => {
  assert.equal(classifyOccurrence({path:"supabase/baseline.sql",kind:"sql_emit_event"}),"baseline_snapshot");
  assert.equal(classifyOccurrence({path:"supabase/migrations/0001.sql",kind:"event_log_trigger"}),"historical_migration");
  assert.equal(classifyOccurrence({path:"scripts/e2e-test.mjs",kind:"sql_emit_event"}),"test_instrumentation");
  assert.equal(classifyOccurrence({path:"lib/ai/runtime/agent.ts",kind:"rpc_emit_event"}),"runtime_rpc_callsite");
  assert.equal(classifyOccurrence({path:"lib/leads/agent-activity.ts",kind:"direct_event_log_insert"}),"runtime_direct_insert");
  assert.equal(classifyOccurrence({path:"lib/schemas/webhooks.ts",kind:"event_log_trigger"}),"indirect_code_or_comment_reference");
});
test("Gate 10: totais oficiais do SHA-base permanecem identificaveis", () => {
  const r = classifyInventory(scanRepository(root));
  // Drift de contagem exige revisao do inventario, nao declaracao automatica de seguranca.
  assert.equal(r.byClass.baseline_snapshot, 105);
  assert.equal(r.byClass.historical_migration, 94);
  assert.equal(r.byClass.runtime_rpc_callsite, 78);
  assert.equal(r.byClass.runtime_direct_insert, 8);
  assert.equal(r.byClass.indirect_code_or_comment_reference, 7);
  assert.equal(r.byClass.test_instrumentation, 3);
  assert.equal(r.classifiedCount, 295);
});
