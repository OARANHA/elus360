import { describe, expect, it } from "vitest";
import {
  AUTONOMIA_IA_PADRAO,
  avaliarAutonomiaParaMudanca,
  interpretarAutonomiaIa,
  mudancasTecnicas,
} from "./policy";

const anterior = {
  provider: "anthropic",
  model: "modelo-atual",
  credential_id: "cred-atual",
  operator_model: "operador-atual",
  base_url: "https://api.exemplo.test",
  is_enabled: true,
};

describe("ELUS360 — autonomia técnica de IA (fail closed)", () => {
  it("não aceita concessões por valores truthy, arrays ou JSON incompleto", () => {
    expect(interpretarAutonomiaIa({ provider: "true", model: 1, credentials: {}, operator_model: true })).toEqual({
      provider: false, model: false, credentials: false, operator_model: true,
    });
    expect(interpretarAutonomiaIa([])).toEqual(AUTONOMIA_IA_PADRAO);
    expect(interpretarAutonomiaIa(null)).toEqual(AUTONOMIA_IA_PADRAO);
  });

  it("bloqueia alteração técnica sem nenhum grant", () => {
    const result = avaliarAutonomiaParaMudanca(null, anterior, {
      provider: "chutes", model: "modelo-novo", credential_id: "cred-nova",
      operator_model: "operador-novo", base_url: "https://outro.exemplo.test",
      is_enabled: false,
    });
    expect(result).toEqual({
      permitido: false, motivo: "forbidden_platform_ai",
      negados: ["provider", "model", "credentials", "operator_model"],
    });
  });

  it("cada grant libera somente seus próprios campos técnicos", () => {
    expect(avaliarAutonomiaParaMudanca({ model: true }, anterior, {
      model: "modelo-novo",
    }).permitido).toBe(true);
    expect(avaliarAutonomiaParaMudanca({ model: true }, anterior, {
      model: "modelo-novo", credential_id: "cred-nova",
    })).toEqual({
      permitido: false, motivo: "forbidden_platform_ai", negados: ["credentials"],
    });
    expect(avaliarAutonomiaParaMudanca({ credentials: true }, anterior, {
      provider: "chutes",
    })).toEqual({
      permitido: false, motivo: "forbidden_platform_ai", negados: ["provider"],
    });
  });

  it("a revogação de um grant torna a alteração proibida imediatamente na política", () => {
    const change = { operator_model: "operador-novo" };
    expect(avaliarAutonomiaParaMudanca({ operator_model: true }, anterior, change).permitido).toBe(true);
    expect(avaliarAutonomiaParaMudanca({ operator_model: false }, anterior, change)).toEqual({
      permitido: false, motivo: "forbidden_platform_ai", negados: ["operator_model"],
    });
  });

  it("não confunde reenvio idêntico com alteração, mas reconhece null explícito", () => {
    expect(mudancasTecnicas(anterior, { provider: anterior.provider, model: anterior.model })).toEqual([]);
    expect(mudancasTecnicas(anterior, { credential_id: null })).toEqual(["credentials"]);
    expect(avaliarAutonomiaParaMudanca(null, anterior, { model: anterior.model }).permitido).toBe(true);
  });

  it("falha fechado quando não existe referência confiável ou a proposta é inválida", () => {
    expect(avaliarAutonomiaParaMudanca(null, null, { model: "qualquer" })).toEqual({
      permitido: false, motivo: "referencia_indisponivel", negados: [],
    });
    expect(avaliarAutonomiaParaMudanca(null, anterior, null)).toEqual({
      permitido: false, motivo: "proposta_invalida", negados: [],
    });
  });
});
