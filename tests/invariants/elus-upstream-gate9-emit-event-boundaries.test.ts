/**
 * Gate 9 / ELUS360 — contrato REAL de emit_event, SOMENTE PostgreSQL descartável.
 *
 * Duas classes intencionalmente separadas:
 *  - NEGATIVOS de segurança: devem rejeitar, sem gravar evento.
 *  - DIAGNÓSTICOS DE LACUNA: reproduzem emissão que o SQL HOJE aceita, mas
 *    NÃO concedem aceite de segurança. Todos dentro de BEGIN/ROLLBACK.
 *
 * Um PASS de diagnóstico de lacuna indica RISCO OBSERVADO, não um contrato seguro.
 * Nenhum worker é drenado e nenhuma linha de prova fica persistida.
 * Não altera código SQL, migrations, RLS, grants ou código de produção.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { buildContext } from "@/lib/automation/engine";
import type { EventRow } from "@/lib/event-log/dispatcher";
import {
  GOV_LEAD, GOV_ORG, GOV_VIEWER, seedGov, sql,
} from "./gov-helpers";
import {
  comoAnon, comoUsuario, criarOrg, criarUsuarios, erroDe, numero, uuid, valor, vincular,
} from "./cobranca-helpers";

const PREFIX = "e1900009-0000-4000-8000";
const B = uuid(PREFIX, 1);
const USER_B = uuid(PREFIX, 11);
const USER_SEM_VINCULO = uuid(PREFIX, 12);
const USER_REVOGADO = uuid(PREFIX, 13);
const B_PIPELINE = uuid(PREFIX, 101);
const B_STAGE = uuid(PREFIX, 102);
const B_LEAD = uuid(PREFIX, 103);
const LEAD_INEXISTENTE = uuid(PREFIX, 999);
const EMIT = "public.emit_event(text, text, uuid, jsonb, jsonb, uuid)";

function qtdCaso(id: string): number {
  return numero("select count(*) from public.event_log where payload->>'gate9_case'='" + id + "';");
}

/**
 * A própria RPC é executada como um papel real. Consultas diagnósticas ocorrem
 * após RESET ROLE, dentro da mesma transação, e tudo é descartado com ROLLBACK.
 * Se a RPC for corretamente endurecida no futuro, o probe deve falhar e
 * exigir reclassificação humana do risco (não mascarar a alteração).
 */
function diagnosticarEmTransacao(
  caso: string,
  papel: "authenticated" | "service_role",
  userId: string | null,
  organizacao: string,
  entidade: string,
): string {
  const initial = qtdCaso(caso);
  expect(initial, "fixture previa ao caso " + caso).toBe(0);
  const jwt = userId === null
    ? '{"role":"authenticated"}'
    : '{"sub":"' + userId + '","role":"authenticated"}';
  const setup = papel === "authenticated"
    ? "set local role authenticated;\n" +
      "select set_config('request.jwt.claims','" + jwt + "',true);\n"
    : "set local role service_role;\n";
  const out = sql(
    "begin;\n" + setup +
    "select 'G9_AUTH_UID:' || coalesce(auth.uid()::text,'null');\n" +
    "select 'G9_EVENT_ID:' || public.emit_event(" +
      "'lead.tag_added','crm_lead','" + entidade + "'::uuid," +
      "jsonb_build_object('gate9_case','" + caso + "'),'{}'::jsonb,'" +
      organizacao + "'::uuid);\n" +
    "reset role;\n" +
    "select 'G9_EVENT_COUNT:' || count(*) from public.event_log " +
      "where payload->>'gate9_case'='" + caso + "';\n" +
    "select 'G9_ENTITY_MATCH:' || count(*) from public.event_log e " +
      "join public.crm_leads l on l.id=e.entity_id and l.organization_id=e.organization_id " +
      "where e.payload->>'gate9_case'='" + caso + "';\n" +
    "select 'G9_ENTITY_REAL_ORG:' || coalesce((" +
      "select l.organization_id::text from public.crm_leads l where l.id='" + entidade + "'::uuid)," +
      "'not_found');\n" +
    "rollback;"
  );
  expect(out).toContain("G9_EVENT_ID:");
  expect(out).toContain("G9_EVENT_COUNT:1");
  expect(qtdCaso(caso), "nenhuma emissao de diagnostico pode sobreviver ao rollback").toBe(0);
  return out;
}

beforeAll(() => {
  seedGov();
  criarOrg(B, "elus-gate9-b");
  criarUsuarios([
    [USER_B, "gate9-viewer-b@invariant.test"],
    [USER_SEM_VINCULO, "gate9-outsider@invariant.test"],
    [USER_REVOGADO, "gate9-revogado@invariant.test"],
  ]);
  vincular(USER_B, B, "viewer");
  vincular(USER_REVOGADO, GOV_ORG, "viewer");
  sql("update public.user_organizations set revoked_at=now() " +
      "where user_id='" + USER_REVOGADO + "'::uuid and organization_id='" + GOV_ORG + "'::uuid;");
  sql(
    "insert into public.crm_pipelines(id,organization_id,name,slug) " +
      "values ('" + B_PIPELINE + "','" + B + "','Gate 9 B','elus-gate9-b'); " +
    "insert into public.crm_stages(id,organization_id,pipeline_id,name,slug,position) " +
      "values ('" + B_STAGE + "','" + B + "','" + B_PIPELINE + "','Entrada','entrada',1); " +
    "insert into public.crm_leads(id,organization_id,pipeline_id,stage_id,title,tags) " +
      "values ('" + B_LEAD + "','" + B + "','" + B_PIPELINE + "','" + B_STAGE + "','Lead B','{}'::text[]);"
  );
});

describe("Gate 9 — chamada RPC vs autorização de organização", () => {
  it("catálogo: authenticated EXECUTE=true, anon=false e SECURITY DEFINER", () => {
    expect(valor(
      "select has_function_privilege('authenticated','" + EMIT + "','EXECUTE');"
    )).toBe("t");
    expect(valor("select has_function_privilege('anon','" + EMIT + "','EXECUTE');")).toBe("f");
    expect(valor(
      "select prosecdef from pg_proc where oid='" + EMIT + "'::regprocedure;"
    )).toBe("t");
  });

  it("viewer autenticado em A emite evento do lead de A (comportamento vigente, não aprovação)", () => {
    const out = diagnosticarEmTransacao("viewer_mesma_org","authenticated",GOV_VIEWER,GOV_ORG,GOV_LEAD);
    expect(out).toContain("G9_AUTH_UID:" + GOV_VIEWER);
    expect(out).toContain("G9_ENTITY_MATCH:1");
    expect(out).toContain("G9_ENTITY_REAL_ORG:" + GOV_ORG);
  });

  it("viewer membro de B emite na própria B, não em A (controle de identidade)", () => {
    const out = diagnosticarEmTransacao("viewer_b","authenticated",USER_B,B,B_LEAD);
    expect(out).toContain("G9_ENTITY_MATCH:1");
    expect(out).toContain("G9_ENTITY_REAL_ORG:" + B);
  });

  it("viewer de A não consegue emitir para org B e não deixa linha", () => {
    const caso = "cross_org_denied";
    const antes = qtdCaso(caso);
    const stmt = "select public.emit_event('lead.tag_added','crm_lead','" +
      B_LEAD + "'::uuid,jsonb_build_object('gate9_case','" + caso +
      "'),'{}'::jsonb,'" + B + "'::uuid)";
    const error = erroDe(comoUsuario(GOV_VIEWER,stmt));
    expect(error).toContain("P0001");
    expect(error).toContain("caller_not_authorized_for_org");
    expect(qtdCaso(caso)).toBe(antes);
  });

  it("membro revogado e usuario sem membership são recusados em A sem evento", () => {
    for (const [usuario, caso] of [
      [USER_REVOGADO,"revoked"],
      [USER_SEM_VINCULO,"no_membership"],
    ] as ReadonlyArray<readonly [string,string]>) {
      const antes = qtdCaso(caso);
      const stmt = "select public.emit_event('lead.tag_added','crm_lead','" +
        GOV_LEAD + "'::uuid,jsonb_build_object('gate9_case','" + caso +
        "'),'{}'::jsonb,'" + GOV_ORG + "'::uuid)";
      const error = erroDe(comoUsuario(usuario,stmt));
      expect(error).toContain("P0001");
      expect(error).toContain("caller_not_authorized_for_org");
      expect(qtdCaso(caso)).toBe(antes);
    }
  });

  it("anon nao tem EXECUTE para emitir, sem inserir evento", () => {
    const caso = "anon_denied";
    const antes = qtdCaso(caso);
    const stmt = "select public.emit_event('lead.tag_added','crm_lead','" +
      GOV_LEAD + "'::uuid,jsonb_build_object('gate9_case','" + caso +
      "'),'{}'::jsonb,'" + GOV_ORG + "'::uuid)";
    const error = erroDe(comoAnon(stmt));
    expect(error).toContain("42501");
    expect(error).toContain("permission denied");
    expect(qtdCaso(caso)).toBe(antes);
  });
});

describe("Gate 9 — diagnosticos de lacuna entidade/identidade (PASS != ACEITE)", () => {
  it("LACUNA: viewer A consegue registrar em A id de lead REAL pertencente a B", () => {
    const out = diagnosticarEmTransacao("foreign_entity","authenticated",GOV_VIEWER,GOV_ORG,B_LEAD);
    expect(out).toContain("G9_ENTITY_MATCH:0");
    expect(out).toContain("G9_ENTITY_REAL_ORG:" + B);
    console.warn("[Gate9][NO-GO] A RPC aceitou entidade de B com organização A; ROLLBACK efetuado");
  });

  it("LACUNA: viewer A consegue registrar id de entidade que nao existe", () => {
    const out = diagnosticarEmTransacao("unknown_entity","authenticated",GOV_VIEWER,GOV_ORG,LEAD_INEXISTENTE);
    expect(out).toContain("G9_ENTITY_MATCH:0");
    expect(out).toContain("G9_ENTITY_REAL_ORG:not_found");
    console.warn("[Gate9][NO-GO] A RPC aceitou entidade inexistente; ROLLBACK efetuado");
  });

  it("LACUNA: role authenticated sem sub e com org explicita passa por ramo sem membership", () => {
    // Sonda de contrato SQL; não equivale a demonstrar JWT assinado válido no PostgREST.
    const out = diagnosticarEmTransacao("null_auth_uid","authenticated",null,B,B_LEAD);
    expect(out).toContain("G9_AUTH_UID:null");
    expect(out).toContain("G9_ENTITY_MATCH:1");
    console.warn("[Gate9][NO-GO] Ramo SQL auth.uid() nulo no papel authenticated aceitou evento; JWT externo NÃO medido");
  });

  it("LACUNA: service_role emite evento com entidade de A sob organização B", () => {
    const out = diagnosticarEmTransacao("service_cross_entity","service_role",null,B,GOV_LEAD);
    expect(out).toContain("G9_ENTITY_MATCH:0");
    expect(out).toContain("G9_ENTITY_REAL_ORG:" + GOV_ORG);
    console.warn("[Gate9][NO-GO] service_role não possui validação automática de entidade↔organização");
  });
});

describe("Gate 9 — fronteira do consumidor de automação", () => {
  it("o SELECT equivalente à hidratação do consumer não encontra lead B em A", () => {
    expect(numero(
      "select count(*) from public.crm_leads where id='" + B_LEAD + "'::uuid " +
      "and organization_id='" + GOV_ORG + "'::uuid;"
    )).toBe(0);
    expect(numero(
      "select count(*) from public.crm_leads where id='" + B_LEAD + "'::uuid " +
      "and organization_id='" + B + "'::uuid;"
    )).toBe(1);
  });

  it("buildContext REAL consulta com filtro org e não hidrata o lead de B em evento de A", async () => {
    const consultas: Array<{ tabela: string; filtros: Record<string,string> }> = [];
    // Adaptador somente leitura: chama o PostgreSQL DESCARTÁVEL no lugar do
    // PostgREST para provar o filtro usado pelo consumer REAL, sem disparar workers.
    const admin = {
      from(tabela: string) {
        const filtros: Record<string,string> = {};
        return {
          select(_cols: string) { return this; },
          eq(col: string, value: string) { filtros[col] = value; return this; },
          async maybeSingle() {
            consultas.push({tabela,filtros:{...filtros}});
            if (tabela !== "crm_leads" || !filtros.id || !filtros.organization_id)
              throw new Error("consulta inesperada sem limite de tenant");
            const registro = valor(
              "select coalesce((select row_to_json(t)::text from (" +
              "select * from public.crm_leads where id='" + filtros.id +
              "'::uuid and organization_id='" + filtros.organization_id +
              "'::uuid limit 1) t),'null');"
            );
            return {data: JSON.parse(registro) as Record<string,unknown> | null, error:null};
          },
        };
      },
    } as unknown as SupabaseClient;
    const row: EventRow = {
      id: uuid(PREFIX, 9998),
      organization_id: GOV_ORG,
      event_type: "lead.tag_added",
      entity_kind: "crm_lead",
      entity_id: B_LEAD,
      payload: { gate9_case: "consumer_probe" },
      metadata: {},
      consumed_by: [],
      attempts: 0,
    };
    const context = await buildContext(admin,row);
    expect(consultas).toEqual([
      {tabela:"crm_leads",filtros:{id:B_LEAD,organization_id:GOV_ORG}},
    ]);
    expect(context.lead).toBeUndefined();
    expect(context.event).toEqual({gate9_case:"consumer_probe"});
    // Um consumidor com filtro NÃO conserta uma linha de evento falsificada.
  });
});
