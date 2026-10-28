import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";
import { JaEstaPronto } from "@/app/onboarding/_components/JaEstaPronto";
import { deveOferecerChutesIncluido } from "@/lib/elus360/onboarding/ia-incluida";

type Row = Record<string, unknown>;
const ORG = "11111111-1111-4111-8111-111111111111";

function dbFalso(opts: {
  catalogo?: boolean;
  boasVindasAceitas?: boolean;
  onboarded?: boolean;
  comByok?: boolean;
  provedor?: string;
}) {
  const linhas: Record<string, Row[]> = {
    organizations: [{
      id: ORG,
      slug: "elus-360",
      display_name: "ELUS 360",
      settings: { llm: { provider: opts.provedor ?? "anthropic", default_model: "claude-sonnet-5" } },
      onboarding_state: opts.boasVindasAceitas ? { welcome: { accepted_at: "2026-10-28T00:00:00Z" } } : {},
      onboarded_at: opts.onboarded ? "2026-10-28T00:00:00Z" : null,
    }],
    ai_provider_credentials: opts.comByok ? [{
      organization_id: ORG, provider: opts.provedor ?? "anthropic",
      is_active: true, validated_at: "2026-10-28T00:00:00Z",
      id: "cred-1", label: "Cliente", api_key_last4: "1234",
    }] : [],
    ai_models: [
      { provider: "anthropic", model_id: "claude-sonnet-5", is_default_for_provider: true, deprecated_at: null },
      ...(opts.catalogo ? [{
        provider: "chutes", model_id: "Modelo/ComTools",
        supports_tools: true, deprecated_at: null, is_default_for_provider: false,
      }] : []),
    ],
    crm_pipelines: [],
  };

  return {
    from(tabela: string) {
      let dados = [...(linhas[tabela] ?? [])];
      const query = {
        select() { return query; },
        eq(coluna: string, valor: unknown) {
          dados = dados.filter((linha) => linha[coluna] === valor);
          return query;
        },
        is(coluna: string, valor: unknown) {
          dados = dados.filter((linha) => valor === null ? linha[coluna] == null : linha[coluna] === valor);
          return query;
        },
        order() { return query; },
        limit(n: number) { dados = dados.slice(0, n); return query; },
        maybeSingle() { return Promise.resolve({ data: dados[0] ?? null, error: null }); },
        then(ok: (v: { data: Row[]; error: null }) => unknown, fail?: (e: unknown) => unknown) {
          return Promise.resolve({ data: dados, error: null }).then(ok, fail);
        },
      };
      return query;
    },
  } as never;
}

const CHUTES_ON = {
  ELUS_DEFAULT_AI_PROVIDER: "chutes",
  CHUTES_API_KEY: "chave-ficticia-somente-teste",
};

async function retrato(
  opcoes: Parameters<typeof dbFalso>[0],
  ambiente: Record<string, string | undefined> = CHUTES_ON,
) {
  return lerRetratoDaInstalacao({ supabase: dbFalso(opcoes), orgId: ORG, ambiente });
}

describe("ELUS 360 — aviso de IA incluída antes do primeiro aceite", () => {
  it("detecta chave e catálogo reais, sem exigir outra chave do cliente", async () => {
    const r = await retrato({ catalogo: true });
    expect(r.inteligencia.provedor).toBe("anthropic"); // trigger ainda não foi alterado
    expect(r.inteligencia.origemDaChave).toBe("nenhuma");
    expect(r.inteligencia.ofertaChutes).toBe("modelo_disponivel");
    expect(r.inteligencia.prontaParaPublicar).toBe(false); // não ativa agente antes do aceite
    const html = renderToStaticMarkup(createElement(JaEstaPronto, { retrato: r, idioma: "pt-BR" }));
    expect(html).not.toContain("Chutes.ai");
    expect(html).toContain("IA incluída no ELUS 360 — disponível para ativar ao continuar");
    expect(html).not.toContain("Falta a chave da inteligência artificial");
    expect(html).not.toContain(CHUTES_ON.CHUTES_API_KEY);
  });

  it("sem modelos com ferramentas, mostra catálogo pendente sem dizer que falta chave", async () => {
    const r = await retrato({ catalogo: false });
    expect(r.inteligencia.ofertaChutes).toBe("catalogo_pendente");
    const html = renderToStaticMarkup(createElement(JaEstaPronto, { retrato: r, idioma: "pt-BR" }));
    expect(html).toContain("IA incluída no ELUS 360 — chave configurada; catálogo de modelos pendente");
    expect(html).not.toContain("Chutes.ai");
    expect(html).not.toContain("Falta a chave da inteligência artificial");
  });

  it("desligar a flag mantém exatamente o aviso original do DeskcommCRM", async () => {
    const r = await retrato({ catalogo: true }, { CHUTES_API_KEY: CHUTES_ON.CHUTES_API_KEY });
    expect(r.inteligencia.ofertaChutes).toBeNull();
    const html = renderToStaticMarkup(createElement(JaEstaPronto, { retrato: r, idioma: "pt-BR" }));
    expect(html).toContain("Falta a chave da inteligência artificial");
  });

  it("não anuncia oferta sem chave ou após concluir/aceitar onboarding", async () => {
    expect((await retrato({ catalogo: true }, { ELUS_DEFAULT_AI_PROVIDER: "chutes" })).inteligencia.ofertaChutes).toBeNull();
    expect((await retrato({ catalogo: true, boasVindasAceitas: true })).inteligencia.ofertaChutes).toBeNull();
    expect((await retrato({ catalogo: true, onboarded: true })).inteligencia.ofertaChutes).toBeNull();
  });

  it("preserva BYOK e o provedor que o cliente escolheu", async () => {
    expect((await retrato({ catalogo: true, comByok: true })).inteligencia.ofertaChutes).toBeNull();
    expect((await retrato({ catalogo: true, provedor: "openai" })).inteligencia.ofertaChutes).toBeNull();
  });

  it("a decisão de oferta não altera o banco nem inspeciona o segredo", () => {
    expect(deveOferecerChutesIncluido({
      ambiente: CHUTES_ON, provedorAtual: "anthropic",
      onboardingConcluido: false, boasVindasAceitas: false, credencialDaOrganizacao: false,
    })).toBe(true);
    expect(deveOferecerChutesIncluido({
      ambiente: { ...CHUTES_ON, ELUS_DEFAULT_AI_PROVIDER: "" }, provedorAtual: "anthropic",
      onboardingConcluido: false, boasVindasAceitas: false, credencialDaOrganizacao: false,
    })).toBe(false);
  });
});
