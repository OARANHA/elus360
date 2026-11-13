# TODO ELUS360 — camada contínua sobre o DeskcommCRM

**Decisão do proprietário — 12/11/2026:** DeskcommCRM é a base oficial, mantida pela comunidade. O trabalho do ELUS360 é **integrar e conservar apenas as personalizações próprias sobre cada release**, de forma incremental e reutilizável. Não revalidar o produto Deskcomm, não inventar novos testes/workflows para ele, não transformar GREEN em objetivo nem tratar toda divergência de arquivo como bug.

**Fonte de verdade:** `OARANHA/elus360`, PR [#37](https://github.com/OARANHA/elus360/pull/37), base oficial DeskcommCRM v1.108.0 `0b60c5abaace17922ae645399a6a6183a5f5c357`. A PR está em Draft e não representa versão publicada. Base de comparação v1.102.0 `4b5815721710c9b1e99078322593838fda1ee740`. Não inferir estado atual de referências históricas.

## Resultado esperado (critério de aceite)

Uma instalação de ELUS360 executa o **Deskcomm oficial atualizado** com o overlay ELUS360 funcional (identidade, onboarding/tenants, IA gerenciada, credenciais/modelos, Chutes.ai, integrações próprias, instalador e atualizador Linux AMD64), sem regredir dados nem reimplementar o upstream. Ao chegar outra release, reaproveitar as mesmas decisões e **revisar apenas interfaces realmente alteradas**. Não modificar `main`, instalar em produção nem migrar banco sem aprovação independente.

## Evidência recuperada do artifact GREEN (12/11/2026)

- Workflow `43232379128`, artifact `13952685554`, SHA da PR `70f4175cbb4a899edfe1770bab264580c6678de4`.
- 402 caminhos próprios sem colisão já reaplicados ao worktree oficial; **9 adaptações pontuais** para código e configuração; 141 entradas ainda listadas como conflito.
- Destes 141: **108 arquivos não executáveis** de documentação/skills do Deskcomm (`.md`, `.yaml`, `.json` em `.agents/skills/deskcomm-*/` ou `.claude/skills/deskcomm-*/`), **22 scripts/hook** de skills, **4** arquivos do kit instalador, **4** documentos estruturais, **2** workflows de CI e **1** `supabase/baseline.sql`.
- No worktree preparado, conflitos mantêm **o arquivo oficial**, não o arquivo antigo ELUS. Portanto, a lista de conflitos **não** mede funcionalidades quebradas.
- `COMPOSED_TECHNICAL_CHECKS_PASSED` foi comprovado naquele SHA, **não equivale** a ELUS homologado para usuários.

## Fila de execução — por impacto real, não por quantidade de arquivos

- [x] **T00 — Reconstruir estado real e não repetir trabalho.** Conferidos PR, documentação prioritária, scripts `prepare`/`classify`/`adapters` e artifact do HEAD GREEN. Resultado: identificados nove adaptadores já existentes; não criar adaptadores duplicados.
- [x] **T01 — Resolver documental sem mexer no produto (implementado no reconciliador; novo artifact pendente).** Arquivos de skills oficiais, não executáveis, apagados do fork não são recursos exclusivos ELUS360: **manter a cópia atual do Deskcomm**, registrar a decisão por caminho no relatório e retirar essas entradas da fila de impedimentos. Conferir tipo regular, caminho exato e conteúdo oficial; nunca incluir `scripts/`, hooks, executáveis, docs próprios ELUS ou qualquer extensão nova automaticamente. Não executar testes do Deskcomm nem criar teste novo.
- [x] **T02 — Separar scripts de desenvolvimento de produto (escopo do overlay implementado; não equivale a autorizar execução de hooks).** Para os 22 scripts/hooks de skills Deskcomm: determinar quais podem ser ativados automaticamente, no instalador ou no pipeline. **Nunca ativar hooks silenciosamente**; só tratar como integração ELUS se houver dependência comprovada. Os demais são material upstream, não trabalho de desenvolvimento ELUS.
- [ ] **T03 — Limitar diferenças de CI e documentação estrutural.** Preservar os dois workflows oficiais e os documentos `CLAUDE.md`/`AGENTS.md`/`README.md`/`docs/index.md`. Identificar somente controles *específicos* do ELUS (ex.: distribuição AMD64 e governança), preferindo arquivos próprios no fork; não portar mudanças genéricas do Deskcomm para o overlay.
- [ ] **T04 — Integrar o que realmente impede o ELUS360.** Comparar `hostgator-setup-kit/{_common.sh,update.sh,test-validators.sh,README.md}` nas três árvores; portar apenas segurança/identidade de distribuição ELUS360 sem perder correções de instalação/backup upstream. Distribuição `linux/amd64`, imagens publicadas e rollback preservados.
- [ ] **T05 — Compatibilidade de dados.** Tratar `supabase/baseline.sql` como integração de migrations e RLS, preservando upgrades sem perda de dados. Proibido sobrescrever baseline com o fork antigo ou executar DDL em produção.
- [ ] **T06 — ELUS funcional, não testes repetidos.** Verificar **apenas fluxos personalizados** de ELUS (branding/login, configuração multiempresa, controle de IA, modelos/credenciais, Chutes, instalador e upgrade). Não escrever nem executar bateria de testes do Deskcomm para demonstrar funcionalidades da comunidade.
- [ ] **T07 — Preparar continuidade 1.109+.** Classificar customizações em arquivos próprios (sobreposição direta) versus adaptadores inevitáveis (interface oficial alterada). Reusar o manifest de decisões, gerar diagnóstico apenas dos adaptadores cujos arquivos/blobs mudaram, e refazer somente integração impactada. Não reconstruir todo o projeto a cada versão.

## Regras de execução

1. Base Deskcomm é sempre o release oficial conferido por tag e SHA; overlay ELUS versionado é a única camada nossa.
2. **Caminho sem colisão**: reaplicação técnica existente (não reinventar).
3. **Colisão de caminho**: perguntar primeiro se existe funcionalidade ELUS naquele arquivo; se **não**, manter upstream, registrar decisão e encerrar. Se **sim**, portar apenas delta exclusivo sem sobrescrever novos recursos upstream.
4. O relatório distingue **`adapted`**, **`official_kept`** e **`unresolved`**. O contador de `unresolved` não pode incluir decisões já encerradas com upstream preservado.
5. Não criar testes, suítes ou workflows por rotina. Preservar mecanismos oficiais; comprovar funcionalidade ELUS de forma direcionada somente quando necessária.
6. Segurança de dados, autorização, RLS, mudanças de banco e entrega de imagens/produção permanecem gates operacionais reais, **não** certificações de que o Deskcomm original funciona.
7. Registrar decisões na PR e no banco Hindsight `Elus360` com SHA/artefato; nenhum GREEN de commit anterior vale para novo HEAD.

## Registro de avanço

| Etapa | Estado | Evidência |
| --- | --- | --- |
| T00 | CONCLUÍDA | Artifact `13952685554` e leitura dos scripts reais |
| T01 | IMPLEMENTADO EM PR | `scripts/elus360-clean-base-adapters.mjs` agora marca docs de skills do Deskcomm como `official_kept` e confere SHA Git e modo 100644 da release antes de preservá-los; 108 itens esperados a partir do último artifact; novo artifact pendente |
| T02 | IMPLEMENTADO EM PR | 22 scripts/hooks de skills Deskcomm excluídos do runtime conforme `.dockerignore` oficial; guarda exige as regras `.agents` e `.claude` antes de reconhecer a decisão; nenhum hook é instalado ou executado pelo reconciliador. Auditoria de uso manual/externo é independente |
| T03 | PENDENTE | Docs de autoridade (4) e workflows (2) ainda precisam de decisão ELUS vs upstream |
| T04 | IMPLEMENTAÇÃO PARCIAL | `_common.sh` e `update.sh`: fusão de três vias com blobs pinados e falha fechada; `test-validators.sh` oficial mantido; `README.md` do kit pendente. Novo artifact precisa confirmar aplicação sem conflitos |
| T05 | PENDENTE | `supabase/baseline.sql`: preservar histórico de migrations e dados, sem DDL em produção |
| T06–T07 | PENDENTES | Verificação operacional do overlay ELUS e continuidade para próximo upstream |

**Execução iniciada na PR #37:** o reconciliador existente agora registra **dois tipos de decisão** em `official_kept`: `keep_official_document_no_elus_overlay` (108 documentos não executáveis) e `keep_official_devtool_excluded_from_runtime` (22 scripts/hook de skills, sem acioná-los). Mantém SHA do blob oficial, recusa path/status/categoria não previstos, modo incompatível e bytes diferentes dos blobs do release. Não altera conteúdos desses 130 arquivos. O `unresolved` deve cair de 141 para **11**, SE o próximo artifact comprovar todas as condições — **não declarar a previsão como verificação**.

## T04 — confronto inicial do kit (proveniência de três árvores)

Comparados os blobs **v1.102.0 (base) × fork ELUS main × v1.108.0 (oficial)**, sem alterar o kit e sem executar instalador:

| Arquivo | Blob oficial v1.108.0 | Diferença real a integrar |
| --- | --- | --- |
| `hostgator-setup-kit/_common.sh` | `a857565a31c25c1577ced017047646949af9189e` | Oficial aceita AMD64 e ARM64 e mantém caminho de build local de instalação existente; ELUS exige **somente Linux AMD64** e **zero build na VPS**. Portar as guardas ELUS por interface/função, sem recolocar helper antigo inteiro |
| `hostgator-setup-kit/update.sh` | `6c91760b21c6d05264e1562a89559b404c11d1ca` | Oficial atualizou tratamento de backup e travas; ELUS acrescenta origem confiável `OARANHA/elus360`, validação de release e imagens. **Integrar pré-condições ELUS antes de qualquer side effect**, mantendo o procedimento de backup oficial |
| `hostgator-setup-kit/README.md` | `51170761b7e17f8386611e60c608c8ee3310756a` | Manual oficial cita ARM64 e build local; publicar **instruções ELUS AMD64** próprias, não transportar manual antigo nem documentar arquitetura não suportada |
| `hostgator-setup-kit/test-validators.sh` | `d6f886b8b5b777773710b9c8f3fa3cdb3a6d8cd5` | É a suíte do upstream, não nossa funcionalidade. **Não portar a versão antiga nem abrir frente de testes**. Sua divergência não é razão para reconstruir o instalador |

**Decisão:** próximo código de produto a portar é o contrato de proveniência/AMD64/sem build do instalador. A implementação fica pendente: nem o instalador composto nem uma instalação/atualização real foram validados. A documentação acima é análise dos arquivos reais, não homologação.

### T04 — adaptação implementada na PR, ainda não homologada

O reconciliador utiliza **`git merge-file -p`** do próprio Git para compor os scripts `_common.sh` e `update.sh` a partir de três fontes **pinadas por blob**: Deskcomm v1.102.0 como base, o fork ELUS como customização e Deskcomm v1.108.0 como destino. Ambos são calculados em memória/arquivos temporários **antes** de escrever na árvore composta; merge com conflitos é recusado, sem substituição integral do upstream. Depois da composição, devem permanecer os contratos ELUS de origem Git confiável, imagens `ghcr.io/oaranha`, Linux AMD64, nenhuma compilação na VPS, e o backup oficial com `BACKUP_ESPERA_LOCK=300`. **A presença desses contratos é um cheque de composição, não uma homologação funcional.**

`hostgator-setup-kit/test-validators.sh` é exclusivamente a bateria de testes herdada do Deskcomm. Decisão: manter o arquivo oficial no mesmo blob, **não reintegrar testes específicos do fork e não criar novos testes**.

**Contagem prospectiva após as decisões T01/T02/T04:** 402 overlays independentes, **11 adaptações** (9 anteriores + 2 do kit), **131 itens `official_kept`** (108 docs + 22 devtools + 1 validador upstream), **8 itens `unresolved`**. Esses valores são derivados do artifact anterior e **precisam ser confirmados pelo próximo relatório de CI**; não representam integração funcional aprovada.

**Próximo trabalho obrigatório:** decidir quais diferenças ELUS reais restam em `.github/workflows/{ci,e2e}.yml` e nos quatro documentos estruturais; integrar o `README` do kit com as regras AMD64 e tratar `supabase/baseline.sql` sem migrar dados reais. Depois comprovar somente fluxos exclusivos ELUS.

## Atualização operacional — política de distribuição e auditoria SQL (12/11/2026)

**Decisão superveniente do proprietário:** ARM64 e build local **permitidos como opções**; não repetir builds/E2E completos do DeskcommCRM como critério rotineiro da integração ELUS. A ADR-0007 recebeu adendo no commit `ced453b1`. Esta decisão substitui a limitação anterior de AMD64 exclusivo, mas **não comprova** que a candidata ELUS oferece imagens ARM64 nem que o fallback de build foi integrado.

**T04 — instalador:** a composição Git de três vias permanece, com proveniência ELUS, pré-voo de release e backups. Antes de declarar ARM64/build local funcional, remover apenas as restrições próprias conflitantes no resultado composto (host architecture, WAHA por plataforma, manifesto OCI e fallback explicitamente solicitado), sem transportar alterações antigas por inteiro. Preservar o fail-closed na ausência de release válida, imagem adequada ou pré-condições de rollback. **Não permitir build automático em falha de registry**: a autorização nova é uma alternativa explícita, não fallback indiscriminado. A árvore composta ainda precisa provar esse comportamento.

**T05 — banco:** foi criado `scripts/elus360-migration-delta-audit.mjs` no commit `11e0d414` e atualizado no commit `9123f6fb`. Compara objetos Git fixados nas três árvores, separa colisões reais e convergências idênticas, reconhece nomes de migration Supabase com timestamp de 14 dígitos e nunca executa DDL. Casos unitários específicos adicionados em `tests/operational/elus360-migration-delta-audit.test.mjs` (`d050d3cf`). **Ainda falta executar a auditoria sobre os SHAs reais e verificar seus resultados**; não usar o relatório estático como prova de upgrade, tenant isolation, RLS ou restauração.

**T07 — próximas versões:** o auditor já recebe base/fork/target por SHA completo, sem depender de `main` mutável. A reconciliação futura deve recalcular apenas os contratos ELUS cujos blobs oficiais mudaram e reutilizar as decisões `official_kept`/adaptadas. Nenhuma migração SQL, merge, deploy ou build em VPS foi autorizado.

### T04 — política opcional no `_common.sh` composto (12/11/2026, HEAD `7bd2971`)

- `scripts/elus360-clean-base-adapters.mjs` passou a restaurar **somente funções oficiais específicas** de arquitetura, seleção WAHA e pré-voo de atualização depois do merge de três vias. Reusa a função de construção do upstream, mas com **opt-in obrigatório** via `DESKCOMM_BUILD_LOCAL=1`; sem a variável, `build_local_permitido` falha. Continua exigida a origem ELUS `ghcr.io/oaranha` e as guardas de proveniência e rollback.
- Teste específico acrescentado a `tests/operational/elus360-clean-base-adapters.test.mjs`, sujeito a CI do HEAD correspondente. As correções subsequentes de escape de JavaScript/Bash estão incluídas no HEAD citado.
- **NÃO É SUPORTE ARM64 PRONTO:** `install.sh`, `update.sh`, preflight OCI/release e distribuição das quatro imagens ainda exigem revisão integrada. Os scripts de entrada continuam com restrições próprias, e esse adaptador não altera os gates de banco. O merge real e sua execução ainda não foram validados.
- Gate seguinte: verificar a árvore composta e o teste do novo HEAD; integrar os entrypoints com recusa segura antes de efeitos colaterais, sem aceitar build implícito quando o registry falha.

### T04 — plataforma OCI por host na composição (12/11/2026)

Commits deste incremento: `1b8fb263` (guarda inicial), `744d51c3` (fixture específica), `4e82698c` (manifestos) e `97b78691` (regressão). `composeOptionalBuildPolicy` agora reconhece **somente Linux AMD64/ARM64** no preflight inicial, seleciona a WAHA oficial por host e exige que as quatro imagens estejam presentes **para a plataforma real** no manifesto OCI. Índices multiarch não são recusados por conter ARM64, mas uma imagem sem a arquitetura correta continua NO-GO. Build local permanece **opt-in explícito** por `DESKCOMM_BUILD_LOCAL=1`, sem fallback automático.

Foi feita verificação isolada do transformador contra fixture de funções: transformação positiva e recusas de origem inválida/função ausente passaram; **não** executamos o merge real com `git merge-file`, shell do instalador, upgrade ou suíte da árvore composta. Os testes versionados permanecem dependentes do CI do HEAD.

**Bloqueios que ainda faltam:** `install.sh` e `update.sh` têm mensagens e políticas próprias AMD64; `plataforma_oci_do_host`, preflight OCI, `trio_publicado`, rollback e caminhos explícitos de build precisam ser reconciliados de ponta a ponta. Uma implementação parcial no helper não autoriza instalação ARM64. Não alterar scripts de entrada por substituição geral, não relaxar release assinada/proveniência e não executar builds pesados por padrão.

### T04/T05 — incremento de integração verificado no código (13/11/2026)

- **T05:** o workflow `.github/workflows/elus360-clean-base-candidate.yml` passa a executar o teste específico do auditor de migrations e a comparação estática entre os três SHAs oficiais/fork. O relatório `elus360-sql-delta-report.json` passa a integrar os artifacts. Implementado no commit `c8bcfbe7`. A auditoria não aplica migrations, não prova RLS/compatibilidade operacional e pode revelar conflitos a resolver. Execução em CI deste commit ainda **não verificada**.
- **T04:** a composição Git de `_common.sh` e `update.sh` passa a executar `bash -n` dos dois conteúdos **antes de escrever** no worktree candidato. Composição inválida gera `ELUS_DISTRIBUTION_BASH_SYNTAX_NO_GO` (commit `49745c84`). A checagem é de sintaxe, não equivale a instalação, rollback ou validação das imagens.
- **E2E upstream:** no HEAD anterior `0d67e98b`, o job `e2e-parte (3)` (131660671366) falhou no teste oficial `tests/e2e/busca-na-conversa.spec.ts:243`: mensagem marcada, mas sem anel visual identificado no `box-shadow`. Não há prova de causalidade com overlay ELUS. Não alterar o componente oficial como efeito colateral da integração.
- **Namespace ELUS:** os dois arquivos do reconciliador que causavam `namespace-das-imagens` RED foram corrigidos em `fb6a15d` e `bf575e9`; testes JS isolados positivos/negativos passaram. **Não inferir CI GREEN** desse diagnóstico.
- Próximos gates: conferir resultados do HEAD exato quando disponíveis, auditar relatório SQL, e continuar a composição segura dos entrypoints do instalador sem construir na VPS nem migrar banco real.

### T05 — gate de auditoria SQL corrigido após CI RED (13/11/2026)

O HEAD `fb699bb` da PR #37 teve **6/7 workflows GREEN**. A candidata clean-base v1.108.0 (run `43367699276`, job `131695892479`) falhou no passo novo de auditoria SQL: `ELUS_SQL_AUDIT_NO_GO: CAMINHO_SQL_NAO_ESPERADO: supabase/migrations/MANIFEST.md`. O arquivo é um manifesto histórico, não uma migration. A mensagem final genérica do workflow foi consequência desse passo, não prova independente de falha do instalador.

Correção específica: `835d324b` classifica apenas `supabase/migrations/MANIFEST.md` como documentação e o ignora ao montar o conjunto SQL; caminhos desconhecidos continuam falhando fechados. `fb36f77e` acrescenta teste dirigido para esta exceção, SQL válido e caminhos inesperados. Verificação isolada da classificação passou (5 casos), **sem afirmar novo CI GREEN**. Auditoria, código do Deskcomm e banco operacional permanecem sem execução de DDL. Próximo gate: avaliar o relatório SQL gerado pelo workflow do novo HEAD, sem polling, resolver divergências realmente encontradas e preservar a base oficial.
