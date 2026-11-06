/**
 * Gate 10 — inventário lexical somente leitura. NUNCA é prova de autorização.
 * Executar em um checkout integral: node scripts/elus-upstream-gate10-inventory.mjs
 * Opcional: --output <arquivo.json> para artefato de CI.
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = [
  "app", "lib", "workers", "scripts",
  "supabase/migrations", "supabase/baseline.sql",
];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".sql"]);
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
const RULES = [
  ["rpc_emit_event", /\.rpc\s*\(\s*["'`]emit_event["'`]/g],
  ["sql_emit_event", /\b(?:public\.)?emit_event\s*\(/g],
  ["sql_fn_log_event", /\b(?:public\.)?fn_log_event\s*\(/g],
  ["direct_event_log_insert", /\b(?:insert\s+into\s+(?:public\.)?event_log|\.from\s*\(\s*["']event_log["']\s*\)\s*\.insert\s*\()/gi],
  ["event_log_trigger", /\bfn_emit_event_on_lead_change\b/g],
];

function walk(root, dir, result) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(root, join(dir, entry.name), result);
    } else if (entry.isFile()) {
      const path = join(dir, entry.name);
      if (!EXT.has(extname(path)) || /\.(test|spec)\.[jt]sx?$/.test(path)) continue;
      result.push(path);
    }
  }
}
function lineNumber(text, pos) {
  let count = 1;
  for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}
export function scanRepository(root) {
  const files = [];
  for (const target of TARGETS) {
    const path = join(root, target);
    if (!existsSync(path)) continue;
    if (extname(path) === ".sql") files.push(path);
    else walk(root, path, files);
  }
  const matches = [];
  for (const file of files.sort()) {
    const source = readFileSync(file, "utf8");
    const path = relative(root, file).replaceAll("\\", "/");
    for (const [kind, expression] of RULES) {
      expression.lastIndex = 0;
      let m;
      while ((m = expression.exec(source)) !== null) {
        matches.push({ path, line: lineNumber(source, m.index), kind });
      }
    }
  }
  matches.sort((a, b) => a.path.localeCompare(b.path) ||
    a.line - b.line || a.kind.localeCompare(b.kind));
  const counts = Object.fromEntries(RULES.map(([key]) =>
    [key, matches.filter(m => m.kind === key).length]));
  return {
    scope: TARGETS,
    method: "lexical_candidates_not_verified_call_graph",
    filesScanned: files.length,
    matchCount: matches.length,
    distinctPaths: new Set(matches.map(m => m.path)).size,
    counts,
    matches,
    limitations: [
      "includes comments and SQL historical definitions",
      "dynamic/reflected calls, aliases and external services may be missed",
      "does not prove authorization, entity ownership, effects or code reachability",
    ],
  };
}
const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  const root = resolve(dirname(here), "..");
  const report = scanRepository(root);
  const index = process.argv.indexOf("--output");
  if (index >= 0) {
    const output = process.argv[index + 1];
    if (!output) throw new Error("--output requires path");
    const dest = resolve(output);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify({
    filesScanned: report.filesScanned, matchCount: report.matchCount,
    distinctPaths: report.distinctPaths, counts: report.counts,
    caveat: report.method,
  }));
}
