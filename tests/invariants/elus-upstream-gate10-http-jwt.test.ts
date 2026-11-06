/**
 * Gate 10 — ensaio HTTP/JWT REAL e ISOLADO, sem endpoints do usuario.
 *
 * PostgREST 12.2.3 com imagem por digest. O PostgreSQL descartavel e
 * preparado por scripts/test-db.sh (INSTALL+UPDATE+kit) para este arquivo.
 * PGRST_DB_TX_END=rollback: TODAS as requisições voltam sem COMMIT.
 * HTTP somente 127.0.0.1; nao invoca workers ou sistemas externos.
 *
 * PASS de um diagnostico de lacuna significa que a falha foi reproduzida,
 * NUNCA significa seguranca aprovada ou exposição do Supabase real.
 */
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOV_LEAD, GOV_ORG, GOV_VIEWER, seedGov, sql, lastLine } from "./gov-helpers";
import { criarOrg, numero, uuid } from "./cobranca-helpers";

const PREFIX = "e1900010-0000-4000-8000";
const B = uuid(PREFIX, 1);
const B_PIPELINE = uuid(PREFIX, 101);
const B_STAGE = uuid(PREFIX, 102);
const B_LEAD = uuid(PREFIX, 103);
const MISSING = uuid(PREFIX, 999);
const IMAGE = "postgrest/postgrest:v12.2.3@sha256:729bf65c733b73f5b52777f0e4b853f22ed73aa67a22d38269d289779b0a8401";
const CONTAINER = "elus-g10-http-" + process.pid;
const SECRET = randomBytes(48).toString("hex");
let url = "";
let started = false;

async function pickLocalPort(): Promise<number> {
  const server = createServer();
  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || addr === null) {
        server.close();
        reject(new Error("nao foi possivel obter porta loopback"));
        return;
      }
      server.close(() => resolve(addr.port));
    });
  });
}
function signJwt(payload: Record<string, unknown>, key = SECRET): string {
  const header = { alg: "HS256", typ: "JWT" };
  const segment = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const input = segment(header) + "." + segment(payload);
  return input + "." + createHmac("sha256", key).update(input).digest("base64url");
}
function token(role: string, sub?: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ role, ...(sub ? { sub } : {}), iat: now, exp: now + 300 });
}
function count(caso: string): number {
  return numero("select count(*) from public.event_log where payload->>'gate10_http_case'='" + caso + "';");
}
async function httpEmit(caso: string, bearer: string | null, org: string, entity: string) {
  const before = count(caso);
  expect(before).toBe(0);
  const response = await fetch(url + "/rpc/emit_event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
    },
    body: JSON.stringify({
      p_event_type: "lead.tag_added",
      p_entity_kind: "crm_lead",
      p_entity_id: entity,
      p_payload: { gate10_http_case: caso },
      p_metadata: {},
      p_organization_id: org,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.text()).slice(0, 1500);
  // Se PGRST_DB_TX_END=rollback for ignorado, o teste deve falhar explicitamente.
  expect(count(caso), "PostgREST nao pode COMMITAR evento diagnostico").toBe(0);
  return { status: response.status, ok: response.ok, body };
}
beforeAll(async () => {
  const dbPort = process.env.TEST_DB_PORT;
  if (!dbPort || !process.env.TEST_DB_CONTAINER) {
    throw new Error("A prova HTTP exige pnpm test:db e banco efemero; nunca usar URL externa");
  }
  seedGov();
  criarOrg(B, "elus-g10-http-b");
  sql(
    "insert into public.crm_pipelines(id,organization_id,name,slug) " +
      "values ('" + B_PIPELINE + "','" + B + "','Gate10HTTP','elus-g10-http-b');" +
    "insert into public.crm_stages(id,organization_id,pipeline_id,name,slug,position) " +
      "values ('" + B_STAGE + "','" + B + "','" + B_PIPELINE + "','Entrada','entrada',1);" +
    "insert into public.crm_leads(id,organization_id,pipeline_id,stage_id,title,tags) " +
      "values ('" + B_LEAD + "','" + B + "','" + B_PIPELINE + "','" + B_STAGE + "','Lead B','{}'::text[]);"
  );
  const port = await pickLocalPort();
  url = "http://127.0.0.1:" + port;
  // Host networking so the sidecar connects to 127.0.0.1 TEST_DB_PORT.
  // The HTTP listener itself binds ONLY loopback; never publish to the Internet.
  execFileSync("docker", [
    "run", "--rm", "-d", "--name", CONTAINER,
    "--network", "host", "--cap-drop=ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "64", "--memory", "256m",
    "-e", "PGRST_DB_URI=postgresql://postgres:postgres@127.0.0.1:" + dbPort + "/postgres",
    "-e", "PGRST_DB_SCHEMAS=public",
    "-e", "PGRST_DB_ANON_ROLE=anon",
    "-e", "PGRST_JWT_SECRET=" + SECRET,
    "-e", "PGRST_SERVER_HOST=127.0.0.1",
    "-e", "PGRST_SERVER_PORT=" + port,
    "-e", "PGRST_DB_TX_END=rollback",
    IMAGE,
  ], { encoding: "utf8", timeout: 180_000, stdio: "pipe" });
  started = true;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(url + "/", { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) { ready = true; break; }
    } catch { /* PostgREST carregando schema */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) {
    const logs = execFileSync("docker", ["logs", "--tail", "20", CONTAINER], { encoding: "utf8" });
    throw new Error("PostgREST loopback nao iniciou: " + logs.slice(-1800));
  }
}, 240_000);
afterAll(() => {
  if (started) {
    try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore", timeout: 15_000 }); }
    catch { /* O proprio script test-db.sh descarta o PG no trap */ }
  }
  expect(Number(lastLine(sql(
    "select count(*) from public.event_log where payload->>'gate10_http_case' like 'g10_http_%';"
  )))).toBe(0);
});

describe("Gate 10 — PostgREST HTTP com JWT 100% sintetico e rollback", () => {
  it("sem JWT nao executa RPC nem grava evento", async () => {
    const r = await httpEmit("g10_http_anon", null, GOV_ORG, GOV_LEAD);
    expect([401, 403]).toContain(r.status);
  });
  it("JWT com assinatura incorreta nao executa nem grava", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wrong = signJwt({ role:"authenticated", sub:GOV_VIEWER, iat:now, exp:now+300 }, "outro-segredo-de-testes-que-nao-faz-match-xxxxxxxx");
    const r = await httpEmit("g10_http_invalid", wrong, GOV_ORG, GOV_LEAD);
    expect(r.status).toBe(401);
  });
  it("controle: viewer A JWT valido pode chamar com lead da propria organizacao", async () => {
    const r = await httpEmit("g10_http_valid", token("authenticated", GOV_VIEWER), GOV_ORG, GOV_LEAD);
    expect(r.ok, r.body).toBe(true);
  });
  it("viewer A JWT valido nao pode emitir para B; P0001 e zero escrita", async () => {
    const r = await httpEmit("g10_http_cross_org", token("authenticated", GOV_VIEWER), B, B_LEAD);
    expect(r.ok).toBe(false);
    expect(r.body).toContain("caller_not_authorized_for_org");
  });
  it("diagnostico HTTP: JWT assinado role authenticated sem sub (nao equivale a token GoTrue)", async () => {
    const r = await httpEmit("g10_http_null_sub", token("authenticated"), GOV_ORG, GOV_LEAD);
    expect(r.status).toBeLessThan(500);
    console.warn("[Gate10][HTTP][NO-GO] JWT sintetico sem sub: " + (r.ok ? "RPC ACEITOU; risco reproduzido em PostgREST descartavel" : "RPC recusou; HTTP sintético nao demonstra exposicao"));
  });
  it("LACUNA HTTP: viewer A informa entidade B com organizacao A; sem COMMIT", async () => {
    const r = await httpEmit("g10_http_foreign_entity", token("authenticated", GOV_VIEWER), GOV_ORG, B_LEAD);
    expect(r.ok, r.body).toBe(true);
    console.warn("[Gate10][HTTP][NO-GO] entidade B sob org A admitida em HTTP sintético; ROLLBACK");
  });
  it("LACUNA HTTP: viewer A informa entidade inexistente; sem COMMIT", async () => {
    const r = await httpEmit("g10_http_nonexistent", token("authenticated", GOV_VIEWER), GOV_ORG, MISSING);
    expect(r.ok, r.body).toBe(true);
    console.warn("[Gate10][HTTP][NO-GO] entidade inexistente admitida em HTTP sintético; ROLLBACK");
  });
  it("LACUNA HTTP: service_role de teste informa entidade A com org B; sem COMMIT", async () => {
    const r = await httpEmit("g10_http_service_cross", token("service_role"), B, GOV_LEAD);
    expect(r.ok, r.body).toBe(true);
    console.warn("[Gate10][HTTP][NO-GO] service_role cruza entidade/tenant sem validacao estrutural");
  });
});
