import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routes = [
  "app/api/v1/ai/agents/route.ts",
  "app/api/v1/ai/agents/[id]/versions/route.ts",
  "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts",
];

for (const route of routes) {
  test(`governança declarada antes da mutação técnica: ${route}`, () => {
    const source = readFileSync(route, "utf8");
    const guard = source.indexOf("await podeAlterarTecnicaDeVersao(");
    const mutation = route.includes("[vid]")
      ? source.indexOf('admin.rpc("fn_elus_ai_version_patch_guarded"', guard)
      : route.includes("/versions/")
        ? source.indexOf('admin.rpc("fn_elus_ai_version_create_guarded"', guard)
        : source.indexOf('admin.rpc("fn_elus_ai_agent_create_guarded"', guard);
    assert.ok(guard >= 0, "rota sem fronteira de autorização técnica");
    assert.ok(mutation > guard, "escrita anterior à verificação técnica");
    assert.match(source, /forbidden_platform_ai/);
  });
}

test("fronteira de preflight não substitui a atomicidade do RPC", () => {
  const helper = readFileSync("lib/elus360/ai-managed/authorize-version-write.ts", "utf8");
  assert.match(helper, /não substitui o gate transacional contra revogação/i);
});

test("server action cria agente e draft apenas via RPC atômico", () => {
  const source = readFileSync("app/app/ai/agents/[id]/_actions.ts", "utf8");
  const start = source.indexOf("export async function createMcpAgentAction(");
  assert.ok(start >= 0, "createMcpAgentAction ausente");
  const action = source.slice(start);
  assert.match(action, /fn_elus_ai_agent_create_guarded/);
  assert.doesNotMatch(action, /\.from\("ai_agent_versions"\)\.insert\(/);
  assert.match(action, /requirePlatformAdminEscrita/);
});

test("editor de rascunhos usa gates e RPCs transacionais em ambos os caminhos", () => {
  const source = readFileSync("app/app/ai/agents/[id]/_actions.ts", "utf8");
  const start = source.indexOf("export async function saveAgentDraftAction(");
  const end = source.indexOf("export async function publishAgentAction(", start);
  assert.ok(start >= 0 && end > start, "fronteira da action não encontrada");
  const action = source.slice(start, end);
  const guard = action.indexOf("await podeAlterarTecnicaDeVersao(");
  const patch = action.indexOf('admin.rpc("fn_elus_ai_version_patch_guarded"');
  const create = action.indexOf('"fn_elus_ai_version_create_guarded"');
  assert.ok(guard >= 0, "preflight técnico ausente");
  assert.ok(patch > guard, "PATCH sem preflight");
  assert.ok(create > patch, "criação deve reutilizar o RPC guardado");
  assert.doesNotMatch(action, /\.from\("ai_agent_versions"\)\s*\.update\(/);
  assert.doesNotMatch(action, /\.from\("ai_agent_versions"\)\s*\.insert\(/);
  assert.match(action, /p_platform_bypass: false/);
});
