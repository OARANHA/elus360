import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Nenhum teste node:test pode sumir por exclusão do Vitest sem gate próprio. */
describe("ELUS360 — contratos dos executores obrigatórios", () => {
  it("Vitest exclui operacionais e node:test possui runner próprio", () => {
    const vitest = readFileSync("vitest.config.ts", "utf8");
    const cercas = readFileSync("vitest.cercas.ts", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(vitest).toContain('"tests/operational/**"');
    expect(cercas).toContain('"tests/operational/"');
    expect(pkg.scripts["test:operational"]).toBe(
      "node --test tests/operational/*.test.mjs",
    );
  });

  it("ambos os workflows exigem o runner operacional e não pulam Vitest", () => {
    const oficial = readFileSync(".github/workflows/ci.yml", "utf8");
    const candidata = readFileSync(".github/workflows/elus360-v1102-candidate.yml", "utf8");
    expect(oficial).toMatch(/- name: ELUS operational tests \(node:test\)[\s\S]*?run: pnpm test:operational/);
    expect(oficial).toContain("pnpm test:unit --project produto --shard=");
    expect(candidata).toContain("pnpm test:operational");
    // A candidata usa sete partes limitadas, em vez de uma suite monolitica
    // cancelada aos 45 minutos (run 43913188778).
    expect(candidata).toContain("unit-shards:");
    expect(candidata).toContain("parte: [1, 2, 3, 4, 5, 6, 7]");
    expect(candidata).toContain("pnpm test:unit --project produto --shard=${{ matrix.parte }}/6");
    expect(candidata).toContain("pnpm test:unit --project cercas");
    // O check Full unit suite segue obrigatório e reprova shard skipped/cancelado.
    expect(candidata).toContain("needs: [unit-shards]");
    expect(candidata).toContain("if: ${{ always() }}");
    expect(candidata).toContain('test "$SHARDS_RESULT" = success');
  });
});
