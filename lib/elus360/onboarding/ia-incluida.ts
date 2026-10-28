/**
 * Extensão ELUS 360: apresentação da IA incluída no PRIMEIRO acesso.
 *
 * O trigger oficial cria organizações com um padrão provisório Anthropic.
 * Só o aceite do primeiro passo escolhe e grava o par Chutes + modelo usando
 * definirPadraoDeIaDaOrganizacao; este módulo NÃO altera banco nem credenciais.
 *
 * Mantém o DeskcommCRM intacto quando a feature flag está desligada.
 */
import type { FonteDeAmbiente } from "@/lib/instalacao/ambiente";

export type EstadoChutesIncluido = "modelo_disponivel" | "catalogo_pendente";

export interface ContextoOfertaChutes {
  ambiente: FonteDeAmbiente;
  provedorAtual: string;
  onboardingConcluido: boolean;
  boasVindasAceitas: boolean;
  credencialDaOrganizacao: boolean;
}

/**
 * Não oferecer uma troca implícita quando o cliente já fez sua escolha.
 * Uma chave apenas PRESENTE na instalação não significa que há modelo apto.
 */
export function deveOferecerChutesIncluido(ctx: ContextoOfertaChutes): boolean {
  if (ctx.ambiente.ELUS_DEFAULT_AI_PROVIDER?.trim().toLowerCase() !== "chutes") return false;
  if (!ctx.ambiente.CHUTES_API_KEY?.trim()) return false;
  if (ctx.onboardingConcluido || ctx.boasVindasAceitas || ctx.credencialDaOrganizacao) return false;
  return ctx.provedorAtual === "anthropic" || ctx.provedorAtual === "chutes";
}

/** Rótulo verdadeiro: modelo compatível no catálogo é diferente de chave existente. */
// A origem técnica (Chutes) fica interna: o cliente vê a IA incluída na marca ELUS.
export function estadoChutesIncluido(modeloComFerramentas: boolean): EstadoChutesIncluido {
  return modeloComFerramentas ? "modelo_disponivel" : "catalogo_pendente";
}

export function textoChutesIncluido(
  estado: EstadoChutesIncluido,
  idioma: "pt-BR" | "es",
): string {
  if (idioma === "es") {
    return estado === "modelo_disponivel"
      ? "IA incluida en ELUS 360 — disponible para activar al continuar"
      : "IA incluida en ELUS 360 — clave configurada; catálogo de modelos pendiente";
  }
  return estado === "modelo_disponivel"
    ? "IA incluída no ELUS 360 — disponível para ativar ao continuar"
    : "IA incluída no ELUS 360 — chave configurada; catálogo de modelos pendente";
}
