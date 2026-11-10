/** Auditoria read-only do namespace das skills antes e depois da migração. Não imprime conteúdo ou segredos. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const ENTRADAS_ATIVAS = (p) => [".claude/settings.json", ".codex/hooks.json"].includes(p) ||
  p.startsWith(".agents/rules/") || p.startsWith(".cursor/rules/");
const PREFIXO_ANTIGO = "deskcomm-";
const PREFIXO_NOVO = "elus360-";

function listarDiretoriosDeSkills(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).filter((n) => {
    const p = join(pasta, n);
    return !lstatSync(p).isSymbolicLink() && statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
  }).sort();
}

export function auditarNamespace(diretorio = process.cwd()) {
  const raiz = resolve(diretorio);
  const fonte = join(raiz, ".agents/skills");
  if (!existsSync(fonte)) throw new Error("fonte .agents/skills ausente");
  const skills = listarDiretoriosDeSkills(fonte);
  const skillsEspelhadas = listarDiretoriosDeSkills(join(raiz, ".claude/skills"));
  const propostas = skills.filter((n) => n.startsWith(PREFIXO_ANTIGO)).map((atual) => ({
    atual, novo: `${PREFIXO_NOVO}${atual.slice(PREFIXO_ANTIGO.length)}`,
  }));
  const migradas = skills.filter((n) => n.startsWith(PREFIXO_NOVO));
  const manter = skills.filter((n) => !n.startsWith(PREFIXO_ANTIGO) && !n.startsWith(PREFIXO_NOVO));
  const colisoes = propostas.filter(({ novo }) => skills.includes(novo)).map(({ novo }) => novo);
  const fase = propostas.length && migradas.length ? "mista" :
    propostas.length ? "antes_da_migracao" : migradas.length ? "apos_migracao" : "sem_namespace_reconhecido";
  const faltamNoEspelho = skills.filter((n) => !skillsEspelhadas.includes(n));
  const orfasNoEspelho = skillsEspelhadas.filter((n) => !skills.includes(n));
  // Após a migração, os nomes antigos não estão mais na árvore de fontes. Ainda precisam
  // ser procurados para encontrar comandos e entradas de agente que ficaram obsoletos.
  const nomesHerdados = [...new Set([
    ...propostas.map(({ atual }) => atual),
    ...migradas.map((n) => `${PREFIXO_ANTIGO}${n.slice(PREFIXO_NOVO.length)}`),
  ])].sort();
  const rastreados = execFileSync("git", ["ls-files", "-z", "--cached"], {
    cwd: raiz, encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const referencias = [];
  let omitidos = 0;
  for (const arquivo of rastreados) {
    if (/(^|\/)(?:\.env[^/]*|secrets?[^/]*|credentials?[^/]*)$/.test(arquivo)) continue;
    if (/^(?:supabase\/baseline\.sql|pnpm-lock\.yaml)$/.test(arquivo)) continue;
    const p = join(raiz, arquivo);
    if (!existsSync(p) || !lstatSync(p).isFile()) continue; // nunca seguir symlink rastreado
    if (statSync(p).size > 2 * 1024 * 1024) { omitidos++; continue; }
    const bytes = readFileSync(p);
    if (bytes.includes(0)) { omitidos++; continue; }
    const conteudo = bytes.toString("utf8");
    const nomes = nomesHerdados.filter((atual) => conteudo.includes(atual));
    if (nomes.length) referencias.push({ arquivo, categoria: categoria(arquivo), nomes });
  }
  referencias.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  const riscos = Object.fromEntries(["execucao_critica", "descoberta_agentes", "conteudo_skill",
    "automacao_teste", "documentacao_ou_outros"].map((n) => [n, referencias.filter((r) => r.categoria === n).length]));
  // Referências históricas e padrões de limpeza/compatibilidade podem ser legítimos.
  // Bloquear apenas entradas de agente que executariam o caminho antigo.
  const entradasLegadas = fase === "apos_migracao" ? referencias
    .filter(({ arquivo }) => ENTRADAS_ATIVAS(arquivo))
    .map(({ arquivo, nomes }) => ({ arquivo, nomes })) : [];
  const gate = colisoes.length ? "BLOQUEADO_COLISAO" : fase === "mista" ? "BLOQUEADO_ESTADO_MISTO" :
    fase === "apos_migracao" && (faltamNoEspelho.length || orfasNoEspelho.length) ? "BLOQUEADO_ESPELHO_DESATUALIZADO" :
    entradasLegadas.length ? "BLOQUEADO_REFERENCIA_ATIVA_LEGADA" :
    fase === "apos_migracao" ? "EXIGE_HOMOLOGACAO_CLI" :
    riscos.execucao_critica ? "EXIGE_MIGRACAO_DE_HOOKS" : "EXIGE_REVISAO";
  return { versao: 2, modo: "somente_leitura", fonte: ".agents/skills", espelho: ".claude/skills",
    fase, skills, propostas, migradas, manter, colisoes, faltam_no_espelho: faltamNoEspelho,
    orfas_no_espelho: orfasNoEspelho, entradas_legadas: entradasLegadas, riscos,
    arquivos_omitidos: omitidos, referencias, gate,
    nota: "Nenhum arquivo alterado; conteúdo e segredos nunca são exibidos. EXIGE_HOMOLOGACAO_CLI não comprova execução real.",

  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--raiz" || !args[1])) throw new Error("Uso: [--raiz <clone>]");
    process.stdout.write(JSON.stringify(auditarNamespace(args.length ? args[1] : process.cwd()), null, 2) + "\n");
  } catch (e) { process.stderr.write((e instanceof Error ? e.message : "falha na auditoria") + "\n"); process.exitCode = 1; }
}
