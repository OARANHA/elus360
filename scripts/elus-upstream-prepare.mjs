#!/usr/bin/env node
/**
 * ELUS Upstream Sync — Gate 1 (somente leitura).
 *
 * Compara refs oficiais já buscadas. Não faz fetch, checkout, merge, SQL,
 * Docker, alteração de variáveis ou deploy.
 * Exit 0: sem caminho sensível; 2: revisão obrigatória; 3: preflight recusado.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "refs/elus-upstream/tags/";
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function refuse(reason) {
  process.stderr.write(JSON.stringify({ ok: false, gate: "preflight", reason }) + "\n");
  process.exitCode = 3;
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args.length !== 4 || args[0] !== "--from" || args[2] !== "--to") {
    throw new Error("argumentos_invalidos");
  }
  const from = args[1];
  const to = args[3];
  const a = TAG.exec(from);
  const b = TAG.exec(to);
  if (!a || !b) throw new Error("versao_invalida");
  const left = a.slice(1).map(Number);
  const right = b.slice(1).map(Number);
  const lessOrEqual =
    right[0] < left[0] ||
    (right[0] === left[0] && right[1] < left[1]) ||
    (right[0] === left[0] && right[1] === left[1] && right[2] <= left[2]);
  if (lessOrEqual) throw new Error("atualizacao_nao_progressiva");
  return { from, to };
}

function canonicalRemote(actual, owner, repo) {
  const suffix = owner + "/" + repo;
  return new RegExp(
    "^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)" +
      suffix +
      "(?:\\.git)?/?$",
    "i",
  ).test(actual);
}

function riskFor(path) {
  if (
    path.startsWith("lib/elus360/") ||
    path.startsWith("components/elus360/") ||
    path.startsWith("docs/elus360/") ||
    path.startsWith("scripts/elus-") ||
    path.startsWith("tests/unit/elus360-") ||
    path.startsWith("tests/operational/elus-")
  ) return { risk: "block", reason: "colisao_com_arquivo_elus" };

  if (path === "supabase/baseline.sql" || path.startsWith("supabase/migrations/")) {
    return { risk: "review", reason: "schema_rls_migrations" };
  }

  if (
    path.startsWith("app/api/v1/ai/") ||
    path.startsWith("app/api/v1/admin/tenants/") ||
    path.startsWith("app/actions/onboarding/") ||
    path.startsWith("lib/ai/") ||
    path.startsWith("lib/agent-engine/") ||
    path.startsWith("workers/") ||
    path.startsWith("app/onboarding/") ||
    path.startsWith("lib/instalacao/") ||
    path.startsWith("lib/auth/") ||
    path.startsWith("lib/navigation/")
  ) return { risk: "review", reason: "contrato_core_sensivel" };

  if (
    path === "compose.portainer.yml" ||
    path.startsWith("Dockerfile") ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("hostgator-setup-kit/")
  ) return { risk: "review", reason: "infraestrutura_e_release" };

  return { risk: "ordinary", reason: "revisar_diff_normal" };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(
      "Uso: node scripts/elus-upstream-prepare.mjs --from v1.94.0 --to v1.95.0\n" +
        "Prepare antes refs/elus-upstream/tags/ (docs/elus360/upstream-sync.md).\n" +
        "0=sem caminho sensível; 2=revisão obrigatória; 3=preflight recusado.\n",
    );
    return;
  }
  const { from, to } = parsed;
  if (git("rev-parse", "--show-toplevel") !== ROOT) throw new Error("checkout_incorreto");
  if (git("symbolic-ref", "--short", "HEAD") !== "main") throw new Error("iniciar_na_main");
  if (git("status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("working_tree_suja");
  }
  if (!canonicalRemote(git("remote", "get-url", "origin"), "OARANHA", "elus360")) {
    throw new Error("origin_divergente");
  }
  if (!canonicalRemote(git("remote", "get-url", "upstream"), "melgarafael", "DeskcommCRM")) {
    throw new Error("upstream_divergente");
  }
  let fromSha, toSha;
  try {
    fromSha = git("rev-parse", "--verify", PREFIX + from + "^{commit}");
    toSha = git("rev-parse", "--verify", PREFIX + to + "^{commit}");
  } catch {
    throw new Error("tags_oficiais_nao_preparadas");
  }
  try {
    git("merge-base", "--is-ancestor", fromSha, toSha);
  } catch {
    throw new Error("releases_sem_ancestralidade");
  }

  const changes = git("diff", "--name-status", "--no-renames", fromSha, toSha);
  const files = changes
    ? changes.split("\n").map((line) => {
        const sep = line.indexOf("\t");
        if (sep <= 0) throw new Error("git_diff_invalido");
        const status = line.slice(0, sep);
        const path = line.slice(sep + 1);
        if (!path || !/^[AMDTCU]$/.test(status)) throw new Error("git_diff_invalido");
        return { path, status, ...riskFor(path) };
      })
    : [];
  const totals = {
    block: files.filter((x) => x.risk === "block").length,
    review: files.filter((x) => x.risk === "review").length,
    ordinary: files.filter((x) => x.risk === "ordinary").length,
  };
  const needsReview = totals.block > 0 || totals.review > 0;
  process.stdout.write(
    JSON.stringify(
      {
        schema_version: 1,
        tool: "elus-upstream-prepare",
        mode: "read_only",
        source: "melgarafael/DeskcommCRM",
        fork: "OARANHA/elus360",
        fork_main_sha: git("rev-parse", "--verify", "main"),
        from: { release: from, sha: fromSha },
        to: { release: to, sha: toSha },
        gate: totals.block
          ? "blocked_collision"
          : needsReview
            ? "manual_review_required"
            : "analysis_ready",
        totals,
        files,
        note: "Nao fez merge nem provou compatibilidade funcional. Revisao, CI e gates de banco e deploy sao obrigatorios.",
      },
      null,
      2,
    ) + "\n",
  );
  if (needsReview) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  const reason = error instanceof Error ? error.message : "";
  const known = [
    "argumentos_invalidos", "versao_invalida", "atualizacao_nao_progressiva",
    "checkout_incorreto", "iniciar_na_main", "working_tree_suja", "origin_divergente",
    "upstream_divergente", "tags_oficiais_nao_preparadas", "releases_sem_ancestralidade",
    "git_diff_invalido",
  ];
  refuse(known.includes(reason) ? reason : "erro_preflight");
}
