#!/usr/bin/env bash
# ELUS360 ADR-0007: AMD64/ARM64 condicional, com prova OCI de quatro imagens.
# Fully offline. No registry, Docker, DDL, network or crontab.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/hostgator-setup-kit/_common.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOG="$WORK/registry-probes"
fails=0
check() {
  local label="$1"; shift
  if "$@"; then printf '  OK  %s\n' "$label"
  else printf '  FAIL %s\n' "$label"; fails=$((fails+1)); fi
}
negate() { ! "$@"; }
ghcr_status() {
  printf '%s %s\n' "$1" "$2" >> "$LOG"
  if [ "$1" = "${ELUS_403_IMAGE:-}" ]; then printf '403'; else printf '200'; fi
}
manifesto_tem_plataforma() {
  printf 'OCI %s %s\n' "$1" "$2" >> "$LOG"
  [ "$2" = "${OCI_ALLOWED_PLATFORM:-linux/amd64}" ] || return 1
  case "$1" in *"/${ELUS_MISSING_IMAGE:-__none__}:"*) return 1 ;; esac
  return 0
}
expected='elus360 elus360-worker elus360-scheduler elus360-voice-agent'
: > "$LOG"
check 'four-image preflight linux/amd64' preflight_imagens_crm 1.102.0 linux/amd64
check 'registry probed exactly four packages' test "$(grep -vc '^OCI ' "$LOG")" -eq 4
for img in $expected; do
  check "$img registry probe" grep -Fq "$img 1.102.0" "$LOG"
  check "$img OCI probe AMD64" grep -Fq "OCI ${IMG_NS}/$img:1.102.0 linux/amd64" "$LOG"
done
: > "$LOG"
ELUS_403_IMAGE=elus360-voice-agent
check 'private voice image blocks install' negate preflight_imagens_crm 1.102.0 linux/amd64
unset ELUS_403_IMAGE
: > "$LOG"
ELUS_MISSING_IMAGE=elus360-scheduler
check 'missing AMD64 scheduler blocks update' negate preflight_imagens_crm 1.102.0 linux/amd64
unset ELUS_MISSING_IMAGE
# ARM64 requer manifestos nativos para cada imagem: nunca faz fallback para AMD64.
: > "$LOG"
check 'arm64 denied if only amd64 images exist' negate preflight_imagens_crm 1.102.0 linux/arm64
check 'arm64 probes registry before OCI rejection' test -s "$LOG"
OCI_ALLOWED_PLATFORM=linux/arm64
: > "$LOG"
check 'four-image preflight linux/arm64 when each OCI supports it' preflight_imagens_crm 1.102.0 linux/arm64
check 'four ARM64 OCI manifests probed' test "$(grep -c '^OCI ' "$LOG")" -eq 4
unset OCI_ALLOWED_PLATFORM
for bad in linux/riscv64 linux/386; do
  : > "$LOG"
  check "unsupported OCI $bad rejected" negate preflight_imagens_crm 1.102.0 "$bad"
  check "OCI $bad denied before registry" test ! -s "$LOG"
done
DESKCOMM_BUILD_LOCAL=1
check 'explicit opt-in recognized without bypassing OCI preflight' build_local_permitido v1.102.0
unset DESKCOMM_BUILD_LOCAL
check 'platform chooser admits x86_64' test "$(plataforma_oci_do_host x86_64)" = linux/amd64
check 'platform chooser admits aarch64' test "$(plataforma_oci_do_host aarch64)" = linux/arm64
check 'platform chooser admits arm64' test "$(plataforma_oci_do_host arm64)" = linux/arm64
check 'platform chooser rejects riscv64' negate plataforma_oci_do_host riscv64
check 'kit architecture admits aarch64' test "$(veredito_da_arquitetura aarch64 1)" = arm64
printf '\n%s failed checks\n' "$fails"
[ "$fails" -eq 0 ]
