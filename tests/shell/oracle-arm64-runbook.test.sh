#!/usr/bin/env bash
# Mantém o runbook historico sem comandos operacionais; a decisao superveniente da ADR-0007 prevalece.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
doc="$root/docs/runbooks/oracle-arm64.md"
test -f "$doc"
for term in 'não suportado' 'ADR-0007' 'Linux AMD64' 'VM.Standard.A1.Flex' 'ELUS_DISTRIBUTION_NO_GO' 'compilação local' 'dispositivos ARM64'; do
  grep -Fq "$term" "$doc" || { echo "✗ aviso ARM64 sem $term" >&2; exit 1; }
done
# Nenhuma receita executável: a página existe para impedir, não habilitar deploy.
! grep -Eq '^[[:space:]]*(bash[[:space:]]+.*install|docker[[:space:]]+(run|compose[[:space:]]+up)|curl.*\|[[:space:]]*sh)' "$doc" || {
  echo '✗ runbook ARM64 voltou a ensinar instalação' >&2; exit 1;
}
source "$root/hostgator-setup-kit/_manifestos.sh"
[ "$(plataforma_oci_do_host aarch64 Linux)" = linux/arm64 ] || { echo '✗ helper OCI recusou ARM64 condicional'; exit 1; }
if plataforma_oci_do_host x86_64 Darwin > /dev/null 2>&1; then echo '✗ helper OCI aceitou macOS'; exit 1; fi
[ "$(plataforma_oci_do_host x86_64 Linux)" = linux/amd64 ]
echo '✓ runbook historico sem receita, helper admite Linux AMD64/ARM64 condicional'
