\set ON_ERROR_STOP on
-- Banco descartável exclusivo de CI. Não executar em Supabase/produção.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}'::jsonb);
-- Schema mínimo para compilar e exercitar o RPC transacional no CI descartável.
CREATE TABLE public.ai_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, agent_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  system_prompt text, provider text, model text, credential_id uuid, operator_model text,
  tool_ids text[], trigger_config jsonb, channel_session_id uuid,
  max_steps integer, token_budget integer, cost_budget_cents integer,
  history_message_window integer, history_token_window integer,
  handoff_keywords text[], handoff_tool_enabled boolean, handoff_legal_enabled boolean,
  proposal_ai_draft_enabled boolean, cases_enabled boolean, split_messages boolean,
  split_max_chars integer, inbound_debounce_ms integer,
  pipeline_ids uuid[], knowledge_source_ids uuid[], followup jsonb,
  operator_enabled boolean, operator_tool_ids text[], created_by uuid
);
CREATE TABLE public.ai_agents (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  archived_at timestamptz, name text NOT NULL, description text,
  model text NOT NULL, system_prompt text NOT NULL, kind text NOT NULL,
  priority integer DEFAULT 0, updated_at timestamptz, is_active boolean, is_default boolean,
  created_by uuid
);
GRANT SELECT, UPDATE, INSERT ON public.ai_agents TO service_role;
GRANT SELECT, UPDATE, INSERT ON public.ai_agent_versions TO service_role;
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

-- Criação de versão protegida: a referência anterior vem do banco e
-- a numeração/tenant são definidos na transação, nunca pelo corpo.
INSERT INTO public.ai_agents(id,organization_id,name,model,system_prompt,kind)
VALUES('33333333-3333-4333-8333-333333333333',
 '11111111-1111-4111-8111-111111111111','existing','openai/old','original','mcp_agent');
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $create$
DECLARE r jsonb;
BEGIN
  r := public.fn_elus_ai_version_create_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '{"system_prompt":"nova instrucao","provider":"openai","model":"sem_grant","credential_id":null,"operator_model":null}'::jsonb,
    false);
  IF r->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_create_without_grant_%',r;
  END IF;
  UPDATE public.organizations SET ai_autonomy='{"model":true}'::jsonb;
  r := public.fn_elus_ai_version_create_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    '{"system_prompt":"nova instrucao","provider":"openai","model":"nova","credential_id":null,"operator_model":null}'::jsonb,
    false);
  IF r->>'model' IS DISTINCT FROM 'nova' OR (r->>'version_number')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL_create_with_grant_%',r;
  END IF;
END $create$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);

-- Agente inicial e versão devem nascer juntos sob o grant atual.
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $initial$
DECLARE result jsonb;
BEGIN
  UPDATE public.organizations SET ai_autonomy='{}'::jsonb;
  result := public.fn_elus_ai_agent_create_guarded(
    '11111111-1111-4111-8111-111111111111',
    '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"teste","model":"openai/new","system_prompt":"instrucoes","kind":"mcp_agent","created_by":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","system_prompt":"instrucoes","provider":"openai","model":"new","channel_session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","created_by":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    false);
  IF result->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_initial_create_revoked_%',result;
  END IF;
  IF EXISTS(SELECT 1 FROM public.ai_agents WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'FAIL_initial_create_orphan';
  END IF;
  UPDATE public.organizations SET ai_autonomy='{"provider":true,"model":true}'::jsonb;
  result := public.fn_elus_ai_agent_create_guarded(
    '11111111-1111-4111-8111-111111111111',
    '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"teste","model":"openai/new","system_prompt":"instrucoes","kind":"mcp_agent","created_by":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","system_prompt":"instrucoes","provider":"openai","model":"new","channel_session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","created_by":"11111111-1111-4111-8111-111111111111"}'::jsonb,
    false);
  IF result->'agent'->>'id' IS DISTINCT FROM 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    OR result->'version'->>'id' IS DISTINCT FROM 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    OR result->'version'->>'version_number' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'FAIL_initial_create_atomic_%',result;
  END IF;
END
$initial$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);


-- O editor grava versão e cadastro na MESMA transação. Sem grants, nenhum dado muda.
INSERT INTO public.ai_agents(id,organization_id,name,description,model,system_prompt,kind)
VALUES ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'Original','antes','old','original','mcp_agent')
ON CONFLICT (id) DO NOTHING;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $atomic$
DECLARE v jsonb;
BEGIN
  v := public.fn_elus_ai_draft_save_guarded(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    'patch','44444444-4444-4444-8444-444444444444',
    '{"model":"novo-nao-autorizado"}'::jsonb,
    '{"provider":"openai","model":"old","credential_id":null,"operator_model":null}'::jsonb,
    '{"name":"Nao gravar"}'::jsonb,false);
  IF v->>'error' IS DISTINCT FROM 'forbidden_platform_ai' THEN
    RAISE EXCEPTION 'FAIL_atomic_grant_denial: %',v;
  END IF;
END $atomic$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',false);
DO $atomic_verify$
BEGIN
  IF (SELECT name FROM public.ai_agents
        WHERE id='33333333-3333-4333-8333-333333333333') <> 'Original' THEN
    RAISE EXCEPTION 'FAIL_atomic_metadata_mutated_on_denial';
  END IF;
END $atomic_verify$;
