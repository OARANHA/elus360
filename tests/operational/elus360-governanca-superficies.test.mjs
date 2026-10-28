import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INVENTORY = resolve(ROOT, "docs/elus360/ai-governance-write-surfaces.json");

function load() {
  return JSON.parse(readFileSync(INVENTORY, "utf8"));
}

test("inventario e explicitamente INCOMPLETO, nao e autorizacao", () => {
  const data = load();
  assert.equal(data.schema_version, 1);
  assert.equal(data.status, "INITIAL_INVENTORY_NOT_AUTHORIZATION");
  assert.match(data.notice, /NÃO prova segurança/);
  assert.match(data.source_main_sha, /^[a-f0-9]{40}$/);
  assert.ok(data.surfaces.length >= 15);
  assert.ok(data.surfaces.every((s) => s.guard_status === "PENDING_REVIEW"));
});

test("cada ponto existe e exporta a funcao ou metodo anotado", () => {
  const data = load();
  const keys = new Set();
  for (const s of data.surfaces) {
    assert.match(s.path, /^(?:app\/api\/v1\/|app\/actions\/)/, s.path);
    const key = s.path + "#" + s.entry_point;
    assert.ok(!keys.has(key), "ponto duplicado: " + key);
    keys.add(key);
    const source = readFileSync(resolve(ROOT, s.path), "utf8");
    const expected = new RegExp("export\\s+async\\s+function\\s+" + s.entry_point + "\\s*\\(");
    assert.match(source, expected, key);
  }
});

test("nunca deixa fora portas conhecidas de provedor credencial versao e onboarding", () => {
  const keys = new Set(load().surfaces.map((s) => s.path + "#" + s.entry_point));
  const mandatory = [
    "app/api/v1/ai/providers/route.ts#PUT",
    "app/api/v1/ai/providers/route.ts#PATCH",
    "app/api/v1/ai/credentials/route.ts#POST",
    "app/api/v1/ai/credentials/[id]/route.ts#PATCH",
    "app/api/v1/ai/credentials/[id]/route.ts#DELETE",
    "app/api/v1/ai/agents/route.ts#POST",
    "app/api/v1/ai/agents/[id]/versions/route.ts#POST",
    "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts#PATCH",
    "app/api/v1/ai/agents/[id]/publish/route.ts#POST",
    "app/api/v1/ai/knowledge/provedor/route.ts#PUT",
    "app/actions/onboarding/chaveDaIa.ts#salvarChaveDaIa",
    "app/actions/onboarding/acceptWelcome.ts#acceptWelcome",
    "app/actions/onboarding/createDefaultAgent.ts#createDefaultAgent",
  ];
  for (const id of mandatory) assert.ok(keys.has(id), "ponto obrigatorio ausente: " + id);
});
