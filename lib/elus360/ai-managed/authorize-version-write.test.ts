import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  grants: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: m.auth }));
vi.mock("./server", () => ({
  lerAutonomiaIa: m.grants,
  podeGerenciarIaDaPlataforma: (user: { is_platform_admin?: boolean; platform_admin_scope?: string; support?: unknown }) =>
    user.is_platform_admin === true && user.platform_admin_scope === "full" && !user.support,
}));
import { podeAlterarTecnicaDeVersao } from "./authorize-version-write";

const organizationId = "22222222-2222-4222-8222-222222222222";
const authUserId = "11111111-1111-4111-8111-111111111111";
const input = (via: "session" | "token" = "session") => ({
  via, organizationId, authUserId,
  anteriorDoServidor: { provider: "openai", model: "old", credential_id: null, operator_model: null },
  propostaValidada: { model: "new" },
});

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ id: authUserId, is_platform_admin: false, platform_admin_scope: null, support: null });
  m.grants.mockResolvedValue({ provider: false, model: false, credentials: false, operator_model: false });
});

describe("fronteira unificada de governança de versões", () => {
  it("não exige grant para reenvio técnico idêntico", async () => {
    const request = { ...input(), propostaValidada: { model: "old" } };
    expect(await podeAlterarTecnicaDeVersao(request)).toBe(true);
    expect(m.grants).not.toHaveBeenCalled();
  });
  it("nega alteração técnica sem grant", async () => {
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(false);
  });
  it("permite alteração com grant da mesma organização", async () => {
    m.grants.mockResolvedValue({ model: true });
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(true);
    expect(m.grants).toHaveBeenCalledWith(organizationId);
  });
  it("recusa identidade de sessão divergente mesmo com grant", async () => {
    m.auth.mockResolvedValue({ id: "outro", support: null });
    m.grants.mockResolvedValue({ model: true });
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(false);
    expect(m.grants).not.toHaveBeenCalled();
  });
  it("recusa suporte mesmo se for Superadmin", async () => {
    m.auth.mockResolvedValue({ id: authUserId, is_platform_admin: true, platform_admin_scope: "full", support: { status: "active" } });
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(false);
  });
  it("Superadmin pleno em sessão não precisa de grant", async () => {
    m.auth.mockResolvedValue({ id: authUserId, is_platform_admin: true, platform_admin_scope: "full", support: null });
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(true);
    expect(m.grants).not.toHaveBeenCalled();
  });
  it("API Token não herda o bypass da sessão de Superadmin", async () => {
    m.auth.mockResolvedValue({ id: authUserId, is_platform_admin: true, platform_admin_scope: "full", support: null });
    expect(await podeAlterarTecnicaDeVersao(input("token"))).toBe(false);
    expect(m.auth).not.toHaveBeenCalled();
  });
  it("recusa coluna indisponível e falha de banco", async () => {
    m.grants.mockResolvedValue(null);
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(false);
    m.grants.mockRejectedValue(new Error("DB_DOWN"));
    expect(await podeAlterarTecnicaDeVersao(input())).toBe(false);
  });
});
