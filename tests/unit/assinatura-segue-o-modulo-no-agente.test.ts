/**
 * A assinatura do ChatGPT (#1639) segue o módulo `login_codex` também onde se
 * GRAVA o provedor do agente e do onboarding.
 *
 * O Zod da versão (`lib/ai/agents/validation.ts`) é compartilhado com o browser
 * e só confere que o sistema CONHECE o provedor. A régua da instalação mora em
 * `validarEscopoDaVersao`, que toda escrita de versão já chama (rota de versões,
 * PATCH do rascunho, criação, reconciliação, ações do editor, voltar versão).
 * Aqui: a régua em si, um caminho de escrita ligado a ela (PATCH do rascunho) e
 * o passo da chave do onboarding, que grava o padrão da empresa.
 *
 * Desligado ou banco que não respondeu = recusa 422 `provedor_desligado`;
 * ligado = igual a antes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORG = "22222222-2222-4222-8222-222222222222";
const AGENTE = "44444444-4444-4444-8444-444444444444";
const VERSAO = "55555555-5555-4555-8555-555555555555";
const ASSINATURA = "openai-assinatura";

const banco = vi.hoisted(() => ({
  modulo: "desligado" as "ligado" | "desligado" | "erro",
  grantModelo: false,
  updates: [] as Array<{ tabela: string; payload: unknown }>,
}));

function cadeia(tabela: string, dados: unknown, unico: unknown) {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: unico, error: null }),
    single: async () => ({ data: unico, error: null }),
    update: (payload: unknown) => {
      banco.updates.push({ tabela, payload });
      return chain;
    },
    then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve({ data: dados, error: null }).then(ok, erro),
  };
  for (const m of ["select", "eq", "in", "is", "not", "order", "limit"]) chain[m] = () => chain;
  return chain;
}

function clienteDeServico() {
  return {
    rpc: async (fn: string, args: { p_patch: Record<string, unknown>; p_platform_bypass?: boolean }) => {
      if (fn !== "fn_elus_ai_version_patch_guarded" || args.p_platform_bypass) {
        return { data: null, error: { message: "unexpected_rpc" } };
      }
      if (!banco.grantModelo) return { data: { error: "forbidden_platform_ai" }, error: null };
      banco.updates.push({ tabela: fn, payload: args.p_patch });
      return { data: { id: VERSAO, ...args.p_patch }, error: null };
    },
    from: (tabela: string) => {
      if (tabela === "platform_config") {
        if (banco.modulo === "erro") throw new Error("banco fora do ar");
        return cadeia(tabela, [{ chave: "MODULO_LOGIN_CODEX", valor: banco.modulo }], null);
      }
      if (tabela === "modulos_instalados") return cadeia(tabela, [], null);
      if (tabela === "organizations") return cadeia(tabela, [], {
        ai_autonomy: { model: banco.grantModelo },
      });
      if (tabela === "ai_agent_versions") {
        return cadeia(tabela, [], {
          id: VERSAO,
          status: "draft",
          agent_id: AGENTE,
          organization_id: ORG,
          followup: null,
          provider: ASSINATURA,
        });
      }
      return cadeia(tabela, [], null);
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteDeServico() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(async () => ({
  id: "11111111-1111-4111-8111-111111111111",
  is_platform_admin: false, platform_admin_scope: null, support: null,
})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(async () => ({
    ok: true,
    via: "session",
    organizationId: ORG,
    actor: { type: "user", id: "11111111-1111-4111-8111-111111111111" },
    idioma: "pt-BR",
  })),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));

// O passo da chave do onboarding: o miolo (cifrar, gravar, validar na rede) e o
// padrão da empresa têm cobertura própria; aqui só se mede se a gravação começa.
const onboarding = vi.hoisted(() => ({ guardar: vi.fn(), padrao: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/onboarding/_shared", () => ({
  requireOnboardingCtx: vi.fn(async () => ({ orgId: ORG, userId: "u1", role: "admin" })),
  OnboardingError: class extends Error {},
}));
vi.mock("@/lib/ai/credenciais/guardar", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  guardarCredencial: onboarding.guardar,
}));
vi.mock("@/lib/ai/pontos/padrao-da-organizacao", () => ({
  definirPadraoDeIaDaOrganizacao: onboarding.padrao,
}));

import { codigoDoEscopo, validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { PATCH } from "@/app/api/v1/ai/agents/[id]/versions/[vid]/route";
import { salvarChaveDaIa } from "@/app/actions/onboarding/chaveDaIa";

function patchDaVersao(corpo: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/v1/ai/agents/${AGENTE}/versions/${VERSAO}`, {
      method: "PATCH",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: AGENTE, vid: VERSAO }) },
  );
}

function formularioDaChave(provider: string) {
  const fd = new FormData();
  fd.set("provider", provider);
  fd.set("api_key", "chave-colada-com-mais-de-8");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.updates = [];
  banco.grantModelo = false;
  onboarding.guardar.mockResolvedValue({ ok: true, last4: "c0de" });
  onboarding.padrao.mockResolvedValue({ ok: true, provider: ASSINATURA, modelo: "gpt-5.5" });
});

describe.each(["desligado", "erro"] as const)("módulo login_codex %s", (estado) => {
  beforeEach(() => {
    banco.modulo = estado;
  });

  it("a régua da versão recusa a assinatura, com código próprio", async () => {
    const r = await validarEscopoDaVersao(clienteDeServico() as never, ORG, { provider: ASSINATURA });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.campo).toBe("provider");
    expect(codigoDoEscopo(r)).toBe("provedor_desligado");
  });

  it("a régua da versão não toca os outros provedores", async () => {
    const r = await validarEscopoDaVersao(clienteDeServico() as never, ORG, { provider: "openai" });
    expect(r.ok).toBe(true);
  });

  it("PATCH do rascunho com a assinatura responde 422 e não grava", async () => {
    const res = await patchDaVersao({ provider: ASSINATURA, model: "gpt-5.5" });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("provedor_desligado");
    expect(corpo.error.message).toMatch(/assinatura/i);
    expect(banco.updates).toEqual([]);
  });

  it("o passo da chave do onboarding recusa a assinatura antes de gravar", async () => {
    const r = await salvarChaveDaIa(formularioDaChave(ASSINATURA));
    expect(r.ok).toBe(false);
    expect(onboarding.guardar).not.toHaveBeenCalled();
    expect(onboarding.padrao).not.toHaveBeenCalled();
  });
});

describe("módulo login_codex ligado — igual a antes", () => {
  beforeEach(() => {
    banco.modulo = "ligado";
  });

  it("a régua da versão aceita a assinatura", async () => {
    const r = await validarEscopoDaVersao(clienteDeServico() as never, ORG, { provider: ASSINATURA });
    expect(r.ok).toBe(true);
  });

  it("PATCH do rascunho com a assinatura grava após grant técnico válido", async () => {
    banco.grantModelo = true;
    const res = await patchDaVersao({ provider: ASSINATURA, model: "gpt-5.5" });
    expect(res.status).toBe(200);
    expect(banco.updates).toEqual([
      { tabela: "fn_elus_ai_version_patch_guarded", payload: { provider: ASSINATURA, model: "gpt-5.5" } },
    ]);
  });

  it("módulo ligado sem grant técnico não autoriza modificar o modelo", async () => {
    banco.grantModelo = false;
    const res = await patchDaVersao({ provider: ASSINATURA, model: "gpt-5.5" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden_platform_ai");
    expect(banco.updates).toEqual([]);
  });

  // Ligado, a recusa vem do miolo (`guardarCredencial`): a assinatura não se
  // cola, conecta-se pelo login. O passo devolve a frase e não toca o padrão.
  it("o passo da chave do onboarding devolve a recusa do miolo e não grava o padrão", async () => {
    onboarding.guardar.mockResolvedValueOnce({ ok: false, motivo: "assinatura_so_pelo_login" });
    const r = await salvarChaveDaIa(formularioDaChave(ASSINATURA));
    expect(r).toEqual({ ok: false, erro: expect.stringMatching(/login em IA › Credenciais/) });
    expect(onboarding.padrao).not.toHaveBeenCalled();
  });
});
