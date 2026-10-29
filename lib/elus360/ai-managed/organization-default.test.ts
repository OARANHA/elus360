import { describe, expect, it } from "vitest";
import {
  lerPadraoLlmDaOrganizacao,
  mesclarPadraoLlmDaOrganizacao,
} from "./organization-default";

describe("ELUS360 — padrão de IA por organização", () => {
  it("interpreta ausência de configuração sem inventar modelo ou credencial", () => {
    expect(lerPadraoLlmDaOrganizacao(null)).toEqual({
      provider: "anthropic", default_model: null, credential_id: null, configured: false,
    });
    expect(lerPadraoLlmDaOrganizacao({ llm: [] }).configured).toBe(false);
  });

  it("lê provedor, modelo e credencial do mesmo contrato usado no onboarding", () => {
    expect(lerPadraoLlmDaOrganizacao({ llm: {
      provider: "chutes", default_model: "modelo-validado", credential_id: "cred-1",
    } })).toEqual({
      provider: "chutes", default_model: "modelo-validado", credential_id: "cred-1", configured: true,
    });
  });

  it("não sobrescreve branding, segurança ou preferências técnicas já existentes", () => {
    const atual = {
      branding: { name: "ELUS" }, security: { mfa: true },
      llm: { provider: "anthropic", default_model: "modelo-antigo", params: { temperature: 0.5 }, enabled_models: ["a"] },
    };
    const novo = mesclarPadraoLlmDaOrganizacao(atual, {
      provider: "chutes", default_model: "novo", credential_id: null,
    });
    expect(novo).toMatchObject({
      branding: { name: "ELUS" }, security: { mfa: true },
      llm: { provider: "chutes", default_model: "novo", credential_id: null,
        params: { temperature: 0.5 }, enabled_models: ["a"] },
    });
    expect(atual.llm.provider).toBe("anthropic");
  });
});
