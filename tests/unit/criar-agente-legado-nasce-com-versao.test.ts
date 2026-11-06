/**
 * CRIAR AGENTE, UM SÓ CAMINHO: o corpo legado (sem `version`) nasce
 * `kind='mcp_agent'` COM v1 em `ai_agent_versions` — nunca `rag_bot` sem
 * versão (issue #1357).
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * O "Modo A" do `POST /api/v1/ai/agents` gravava `kind='rag_bot'` direto em
 * `ai_agents` (o DEFAULT da coluna), sem NENHUMA linha em
 * `ai_agent_versions`. Os dois runtimes atuais resolvem o agente pelo join
 * `ai_agent_versions v on v.id = a.published_version_id`
 * (`lib/agent-engine/agent/agent-config.ts`), então o agente recém-criado era
 * invisível para o motor — nascia mudo, e a única saída era a recuperação
 * legada da tela. Criar pela API e criar pela tela davam resultados de mundos
 * diferentes.
 *
 * ─── O que este teste prova ─────────────────────────────────────────────────
 *
 * 1. corpo legado ⇒ UM insert em `ai_agents` com `kind: "mcp_agent"` + UM
 *    insert em `ai_agent_versions` (v1 draft) com o MESMO `system_prompt` e o
 *    `model` legado repartido em `provider`/`model`;
 * 2. o formato da RESPOSTA do corpo legado não muda (a linha do agente) — quem
 *    consome 2026-04 não quebra, ganha o conserto por dentro;
 * 3. o Modo B (corpo com `version`) segue devolvendo `{ agent, version }` — a
 *    união dos dois caminhos num bloco só não mudou o contrato de nenhum.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { corpoLegadoParaVersao } from "@/lib/ai/agents/legado-para-versao";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { podeAlterarTecnicaDeVersao } from "@/lib/elus360/ai-managed/authorize-version-write";

vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(),
  tetoDeEscritaDoToken: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
// Os casos positivos medem a criação quando o tenant possui autonomia técnica.
// As negações reais continuam cobertas pelas suítes ELUS de autorização e RLS.
vi.mock("@/lib/elus360/ai-managed/authorize-version-write", () => ({
  podeAlterarTecnicaDeVersao: vi.fn(async () => true),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

/** Inserts capturados por tabela, na ordem em que a rota os fez. */
let gravados: Record<string, Record<string, unknown>[]>;

/** A ÚLTIMA linha gravada numa tabela — falha alto se a rota não gravou nada. */
function gravado(tabela: string): Record<string, unknown> {
  const fila = gravados[tabela];
  const linha = fila?.[fila.length - 1];
  if (linha === undefined) throw new Error(`a rota não gravou nada em ${tabela}`);
  return linha;
}

function adminFake() {
  gravados = {};
  return {
    from(tabela: string) {
      if (tabela === "organizations") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: { settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } } },
            error: null,
          }),
        };
        return q;
      }
      const fila = (gravados[tabela] ??= []);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.single = async () => ({ data: fila.at(-1) ?? null, error: null });
      return q;
    },
    // A criação agora é um único RPC transacional com duas linhas, não dois
    // inserts independentes. O dublê inspeciona o payload antes de simular a transação.
    async rpc(name: string, args: {
      p_org: string;
      p_agent: Record<string, unknown>;
      p_version: Record<string, unknown>;
      p_platform_bypass: boolean;
    }) {
      if (name !== "fn_elus_ai_agent_create_guarded" || args.p_org !== ORG) {
        return { data: null, error: { code: "42501", message: "forbidden" } };
      }
      const agent = { ...args.p_agent, id: "ai_agents-id", organization_id: ORG };
      const version = {
        ...args.p_version,
        id: "ai_agent_versions-id",
        organization_id: ORG,
        agent_id: agent.id,
      };
      (gravados.ai_agents ??= []).push(agent);
      (gravados.ai_agent_versions ??= []).push(version);
      return { data: { agent, version }, error: null };
    },
  };
}

function post(corpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/ai/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(null);
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    organizationId: ORG,
    idioma: "pt-BR",
    actor: { type: "user", id: USER },
    apiTokenId: null,
  } as unknown as Awaited<ReturnType<typeof resolveAuthDual>>);
  vi.mocked(createAdminClient).mockReturnValue(adminFake() as never);
  vi.mocked(podeAlterarTecnicaDeVersao).mockResolvedValue(true);
});

describe("POST /api/v1/ai/agents — Modo A (corpo legado, sem `version`)", () => {
  it("nasce mcp_agent + v1 draft, com o prompt e o model do corpo legado", async () => {
    const res = await (
      await import("@/app/api/v1/ai/agents/route")
    ).POST(
      post({
        name: "Tobias",
        system_prompt: "Você é o Tobias, atendente da loja.",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    expect(res.status, await res.clone().text()).toBe(201);

    // A coluna `kind` NÃO pode ficar por conta do DEFAULT do banco ('rag_bot').
    expect(gravados.ai_agents).toHaveLength(1);
    expect(gravado("ai_agents").kind).toBe("mcp_agent");
    expect(gravado("ai_agents").name).toBe("Tobias");

    // E a versão nasce junto — sem ela o agente é invisível para o dispatcher.
    expect(gravados.ai_agent_versions).toHaveLength(1);
    const versao = gravado("ai_agent_versions");
    expect(versao.system_prompt).toBe("Você é o Tobias, atendente da loja.");
    expect(versao.provider).toBe("anthropic");
    expect(versao.model).toBe("claude-sonnet-4-6");
    expect(versao.agent_id).toBe(gravado("ai_agents").id);
  });

  it("sem `model` no corpo, mantém o default que o Modo A sempre gravou", async () => {
    const res = await (
      await import("@/app/api/v1/ai/agents/route")
    ).POST(post({ name: "Tobias", system_prompt: "Você é o Tobias, atendente da loja." }));

    expect(res.status, await res.clone().text()).toBe(201);
    // Antes do #2296: `input.model ?? "anthropic/claude-sonnet-5"`. Não o
    // DEFAULT da coluna (`claude-sonnet-4-6`) que a ponte usa sem `model`.
    expect(gravado("ai_agents").model).toBe("anthropic/claude-sonnet-5");
    expect(gravado("ai_agent_versions").model).toBe("claude-sonnet-5");
  });

  it("o formato da resposta do corpo legado continua sendo a linha do agente", async () => {
    const res = await (
      await import("@/app/api/v1/ai/agents/route")
    ).POST(
      post({
        name: "Tobias",
        system_prompt: "Você é o Tobias, atendente da loja.",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const { data } = await res.json();
    // Ainda é a LINHA (não `{ agent, version }`): integrador 2026-04 não muda.
    expect(data).toMatchObject({ name: "Tobias", kind: "mcp_agent" });
    expect(data.agent).toBeUndefined();
    expect(data.version).toBeUndefined();
  });

  it("model legado sem barra cai no provedor padrão, sem inventar modelo", () => {
    // A rota não deixa isto chegar nela (o `agentCreateSchema` recusa model
    // fora do enum com 422), mas a ponte é compartilhada com a DUPLICAÇÃO, que
    // lê `ai_agents.model` direto do banco — onde o valor antigo sem barra
    // existe. Nela, sem barra = provedor padrão, nunca um modelo inventado.
    expect(
      corpoLegadoParaVersao({ system_prompt: "Prompt longo o bastante.", model: "claude-sonnet-4-6" }),
    ).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(
      corpoLegadoParaVersao({ system_prompt: "Prompt longo o bastante.", model: null }),
    ).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("audita como criação de mcp_agent, marcando o formato do corpo", async () => {
    await (
      await import("@/app/api/v1/ai/agents/route")
    ).POST(
      post({
        name: "Tobias",
        system_prompt: "Você é o Tobias, atendente da loja.",
        model: "anthropic/claude-sonnet-4-6",
      }),
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_agent.created",
        metadata: expect.objectContaining({
          kind: "mcp_agent",
          formato: "legado",
        }),
      }),
    );
  });
});

describe("POST /api/v1/ai/agents — Modo B (corpo com `version`)", () => {
  it("nega criação técnica sem autonomia antes de chamar RPC ou gravar linhas", async () => {
    vi.mocked(podeAlterarTecnicaDeVersao).mockResolvedValueOnce(false);
    const res = await (await import("@/app/api/v1/ai/agents/route")).POST(
      post({
        name: "Tobias",
        version: {
          system_prompt: "Atendente de testes",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          credential_id: null,
          channel_session_id: null,
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(gravados.ai_agents).toBeUndefined();
    expect(gravados.ai_agent_versions).toBeUndefined();
  });

  it("segue devolvendo { agent, version } e gravando as duas linhas", async () => {
    const res = await (
      await import("@/app/api/v1/ai/agents/route")
    ).POST(
      post({
        name: "Tobias",
        priority: 0,
        version: {
          system_prompt: "Você é o Tobias, atendente da loja.",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          channel_session_id: null,
          credential_id: null,
        },
      }),
    );

    expect(res.status, await res.clone().text()).toBe(201);
    const { data } = await res.json();
    expect(data.agent).toMatchObject({ kind: "mcp_agent" });
    expect(data.version).toMatchObject({ system_prompt: "Você é o Tobias, atendente da loja." });
    expect(gravado("ai_agents").kind).toBe("mcp_agent");
    expect(gravados.ai_agent_versions).toHaveLength(1);
  });
});
