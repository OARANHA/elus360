import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  fail: false,
  read: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "organizations") throw new Error("unexpected table");
      return {
        select: (cols: string) => {
          if (cols !== "ai_autonomy") throw new Error("unexpected columns");
          return {
            eq: (field: string, orgId: string) => {
              h.read(field, orgId);
              return { maybeSingle: async () => ({
                data: h.fail || !(orgId in h.rows) ? null : { ai_autonomy: h.rows[orgId] },
                error: h.fail ? { code: "DB_DOWN" } : null,
              }) };
            },
          };
        },
      };
    },
  }),
}));
import { podeConfigurarIa, podeGerenciarIaDaPlataforma } from "./server";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OWNER = { is_platform_admin: true, platform_admin_scope: "full" as const, support: null };
const TENANT = { is_platform_admin: false, platform_admin_scope: null, support: null };
const SUPPORT = { ...OWNER, support: { status: "active" } as never };

beforeEach(() => {
  h.rows = {};
  h.fail = false;
  h.read.mockClear();
});
describe("Portabilidade da governança de IA aceita no ELUS anterior", () => {
  it("somente platform admin full sem support tem bypass", async () => {
    expect(podeGerenciarIaDaPlataforma(OWNER)).toBe(true);
    expect(podeGerenciarIaDaPlataforma(SUPPORT)).toBe(false);
    expect(podeGerenciarIaDaPlataforma({ ...OWNER, platform_admin_scope: "support_readonly" })).toBe(false);
    expect(await podeConfigurarIa(SUPPORT, A, "provider")).toBe(false);
    expect(await podeConfigurarIa(OWNER, A, "provider")).toBe(true);
    expect(h.read).not.toHaveBeenCalled();
  });
  it("mantém isolamento por organização sem conceder grant de outra", async () => {
    h.rows = { [A]: { credentials: true }, [B]: { model: true } };
    expect(await podeConfigurarIa(TENANT, A, "credentials")).toBe(true);
    expect(await podeConfigurarIa(TENANT, A, "model")).toBe(false);
    expect(await podeConfigurarIa(TENANT, B, "model")).toBe(true);
    expect(await podeConfigurarIa(TENANT, B, "credentials")).toBe(false);
    expect(h.read.mock.calls.every(([column]) => column === "id")).toBe(true);
  });
  it("falha fechado no banco indisponível, org ausente e valores corrompidos", async () => {
    h.rows = { [A]: { provider: "true", model: 1, credentials: {} } };
    expect(await podeConfigurarIa(TENANT, A, "provider")).toBe(false);
    expect(await podeConfigurarIa(TENANT, A, "model")).toBe(false);
    expect(await podeConfigurarIa(TENANT, A, "credentials")).toBe(false);
    h.fail = true;
    expect(await podeConfigurarIa(TENANT, A, "provider")).toBe(false);
    expect(await podeConfigurarIa(TENANT, B, "provider")).toBe(false);
    expect(await podeConfigurarIa(TENANT, "invalido", "provider")).toBe(false);
  });
});
