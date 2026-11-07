#!/usr/bin/env bash
# Extrai imagens da fonte oficial pinada, sem manter uma segunda lista manual.
# Pode ser sourceado sem efeitos; a consulta abaixo não lê .env da instalação.

preflight_supabase_da_ref() ( # <self-hosted/vX.Y.Z> <linux/platform>
  set -euo pipefail
  local ref="${1:-}" plataforma="${2:-}" url arquivo config imagens imagem
  if ! [[ "$ref" =~ ^self-hosted/v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'Ref do Supabase deve ser fixa (self-hosted/vX.Y.Z): %s\n' "$ref" >&2
    return 1
  fi
  # ADR-0007: um Supabase upstream multiarch pode oferecer AMD64, mas o
  # host do ELUS360 nunca é ARM64. Recusar antes de HTTP/Docker.
  [ "$plataforma" = linux/amd64 ] || {
    printf 'ELUS_DISTRIBUTION_NO_GO: Supabase self-hosted requer host linux/amd64 (recebido %s).\n' "$plataforma" >&2
    return 1
  }
  url="https://raw.githubusercontent.com/supabase/supabase/${ref}/docker/docker-compose.yml"
  arquivo="$(mktemp)" || return 1
  trap 'rm -f "$arquivo"' EXIT
  if ! curl -fsSL --max-time 30 "$url" -o "$arquivo" || [ ! -s "$arquivo" ]; then
    printf 'Não consegui ler o Compose oficial da ref %s. Nada foi instalado.\n' "$ref" >&2
    return 1
  fi

  # `--env-file /dev/null` impede leitura acidental do .env da instalação.
  # Compose valida o YAML completo e resolve as imagens; o ambiente vazio
  # impede que segredos locais sejam interpolados ou apareçam nos avisos.
  if ! config="$(env -i PATH="$PATH" HOME="${HOME:-/root}" \
    docker compose --env-file /dev/null -f "$arquivo" config --format json 2>/dev/null)"; then
    printf 'Compose oficial inválido na ref %s. Nada foi instalado.\n' "$ref" >&2
    return 1
  fi
  if ! imagens="$(printf '%s' "$config" | jq -er '
    if (.services | type) != "object" or (.services | length) == 0 then error("sem serviços")
    elif ([.services[] | select((.image | type) != "string" or (.image | length) == 0)] | length) > 0 then error("serviço sem imagem")
    else (.services[] | .image) end
  ' 2>/dev/null)"; then
    printf 'Compose da ref %s contém serviço sem imagem ou estrutura inválida.\n' "$ref" >&2
    return 1
  fi
  while IFS= read -r imagem; do
    if ! [[ "$imagem" =~ ^[A-Za-z0-9._/-]+(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$ ]] || [[ "$imagem" == *:latest ]]; then
      printf 'Referência de imagem do Supabase inválida ou mutável: %s\n' "$imagem" >&2
      return 1
    fi
    if ! manifesto_tem_plataforma "$imagem" "$plataforma"; then
      printf 'Imagem do Supabase %s não oferece %s. Nada foi instalado.\n' "$imagem" "$plataforma" >&2
      return 1
    fi
  done <<< "$imagens"
)
