#!/usr/bin/env bash
# Executa somente em runner Linux AMD64 efemero.
# Sem secrets de producao, sem Portainer remoto, sem chamadas ao Supabase hospedado.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

no_go() { printf 'ELUS_INTEGRATED_NO_GO: %s\n' "$1" >&2; exit 3; }
release=v1.108.1
previous=v1.102.0
release_sha=3d53429a536c2dc585e7c676ef79b4a280871dfd
previous_sha=2f7f99196183df40524daf2e24203d2a3b35676d
source hostgator-setup-kit/_common.sh
ns="$IMG_NS"
net=elus-hml
db=postgresql://postgres:postgres@127.0.0.1:54322/postgres
env_file="$RUNNER_TEMP/elus-hml.env"
sql_log="$RUNNER_TEMP/elus-hml-baseline.log"
db_file="$RUNNER_TEMP/elus-hml-baseline-old.sql"

cleanup() {
  for name in elus-hml-app elus-hml-worker elus-hml-scheduler elus-hml-waha elus-hml-srh elus-hml-redis; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  docker network rm "$net" >/dev/null 2>&1 || true
  supabase stop --no-backup >/dev/null 2>&1 || true
  rm -f "$env_file" "$sql_log" "$db_file"
}
trap cleanup EXIT

[ "$GITHUB_REPOSITORY" = OARANHA/elus360 ] || no_go 'repositorio diferente do fork'
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || no_go 'runner deve ser Linux AMD64'
for x in ELUS360_SUPABASE_URL ELUS360_SUPABASE_SERVICE_ROLE_KEY ELUS360_PORTAINER_API_KEY SUPABASE_DB_ADMIN_URL; do
  [ -z "$(printenv "$x" 2>/dev/null || true)" ] || no_go 'segredo operacional inesperado no runner'
done
for x in .env .env.local .env.production; do [ ! -e "$x" ] || no_go 'arquivo de configuracao operacional presente'; done
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$release_sha" ] ||
  no_go 'main mudou; o teste deve fixar release publicada antes da proxima alteracao'
git fetch --no-tags origin "refs/tags/$previous:refs/tags/$previous" "refs/tags/$release:refs/tags/$release" >/dev/null
[ "$(git rev-list -n1 "$previous")" = "$previous_sha" ] || no_go 'tag anterior divergente'
[ "$(git rev-list -n1 "$release")" = "$release_sha" ] || no_go 'tag alvo divergente'

notes="$(curl --fail --silent --show-error --retry 2 "https://api.github.com/repos/OARANHA/elus360/releases/tags/$release")" ||
  no_go 'release oficial indisponivel'
printf '%s' "$notes" | jq -e --arg t "$release" --arg s "$release_sha" \
  '.tag_name == $t and .target_commitish == $s and .draft == false and .prerelease == false and (.published_at != null)' >/dev/null ||
  no_go 'release nao publicada ou fora do SHA fixado'
body="$(printf '%s' "$notes" | jq -r '.body')"
image_app="$ns/elus360:1.108.1@sha256:8a6b23340d17e759ea0812288b0294d2baa2060891961ed043483ac7c0d000a7"
image_worker="$ns/elus360-worker:1.108.1@sha256:233743552466fbea1968428092e3d0960ab234908d7a77499f869b2f7cb9e8ab"
image_scheduler="$ns/elus360-scheduler:1.108.1@sha256:b26e9f101f062e6b6367aa102f6c08e72a8fd6837e473ef8cea18ce5eca0ca78"
image_voice="$ns/elus360-voice-agent:1.108.1@sha256:35062a58542e76c58756744a1f549263bacb504938b5ac2c6e3e55446489af04"
for ref in "$image_app" "$image_worker" "$image_scheduler" "$image_voice"; do
  printf '%s\n' "$body" | grep -Fxq "$ref" || no_go 'digest nao coincide com release oficial'
done
old_app="$ns/elus360:1.102.0@sha256:2d5c8d8582e304b7496e8a113a60912aa0002b9c03bd6237530fc23cc728d3d6"
old_worker="$ns/elus360-worker:1.102.0@sha256:adc3ab66b62b9e2cbb55735b1e6df5c8c1befc7693ff461f7ea24a7374f4e0df"
old_scheduler="$ns/elus360-scheduler:1.102.0@sha256:a379a8d7ebb1511dbf0411ccd1b1d200b64c8a18d877293c473f30a883d78f34"

# Imagens de distribuicao: pull por digest, nunca build local nem :stable.
for ref in "$old_app" "$old_worker" "$old_scheduler" "$image_app" "$image_worker" "$image_scheduler" "$image_voice"; do
  docker pull --quiet "$ref" >/dev/null || no_go 'imagem de release indisponivel'
  [ "$(docker image inspect "$ref" --format '{{.Architecture}}')" = amd64 ] ||
    no_go 'imagem sem arquitetura AMD64'
done

# O stack real do Supabase e criado no runner, sem migrations em cadeia.
mv supabase/migrations "$RUNNER_TEMP/migrations-original"
mkdir -p supabase/migrations
supabase start -x studio,postgres-meta || no_go 'Supabase local nao subiu'
psql "$db" -X -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL
git show "$previous:supabase/baseline.sql" > "$db_file" || no_go 'baseline anterior ausente'
psql "$db" -X -v ON_ERROR_STOP=1 -q -f "$db_file" ||
  no_go 'baseline anterior falhou em Supabase descartavel'
psql "$db" -X -v ON_ERROR_STOP=1 -q -c \
  "create table public.elus_hml_fixture (id int primary key, marker text not null); insert into public.elus_hml_fixture values (1,'persistiu');" ||
  no_go 'fixture anterior nao persistiu'

# Chaves geradas somente pelo Supabase local; nunca exportar valores no summary.
bash scripts/gerar-env-e2e.sh >/dev/null || no_go 'env do Supabase local indisponivel'
set -a
source .env.e2e
set +a
case "$NEXT_PUBLIC_SUPABASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) no_go 'Supabase fora do loopback';; esac
case "$SUPABASE_DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) no_go 'Postgres fora do loopback';; esac
umask 077
cat > "$env_file" <<EOF
NODE_ENV=production
NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres
NEXT_PUBLIC_APP_URL=http://app:3000
NEXT_PUBLIC_ADMIN_URL=http://app:3000
INTERNAL_SECRET=$INTERNAL_SECRET
CPF_ENCRYPTION_KEY=$CPF_ENCRYPTION_KEY
WAHA_BYO_ENCRYPTION_KEY=$WAHA_BYO_ENCRYPTION_KEY
AI_CRED_AES_KEY=$AI_CRED_AES_KEY
WAHA_API_BASE_URL=http://waha:3000
WAHA_API_KEY=$WAHA_API_KEY
WAHA_WEBHOOK_BASE_URL=http://app:3000
UPSTASH_REDIS_REST_URL=http://srh:80
UPSTASH_REDIS_REST_TOKEN=e2e-token-nao-e-segredo
SENTRY_DSN=off
NEXT_TELEMETRY_DISABLED=1
EOF
chmod 600 "$env_file"

docker network create "$net" >/dev/null
docker run -d --name elus-hml-redis --network "$net" --network-alias redis redis:7-alpine >/dev/null
for i in $(seq 1 35); do
  if docker exec elus-hml-redis redis-cli ping 2>/dev/null | grep -Fxq PONG; then break; fi
  sleep 1
done
docker exec elus-hml-redis redis-cli ping | grep -Fxq PONG || no_go 'Redis nao respondeu'
docker run -d --name elus-hml-srh --network "$net" --network-alias srh \
  -e SRH_MODE=env -e SRH_TOKEN=e2e-token-nao-e-segredo \
  -e SRH_CONNECTION_STRING=redis://redis:6379 \
  'hiett/serverless-redis-http@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150' >/dev/null
docker run -d --name elus-hml-waha --network "$net" --network-alias waha \
  -e WAHA_NO_API_KEY=True -e WHATSAPP_DEFAULT_ENGINE=NOWEB \
  -e WAHA_DASHBOARD_ENABLED=false -e WHATSAPP_HOOK_URL=http://app:3000/api/v1/webhooks/waha \
  devlikeapro/waha:latest-2026.7.2 >/dev/null

start_services() {
  local app_image="$1" worker_image="$2" scheduler_image="$3"
  docker run -d --name elus-hml-app --network "$net" --network-alias app \
    --add-host host.docker.internal:host-gateway --env-file "$env_file" \
    "$app_image" >/dev/null || no_go 'app nao iniciou'
  docker run -d --name elus-hml-worker --network "$net" \
    --add-host host.docker.internal:host-gateway --env-file "$env_file" \
    "$worker_image" >/dev/null || no_go 'worker nao iniciou'
  docker run -d --name elus-hml-scheduler --network "$net" \
    -e INTERNAL_SECRET="$INTERNAL_SECRET" "$scheduler_image" >/dev/null ||
    no_go 'scheduler nao iniciou'
}
stop_services() {
  docker rm -f elus-hml-app elus-hml-worker elus-hml-scheduler >/dev/null
}
assert_services() {
  local expected="$1" ok=0
  for i in $(seq 1 55); do
    if docker exec elus-hml-app node -e \
      'fetch("http://127.0.0.1:3000/api/v1/health").then(async r=>{const j=await r.json();process.exit(r.ok&&j.data?.status==="healthy"&&j.data?.version===process.argv[1]?0:1)}).catch(()=>process.exit(1))' \
      "$expected" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || no_go 'health app/Supabase/WAHA/Redis ou SHA divergente'
  ok=0
  for i in $(seq 1 30); do
    if docker exec elus-hml-worker node -e \
      'fetch("http://127.0.0.1:8787/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || no_go 'worker /healthz indisponivel'
  [ "$(docker inspect -f '{{.State.Running}}' elus-hml-scheduler)" = true ] ||
    no_go 'scheduler encerrou'
}

start_services "$old_app" "$old_worker" "$old_scheduler"
assert_services "$previous_sha"
stop_services

# A mesma funcao canonica do upgrade reexecuta baseline sobre o banco do runner.
export PROJECT_DIR="$PWD" SUPABASE_DB_ADMIN_URL="$db" PSQL_DOCKER_NETWORK=host BASELINE_TENTATIVAS=1
source hostgator-setup-kit/_common.sh
reaplicar_baseline "$PWD/supabase/baseline.sql" "$sql_log" ||
  no_go 'baseline da nova versao nao convergiu em upgrade real'
[ "$(psql "$db" -X -At -v ON_ERROR_STOP=1 -c 'select marker from public.elus_hml_fixture where id=1')" = persistiu ] ||
  no_go 'fixture nao foi preservada no upgrade'
psql "$db" -X -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from pg_tables where schemaname='public' and not rowsecurity and tablename <> 'elus_hml_fixture';" \
  | grep -Fxq 0 || no_go 'tabela publica sem RLS apos upgrade'

start_services "$image_app" "$image_worker" "$image_scheduler"
assert_services "$release_sha"
stop_services

# Apenas rollback de imagens, sem prometer reversao de DDL:
start_services "$old_app" "$old_worker" "$old_scheduler"
assert_services "$previous_sha"
stop_services

cat >> "$GITHUB_STEP_SUMMARY" <<EOF
### ELUS360 homologacao integrada — laboratorio
- Codigo/fixture: apenas runner efemero; sem segredo, banco ou VPS de producao.
- Release anterior: v1.102.0 com app/worker/scheduler reais e health SHA validado.
- Supabase local: Auth, PostgREST e Postgres; baseline anterior aplicado.
- Redis, SRH e WAHA Core: processos reais e app confirmou health healthy.
- Upgrade: baseline 1.108.1 via reconciliador canonico; fixture preservada e RLS checada.
- Release nova: app/worker/scheduler publicados rodaram e health confirmou SHA 3d53429a536c2dc585e7c676ef79b4a280871dfd.
- Rollback: imagem anterior voltou a responder sem reverter schema; nao comprova rollback DDL.
- NAO COMPROVADO: backup recuperavel do Supabase produtivo, WAHA Plus/autenticacao real, RLS entre tenants com usuario, integracoes de clientes.
- Nenhuma promocao stable, DDL de producao ou Portainer alterado.
EOF
