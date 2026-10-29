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
  const patch = action.indexOf('admin.rpc("fn_elus_ai_draft_save_guarded"');
  const create = action.indexOf('"fn_elus_ai_draft_save_guarded"', patch + 1);
  assert.ok(guard >= 0, "preflight técnico ausente");
  assert.ok(patch > guard, "PATCH sem preflight");
  assert.ok(create > patch, "criação deve reutilizar o RPC guardado");
  assert.doesNotMatch(action, /\.from\("ai_agent_versions"\)\s*\.update\(/);
  assert.doesNotMatch(action, /\.from\("ai_agent_versions"\)\s*\.insert\(/);
  assert.match(action, /p_platform_bypass: platformBypass/);
  assert.match(action, /await requirePlatformAdminEscrita\(\)/);
  assert.match(action, /podeGerenciarIaDaPlataforma\(authUser\)/);
  assert.match(action, /p_agent_patch: cadastroPatch/);
  assert.doesNotMatch(action, /gravarCadastroDoAgente/);
});

test("workflow de governança monitora alterações no editor", () => {
  const workflow = readFileSync(".github/workflows/elus360-ai-autonomy-triple.yml", "utf8");
  assert.match(workflow, /app\/app\/ai\/agents\/\[id\]\/_actions\.ts/);
});

test("banco descartável testa rollback após erro de cadastro e sucesso conjunto", () => {
  const sql = readFileSync("tests/operational/elus360-ai-autonomy-postgres.sql", "utf8");
  assert.match(sql, /FAIL_version_survived_metadata_failure/);
  assert.match(sql, /FAIL_atomic_metadata_success/);
  assert.match(sql, /EXCEPTION WHEN check_violation/);
});

test("portas de configuração técnica mantêm preflight de autorização por tenant", () => {
  const routes = [
    ["app/api/v1/ai/providers/route.ts", "decidirEscritaTecnicaIa(", "recusaConfiguracaoDeIa("],
    ["app/api/v1/ai/credentials/route.ts", "recusaConfiguracaoDeIa("],
    ["app/api/v1/ai/credentials/[id]/route.ts", "recusaConfiguracaoDeIa("],
    ["app/api/v1/ai/knowledge/provedor/route.ts", "recusaConfiguracaoDeIa("],
  ];
  for (const [path, ...guards] of routes) {
    const source = readFileSync(path, "utf8");
    for (const guard of guards) {
      assert.ok(source.includes(guard), `${path}: ausência da verificação ${guard}`);
    }
    assert.match(source, /organization|orgId|\.orgId|\.organization_id/i,
      `${path}: não foi possível identificar escopo de tenant`);
  }
});

test("corrida SQL exercita ambas as ordens sem usar produção", () => {
  const source = readFileSync(
    "tests/operational/elus360-ai-autonomy-concurrency.sh", "utf8");
  assert.match(source, /FAIL_concurrent_RPC_revocation/);
  assert.match(source, /FAIL_concurrent_write_before_revoke/);
  assert.match(source, /FAIL_revocation_after_write_not_applied/);
});
