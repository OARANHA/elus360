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
