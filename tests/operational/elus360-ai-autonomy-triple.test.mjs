import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sqlFile = "supabase/migrations/20261028235959_9900_elus_ai_autonomy_guarded.sql";
const marker = "-- ---- ELUS 360 — autonomia tecnica IA (migration 9037) ----\n";
const migration = readFileSync(resolve(ROOT, sqlFile), "utf8");
const baseline = readFileSync(resolve(ROOT, "supabase/baseline.sql"), "utf8");
const forward = readFileSync(resolve(ROOT, "supabase/migrations/20261106140000_9901_elus_ai_agent_create_fields.sql"), "utf8");
const forward9902 = readFileSync(resolve(ROOT, "supabase/migrations/20261106160000_9902_elus_molde_chutes_pt409.sql"), "utf8");
const forward9903 = readFileSync(resolve(ROOT, "supabase/migrations/20261106170000_9903_elus_agent_version_columns.sql"), "utf8");
const marker9902 = "-- 20261106160000_9902_elus_molde_chutes_pt409\n";
const marker9903 = "-- 20261106170000_9903_elus_agent_version_columns\n";

test("migration possui identidade, manifest e DDL de coluna separada", () => {
  assert.match(sqlFile, /\/\d{14}_9900_/);
  assert.match(migration, /^-- manifest: [^\n]+/);
  assert.match(migration, /alter table public\.organizations\s+add column if not exists ai_autonomy jsonb not null default '\{\}'::jsonb;/i);
  assert.doesNotMatch(migration, /alter table[^;]+settings\s*=/i);
  assert.ok(!migration.includes("create temporary table"));
});

test("baseline preserva migration integral e única no apêndice final", () => {
  assert.equal(baseline.split(marker).length - 1, 1);
  const pos = baseline.lastIndexOf(marker);
  assert.ok(pos > 3_000_000, "baseline parece truncado ou substituído");
  const scan = baseline.indexOf("-- ---- VARREDURA anon:", pos);
  assert.ok(scan > pos, "varredura de ACL deve ser executada APÓS as funções ELUS");
  assert.equal(baseline.slice(pos + marker.length, scan),
    migration + forward + marker9902 + forward9902 + "\n" + marker9903 + forward9903);
  assert.equal(baseline.split(marker9902).length - 1, 1);
  assert.equal(baseline.split(marker9903).length - 1, 1);
  assert.equal(baseline.split("-- ---- VARREDURA anon:").length - 1, 1);
  assert.doesNotMatch(baseline.slice(scan), /^\s*create\s+(?:or\s+replace\s+)?function/gim);
  assert.doesNotMatch(baseline.slice(scan), /^\s*grant\s+[^;]*\bto\b[^;]*\banon\b/gim);
  assert.match(baseline.slice(0, pos), /create table if not exists "public"\."organizations"/i);
});

test("trigger é invoker e somente serviço/admin banco pode mudar grants", () => {
  assert.match(migration, /create or replace function public\.fn_guard_organizations_ai_autonomy\(\)/i);
  assert.match(migration, /security invoker/i);
  assert.match(forward, /security invoker/i);
  assert.match(forward, /image_vision_enabled/i);
  assert.match(forward, /reply_min_interval_ms/i);
  assert.match(forward, /skill_names/i);
  assert.match(forward, /voz_quando/i);
  assert.match(migration, /if v_changed then/i);
  assert.match(migration, /current_user\s*=\s*'service_role'/i);
  assert.match(migration, /current_user\s*=\s*'service_role'\s+and\s+auth\.role\(\)\s*=\s*'service_role'/i);
  assert.match(migration, /raise exception 'elus_ai_autonomy_restricted'/i);
  assert.match(migration, /before insert or update on public\.organizations/i);
  assert.match(migration, /revoke all on function public\.fn_guard_organizations_ai_autonomy\(\)\s+from public, anon, authenticated;/i);
});

test("DDL não é executado por este teste e arquivo fica idempotente", () => {
  assert.match(migration, /add column if not exists/i);
  assert.match(migration, /create or replace function/i);
  assert.match(migration, /drop trigger if exists/i);
  assert.doesNotMatch(migration, /^\s*(?:drop table|truncate table)\s/mi);
  // DELETE de credencial só pode ocorrer pela operação explicitamente delimitada.
  const deletes = [...migration.matchAll(/^\s*delete from\s+public\.ai_provider_credentials\b/gmi)];
  assert.equal(deletes.length, 1, "exclusão de credenciais fora do RPC esperado");
  assert.match(migration, /delete from public\.ai_provider_credentials\s+where id=p_id and organization_id=p_org;/i);
  assert.doesNotMatch(migration, /^\s*delete from\s+(?!public\.ai_provider_credentials\b)/gmi);
});
