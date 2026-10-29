import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sqlFile = "supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql";
const marker = "-- ---- ELUS 360 — autonomia tecnica IA (migration 9037) ----\n";
const migration = readFileSync(resolve(ROOT, sqlFile), "utf8");
const baseline = readFileSync(resolve(ROOT, "supabase/baseline.sql"), "utf8");

test("migration possui identidade, manifest e DDL de coluna separada", () => {
  assert.match(sqlFile, /\/\d{14}_9037_/);
  assert.match(migration, /^-- manifest: [^\n]+/);
  assert.match(migration, /alter table public\.organizations\s+add column if not exists ai_autonomy jsonb not null default '\{\}'::jsonb;/i);
  assert.doesNotMatch(migration, /alter table[^;]+settings\s*=/i);
  assert.ok(!migration.includes("create temporary table"));
});

test("baseline preserva migration integral e única no apêndice final", () => {
  assert.equal(baseline.split(marker).length - 1, 1);
  const pos = baseline.lastIndexOf(marker);
  assert.ok(pos > 3_000_000, "baseline parece truncado ou substituído");
  assert.equal(baseline.slice(pos + marker.length), migration);
  assert.match(baseline.slice(0, pos), /create table if not exists "public"\."organizations"/i);
});

test("trigger é invoker e somente serviço/admin banco pode mudar grants", () => {
  assert.match(migration, /create or replace function public\.fn_guard_organizations_ai_autonomy\(\)/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /if v_changed then/i);
  assert.match(migration, /auth\.role\(\)\s*=\s*'service_role'/i);
  assert.match(migration, /raise exception 'elus_ai_autonomy_restricted'/i);
  assert.match(migration, /before insert or update on public\.organizations/i);
  assert.match(migration, /revoke all on function public\.fn_guard_organizations_ai_autonomy\(\)\s+from public, anon, authenticated;/i);
});

test("DDL não é executado por este teste e arquivo fica idempotente", () => {
  assert.match(migration, /add column if not exists/i);
  assert.match(migration, /create or replace function/i);
  assert.match(migration, /drop trigger if exists/i);
  assert.doesNotMatch(migration, /^\s*(?:drop table|truncate table|delete from)\s/mi);
});
