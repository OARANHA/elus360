#!/usr/bin/env bash
# ELUS360 ADR-0007 — o instalador deve RECUSAR release/registry inválido antes
# de clone, apt, Docker, .env, banco ou backup; nunca construir na VPS.
# Smoke de fronteira com o install.sh e helpers REAIS e GitHub/GHCR dublados.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
[ -n "$WORK" ] && [ -d "$WORK" ] && [ "$WORK" != / ] || exit 1
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/kit"
cp "$ROOT/hostgator-setup-kit/install.sh" "$ROOT/hostgator-setup-kit/_common.sh" \
   "$ROOT/hostgator-setup-kit/_manifestos.sh" "$ROOT/hostgator-setup-kit/_i18n.sh" "$WORK/kit/"

cat > "$WORK/bin/uname" <<'SH'
#!/usr/bin/env bash
case "$1" in -s) printf 'Linux\n' ;; -m) printf 'x86_64\n' ;; *) exit 98 ;; esac
SH
cat > "$WORK/bin/git" <<'SH'
#!/usr/bin/env bash
case "$1" in
  ls-remote) printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v1.102.0\n' ;;
  *) printf 'git MUTANTE: %s\n' "$*" >> "$BAD_LOG"; exit 99 ;;
esac
SH
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *api.github.com/repos/OARANHA/elus360/releases/latest*)
    if [ "$MOCK_MODE" = no_release ]; then exit 22; fi
    printf '{\n "tag_name": "v1.102.0"\n}\n' ;;
  *api.github.com/repos/OARANHA/elus360/releases/tags/v1.102.0*)
    if [ "$MOCK_MODE" = draft ]; then
      printf '{\n "tag_name": "v1.102.0",\n "draft": true,\n "prerelease": false,\n "published_at": "2026-11-07T00:00:00Z"\n}\n'
    else
      printf '{\n "tag_name": "v1.102.0",\n "draft": false,\n "prerelease": false,\n "published_at": "2026-11-07T00:00:00Z"\n}\n'
    fi ;;
  *api.github.com/repos/OARANHA/elus360/compare/main...v1.102.0*)
    printf '{\n "status": "identical"\n}\n' ;;
  *ghcr.io/token*) printf '{"token":"fixture"}\n' ;;
  *ghcr.io/v2/*/manifests/*)
    if [ "$MOCK_MODE" = missing_voice ]; then
      case "$*" in *'/elus360-voice-agent/manifests/'*) printf 404 ;; *) printf 200 ;; esac
    elif [ "$MOCK_MODE" = offline ]; then printf 000
    else printf 403; fi ;;
  *) printf 'curl inesperado: %s\n' "$*" >> "$BAD_LOG"; exit 99 ;;
esac
SH
for cmd in docker apt-get crontab psql pg_dump; do
  cat > "$WORK/bin/$cmd" <<'SH'
#!/usr/bin/env bash
printf '%s MUTANTE: %s\n' "$(basename "$0")" "$*" >> "$BAD_LOG"
exit 99
SH
done
chmod +x "$WORK/bin/"*

FAILS=0
check() {
  local label="$1"; shift
  if "$@"; then printf '  ✓ %s\n' "$label"; else printf '  ✗ %s\n' "$label"; FAILS=$((FAILS+1)); fi
}
run() { # <scenario> <mode> [ENV=VALUE ...]
  local case_name="$1" mode="$2"; shift 2
  : > "$WORK/bad-$case_name"
  (cd "$WORK" && env PATH="$WORK/bin:$PATH" BAD_LOG="$WORK/bad-$case_name" \
      MOCK_MODE="$mode" "$@" bash "$WORK/kit/install.sh" --yes) \
      > "$WORK/out-$case_name" 2>&1
  RC=$?
  check "$case_name recusa com RC=3" test "$RC" -eq 3
  check "$case_name produz motivo ELUS_DISTRIBUTION_NO_GO" \
    grep -q ELUS_DISTRIBUTION_NO_GO "$WORK/out-$case_name"
  check "$case_name não executa Docker, apt, git mutante ou banco" \
    test ! -s "$WORK/bad-$case_name"
  check "$case_name não gera .env" test ! -e "$WORK/.env"
}

run sem_release no_release
run draft_ao_invés_de_release draft
run imagem_privada private
run imagem_voz_ausente missing_voice
run registry_offline offline
run build_local_ignorado private DESKCOMM_BUILD_LOCAL=1
run origem_estranha private REPO_URL=https://github.com/qualquer/outro.git

# O comando não pode nem oferecer o fallback na fonte de produção.
INSTALL="$ROOT/hostgator-setup-kit/install.sh"
check 'instalador usa somente Compose sem build' grep -Fq 'dc up -d --no-build' "$INSTALL"
check 'instalador não chama construção local em fallback' \
  bash -c '! grep -Fq "if construir_aqui_e_subir" "$1"' _ "$INSTALL"
check 'gate de release antecede clone' \
  bash -c 'p=$(grep -n "ELUS_RELEASE_PREVALIDADA=" "$1" | head -1 | cut -d: -f1); c=$(grep -n "git clone --depth 1" "$1" | head -1 | cut -d: -f1); [ -n "$p" ] && [ -n "$c" ] && [ "$p" -lt "$c" ]' _ "$INSTALL"

printf '\n%s falha(s)\n' "$FAILS"
[ "$FAILS" -eq 0 ]
