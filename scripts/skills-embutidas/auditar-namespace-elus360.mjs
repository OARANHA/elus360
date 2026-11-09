/** Auditoria read-only dos aliases de skills antes de renomear. Não imprime conteúdo ou segredos. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const CATEGORIAS = {
  execucao_critica: (p) => /(?:^|\/)(?:hooks\/|pre-commit$|pre-push$)/.test(p) || /^(?:\.claude\/settings\.json|\.codex\/hooks\.json|tests\/shell\/)/.test(p),
  descoberta_agentes: (p) => /^(?:\.agents\/rules\/|\.cursor\/rules\/|AGENTS\.md$|CLAUDE\.md$)/.test(p),
  conteudo_skill: (p) => /^(?:\.agents\/skills\/|\.claude\/skills\/)/.test(p),
  automacao_teste: (p) => /^(?:scripts\/|\.github\/|tests\/)/.test(p),
};
function categoria(p) {
  for (const [c, predicado] of Object.entries(CATEGORIAS)) if (predicado(p)) return c;
  return "documentacao_ou_outros";
}

export function auditarNamespace(diretorio = process.cwd()) {
  const raiz = resolve(diretorio);
  const fonte = join(raiz, ".agents/skills");
  if (!existsSync(fonte)) throw new Error("fonte .agents/skills ausente");
  const skills = readdirSync(fonte).filter((n) => {
    const p = join(fonte, n);
    return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
  }).sort();
  const propostas = skills.filter((n) => n.startsWith("deskcomm-")).map((atual) => ({
    atual, novo: `elus360-${atual.slice("deskcomm-".length)}`,
  }));
  const colisoes = propostas.filter(({ novo }) => skills.includes(novo)).map(({ novo }) => novo);
  const rastreados = execFileSync("git", ["ls-files", "-z", "--cached"], {
    cwd: raiz, encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const referencias = [];
  let omitidos = 0;
  for (const arquivo of rastreados) {
    if (/(^|\/)(?:\.env[^/]*|secrets?[^/]*|credentials?[^/]*)$/.test(arquivo)) continue;
    if (/^(?:supabase\/baseline\.sql|pnpm-lock\.yaml)$/.test(arquivo)) continue;
    const p = join(raiz, arquivo);
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    if (statSync(p).size > 2 * 1024 * 1024) { omitidos++; continue; }
    const bytes = readFileSync(p);
    if (bytes.includes(0)) { omitidos++; continue; }
    const nomes = propostas.filter(({ atual }) => bytes.toString("utf8").includes(atual)).map(({ atual }) => atual);
    if (nomes.length) referencias.push({ arquivo, categoria: categoria(arquivo), nomes });
  }
  referencias.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  const riscos = Object.fromEntries(["execucao_critica", "descoberta_agentes", "conteudo_skill",
    "automacao_teste", "documentacao_ou_outros"].map((n) => [n, referencias.filter((r) => r.categoria === n).length]));
  return { versao: 1, modo: "somente_leitura", fonte: ".agents/skills", espelho: ".claude/skills",
    skills, propostas, manter: skills.filter((n) => !n.startsWith("deskcomm-")), colisoes, riscos,
    arquivos_omitidos: omitidos, referencias,
    gate: colisoes.length ? "BLOQUEADO_COLISAO" : riscos.execucao_critica ? "EXIGE_MIGRACAO_DE_HOOKS" : "EXIGE_REVISAO",
    nota: "Nenhum arquivo alterado; conteúdo e segredos nunca são exibidos.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--raiz" || !args[1])) throw new Error("Uso: [--raiz <clone>]");
    process.stdout.write(JSON.stringify(auditarNamespace(args.length ? args[1] : process.cwd()), null, 2) + "\n");
  } catch (e) { process.stderr.write((e instanceof Error ? e.message : "falha na auditoria") + "\n"); process.exitCode = 1; }
}
