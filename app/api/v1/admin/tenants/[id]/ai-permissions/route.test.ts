import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deniedSupport: false,
  deniedWrite: false,
  deniedRead: false,
  row: { id: "22222222-2222-4222-8222-222222222222", ai_autonomy: {} as Record<string, unknown> } as
    | { id: string; ai_autonomy: Record<string, unknown> }
    | null,
  loadError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updated: true,
  writes: [] as Array<unknown>,
  where: [] as Array<[string, unknown]>,
  audit: vi.fn(),
  writeAuth: vi.fn(),
}));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: async () => {
    if (h.deniedRead) throw new Error("forbidden");
    return { user: { id: "aaaa0000-0000-4000-8000-000000000000" } };
  },
  requirePlatformAdminEscrita: async () => {
    h.writeAuth();
    if (h.deniedWrite) throw new Error("mfa_required or forbidden_scope");
    return { user: { id: "aaaa0000-0000-4000-8000-000000000000" } };
  },
  falhaDaEscritaDePlatformAdmin: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: async () => h.deniedSupport ? new Response(null, { status: 403 }) : null,
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "organizations") throw new Error("tabela inesperada");
      let updating = false;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.update = (values: unknown) => {
        updating = true;
        h.writes.push(values);
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        h.where.push([column, value]);
        return chain;
      };
      chain.maybeSingle = async () => updating
        ? { data: h.updated ? { id: h.row?.id } : null, error: h.updateError }
        : { data: h.row, error: h.loadError };
      return chain;
    },
  }),
}));

import { GET, PATCH } from "./route";

const TENANT = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: TENANT }) };
const grants = { provider: false, model: true, credentials: false, operator_model: false };
const request = (body: unknown) => new NextRequest("http://localhost/api/v1/admin/tenants/" + TENANT + "/ai-permissions", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const get = () => new NextRequest("http://localhost/api/v1/admin/tenants/" + TENANT + "/ai-permissions");

beforeEach(() => {
  h.deniedSupport = false;
  h.deniedWrite = false;
  h.deniedRead = false;
  h.row = { id: TENANT, ai_autonomy: {} };
  h.loadError = null;
  h.updateError = null;
  h.updated = true;
  h.writes = [];
  h.where = [];
  vi.clearAllMocks();
});

describe("Superadmin — autonomia técnica (Gate 2B.2, schema pendente)", () => {
  it("recusa escrita não autorizada sem leitura/gravação da coluna", async () => {
    h.deniedWrite = true;
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(403);
    expect(h.writeAuth).toHaveBeenCalledOnce();
    expect(h.writes).toEqual([]);
  });

  it("recusa sessões de acompanhamento antes da escrita", async () => {
    h.deniedSupport = true;
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(403);
    expect(h.writeAuth).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("somente objeto com quatro booleanos estritos pode ser enviado", async () => {
    for (const input of [{ ...grants, credentials: "true" }, { model: true }, { ...grants, extra: true }]) {
      expect((await PATCH(request(input), ctx)).status).toBe(422);
    }
    expect(h.writes).toEqual([]);
  });

  it("erro de schema ou banco falha fechado sem sobrescrever settings", async () => {
    h.loadError = { message: "column ai_autonomy does not exist" };
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(500);
    expect(h.writes).toEqual([]);
  });

  it("edição idêntica não escreve nem audita", async () => {
    h.row = { id: TENANT, ai_autonomy: { model: true } };
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("CAS impede sobrescrever concessões concorrentes", async () => {
    h.updated = false;
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(409);
    expect(h.writes).toEqual([{ ai_autonomy: grants }]);
    expect(h.where).toContainEqual(["ai_autonomy", "{}"]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("escrita bem-sucedida audita sem expor credenciais e nunca altera settings", async () => {
    const res = await PATCH(request(grants), ctx);
    expect(res.status).toBe(200);
    expect(h.writes).toEqual([{ ai_autonomy: grants }]);
    expect(h.where).toContainEqual(["id", TENANT]);
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.audit.mock.calls[0][0]).toMatchObject({
      action: "platform_admin.ai_autonomy_updated",
      organizationId: TENANT,
      bypassedRls: true,
    });
  });

  it("GET exige autenticação de Superadmin e isola organização", async () => {
    h.deniedRead = true;
    expect((await GET(get(), ctx)).status).toBe(403);
    h.deniedRead = false;
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(h.where).toContainEqual(["id", TENANT]);
  });
});
