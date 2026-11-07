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
