#!/usr/bin/env bash
# Hosted Supabase + Portainer Vigia, explicit release-only upgrade.
# Reuse the canonical idempotent baseline reconciler, NEVER the self-host
# update.sh entrypoint (it operates the wrong compose topology).
set -euo pipefail
cd "$(dirname "$0")/.."

no_go() { printf 'ELUS_DISTRIBUTION_NO_GO: %s\n' "$1" >&2; exit 3; }

TAG="${1:-}"
MODE="${2:---preflight}"
[[ "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || no_go 'release invalida'
[[ "$MODE" = --preflight || "$MODE" = --execute ]] || no_go 'modo invalido'
[ "$(uname -s)" = Linux ] && [[ "$(uname -m)" =~ ^(x86_64|amd64)$ ]] ||
  no_go 'somente Linux AMD64'
[ -s supabase/baseline.sql ] || no_go 'baseline do fork ausente'
[ -n "${ELUS360_SUPABASE_URL:-}" ] && [ -n "${ELUS360_SUPABASE_SERVICE_ROLE_KEY:-}" ] ||
  no_go 'segredos do gate ausentes'
[ -n "${ELUS360_PORTAINER_API_KEY:-}" ] || no_go 'token Portainer ausente'
# Preflight official release, schema and Portainer current stack without any DDL.
if [ "$MODE" = --execute ]; then
  python3 scripts/elus360-portainer-redeploy.py --release "$TAG" --pre-migration
else
  python3 scripts/elus360-portainer-redeploy.py --release "$TAG"
  exit 0
fi

[ "${ELUS360_DEPLOY_APPROVAL:-}" = "DEPLOY-ELUS360:$TAG" ] ||
  no_go 'aprovacao especifica da release ausente'
# No silent backup bypass. Operational owner must explicitly acknowledge policy.
case "${ELUS360_BACKUP_POLICY:-}" in
  verified|waived) ;;
  *) no_go 'defina ELUS360_BACKUP_POLICY=verified ou waived explicitamente' ;;
esac
[ -n "${SUPABASE_DB_ADMIN_URL:-}" ] || no_go 'admin URL de esquema ausente'
command -v docker >/dev/null 2>&1 || no_go 'docker requerido para psql efemero'
# The database host must belong to the same Supabase project as the API gate.
python3 - <<'PY' || exit 3
import os, re, sys
from urllib.parse import urlparse
api = urlparse(os.environ['ELUS360_SUPABASE_URL'])
ref = (api.hostname or '').split('.')[0]
db = urlparse(os.environ['SUPABASE_DB_ADMIN_URL'])
host = db.hostname or ''
username = db.username or ''
direct = host == f'db.{ref}.supabase.co'
pooler = host.endswith('.pooler.supabase.com') and username.endswith('.' + ref)
if not re.fullmatch(r'[a-z0-9]{20}', ref) or db.scheme not in ('postgres', 'postgresql') or not (direct or pooler):
    print('ELUS_DISTRIBUTION_NO_GO: conexao admin nao pertence ao Supabase da stack', file=sys.stderr)
    sys.exit(3)
PY

# Exact source before database mutation. Never use upstream Deskcomm releases.
source hostgator-setup-kit/_common.sh
elus360_release_tag_comprovada "$TAG" || no_go 'tag nao publicada ou fora da main'
[ "$(git rev-parse HEAD)" = "$(git rev-list -n1 "$TAG")" ] ||
  no_go 'execute o upgrade do checkout exato da release'
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse HEAD)" ] ||
  no_go 'main avancou; release nao equivale a git main da stack Portainer'

# Reuse existing update.sh schema engine but do not touch compose, volumes or
# config on the VPS. This psql container runs on the operator/GitHub runner.
log="$(mktemp)"
chmod 600 "$log"
trap 'rm -f "$log"' EXIT
pg_container postgres:17-alpine psql "$(url_do_schema)" -X -v ON_ERROR_STOP=1 -c \
  'create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;' \
  >"$log" 2>&1 || no_go 'extensoes Supabase nao puderam ser verificadas'
reaplicar_baseline "$PWD/supabase/baseline.sql" "$log" ||
  no_go 'baseline incompleto ou conflito de migration; NENHUMA imagem atualizada'
# Check the real PostgREST API cache/schema after DDL before the Portainer mutation.
pg_container postgres:17-alpine psql "$(url_do_schema)" -X -v ON_ERROR_STOP=1 \
  -c "notify pgrst, 'reload schema';" >/dev/null 2>&1 ||
  no_go 'nao foi possivel solicitar recarga do PostgREST'
python3 scripts/elus360-portainer-schema-gate.py --release "$TAG" ||
  no_go 'schema contract falhou apos baseline'
# Last chance: only the official deploy script can mutate stack 5 and it
# re-checks GitHub release, schema, Portainer config SHA and digest pins.
python3 scripts/elus360-portainer-redeploy.py --release "$TAG" --execute
