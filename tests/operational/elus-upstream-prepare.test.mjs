import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/elus-upstream-prepare.mjs");
const ARGS = ["--from", "v1.94.0", "--to", "v1.95.0"];

function cmd(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function fixture(changed = "README.md") {
  const dir = mkdtempSync(join(tmpdir(), "elus-upstream-gate-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, "scripts", "elus-upstream-prepare.mjs"));
  writeFileSync(join(dir, "README.md"), "v1.94.0\n");
  cmd(dir, "init", "-b", "main");
  cmd(dir, "config", "user.name", "ELUS Gate Test");
  cmd(dir, "config", "user.email", "local-test@example.invalid");
  cmd(dir, "remote", "add", "origin", "https://github.com/OARANHA/elus360.git");
  cmd(dir, "remote", "add", "upstream", "https://github.com/melgarafael/DeskcommCRM.git");
  cmd(dir, "add", ".");
  cmd(dir, "commit", "-m", "fixture v1.94");
  cmd(dir, "update-ref", "refs/elus-upstream/tags/v1.94.0", "HEAD");
  const full = join(dir, changed);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, "alterado\n");
  cmd(dir, "add", ".");
  cmd(dir, "commit", "-m", "fixture v1.95");
  cmd(dir, "update-ref", "refs/elus-upstream/tags/v1.95.0", "HEAD");
  return dir;
}

function run(dir, args = ARGS) {
  return spawnSync(process.execPath, [join(dir, "scripts", "elus-upstream-prepare.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function withFixture(path, body) {
  const dir = fixture(path);
  try { body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("arquivo ordinário gera relatório mas nunca altera o checkout", () => {
  withFixture("README.md", (dir) => {
    const before = cmd(dir, "rev-parse", "HEAD");
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.mode, "read_only");
    assert.equal(report.gate, "analysis_ready");
    assert.equal(report.totals.ordinary, 1);
    assert.equal(report.files[0].path, "README.md");
    assert.equal(cmd(dir, "rev-parse", "HEAD"), before);
    assert.equal(cmd(dir, "status", "--porcelain"), "");
  });
});

test("arquivo de API de IA exige revisão e não faz merge", () => {
  withFixture("app/api/v1/ai/providers/route.ts", (dir) => {
    const r = run(dir);
    assert.equal(r.status, 2);
    const report = JSON.parse(r.stdout);
    assert.equal(report.gate, "manual_review_required");
    assert.equal(report.files[0].reason, "contrato_core_sensivel");
    assert.equal(cmd(dir, "status", "--porcelain"), "");
  });
});

test("baseline SQL obriga gate de banco", () => {
  withFixture("supabase/baseline.sql", (dir) => {
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).files[0].reason, "schema_rls_migrations");
  });
});

test("arquivo da camada ELUS modificado upstream bloqueia colisão", () => {
  withFixture("lib/elus360/governanca/policy.ts", (dir) => {
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).gate, "blocked_collision");
  });
});

test("recusa árvore suja sem tocar nos arquivos", () => {
  withFixture("README.md", (dir) => {
    writeFileSync(join(dir, "README.md"), "mudanca local fora do git\n");
    const before = readFileSync(join(dir, "README.md"), "utf8");
    const r = run(dir);
    assert.equal(r.status, 3);
    assert.equal(JSON.parse(r.stderr).reason, "working_tree_suja");
    assert.equal(readFileSync(join(dir, "README.md"), "utf8"), before);
  });
});

test("recusa upstream remoto não oficial", () => {
  withFixture("README.md", (dir) => {
    cmd(dir, "remote", "set-url", "upstream", "https://github.com/outro/DeskcommCRM.git");
    const r = run(dir);
    assert.equal(r.status, 3);
    assert.equal(JSON.parse(r.stderr).reason, "upstream_divergente");
  });
});

test("recusa ref de tag não preparada", () => {
  withFixture("README.md", (dir) => {
    cmd(dir, "update-ref", "-d", "refs/elus-upstream/tags/v1.95.0");
    const r = run(dir);
    assert.equal(r.status, 3);
    assert.equal(JSON.parse(r.stderr).reason, "tags_oficiais_nao_preparadas");
  });
});

test("recusa versão regressiva e argumentos extras", () => {
  withFixture("README.md", (dir) => {
    const regress = run(dir, ["--from", "v1.95.0", "--to", "v1.94.0"]);
    assert.equal(regress.status, 3);
    assert.equal(JSON.parse(regress.stderr).reason, "atualizacao_nao_progressiva");
    const unknown = run(dir, [...ARGS, "--deploy"]);
    assert.equal(unknown.status, 3);
    assert.equal(JSON.parse(unknown.stderr).reason, "argumentos_invalidos");
  });
});
