#!/usr/bin/env bash
# ELUS360 distribution: failed image pulls must NEVER build on host.
# Offline regression of the REAL _common.sh; no Docker or registry calls.
set -euo pipefail
# Os dublês Git deste teste não herdam metadados do checkout chamador.
unset $(git rev-parse --local-env-vars)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/hostgator-setup-kit/_common.sh"
fails=0
check() {
  local label="$1"; shift
  if "$@"; then printf '  OK  %s\n' "$label"
  else printf '  FAIL %s\n' "$label"; fails=$((fails+1)); fi
}
negate() { ! "$@"; }

echo 'ELUS360 — host-side builds never allowed'
for flag in "" 0 1 sim yes no; do
  DESKCOMM_BUILD_LOCAL="$flag"
  check "build request=$flag refused" negate build_local_pedido
  check "build permission=$flag refused" negate build_local_permitido v1.102.0
done
unset DESKCOMM_BUILD_LOCAL
CALLS="$(mktemp)"
trap 'rm -f "$CALLS"' EXIT
dc() { printf '%s\n' "$*" >> "$CALLS"; return 0; }
check "local-build executor refuses" negate construir_aqui_e_subir v1.102.0
check "local-build executor never calls Docker" test ! -s "$CALLS"

INSTALL="$ROOT/hostgator-setup-kit/install.sh"
UPDATE="$ROOT/hostgator-setup-kit/update.sh"
COMMON="$ROOT/hostgator-setup-kit/_common.sh"
check "installer uses --no-build" grep -Fq 'dc up -d --no-build' "$INSTALL"
check "updater uses guarded stack up" grep -Fq 'if ! subir_o_parque; then' "$UPDATE"
check "common helper uses --no-build" grep -Fq 'dc up -d --no-build' "$COMMON"
check "no host build fallback in installer/updater" bash -c "! grep -F 'if construir_aqui_e_subir' '$INSTALL' '$UPDATE'"
check "release proof precedes clone" bash -c "test \"\$(grep -n 'ELUS_RELEASE_PREVALIDADA=' '$INSTALL' | head -1 | cut -d: -f1)\" -lt \"\$(grep -n 'git clone --depth 1' '$INSTALL' | head -1 | cut -d: -f1)\""
check "foreign release override is denied" grep -Fq 'override de release externa' "$INSTALL"

printf '\n%s failed checks\n' "$fails"
[ "$fails" -eq 0 ]
