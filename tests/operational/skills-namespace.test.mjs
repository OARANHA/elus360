import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditarNamespace } from "../../scripts/skills-embutidas/auditar-namespace-elus360.mjs";
function cenario(fn) {
  const dir = mkdtempSync(join(tmpdir(), "elus360-ns-"));
  const escrever = (p, c) => { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); };
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    escrever(".agents/skills/deskcomm-contribuir/SKILL.md", "---\nname: deskcomm-contribuir\n---\n");
    escrever(".agents/skills/sistema-vivo/SKILL.md", "---\nname: sistema-vivo\n---\n");
    escrever(".claude/skills/deskcomm-contribuir/SKILL.md", "---\nname: deskcomm-contribuir\n---\n");
    escrever(".claude/settings.json", "{\"hooks\":\"deskcomm-contribuir/scripts/hooks/sessao.sh\"}");
    escrever("README.md", "Chamar deskcomm-contribuir.");
    escrever(".env.test", "SECRET=deskcomm-contribuir");
    execFileSync("git", ["add", "-f", "."], { cwd: dir });
    return fn(dir, escrever);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("inventario sem escrita identifica hooks e preserva conteudo", () => cenario((dir) => {
  const a = auditarNamespace(dir);
  assert.equal(a.propostas.length, 1);
  assert.equal(a.propostas[0].novo, "elus360-contribuir");
  assert.deepEqual(a.manter, ["sistema-vivo"]);
  assert.equal(a.gate, "EXIGE_MIGRACAO_DE_HOOKS");
  assert.equal(a.riscos.execucao_critica, 1);
  assert.ok(!JSON.stringify(a).includes("SECRET="));
  assert.ok(!a.referencias.some((r) => r.arquivo === ".env.test"));
  assert.ok(existsSync(join(dir, ".agents/skills/deskcomm-contribuir/SKILL.md")));
  assert.ok(!existsSync(join(dir, ".agents/skills/elus360-contribuir")));
}));
test("colisao nao se torna sobrescrita silenciosa", () => cenario((dir, escrever) => {
  escrever(".agents/skills/elus360-contribuir/SKILL.md", "---\nname: elus360-contribuir\n---\n");
  execFileSync("git", ["add", "-f", "."], { cwd: dir });
  const a = auditarNamespace(dir);
  assert.deepEqual(a.colisoes, ["elus360-contribuir"]);
  assert.equal(a.gate, "BLOQUEADO_COLISAO");
}));
