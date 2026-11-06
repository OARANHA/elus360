import { beforeEach, describe, expect, it, vi } from "vitest";
import { EscritaDePlatformAdminNegada } from "@/lib/auth/recusa-de-escrita-de-admin";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdminEscrita: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/agents/escopo", () => ({
  validarEscopoDaVersao: vi.fn(),
  codigoDoEscopo: vi.fn(),
  mensagemDoEscopo: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createMcpAgentAction } from "@/app/app/ai/agents/[id]/_actions";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { validarEscopoDaVersao } from "@/lib/ai/agents/escopo";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = {
  system_prompt: "Você é um atendente de teste controlado.",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  credential_id: null,
  channel_session_id: null,
};
const PAYLOAD = { name: "Agente de teste", version: VERSION };

let grantModel: boolean;
let revokeBeforeWrite: boolean;
let writes: number;

// Dublê do contrato de autorização do RPC. A verificação real de lock,
// grants, rollback e service_role permanece no PostgreSQL descartável do CI.
const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  if (name !== "fn_elus_ai_agent_create_guarded" || args.p_org !== ORG) {
    return { data: null, error: { message: "unexpected_rpc_or_tenant" } };
  }
  const agent = args.p_agent as Record<string, unknown> | undefined;
  const version = args.p_version as Record<string, unknown> | undefined;
  // Espelha o contrato fechado de colunas da migration 9901: o RPC, não a
  // action, escolhe organização, vínculo, versão e status.
  if (!agent || !version || "organization_id" in agent ||
      ["organization_id", "agent_id", "version_number", "status"].some((k) => k in version)) {
    return { data: null, error: { code: "42501", message: "elus_ai_agent_create_version_column_restricted" } };
  }
  if (revokeBeforeWrite) grantModel = false;
  if (!args.p_platform_bypass && !grantModel) {
    return { data: { error: "forbidden_platform_ai" }, error: null };
  }
  writes++;
  return { data: { agent: { id: AGENT }, version: { id: AGENT } }, error: null };
});

function platformUser(support: unknown = null) {
  return {
    id: USER,
    is_platform_admin: true,
    platform_admin_scope: "full",
    support,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  writes = 0;
  grantModel = false;
  revokeBeforeWrite = false;
  vi.mocked(loadAuthUser).mockResolvedValue({
    id: USER, is_platform_admin: false, platform_admin_scope: null, support: null,
  } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({
    orgId: ORG, role: "admin",
  } as never);
  vi.mocked(requirePlatformAdminEscrita).mockResolvedValue({
    user: { id: USER },
    platformAdmin: { user_id: USER, scope: "full", mfa_required: true },
  } as never);
  vi.mocked(validarEscopoDaVersao).mockResolvedValue({ ok: true } as never);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
});

describe("ELUS360: criação de agente por server action não confia no bypass do modelo", () => {
  it("recusa sessão ausente antes de qualquer RPC", async () => {
    vi.mocked(loadAuthUser).mockResolvedValueOnce(null);
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "unauthenticated",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa papel de tenant insuficiente sem consultar o RPC", async () => {
    vi.mocked(resolveActiveOrg).mockResolvedValueOnce({ orgId: ORG, role: "viewer" } as never);
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "forbidden_role",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("admin comum sem grant não consegue criar agente técnico", async () => {
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "forbidden_platform_ai",
    });
    expect(rpc).toHaveBeenCalledWith(
      "fn_elus_ai_agent_create_guarded",
      expect.objectContaining({ p_org: ORG, p_platform_bypass: false }),
    );
    expect(requirePlatformAdminEscrita).not.toHaveBeenCalled();
    expect(writes).toBe(0);
  });

  it("grant do tenant permite a RPC, mas nunca concede bypass de plataforma", async () => {
    grantModel = true;
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "fn_elus_ai_agent_create_guarded",
      expect.objectContaining({ p_org: ORG, p_platform_bypass: false }),
    );
    expect(writes).toBe(1);
  });

  it("não encaminha colunas de escopo geridas pelo RPC ao criar agente", async () => {
    grantModel = true;
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({ ok: true });
    const args = rpc.mock.lastCall?.[1] as Record<string, unknown>;
    const agent = args.p_agent as Record<string, unknown>;
    const version = args.p_version as Record<string, unknown>;
    expect(agent.organization_id).toBeUndefined();
    for (const campo of ["organization_id", "agent_id", "version_number", "status"]) {
      expect(version[campo], campo).toBeUndefined();
    }
    expect(agent.created_by).toBe(USER);
    expect(version.created_by).toBe(USER);
    expect(args.p_platform_bypass).toBe(false);
    expect(writes).toBe(1);
  });

  it("superadmin full com MFA aceito é a única origem de bypass positivo", async () => {
    vi.mocked(loadAuthUser).mockResolvedValueOnce(platformUser() as never);
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({ ok: true });
    expect(requirePlatformAdminEscrita).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "fn_elus_ai_agent_create_guarded",
      expect.objectContaining({ p_org: ORG, p_platform_bypass: true }),
    );
    expect(writes).toBe(1);
  });

  it("MFA pendente retorna recusa nomeada e não executa RPC", async () => {
    vi.mocked(loadAuthUser).mockResolvedValueOnce(platformUser() as never);
    vi.mocked(requirePlatformAdminEscrita).mockRejectedValueOnce(
      new EscritaDePlatformAdminNegada("mfa_required"),
    );
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "mfa_required",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(writes).toBe(0);
  });

  it("admin de plataforma sem scope full ou revogado não recebe bypass", async () => {
    vi.mocked(loadAuthUser).mockResolvedValueOnce(platformUser() as never);
    vi.mocked(requirePlatformAdminEscrita).mockRejectedValueOnce(
      new EscritaDePlatformAdminNegada("forbidden_scope"),
    );
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "forbidden_scope",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sessão de suporte/impersonação não herda bypass de plataforma", async () => {
    vi.mocked(loadAuthUser).mockResolvedValueOnce(platformUser({ status: "active" }) as never);
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "forbidden_platform_ai",
    });
    expect(requirePlatformAdminEscrita).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "fn_elus_ai_agent_create_guarded",
      expect.objectContaining({ p_platform_bypass: false }),
    );
    expect(writes).toBe(0);
  });

  it("revogação de grant antes da escrita bloqueia o tenant", async () => {
    grantModel = true;
    revokeBeforeWrite = true;
    expect(await createMcpAgentAction(PAYLOAD)).toMatchObject({
      ok: false, error: "forbidden_platform_ai",
    });
    expect(writes).toBe(0);
  });

  it("não permite injetar organização nem bypass pelo payload externo", async () => {
    expect(await createMcpAgentAction({
      ...PAYLOAD,
      organization_id: "99999999-9999-4999-8999-999999999999",
      p_platform_bypass: true,
    })).toMatchObject({ ok: false, error: "validation_failed" });
    expect(rpc).not.toHaveBeenCalled();
    expect(writes).toBe(0);
  });
});
