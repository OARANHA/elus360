import { describe, expect, it } from "vitest";

import {
  AUTONOMIA_IA_PADRAO,
  CHAVES_AUTONOMIA_IA,
  avaliarAutonomiaParaMudanca,
  interpretarAutonomiaIa,
  mudancasTecnicas,
} from "@/lib/elus360/ai-managed/policy";

const ANTES = {
  provider: "chutes",
  model: "google/gemma-4-31B-turbo-TEE",
  credential_id: null,
  operator_model: null,
  base_url: null,
  is_enabled: true,
} as const;

describe("ELUS 360 — política pura de autonomia de IA (Gate 2A)", () => {
  it("quatro grants distintos começam desativados", () => {
    expect(CHAVES_AUTONOMIA_IA).toEqual(["provider", "model", "credentials", "operator_model"]);
    expect(AUTONOMIA_IA_PADRAO).toEqual({
      provider: false,
      model: false,
      credentials: false,
      operator_model: false,
    });
    expect(Object.isFrozen(AUTONOMIA_IA_PADRAO)).toBe(true);
  });

  it("ausência, null e valores truthy falsos nunca concedem autonomia", () => {
    for (const x of [null, undefined, [], false, "true", 1, {}]) {
      expect(interpretarAutonomiaIa(x)).toEqual(AUTONOMIA_IA_PADRAO);
    }
    expect(
      interpretarAutonomiaIa({
        provider: "true",
        model: 1,
        credentials: {},
        operator_model: true,
      }),
    ).toEqual({ provider: false, model: false, credentials: false, operator_model: true });
  });

  it("reenvio idêntico ou proposta sem campos técnicos não demanda grant", () => {
    expect(mudancasTecnicas(ANTES, { provider: ANTES.provider, model: ANTES.model })).toEqual([]);
    expect(mudancasTecnicas(ANTES, {})).toEqual([]);
    expect(avaliarAutonomiaParaMudanca(null, ANTES, {})).toEqual({
      permitido: true,
      motivo: null,
      negados: [],
    });
  });

  it("mudanças distintas exigem quatro grants, sem duplicar provider", () => {
    expect(
      mudancasTecnicas(ANTES, {
        provider: "openai",
        model: "gpt-5-mini",
        credential_id: "cred-1",
        operator_model: "gpt-5-nano",
        base_url: "https://example.invalid",
        is_enabled: false,
      }),
    ).toEqual(["provider", "model", "credentials", "operator_model"]);
  });

  it("grants de modelo não autorizam trocar credencial/provedor", () => {
    expect(
      avaliarAutonomiaParaMudanca(
        { model: true },
        ANTES,
        { provider: "openai", model: "gpt-5-mini", credential_id: "cred-1" },
      ),
    ).toEqual({ permitido: false, motivo: "forbidden_platform_ai", negados: ["provider", "credentials"] });
  });

  it("desativar binding é mudança técnica de provider", () => {
    expect(
      avaliarAutonomiaParaMudanca({ provider: false }, ANTES, { is_enabled: false }),
    ).toEqual({ permitido: false, motivo: "forbidden_platform_ai", negados: ["provider"] });
    expect(
      avaliarAutonomiaParaMudanca({ provider: true }, ANTES, { is_enabled: false }),
    ).toEqual({ permitido: true, motivo: null, negados: [] });
  });

  it("referência indisponível e proposta não-objeto falham fechadas", () => {
    expect(avaliarAutonomiaParaMudanca({ provider: true }, null, { provider: "openai" })).toEqual({
      permitido: false,
      motivo: "referencia_indisponivel",
      negados: [],
    });
    expect(avaliarAutonomiaParaMudanca({ provider: true }, ANTES, null)).toEqual({
      permitido: false,
      motivo: "proposta_invalida",
      negados: [],
    });
  });

  it("permissões explícitas independentes permitem apenas alterações correspondentes", () => {
    expect(
      avaliarAutonomiaParaMudanca(
        { credentials: true, model: true },
        ANTES,
        { credential_id: "cred-1", model: "gpt-5-mini" },
      ),
    ).toEqual({ permitido: true, motivo: null, negados: [] });
  });

  it("a referência original é preservada por funções puras", () => {
    const original = JSON.stringify(ANTES);
    const proposta = { model: "gpt-5-mini" };
    const originalProposta = JSON.stringify(proposta);
    avaliarAutonomiaParaMudanca({ model: true }, ANTES, proposta);
    expect(JSON.stringify(ANTES)).toBe(original);
    expect(JSON.stringify(proposta)).toBe(originalProposta);
  });
});
