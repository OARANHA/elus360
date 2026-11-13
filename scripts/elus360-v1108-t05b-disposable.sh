#!/usr/bin/env bash
# T05-B: banco SQL descartavel, sem URLs/credenciais de producao.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=0b60c5abaace17922ae645399a6a6183a5f5c357
BASE=4b5815721710c9b1e99078322593838fda1ee740
MIGRATIONS=(
  supabase/migrations/20261028235959_9900_elus_ai_autonomy_guarded.sql
  supabase/migrations/20261106140000_9901_elus_ai_agent_create_fields.sql
  supabase/migrations/20261106160000_9902_elus_molde_chutes_pt409.sql
  supabase/migrations/20261106170000_9903_elus_agent_version_columns.sql
)
fail() { echo "T05B_NO_GO: $*" >&2; exit 3; }
for bin in git docker sha256sum; do command -v "$bin" >/dev/null || fail "missing $bin"; done
TMP="$(mktemp -d)"
DB="elus-t05b-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() { docker rm -f "$DB" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
git fetch --no-tags https://github.com/melgarafael/DeskcommCRM.git \
  'refs/tags/v1.102.0:refs/elus-t05b/source' 'refs/tags/v1.108.0:refs/elus-t05b/target'
test "$(git rev-parse 'refs/elus-t05b/source^{commit}')" = "$BASE" || fail 'base SHA mismatch'
test "$(git rev-parse 'refs/elus-t05b/target^{commit}')" = "$TARGET" || fail 'target SHA mismatch'
test "$(git rev-parse "$TARGET:supabase/baseline.sql")" = e82bf528e36dce1c3f118c645c7e76fe2f93230b || fail 'baseline blob mismatch'
git show "$BASE:supabase/baseline.sql" > "$TMP/v1102.sql"
git show "$TARGET:supabase/baseline.sql" > "$TMP/v1108.sql"
sha256sum "$TMP/v1102.sql" "$TMP/v1108.sql" | awk '{print "OFFICIAL_SHA256=" $1}'
for path in "${MIGRATIONS[@]}"; do
  test -s "$path" || fail "missing $path"
  sha256sum "$path" | awk '{print "ELUS_MIGRATION_SHA256=" $1}'
done
docker run --name "$DB" -d --network none -e POSTGRES_PASSWORD=disposable-only pgvector/pgvector:pg17 >/dev/null
ready=0
for _ in $(seq 1 45); do
  if docker logs "$DB" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' &&
     test "$(docker exec "$DB" psql -X -At -U postgres -d postgres -c 'select 1' 2>/dev/null)" = 1; then
    ready=1; break
  fi
  sleep 1
done
test "$ready" = 1 || fail 'postgres init failed'
psql_db() { local db="$1"; docker exec -i "$DB" psql -X -q -U postgres -d "$db" -v ON_ERROR_STOP=1 -f -; }
init_db() {
  local db="$1"
  docker exec "$DB" createdb -U postgres "$db"
  psql_db "$db" < scripts/selfhost-prelude.sql
  psql_db "$db" <<'SQL'
create or replace function auth.role() returns text language sql stable as $$
select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role');
$$;
SQL
}
apply() { local db="$1" path="$2"; echo "T05B_APPLY database=$db source=$(basename "$path")"; psql_db "$db" < "$path"; }
overlay() { local db="$1"; for path in "${MIGRATIONS[@]}"; do apply "$db" "$path"; done; }
init_db elus_fresh
apply elus_fresh "$TMP/v1108.sql"
overlay elus_fresh
init_db elus_upgrade
apply elus_upgrade "$TMP/v1102.sql"
psql_db elus_upgrade <<'SQL'
insert into public.organizations(id,slug,legal_name,display_name)
values ('dddddddd-0000-4000-8000-000000000001','t05b-before-upgrade','T05B before','T05B before');
SQL
docker exec "$DB" pg_dump -U postgres -Fc -d elus_upgrade > "$TMP/pre-upgrade.dump"
test -s "$TMP/pre-upgrade.dump" || fail 'snapshot empty'
apply elus_upgrade "$TMP/v1108.sql"
overlay elus_upgrade
docker exec "$DB" createdb -U postgres elus_restore
docker exec -i "$DB" pg_restore -U postgres -d elus_restore --no-owner < "$TMP/pre-upgrade.dump"
psql_db elus_restore <<'SQL'
do $$ begin
  if not exists (select 1 from public.organizations where slug='t05b-before-upgrade') then
    raise exception 'T05B_RESTORE_RECORD_LOST'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='organizations' and column_name='ai_autonomy') then
    raise exception 'T05B_RESTORE_NOT_PRE_UPGRADE'; end if;
end $$;
SQL
echo T05B_PRE_UPGRADE_RESTORE_OK
for schema in elus_fresh elus_upgrade; do
  psql_db "$schema" <<'SQL'
do $gate$
declare p oid := to_regprocedure('public.fn_elus_ai_version_patch_guarded(uuid,uuid,uuid,jsonb,jsonb,boolean)');
        c oid := to_regprocedure('public.fn_elus_ai_agent_create_guarded(uuid,jsonb,jsonb,boolean)');
begin
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='organizations' and column_name='ai_autonomy' and data_type='jsonb')
   then raise exception 'T05B_NO_AI_AUTONOMY'; end if;
 if not exists(select 1 from pg_trigger where tgname='trg_guard_organizations_ai_autonomy' and not tgisinternal)
   then raise exception 'T05B_NO_GUARD_TRIGGER'; end if;
 if p is null or c is null then raise exception 'T05B_RPC_MISSING'; end if;
 if has_function_privilege('anon',p,'execute') or has_function_privilege('authenticated',p,'execute')
    or not has_function_privilege('service_role',p,'execute') then raise exception 'T05B_PATCH_GRANTS'; end if;
 if has_function_privilege('anon',c,'execute') or has_function_privilege('authenticated',c,'execute')
    or not has_function_privilege('service_role',c,'execute') then raise exception 'T05B_CREATE_GRANTS'; end if;
 if not (select relrowsecurity from pg_class where oid='public.ai_agents'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.ai_agent_versions'::regclass)
    then raise exception 'T05B_AGENT_RLS_DISABLED'; end if;
 if position('chutes' in pg_get_functiondef('public.fn_llm_do_molde_de_ia()'::regprocedure))=0
    then raise exception 'T05B_CHUTES_MOLD_ABSENT'; end if;
 if position('operator_model' in pg_get_functiondef(p))=0
    then raise exception 'T05B_VERSION_CONTRACT'; end if;
end $gate$;
SQL
echo "T05B_SQL_CATALOG_OK database=$schema"
done
psql_db elus_upgrade <<'SQL'
do $$ begin
  if not exists(select 1 from public.organizations where slug='t05b-before-upgrade') then
    raise exception 'T05B_UPGRADE_RECORD_LOST'; end if;
end $$;
SQL
echo T05B_UPGRADE_DATA_OK
psql_db elus_fresh <<'SQL'
insert into auth.users(id,email) values
('aaaaaaaa-1111-4000-8000-000000000001','a@invariant.test'),
('bbbbbbbb-1111-4000-8000-000000000002','b@invariant.test');
insert into public.organizations(id,slug,legal_name,display_name) values
('aaaaaaaa-0000-4000-8000-000000000001','t05b-a','Tenant A','Tenant A'),
('bbbbbbbb-0000-4000-8000-000000000002','t05b-b','Tenant B','Tenant B');
insert into public.user_organizations(user_id,organization_id,role,accepted_at) values
('aaaaaaaa-1111-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','agent',now()),
('bbbbbbbb-1111-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','agent',now());
insert into public.contacts(organization_id,display_name) values
('aaaaaaaa-0000-4000-8000-000000000001','T05B Fixture A'),
('bbbbbbbb-0000-4000-8000-000000000002','T05B Fixture B');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-4000-8000-000000000001","role":"authenticated"}',false);
set role authenticated;
do $$ begin
if (select count(*) from public.contacts where display_name like 'T05B Fixture %') <> 1
or (select count(*) from public.contacts where display_name='T05B Fixture A') <> 1
then raise exception 'T05B_RLS_A_FAILED'; end if;
end $$;
reset role;
update public.user_organizations set revoked_at=now()
where user_id='aaaaaaaa-1111-4000-8000-000000000001';
set role authenticated;
do $$ begin
 if exists(select 1 from public.contacts where display_name like 'T05B Fixture %')
 then raise exception 'T05B_REVOKED_ACCESS'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-1111-4000-8000-000000000002","role":"authenticated"}',false);
set role authenticated;
do $$ begin
if (select count(*) from public.contacts where display_name like 'T05B Fixture %') <> 1
or (select count(*) from public.contacts where display_name='T05B Fixture B') <> 1
then raise exception 'T05B_RLS_B_FAILED'; end if;
end $$;
reset role;
SQL
echo T05B_TWO_TENANTS_AND_REVOCATION_OK
psql_db elus_fresh <<'SQL'
update public.organizations set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{llm}',
 '{"provider":"chutes","default_model":"t05b-fixture-model"}'::jsonb) where slug='t05b-b';
insert into public.platform_settings(id,molde_de_ia_org_id)
values(1,'bbbbbbbb-0000-4000-8000-000000000002')
on conflict(id) do update set molde_de_ia_org_id=excluded.molde_de_ia_org_id;
insert into public.ai_purpose_bindings(organization_id,purpose,provider,model_id,base_url,is_enabled)
values('bbbbbbbb-0000-4000-8000-000000000002','stage_classifier','chutes',
 't05b-fixture-model',null,true);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
set role service_role;
insert into public.organizations(id,slug,legal_name,display_name,status,settings)
values('cccccccc-0000-4000-8000-000000000003','t05b-chutes-new','New','New','active','{}'::jsonb);
reset role;
do $$ begin
 if (select settings->'llm'->>'provider' from public.organizations
   where slug='t05b-chutes-new') is distinct from 'chutes'
   then raise exception 'T05B_CHUTES_DEFAULT_NOT_COPIED'; end if;
 if not exists(select 1 from public.ai_purpose_bindings b
   join public.organizations o on o.id=b.organization_id
   where o.slug='t05b-chutes-new' and b.provider='chutes'
   and b.credential_id is null and b.base_url is null)
   then raise exception 'T05B_CHUTES_BINDING_NOT_COPIED'; end if;
end $$;
SQL
echo T05B_CHUTES_NEW_TENANT_OK
echo T05B_DISPOSABLE_POSTGRES_PASS_NO_PRODUCTION_APPROVAL
