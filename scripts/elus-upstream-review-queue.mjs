#!/usr/bin/env node
/**
 * ELUS360 Upstream Sync — audit-only review queue.
 * Does not grant authorization, mutate application code or access services.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const STATES = new Set([
  "already_integrated", "unchanged", "safe_to_prepare",
  "protected_requires_review", "contract_requires_review",
  "conflict_requires_review", "deletion_requires_review",
]);
const ORDER = [
  "potential_manual_compatibility", "fork_conflicts", "upstream_deletions",
  "schema_review", "security_and_runtime", "test_review", "other_review",
];

function validPath(path) {
  return typeof path === "string" && path.length > 0 && path.length < 4096 &&
    !path.startsWith("/") && !path.includes("\\") &&
    !/[\x00-\x1f\x7f]/.test(path) &&
    !path.split("/").some(part => part === "." || part === ".." || part === "");
}
function bucket(file) {
  if (file.candidate_analysis?.review_bucket === "potential_compatibility_manual_review")
    return "potential_manual_compatibility";
  if (file.status === "conflict_requires_review") return "fork_conflicts";
  if (file.status === "deletion_requires_review") return "upstream_deletions";
  if (file.path.startsWith("supabase/") || file.impact === "database_schema")
    return "schema_review";
  if ([
      "auth_api_tenancy", "ai_agent_contract", "worker_events",
      "client_visibility_or_admin_contract", "delivery_infrastructure", "elus_extension",
    ].includes(file.impact)) return "security_and_runtime";
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path)) return "test_review";
  return "other_review";
}
export function buildReviewQueue(plan, digest) {
  if (plan?.tool !== "elus-upstream-reconcile" || plan.mode !== "read_only" ||
      !plan.refs || ![plan.refs.base,plan.refs.target,plan.refs.fork].every(v => typeof v === "string" && SHA.test(v)))
    throw Error("INVALID_PINNED_REFS");
  if (!Array.isArray(plan.files) || plan.files.length > 50000 ||
      plan.totals?.changed !== plan.files.length)
    throw Error("INVALID_PLAN_COUNTS");
  if (!/^[0-9a-f]{64}$/.test(digest)) throw Error("INVALID_DIGEST");

  const counts = {};
  const names = new Set();
  const validated = plan.files.map(item => {
    if (!item || !validPath(item.path) || names.has(item.path) ||
        !STATES.has(item.status) || !Array.isArray(item.signals) ||
        item.signals.some(signal => typeof signal !== "string"))
      throw Error("INVALID_PATH_OR_STATUS");
    names.add(item.path);
    counts[item.status] = (counts[item.status] || 0) + 1;
    return {
      path:item.path, bucket:bucket(item), status:item.status,
      initial_status:item.preliminary_status ?? null, impact:item.impact ?? null,
      signals:[...item.signals].sort(),
      review_bucket:item.candidate_analysis?.review_bucket ?? null,
      evidence:{
        ast_export_relation:item.candidate_analysis?.ast_precision?.export_relation ?? null,
        graph_complete:item.candidate_analysis?.dependency_graph?.complete === true,
      },
      authorization:"none", manual_review_required:true,
      delta_decision:item.delta_first?.decision??null,
    };
  });
  const entries=plan.delta_first?validated.filter(item=>item.delta_decision!=="stage_direct_candidate"):validated;
  for (const [state, count] of Object.entries(counts))
    if (plan.totals[state] !== count) throw Error("STATUS_TOTAL_MISMATCH");
  for (const [state, count] of Object.entries(plan.totals))
    if (state !== "changed" && (counts[state] !== count || !STATES.has(state)))
      throw Error("STATUS_TOTAL_MISMATCH");
  entries.sort((a,b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const groups = Object.fromEntries(ORDER.map(name => [name,0]));
  entries.forEach(item => groups[item.bucket]++);
  return {
    schema_version:1, tool:"elus-upstream-review-queue",
    source_plan_sha256:digest, refs:plan.refs, source_gate:plan.gate,
    dependency_scan:{
      complete:plan.dependency_scan?.complete === true,
      unresolved_count:plan.dependency_scan?.unresolved_count ?? null,
      unresolved_reasons:plan.dependency_scan?.unresolved_reasons ?? [],
    },
    totals:{changed:plan.files.length,requires_review:entries.length,
      staged_candidates:plan.delta_first?.staged_candidate_paths??0,statuses:counts,groups},
    policy:{authorization:"none",auto_apply:false,auto_merge:false,auto_deploy:false},
    entries,
  };
}
export function markdownReviewQueue(queue) {
  const lines=[
    "# ELUS360 — fila de revisão do upstream",
    "",
    "Todos os itens requerem revisão. Nenhuma promoção automática foi autorizada.",
    "",
    "Base: " + queue.refs.base,
    "Destino: " + queue.refs.target,
    "Fork: " + queue.refs.fork,
    "SHA-256 do plano: " + queue.source_plan_sha256,
    "Gate: " + queue.source_gate,
    "AST completo: " + queue.dependency_scan.complete,
    "Referências de importação não resolvidas: " + queue.dependency_scan.unresolved_count,
    "Total: " + queue.totals.changed,
    "",
    "## Quantidades por grupo",
    "",
  ];
  for (const [group,count] of Object.entries(queue.totals.groups))
    lines.push("- " + group + ": " + count);
  lines.push("", "## Trinta primeiros candidatos de revisão", "");
  for (const item of queue.entries.slice(0,30))
    lines.push("- " + item.path + " — " + item.bucket + " — " + item.status);
  lines.push("", "A lista completa, incluindo sinais e fontes de risco, está no JSON adjunto.", "");
  return lines.join("\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3 || args.some(x=>!x.startsWith("/")))
      throw Error("USAGE: ABS_PLAN ABS_QUEUE_JSON ABS_QUEUE_MD");
    const bytes=readFileSync(args[0]);
    if (bytes.length > 16*1024*1024) throw Error("PLAN_TOO_LARGE");
    const plan=JSON.parse(bytes.toString("utf8"));
    const digest=createHash("sha256").update(bytes).digest("hex");
    const result=buildReviewQueue(plan,digest);
    writeFileSync(args[1],JSON.stringify(result,null,2)+"\n",{flag:"wx"});
    writeFileSync(args[2],markdownReviewQueue(result),{flag:"wx"});
    process.stdout.write("ELUS_REVIEW_QUEUE_CREATED:"+result.entries.length+"\n");
  } catch(e) {
    process.stderr.write("ELUS_REVIEW_QUEUE_NO_GO:"+String(e.message).slice(0,180)+"\n");
    process.exitCode=3;
  }
}
