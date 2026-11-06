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
import { TextDecoder } from "node:util";
import { auditPath, contractSignals, checksForSignals } from "./elus-upstream-contract-risk.mjs";
import { dependencyGraph, transitiveProtectedDependents, protectedConsumers, uninventoriedAiSurfaces, changedModuleSignals, changedRiskCouplings, newUnsafeImportSignals } from "./elus-upstream-dependency-risk.mjs";

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
const UI_PROTECTED = /^(?:app\/layout\.tsx$|app\/design\/layout\.tsx$|app\/admin\/|app\/\(public\)\/|app\/auth\/|app\/app\/(?:settings|ai|admin)\/|components\/(?:auth|ai|elus|admin|settings)\/|lib\/(?:i18n|permissions|rbac|audit)\/)/;
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
function readSource(ref, path, id) {
  if (!id) return "";
  const size = Number(git(["cat-file", "-s", id]));
  if (!Number.isSafeInteger(size) || size > 524288) return null;
  const bytes = git(["show", ref + ":" + path], {binary:true});
  try {return new TextDecoder("utf-8", {fatal:true}).decode(bytes);}
  catch {return null;}
}
function modeOf(ref, path) {
  const line = git(["ls-tree", ref, "--", path]);
  return line ? line.split(" ", 1)[0] : null;
}
function impact(path) {
  if (BLOCK.test(path)) return "elus_extension";
  if (SQL.test(path)) return "database_schema";
  if (INFRA.test(path)) return "delivery_infrastructure";
  if (UI_PROTECTED.test(path)) return "client_visibility_or_admin_contract";
  for (const [re, label] of SENSITIVE) if (re.test(path)) return label;
  if (!SAFE.test(path)) return "unclassified";
  return "application_code";
}
function statusFor(path, before, after, fork, signals = []) {
  if (after === fork) return "already_integrated";
  if (before === after) return "unchanged";
  const domain = impact(path);
  if (domain === "elus_extension" || domain === "database_schema" || domain === "delivery_infrastructure" || domain === "unclassified")
    return "protected_requires_review";
  if (!after) return "deletion_requires_review";
  if (before !== fork) return "conflict_requires_review";
  if (domain !== "application_code" || signals.length) return "contract_requires_review";
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
function inspectForkDependencies(fork,candidatePaths,unsafePaths=[]) {
  if(!candidatePaths.length) return {dependents:new Map(),complete:true,count:0,unresolved:0};
  // One Git tree read and one batch object read (rather than three processes per source).
  const tree=git(["ls-tree","-r","-z",fork,"--","app/","lib/","components/","workers/","hooks/","types/","curso/","proxy.ts","instrumentation.ts","instrumentation-client.ts","sentry.edge.config.ts","sentry.server.config.ts"],{binary:true});
  const entries=tree.toString("utf8").split("\0").filter(Boolean).map(line=>{
    const tab=line.indexOf("\t"),metadata=line.slice(0,tab).split(" ");
    return {path:line.slice(tab+1),mode:metadata[0],type:metadata[1],oid:metadata[2]};
  }).filter(entry=>/\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.path) && !/\.test\.[jt]sx?$/.test(entry.path));
  const resourcePaths=tree.toString("utf8").split("\0").filter(Boolean).map(line=>{const tab=line.indexOf("\t");return {meta:line.slice(0,tab),path:line.slice(tab+1)};}).filter(item=>item.meta.startsWith("100644 blob ") && /\.(?:css|scss|sass|json)$/.test(item.path)).map(item=>item.path);
  if(entries.length>5000 || entries.some(e=>e.mode!=="100644"||e.type!=="blob"))
    return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};
  if(!entries.length) return {dependents:new Map(),complete:false,count:0,unresolved:1};
  const input=entries.map(e=>e.oid).join("\n")+"\n";
  const blobs=git(["cat-file","--batch"],{input,binary:true});
  if(blobs.length>48*1024*1024) return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};
  const sources=[];
  let offset=0;
  const decoder=new TextDecoder("utf-8",{fatal:true});
  for(const entry of entries) {
    const nl=blobs.indexOf(10,offset);
    if(nl<0) return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};
    const header=blobs.subarray(offset,nl).toString("ascii").split(" ");
    const size=Number(header[2]);
    if(header[0]!==entry.oid||header[1]!=="blob"||!Number.isSafeInteger(size)||size>2097152||
       size<0||nl+1+size>=blobs.length||blobs[nl+1+size]!==10)
      return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};
    try {sources.push({path:entry.path,content:decoder.decode(blobs.subarray(nl+1,nl+1+size))});}
    catch {return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};}
    offset=nl+size+2;
  }
  if(offset!==blobs.length) return {dependents:new Map(),complete:false,count:entries.length,unresolved:1};
  const configId=oid(fork,"tsconfig.json");
  const config=configId?readSource(fork,"tsconfig.json",configId):null;
  const graph=dependencyGraph(sources,config??"",resourcePaths);
  return {dependents:transitiveProtectedDependents(candidatePaths,sources,graph),
    riskCouplings:changedRiskCouplings(candidatePaths,unsafePaths,graph),
    complete:graph.complete,count:sources.length,unresolved:graph.unresolved.length,unresolved_reasons:[...new Set(graph.unresolved.map(x=>x.reason))].sort()};
}
function inventoryFor(fork) {
  const path="docs/elus360/ai-governance-write-surfaces.json";
  const id=oid(fork,path);
  if(!id) return null;
  try {
    const raw=readSource(fork,path,id);
    if(raw===null) return null;
    const parsed=JSON.parse(raw);
    return parsed && Array.isArray(parsed.surfaces) ? parsed : null;
  } catch {return null;}
}
export function reconcile(base, target, fork) {
  for (const ref of [base,target,fork]) {
    if (!SHA.test(ref)) throw Error("PIN_REQUIRED");
    git(["rev-parse","--verify",ref+"^{commit}"]);
  }
  const change = git(["diff", "--name-only", "-z", "--no-renames", base, target]);
  const paths = change ? change.split("\0").filter(Boolean) : [];
  const configBlob=oid(fork,"tsconfig.json");
  const configuredTs=configBlob?readSource(fork,"tsconfig.json",configBlob):null;
  const files = paths.map(path => {
    const before = oid(base, path), after = oid(target, path), local = oid(fork, path);
    const original = before === after || after === local ? "" : readSource(base,path,before);
    const incoming = before === after || after === local ? "" : readSource(target,path,after);
    const flags = before === after || after === local ? [] : [
      ...auditPath(path, modeOf(target,path)),
      ...contractSignals(path, original, incoming),
      ...changedModuleSignals(path, original, incoming, configuredTs),
    ];
    return {path, impact: impact(path), status: statusFor(path, before, after, local, flags), signals: flags, suggested_checks: checksForSignals(flags)};
  });
  // Reclassify source candidates whose NEW target imports reference another unsafe
  // changed file: such an edge is absent from the fork-side dependency graph.
  const batchUnsafe=files.filter(f=>!["safe_to_prepare","already_integrated","unchanged"].includes(f.status)).map(f=>f.path);
  for(const file of files) {
    if(file.status!=="safe_to_prepare") continue;
    const beforeOid=oid(base,file.path),afterOid=oid(target,file.path);
    const before=readSource(base,file.path,beforeOid),after=readSource(target,file.path,afterOid);
    const additions=newUnsafeImportSignals(file.path,before,after,batchUnsafe,configuredTs);
    if(additions.length) {
      file.signals.push(...additions);
      file.status="contract_requires_review";
      file.suggested_checks=checksForSignals(file.signals);
    }
  }
  const safe = files.filter(f=>f.status==="safe_to_prepare").map(f=>f.path);
  const unsafe=files.filter(f=>!["safe_to_prepare","already_integrated","unchanged"].includes(f.status)).map(f=>f.path);
  const dependencyScan=inspectForkDependencies(fork,safe,unsafe);
  const uninventoried=new Set(uninventoriedAiSurfaces(paths,inventoryFor(fork)));
  for(const file of files) {
    if(file.status==="safe_to_prepare") {
      const importers=protectedConsumers(file.path,dependencyScan.dependents);
      file.protected_importers=importers;
      if(importers.length) file.signals.push("protected_reverse_dependency");
      const coupled=dependencyScan.riskCouplings?.get(file.path)??[];
      if(coupled.length){file.signals.push("unsafe_changed_dependency_chain");file.unsafe_changed_neighbors=coupled;}
      if(!dependencyScan.complete) file.signals.push("dependency_analysis_incomplete");
    }
    if(uninventoried.has(file.path)) file.signals.push("uninventoried_ai_surface");
    if(file.signals.length && file.status==="safe_to_prepare") file.status="contract_requires_review";
    file.signals=[...new Set(file.signals)];
    file.suggested_checks=checksForSignals(file.signals);
  }
  const counts = {};
  for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1;
  const gated = files.filter(f => !["already_integrated", "unchanged", "safe_to_prepare"].includes(f.status));
  return {
    schema_version: 1, tool: "elus-upstream-reconcile", mode: "read_only",
    fork: "OARANHA/elus360", upstream: "melgarafael/DeskcommCRM",
    refs: {base, target, fork}, totals: {changed: files.length, ...counts},
    gate: gated.length ? "manual_review_required" : "candidate_analysis_ready",
    dependency_scan: {scope:"typescript_ast_transitive_imports",scanned:dependencyScan.count,complete:dependencyScan.complete,unresolved_count:dependencyScan.unresolved,unresolved_reasons:dependencyScan.unresolved_reasons??[]},
    uninventoried_ai_paths: [...uninventoried].sort(),
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
  if (git(["status","--porcelain"])) throw Error("WORKTREE_NOT_CLEAN");
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
