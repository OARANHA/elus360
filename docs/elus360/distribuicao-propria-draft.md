# ELUS360 — distribuição própria (PR Draft #22)

**Status:** IMPLEMENTADO PARCIALMENTE EM DRAFT — NÃO APROVADO PARA RELEASE OU DEPLOY.

**Autoridade:** decisão gerencial da [PR #21](https://github.com/OARANHA/elus360/pull/21#issuecomment-6700178117), permitindo apenas código, testes e builds sem publicação. **Base isolada:** `main` `749aaf8fbb25b46dddd9138219e2ac032cc83336`. A candidata v1.102.0 segue intacta na [PR #21](https://github.com/OARANHA/elus360/pull/21), HEAD `94ab102bed37d2e73f8bacd08b3fcb50ed659ab8`, CI 9/9 aprovado **só naquela PR**.

## Contrato de identidade da distribuição

| Serviço | Imagem ELUS360 proposta |
|---|---|
| App | `ghcr.io/oaranha/elus360` |
| Worker | `ghcr.io/oaranha/elus360-worker` |
| Scheduler | `ghcr.io/oaranha/elus360-scheduler` |
| Voz (opcional) | `ghcr.io/oaranha/elus360-voice-agent` |

As quatro imagens compartilham uma revisão Git ELUS e um número de release; os índices OCI devem declarar `linux/amd64` e `linux/arm64`, labels de origem `https://github.com/OARANHA/elus360`, revisão e versão. Imagens de terceiros (WAHA, Redis etc.) **não são republicadas**.

O workflow `.github/workflows/build-elus360.yml` é apenas smoke de PR (oito builds sem `push`, sem login nem `packages:write`). **Não há pipeline própria para publicar uma release** nesta PR. O novo mecanismo de publicação exige uma implementação e autorização futuras; o CI da PR não pode mover `stable`.

A tag de cliente será `vX.Y.Z` e as referências numéricas são imutáveis; `latest` e `stable` não são admissíveis como fallback de instalação. O commit/tag precisa ser confirmado em `main`, e o índice multiarch só é aceito quando todas as quatro peças da mesma versão estiverem disponíveis. A lista `GET /repos/OARANHA/elus360/releases` estava vazia na inspeção prévia; nenhuma imagem nova foi publicada por esta PR.

## Atualizador e instalação: proteções em código

- `hostgator-setup-kit/_common.sh` fixa `IMG_NS=ghcr.io/oaranha`; `docker-compose.prod.yml`, `.env.hostgator.example`, `install.sh` e `comecar.sh` passam a referenciar o fork. O nome da imagem de voz é incluído.
- `elus360_origem_confiavel` recusa remote/REPO_URL diferente de `OARANHA/elus360`. Overrides de endpoint `DESKCOMM_RELEASES_LATEST_URL` não podem desviar para o upstream.
- `elus360_ultima_release_do_fork` resolve a última release própria por API oficial; `elus360_release_publicada_no_main` é read-only e confere tag numérica, objeto de tag remoto, GitHub Release não draft/prerelease e ancestralidade `main`, **antes de cron, GoTrue, VAPID, clone, git fetch, `.env`, backup ou DDL**. `elus360_release_tag_comprovada` confere depois do fetch que o objeto Git local coincide com o objeto remoto. Nenhuma dessas etapas é uma atestação OCI criptográfica ou autorização para deploy.
- `install.sh` recusa a release **antes de instalar dependências ou clonar o repo**, interrompe se não houver quatro imagens ELUS acessíveis, busca a tag canônica e posiciona o código na tag **antes do baseline** (inclusive clone shallow). `update.sh` bloqueia release inválida antes das primeiras mutações (inclusive single-server), revalida objeto local após o fetch e usa preflight GHCR antes do trabalho sobre serviços/schema.
- A distribuição do fork **não permite compilação na VPS**, inclusive via `DESKCOMM_BUILD_LOCAL`. Os quatro serviços próprios no `docker-compose.prod.yml` **não possuem `build:`**, e `dc up -d --no-build` cobre instalador, atualizador, reinícios e rollback. Falhas de pull/up não se tornam builds locais, mesmo com `docker compose up` manual no Compose de produção.
- O rollback do kit preserva as oito variáveis de imagens/pull-policy em snapshot de `.env` e agora inclui voz quando `COMPOSE_PROFILES=telefonia`. Restauração usa `--no-build`; o agente evita `failed_rolled_back` se faltar worker/scheduler ou voz habilitada. É rollback de **imagens locais**, NÃO prova de digest remoto e **não reverte schema**. O planejador `scripts/elus360-distribution-guard.py` exige em fixtures os quatro pins anteriores por digest e estratégia explícita de banco (`forward_compatible` ou `isolated_restore_verified`), produz somente `plan_only` e jamais executa Compose/SQL.

## Matriz de testes planejada e cobertura em DRAFT

- `python3 -m unittest discover -s tests/distribution -p 'test_*.py' -v`: **58 casos definidos** (21 manifesto/rollback offline, 17 guarda Bash, 14 entrypoints reais em diretório temporário com Docker/Git/curl/crontab simulados e 6 exercícios de snapshot/restore de pins). Somente o commit antigo `4d58dd3` teve smoke 9/9 comprovado; os casos novos e o HEAD atual **ainda não têm CI aferido**.
- `bash -n hostgator-setup-kit/_common.sh hostgator-setup-kit/install.sh hostgator-setup-kit/update.sh`: planejado no workflow da PR.
- O smoke da PR cobre quatro Dockerfiles em amd64 e arm64 com `push:false`. **Build ainda não comprovado para este HEAD**.
- A doutrina herdada `docs/doctrine/packaging.md` recebeu nota explícita distinguindo o contrato ELUS360 do fallback do DeskcommCRM; a política do fork está em Draft, não em produção.
- As três regressões shell de distribuição foram **migradas para recusa sem build local**: `tests/shell/update-guard.test.sh` (harness descartável, bypass apenas de release nos dublês do teste — a origem real é exercitada em `test_entrypoints_disposable.py`), `tests/shell/install-portao-do-build.test.sh` e `tests/shell/guarda-arm-nao-mata-a-recuperacao.test.sh`. O workflow smoke executará as três; **resultado do HEAD novo ainda não aferido**. Outras suítes herdadas da `main` ainda fazem referências a `publish-image.yml` / `release.yml` sem distribuição ELUS habilitada. **CI integrado completo da PR não pode ser declarado GREEN.**
- Novos testes devem comprovar também checkout após tag revalidada, ausência de mutações no `single-server` antes da prova, recuperação de pins de quatro serviços e inexistência de publicação GHCR. São testes de simulação e de estrutura, **não aceitação operacional real**.

## Gates pendentes e rollback

1. **GitHub/GHCR:** aprovar desenho da publicação (identidade de GitHub App, grants mínimos `packages:write`, branch protection e reviews formais), quatro índices OCI com digests imutáveis e validação de procedência por registry. O 403 histórico no endpoint de branch protection significa que essa regra **não está verificada**.
2. **Atualizador:** testes negativos com release inexistente/privada, tag divergente, arquitetura/digest incoerente, rollback de quatro serviços e prova de que nenhum pin muda antes do preflight; auditar se chamada `agent.sh`/Portainer usa o kit esperado.
3. **Banco:** `supabase/baseline.sql` e migrations são mudanças forward. **Rollback de imagem NÃO reverte DDL/schema.** A compatibilidade do runtime anterior com o novo schema e um restore testado num banco descartável são gates separados. O `restore.sh` atual restaura em banco vazio, não sobre a base existente.
4. **Staging isolado:** exige outra autorização gerencial. Com autorização, aferir `/api/v1/health`, revisão OCI, worker, scheduler e voz quando habilitada; RLS, MFA, grants de IA, credenciais, canário sintético e rollback/digests. Nada desta etapa foi executado nesta PR.
5. **Convergência das trilhas:** a PR #22 nasceu na `main` anterior à integração v1.102. Quando a PR #21 for explicitamente autorizada e incorporada, integrar as mudanças sem sobrescrever a governança de IA, reconfirmar ambos os HEADs e rodar **todos os gates** no SHA resultante.

**Estado operacional:** PR Draft isolada, **NO-GO** para merges, publicação GHCR, release, promoção `stable`, staging real, deploy, clientes e Supabase de produção.
