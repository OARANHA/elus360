#!/usr/bin/env bash
set -euo pipefail
# CI disposable PostgreSQL only. Exercita as duas ordens de serialização
# entre a RPC de versão protegida e a revogação de grant da organização.
# Não cobre, por si só, os writers de bindings/credentials fora dessas RPCs.
: "${PGHOST:?PGHOST required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${PGUSER:?PGUSER required}"
tmp="$(mktemp -d)"
trap 'kill "${pid:-}" 2>/dev/null || true; rm -rf "$tmp"' EXIT
psql -X -v ON_ERROR_STOP=1 -c "UPDATE public.organizations SET ai_autonomy='{\"model\":true}'::jsonb WHERE id='11111111-1111-4111-8111-111111111111'" >/dev/null
# Revoke under an exclusive row lock, keeping transaction open until signaled.
(
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE public.organizations SET ai_autonomy='{}'::jsonb
 WHERE id='11111111-1111-4111-8111-111111111111';
SELECT pg_sleep(3);
COMMIT;
SQL
) >"$tmp/revoke" 2>&1 &
pid=$!
sleep 1
# Serialize after revocation, read current grant within the same transaction.
psql -X -v ON_ERROR_STOP=1 <<'SQL' >"$tmp/check"
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT ai_autonomy FROM public.organizations
 WHERE id='11111111-1111-4111-8111-111111111111' FOR UPDATE;
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id='11111111-1111-4111-8111-111111111111'
      AND ai_autonomy->>'model' = 'true'
  ) THEN RAISE EXCEPTION 'FAIL_revocation_not_visible_after_lock'; END IF;
END
$check$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $rpc$
DECLARE
  res jsonb;
BEGIN
  res := public.fn_elus_ai_version_patch_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '{"model":"after_revoke"}'::jsonb,
    '{"provider":"openai","model":"new","credential_id":null,"operator_model":null}'::jsonb,
    false);
  IF res->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_concurrent_RPC_revocation_%',res;
  END IF;
END $rpc$;
COMMIT;
SQL
wait "$pid"
grep -q '(1 row)' "$tmp/check"


# Inverse order: a technical write obtains the organization lock FIRST;
# revocation waits and must not undo the already committed draft.
# Both clients are real PostgreSQL connections in disposable CI.
psql -X -v ON_ERROR_STOP=1 -c "UPDATE public.organizations SET ai_autonomy='{\"model\":true}'::jsonb WHERE id='11111111-1111-4111-8111-111111111111'" >/dev/null
(
  psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $writer$
DECLARE current_row jsonb; result_row jsonb;
BEGIN
  SELECT to_jsonb(v) INTO current_row
    FROM public.ai_agent_versions v
    WHERE id='44444444-4444-4444-8444-444444444444';
  result_row := public.fn_elus_ai_version_patch_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '{"model":"before_revoke"}'::jsonb,
    jsonb_build_object('provider',current_row->'provider',
      'model',current_row->'model','credential_id',current_row->'credential_id',
      'operator_model',current_row->'operator_model'),
    false);
  IF result_row->>'model' IS DISTINCT FROM 'before_revoke' THEN
    RAISE EXCEPTION 'FAIL_concurrent_write_before_revoke_%',result_row;
  END IF;
END $writer$;
-- Keep organization lock through commit so the revoker must serialize AFTER us.
SELECT pg_sleep(3);
COMMIT;
SQL
) >"$tmp/write_first" 2>&1 &
pid=$!
sleep 1
psql -X -v ON_ERROR_STOP=1 <<'SQL' >"$tmp/revoke_after_write"
BEGIN;
SET LOCAL lock_timeout='8s';
UPDATE public.organizations SET ai_autonomy='{}'::jsonb
  WHERE id='11111111-1111-4111-8111-111111111111';
COMMIT;
SQL
wait "$pid"
grep -q 'COMMIT' "$tmp/write_first"
grep -q 'UPDATE 1' "$tmp/revoke_after_write"
psql -X -v ON_ERROR_STOP=1 <<'SQL' >"$tmp/reverse_check"
DO $reverse$
BEGIN
  IF (SELECT model FROM public.ai_agent_versions
      WHERE id='44444444-4444-4444-8444-444444444444')
       IS DISTINCT FROM 'before_revoke' THEN
    RAISE EXCEPTION 'FAIL_write_before_revocation_missing';
  END IF;
  IF (SELECT ai_autonomy FROM public.organizations
      WHERE id='11111111-1111-4111-8111-111111111111') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL_revocation_after_write_not_applied';
  END IF;
END $reverse$;
SQL
