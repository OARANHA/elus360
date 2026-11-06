#!/usr/bin/env node
/**
 * ELUS360 Gate 5 — review evidence on real official upstream target.
 * Pure, read-only analysis. Never changes approval, prepare, SQL, Git refs or files.
 * CLI runs from a disposable Git repository with three pinned commits.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  dependencyGraph, transitiveProtectedDependents, protectedConsumers,
  nearestUnsafeRiskEvidence, PROTECTED_PATHS
} from "./elus-upstream-dependency-risk.mjs";

const SHA=/^[0-9a-f]{40}$/;
const SOURCE=/\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST=/(?:\.test|\.spec)\.[cm]?[jt]sx?$/;
const SCOPE=["app/","lib/","components/","workers/","hooks/","types/","curso/",
  "proxy.ts","instrumentation.ts","instrumentation-client.ts",
  "sentry.edge.config.ts","sentry.server.config.ts"];
function git(args,{binary=false,input}={}) {
  const result=spawnSync("git",args,{encoding:binary?null:"utf8",input,
    timeout:90000,maxBuffer:128*1024*1024});
  if(result.error || result.status!==0)
    throw Error("GIT_READ_FAILED:"+args[0]);
  return binary?result.stdout:result.stdout.trimEnd();
}
function oid(ref,path) {
  return git(["rev-parse","--verify",ref+":"+path]);
}
function textOf(ref,path) {
  const raw=git(["show",ref+":"+path],{binary:true});
  if(raw.length>524288) throw Error("TRIAD_FILE_TOO_LARGE:"+path);
  return new TextDecoder("utf-8",{fatal:true}).decode(raw);
}
function treeFiles(ref) {
  const lines=git(["ls-tree","-r","-z",ref,"--",...SCOPE],{binary:true})
    .toString("utf8").split("\0").filter(Boolean);
  const entries=[];
  for(const line of lines) {
    const tab=line.indexOf("\t");
    if(tab<0) throw Error("INVALID_TREE_ROW");
    const [mode,type,sha]=line.slice(0,tab).split(" ");
    const path=line.slice(tab+1);
    entries.push({mode,type,sha,path});
  }
  return entries;
}
function loadSources(entries) {
  const chosen=entries.filter(e=>SOURCE.test(e.path)&&!TEST.test(e.path));
  if(!chosen.length||chosen.length>5000||chosen.some(e=>e.type!=="blob"||e.mode!=="100644"))
    throw Error("TARGET_SOURCE_INVENTORY_INVALID");
  const input=Buffer.from(chosen.map(x=>x.sha).join("\n")+"\n");
  const bytes=git(["cat-file","--batch"],{binary:true,input});
  if(bytes.length>90*1024*1024) throw Error("TARGET_SOURCE_BATCH_TOO_LARGE");
  let offset=0;
  const decode=new TextDecoder("utf-8",{fatal:true});
  const sources=[];
  for(const e of chosen) {
    const nl=bytes.indexOf(10,offset);
    if(nl<0) throw Error("INVALID_BATCH_HEADER");
    const [sha,type,length]=bytes.subarray(offset,nl).toString("ascii").split(" ");
    const size=Number(length);
    if(sha!==e.sha||type!=="blob"||!Number.isSafeInteger(size)||
       size<0||size>2097152||nl+size+1>=bytes.length||
       bytes[nl+size+1]!==10) throw Error("INVALID_BATCH_PAYLOAD:"+e.path);
    sources.push({path:e.path,content:decode.decode(bytes.subarray(nl+1,nl+size+1))});
    offset=nl+size+2;
  }
  if(offset!==bytes.length) throw Error("INVALID_BATCH_TRAILER");
  return sources;
}
function protectedPath(path) {
  return PROTECTED_PATHS.some(prefix=>path.startsWith(prefix));
}
const checksForModule=path=>{
  const gates=new Set(["typescript_imports_build","module_contract_review"]);
  if(/^app\/app\/|^components\//.test(path)) {
    gates.add("client_server_boundary");gates.add("ui_rbac_visibility");
  }
  if(/^(?:lib\/channels\/|lib\/waha\/|lib\/messaging\/)/.test(path)) {
    gates.add("message_sender_identity");gates.add("idempotency_negative");
  }
  if(/^(?:lib\/contacts\/|lib\/leads\/|lib\/templates\/)/.test(path)) {
    gates.add("cross_tenant_rls_negative");gates.add("lgpd_contact_integrity");
  }
  if(/^(?:lib\/mcp\/|lib\/inbox\/)/.test(path)) {
    gates.add("mcp_tools_readonly_authz");gates.add("backend_permission_negative");
  }
  if(/^(?:lib\/financeiro\/|lib\/agenda\/)/.test(path)) {
    gates.add("finance_or_booking_regression");gates.add("organization_id_filter");
  }
  if(/^lib\/system\//.test(path)) gates.add("runtime_identity_isolation");
  if(/^lib\/planilha\//.test(path)) gates.add("file_input_validation_limits");
  return [...gates].sort();
};
export function analyzeTargetSources({sources,config,resourcePaths=[],plan}) {
  if(!plan||!Array.isArray(plan.files)||plan.files.length!==787)
    throw Error("INVALID_OFFICIAL_PLAN");
  const newFiles=plan.files.filter(f=>f.candidate_analysis?.fork_graph_absence_reason===
    "new_upstream_source_not_in_fork");
  if(newFiles.length!==45) throw Error("UNEXPECTED_NEW_PRODUCTION_COUNT:"+newFiles.length);
  const known=new Set(sources.map(s=>s.path));
  if(newFiles.some(f=>!known.has(f.path))) throw Error("TARGET_NEW_SOURCE_MISSING");
  const graph=dependencyGraph(sources,config,resourcePaths);
  const outgoing=new Map();
  for(const [dependency,consumers] of graph.reverse)
    for(const consumer of consumers) {
      const existing=outgoing.get(consumer)??new Set();
      existing.add(dependency);outgoing.set(consumer,existing);
    }
  const transitive=transitiveProtectedDependents(newFiles.map(x=>x.path),sources,graph);
  const changed=new Set(plan.files.map(f=>f.path));
  const review12=plan.files.filter(f=>f.candidate_analysis?.review_bucket===
    "potential_compatibility_manual_review");
  if(review12.length!==12) throw Error("UNEXPECTED_REVIEW12_COUNT");
  const hardUnsafe=plan.files.filter(f=>f.preliminary_status!=="safe_to_prepare"&&
    !["already_integrated","unchanged","safe_to_prepare"].includes(f.status))
    .map(f=>f.path);
  const targetNearest=nearestUnsafeRiskEvidence(review12.map(f=>f.path),hardUnsafe,graph);
  const distanceComparison=review12.map(f=>{
    const forkRisk=f.candidate_analysis.dependency_graph?.nearest_hard_risk??null;
    const targetRisk=targetNearest.get(f.path)??null;
    return {path:f.path,approval:"none",
      fork_distance:forkRisk?.nearest_distance??null,
      fork_first_hop_directions:forkRisk?.first_hop_directions??[],
      target_distance:targetRisk?.nearest_distance??null,
      target_first_hop_directions:targetRisk?.first_hop_directions??[],
      target_hard_risk_examples:targetRisk?.nearest_risk_examples??[],
      comparable_statically:graph.complete,
      note:"Bidirectional shortest import chain, not an execution or data-flow proof"};
  });
  const modules=newFiles.map(f=>{
    const path=f.path;
    const imports=[...(outgoing.get(path)??[])].sort();
    const importedBy=[...(graph.reverse.get(path)??[])].sort();
    const directProtected=importedBy.filter(protectedPath);
    const transitiveProtected=protectedConsumers(path,transitive);
    const unresolved=graph.unresolved.filter(x=>x.path===path);
    return {
      path,original_status:f.status,approval:"none",
      source_in_target:true,source_in_fork:false,
      direct_import_count:imports.length,
      direct_imports:imports,
      imports_changed_target_files:imports.filter(x=>changed.has(x)),
      imports_protected:imports.filter(protectedPath),
      direct_consumer_count:importedBy.length,
      direct_consumers:importedBy,
      direct_protected_consumers:directProtected,
      transitive_protected_consumer_count:transitiveProtected.length,
      transitive_protected_consumers_sample:transitiveProtected.slice(0,25),
      target_ast_unresolved:unresolved,
      existing_signals:f.signals,
      required_checks:checksForModule(path)
    };
  });
  return {
    phase:"target_graph_diagnostic_only",target_graph:{
      sources:sources.length,module_edges:graph.edge_count,
      complete:graph.complete,unresolved_count:graph.unresolved.length,
      unresolved_reasons:[...new Set(graph.unresolved.map(x=>x.reason))].sort(),
      unresolved_examples:graph.unresolved.slice(0,30)
    },
    summary:{
      new_production_modules:modules.length,
      directly_imported_by_protected:modules.filter(x=>x.direct_protected_consumers.length).length,
      transitively_imported_by_protected:modules.filter(x=>x.transitive_protected_consumer_count>0).length,
      modules_importing_protected:modules.filter(x=>x.imports_protected.length).length,
      modules_with_target_unresolved_imports:modules.filter(x=>x.target_ast_unresolved.length).length,
      modules_without_static_consumers:modules.filter(x=>!x.direct_consumers.length).length
    },
    modules,distance_comparison_12:distanceComparison
  };
}
export function examineTriad({plan,base,target,fork}) {
  const candidates=plan.files.filter(f=>f.candidate_analysis?.review_bucket===
    "potential_compatibility_manual_review");
  if(candidates.length!==12) throw Error("UNEXPECTED_MANUAL_REVIEW_COUNT:"+candidates.length);
  const results=candidates.map(f=>{
    const path=f.path;
    const before=oid(base,path),after=oid(target,path),local=oid(fork,path);
    if(local!==before||before===after) throw Error("TRIAD_PROVENANCE_MISMATCH:"+path);
    const diff=git(["diff","--no-ext-diff","--unified=3",base,target,"--",path]);
    const added=diff.split("\n").filter(x=>x.startsWith("+")&&!x.startsWith("+++")).length;
    const removed=diff.split("\n").filter(x=>x.startsWith("-")&&!x.startsWith("---")).length;
    const evidence=f.candidate_analysis;
    return {path,oid:{base:before,target:after,fork:local},
      fork_same_as_base:true,
      diff,added_lines:added,removed_lines:removed,
      actual_status:f.status,approval:"none",
      risk_signals:f.signals,suggested_checks:f.suggested_checks,
      ast_precision:evidence.ast_precision,
      nearest_hard_risk:evidence.dependency_graph?.nearest_hard_risk??null,
      review_bucket:evidence.review_bucket,
      note:"Requires runtime/contract tests and human decision; not safe_to_prepare"
    };
  });
  return {phase:"triadic_12_source_diffs",count:results.length,approval:"none",candidates:results};
}
export function buildGate5Report({base,target,fork,plan}) {
  for(const x of [base,target,fork]) if(!SHA.test(x)) throw Error("PIN_REQUIRED");
  if(!plan?.refs||plan.refs.base!==base||plan.refs.target!==target||plan.refs.fork!==fork)
    throw Error("REF_MISMATCH");
  if(plan.mode!=="read_only"||plan.gate!=="manual_review_required"||
     (plan.totals.safe_to_prepare??0)!==0) throw Error("NOT_FAIL_CLOSED");
  for(const ref of [base,target,fork]) git(["rev-parse","--verify",ref+"^{commit}"]);
  const entries=treeFiles(target);
  const resources=entries.filter(e=>e.type==="blob"&&e.mode==="100644"&&
    /\.(?:css|scss|sass|json)$/.test(e.path)).map(e=>e.path);
  const sources=loadSources(entries);
  const targetGraph=analyzeTargetSources({
    sources,config:textOf(target,"tsconfig.json"),resourcePaths:resources,plan
  });
  const triad=examineTriad({plan,base,target,fork});
  return {
    schema_version:1,tool:"elus-upstream-gate5-evidence",mode:"read_only",
    authorization:"none",refs:{base,target,fork},
    target_graph:targetGraph,triad12:triad,
    disclaimer:"Static import graph plus source diffs only. Not a runtime equivalence or authorization gate. No preparation."
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const args=process.argv.slice(2);
    if(args.length!==8||args[0]!=="--base"||args[2]!=="--target"||
       args[4]!=="--fork"||args[6]!=="--plan") throw Error("USAGE: --base SHA --target SHA --fork SHA --plan FILE");
    const plan=JSON.parse(readFileSync(args[7],"utf8"));
    const report=buildGate5Report({base:args[1],target:args[3],fork:args[5],plan});
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
  } catch(error) {
    process.stderr.write("GATE5_NO_GO:"+String(error.message).slice(0,180)+"\n");
    process.exitCode=3;
  }
}