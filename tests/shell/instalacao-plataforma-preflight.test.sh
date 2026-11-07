#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/hostgator-setup-kit/_common.sh"
IMG_NS=ghcr.io/exemplo

ghcr_status() {
  printf 'REGISTRY %s %s\n' "$1" "$2" >> "$TMP/probes"
  if [ "${TEST_STATUS:-200}" != 200 ]; then printf '%s' "$TEST_STATUS"; return; fi
  if [ "${TEST_MISSING:-}" = "$1" ]; then printf 404; else printf 200; fi
}
manifesto_tem_plataforma() {
  printf 'OCI %s %s\n' "$1" "$2" >> "$TMP/probes"
  if [ -n "${TEST_BAD_IMAGE:-}" ] && [[ "$1" == *"$TEST_BAD_IMAGE"* ]]; then
    printf 'Imagem %s não oferece %s\n' "$1" "$2" >&2
    return 1
  fi
  if [ -n "${TEST_BAD_WAHA:-}" ] && [ "$1" = "$TEST_BAD_WAHA" ]; then
    printf 'WAHA %s não oferece %s\n' "$1" "$2" >&2
    return 1
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ok() { local nome="$1"; shift; if "$@" >"$TMP/out" 2>&1; then echo "✓ $nome"; else echo "✗ $nome: $(<"$TMP/out")"; exit 1; fi; }
recusa() { local nome="$1" motivo="$2"; shift 2; if "$@" >"$TMP/out" 2>&1; then echo "✗ $nome passou"; exit 1; fi; grep -q "$motivo" "$TMP/out" || { echo "✗ $nome sem causa: $(<"$TMP/out")"; exit 1; }; echo "✓ $nome"; }

ok 'versão numérica completa em Linux AMD64' preflight_instalacao 1.102.0 linux/amd64 devlikeapro/waha:latest-2026.7.2
for image in elus360 elus360-worker elus360-scheduler elus360-voice-agent; do
  grep -Fq "REGISTRY $image 1.102.0" "$TMP/probes" || { echo "✗ não sondou $image"; exit 1; }
  grep -Fq "OCI ${IMG_NS}/$image:1.102.0 linux/amd64" "$TMP/probes" || { echo "✗ OCI não sondado em $image"; exit 1; }
done
TEST_MISSING=elus360-voice-agent
recusa 'release ainda sem a quarta imagem' elus360-voice-agent preflight_instalacao 1.102.0 linux/amd64 devlikeapro/waha:latest-2026.7.2
unset TEST_MISSING
TEST_BAD_IMAGE=elus360-worker:1.101.0
recusa 'imagem própria sem AMD64 não instala' linux/amd64 preflight_instalacao 1.101.0 linux/amd64 devlikeapro/waha:latest-2026.7.2
unset TEST_BAD_IMAGE
WAHA_IMAGE=registry.exemplo/plus:licenciada
TEST_BAD_WAHA="$WAHA_IMAGE"
recusa 'WAHA customizada incompatível é recusada' WAHA preflight_instalacao 1.102.0 linux/amd64 "$WAHA_IMAGE"
test "$WAHA_IMAGE" = registry.exemplo/plus:licenciada || { echo '✗ WAHA customizada foi trocada'; exit 1; }
unset TEST_BAD_WAHA
ok 'WAHA Plus compatível é preservada' preflight_instalacao 1.102.0 linux/amd64 "$WAHA_IMAGE"
TEST_STATUS=000
recusa 'registry offline falha fechado' 000 preflight_instalacao 1.102.0 linux/amd64 "$WAHA_IMAGE"
unset TEST_STATUS
: > "$TMP/probes"
recusa 'ARM64 proibido mesmo com quatro imagens no registry' ELUS_DISTRIBUTION_NO_GO preflight_instalacao 1.102.0 linux/arm64 devlikeapro/waha:latest-2026.7.2
test ! -s "$TMP/probes" || { echo '✗ o registry foi consultado antes de recusar ARM64'; exit 1; }
ok 'imagem padrão de WAHA preservada em AMD64' preflight_instalacao 1.102.0 linux/amd64 devlikeapro/waha:latest-2026.7.2
recusa 'canal mutável não é versão de preflight' numérica preflight_instalacao stable linux/amd64 devlikeapro/waha:latest-2026.7.2

# Preflight de versão e WAHA deve anteceder provisionamento, escrita de .env,
# schema e compose. As funções acima dublam o registry sem efeitos externos.
instalador="$(<"$ROOT/hostgator-setup-kit/install.sh")"
pre="${instalador%%preflight_instalacao \"\$VERSAO_ALVO\"*}"
test "$pre" != "$instalador" || { echo '✗ install não chama preflight_instalacao'; exit 1; }
case "$pre" in
  *'bash "$KIT_DIR/supabase-provision.sh"'*) echo '✗ preflight ocorre após provisionar Supabase'; exit 1 ;;
  *'envq APP_IMAGE'*|*'reaplicar_baseline'*|*'dc up -d'*) echo '✗ preflight ocorre após alterar estado'; exit 1 ;;
esac
echo '✓ instalação preflight antes de efeitos'
