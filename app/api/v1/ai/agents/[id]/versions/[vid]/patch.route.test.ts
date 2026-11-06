import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { loadAuthUser } from "@/lib/auth/server";
import { requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));
// O escopo cruza outras tabelas: validarEscopoDaVersao tem testes próprios em
// tests/unit/versao-do-agente-referencias-da-org.test.ts. Aqui aferimos também
// a chamada, organização e recusa, sem substituir seu guard na rota.
vi.mock("@/lib/ai/agents/escopo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/agents/escopo")>()),
  validarEscopoDaVersao: vi.fn(async () => ({ ok: true as const })),
}));
// A sessao real exige request scope do Next. Mockar somente as fronteiras de I/O,
// preservando as decisoes da rota e a politica tecnica efetiva.
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdminEscrita: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
// #2052: a rota deixou de chamar `requireRole` direto e passou pelo
// `resolveAuthDual` (sessão OU Bearer). O helper chama `createClient()` do
// servidor no ramo de sessão, que precisa do escopo de request do Next — coisa
// que este teste isolado não tem. O que este arquivo prova é o PATCH, não o
// auth: quem prova o caminho aceito/recusado é
// `tests/unit/configuracao-do-agente-por-token-aceita-e-recusa.test.ts`.
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(async () => ({
    ok: true,
    organizationId: "22222222-2222-4222-8222-222222222222",
    actor: { type: "user", id: "11111111-1111-4111-8111-111111111111" },
    supabase: {},
    idioma: "pt-BR",
    via: "session",
  })),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const FLOW = "55555555-5555-4555-8555-555555555555";
const FUNIL = "66666666-6666-4666-8666-666666666666";
const MATERIAL = "77777777-7777-4777-8777-777777777777";

const followupExistente = {
  enabled: true,
  flow_pointer_ids: [FLOW],
  send_window: null,
  callback_enabled: true,
};

// A escrita governada e atomica usa RPC, nunca .update() direto.
const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
const filtrosVersao: Array<[string, unknown]> = [];
const AUTONOMIA_PADRAO = {
  provider: false, model: false, credentials: false, operator_model: false,
};

function adminStub(
  atualizacoes: Record<string, unknown>[],
  followup: Record<string, unknown> = followupExistente,
  autonomia = AUTONOMIA_PADRAO,
) {
  const existente = {
    id: VERSION, status: "draft", agent_id: AGENT, organization_id: ORG,
    system_prompt: "Prompt original do agente",
    provider: "chutes", model: "modelo-original", credential_id: null,
    operator_model: null, followup,
  };
  return {
    from: (tabela: string) => {
      if (tabela !== "ai_agent_versions" && tabela !== "organizations") {
        throw new Error("Tabela inesperada no teste: " + tabela);
      }
      const filtros: Record<string, unknown> = {};
      const cadeia: Record<string, unknown> = {};
      cadeia.select = () => cadeia;
      cadeia.eq = (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        if (tabela === "ai_agent_versions") filtrosVersao.push([coluna, valor]);
        return cadeia;
      };
      cadeia.maybeSingle = async () => ({
        data: tabela === "organizations"
          ? (filtros.id === ORG ? { ai_autonomy: autonomia } : null)
          : (filtros.organization_id === ORG && filtros.agent_id === AGENT && filtros.id === VERSION
            ? existente : null),
        error: null,
      });
      return cadeia;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      if (nome !== "fn_elus_ai_version_patch_guarded") throw new Error("RPC inesperada");
      const patch = args.p_patch as Record<string, unknown>;
      // Dublê fail-closed apenas do contrato de retorno; nao prova a funcao SQL.
      if (patch.model !== undefined && patch.model !== existente.model &&
          args.p_platform_bypass !== true && autonomia.model !== true) {
        return { data: { error: "forbidden_platform_ai" }, error: null };
      }
      atualizacoes.push(patch);
      return { data: { id: VERSION, ...patch }, error: null };
    },
  };
}

async function executarPatch(body: Record<string, unknown>) {
  const { PATCH } = await import("./route");
  const req = new NextRequest("http://localhost/api/v1/ai/agents/x/versions/y", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: AGENT, vid: VERSION }) });
}

describe("PATCH .../versions/:vid — atualização parcial", () => {
  const atualizacoes: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    atualizacoes.length = 0;
    chamadasRpc.length = 0;
    filtrosVersao.length = 0;
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: ORG, actor: { type: "user", id: USER },
      supabase: {}, idioma: "pt-BR", via: "session",
    } as never);
    vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(null);
    vi.mocked(requirePlatformAdminEscrita).mockResolvedValue({} as never);

    const user: AuthUser = {
      id: USER,
      email: "admin@example.com",
      full_name: null,
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [{ organization_id: ORG, organization_name: "Org", role: "admin" }],
    };
    vi.mocked(loadAuthUser).mockResolvedValue(user);
    vi.mocked(createAdminClient).mockReturnValue(adminStub(atualizacoes) as never);
    vi.mocked(validarEscopoDaVersao).mockResolvedValue({ ok: true } as never);
  });

  // O funil e o material entravam só no schema, não no objeto de escrita: a
  // resposta era 200 e a versão seguia com a lista antiga. Integrações por
  // token chegam aqui; a tela usa `saveAgentDraftAction`, que já gravava.
  it("grava o escopo de funil e de material, e os submete à conferência", async () => {
    const { PATCH } = await import("./route");
    const request = new NextRequest("http://localhost/api/v1/ai/agents/x/versions/y", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pipeline_ids: [FUNIL], knowledge_source_ids: [MATERIAL] }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: AGENT, vid: VERSION }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(validarEscopoDaVersao).mock.calls.at(-1)?.[2]).toMatchObject({
      pipeline_ids: [FUNIL],
      knowledge_source_ids: [MATERIAL],
    });
    expect(atualizacoes).toEqual([
      { pipeline_ids: [FUNIL], knowledge_source_ids: [MATERIAL] },
    ]);
    expect(chamadasRpc[0]).toMatchObject({
      nome: "fn_elus_ai_version_patch_guarded",
      args: { p_org: ORG, p_agent: AGENT, p_version: VERSION,
        p_platform_bypass: false,
        p_expected: { provider: "chutes", model: "modelo-original",
          credential_id: null, operator_model: null },
      },
    });
    expect(filtrosVersao).toEqual(expect.arrayContaining([
      ["id", VERSION], ["organization_id", ORG], ["agent_id", AGENT],
    ]));
    expect(vi.mocked(requirePlatformAdminEscrita)).not.toHaveBeenCalled();
  });

  it("esvazia o escopo quando a lista vem vazia", async () => {
    const { PATCH } = await import("./route");
    const request = new NextRequest("http://localhost/api/v1/ai/agents/x/versions/y", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ knowledge_source_ids: [] }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: AGENT, vid: VERSION }),
    });

    expect(response.status).toBe(200);
    expect(atualizacoes).toEqual([{ knowledge_source_ids: [] }]);
  });

  it("muda somente a janela e preserva o restante da configuração", async () => {
    const sendWindow = {
      start: "09:00",
      end: "18:00",
      weekdays: [1, 2, 3, 4, 5],
    };
    const { PATCH } = await import("./route");
    const request = new NextRequest("http://localhost/api/v1/ai/agents/x/versions/y", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followup: { send_window: sendWindow } }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: AGENT, vid: VERSION }),
    });

    expect(response.status).toBe(200);
    expect(atualizacoes).toEqual([
      {
        followup: {
          enabled: true,
          flow_pointer_ids: [FLOW],
          send_window: sendWindow,
          callback_enabled: true,
        },
      },
    ]);
  });

  it("altera callback_enabled isoladamente e preserva followup normal e a janela", async () => {
    const sendWindow = { start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };
    const { PATCH } = await import("./route");
    const request = new NextRequest("http://localhost/api/v1/ai/agents/x/versions/y", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followup: { callback_enabled: false } }),
    });

    // Este caso comprova também que o estado existente é o mesmo JSON que o PATCH parcial mescla.
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub(atualizacoes, { ...followupExistente, send_window: sendWindow }) as never,
    );
    const response = await PATCH(request, {
      params: Promise.resolve({ id: AGENT, vid: VERSION }),
    });

    expect(response.status).toBe(200);
    expect(atualizacoes).toEqual([
      {
        followup: {
          enabled: true,
          flow_pointer_ids: [FLOW],
          send_window: sendWindow,
          callback_enabled: false,
        },
      },
    ]);
  });
  it("sessao comum nao pode alterar modelo sem concessao tecnica", async () => {
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden_platform_ai");
    expect(chamadasRpc).toEqual([]);
    expect(atualizacoes).toEqual([]);
    expect(vi.mocked(requirePlatformAdminEscrita)).not.toHaveBeenCalled();
  });

  it("Superadmin full com MFA validado usa RPC atomica com bypass explicito", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({
      id: USER, is_platform_admin: true, platform_admin_scope: "full", support: null,
    } as never);
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(200);
    expect(vi.mocked(requirePlatformAdminEscrita)).toHaveBeenCalledTimes(1);
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0]).toMatchObject({
      nome: "fn_elus_ai_version_patch_guarded",
      args: { p_org: ORG, p_agent: AGENT, p_version: VERSION,
        p_patch: { model: "modelo-outro" },
        p_expected: { model: "modelo-original" },
        p_platform_bypass: true,
      },
    });
    expect(atualizacoes).toEqual([{ model: "modelo-outro" }]);
  });

  it("Superadmin sem MFA comprovado nao recebe bypass e RPC rejeita escrita tecnica", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({
      id: USER, is_platform_admin: true, platform_admin_scope: "full", support: null,
    } as never);
    vi.mocked(requirePlatformAdminEscrita).mockRejectedValueOnce(new Error("mfa_required"));
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden_platform_ai");
    expect(chamadasRpc[0]?.args.p_platform_bypass).toBe(false);
    expect(atualizacoes).toEqual([]);
  });

  it("identidade sem autorizacao e recusada antes da consulta e da RPC", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValueOnce({
      ok: false, response: new Response(null, { status: 403 }),
    } as never);
    const response = await executarPatch({ pipeline_ids: [FUNIL] });
    expect(response.status).toBe(403);
    expect(chamadasRpc).toHaveLength(0);
    expect(filtrosVersao).toHaveLength(0);
    expect(vi.mocked(loadAuthUser)).not.toHaveBeenCalled();
  });

  it("token com escopo e teto valido faz PATCH nao tecnico sem bypass", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: ORG, actor: { type: "api_token", id: "tok-1" },
      apiTokenId: "tok-1", supabase: {}, via: "token", scopes: ["config:write"],
    } as never);
    const response = await executarPatch({ knowledge_source_ids: [MATERIAL] });
    expect(response.status).toBe(200);
    expect(vi.mocked(tetoDeEscritaDoToken)).toHaveBeenCalledWith(
      expect.objectContaining({ via: "token", organizationId: ORG }),
      "ai_agents", expect.any(String),
    );
    expect(chamadasRpc[0]?.args.p_platform_bypass).toBe(false);
    expect(vi.mocked(loadAuthUser)).not.toHaveBeenCalled();
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: null, actorApiTokenId: "tok-1", organizationId: ORG,
    }));
  });

  it("token sem concessao tecnica bloqueia model antes da RPC", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: ORG, actor: { type: "api_token", id: "tok-1" },
      apiTokenId: "tok-1", supabase: {}, via: "token", scopes: ["config:write"],
    } as never);
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden_platform_ai");
    expect(chamadasRpc).toEqual([]);
    expect(vi.mocked(loadAuthUser)).not.toHaveBeenCalled();
  });

  it("token com concessao tecnica validada grava pela RPC sem bypass", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: ORG, actor: { type: "api_token", id: "tok-1" },
      apiTokenId: "tok-1", supabase: {}, via: "token", scopes: ["config:write"],
    } as never);
    vi.mocked(createAdminClient).mockReturnValue(adminStub(atualizacoes, followupExistente, {
      ...AUTONOMIA_PADRAO, model: true,
    }) as never);
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(200);
    expect(chamadasRpc[0]?.args.p_platform_bypass).toBe(false);
    expect(atualizacoes).toEqual([{ model: "modelo-outro" }]);
    expect(vi.mocked(loadAuthUser)).not.toHaveBeenCalled();
  });

  it("token bloqueado por teto nao chega a leitura ou RPC", async () => {
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: ORG, actor: { type: "api_token", id: "tok-1" },
      apiTokenId: "tok-1", supabase: {}, via: "token", scopes: ["config:write"],
    } as never);
    vi.mocked(tetoDeEscritaDoToken).mockResolvedValueOnce(new Response(null, { status: 429 }));
    const response = await executarPatch({ model: "modelo-outro" });
    expect(response.status).toBe(429);
    expect(chamadasRpc).toEqual([]);
    expect(filtrosVersao).toEqual([]);
  });

  it("organizacao diferente nao le nem grava a versao", async () => {
    const OUTRA_ORG = "88888888-8888-4888-8888-888888888888";
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true, organizationId: OUTRA_ORG, actor: { type: "user", id: USER },
      supabase: {}, via: "session",
    } as never);
    const response = await executarPatch({ pipeline_ids: [FUNIL] });
    expect(response.status).toBe(404);
    expect(filtrosVersao).toContainEqual(["organization_id", OUTRA_ORG]);
    expect(chamadasRpc).toEqual([]);
  });

  it("escopo invalido impede escrita pela RPC", async () => {
    vi.mocked(validarEscopoDaVersao).mockResolvedValueOnce({
      ok: false, campo: "pipeline_ids", ausentes: [FUNIL],
    } as never);
    const response = await executarPatch({ pipeline_ids: [FUNIL] });
    expect(response.status).toBe(422);
    expect(chamadasRpc).toEqual([]);
  });

});
