-- ELUS360 v1.94 — EXCLUSIVO do projeto Supabase elus (tbwcgdmenrcnghogqkqi).
-- DESTRUTIVO: apaga todos os objetos de aplicação em public/private.
-- NÃO executa em outros projetos Supabase.
BEGIN;
ALTER EXTENSION vector SET SCHEMA extensions;
ALTER EXTENSION citext SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
DROP SCHEMA IF EXISTS private CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
ALTER EXTENSION vector SET SCHEMA public;
ALTER EXTENSION citext SET SCHEMA public;
ALTER EXTENSION pg_trgm SET SCHEMA public;
COMMIT;
