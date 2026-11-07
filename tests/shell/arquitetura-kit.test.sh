#!/usr/bin/env bash
# ELUS360 ADR-0007: install/update must reject ARM before Git, Docker or HTTP.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON="$ROOT/hostgator-setup-kit/_common.sh"
IMG_NS="$(awk -F'"' '/^IMG_NS=/{print $2; exit}' "$COMMON")"
[ -n "$IMG_NS" ] || { echo "IMG_NS ausente no kit"; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = "-m" ] && { printf '%s\n' "${FAKE_ARCH:-x86_64}"; exit 0; }
[ "${1:-}" = "-s" ] && { printf '%s\n' "${FAKE_OS:-Linux}"; exit 0; }
exec /usr/bin/uname "$@"
SH
for cmd in docker curl git; do
  cat > "$TMP/bin/$cmd" <<SH
#!/usr/bin/env bash
touch "$TMP/tocou-$cmd"
exit 99
SH
  chmod +x "$TMP/bin/$cmd"
done
chmod +x "$TMP/bin/uname"
fail=0
rodar_como() {
  local name="$1" arch="$2" sistema="${3:-Linux}" wrapper="$TMP/$name" out rc
  cat > "$wrapper" <<SH
#!/usr/bin/env bash
. "$COMMON"
printf 'DEPOIS_DA_GUARDA\n'
SH
  chmod +x "$wrapper"
  if out="$(cd "$TMP" && env FAKE_ARCH="$arch" FAKE_OS="$sistema" PATH="$TMP/bin:$PATH" bash "$wrapper" 2>&1)"; then rc=0; else rc=$?; fi
  printf '%s\n' "$rc" > "$TMP/rc-$name-$arch"
  printf '%s' "$out" > "$TMP/out-$name-$arch"
}
for name in install.sh update.sh; do
  for arch in arm64 aarch64 riscv64; do
    rodar_como "$name" "$arch"
    rc="$(cat "$TMP/rc-$name-$arch")"
    out="$(cat "$TMP/out-$name-$arch")"
    if [ "$rc" -ne 3 ] || ! printf '%s' "$out" | grep -q "ELUS_DISTRIBUTION_NO_GO" \
        || ! printf '%s' "$out" | grep -q "Linux AMD64 (x86_64)" \
        || printf '%s' "$out" | grep -q "DEPOIS_DA_GUARDA"; then
      printf 'FAIL %s recusou incorretamente %s (rc=%s)\n' "$name" "$arch" "$rc"
      fail=1
    else
      printf 'OK   %s recusa %s sem efeitos\n' "$name" "$arch"
    fi
  done
  # O processador AMD64 fora do Linux nunca autoriza instalar/atualizar.
  rodar_como "$name" x86_64 Darwin
  rc="$(cat "$TMP/rc-$name-x86_64")"
  out="$(cat "$TMP/out-$name-x86_64")"
  if [ "$rc" -ne 3 ] || ! printf '%s' "$out" | grep -q 'ELUS_DISTRIBUTION_NO_GO' \
      || printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
    printf 'FAIL %s aceitou Darwin/x86_64\n' "$name"; fail=1
  else
    printf 'OK   %s recusa Darwin/x86_64 antes de efeitos\n' "$name"
  fi
  rodar_como "$name" x86_64 Linux
  rc="$(cat "$TMP/rc-$name-x86_64")"
  if [ "$rc" -ne 0 ] || ! grep -q "DEPOIS_DA_GUARDA" "$TMP/out-$name-x86_64"; then
    printf 'FAIL %s recusa AMD64\n' "$name"; fail=1
  else
    printf 'OK   %s admite AMD64\n' "$name"
  fi
done
# An old installation marker must not bypass the permanent ARM64 rejection.
printf 'versao=v1.101.0\n' > "$TMP/.deskcomm-instalado"
printf 'APP_IMAGE=%s/elus360:1.101.0\n' "$IMG_NS" > "$TMP/.env"
rodar_como update.sh aarch64
if [ "$(cat "$TMP/rc-update.sh-aarch64")" -ne 3 ]; then
  echo 'FAIL instalação antiga ARM64 burlou bloqueio'; fail=1
fi
for cmd in docker git curl; do
  if [ -e "$TMP/tocou-$cmd" ]; then
    printf 'FAIL %s invocado antes da recusa\n' "$cmd"; fail=1
  else
    printf 'OK   %s não foi invocado\n' "$cmd"
  fi
done
exit "$fail"
