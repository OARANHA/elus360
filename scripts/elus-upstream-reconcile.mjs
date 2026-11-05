#!/usr/bin/env node
/**
 * ELUS360 Upstream Sync — reconciliacao triadica somente leitura.
 * Compara BASE_UPSTREAM, TARGET_UPSTREAM e HEAD_ELUS por blob Git.
 * Plan: apenas leitura. Prepare: patch restrito em worktree descartavel. Nunca SQL, push ou deploy.
 */
import { spawnSync } from "node:child_process";
import { resolve, isAbsolute, relative, sep } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
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
function git(args, {allowFailure = false, cwd = process.cwd(), input, binary = false} = {}) {
  const result = spawnSync("git", args, { cwd, encoding: binary ? null : "utf8", input, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  if (result.error || (result.status !== 0 && !allowFailure)) throw Error("GIT_FAILED:" + args[0]);
  return result.status === 0 ? (binary ? result.stdout : result.stdout.trimEnd()) : null;
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
  const mode = args[0] === "prepare" ? "prepare" : "plan";
  const params = args[0] === "prepare" || args[0] === "plan" ? args.slice(1) : args;
  if ((mode === "plan" && params.length !== 6) || (mode === "prepare" && params.length !== 8) ||
      params[0] !== "--base" || params[2] !== "--target" || params[4] !== "--fork" ||
      (mode === "prepare" && params[6] !== "--out"))
    throw Error("USAGE: [plan|prepare] --base SHA40 --target SHA40 --fork SHA40 [--out ABSOLUTE_NEW_PATH]");
  const refs = [params[1], params[3], params[5]];
  if (refs.some(x => !SHA.test(x))) throw Error("PIN_REQUIRED");
  for (const ref of refs) git(["rev-parse", "--verify", ref + "^{commit}"]);
  if (git(["merge-base", "--is-ancestor", refs[0], refs[1]], {allowFailure:true}) === null) {
    // merge-base --is-ancestor prints nothing even on success: check status directly.
    const check = spawnSync("git", ["merge-base", "--is-ancestor", refs[0], refs[1]], {cwd:process.cwd()});
    if (check.status !== 0) throw Error("RELEASES_NOT_ANCESTRAL");
  }
  return {refs, mode, out: params[7]};
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

/**
 * Prepara SOMENTE patches de codigo ordinario classificados como seguros.
 * Cria worktree detached num caminho novo absoluto; nao faz git add/commit/push.
 * O checkout do fork e comparado por SHA pinado: nao modifica a branch atual.
 */
export function prepare(base, target, fork, out) {
  if (!out || !isAbsolute(out)) throw Error("ABSOLUTE_OUTPUT_REQUIRED");
  const dir = resolve(out);
  if (existsSync(dir)) throw Error("OUTPUT_ALREADY_EXISTS");
  const top = resolve(git(["rev-parse", "--show-toplevel"]));
  const nested = relative(top,dir);
  if (!nested.startsWith(".."+sep) && nested !== ".." && !isAbsolute(nested))
    throw Error("OUTPUT_MUST_BE_OUTSIDE_CHECKOUT");
  const report = reconcile(base,target,fork);
  const safe = report.files.filter(x=>x.status === "safe_to_prepare").map(x=>x.path);
  git(["worktree","add","--detach",dir,fork]);
  try {
    if (safe.length) {
      const patch = git(["diff","--binary","--no-renames",base,target,"--",...safe],{binary:true});
      if (patch.length) {
        git(["apply","--check","--binary","-"],{cwd:dir,input:patch,binary:true});
        git(["apply","--binary","-"],{cwd:dir,input:patch,binary:true});
      }
    }
    mkdirSync(resolve(dir,".elus-upstream"),{recursive:true});
    writeFileSync(resolve(dir,".elus-upstream","report.json"),JSON.stringify({
      ...report, preparedFiles:safe, note:"Worktree detached, sem commit. Revisar os arquivos antes de qualquer PR."
    },null,2)+"\n");
    return {output:dir, preparedFiles:safe.length, reviewRequired:report.gate!=="candidate_analysis_ready",totals:report.totals};
  } catch(e) {
    throw Error("PREPARE_INCOMPLETE_AT:"+dir+":"+String(e.message).slice(0,120));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {refs:[base,target,fork],mode,out} = parse(process.argv.slice(2));
    const result = mode === "prepare" ? prepare(base,target,fork,out) : reconcile(base,target,fork);
    process.stdout.write(JSON.stringify(result,null,2) + "\n");
  } catch(e) {
    process.stderr.write("ELUS_RECONCILE_NO_GO:" + String(e.message).slice(0,150) + "\n");
    process.exitCode = 3;
  }
}
