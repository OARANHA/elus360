#!/usr/bin/env bash
# quem-sou.sh — diferencia o mantenedor do fork ELUS360 de contribuidor,
# preservando o contrato histórico do upstream DeskcommCRM. Não autoriza ações. A skill elus360-contribuir (e os hooks) usam a
# primeira palavra da saída; o resto é para gente ler.
#
# Sinais, em ordem de custo (nenhum toca a rede sem `gh` já logado):
#   1. o e-mail do git está no .mailmap do repo como o dono do produto;
#   2. o `gh` autenticado como @OARANHA no origin ELUS360, ou como
#      @melgarafael no upstream original, sinaliza mantenedor;
#   3. o `origin` identifica o repositório (informativo; NÃO é autenticação).
#
# Uso: bash quem-sou.sh            → "mantenedor — ..." ou "contribuidor — ..."
#      bash quem-sou.sh --curto    → só a palavra
# Sai sempre com 0: identidade é informação, não veredito.
set -uo pipefail

raiz="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$raiz" ]; then
  [ "${1:-}" = "--curto" ] && echo "contribuidor" || echo "contribuidor — fora de um clone git"
  exit 0
fi

email="$(git -C "$raiz" config user.email 2>/dev/null || true)"
origin="$(git -C "$raiz" remote get-url origin 2>/dev/null || true)"
motivo=""

# 1) .mailmap: as linhas do dono começam com o nome dele e listam cada e-mail
#    provado entre <>. Lido do arquivo, não copiado para cá — a fonte é uma só.
if [ -n "$email" ] && [ -f "$raiz/.mailmap" ]; then
  # Duas etapas e busca LITERAL (-F): o e-mail do noreply do GitHub tem "+", que
  # numa expressão regular quer dizer outra coisa e fazia esse e-mail não casar.
  if grep -i '^Rafael Melgaço ' "$raiz/.mailmap" 2>/dev/null | grep -qiF "<${email}>"; then
    motivo="o e-mail do git ($email) está no .mailmap como o dono do produto"
  fi
fi

# 2) Github CLI já autenticado: só reconhece o mantenedor do repositório
# correspondente. Falha de gh/rede => contribuinte; nunca solicita login.
# Isto é conveniência de orientação, não prova de autorização para ações.
if [ -z "$motivo" ] && command -v gh >/dev/null 2>&1; then
  login="$(gh api user --jq .login 2>/dev/null || true)"
  case "$origin" in
    https://github.com/OARANHA/elus360|https://github.com/OARANHA/elus360.git|git@github.com:OARANHA/elus360|git@github.com:OARANHA/elus360.git)
      [ "$login" = "OARANHA" ] && motivo="o gh está logado como @OARANHA no fork ELUS360"
      ;;
    https://github.com/melgarafael/DeskcommCRM|https://github.com/melgarafael/DeskcommCRM.git|git@github.com:melgarafael/DeskcommCRM|git@github.com:melgarafael/DeskcommCRM.git)
      [ "$login" = "melgarafael" ] && motivo="o gh está logado como @melgarafael no upstream"
      ;;
  esac
fi

case "$origin" in
  https://github.com/OARANHA/elus360|https://github.com/OARANHA/elus360.git|git@github.com:OARANHA/elus360|git@github.com:OARANHA/elus360.git)
    remoto="origin é o repositório ELUS360" ;;
  *github.com[:/]melgarafael/DeskcommCRM*) remoto="origin é o upstream original" ;;
  "")                                       remoto="sem origin configurado" ;;
  *)                                        remoto="origin é outro repositório ($origin)" ;;
esac

if [ -n "$motivo" ]; then
  [ "${1:-}" = "--curto" ] && echo "mantenedor" || echo "mantenedor — $motivo; $remoto"
else
  [ "${1:-}" = "--curto" ] && echo "contribuidor" || echo "contribuidor — e-mail do git: ${email:-não configurado}; $remoto"
fi
exit 0
