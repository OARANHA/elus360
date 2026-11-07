#!/usr/bin/env bash
# ELUS360: migrate legacy ARM build-recovery expectations into OCI fail-closed
# probes for the four owned images. No network, Docker daemon, DDL or cron.
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
  case "$2" in linux/amd64|linux/arm64) ;; *) return 1 ;; esac
  case "$1" in *"/${ELUS_MISSING_IMAGE:-__none__}:"*) return 1 ;; esac
  return 0
}
expected='elus360 elus360-worker elus360-scheduler elus360-voice-agent'
for architecture in linux/amd64 linux/arm64; do
  : > "$LOG"
  check "four-image preflight $architecture" preflight_imagens_crm 1.102.0 "$architecture"
  check "registry probed four services $architecture" test "$(grep -vc '^OCI ' "$LOG")" -eq 4
  for img in $expected; do
    check "$img registry probe $architecture" grep -Fq "$img 1.102.0" "$LOG"
    check "$img OCI probe $architecture" grep -Fq "OCI ghcr.io/oaranha/$img:1.102.0 $architecture" "$LOG"
  done
done

: > "$LOG"
ELUS_403_IMAGE=elus360-voice-agent
check 'private voice image blocks all four' negate preflight_imagens_crm 1.102.0 linux/arm64
unset ELUS_403_IMAGE
: > "$LOG"
ELUS_MISSING_IMAGE=elus360-scheduler
check 'missing ARM64 scheduler blocks update' negate preflight_imagens_crm 1.102.0 linux/arm64
unset ELUS_MISSING_IMAGE
: > "$LOG"
check 'unsupported riscv64 architecture blocked without build' negate preflight_imagens_crm 1.102.0 linux/riscv64
DESKCOMM_BUILD_LOCAL=1
check 'unsupported architecture cannot force host build' negate build_local_permitido v1.102.0
unset DESKCOMM_BUILD_LOCAL
check 'platform chooser rejects riscv64' negate plataforma_oci_do_host riscv64
check 'platform chooser admits aarch64' test "$(plataforma_oci_do_host aarch64)" = linux/arm64
printf '\n%s failed checks\n' "$fails"
[ "$fails" -eq 0 ]
