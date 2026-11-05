#!/usr/bin/env node
/** Read-only benchmark on the checked-out Git tree. No network, SQL or writes. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dependencyGraph, transitiveProtectedDependents } from "./elus-upstream-dependency-risk.mjs";
const started=performance.now();
const names=execFileSync("git",["ls-files","-z"],{maxBuffer:32*1024*1024})
 .toString("utf8").split("\0").filter(path=>/^(?:app|lib|components|workers)\//.test(path)&&/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path));
const count=names.length;
if(!count || count>2400) {
  console.log(JSON.stringify({benchmark:"elus-real-tree-ast",head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sources:count,complete:false,reason:count?"source_limit_exceeded":"empty_source_inventory",duration_ms:Math.round(performance.now()-started)}));
  process.exit(0);
}
const sources=[];
for(const path of names) {
  const bytes=readFileSync(path);
  if(bytes.length>524288) {console.log(JSON.stringify({benchmark:"elus-real-tree-ast",sources:count,complete:false,reason:"source_too_large",duration_ms:Math.round(performance.now()-started)}));process.exit(0);}
  sources.push({path,content:new TextDecoder("utf-8",{fatal:true}).decode(bytes)});
}
const config=readFileSync("tsconfig.json","utf8");
const graph=dependencyGraph(sources,config);
const changed=names.filter(p=>p.startsWith("components/")).slice(0,100);
const matched=transitiveProtectedDependents(changed,sources,graph);
console.log(JSON.stringify({benchmark:"elus-real-tree-ast",head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sources:count,candidate_sample:changed.length,protected_dependents:matched.size,complete:graph.complete,unresolved_count:graph.unresolved.length,unresolved_reasons:[...new Set(graph.unresolved.map(x=>x.reason))].sort(),duration_ms:Math.round(performance.now()-started)}));
