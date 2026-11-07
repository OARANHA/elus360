# ELUS360 — integração independente v1.102.0 com instalador e atualizador

Estado: IMPLEMENTADO EM BRANCH CANDIDATA; CI e instalação real ainda PENDENTES.
Base: PR #21 no SHA 94ab102bed37d2e73f8bacd08b3fcb50ed659ab8.
Distribuição: PR #22 no SHA 744c2f12fecaeadbe87f2dc8945c07884f6615e1.
Branch: test/elus360-v1102-distribuicao-integrada-20261107.

## Alterações

- A árvore preserva a v1.102.0 e as extensões ELUS já presentes na PR #21.
- Foram integradas 34 alterações de distribuição da PR #22, com reconciliação explícita dos arquivos compartilhados.
- No update.sh, a chamada aviso_rede_do_supabase da v1.102.0 permanece depois da prova read-only de procedência da release e das quatro imagens, antes de cron e efeitos.
- O teste oficial tests/unit/tag-so-nasce-da-main.test.ts permanece; a guarda específica do fork foi adicionada separadamente em tests/unit/elus360-tag-so-nasce-da-main.test.ts.
- O teste tests/distribution/test_v1102_combined_candidate.py acrescenta regressões de integração e sintaxe Bash.

## Gates a comprovar no SHA combinado

1. Python de distribuição, shell e quatro builds linux/amd64 do smoke PR-only, com push:false.
2. TypeScript, lint, unitários, segurança e SQL/RLS/upgrade PostgreSQL 15/17 da candidata v1.102.0.
3. Instalação limpa, atualização preservando dados e recuperação de banco em ambiente realmente descartável, além de health app/worker/scheduler/voz e verificação de digests/procedência.
4. Rollback de imagens não implica rollback de schema. Para rollback do banco exigir restore isolado e testado.

O CI com dublês não equivale a instalação e atualização reais. As quatro imagens ELUS360 e uma release do fork ainda não foram comprovadas publicadas.

NO-GO: merge das PRs #21/#22, publicação GHCR, corte de release, promoção stable, deploy e alterações em produção.

## Correção do primeiro CI da integração (2026-11-07)

O HEAD `af28edcdc51bb09d6784ebae2cc994d5fbe5dea9` teve duas frentes RED:
sete testes unitários desalinhados ao contrato do fork/AMD64, além de dublês
históricos do instalador e do atualizador que não modelavam a nova prova de
origin/release GitHub e de manifestos OCI.

O patch corretivo preserva o teste upstream separado, atualiza as expectativas
dos dois jobs de smoke, deriva a identidade do registry de `IMG_NS` sem
ampliar a allowlist e isola os repositórios Git dos testes. Os dublês simulam
uma release do fork somente dentro dos testes descartáveis; a validação real
continua fail-closed. **Não existe evidência nova de publicação GHCR ou release.**

**Status de aceite deste patch: NÃO TESTADO EM CI NO NOVO SHA.** O resultado
permanecerá NO-GO até a execução integral dos gates sobre o próprio commit,
seguida de ensaio real de instalação, atualização e recuperação com dados
exclusivamente descartáveis. Sem merge/deploy/autorização operacional.

## Segundo diagnóstico do CI e ajuste de integração (2026-11-07)

No commit `8a6eb7fcf51930b04e8563e71b2d5c9dcc7c5b26`, 8 dos 10 workflows
concluíram com sucesso; `ci` e `ELUS360 v1.102.0 - candidate verification`
falharam na suíte Bash legada. Houve dois achados independentes:

- **Defeito no instalador integrado:** após `dc up -d --no-build`, o código ainda
  avaliava `CONSTRUIU_AQUI` (variável não inicializada) sob `set -u`. Esse
  bloco vinha do fallback de build local do upstream, proibido pela ADR-0007.
  O bloco foi removido. Um teste de regressão inspeciona sua ausência.
- **Fixtures herdadas do upstream:** os testes da instalação e da atualização
  montavam origens Git não canônicas, URLs alternativas de release, manifestos
  OCI multiarch e esperavam construir no host quando o GHCR respondesse 403.
  O harness foi adaptado com GitHub/GHCR/OCI sintéticos somente nos diretórios
  descartáveis: `origin` oficial, release não draft, SHA de tag consistente,
  imagens exclusivamente AMD64 e bloqueio antes de mutações quando houver 403.

A regra de produção **não mudou**: sem release publicada no fork e imagens
comprovadas o instalador/atualizador falham fechados. Os dublês não existem
na instalação de clientes. **CI do novo HEAD ainda não verificado**; não atribuir
GREEN nem equivaler testes simulados a instalação real.

**NO-GO** permanece para merge, publicação, release e deploy até aceite.

## Terceiro ajuste — contrato dos testes shell (2026-11-07)

No HEAD `68d30bd64af0ed3cca03e2c3bbed9d0aa79110b9`, o CI concluiu com
8/10 workflows aprovados. As duas falhas de workflows têm a mesma origem:
`hostgator-setup-kit/test-validators.sh`, na etapa de integração Bash.

- O teste de pinagem ainda procurava os nomes `deskcomm-worker` e
  `deskcomm-scheduler`, apesar de o instalador gravar os nomes do fork.
  A asserção agora exige **quatro referências da mesma release numérica**:
  app, worker, scheduler e voice-agent, e quatro `pull_policy=missing`.
  Tags móveis como `latest` e `stable` deixam de ser aceitas nesse cenário.
- Três expectativas exigiam `docker compose up -d` sem flags, e a validação
  de Caddy recusado exigia lista de serviços sem `--no-build`. A execução
  real de `subir_o_parque` usa `up -d --no-build`, tanto no modo normal
  quanto no modo que preserva o proxy. Os testes agora conferem essa forma,
  mantendo os controles de **ordem: recriar rede antes de subir, validar
  Caddy antes de recriar, e nunca subir Caddy recusado**.

Somente o harness de teste foi alterado neste ajuste. **CI do novo SHA ainda
não verificado; merge, release e deploy continuam NO-GO.**

## Correção de fixtures após CI do SHA 684d9a4 (2026-11-07)

No commit `684d9a4894dec0661aafa25909d8686dc51721c6`, 8/10 workflows
terminaram com sucesso; o job de cercas registrou 1/3730 falha no contrato de
namespace GHCR e o shell do candidato registrou 16 falhas nos cenários da
senha do cron. A suite de segurança do atualizador contra árvores rivais passou.

- `dono-do-projeto.test.sh`: deixou de repetir `ghcr.io/oaranha` em
  `.env` sintéticos; agora deriva `IMG_NS` da única declaração em `_common.sh`.
  A recusa RC=3, o isolamento das duas árvores e as provas de ausência
  de alterações permanecem.
- `senha-do-cron-vazada.test.sh`: o dublê de `uname` responde `Linux` a `-s`
  e `x86_64` a `-m`. Antes devolvia `x86_64` também ao perguntar o sistema;
  o gate de arquitetura legítimo recusava os wrappers de install/update antes
  de alcançar a função sob teste. O comportamento de produção não foi alterado.

Estado no momento do patch: implementado em branch candidata, testes de CI
do novo SHA ainda não comprovados. Homologação de instalação, atualização e
rollback com dados e infraestrutura descartáveis continua obrigatória após
CI GREEN. NO-GO para merge, GHCR release, stable, staging, deploy e produção.

## Reconciliação preventiva dos testes legados e rotas de instalação (07/11/2026)

O CI do commit `217850a1f30d5af1de67fe2be713a0a2b045b0a2` concluiu
8/10 workflows GREEN, 2 RED pela suíte shell. A primeira falha foi uma
expectativa herdada (#1775/#1778): permitir `riscv64` quando existia
marcador ou contêiner. Essa permissão contraria a ADR-0007.

A revisão estendeu-se à suíte completa, sem esperar sucessivas falhas:

- `guarda-arm-so-considera-instalacao-real`: leitura de metadados ainda
  distingue `REAL`/`NOVA`; ambos recebem RC=3 em arquitetura proibida.
- `instalacao-plataforma-preflight`, `atualizacao-plataforma-preflight`,
  `manifestos-plataforma`: exigem as quatro imagens ELUS360, versões numéricas,
  plataforma exclusiva AMD64 nas imagens próprias, WAHA compatível,
  falha fechada para ARM64/registry indisponível e gates antes de backup.
- `install-recusa-separa-causas`: substitui cenário upstream com build local
  autorizado por regressões negativas do `install.sh` real, com dublês
  de release GitHub/GHCR, sem clone, Docker, apt ou banco antes da validação.
- `ubuntu-production-installer.sh` e seus testes: ajuda e gate de entrada
  somente Linux AMD64, com recusa RC=3 antes do APT.
- `install-single-server.sh`: host Linux AMD64 verificado antes de efeitos;
  no primeiro provisionamento, consulta imagens da ref Supabase pinada antes
  de criar `.runtime`, rede e credenciais. Testes cobrem ausência de AMD64
  e bloqueio ARM64 mesmo em árvore descartável.
- `_supabase-images.sh`: pré-voo da distribuição ELUS360 aceita só
  `linux/amd64`, embora imagens upstream possam oferecer arquiteturas extras.
- `oracle-arm64.md`: runbook antigo desativado; o teste agora exige o aviso
  de incompatibilidade e impede instruções executáveis ARM64.

Os dublês permanecem exclusivamente em `tests/shell/`. Não há alteração
de schema, segredos, dados, deploy, regra de origem oficial ou permissão
de construção local. Os testes precisam do CI no novo SHA: executar
subsequente laboratório **realmente descartável** para instalação, atualização
preservando dados, rollback de imagens e restore isolado de banco. CI
com simulações não substitui a homologação operacional.

**NO-GO** merge, GHCR publicação, release, stable, staging, deploy, VPS de
cliente ou alterações no banco de produção até gates separados.
