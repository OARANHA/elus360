\set ON_ERROR_STOP on
-- Banco descartável exclusivo de CI. Não executar em Supabase/produção.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}'::jsonb);
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, UPDATE, INSERT ON public.organizations TO authenticated, service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
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
