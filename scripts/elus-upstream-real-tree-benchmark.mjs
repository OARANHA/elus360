#!/usr/bin/env node
/** Read-only benchmark on the checked-out Git tree. No network, SQL or writes. */
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dependencyGraph, transitiveProtectedDependents } from "./elus-upstream-dependency-risk.mjs";
const started=performance.now();
const memoryStart=process.memoryUsage();
const names=execFileSync("git",["ls-files","-z"],{maxBuffer:32*1024*1024})
 .toString("utf8").split("\0").filter(path=>(/^(?:app|lib|components|workers|hooks|types|curso)\//.test(path)||/^(?:proxy|instrumentation|instrumentation-client)\.ts$/.test(path))&&/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)&&!/\.test\.[jt]sx?$/.test(path));
const count=names.length;
if(!count || count>5000) {
  console.log(JSON.stringify({benchmark:"elus-real-tree-ast",head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sources:count,complete:false,reason:count?"source_limit_exceeded":"empty_source_inventory",duration_ms:Math.round(performance.now()-started)}));
  process.exit(0);
}
const sources=[];
for(const path of names) {
  if(!lstatSync(path).isFile()) {console.log(JSON.stringify({benchmark:"elus-real-tree-ast",sources:count,complete:false,reason:"nonregular_tracked_source",duration_ms:Math.round(performance.now()-started)}));process.exit(0);}
  const bytes=readFileSync(path);
  if(bytes.length>2097152) {console.log(JSON.stringify({benchmark:"elus-real-tree-ast",sources:count,complete:false,reason:"source_too_large",duration_ms:Math.round(performance.now()-started)}));process.exit(0);}
  sources.push({path,content:new TextDecoder("utf-8",{fatal:true}).decode(bytes)});
}
const config=readFileSync("tsconfig.json","utf8");
const graph=dependencyGraph(sources,config);
const reasonCounts={};
for(const item of graph.unresolved) reasonCounts[item.reason]=(reasonCounts[item.reason]??0)+1;
const unresolvedSamples={};
for(const item of graph.unresolved){if(!item.path) continue;const samples=unresolvedSamples[item.reason]??[];if(samples.length<5)samples.push(item.path);unresolvedSamples[item.reason]=samples;}
const unresolvedBySpecifierClass={};
const classify=specifier=>{
  if(typeof specifier!=="string") return "parser_or_content";
  if(/\\.(?:css|scss|sass|svg|png|jpe?g|webp|gif|woff2?|json)$/.test(specifier)) return "asset_or_json";
  if(specifier.startsWith("@/")) return "root_alias";
  if(specifier.startsWith("./")||specifier.startsWith("../")) return "relative";
  if(specifier.startsWith("#")||specifier.startsWith("~/")) return "custom_alias";
  return "package_or_baseurl";
};
for(const issue of graph.unresolved){const category=classify(issue.specifier);unresolvedBySpecifierClass[category]=(unresolvedBySpecifierClass[category]??0)+1;}
const changed=names.filter(p=>p.startsWith("components/")).slice(0,100);
const matched=transitiveProtectedDependents(changed,sources,graph);
const historicalBaseline=1220;
const unresolvedReduction=historicalBaseline-graph.unresolved.length;
console.log(JSON.stringify({benchmark:"elus-real-tree-ast",head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sources:count,candidate_sample:changed.length,protected_dependents:matched.size,complete:graph.complete,unresolved_count:graph.unresolved.length,historical_baseline_unresolved:historicalBaseline,unresolved_reduction:unresolvedReduction,unresolved_counts:reasonCounts,unresolved_specifier_categories:unresolvedBySpecifierClass,unresolved_example_paths:unresolvedSamples,memory_rss_mib:Number((process.memoryUsage().rss/1048576).toFixed(1)),memory_heap_mib:Number((process.memoryUsage().heapUsed/1048576).toFixed(1)),memory_heap_delta_mib:Number(((process.memoryUsage().heapUsed-memoryStart.heapUsed)/1048576).toFixed(1)),unresolved_reasons:[...new Set(graph.unresolved.map(x=>x.reason))].sort(),duration_ms:Math.round(performance.now()-started)}));

if(process.argv.includes("--require-reduction") && unresolvedReduction<=0) {console.error("BENCHMARK_NO_UNRESOLVED_REDUCTION");process.exitCode=2;}
