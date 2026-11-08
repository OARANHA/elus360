import { describe, expect, it } from "vitest";

import { estiloDaReserva, PISO_DO_RODAPE, VARIAVEL_DA_OCUPACAO } from "@/lib/ui/rodape-ocupado";

/**
 * Regressão: a barra móvel sai de cena sem recarregar a página.
 * A casca deve publicar explicitamente o piso seguro no estado zero:
 * a prova de geometria correspondente continua no Playwright
 * tests/e2e/celular-cabe-na-tela.spec.ts.
 */
describe("estilo da reserva de rodapé após mudança responsiva", () => {
  it("retorna um piso explícito quando a barra desaparece", () => {
    const ocupado = estiloDaReserva(54).paddingBottom;
    const vazio = estiloDaReserva(0).paddingBottom;

    expect(ocupado).toContain(`var(${VARIAVEL_DA_OCUPACAO}, 0px)`);
    expect(vazio).toBe(`max(${PISO_DO_RODAPE}px, env(safe-area-inset-bottom, 0px))`);
    expect(vazio).not.toContain(VARIAVEL_DA_OCUPACAO);
  });

  it("preserva a safe area mesmo sem peça fixa", () => {
    expect(estiloDaReserva(0).paddingBottom).toContain("env(safe-area-inset-bottom, 0px)");
    expect(estiloDaReserva(-1)).toEqual(estiloDaReserva(0));
  });

  it("retoma a reserva dinâmica ao voltar ao celular", () => {
    expect(estiloDaReserva(0).paddingBottom).not.toContain(VARIAVEL_DA_OCUPACAO);
    expect(estiloDaReserva(54).paddingBottom).toContain(VARIAVEL_DA_OCUPACAO);
  });
});
