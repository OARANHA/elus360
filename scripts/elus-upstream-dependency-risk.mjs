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
  "lib/rbac/","lib/permissions/","lib/audit/","lib/mcp/",
  "app/api/","app/actions/","app/auth/","components/auth/","components/ai/"
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
    if(ts.isImportTypeNode(node)) {
      if(ts.isLiteralTypeNode(node.argument)) collect(node.argument.literal);
      else unresolved.push("computed_import_type");
    }
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require"))) collect(node.arguments[0]);
    ts.forEachChild(node,visit);
  };
  visit(tree);
  return {specifiers,unresolved};
}
/**
 * A changed file can introduce a NEW edge to a protected contract.
 * Inspect the target as well as the fork reverse graph.
 */
function mappedProtectedImport(specifier,rawConfig) {
  if(typeof rawConfig!=="string") return false;
  const {options}=compilerOptionsFromConfig(rawConfig);
  if(!options) return false;
  if(PROTECTED.some(prefix=>specifier.startsWith(prefix))) return true;
  for(const [alias,targets] of Object.entries(options.paths??{})) {
    const star=alias.indexOf("*");
    let captured="";
    if(star<0) {if(specifier!==alias) continue;}
    else {
      const before=alias.slice(0,star),after=alias.slice(star+1);
      if(!specifier.startsWith(before)||!specifier.endsWith(after)) continue;
      captured=specifier.slice(before.length,specifier.length-after.length);
    }
    for(const target of targets) {
      const normalized=posix.normalize(target.replace("*",captured));
      const mapped=normalized.startsWith("./") ? normalized.slice(2) : normalized;
      if(PROTECTED.some(prefix=>mapped.startsWith(prefix))) return true;
    }
  }
  return false;
}
export function changedModuleSignals(path,before,after,rawConfig=null) {
  if(!SOURCE.test(path)) return [];
  const signals=new Set();
  for(const content of [before,after]) {
    const ast=astImports(content,path);
    if(ast.unresolved.length) signals.add("dependency_analysis_incomplete");
    for(const specifier of ast.specifiers) {
      if(mappedProtectedImport(specifier,rawConfig)) signals.add("protected_module_import_change");
      if(specifier.startsWith("~/")||specifier.startsWith("#")) {
        signals.add("dependency_analysis_incomplete");continue;
      }
      const resolved=sourceModule(specifier,path);
      if(resolved && isProtected(resolved+"/")) signals.add("protected_module_import_change");
      if(resolved && PROTECTED.some(prefix=>resolved.startsWith(prefix))) signals.add("protected_module_import_change");
      if(isLocal(specifier) && !resolved) signals.add("dependency_analysis_incomplete");
    }
  }
  return [...signals];
}
export function importPaths(content,path) {
  const data=astImports(content,path);
  return [...new Set(data.specifiers.map(s=>sourceModule(s,path)).filter(Boolean))];
}
function resolveLocal(specifier,importer,available) {
  const path=sourceModule(specifier,importer);
  if(!path) return {path:null,reason:"unsupported_local_specifier"};
  const normalized=specifier.replace(/\\.(?:[cm]?[jt]s|[jt]sx)$/,"");
  const isExplicit=normalized!==specifier;
  // Module aliases are supported only when mapped by the documented @/* root.
  const exact=available.has(path)?[path]:[];
  const file=EXTS.map(ext=>path+ext).filter(candidate=>available.has(candidate));
  const directory=EXTS.map(ext=>path+"/index"+ext).filter(candidate=>available.has(candidate));
  const matches=[...exact,...file,...directory];
  if(!matches.length) return {path:null,reason:"unresolved_local_module"};
  // Multiple valid candidates are ambiguous under unknown TS resolution options.
  // Do not pick a file or index arbitrarily.
  if(matches.length>1) return {path:null,reason:"ambiguous_local_module"};
  if(isExplicit && !EXTS.some(ext=>specifier.endsWith(ext))) return {path:null,reason:"unsupported_local_extension"};
  return {path:matches[0],reason:null};
}
// TypeScript resolution is evaluated against the pinned Git inventory, never the local checkout.
export function compilerOptionsFromConfig(raw) {
  if(!ts || typeof raw!=="string") return {options:null,reason:"typescript_compiler_missing_or_tsconfig_unreadable"};
  const parsed=ts.parseConfigFileTextToJson("tsconfig.json",raw);
  if(parsed.error || !parsed.config?.compilerOptions) return {options:null,reason:"invalid_tsconfig"};
  const config=parsed.config.compilerOptions;
  if(config.extends || parsed.config.extends) return {options:null,reason:"unsupported_tsconfig_extends"};
  const converted=ts.convertCompilerOptionsFromJson(config,".");
  if(converted.errors.length) return {options:null,reason:"invalid_tsconfig_options"};
  const options={...converted.options,baseUrl:converted.options.baseUrl??".",moduleResolution:converted.options.moduleResolution??ts.ModuleResolutionKind.Bundler};
  return {options,reason:null};
}
function normalizedFile(path) {const normalized=posix.normalize(path.split("\\\\").join("/"));return normalized.startsWith("./")?normalized.slice(2):normalized;}
function configuredResolver(sources,rawConfig,resourcePaths=[]) {
  const config=compilerOptionsFromConfig(rawConfig);
  const sourceByPath=new Map(sources.map(s=>[normalizedFile(s.path),s.content]));
  const available=new Set([...sourceByPath.keys(),...resourcePaths.map(normalizedFile)]);
  const resources=new Set(resourcePaths.map(normalizedFile));
  const cache=config.options?ts.createModuleResolutionCache(".",path=>path,config.options):null;
  const dirs=new Set(["."]);
  for(const path of available) {let dir=posix.dirname(path);while(dir!=="."&&!dirs.has(dir)){dirs.add(dir);dir=posix.dirname(dir);}}
  const host={
    fileExists:path=>available.has(normalizedFile(path)),
    directoryExists:path=>dirs.has(normalizedFile(path))||path===".",
    readFile:path=>sourceByPath.get(normalizedFile(path)),
    getCurrentDirectory:()=>".",
    realpath:path=>path,
    getDirectories:()=>[]
  };
  const aliases=Object.keys(config.options?.paths??{});
  const matchesAlias=specifier=>aliases.some(alias=>{
    const star=alias.indexOf("*");
    return star<0 ? specifier===alias : specifier.startsWith(alias.slice(0,star))&&specifier.endsWith(alias.slice(star+1));
  });
  return {config,resolve(specifier,importer){
    const isRelative=specifier.startsWith("./")||specifier.startsWith("../");
    const local=isRelative||matchesAlias(specifier)||isLocal(specifier);
    if(!config.options) return {local:true,path:null,reason:config.reason};
    const result=ts.resolveModuleName(specifier,importer,config.options,host,cache);
    const resolved=normalizedFile(result.resolvedModule?.resolvedFileName??"");
    if(resolved && sourceByPath.has(resolved)) return {local:true,path:resolved,reason:null};
    if(resolved && resources.has(resolved)) return {local:true,path:null,resource:true,reason:null};
    // CSS and JSON are non-executable leaves: only an exact tracked path is accepted.
    // Missing assets must still block, never silently suppress the import.
    if(isRelative && /\.(?:css|scss|sass|json)$/.test(specifier)) {
      const leaf=normalizedFile(posix.join(posix.dirname(importer),specifier));
      if(resources.has(leaf)) return {local:true,path:null,resource:true,reason:null};
    }
    // A configured alias or relative import must never fall back to a package.
    if(local) return {local:true,path:null,reason:"unresolved_configured_module"};
    // baseUrl can resolve unprefixed local modules. If not found, treat as external.
    return {local:false,path:null,reason:null};
  }};
}
/** Missing local module, syntax error or computed import blocks automatic preparation. */
export function dependencyGraph(sources,rawConfig=null,resourcePaths=[]) {
  const available=new Set(sources.map(s=>s.path)),reverse=new Map(),unresolved=[];
  let verified_resources=0;
  const configured=rawConfig===null?null:configuredResolver(sources,rawConfig,resourcePaths);
  if(configured?.config.reason) unresolved.push({reason:configured.config.reason});
  if(!ts) unresolved.push({reason:"typescript_compiler_missing"});
  for(const {path,content} of sources){
    const ast=astImports(content,path);
    for(const reason of ast.unresolved) unresolved.push({path,reason});
    for(const specifier of ast.specifiers) {
      if(!configured && !isLocal(specifier)) continue;
      const resolved=configured?configured.resolve(specifier,path):resolveLocal(specifier,path,available);
      if(configured && !resolved.local) continue;
      if(resolved.resource){verified_resources++;continue;}
      if(!resolved.path){unresolved.push({path,reason:resolved.reason,specifier});continue;}
      const consumers=reverse.get(resolved.path)??new Set();consumers.add(path);reverse.set(resolved.path,consumers);
    }
  }
  return {reverse,unresolved,complete:unresolved.length===0,scanned:sources.length,verified_resources,edge_count:[...reverse.values()].reduce((n,users)=>n+users.size,0)};
}
export function transitiveProtectedDependents(changedPaths,sources,graph=dependencyGraph(sources)) {
  const available=new Set(sources.map(s=>s.path)),result=new Map();
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
/** Conservative batch coupling: any unsafe changed source connected by a static
 * dependency chain to a candidate requires review, in either import direction.
 * This never establishes safety; unresolved imports are blocked separately.
 */
export function changedRiskCouplings(candidatePaths,unsafePaths,graph) {
  const reverse=graph.reverse,adjacent=new Map();
  for(const [dependency,consumers] of reverse) for(const consumer of consumers){
    const a=adjacent.get(dependency)??new Set();a.add(consumer);adjacent.set(dependency,a);
    const b=adjacent.get(consumer)??new Set();b.add(dependency);adjacent.set(consumer,b);
  }
  const risk=new Set(unsafePaths);
  const results=new Map();
  for(const candidate of candidatePaths){
    const visited=new Set([candidate]),queue=[candidate],found=new Set();
    for(let i=0;i<queue.length;i++) {
      const node=queue[i];
      if(risk.has(node)&&node!==candidate) found.add(node);
      for(const next of adjacent.get(node)??[]) if(!visited.has(next)) {
        visited.add(next);queue.push(next);
      }
    }
    if(found.size) results.set(candidate,[...found].sort());
  }
  return results;
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
