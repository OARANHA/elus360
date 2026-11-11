#!/usr/bin/env bash
# sessao.sh — o lembrete de início de sessão para quem CONTRIBUI.
#
# Ligado como hook de SessionStart (Claude Code: .claude/settings.json; Codex:
# .codex/hooks.json, depois de a pessoa aprovar em /hooks). Imprime UMA vez, e só
# quando o clone é de contribuidor: para o mantenedor, silêncio total — ele tem o
# próprio ritual. O texto vai para o contexto do assistente, não para a pessoa.
# Sai sempre com 0: um hook que falha derruba a sessão de quem só queria ler.
set -uo pipefail

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quem="$(bash "$aqui/../quem-sou.sh" --curto 2>/dev/null || echo contribuidor)"
[ "$quem" = "contribuidor" ] || exit 0

raiz="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
hooks="$(git -C "$raiz" config --get core.hooksPath 2>/dev/null || true)"
estado_hooks="hooks de git do contribuidor NÃO armados (bash .agents/skills/elus360-contribuir/scripts/armar-hooks.sh)"
case "$hooks" in *elus360-contribuir*) estado_hooks="hooks de git do contribuidor armados" ;; esac

cat <<TXT
[ELUS360] Este clone é de um contribuidor (não do mantenedor). Antes de codar ou commitar,
carregue a skill elus360-contribuir: ela mede o que a triagem mede (branch atrasada, tripla de
migration, marca do fork no diff, fragmento de release) e evita retrabalho. $estado_hooks.
Guias para outras situações: elus360-instalar, elus360-cliente-novo, elus360-metricas, elus360-prompt.
TXT
exit 0
