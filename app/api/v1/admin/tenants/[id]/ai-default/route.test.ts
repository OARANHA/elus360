import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deniedRead: false,
  deniedWrite: false,
  deniedSupport: false,
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  writes: [] as unknown[],
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: async () => {
    if (h.deniedRead) throw new Error("forbidden");
    return { platformAdmin: { scope: "full" } };
  },
  requirePlatformAdminEscrita: async () => {
    if (h.deniedWrite) throw new Error("forbidden");
    return { user: { id: "11111111-1111-4111-8111-111111111111" } };
  },
  falhaDaEscritaDePlatformAdmin: () => new Response(null, { status: 403 }),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: async () => h.deniedSupport ? new Response(null, { status: 403 }) : null,
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/instalacao/ambiente", () => ({
  lerAmbiente: () => ({ chavesDeProvedor: {}, gateway: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const entry = { table, filters: [] as Array<[string, unknown]> };
      h.queries.push(entry);
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { entry.filters.push([column, value]); return chain; },
        is() { return chain; },
        not() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        update(values: unknown) { h.writes.push(values); return chain; },
        maybeSingle: async () => {
          if (table === "organizations") return {
            data: { id: TENANT, settings: { llm: { provider: "anthropic", default_model: "modelo-antigo", credential_id: null } } },
            error: null,
          };
          if (table === "ai_models") return {
            data: { model_id: "modelo-novo", input_price_per_million_cents: 1, output_price_per_million_cents: 1 },
            error: null,
          };
          // Credencial de outra organização não é retornada por uma consulta corretamente filtrada.
          if (table === "ai_provider_credentials_safe") return { data: null, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

import { GET, PATCH } from "./route";

const TENANT = "22222222-2222-4222-8222-222222222222";
const FOREIGN_CREDENTIAL = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id: TENANT }) };
const url = `http://localhost/api/v1/admin/tenants/${TENANT}/ai-default`;
const payload = { provider: "anthropic", default_model: "modelo-novo", credential_id: FOREIGN_CREDENTIAL };
const req = (body: unknown) => new NextRequest(url, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  h.deniedRead = false;
  h.deniedWrite = false;
  h.deniedSupport = false;
  h.queries = [];
  h.writes = [];
  vi.clearAllMocks();
});

describe("ELUS360 — isolamento e autenticação do padrão de IA", () => {
  it("GET exige platform admin antes de consultar dados", async () => {
    h.deniedRead = true;
    const res = await GET(new NextRequest(url), ctx);
    expect(res.status).toBe(403);
    expect(h.queries).toEqual([]);
  });

  it("PATCH exige permissão administrativa de escrita antes de consultar dados", async () => {
    h.deniedWrite = true;
    const res = await PATCH(req(payload), ctx);
    expect(res.status).toBe(403);
    expect(h.queries).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("PATCH bloqueia acompanhamento de suporte antes de acessar banco", async () => {
    h.deniedSupport = true;
    const res = await PATCH(req(payload), ctx);
    expect(res.status).toBe(403);
    expect(h.queries).toEqual([]);
  });

  it("PATCH rejeita credencial de outro tenant sem gravação nem auditoria", async () => {
    const res = await PATCH(req(payload), ctx);
    expect(res.status).toBe(422);
    expect(h.queries.find((q) => q.table === "organizations")?.filters)
      .toContainEqual(["id", TENANT]);
    expect(h.queries.find((q) => q.table === "ai_provider_credentials_safe")?.filters)
      .toEqual(expect.arrayContaining([
        ["organization_id", TENANT], ["id", FOREIGN_CREDENTIAL],
      ]));
    expect(h.writes).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("PATCH recusa campos inesperados sem acesso ao banco", async () => {
    const res = await PATCH(req({ ...payload, organization_id: FOREIGN_CREDENTIAL }), ctx);
    expect(res.status).toBe(422);
    expect(h.queries).toEqual([]);
  });
});
