/** Static TypeScript AST dependency analyzer. Never executes examined source. */
import { createRequire } from "node:module";
import { posix } from "node:path";
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = null; }
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const EXTS = [".ts",".tsx",".mts",".cts",".js",".jsx",".mjs",".cjs"];
const PROTECTED = [
  "lib/elus360/","components/elus360/","lib/auth/","lib/supabase/",
  "lib/ai/","lib/agent-engine/","lib/api/","lib/instalacao/",
  "app/api/v1/ai/","app/api/v1/admin/tenants/","app/actions/onboarding/",
  "app/admin/","app/app/ai/","app/onboarding/","workers/","app/(public)/login/",
  "lib/rbac/","lib/permissions/","lib/audit/","app/api/v1/auth/"
];
export const PROTECTED_PATHS = PROTECTED;
const isProtected = path=>PROTECTED.some(prefix=>path.startsWith(prefix));
export function canonical(path) {return path.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/,"").replace(/\/index$/,"");}
export function sourceModule(specifier,importer) {
  if(!specifier || !SOURCE.test(importer)) return null;
  let path;
  if(specifier.startsWith("@/")) path=specifier.slice(2);
  else if(specifier.startsWith("./")||specifier.startsWith("../"))
    path=posix.normalize(posix.join(posix.dirname(importer),specifier));
  else return null;
  if(path===".."||path.startsWith("../")||path.startsWith("/")||path.includes("\0")) return null;
  return canonical(path);
}
const isLocal = s=>s.startsWith("@/")||s.startsWith("./")||s.startsWith("../")||s.startsWith("#")||s.startsWith("~/");
function astImports(content,path) {
  if(!ts) return {specifiers:[],unresolved:["typescript_compiler_missing"]};
  if(typeof content!=="string"||content.includes("\0")) return {specifiers:[],unresolved:["invalid_content"]};
  const kind=/\.tsx$/.test(path)?ts.ScriptKind.TSX:/\.jsx$/.test(path)?ts.ScriptKind.JSX:/\.[mc]?js$/.test(path)?ts.ScriptKind.JS:ts.ScriptKind.TS;
  const tree=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,kind);
  if(tree.parseDiagnostics.length) return {specifiers:[],unresolved:["typescript_parse_failed"]};
  const specifiers=[],unresolved=[];
  const collect=expr=>{if(!expr)return;if(ts.isStringLiteralLike(expr))specifiers.push(expr.text);else unresolved.push("computed_module_specifier");};
  const visit=node=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) collect(node.moduleSpecifier);
    if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)) collect(node.moduleReference.expression);
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require"))) collect(node.arguments[0]);
    ts.forEachChild(node,visit);
  };
  visit(tree);
  return {specifiers,unresolved};
}
export function importPaths(content,path) {
  const data=astImports(content,path);
  return [...new Set(data.specifiers.map(s=>sourceModule(s,path)).filter(Boolean))];
}
function resolveLocal(specifier,importer,available) {
  const path=sourceModule(specifier,importer);
  if(!path) return null;
  const choices=[path,...EXTS.map(ext=>path+ext),...EXTS.map(ext=>path+"/index"+ext)];
  for(const candidate of choices) if(available.has(candidate)) return candidate;
  return null;
}
/** Missing local module, syntax error or computed import blocks automatic preparation. */
export function dependencyGraph(sources) {
  const available=new Set(sources.map(s=>s.path)),reverse=new Map(),unresolved=[];
  if(!ts) unresolved.push({reason:"typescript_compiler_missing"});
  for(const {path,content} of sources){
    const ast=astImports(content,path);
    for(const reason of ast.unresolved) unresolved.push({path,reason});
    for(const specifier of ast.specifiers) {
      if(!isLocal(specifier)) continue;
      const imported=resolveLocal(specifier,path,available);
      if(!imported){unresolved.push({path,reason:"unresolved_local_module"});continue;}
      const consumers=reverse.get(imported)??new Set();consumers.add(path);reverse.set(imported,consumers);
    }
  }
  return {reverse,unresolved,complete:unresolved.length===0,scanned:sources.length};
}
export function transitiveProtectedDependents(changedPaths,sources) {
  const graph=dependencyGraph(sources),available=new Set(sources.map(s=>s.path)),result=new Map();
  for(const changed of changedPaths) {
    const start=available.has(changed)?changed:[changed,...EXTS.map(ext=>canonical(changed)+ext)].find(path=>available.has(path));
    if(!start) continue;
    const seen=new Set([start]),queue=[start],protectedReachable=new Set();
    for(let i=0;i<queue.length;i++) for(const consumer of graph.reverse.get(queue[i])??[]) {
      if(isProtected(consumer)) protectedReachable.add(consumer);
      if(!seen.has(consumer)){seen.add(consumer);queue.push(consumer);}
    }
    if(protectedReachable.size) result.set(canonical(changed),[...protectedReachable].sort());
  }
  return result;
}
export function protectedConsumers(path,dependents) {return dependents.get(canonical(path))??[];}
export function directProtectedDependents(changedPaths,sources) {
  const graph=dependencyGraph(sources),result=new Map();
  for(const changed of changedPaths) {
    const matches=[...graph.reverse.entries()].filter(([path])=>canonical(path)===canonical(changed));
    const consumers=new Set(matches.flatMap(([,paths])=>[...paths].filter(isProtected)));
    if(consumers.size) result.set(canonical(changed),[...consumers].sort());
  }
  return result;
}
const SURFACE=/^(?:app\/api\/v1\/ai\/(?:.*\/)?route\.ts|app\/api\/v1\/admin\/tenants\/(?:.*\/)?route\.ts|app\/actions\/onboarding\/[^/]+\.ts)$/;
export function uninventoriedAiSurfaces(paths,inventory) {
  const listed=new Set(Array.isArray(inventory?.surfaces)?inventory.surfaces.map(s=>s.path).filter(p=>typeof p==="string"):[]);
  return paths.filter(path=>SURFACE.test(path)&&!listed.has(path));
}
