#!/usr/bin/env node
/**
 * ELUS360 Upstream Sync — reconciliacao triadica somente leitura.
 * Compara BASE_UPSTREAM, TARGET_UPSTREAM e HEAD_ELUS por blob Git.
 * Nao faz fetch, checkout, patch, SQL, push ou deploy.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SAFE = /^(?:app\/|lib\/|components\/|workers\/|tests\/unit\/)/;
const BLOCK = /^(?:lib\/elus360\/|components\/elus360\/|docs\/elus360\/|scripts\/elus-|tests\/(?:unit\/elus360-|operational\/elus-))/;
const SQL = /^(?:supabase\/|scripts\/.*(?:migration|sql|upgrade|baseline))/i;
const SENSITIVE = [
  [/^(?:app\/api\/|app\/actions\/|lib\/auth\/|lib\/api\/|lib\/supabase\/)/, "auth_api_tenancy"],
  [/^(?:lib\/ai\/|lib\/agent-engine\/|app\/app\/ai\/|app\/onboarding\/|lib\/instalacao\/)/, "ai_agent_contract"],
  [/^(?:workers\/|lib\/event|app\/api\/v1\/cron\/)/, "worker_events"],
  [/^(?:app\/app\/prospecting\/|lib\/prospecting\/)/, "prospecting"],
];
const INFRA = /^(?:\.github\/|Dockerfile|compose|hostgator-setup-kit\/|package\.json$|pnpm-lock\.yaml$|proxy\.ts$)/;
function git(args, {allowFailure = false} = {}) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  if (result.error || (result.status !== 0 && !allowFailure)) throw Error("GIT_FAILED:" + args[0]);
  return result.status === 0 ? result.stdout.trimEnd() : null;
}
function oid(ref, path) {
  if (!path || path.includes("\0") || path.includes("\n")) throw Error("UNSAFE_PATH");
  return git(["rev-parse", "--verify", ref + ":" + path], {allowFailure: true})?.trim() ?? null;
}
function impact(path) {
  if (BLOCK.test(path)) return "elus_extension";
  if (SQL.test(path)) return "database_schema";
  if (INFRA.test(path)) return "delivery_infrastructure";
  for (const [re, label] of SENSITIVE) if (re.test(path)) return label;
  if (!SAFE.test(path)) return "unclassified";
  return "application_code";
}
function statusFor(path, before, after, fork) {
  if (after === fork) return "already_integrated";
  if (before === after) return "unchanged";
  const domain = impact(path);
  if (domain === "elus_extension" || domain === "database_schema" || domain === "delivery_infrastructure" || domain === "unclassified")
    return "protected_requires_review";
  if (!after) return "deletion_requires_review";
  if (before !== fork) return "conflict_requires_review";
  if (domain !== "application_code") return "contract_requires_review";
  return "safe_to_prepare";
}
function parse(args) {
  if (args.length !== 6 || args[0] !== "--base" || args[2] !== "--target" || args[4] !== "--fork")
    throw Error("USAGE: --base SHA40 --target SHA40 --fork SHA40");
  const refs = [args[1], args[3], args[5]];
  if (refs.some(x => !SHA.test(x))) throw Error("PIN_REQUIRED");
  for (const ref of refs) git(["rev-parse", "--verify", ref + "^{commit}"]);
  if (git(["merge-base", "--is-ancestor", refs[0], refs[1]], {allowFailure:true}) === null) {
    // merge-base --is-ancestor prints nothing even on success: check status directly.
    const check = spawnSync("git", ["merge-base", "--is-ancestor", refs[0], refs[1]], {cwd:process.cwd()});
    if (check.status !== 0) throw Error("RELEASES_NOT_ANCESTRAL");
  }
  return refs;
}
export function reconcile(base, target, fork) {
  const change = git(["diff", "--name-only", "-z", "--no-renames", base, target]);
  const paths = change ? change.split("\0").filter(Boolean) : [];
  const files = paths.map(path => {
    const before = oid(base, path), after = oid(target, path), local = oid(fork, path);
    return {path, impact: impact(path), status: statusFor(path, before, after, local)};
  });
  const counts = {};
  for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1;
  const gated = files.filter(f => !["already_integrated", "unchanged", "safe_to_prepare"].includes(f.status));
  return {
    schema_version: 1, tool: "elus-upstream-reconcile", mode: "read_only",
    fork: "OARANHA/elus360", upstream: "melgarafael/DeskcommCRM",
    refs: {base, target, fork}, totals: {changed: files.length, ...counts},
    gate: gated.length ? "manual_review_required" : "candidate_analysis_ready",
    disclaimer: "Comparacao por blobs, nao prova equivalencia semantica. Nenhuma alteracao foi aplicada. Validar SHA oficial, testes e contratos antes da PR.",
    files
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [base,target,fork] = parse(process.argv.slice(2));
    process.stdout.write(JSON.stringify(reconcile(base,target,fork),null,2) + "\n");
  } catch(e) {
    process.stderr.write("ELUS_RECONCILE_NO_GO:" + String(e.message).slice(0,150) + "\n");
    process.exitCode = 3;
  }
}
