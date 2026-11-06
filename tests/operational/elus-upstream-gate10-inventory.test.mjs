import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../../scripts/elus-upstream-gate10-inventory.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("Gate 10: scanner observa chamadas RPC e SQL em um fixture descartavel", () => {
  const dir = mkdtempSync(join(tmpdir(), "elus-gate10-scanner-"));
  try {
    mkdirSync(join(dir, "lib"), { recursive: true });
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(dir, "lib", "a.ts"),
      'await client.rpc("emit_event", { p_organization_id: org });\n' +
      'await client.from("event_log").insert({ organization_id: org });\n');
    writeFileSync(join(dir, "supabase", "migrations", "a.sql"),
      'select public.emit_event(' + "'x', 'y', null" + ');\n');
    const report = scanRepository(dir);
    assert.ok(report.matches.some(x => x.path === "lib/a.ts" && x.kind === "rpc_emit_event"));
    assert.ok(report.matches.some(x => x.path === "lib/a.ts" && x.kind === "direct_event_log_insert"));
    assert.ok(report.matches.some(x => x.path === "supabase/migrations/a.sql" && x.kind === "sql_emit_event"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Gate 10: emissores de alto impacto conhecidos aparecem no checkout real", () => {
  const report = scanRepository(root);
  assert.ok(report.filesScanned > 100);
  assert.ok(report.counts.rpc_emit_event > 0);
  const paths = new Set(report.matches.filter(x => x.kind === "rpc_emit_event").map(x => x.path));
  const known = [
    "lib/automation/actions/add-tag.ts",
    "lib/ai/handoff/orchestrator.ts",
    "workers/ai-sentiment-worker.ts",
    "app/api/v1/messages/_handler.ts",
    "app/api/v1/webhooks/cobranca/[provedor]/route.ts",
    "app/api/v1/webhooks/nuvemshop/[event]/route.ts",
    "app/api/v1/cron/contact-birthdays/route.ts",
    "app/api/v1/cron/lead-date-field-due/route.ts",
    "app/api/v1/cron/lead-time-triggers/route.ts",
  ];
  for (const path of known) assert.ok(paths.has(path), "emissor nao localizado: " + path);
});
test("Gate 10: relatorio nao se apresenta como certificacao de seguranca", () => {
  const r = scanRepository(root);
  assert.equal(r.method, "lexical_candidates_not_verified_call_graph");
  assert.ok(r.limitations.some(x => x.includes("does not prove authorization")));
});
