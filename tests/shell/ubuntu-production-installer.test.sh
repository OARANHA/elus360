#!/usr/bin/env bash
# Testes sem efeitos colaterais para a porta de entrada de produção.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/ubuntu-production-installer.sh"
FAILS=0

check() {
  local descricao="$1"
  shift
  if "$@"; then
    printf '  ✓ %s\n' "$descricao"
  else
    printf '  ✗ %s\n' "$descricao"
    FAILS=$((FAILS + 1))
  fi
}

echo "instalador Ubuntu de produção"
check "sintaxe Bash válida" bash -n "$SCRIPT"

ajuda="$(bash "$SCRIPT" --help 2>&1)"
check "--help termina sem preparar o host" test "$?" -eq 0
check "ajuda explica que pergunta somente o domínio" grep -q "pergunta somente o domínio" <<<"$ajuda"
check "ajuda distingue os serviços locais" grep -q "Serviços locais em Docker" <<<"$ajuda"
check "ajuda inclui o Supabase self-hosted" grep -q "Supabase self-hosted" <<<"$ajuda"
check "ajuda documenta --domain" grep -q -- "--domain crm.suaempresa.com.br" <<<"$ajuda"
check "ajuda exige VPS Linux AMD64" grep -q "VPS Linux AMD64 (x86_64)" <<<"$ajuda"
check "ajuda não promete ARM64" bash -c '! grep -q "ARM64" <<<"$1"' _ "$ajuda"

saida_invalida="$(bash "$SCRIPT" --desconhecido 2>&1)"
rc_invalido=$?
check "opção desconhecida é recusada" test "$rc_invalido" -eq 2
check "recusa mostra o uso" grep -q "Uso: bash ubuntu-production-installer.sh" <<<"$saida_invalida"

check "delega ao instalador single-server" \
  grep -q 'hostgator-setup-kit/install-single-server.sh' "$SCRIPT"
check "guarda só permite amd64" \
  grep -q 'x86_64|amd64)' "$SCRIPT"
check "recusa Linux não suportado antes de instalar" \
  grep -q 'ELUS_DISTRIBUTION_NO_GO' "$SCRIPT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cat > "$WORK/bin/uname" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  -s) printf '%s\n' "${FAKE_OS:-Linux}" ;;
  -m) printf '%s\n' "${FAKE_ARCH:-aarch64}" ;;
  *) exit 99 ;;
esac
STUB
cat > "$WORK/bin/apt-get" <<'STUB'
#!/usr/bin/env bash
printf 'apt %s\n' "$*" >> "$APT_LOG"
exit 99
STUB
chmod +x "$WORK/bin/"*
: > "$WORK/apt.log"
for caso in aarch64 arm64 riscv64; do
  saida="$(PATH="$WORK/bin:$PATH" APT_LOG="$WORK/apt.log" FAKE_ARCH="$caso" bash "$SCRIPT" --domain crm.example.com 2>&1)"
  rc=$?
  check "$caso recusa com RC 3" test "$rc" -eq 3
  check "$caso traz NO-GO explícito" grep -q ELUS_DISTRIBUTION_NO_GO <<<"$saida"
done
saida="$(PATH="$WORK/bin:$PATH" APT_LOG="$WORK/apt.log" FAKE_ARCH=x86_64 FAKE_OS=Darwin bash "$SCRIPT" --domain crm.example.com 2>&1)"
rc=$?
check "Darwin AMD64 recusa com RC 3" test "$rc" -eq 3
check "preflight não chamou apt-get em arquitetura incompatível" test ! -s "$WORK/apt.log"
check "não mantém uma segunda lista de variáveis do .env" \
  bash -c '! grep -qE "^(DOMAIN|SUPABASE_DB_URL|WAHA_API_KEY|INTERNAL_SECRET)=" "$1"' _ "$SCRIPT"

if [[ "$FAILS" -ne 0 ]]; then
  printf '\n%d teste(s) falharam.\n' "$FAILS"
  exit 1
fi

printf '\nTodos os testes do instalador Ubuntu passaram.\n'
