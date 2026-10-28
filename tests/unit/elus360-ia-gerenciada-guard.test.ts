import { describe, expect, it, vi } from "vitest";

import { decidirEscritaTecnicaIa } from "@/lib/elus360/ai-managed/guard";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ANTES = { provider: "chutes", model: "google/gemma-4-31B-turbo-TEE", credential_id: null };

describe("Gate 2B.2 — decisão no servidor, ainda não conectada a APIs", () => {
  it("identidade de organização inválida recusa antes de chamar o leitor", async () => {
    const read = vi.fn(async () => ({ provider: true }));
    const result = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: "parametro-do-usuario", anteriorDoServidor: ANTES, propostaValidada: { provider: "openai" } },
      { lerAutonomiaPorOrganizacao: read },
    );
    expect(result).toEqual({ permitido: false, motivo: "organizacao_invalida", negados: [] });
    expect(read).not.toHaveBeenCalled();
  });

  it("falha de consulta, coluna ausente e organização sem linha recusam", async () => {
    for (const f of [
      async () => { throw new Error("column ai_autonomy does not exist"); },
      async () => { throw new Error("database unavailable"); },
      async () => null,
      async () => undefined,
    ]) {
      const result = await decidirEscritaTecnicaIa(
        { orgIdConfiavel: ORG_A, anteriorDoServidor: ANTES, propostaValidada: { provider: "openai" } },
        { lerAutonomiaPorOrganizacao: f },
      );
      expect(result).toEqual({ permitido: false, motivo: "autonomia_indisponivel", negados: [] });
    }
  });

  it("tenant não obtém grant de outra organização", async () => {
    const rights: Record<string, unknown> = {
      [ORG_A]: { model: true },
      [ORG_B]: { provider: true },
    };
    const read = vi.fn(async (orgId: string) => rights[orgId]);
    const a = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: ORG_A, anteriorDoServidor: ANTES, propostaValidada: { provider: "openai" } },
      { lerAutonomiaPorOrganizacao: read },
    );
    const b = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: ORG_B, anteriorDoServidor: ANTES, propostaValidada: { provider: "openai" } },
      { lerAutonomiaPorOrganizacao: read },
    );
    expect(a.permitido).toBe(false);
    expect(b.permitido).toBe(true);
    expect(read.mock.calls.map((c) => c[0])).toEqual([ORG_A, ORG_B]);
  });

  it("dados corrompidos/truthy não concedem poder", async () => {
    const result = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: ORG_A, anteriorDoServidor: ANTES, propostaValidada: { provider: "openai" } },
      { lerAutonomiaPorOrganizacao: async () => ({ provider: "true" }) },
    );
    expect(result).toEqual({ permitido: false, motivo: "forbidden_platform_ai", negados: ["provider"] });
  });

  it("referência anterior ausente nunca autoriza escrita técnica", async () => {
    const result = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: ORG_A, anteriorDoServidor: null, propostaValidada: { model: "gpt-5" } },
      { lerAutonomiaPorOrganizacao: async () => ({ model: true }) },
    );
    expect(result).toEqual({ permitido: false, motivo: "referencia_indisponivel", negados: [] });
  });

  it("não exige grant para reenvio técnico idêntico com leitura disponível", async () => {
    const result = await decidirEscritaTecnicaIa(
      { orgIdConfiavel: ORG_A, anteriorDoServidor: ANTES, propostaValidada: { model: ANTES.model } },
      { lerAutonomiaPorOrganizacao: async () => ({}) },
    );
    expect(result).toEqual({ permitido: true, motivo: null, negados: [] });
  });
});
