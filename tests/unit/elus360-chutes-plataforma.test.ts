import { describe, expect, it } from "vitest";
import { precoChutesCents, traduzirCatalogoChutes } from "@/lib/ai/catalogo/chutes";
import { createDefaultRegistry, CHUTES_ENDPOINT } from "@/lib/agent-engine/edge/llm/providers";
import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { validarParProvedorModelo } from "@/lib/ai/par-provedor-modelo";

describe("Chutes.ai — IA incluída na instalação ELUS 360", () => {
  it("a chave central chega ao onboarding e ao worker, mas não é enviada na resposta do onboarding", () => {
    expect(lerAmbiente({ CHUTES_API_KEY: "cpk_demo" }).chavesDeProvedor.chutes).toBe(true);
    expect(llmEdgeConfigFromEnv({ CHUTES_API_KEY: "cpk_demo" }).chutesApiKey).toBe("cpk_demo");
  });

  it("chave de plataforma não cai em OpenAI nem OpenRouter", () => {
    expect(CHUTES_ENDPOINT).toBe("https://llm.chutes.ai/v1");
    expect(createDefaultRegistry().chutes?.("cpk_demo", "Qwen/Qwen3.8-27B-TEE")).toBeDefined();
    expect(validarParProvedorModelo("chutes", "Qwen/Qwen3.8-27B-TEE")).toEqual({ valido: true });
  });

  it("preço da Chutes é USD por milhão, não USD por token", () => {
    expect(precoChutesCents(0.12)).toBe(12);
    expect(precoChutesCents(0.37)).toBe(37);
    expect(precoChutesCents(undefined)).toBeNull();
  });

  it("não inventa ferramentas, visão nem preços ausentes", () => {
    const linhas = traduzirCatalogoChutes([
      { id: "modelo-com-ferramentas", supported_features: ["tools"], input_modalities: ["image"], pricing: { prompt: 0.12, completion: 0.37 } },
      { id: "modelo-sem-metadados" },
      { id: "modelo-sem-tools", supported_features: [], pricing: {} },
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({
      provider: "chutes", supports_tools: true, supports_vision: true,
      input_price_per_million_cents: 12, output_price_per_million_cents: 37,
    });
    expect(linhas[1]).toMatchObject({
      supports_tools: false, supports_vision: false,
      input_price_per_million_cents: null,
    });
  });
});
