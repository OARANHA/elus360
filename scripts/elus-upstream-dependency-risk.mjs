/**
 * ELUS Upstream Sync — inventario estatico de dependencias diretas e superfícies IA.
 * Analise conservadora: nao executa codigo nem prova fluxo de dados.
 */
import { posix } from "node:path";
const SCRIPT = /\.(?:[cm]?js|jsx|tsx?)$/;
const PROTECTED = [
  "lib/elus360/", "components/elus360/", "lib/auth/", "lib/supabase/",
  "lib/ai/", "lib/agent-engine/", "lib/api/", "lib/instalacao/",
  "app/api/v1/ai/", "app/api/v1/admin/tenants/", "app/actions/onboarding/",
  "app/admin/", "app/app/ai/", "app/onboarding/", "workers/",
  "app/(public)/login/",
];
export const PROTECTED_PATHS = PROTECTED;

export function sourceModule(specifier, importer) {
  if (!specifier || !SCRIPT.test(importer)) return null;
  let path;
  if (specifier.startsWith("@/")) path = specifier.slice(2);
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    path = posix.normalize(posix.join(posix.dirname(importer),specifier));
  } else return null;
  if (path === ".." || path.startsWith("../") || path.startsWith("/") || path.includes("\0")) return null;
  return path.replace(/\.(?:[cm]?js|jsx|tsx?)$/, "").replace(/\/index$/, "");
}
export function importPaths(content, importer) {
  if (typeof content !== "string") return [];
  const results = [];
  const reg = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = reg.exec(content)) !== null) {
    const resolved = sourceModule(match[1] || match[2],importer);
    if (resolved) results.push(resolved);
  }
  return [...new Set(results)];
}
function canonical(path) {
  return path.replace(/\.(?:[cm]?js|jsx|tsx?)$/, "").replace(/\/index$/, "");
}
export function directProtectedDependents(changedPaths, sources) {
  const changed = new Set(changedPaths.map(canonical));
  const found = new Map();
  for(const {path, content} of sources) {
    if (!PROTECTED.some(p=>path.startsWith(p))) continue;
    const imports = importPaths(content,path);
    for(const spec of imports) {
      if (changed.has(spec)) {
        const consumers=found.get(spec) ?? [];
        consumers.push(path);
        found.set(spec,consumers);
      }
    }
  }
  return new Map([...found].map(([name,paths])=>[name,[...new Set(paths)].sort()]));
}
/**
 * Busca reversa sobre grafo de imports estaticos. Retorna consumidores
 * protegidos alcancaveis por caminho direto ou transitive, sem loops em ciclos.
 * Uma aresta "A importa B" significa que A depende de B.
 */
export function transitiveProtectedDependents(changedPaths, sources) {
  const byImported = new Map();
  for (const {path,content} of sources) {
    for (const imported of importPaths(content,path)) {
      const consumers=byImported.get(imported) ?? new Set();
      consumers.add(path);
      byImported.set(imported,consumers);
    }
  }
  const result=new Map();
  for (const path of changedPaths) {
    const start=canonical(path);
    const seen=new Set([start]);
    const queue=[start];
    const protectedReachable=new Set();
    while(queue.length) {
      const current=queue.shift();
      for(const consumer of byImported.get(current) ?? []) {
        if(PROTECTED.some(prefix=>consumer.startsWith(prefix))) protectedReachable.add(consumer);
        const id=canonical(consumer);
        if(!seen.has(id)) {seen.add(id);queue.push(id);}
      }
    }
    if(protectedReachable.size) result.set(start,[...protectedReachable].sort());
  }
  return result;
}
export function protectedConsumers(path,dependents) {
  return dependents.get(canonical(path)) ?? [];
}
const SURFACE = /^(?:app\/api\/v1\/ai\/.*\/route\.ts|app\/api\/v1\/ai\/route\.ts|app\/api\/v1\/admin\/tenants\/.*\/route\.ts|app\/actions\/onboarding\/[^/]+\.ts)$/;
export function uninventoriedAiSurfaces(paths, inventory) {
  const listed = new Set(Array.isArray(inventory?.surfaces) ? inventory.surfaces.map(v=>v.path).filter(v=>typeof v==="string") : []);
  return paths.filter(path=>SURFACE.test(path) && !listed.has(path));
}
