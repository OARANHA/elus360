#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
# Única fixture canônica compartilhada com o teste de setup.sh/single-server.
cp "$ROOT/tests/fixtures/supabase-self-hosted-v0.8.1-compose.yml" "$TMP/compose.yml"
cp "$TMP/compose.yml" "$TMP/compose-oficial.yml"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *releases/latest*) printf '%s' '{"tag_name":"v1.66.1"}'; exit 0 ;;
  *ghcr.io/token*) printf '%s' '{"token":"teste"}'; exit 0 ;;
  *ghcr.io/v2/*) printf 200; exit 0 ;;
  *raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.1/docker/docker-compose.yml*) ;;
  *) exit 81 ;;
esac
dest=''
while [ "$#" -gt 0 ]; do
  [ "$1" = -o ] && { shift; dest="$1"; }
  shift
done
[ -n "$dest" ] && cp "$COMPOSE_FIXTURE" "$dest"
STUB
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH" COMPOSE_FIXTURE="$TMP/compose.yml"
source "$ROOT/hostgator-setup-kit/_common.sh"
source "$ROOT/hostgator-setup-kit/_supabase-images.sh"
manifesto_tem_plataforma() {
  printf '%s %s\n' "$1" "$2" >> "$TMP/probes"
  [ "${TEST_BAD_IMAGE:-}" != "$1" ]
}
ok() { local name="$1"; shift; "$@" >"$TMP/out" 2>&1 || { echo "✗ $name: $(<"$TMP/out")"; exit 1; }; echo "✓ $name"; }
reject() { local name="$1"; shift; if "$@" >"$TMP/out" 2>&1; then echo "✗ $name aceito"; exit 1; fi; echo "✓ $name"; }

ok 'as 11 imagens da ref pinada são descobertas do Compose' preflight_supabase_da_ref self-hosted/v0.8.1 linux/amd64
test "$(wc -l < "$TMP/probes")" = 11 || { echo '✗ não sondou as 11 imagens'; exit 1; }
grep -q 'supabase/postgres:17.6.1.136 linux/amd64' "$TMP/probes"

printf '  adicional:\n    image: exemplo/novo-servico:1.0.0\n' >> "$TMP/compose.yml"
: > "$TMP/probes"
ok 'a 12ª imagem nova é sondada sem lista manual' preflight_supabase_da_ref self-hosted/v0.8.1 linux/amd64
test "$(wc -l < "$TMP/probes")" = 12 || { echo '✗ a 12ª imagem ficou de fora'; exit 1; }
grep -q 'exemplo/novo-servico:1.0.0 linux/amd64' "$TMP/probes"

TEST_BAD_IMAGE=exemplo/novo-servico:1.0.0
reject 'nova imagem sem AMD64 bloqueia a ref' preflight_supabase_da_ref self-hosted/v0.8.1 linux/amd64
unset TEST_BAD_IMAGE
: > "$TMP/probes"
reject 'Supabase ARM64 recusa antes de consultar registry' preflight_supabase_da_ref self-hosted/v0.8.1 linux/arm64
test ! -s "$TMP/probes" || { echo '✗ ARM64 consultou OCI antes de ser recusado'; exit 1; }
printf '  quebrado:\n    image: "bad@@@"\n' >> "$TMP/compose.yml"
reject 'referência de imagem malformada bloqueia' preflight_supabase_da_ref self-hosted/v0.8.1 linux/amd64
reject 'ref não pinada bloqueia' preflight_supabase_da_ref main linux/amd64

installer="$(<"$ROOT/hostgator-setup-kit/install-single-server.sh")"
before="${installer%%preflight_supabase_da_ref *}"
test "$before" != "$installer" || { echo '✗ instalador não chama pré-voo Supabase'; exit 1; }
case "$before" in
  *'mkdir -p "$RUNTIME_DIR"'*|*'docker network create'*|*'sh "$setup_tmp"'*|*'OWNER_PASSWORD'*'openssl rand'*)
    echo '✗ estado criado antes da sonda'; exit 1 ;;
esac
echo '✓ sonda antecede .runtime, rede e setup oficial'

# Execução real do instalador numa árvore descartável: a 11ª imagem não oferece
# AMD64. A recusa deve vir antes de criar .runtime, rede ou credenciais.
mkdir -p "$TMP/instalador/hostgator-setup-kit"
cp "$ROOT/hostgator-setup-kit/install-single-server.sh" \
  "$ROOT/hostgator-setup-kit/_common.sh" \
  "$ROOT/hostgator-setup-kit/_manifestos.sh" \
  "$ROOT/hostgator-setup-kit/_supabase-images.sh" \
  "$ROOT/hostgator-setup-kit/_i18n.sh" "$TMP/instalador/hostgator-setup-kit/"
cat > "$TMP/bin/uname" <<'STUB'
#!/usr/bin/env bash
[ "$*" = -m ] && { printf '%s\n' "${FAKE_ARCH:-x86_64}"; exit 0; }
exec /usr/bin/uname "$@"
STUB
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
[ -z "${DOCKER_LOG:-}" ] || printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  compose) exec /usr/bin/docker "$@" ;;
  info|ps) exit 0 ;;
esac
if [ "$1 $2 $3" = 'buildx imagetools inspect' ]; then
  case " $* " in
    *' --raw '*) printf '%s' '{"schemaVersion":2,"manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"linux","architecture":"arm64"}}]}';;
    *' supabase/supavisor:2.9.12 '*) printf 'linux/arm64\n';;
    *) printf 'linux/amd64\nlinux/arm64\n';;
  esac
  exit 0
fi
exit 91
STUB
chmod +x "$TMP/bin/uname" "$TMP/bin/docker"
DOCKER_LOG="$TMP/docker-log" \
  COMPOSE_FIXTURE="$TMP/compose-oficial.yml" \
  DESKCOMM_RELEASES_LATEST_URL=https://example.invalid/releases/latest \
  bash "$TMP/instalador/hostgator-setup-kit/install-single-server.sh" \
    --domain crm.example.com >"$TMP/instalador-out" 2>&1 \
  && { echo '✗ instalador aceitou Supabase sem AMD64'; exit 1; }
test ! -e "$TMP/instalador/.runtime" || { echo '✗ criou .runtime antes da recusa'; exit 1; }
test ! -e "$TMP/instalador/.env" || { echo '✗ criou credenciais antes da recusa'; exit 1; }
! grep -Eq 'network create| compose .*up|setup.sh' "$TMP/docker-log" || { echo '✗ alterou Docker antes da recusa'; exit 1; }
grep -qi 'imagens do Supabase incompletas' "$TMP/instalador-out" || { echo '✗ recusa não explicou Supabase'; exit 1; }
echo '✓ instalador AMD64 recusa Supabase sem OCI AMD64 antes de criar estado'

# Regra de host separada: nem uma instalação existente autoriza aarch64.
: > "$TMP/docker-log"
if FAKE_ARCH=aarch64 DOCKER_LOG="$TMP/docker-log" COMPOSE_FIXTURE="$TMP/compose-oficial.yml" \
   bash "$TMP/instalador/hostgator-setup-kit/install-single-server.sh" \
   --domain crm.example.com >"$TMP/arm-out" 2>&1; then
  echo '✗ instalador single-server aceitou ARM64'; exit 1
else
  arm_rc=$?
fi
[ "$arm_rc" -eq 3 ] || { echo "✗ ARM64 não devolveu RC=3: $arm_rc"; exit 1; }
grep -q 'ELUS_DISTRIBUTION_NO_GO' "$TMP/arm-out" || { echo '✗ ARM64 sem NO-GO'; exit 1; }
test ! -s "$TMP/docker-log" || { echo '✗ ARM64 consultou Docker'; exit 1; }
test ! -e "$TMP/instalador/.runtime" || { echo '✗ ARM64 criou .runtime'; exit 1; }
echo '✓ single-server recusa ARM64 (RC=3), sem rede, Docker ou credenciais'

# A ref do Supabase é conferida quando ela MUDA (a pinagem exata está em
# single-server-installer.test.sh), nunca na promoção de `stable`: ali uma falha
# de rede ou uma imagem upstream sem arm64 seguraria a release de todos.
workflow="$(<"$ROOT/.github/workflows/publish-image.yml")"
case "$workflow" in
  *'preflight_supabase_da_ref'*) echo '✗ a release depende da sonda de rede do Supabase'; exit 1 ;;
  *) echo '✓ a promoção de stable não depende da sonda do Supabase' ;;
esac
