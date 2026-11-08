#!/usr/bin/env bash
# ELUS360 ADR-0007: só Linux AMD64; preflight antes de mutações.
# Registry, Docker e Git são simulados; não há rede, banco, containers ou VPS real.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
source "$ROOT/hostgator-setup-kit/_common.sh"
IMG_NS=ghcr.io/exemplo
: > "$TMP/probes"

ghcr_status() {
  printf 'REGISTRY %s %s\n' "$1" "$2" >> "$TMP/probes"
  if [ "$TEST_OFFLINE" = 1 ]; then printf 000; return; fi
  if [ "$TEST_MISSING" = "$1" ]; then printf 404; return; fi
  printf 200
}
manifesto_tem_plataforma() {
  printf 'OCI %s %s\n' "$1" "$2" >> "$TMP/probes"
  [ "$TEST_BAD_IMAGE" != "$1" ]
}
TEST_OFFLINE=0 TEST_MISSING=__none__ TEST_BAD_IMAGE=__none__
ok() { local name="$1"; shift; "$@" > "$TMP/out" 2>&1 || { echo "✗ $name: $(cat "$TMP/out")"; exit 1; }; echo "✓ $name"; }
reject() { local name="$1"; shift; if "$@" > "$TMP/out" 2>&1; then echo "✗ $name foi aceito"; exit 1; fi; echo "✓ $name"; }

WAHA_IMAGE=devlikeapro/waha:latest-2026.7.2
ok 'quatro imagens próprias e WAHA completas em AMD64' preflight_plataforma_atualizacao v1.102.0 linux/amd64
for img in elus360 elus360-worker elus360-scheduler elus360-voice-agent; do
  grep -Fq "REGISTRY $img 1.102.0" "$TMP/probes" || { echo "✗ GHCR não sondou $img"; exit 1; }
  grep -Fq "OCI $IMG_NS/$img:1.102.0 linux/amd64" "$TMP/probes" || { echo "✗ OCI não sondou $img"; exit 1; }
done
grep -Fq "OCI $WAHA_IMAGE linux/amd64" "$TMP/probes" || { echo '✗ WAHA não sondada'; exit 1; }

: > "$TMP/probes"
reject 'ARM64 recusada mesmo com release íntegra' preflight_plataforma_atualizacao v1.102.0 linux/arm64
grep -Fq ELUS_DISTRIBUTION_NO_GO "$TMP/out" || { echo '✗ recusa ARM64 sem causa'; exit 1; }
test ! -s "$TMP/probes" || { echo '✗ registro consultado antes de negar ARM64'; exit 1; }
reject 'riscv64 é recusada' preflight_plataforma_atualizacao v1.102.0 linux/riscv64
test ! -s "$TMP/probes" || { echo '✗ registro consultado antes de negar riscv64'; exit 1; }

TEST_MISSING=elus360-voice-agent
reject 'quarta imagem ausente bloqueia update' preflight_plataforma_atualizacao v1.102.0 linux/amd64
grep -Fq 'elus360-voice-agent' "$TMP/out" || { echo '✗ pacote ausente não identificado'; exit 1; }
TEST_MISSING=__none__
TEST_OFFLINE=1
reject 'registry fora do ar bloqueia update' preflight_plataforma_atualizacao v1.102.0 linux/amd64
TEST_OFFLINE=0
TEST_BAD_IMAGE=registry.exemplo/waha-plus:custom
WAHA_IMAGE="$TEST_BAD_IMAGE"
reject 'WAHA customizada incompatível é recusada' preflight_plataforma_atualizacao v1.102.0 linux/amd64
test "$WAHA_IMAGE" = "$TEST_BAD_IMAGE" || { echo '✗ WAHA do operador foi alterada'; exit 1; }
TEST_BAD_IMAGE=__none__
ok 'WAHA customizada compatível em AMD64 é preservada' preflight_plataforma_atualizacao v1.102.0 linux/amd64
grep -Fq 'registry.exemplo/waha-plus:custom linux/amd64' "$TMP/probes"
WAHA_IMAGE=devlikeapro/waha:latest-2026.7.2
ok 'WAHA padrão é preservada' preflight_plataforma_atualizacao v1.102.0 linux/amd64
reject 'tag móvel não é versão oficial' preflight_plataforma_atualizacao stable linux/amd64
reject 'tag malformada não é versão oficial' preflight_plataforma_atualizacao v1.102 linux/amd64

# Confere a sequência no updater real, não só funções isoladas.
updater="$ROOT/hostgator-setup-kit/update.sh"
linha() { grep -nF "$1" "$updater" | head -1 | cut -d: -f1; }
origem="$(linha 'elus360_origem_confiavel')"
release="$(linha 'elus360_release_publicada_no_main "$TARGET_TAG"')"
dono="$(linha 'recusar_projeto_de_outra_arvore || refuse')"
fetch="$(linha 'git fetch --tags --quiet origin')"
manifestos="$(linha 'ELUS_VEREDITO_IMAGENS=')"
preflight="$(linha 'if ! preflight_plataforma_atualizacao "$TARGET_TAG"')"
backup="$(linha 'if bash "$KIT_DIR/backup.sh"')"
test -n "$origem" && test -n "$release" && test -n "$dono" && test -n "$fetch" && test -n "$manifestos" && test -n "$preflight" && test -n "$backup" || { echo '✗ alguma etapa obrigatória desapareceu'; exit 1; }
test "$origem" -lt "$release" && test "$release" -lt "$dono" && test "$dono" -lt "$fetch" &&
  test "$fetch" -lt "$manifestos" && test "$manifestos" -lt "$preflight" && test "$preflight" -lt "$backup" || { echo '✗ proteção de procedência/arquitetura ocorre após mutações'; exit 1; }
! grep -qE '^if \[ "\$PLATAFORMA_HOST" = linux/arm64 \]' "$updater" || { echo '✗ fallback ARM64 reintroduzido'; exit 1; }
echo '✓ origem, release, propriedade, tag, GHCR e OCI são verificados antes de backup'

# Bootstrap pré-upgrade também deve recusar arquitetura errada SEM alterar a .env.
bootstrap="$ROOT/hostgator-setup-kit/preflight-upgrade.sh"
test -f "$bootstrap"
mkdir -p "$TMP/instalacao" "$TMP/bin"
printf 'services: {}\n' > "$TMP/instalacao/docker-compose.prod.yml"
printf 'WAHA_IMAGE=registry.exemplo/plus:custom\nTEST_SECRET=nao_vazar\n' > "$TMP/instalacao/.env"
cp "$TMP/instalacao/.env" "$TMP/env-antes"
cat > "$TMP/bin/uname" <<'STUB'
#!/usr/bin/env bash
case "$1" in -s) printf 'Linux\n';; -m) printf 'aarch64\n';; *) exit 99;; esac
STUB
cat > "$TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$REGISTRO_DOCKER"
exit 99
STUB
chmod +x "$TMP/bin/"*
: > "$TMP/docker-acoes"
if (cd "$TMP" && REGISTRO_DOCKER="$TMP/docker-acoes" PATH="$TMP/bin:$PATH" bash "$bootstrap" --installation "$TMP/instalacao" --to v1.102.0 > "$TMP/out-bootstrap" 2>&1); then
  echo '✗ bootstrap aceitou ARM64'; exit 1
fi
grep -Fq ELUS_DISTRIBUTION_NO_GO "$TMP/out-bootstrap" || { echo '✗ bootstrap recusou sem explicar arquitetura'; exit 1; }
cmp -s "$TMP/instalacao/.env" "$TMP/env-antes" || { echo '✗ bootstrap alterou .env'; exit 1; }
test ! -s "$TMP/docker-acoes" || { echo '✗ bootstrap consultou/alterou Docker em ARM64'; exit 1; }
! grep -Fq nao_vazar "$TMP/out-bootstrap" || { echo '✗ bootstrap vazou segredo'; exit 1; }
echo '✓ bootstrap legado recusa ARM64 sem ler Docker, editar .env ou vazar segredo'

# O carregamento sequencial não pode sombrear funções críticas.
dup="$(cat "$ROOT"/hostgator-setup-kit/{_i18n,_manifestos,_common,_supabase-images,manutencao}.sh | grep -oE '^[A-Za-z_][A-Za-z0-9_]*\(\)' | sort | uniq -d)"
test -z "$dup" || { echo "✗ função duplicada no kit: $dup"; exit 1; }
echo '✓ sem helpers com nomes duplicados'
