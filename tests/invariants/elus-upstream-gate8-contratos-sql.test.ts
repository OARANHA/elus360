/**
 * ELUS360 Gate 8 — provas de integração no PostgreSQL DESCARTÁVEL.
 *
 * Não substitui PostgREST HTTP, nem testa alvo upstream no runtime: as migrations
 * 0601 e 0682 possuem os MESMOS blobs no fork e no target pinados. Não modifica
 * banco real, migrações, funções nem tabelas de produção.
 *
 * Roda EXCLUSIVAMENTE via scripts/test-db.sh (pgvector PG15, baseline real);
 * cada arquivo recebe DB próprio a partir do molde, preservando outros testes.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import {
  assinar, comoAnon, comoServidor, comoUsuario, criarOrg, criarPlano, criarUsuarios,
  erroDe, uuid, valor, vincular,
} from "./cobranca-helpers";

const PREFIX = "e1800008-0000-4000-8000";
const A = uuid(PREFIX, 1);
const B = uuid(PREFIX, 2);
const C = uuid(PREFIX, 3);
const USER_A = uuid(PREFIX, 11);
const USER_B = uuid(PREFIX, 12);
const PLANO = uuid(PREFIX, 101);
const FUNIL = uuid(PREFIX, 201);
const ETAPA = uuid(PREFIX, 202);
const LEAD = uuid(PREFIX, 203);
const ENTIDADE = uuid(PREFIX, 204);
const EMIT = "public.emit_event(text, text, uuid, jsonb, jsonb, uuid)";
const COBRANCA = "public.fn_cobranca_reconciliaveis()";

const numero = (query: string) => Number(valor(query));
const executavel = (role: string, signature: string) =>
  valor("select has_function_privilege('" + role + "', '" + signature + "', 'EXECUTE')::text;") === "true";

beforeAll(() => {
  criarUsuarios([
    [USER_A, "gate8-a@invariant.test"],
    [USER_B, "gate8-b@invariant.test"],
  ]);
  criarOrg(A, "elus-g8-a");
  criarOrg(B, "elus-g8-b");
  criarOrg(C, "elus-g8-c");
  vincular(USER_A, A, "admin");
  vincular(USER_B, B, "admin");
  criarPlano({ id: PLANO, nome: "Gate 8 descartavel" });
  for (const org of [A, B, C]) assinar(org, PLANO);
  sql(
    "update public.cobranca_assinaturas set estado='ativa', provedor='stripe', modo='teste', " +
    "provedor_cliente_id='cus_gate8_' || right(organization_id::text, 3), " +
    "relida_em = case organization_id " +
    "when '" + A + "'::uuid then null " +
    "when '" + B + "'::uuid then '2026-10-01T08:00:00Z'::timestamptz " +
    "else '2026-10-20T11:00:00Z'::timestamptz end " +
    "where organization_id in ('" + A + "','" + B + "','" + C + "');"
  );
  sql(
    "insert into public.crm_pipelines (id, organization_id, name, slug) " +
    "values ('" + FUNIL + "','" + A + "','Gate 8','elus-gate8'); " +
    "insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) " +
    "values ('" + ETAPA + "','" + A + "','" + FUNIL + "','Entrada','entrada',1); " +
    "insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, tags) " +
    "values ('" + LEAD + "','" + A + "','" + FUNIL + "','" + ETAPA + "','Gate 8','{}'::text[]);"
  );
});

describe("Gate 8 — assinaturas e privilégios SQL reais", () => {
  it("preserva assinatura exata de emit_event (seis argumentos) e retorno da cobrança", () => {
    expect(valor("select to_regprocedure('" + EMIT + "') is not null;")).toBe("t");
    expect(valor("select to_regprocedure('" + COBRANCA + "') is not null;")).toBe("t");
    const result = valor(
      "select pg_get_function_result('" + COBRANCA + "'::regprocedure);"
    );
    expect(result).toMatch(/organization_id uuid/);
    expect(result).toMatch(/relida_em timestamp with time zone/);
    expect(result).toMatch(/precisa_reler boolean/);
  });

  it("cobrança é SECURITY INVOKER e STABLE, não uma função definer exposta", () => {
    expect(valor(
      "select not prosecdef and provolatile='s' from pg_proc " +
      "where oid='" + COBRANCA + "'::regprocedure;"
    )).toBe("t");
  });

  it("GRANT real: emit_event permite authenticated com guarda interna; cobrança só service_role", () => {
    // EXECUTE não é autorização para emissão: emit_event exige vínculo ativo e
    // fn_support_write_allowed no corpo. O ACL das duas RPCs é DIFERENTE.
    expect(executavel("anon", EMIT)).toBe(false);
    expect(executavel("authenticated", EMIT)).toBe(true);
    expect(executavel("service_role", EMIT)).toBe(true);

    expect(executavel("anon", COBRANCA)).toBe(false);
    expect(executavel("authenticated", COBRANCA)).toBe(false);
    expect(executavel("service_role", COBRANCA)).toBe(true);
  });

  it("execução negativa sob sessão de A e anon recusa a função global de cobrança", () => {
    const query = "select count(*) from public.fn_cobranca_reconciliaveis()";
    for (const script of [comoAnon(query), comoUsuario(USER_A, query)]) {
      const error = erroDe(script);
      expect(error).toContain("42501");
      expect(error).toContain("permission denied");
    }
  });

  it("RLS: admin A só lê assinatura A e não lê B; admin B só lê B", () => {
    expect(numero(comoUsuario(USER_A,
      "select count(*) from public.cobranca_assinaturas where organization_id='" + A + "';"
    ))).toBe(1);
    expect(numero(comoUsuario(USER_A,
      "select count(*) from public.cobranca_assinaturas where organization_id='" + B + "';"
    ))).toBe(0);
    expect(numero(comoUsuario(USER_B,
      "select count(*) from public.cobranca_assinaturas where organization_id='" + A + "';"
    ))).toBe(0);
  });

  it("service_role enxerga as três organizações; ORDER DESC NULLS LAST seleciona a mais recente", () => {
    const query = "select organization_id::text from public.fn_cobranca_reconciliaveis() " +
      "order by relida_em desc nulls last limit 1";
    expect(valor(comoServidor(query))).toBe(C);
    expect(numero(comoServidor("select count(*) from public.fn_cobranca_reconciliaveis()"))).toBe(3);
    expect(valor(comoServidor(
      "select (select relida_em from public.fn_cobranca_reconciliaveis() " +
      "order by relida_em desc nulls last limit 1) is not distinct from " +
      "(select max(relida_em) from public.fn_cobranca_reconciliaveis());"
    ))).toBe("t");
  });

  it("NULL em todas as leituras não cria leitura fictícia", () => {
    try {
      sql("update public.cobranca_assinaturas set relida_em=null where organization_id in ('" +
        A + "','" + B + "','" + C + "');");
      expect(valor(comoServidor(
        "select (select relida_em from public.fn_cobranca_reconciliaveis() " +
        "order by relida_em desc nulls last limit 1) is null;"
      ))).toBe("t");
    } finally {
      sql("update public.cobranca_assinaturas set relida_em=case organization_id " +
        "when '" + A + "'::uuid then null " +
        "when '" + B + "'::uuid then '2026-10-01T08:00:00Z'::timestamptz " +
        "else '2026-10-20T11:00:00Z'::timestamptz end " +
        "where organization_id in ('" + A + "','" + B + "','" + C + "');");
    }
  });
});

describe("Gate 8 — evento, autorização e idempotência no banco", () => {
  it("service_role emite evento com org, payload e metadata preservados", () => {
    const payload = '{"added_tags":["gate8"],"tags":["gate8"]}';
    const metadata = '{"caused_by_rule":"gate8-rule"}';
    const eventId = valor(comoServidor(
      "select public.emit_event('lead.tag_added','crm_lead','" + ENTIDADE +
      "'::uuid,'" + payload + "'::jsonb,'" + metadata + "'::jsonb,'" + A + "'::uuid);"
    ));
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    const row = JSON.parse(valor(comoServidor(
      "select jsonb_build_object('organization_id',organization_id," +
      "'event_type',event_type,'entity_kind',entity_kind," +
      "'payload',payload,'metadata',metadata,'status',status)::text " +
      "from public.event_log where id='" + eventId + "'::uuid;"
    ))) as {
      organization_id: string; event_type: string; entity_kind: string;
      payload: { added_tags: string[]; tags: string[] };
      metadata: { caused_by_rule: string; emitted_at: number }; status: string;
    };
    expect(row.organization_id).toBe(A);
    expect(row.event_type).toBe("lead.tag_added");
    expect(row.entity_kind).toBe("crm_lead");
    expect(row.payload.added_tags).toEqual(["gate8"]);
    expect(row.payload.tags).toEqual(["gate8"]);
    expect(row.metadata.caused_by_rule).toBe("gate8-rule");
    expect(Object.keys(row.metadata).sort()).toEqual(["caused_by_rule", "emitted_at"]);
    expect(Number.isFinite(row.metadata.emitted_at)).toBe(true);
    expect(row.metadata.emitted_at).toBeGreaterThan(0);
    expect(row.status).toBe("pending");
  });

  it("metadata sem caused_by_rule ganha apenas emitted_at do SQL, sem criar anti-loop", () => {
    const eventId = valor(comoServidor(
      "select public.emit_event('lead.tag_added','crm_lead','" + ENTIDADE +
      "'::uuid,'{}'::jsonb,'{}'::jsonb,'" + A + "'::uuid);"
    ));
    const metadata = JSON.parse(valor(comoServidor(
      "select metadata::text from public.event_log where id='" + eventId + "'::uuid;"
    ))) as { emitted_at: number; caused_by_rule?: string };
    expect(Object.keys(metadata)).toEqual(["emitted_at"]);
    expect(typeof metadata.emitted_at).toBe("number");
    expect(Number.isFinite(metadata.emitted_at)).toBe(true);
    expect(metadata.emitted_at).toBeGreaterThan(0);
    expect(Object.hasOwn(metadata, "caused_by_rule")).toBe(false);
  });

  it("A não pode forjar evento de B via RPC (nem como anon); nenhuma linha inserida", () => {
    const before = numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + ENTIDADE +
      "'::uuid and organization_id='" + B + "'::uuid;"
    ));
    const stmt = "select public.emit_event('lead.tag_added','crm_lead','" + ENTIDADE +
      "'::uuid,'{}'::jsonb,'{}'::jsonb,'" + B + "'::uuid)";
    // authenticated alcança o corpo SECURITY DEFINER, que recusa por vínculo;
    // anon nem tem EXECUTE e é negado antes do corpo (42501).
    for (const [script, sqlState, marker] of [
      [comoUsuario(USER_A, stmt), "P0001", "caller_not_authorized_for_org"],
      [comoAnon(stmt), "42501", "permission denied"],
    ]) {
      const error = erroDe(script);
      expect(error).toContain(sqlState);
      expect(error).toContain(marker);
    }
    expect(numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + ENTIDADE +
      "'::uuid and organization_id='" + B + "'::uuid;"
    ))).toBe(before);
  });

  it("authenticated com membership em A executa em A e recebe emitted_at do banco", () => {
    // O teste caracteriza a chamada permitida sem alegar validação de entidade:
    // emit_event NÃO consulta a tabela de entidade; isso é risco documentado.
    const statement = "select public.emit_event('lead.tag_added','crm_lead','" +
      ENTIDADE + "'::uuid,'{}'::jsonb,'{}'::jsonb,'" + A + "'::uuid)";
    const eventId = valor(comoUsuario(USER_A, statement));
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    const row = JSON.parse(valor(comoServidor(
      "select jsonb_build_object('org', organization_id, 'metadata', metadata, " +
      "'status',status)::text from public.event_log where id='" + eventId + "'::uuid;"
    ))) as { org: string; metadata: { emitted_at: number }; status: string };
    expect(row.org).toBe(A);
    expect(row.status).toBe("pending");
    expect(Number.isFinite(row.metadata.emitted_at)).toBe(true);
  });

  it("authenticated não pode forjar message.received nem origem operacional reservada", () => {
    // Guardas de emit_event na migration 0223. Ambos devem falhar antes de
    // gravar, mesmo para membro ativo da própria organização.
    const before = numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + ENTIDADE +
      "'::uuid and organization_id='" + A + "'::uuid;"
    ));
    const attempts = [
      "select public.emit_event('message.received','message','" + ENTIDADE +
        "'::uuid,'{}'::jsonb,'{}'::jsonb,'" + A + "'::uuid)",
      "select public.emit_event('lead.tag_added','crm_lead','" + ENTIDADE +
        "'::uuid,'{\"service_origin\":{}}'::jsonb,'{}'::jsonb,'" + A + "'::uuid)",
      "select public.emit_event('lead.tag_added','crm_lead','" + ENTIDADE +
        "'::uuid,'{}'::jsonb,'{\"service_boundary\":{}}'::jsonb,'" + A + "'::uuid)",
    ];
    for (const stmt of attempts) {
      const error = erroDe(comoUsuario(USER_A, stmt));
      expect(error).toContain("42501");
      expect(error).toMatch(/reserved_message_received|reserved_service_origin/);
    }
    expect(numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + ENTIDADE +
      "'::uuid and organization_id='" + A + "'::uuid;"
    ))).toBe(before);
  });

  it("emitted_at não pode ser escolhido pelo chamador da organização A", () => {
    const statement = "select public.emit_event('lead.tag_added','crm_lead','" +
      ENTIDADE + "'::uuid,'{}'::jsonb,'{\"emitted_at\":-1}'::jsonb,'" + A + "'::uuid)";
    const eventId = valor(comoUsuario(USER_A, statement));
    const row = JSON.parse(valor(comoServidor(
      "select metadata::text from public.event_log where id='" + eventId + "'::uuid;"
    ))) as { emitted_at: number };
    expect(Object.keys(row)).toEqual(["emitted_at"]);
    expect(Number.isFinite(row.emitted_at)).toBe(true);
    expect(row.emitted_at).toBeGreaterThan(0);
    expect(row.emitted_at).not.toBe(-1);
  });

  it("falha RPC real de etiquetas vazias: SQLSTATE 22023, sem escrita ou evento", () => {
    const antes = valor(comoServidor(
      "select coalesce(array_length(tags,1),0)::text from public.crm_leads where id='" + LEAD + "'::uuid;"
    ));
    const error = erroDe(comoServidor(
      "select public.fn_lead_adicionar_etiquetas('" + A + "'::uuid,'" +
      LEAD + "'::uuid,ARRAY[]::text[])"
    ));
    expect(error).toContain("22023");
    expect(valor(comoServidor(
      "select coalesce(array_length(tags,1),0)::text from public.crm_leads where id='" + LEAD + "'::uuid;"
    ))).toBe(antes);
    expect(numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + LEAD + "'::uuid " +
      "and event_type='lead.tag_added';"
    ))).toBe(0);
  });

  it("RPC de etiquetas: idempotência local e filtro org A/B mesmo como service_role", () => {
    const call = (org: string) => "public.fn_lead_adicionar_etiquetas('" + org +
      "'::uuid,'" + LEAD + "'::uuid,ARRAY['gate8']::text[])";
    const added = (org: string) =>
      JSON.parse(valor(comoServidor("select " + call(org) + "::text;"))) as {
        tags: string[]; adicionadas: string[];
      };
    const first = added(A);
    const second = added(A);
    expect(first.adicionadas).toEqual(["gate8"]);
    expect(first.tags).toContain("gate8");
    expect(second.adicionadas).toEqual([]);
    expect(second.tags.filter((x) => x === "gate8")).toHaveLength(1);
    expect(valor(comoServidor("select " + call(B) + " is null;"))).toBe("t");
    // Só a ação add_tag emite o evento; a RPC de junção não deve emitir sozinha.
    expect(numero(comoServidor(
      "select count(*) from public.event_log where entity_id='" + LEAD + "'::uuid " +
      "and event_type='lead.tag_added';"
    ))).toBe(0);
  });
});
