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
| T03–T07 | PENDENTES | 11 colisões substantivas previstas após T01/T02, mas confirmação depende do artifact do novo HEAD |

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

**Próximo trabalho obrigatório:** concentrar T03–T05 nos **11** caminhos reais, com prioridade para `hostgator-setup-kit/update.sh` e `_common.sh` e para a compatibilidade de banco. Não criar testes ou workflows para a aplicação original.
