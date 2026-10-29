#!/usr/bin/env bash
set -euo pipefail
# CI disposable PostgreSQL only. Demonstrates row-lock serialization required by
# a future technical-write transaction; does NOT imply the API currently uses it.
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
