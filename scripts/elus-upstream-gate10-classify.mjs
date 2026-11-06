/**
 * Gate 10 — classificação TOTAL dos candidatos do inventário (read-only).
 * A classificação identifica a ORIGEM da ocorrência; não prova autorização.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./elus-upstream-gate10-inventory.mjs";

export function classifyOccurrence(item) {
  const { path, kind } = item;
  if (path === "supabase/baseline.sql") return "baseline_snapshot";
  if (path.startsWith("supabase/migrations/")) return "historical_migration";
  if (path.startsWith("scripts/")) return "test_instrumentation";
  if (kind === "rpc_emit_event") return "runtime_rpc_callsite";
  if (kind === "direct_event_log_insert") return "runtime_direct_insert";
  return "indirect_code_or_comment_reference";
}
export function priorityForPath(path) {
  if (/(lgpd|cobranca|billing|messages|ai\/|webhooks|waha|meta\/|send-)/i.test(path))
    return "high_external_or_sensitive_effect";
  if (/(leads\/|automation|followup|cron|contacts|inbox|agenda)/i.test(path))
    return "high_domain_event";
  return "normal_manual_review";
}
export function classifyInventory(source) {
  const items = source.matches.map(m => ({
    ...m,
    classification: classifyOccurrence(m),
    priority: priorityForPath(m.path),
    code_location_classified: true,
    reachability_verified: false,
    authorization_verified: false,
    security_approved: false,
  }));
  const byClass = Object.fromEntries([...new Set(items.map(x => x.classification))]
    .sort().map(key => [key, items.filter(x => x.classification === key).length]));
  return {
    sourceMethod: source.method,
    sourceMatchCount: source.matchCount,
    sourceFilesScanned: source.filesScanned,
    classifiedCount: items.length,
    byClass,
    caveats: [
      "classification by source location and lexical kind, not full call graph",
      "runtime_rpc_callsite and runtime_direct_insert are code-level candidates; execution/authorization are not proven",
      "historical migrations and baseline snapshot can contain definitions superseded by newer migrations",
      "no code in tests/** is included by the original scanner",
      "SQL indirect and dynamic emitters require dedicated manual review",
      "CI PASS of inventory is NOT security acceptance",
    ],
    items,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const report = classifyInventory(scanRepository(root));
  const opt = process.argv.indexOf("--output");
  if (opt >= 0) {
    const p = process.argv[opt + 1];
    if (!p) throw new Error("--output requires a file path");
    const dest = resolve(p);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify({
    sourceMatchCount: report.sourceMatchCount,
    classifiedCount: report.classifiedCount,
    byClass: report.byClass,
    classification: "source_only_security_not_approved",
  }));
}
