import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: vi.fn(),
  tetoDeEscritaDoToken: vi.fn(async () => null),
}));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ai/agents/escopo", () => ({
  validarEscopoDaVersao: vi.fn(async () => ({ ok: true })),
  codigoDoEscopo: vi.fn(),
  mensagemDoEscopo: vi.fn(),
}));

import { resolveAuthDual } from "@/lib/api/auth-dual";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

const org = "22222222-2222-4222-8222-222222222222";
const agent = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const user = "11111111-1111-4111-8111-111111111111";
let row: Record<string, unknown>;
let grants: Record<string, boolean>;
let concurrent: (() => void) | undefined;
let writes: number;

function db() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let update: Record<string, unknown> | undefined;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        is: (k: string, v: unknown) => (filters.push([k, v]), q),
        update: (v: Record<string, unknown>) => ((update = v), q),
        maybeSingle: async () => {
          if (table === "organizations") return { data: { ai_autonomy: grants }, error: null };
          if (update && concurrent) {
            concurrent();
            concurrent = undefined;
          }
          if (!filters.every(([k, v]) => row[k] === v)) return { data: null, error: null };
          if (update) {
            writes++;
            Object.assign(row, update);
          }
          return { data: { ...row }, error: null };
        },
        single: async () => q.maybeSingle(),
      };
      return q;
    },
  };
}

async function patch(body: object) {
  const { PATCH } = await import("@/app/api/v1/ai/agents/[id]/versions/[vid]/route");
  return PATCH(
    new NextRequest("http://localhost/api", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: agent, vid: version }) },
  );
}

beforeEach(() => {
  row = {
    id: version,
    agent_id: agent,
    organization_id: org,
    status: "draft",
    followup: {},
    system_prompt: "original",
    provider: "openai",
    model: "old",
    credential_id: null,
    operator_model: null,
  };
  grants = {};
  writes = 0;
  concurrent = undefined;
  vi.mocked(createAdminClient).mockReturnValue(db() as never);
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    via: "session",
    organizationId: org,
    actor: { type: "user", id: user },
  } as never);
  vi.mocked(loadAuthUser).mockResolvedValue({
    id: user,
    is_platform_admin: false,
    platform_admin_scope: null,
    support: null,
  } as never);
});

describe("governança da versão do agente", () => {
  it("nega troca de modelo sem grant", async () => {
    expect((await patch({ model: "new" })).status).toBe(403);
    expect(writes).toBe(0);
  });
  it("permite conteúdo e reenvio técnico idêntico sem grant", async () => {
    expect((await patch({ system_prompt: "nova instrução", model: "old" })).status).toBe(200);
    expect(row.system_prompt).toBe("nova instrução");
  });
  it("permite alteração técnica com grant específico", async () => {
    grants.model = true;
    expect((await patch({ model: "new" })).status).toBe(200);
    expect(row.model).toBe("new");
  });
  it("exige grants separados para provider e credencial", async () => {
    grants.model = true;
    expect((await patch({ provider: "anthropic" })).status).toBe(403);
    expect((await patch({ credential_id: "55555555-5555-4555-8555-555555555555" })).status).toBe(
      403,
    );
    grants.provider = true;
    expect((await patch({ provider: "anthropic" })).status).toBe(200);
    grants.credentials = true;
    expect((await patch({ credential_id: "55555555-5555-4555-8555-555555555555" })).status).toBe(
      200,
    );
  });
  it("protege e grava o modelo do operador com o grant próprio", async () => {
    expect((await patch({ operator_model: "novo-modelo" })).status).toBe(403);
    grants.operator_model = true;
    expect((await patch({ operator_model: "novo-modelo" })).status).toBe(200);
    expect(row.operator_model).toBe("novo-modelo");
  });
  it("recusa edição técnica em impersonação mesmo com grant", async () => {
    grants.model = true;
    vi.mocked(loadAuthUser).mockResolvedValue({
      id: user,
      is_platform_admin: true,
      platform_admin_scope: "full",
      support: { status: "active" },
    } as never);
    expect((await patch({ model: "new" })).status).toBe(403);
    expect(writes).toBe(0);
  });
  it("permite ao Superadmin pleno e não ao token", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({
      id: user,
      is_platform_admin: true,
      platform_admin_scope: "full",
      support: null,
    } as never);
    expect((await patch({ model: "new" })).status).toBe(200);
    row.model = "old";
    vi.mocked(resolveAuthDual).mockResolvedValue({
      ok: true,
      via: "token",
      organizationId: org,
      actor: { type: "api_token", id: "token" },
    } as never);
    expect((await patch({ model: "new" })).status).toBe(403);
  });
  it("recusa sobrescrever configuração técnica alterada após a leitura", async () => {
    grants.model = true;
    concurrent = () => {
      row.model = "concurrent";
    };
    expect((await patch({ model: "new" })).status).toBe(409);
    expect(row.model).toBe("concurrent");
    expect(writes).toBe(0);
  });
  it("recusa escrita quando a versão é publicada após a leitura", async () => {
    concurrent = () => {
      row.status = "published";
    };
    expect((await patch({ system_prompt: "alteração válida no prompt" })).status).toBe(409);
    expect(writes).toBe(0);
  });
  it("recusa sobrescrever prompt alterado após a leitura", async () => {
    concurrent = () => {
      row.system_prompt = "outra edição";
    };
    expect((await patch({ system_prompt: "nova edição" })).status).toBe(409);
    expect(row.system_prompt).toBe("outra edição");
  });
  it("não lê versão pertencente a outra organização", async () => {
    row.organization_id = "99999999-9999-4999-8999-999999999999";
    expect((await patch({ model: "new" })).status).toBe(404);
    expect(writes).toBe(0);
  });
});
