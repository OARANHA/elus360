\set ON_ERROR_STOP on
-- Banco descartável exclusivo de CI. Não executar em Supabase/produção.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}'::jsonb);
-- Schema mínimo para compilar e exercitar o RPC transacional no CI descartável.
CREATE TABLE public.ai_agent_versions (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, agent_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  system_prompt text, provider text, model text, credential_id uuid, operator_model text,
  tool_ids text[], trigger_config jsonb, channel_session_id uuid,
  max_steps integer, token_budget integer, cost_budget_cents integer,
  history_message_window integer, history_token_window integer,
  handoff_keywords text[], handoff_tool_enabled boolean, handoff_legal_enabled boolean,
  proposal_ai_draft_enabled boolean, cases_enabled boolean, split_messages boolean,
  split_max_chars integer, inbound_debounce_ms integer,
  pipeline_ids uuid[], knowledge_source_ids uuid[], followup jsonb
);
GRANT SELECT, UPDATE ON public.ai_agent_versions TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, UPDATE, INSERT ON public.organizations TO authenticated, service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth_uid$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth_uid$;
-- Supabase concede USAGE no schema auth aos papeis de API; simular esse contrato.
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role(), auth.uid() TO authenticated, service_role;
INSERT INTO public.organizations(id) VALUES ('11111111-1111-4111-8111-111111111111');
\ir ../../supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql
-- Reaplicação idempotente.
\ir ../../supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql

-- authenticated não pode emitir ou revogar grants, mesmo se UPDATE em settings funcionar.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$
BEGIN
  BEGIN
    UPDATE public.organizations SET ai_autonomy='{"model":true}'::jsonb;
    RAISE EXCEPTION 'FAIL_authenticated_escalation';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'elus_ai_autonomy_restricted' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.organizations SET settings='{"unchanged":true}'::jsonb;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);

-- Serviço autenticado pode configurar grants, mas não pelo simples current_user.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE public.organizations SET ai_autonomy='{"model":true}'::jsonb;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);

DO $$
BEGIN
  IF (SELECT ai_autonomy->>'model' FROM public.organizations LIMIT 1) <> 'true' THEN
    RAISE EXCEPTION 'FAIL_service_write';
  END IF;
END $$;

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$
BEGIN
  BEGIN
    UPDATE public.organizations SET ai_autonomy='{}'::jsonb;
    RAISE EXCEPTION 'FAIL_service_without_jwt';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'elus_ai_autonomy_restricted' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);

-- No banco descartável postgres-superuser (sem JWT) pode recuperar grants.
UPDATE public.organizations SET ai_autonomy='{}'::jsonb;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE ai_autonomy <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL_revocation';
  END IF;
END $$;

-- Revogação concorrente: um snapshot antigo não deve ressuscitar o grant.
-- O filtro CAS da API usa igualdade JSONB no WHERE; a operação com valor antigo
-- precisa afetar ZERO linhas depois da revogação.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE public.organizations SET ai_autonomy='{"model":true}'::jsonb;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);
UPDATE public.organizations SET ai_autonomy='{}'::jsonb;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $cas$
DECLARE
  affected integer;
BEGIN
  UPDATE public.organizations
     SET ai_autonomy='{"model":true}'::jsonb
   WHERE id='11111111-1111-4111-8111-111111111111'
     AND ai_autonomy='{"model":true}'::jsonb;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'FAIL_stale_CAS_reanimated_grant'; END IF;
END
$cas$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE ai_autonomy <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL_stale_CAS_result';
  END IF;
END
$check$;

-- Escrita atômica protegida: token service_role válido, com grant ausente => recusa.
INSERT INTO public.ai_agent_versions(id,organization_id,agent_id,status,system_prompt,provider,model)
VALUES('44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','draft','original','openai','old');
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $rpc$
DECLARE
  res jsonb;
  expect_row jsonb := '{"provider":"openai","model":"old","credential_id":null,"operator_model":null}'::jsonb;
BEGIN
  res := public.fn_elus_ai_version_patch_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '{"model":"new"}'::jsonb, expect_row, false);
  IF res->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_atomic_rpc_missing_grant_%',res;
  END IF;
END $rpc$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);

-- Serviço passa somente após concessão; revogação posterior cancela a escrita.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE public.organizations SET ai_autonomy='{"model":true}'::jsonb;
DO $rpc$
DECLARE
  res jsonb;
BEGIN
  res := public.fn_elus_ai_version_patch_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '{"model":"new"}'::jsonb,
    '{"provider":"openai","model":"old","credential_id":null,"operator_model":null}'::jsonb,
    false);
  IF res->>'model' IS DISTINCT FROM 'new' THEN
    RAISE EXCEPTION 'FAIL_atomic_rpc_granted_%',res;
  END IF;
END $rpc$;
UPDATE public.organizations SET ai_autonomy='{}'::jsonb;
DO $rpc$
DECLARE
  res jsonb;
BEGIN
  res := public.fn_elus_ai_version_patch_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '{"model":"newer"}'::jsonb,
    '{"provider":"openai","model":"new","credential_id":null,"operator_model":null}'::jsonb,
    false);
  IF res->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_atomic_rpc_revoked_%',res;
  END IF;
END $rpc$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);
