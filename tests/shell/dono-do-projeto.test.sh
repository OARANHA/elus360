#!/usr/bin/env bash
# Prova do guarda que impede DUAS cópias do repo de disputarem os mesmos
# contêineres — `recusar_projeto_de_outra_arvore` em `_common.sh`, e os dois
# call sites que o usam (`agent.sh` e `update.sh`).
#
#   bash tests/shell/dono-do-projeto.test.sh
#
# ── O defeito que ele guarda, medido numa VPS de verdade ────────────────────
#
# `/root/DeskcommCRM` e `/root/apagar6/DeskcommCRM` — o clone de produção e um
# de teste ao lado — têm o mesmo basename, logo o mesmo nome de projeto compose
# (`deskcommcrm`). O cron rodava o agent.sh das DUAS a cada 5 minutos. Em
# 21/08 13:30 o clone de teste recriou o contêiner do WhatsApp com a chave do
# .env dele; às 14:47 o app foi recriado da árvore de produção, com outra chave.
# Resultado: `waha_create_401` em toda chamada, por três dias, nenhum número
# conectando — e a única pista na tela era "não foi possível verificar".
#
# O `flock` do agent.sh não pega isso: ele tranca por DIRETÓRIO, e as duas
# árvores pegam locks diferentes enquanto disputam o mesmo parque.
#
# Nada aqui toca a máquina de quem roda: `docker` é um dublê que devolve os
# labels que o teste manda.
set -uo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../hostgator-setup-kit" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
check() {  # check <descrição> <comando...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}

# ── Dublê de docker ──────────────────────────────────────────────────────────
# Devolve, uma por linha, as árvores em $DONOS — que é o que
# `docker ps --format '{{.Label "...working_dir"}}'` imprime de verdade.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
case " $* " in
  *" ps "*) printf '%s\n' ${DONOS:-} ;;
  *) : ;;
esac
STUB
chmod +x "$WORK/bin/docker"
PATH="$WORK/bin:$PATH"

# ── Duas árvores de verdade no disco ─────────────────────────────────────────
# Precisam existir COM um compose: o guarda só conta como rival a instalação que
# ainda está no disco — quem apenas moveu a pasta deixa contêineres apontando
# para um caminho morto, e travar esse caso seria um gate nascendo vermelho em
# quem não fez nada de errado.
PROD="$WORK/root/DeskcommCRM"
TESTE="$WORK/root/apagar6/DeskcommCRM"
MUDOU_DE_PASTA="$WORK/root/endereco-antigo"   # de propósito: NÃO é criado
mkdir -p "$PROD" "$TESTE"
touch "$PROD/docker-compose.prod.yml" "$TESTE/docker-compose.prod.yml"

# `recusar_...` roda numa subshell para que o `set -e` do _common.sh e um
# eventual `exit` não derrubem este arquivo de teste.
guarda() {  # guarda <PROJECT_DIR> [DONOS...] → exit code; mensagem no stdout
  local dir="$1"; shift
  (
    DONOS="$*" PROJECT_DIR="$dir" \
    bash -c '. "$0"/_common.sh 2>/dev/null || true
             PROJECT_DIR="$1"
             recusar_projeto_de_outra_arvore' "$KIT_DIR" "$dir" 2>&1
  )
}

printf '\n▶ o guarda em si\n'

saida="$(guarda "$PROD")"; rc=$?
check "sem contêiner no ar, a instalação nova assume (rc=0)" test "$rc" -eq 0

saida="$(guarda "$PROD" "$PROD")"; rc=$?
check "parque criado pela MESMA árvore segue (rc=0)" test "$rc" -eq 0

saida="$(guarda "$PROD" "$TESTE")"; rc=$?
check "parque criado por OUTRA árvore é recusado (rc≠0)" test "$rc" -ne 0
check "a recusa nomeia a árvore intrusa" grep -q "apagar6" <<<"$saida"
check "a recusa nomeia a árvore corrente" grep -qF "$PROD" <<<"$saida"
check "a recusa ensina a saída (crontab)" grep -q "crontab" <<<"$saida"

# O caso REAL da VPS: app/waha de uma árvore, redis/srh da outra. Uma checagem
# que olhasse só o PRIMEIRO contêiner daria o parque por são.
saida="$(guarda "$PROD" "$PROD" "$TESTE" "$PROD")"; rc=$?
check "parque MISTO (o caso medido) é recusado" test "$rc" -ne 0

saida="$(DESKCOMM_ASSUMIR_PROJETO=1 guarda "$PROD" "$TESTE")"; rc=$?
check "DESKCOMM_ASSUMIR_PROJETO=1 é a saída explícita (rc=0)" test "$rc" -eq 0

# O gate não pode nascer vermelho em quem só mudou a instalação de pasta: os
# contêineres seguem apontando para o endereço antigo, que já não existe. Aquilo
# não é um rival — é esta mesma instalação, no endereço de ontem.
saida="$(guarda "$PROD" "$MUDOU_DE_PASTA")"; rc=$?
check "instalação MOVIDA de pasta não é rival (rc=0)" test "$rc" -eq 0

# Mas se a árvore antiga ainda está lá com um compose, ela PODE rodar um segundo
# cron — e aí é rival de novo.
saida="$(guarda "$PROD" "$TESTE" "$MUDOU_DE_PASTA")"; rc=$?
check "árvore morta + árvore VIVA: a viva ainda faz recusar" test "$rc" -ne 0
check "e a recusa não cita o endereço morto" bash -c '! grep -qF "$1" <<<"$2"' _ "$MUDOU_DE_PASTA" "$saida"

printf '\n▶ os call sites (guardar a função não basta se ninguém a chama)\n'

check "agent.sh chama o guarda e desiste" \
  grep -qE '^recusar_projeto_de_outra_arvore .*\|\| exit 0' "$KIT_DIR/agent.sh"
# A recusa operacional do atualizador tem RC=3 (refuse), distinto de erro (die=1).
# Trocar refuse por die apenas para satisfazer este grep quebraria o contrato.
check "update.sh chama o guarda e recusa (RC=3)" \
  grep -qE '^recusar_projeto_de_outra_arvore .*\|\| refuse ' "$KIT_DIR/update.sh"
# O TERCEIRO call site, e o que faltava: quem INSTALA.
#
# O `install.sh` tem um painel próprio para cópia irmã, mas ele vive dentro de
# `if [ -z "${REVERSE_PROXY:-}" ]` E do ramo em que o irmão é o DONO das portas
# 80/443. Medido com o harness de VPS falsa: numa VPS com Traefik de painel
# (Coolify/Hostinger) `decide_proxy` sai por `traefik` antes de comparar árvore;
# numa pasta que já concluiu uma instalação, o próprio install.sh gravou
# `REVERSE_PROXY` no .env e o `if` é falso — o instalador desligava o próprio
# guarda; e com 80/443 livres a decisão é `caddy` na primeira linha. Nos três, o
# `up -d` subia sobre o parque da produção.
#
# Este guarda pergunta pelos CONTÊINERES do projeto, não pelo proxy, então vale
# nas três entradas. Foi por uma delas que uma aula subiu por cima de uma
# produção (`docs/doctrine/packaging.md`).
check "install.sh chama o guarda e morre" \
  grep -qE '^recusar_projeto_de_outra_arvore .*\|\| die ' "$KIT_DIR/install.sh"

# ANTES da coleta de config: recusar depois de arrancar sete respostas de quem
# instala é fazer a pessoa trabalhar para ouvir "não". E antes de qualquer
# escrita — o `.env` desta pasta é justamente o que derrubaria a produção.
linha_guarda_install="$(grep -n '^recusar_projeto_de_outra_arvore' "$KIT_DIR/install.sh" | cut -d: -f1)"
linha_coleta="$(grep -n '^fase 2 ' "$KIT_DIR/install.sh" | cut -d: -f1)"
check "no install.sh o guarda vem ANTES de perguntar qualquer coisa" \
  test -n "$linha_guarda_install" -a -n "$linha_coleta" \
       -a "${linha_guarda_install:-9999}" -lt "${linha_coleta:-0}"

# O guarda do agent.sh precisa vir ANTES do POST que anuncia a versão: uma cópia
# que não é dona anunciaria a versão da árvore DELA, e o app ofereceria
# "Atualizar agora" com base num número que não descreve o que está no ar.
linha_guarda="$(grep -n '^recusar_projeto_de_outra_arvore' "$KIT_DIR/agent.sh" | cut -d: -f1)"
linha_post="$(grep -n '^RESP="\$(post ' "$KIT_DIR/agent.sh" | cut -d: -f1)"
check "no agent.sh o guarda vem ANTES de anunciar a versão" \
  test -n "$linha_guarda" -a -n "$linha_post" -a "${linha_guarda:-9999}" -lt "${linha_post:-0}"


# ── Contrato ponta a ponta: duas árvores Git e update.sh REAL ───────────────
# Ao contrário da asserção do call site acima, este cenário executa update.sh,
# _common.sh, _i18n.sh, _manifestos.sh e manutencao.sh reais. Só GitHub API,
# ls-remote e Docker são dublados. Não há rede, banco ou contêiner real.
# A release sintética é aceita PRIMEIRO: se falhasse na procedência em vez de
# chegar ao guarda de propriedade, RC=3 sozinho seria falso positivo.
printf '\n▶ atualização da árvore rival: RC=3 e nenhum efeito colateral\n'
LAB="$WORK/laboratorio-atualizador"
mkdir -p "$LAB/bin" "$LAB/kit"
cp "$KIT_DIR/update.sh" "$KIT_DIR/_common.sh" "$KIT_DIR/_i18n.sh" \
   "$KIT_DIR/_manifestos.sh" "$KIT_DIR/manutencao.sh" "$LAB/kit/"
REAL_GIT="$(command -v git)"
for raiz in "$PROD" "$TESTE"; do
  "$REAL_GIT" -C "$raiz" init -q
  "$REAL_GIT" -C "$raiz" remote add origin https://github.com/OARANHA/elus360.git
done

cat > "$PROD/.env" <<'ENV'
APP_IMAGE="ghcr.io/oaranha/elus360:1.101.0"
ENV
cat > "$TESTE/.env" <<'ENV'
APP_IMAGE="ghcr.io/oaranha/elus360:1.100.0"
WORKER_IMAGE="ghcr.io/oaranha/elus360-worker:1.100.0"
SCHEDULER_IMAGE="ghcr.io/oaranha/elus360-scheduler:1.100.0"
VOICE_AGENT_IMAGE="ghcr.io/oaranha/elus360-voice-agent:1.100.0"
ENV
cp "$PROD/.env" "$LAB/prod.env.antes"
cp "$TESTE/.env" "$LAB/teste.env.antes"
: > "$LAB/efeitos.log"
: > "$LAB/consultas-docker.log"

cat > "$LAB/bin/git" <<'DUBLE_GIT'
#!/usr/bin/env bash
case "$1" in
  config) exec "$REAL_GIT" "$@" ;;
  ls-remote)
    printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v1.102.0\n'
    exit 0 ;;
  *) printf 'git MUTANTE: %s\n' "$*" >> "$EFEITOS_LOG"; exit 97 ;;
esac
DUBLE_GIT
cat > "$LAB/bin/curl" <<'DUBLE_CURL'
#!/usr/bin/env bash
case "$*" in
  *https://api.github.com/repos/OARANHA/elus360/releases/tags/v1.102.0*)
    printf '{\n "tag_name": "v1.102.0",\n "draft": false,\n "prerelease": false,\n "published_at": "2026-11-07T00:00:00Z"\n}\n' ;;
  *https://api.github.com/repos/OARANHA/elus360/compare/main...v1.102.0*)
    printf '{\n "status": "behind"\n}\n' ;;
  *) printf 'curl inesperado: %s\n' "$*" >> "$EFEITOS_LOG"; exit 97 ;;
esac
DUBLE_CURL
cat > "$LAB/bin/docker" <<'DUBLE_DOCKER'
#!/usr/bin/env bash
if [ "$1" = ps ]; then
  printf '%s\n' "$*" >> "$CONSULTAS_DOCKER"
  exec "$DOCKER_DE_LEITURA" "$@"
fi
printf 'docker MUTANTE: %s\n' "$*" >> "$EFEITOS_LOG"
exit 97
DUBLE_DOCKER
for cmd in crontab psql pg_dump pg_restore; do
  cat > "$LAB/bin/$cmd" <<'DUBLE_MUTACAO'
#!/usr/bin/env bash
printf '%s MUTANTE: %s\n' "$(basename "$0")" "$*" >> "$EFEITOS_LOG"
exit 97
DUBLE_MUTACAO
done
chmod +x "$LAB/bin/"*

# O --to evita depender de /releases/latest; a release pedida AINDA passa
# por verificação oficial simulada (tag remota, publicação, main).
# Nenhum flag de override de guarda é fornecido.
(
  cd "$TESTE" || exit 90
  env PATH="$LAB/bin:$PATH" DONOS="$PROD" \
    REAL_GIT="$REAL_GIT" DOCKER_DE_LEITURA="$WORK/bin/docker" \
    CONSULTAS_DOCKER="$LAB/consultas-docker.log" EFEITOS_LOG="$LAB/efeitos.log" \
    bash "$LAB/kit/update.sh" --to v1.102.0
) > "$LAB/resultado.txt" 2>&1
RC_ATUALIZADOR=$?

check "update.sh da árvore rival devolve RC=3, não RC=1" \
  test "$RC_ATUALIZADOR" -eq 3
check "recusa é explicitamente pela árvore alheia" \
  grep -qF 'Atualização interrompida para não quebrar a instalação que está no ar' "$LAB/resultado.txt"
check "diagnóstico identifica a árvore proprietária" \
  grep -qF "$PROD" "$LAB/resultado.txt"
check "o guarda consultou os labels reais simulados do Docker" \
  grep -q -- 'ps -a' "$LAB/consultas-docker.log"
check "o .env da árvore rival está byte a byte intacto" \
  cmp -s "$LAB/teste.env.antes" "$TESTE/.env"
check "o .env da árvore dona está byte a byte intacto" \
  cmp -s "$LAB/prod.env.antes" "$PROD/.env"
check "nenhum git fetch/checkout, Docker mutante, crontab, psql ou backup" \
  test ! -s "$LAB/efeitos.log"
check "não surgiram diagnóstico, cron, backup nem pins no projeto rival" \
  test -z "$(find "$TESTE" -maxdepth 1 -name '.deskcomm-*' -print -quit)"

# Controle de ordem: consultar a propriedade deve acontecer antes de Git fetch
# (que já poderia mudar o checkout) e antes de qualquer .env/cron/banco.
linha_guarda_update="$(grep -n '^recusar_projeto_de_outra_arvore' "$KIT_DIR/update.sh" | cut -d: -f1 | head -1)"
linha_fetch_update="$(grep -n '^git fetch --tags' "$KIT_DIR/update.sh" | cut -d: -f1 | head -1)"
check "no update.sh o guarda precede o primeiro fetch mutante" \
  test -n "$linha_guarda_update" -a -n "$linha_fetch_update" \
       -a "$linha_guarda_update" -lt "$linha_fetch_update"

printf '\n'
if [ "$FAILS" -gt 0 ]; then printf '✗ %d falha(s)\n' "$FAILS"; exit 1; fi
printf '✓ guarda do dono do projeto: tudo verde\n'
