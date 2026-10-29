/**
 * ELUS360 — contrato do padrão de IA definido pela plataforma para um tenant.
 * Nunca substitui settings inteiro: identidade visual, MFA e outros campos
 * compartilham o mesmo JSONB. O endpoint autorizado faz a gravação CAS.
 */
export interface PadraoLlmDaOrganizacao {
  provider: string;
  default_model: string | null;
  credential_id: string | null;
  configured: boolean;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

export function lerPadraoLlmDaOrganizacao(settings: unknown): PadraoLlmDaOrganizacao {
  const llm = objeto(objeto(settings).llm);
  const provider = typeof llm.provider === "string" && llm.provider.trim() !== ""
    ? llm.provider : "anthropic";
  const default_model = typeof llm.default_model === "string" && llm.default_model.trim() !== ""
    ? llm.default_model : null;
  const credential_id = typeof llm.credential_id === "string" && llm.credential_id.trim() !== ""
    ? llm.credential_id : null;
  return { provider, default_model, credential_id, configured: default_model !== null };
}

export function mesclarPadraoLlmDaOrganizacao(
  settings: unknown,
  padrao: { provider: string; default_model: string; credential_id: string | null },
): Record<string, unknown> {
  const atuais = objeto(settings);
  return {
    ...atuais,
    llm: { ...objeto(atuais.llm), provider: padrao.provider,
      default_model: padrao.default_model, credential_id: padrao.credential_id },
  };
}
