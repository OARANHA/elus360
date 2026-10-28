/**
 * Catálogo Chutes.ai — endpoint público OpenAI-compatível.
 * Diferentemente da OpenRouter, os preços são USD por MILHÃO de tokens.
 * Falta de metadados não vira preço zero nem capacidade inventada.
 */
import type { LinhaDeCatalogo } from "./openrouter";

export const FONTE_CHUTES = "chutes";
export const CHUTES_CATALOG_URL = "https://llm.chutes.ai/v1/models";

export interface ModeloChutes {
  id?: string;
  context_length?: number;
  pricing?: { prompt?: number | string; completion?: number | string };
  supported_features?: string[];
  input_modalities?: string[];
}

/** USD por milhão -> centavos por milhão; ausente fica null. */
export function precoChutesCents(v: number | string | undefined): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n * 100) : null;
}

export function traduzirCatalogoChutes(modelos: readonly ModeloChutes[]): LinhaDeCatalogo[] {
  const porId = new Map<string, LinhaDeCatalogo>();
  for (const m of modelos) {
    const id = m.id?.trim() ?? "";
    if (!id || !Array.isArray(m.supported_features)) continue;
    porId.set(id, {
      provider: FONTE_CHUTES,
      model_id: id,
      display_name: id,
      description: null,
      context_window: Number.isFinite(m.context_length) ? m.context_length! : null,
      input_price_per_million_cents: precoChutesCents(m.pricing?.prompt),
      output_price_per_million_cents: precoChutesCents(m.pricing?.completion),
      supports_tools: m.supported_features.includes("tools"),
      supports_vision: Array.isArray(m.input_modalities) && m.input_modalities.includes("image"),
      source: FONTE_CHUTES,
    });
  }
  return [...porId.values()];
}
