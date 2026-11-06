# ELUS360 — Gate 6: contratos e decisões de revisão (sem incorporação)

**Status: IMPLEMENTADO em branch Draft, TESTES DO HEAD NOVO PENDENTES.** Esta matriz é uma recomendação diagnóstica para revisão humana; nenhuma linha autoriza `safe_to_prepare`, patch, migration, merge ou deploy.

## Proveniência verificada

- Fonte oficial DeskcommCRM: base `v1.94.0`, commit `ba24d4d366b7caf056b88553e0ed434cb0fb46de`, target `v1.95.0`, commit `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36`.
- Fork ELUS360 `main` da comparação: `749aaf8fbb25b46dddd9138219e2ac032cc83336`.
- Último Gate 5 comprovado: [GitHub Actions 42150178794](https://github.com/OARANHA/elus360/actions/runs/42150178794), SHA da branch `2e749eccb47401842479b70cf00a489399edbd52`; dois jobs `success`. **Não transferir GREEN a commits posteriores.**
- Artefato GitHub `elus360-official-reconcile-plan`, ID `13472346852`, recuperado. SHA-256 de `plan.json`, `matrix-787.csv`, `ast-coverage-354.json`, `manual-compatibility-review.json`, `summary.md`, `provenance.txt`, `gate5-evidence.json`, `gate5-target-matrix.md` e `gate5-triad12.md` conferidos: **9/9**.
- Contratos obrigatórios do fork: `CLAUDE.md`, `AGENTS.md`, `docs/elus360/extension-contract.md`, skills `elus-live-context`, `elus-doutrina`, `elus-contribuir`, com consulta complementar às skills oficiais `deskcomm-doutrina` / `deskcomm-contribuir`.
- `plan.json`: 787 arquivos = 235 protegidos, 545 revisão de contratos e sete conflitos; `safe_to_prepare=0`. Grafo do fork: 3.194 fontes, `complete:false`, um import computado. Target: 3.279 fontes, 15.702 arestas, `complete:false`, duas ocorrências computadas.

## Revisão individual dos 12 candidatos

**Atenção à semântica:** `compatible_for_human_review` significa apenas que a mudança localizada apresenta uma hipótese plausível de integração, não que seja funcionalmente segura. `requires_adaptation` depende de módulo, teste ou política local adicional. `blocked_pending_contract_proof` deve permanecer bloqueado até evidência negativa e positiva de contrato. Os 12 arquivos mantêm `contract_requires_review` no reconciliador real e `authorization:none`.

| Caminho | Decisão Gate 6 (diagnóstico) | Diferença funcional comprovada no diff | Validação mínima pendente |
| --- | --- | --- | --- |
| `lib/automation/actions/add-tag.ts` | Compatível para revisão humana | `caused_by_rule` passa a ser omitido quando `ruleId` não existe; RPC `emit_event` preservada | Evento com/sem regra, idempotência/reentrância e dois tenants |
| `lib/automation/texto-do-followup.ts` | Requer adaptação | Adiciona `campos-do-render`, busca `crm_pipelines.settings` por `organization_id` e `pipeline_id` | Labels, isolamento do funil, query falha, templates de follow-up |
| `lib/channels/adapters/meta-cloud.ts` | Bloqueado até contrato | Expõe `metaCloudTemplateOps`, operações de gestão de templates Meta via adapter | RBAC real do endpoint, token/WABA por sessão e dois tenants |
| `lib/channels/pos-entrada.ts` | Requer adaptação | Troca consulta `is_personal` por helper `lerPessoalDoContato`, preservando política de continuar após erro de leitura | Privacidade, falha de leitura, reentrega e mídia |
| `lib/channels/zernio/ingest.ts` | Requer adaptação | Contato encontrado por `achado_pelo_extra` não promove telefone extra a principal | Telefone extra, identidade E.164, duplicata/replay, tenant |
| `lib/cobranca/uso.ts` | Bloqueado até contrato | Nova expressão `.or(...)` não conta sessão QR sem número em FAILED/STOPPED como vaga ocupada | Paridade com trigger de limite, provedores, status, org; sem DB neste gate |
| `lib/cobranca/visao-geral.ts` | Compatível para revisão humana | `fn_cobranca_reconciliaveis` recebe ordenação por `relida_em` descendente e `limit(1)` | Retorno RPC, nulidade, múltiplas linhas, integridade do painel |
| `lib/contacts/cliente-pela-agenda.ts` | Requer adaptação | Centraliza `organizations.settings` em `lerRegrasDeCliente` | Defaults, falhas, chave de organização e comutadores |
| `lib/crm-b2b/import-process.ts` | Requer adaptação | Importação tenta resolver dono de telefone extra em `contact_phones` e `contacts` | Pessoa conflitante, tenant A/B, dedupe e reimportação |
| `lib/lgpd/pdf-renderer.tsx` | Bloqueado até contrato | Exportação PDF de contato adiciona endereço físico | Autorização do titular, isolamento, escaping, layout e ausência de PII indevida |
| `lib/messaging/presenca.ts` | Bloqueado até contrato | Sinal de digitação usa último destinatário real da conversa, além de `contact_id` | Remetente canônico, telefone extra, LID/grupo e permissão |
| `lib/wacalls/events-bridge.ts` | Bloqueado até contrato | SQL associa peer ao número extra com `coalesce` e `contact_phones` | Tenant, contato mesclado, telefone duplicado, SQL parametrizado |

**Distribuição:** dois compatíveis **somente para revisão**, cinco exigem adaptação, cinco bloqueados até prova de contratos; zero conflitos triádicos diretos nesses 12 porque `blob(fork) = blob(base)`; esse fato não prova compatibilidade com outros módulos protegidos.

## Os 45 módulos novos no target

Todos os 45 constam como `new_upstream_source_not_in_fork` no Gate 5. O target tem **24 módulos consumidos diretamente por arquivo protegido**, **30 com consumidores protegidos transitivos**, **8 que importam um módulo protegido** e **2 sem consumidor estático identificado**. Categorias sobrepostas; não somar. **Nenhum** desses números comprova invocação em runtime, autorização ou compatibilidade.

O Gate 6 usa três prioridades de triagem **sem liberar incorporação**: `high_priority_contract_review` (35 módulos com dependência protegida direta/import protegido ou superfície crítica por caminho), `transitive_contract_review` (2 módulos com dependência protegida apenas transitiva) e `new_module_interface_review` (8 módulos que ainda exigem validação de interface/contrato e podem não ter arestas protegidas observadas). São regras de prioridade, **não avaliação semântica de segurança**.

**Superfícies de maior interesse, com dados do artefato do Gate 5:**

| Módulo upstream novo | Consumidores protegidos diretos | Transitivos | Imports protegidos | Gate de aceite |
| --- | ---: | ---: | ---: | --- |
| `lib/channels/endereco-da-ultima-recebida.ts` | 3 | 110 | 0 | Identidade do remetente, conversa de tenant e grupo |
| `lib/channels/meta/templates.ts` | 1 | 126 | 1 | Credencial da sessão, WABA, RBAC, templates Meta |
| `lib/channels/templates-midia.ts` | 2 | 2 | 3 | Permissão e upload privado, MIME, tamanho, URLs |
| `lib/contacts/contato-pessoal.ts` | 1 | 14 | 1 | Filtro `organization_id`, privacidade e erros |
| `lib/mcp/servidor-externo/escolha-do-editor.ts` | 1 | 10 | 1 | Tools de leitura/escrita, sessão, capabilities, versões de agentes |
| `lib/agenda/duracao-escolhida.ts` | 3 | 69 | 0 | Agenda, fuso, regra de duração |
| `lib/financeiro/comissao-do-item.ts` | 2 | 14 | 0 | Organização, comissão e contratos financeiros |
| `lib/kanban/anexos-no-card.ts` | 1 | 379 | 0 | Mídia privada, autorização, download e egress |
| `lib/waha/ultima-recebida.ts` | 1 | 111 | 0 | Remetente canônico, WhatsApp e tenant |

Módulos **sem consumidor estático conhecido**: `lib/channels/social/adaptador-da-porta.ts` e `lib/templates/catalogo-de-variaveis.ts`. **Não** classificá-los como órfãos funcionais ou seguros sem análise de import dinâmico, registro runtime e feature flags.

A [matriz nominal dos 45 módulos](./upstream-gate5-review.md) preserva os nomes e testes por área. O novo relatório automatizado `gate6-evidence.json` listará **todos os 45** com prioridade, consumidores/imports diretos, transitivos, dependências do lote e testes requeridos, além dos 12 caminhos com justificativa e evidência triádica.

## Arestas indiretas: direção e distância

No fork: 75 candidatos tinham primeiro risco duro a um salto, 48 a dois, dois a três ou mais e 229 sem caminho estático. A análise bidirecional antiga agrupava 125 em uma mesma componente de 265 alterações inseguras, o que **não** significa 265 impactos funcionais diretos.

Nos 12 selecionados, o comparativo fork→target mostrou **dez caminhos 2→2**, **um 3→2** (lib/cobranca/uso.ts) e **um 2→3** (lib/contacts/cliente-pela-agenda.ts). Em lib/cobranca/uso.ts, a primeira direção passou de imported_by no fork para imports no target. No target, a cadeia observada envolve `lib/channels/capabilities.ts` e módulos sensíveis de roteamento/guardrail. Isso justifica prioridade elevada para verificação do contrato de canais, não prova regressão ou mitigação.

Aresta `imports` indica dependência estática A→B, mas `imported_by` indica consumidor reverso. A busca de caminhos bidirecionais é apenas alcance no grafo de módulos; não é prova de fluxo de dados/execução.

## Imports computados — evidência e limitação

- Fork `curso/semear-demonstracao.ts`, blob `efc36079668c67e56529113ee173e611e09ebd9b`: linha 1018 contém `await import(arquivo)`.
- Target `curso/semear-demonstracao.ts`, blob `aa2c70106a6408eafe846e2543c0cf04420ee1d0`: linhas 1088 e 1105 contêm `await import(path.join(pasta, arquivo))` e `await import(arquivo)`.
- O arquivo recebe `modulo` de `process.argv[2]`, valida o nome por `/^[a-z0-9-]+$/`, usa diretório `curso/semear` e verifica `existsSync` antes de carregar. O target também percorre `readdirSync(pasta)` por arquivos `.ts` para limpeza. Isso indica escopo de sementes de demonstração, **mas não resolve estaticamente os import specifiers**.
- Grafo do fork `complete:false` com um unresolved; grafo do target `complete:false` com dois. Nenhum dos 45 novos módulos apresentou unresolved próprio no relatório existente; isso não autoriza alterar a completude global ou ignorar import computado.

**Hipótese para um gate futuro:** investigar um scanner de imports dinâmicos de diretórios limitados, com testes de path traversal, symlink, extensão, erros de leitura, chamadas indiretas e módulos ausentes. Não efetuar alteração de regra agora; nenhuma resolução foi comprovada.

## Auditoria de cobertura existente na base ELUS

As árvores Git completas do fork (11.067 entradas, `truncated:false`) e do target (11.339 entradas, `truncated:false`) foram consultadas por SHA de árvore. Encontrados, em ambos, testes diretamente associados a `lib/automation/actions/add-tag`, `lib/automation/texto-do-followup`, `lib/channels/zernio/ingest`, `lib/cobranca/uso`, `lib/cobranca/visao-geral`, `lib/crm-b2b/import-process` e `lib/wacalls/events-bridge`.

**Diferença importante:** o target contém `lib/cobranca/visao-geral-postgrest-limite.test.ts`, ausente na base do fork. O teste preexistente de `texto-do-followup` cobre texto/reserva, **não** a nova consulta de campos de pipeline. O teste preexistente de `cobranca/uso` confirma a antiga contagem sem o novo caso QR sem telefone. O teste preexistente de `crm-b2b/import-process` cobre documentos CNPJ, não comprova dedupe por telefone extra. O teste de `wacalls/events-bridge-auth` mede autorização da ponte, não o novo SQL de `contact_phones`. Não inferir cobertura da mudança pela coincidência de nomes.

O workflow passou a solicitar Vitest para **nove arquivos de teste existentes** do fork (incluindo `app/api/v1/ai/agents/[id]/versions/[vid]/patch.route.test.ts` e `app/api/v1/ai/routers/auth-dual.test.ts`) e os **seis testes de Gate 6**. Essas execuções são baseline, com código ELUS anterior à atualização. Provas ainda faltantes: testes novos para telefone extra cross-tenant, guard de WABA no backend, seleção do sender canônico, exportação de endereço LGPD, paridade de trigger de cobrança, perda de dados por consulta falha, testes adversariais de imports dinâmicos, sabotagem isolada, E2E e prova em par quando houver agente.

**Não afirmar PASS** desses novos checks antes de confirmar resultado CI do SHA que os contém. Nenhum teste de banco descartável ou E2E de app foi executado nesta etapa.

## Testes e aceite

### Incidente Gate 6 — RED no HEAD `51312e821b540250152b8e03caff57ed46242ded` (06/11/2026)

- Evidência gerencial: [workflow #42155757269](https://github.com/OARANHA/elus360/actions/runs/42155757269), 3/6 testes do Gate 6 passaram e 3/6 falharam por `GATE6_REF_MISMATCH:target`. Preparação 12/12, reconciliação 64/64 e Gate 5 5/5 foram relatados verdes **apenas nesse HEAD anterior**; suites funcionais direcionadas e ensaio de reconciliação ficaram `SKIPPED`.
- Causa reproduzida a partir dos arquivos originais do SHA: `fixture()` atribuía o mesmo objeto global `refs` a `plan.refs` e `gate5.refs`; o teste 3 modificava `gate5.refs.target` e contaminava os testes 4–6, que falhavam antes dos cenários adversariais.
- Correção limitada aos testes: referência-base congelada (`Object.freeze`), cópias independentes de `refs` para `plan` e `gate5` em cada fixture, asserções de não-compartilhamento entre fixtures e checagem de que adulterar uma referência não modifica as demais. `scripts/elus-upstream-gate6-evidence.mjs` permanece intacto; nenhuma política foi relaxada.
- Validação preliminar: executor JavaScript isolado alimentado pelo código real `buildGate6` e pelos seis casos de `node:test`, adaptados apenas para execução no harness; baseline 3 PASS/3 FAIL, após correção 6/6 PASS em ordem original, inversa e embaralhada. Sabotagem controlada da cópia de `gate5.refs` rejeitada pelo teste 3. **Não equivale a execução nativa com Node.js nem ao workflow GitHub**.
- Aceite pendente no novo HEAD: 12/12 preparação, 64/64 reconciliação, 5/5 Gate 5, 6/6 Gate 6, testes funcionais direcionados e ensaio oficial read-only. Não transportar sucesso da execução anterior; o proprietário sinaliza GREEN/RED sem polling.
- Hindsight `Elus360`: consulta `recall` retornou `UNAVAILABLE`; sincronização de checkpoint permanece pendente. Evidências preservadas aqui e na PR #20.
- Decisão gerencial vigente: Gate 6 `RED`, evolução funcional `NO-GO`, sem `prepare`, merge, deploy, alterações de banco ou incorporação da v1.95.0. A distribuição 2/5/5 é triagem humana **não validada funcionalmente**.


Publicado `scripts/elus-upstream-gate6-evidence.mjs`: recebe `plan.json` e `gate5-evidence.json`, confere SHAs oficiais, contagens, triades e status bloqueados, registra razões e propõe prioridades. **Não faz integração e não possui comando de preparo.**

Publicado `tests/operational/elus-upstream-gate6.test.mjs` com **seis testes adversariais**: 57 arquivos sem autorização, incompletude computada, refs/status maliciosos, candidato com fork divergente, modulo novo de origem incorreta e grafo `complete:true` com unresolved. Modificado o workflow para gerar `gate6-evidence.json` e `gate6-review.md` no runner isolado, SHA256SUMS, sem alterar o reconciliador original.

**Ainda NÃO EXECUTADOS neste checkpoint:** CI do HEAD que contém Gate 6, teste positivo/negativo funcional da mudança upstream em integração isolada, sabotagem, E2E de interface, testes reais contra Supabase descartável, login/RBAC, replay de mensagens e prova em par de agente/ferramenta. Sem esses resultados, nenhum arquivo é funcionalmente aceito; todos seguem em `REVIEW`/NO-GO.

**Memória:** consultas `Elus360` (recall e KB) resultaram `UNAVAILABLE`. Preservar documentação versionada e sincronização pendente.

**Restrições:** PR #20 continua Draft. Sem `prepare`, merge, deploy, alteração de schema/migrations ou Supabase, incorporação da v1.95.0 ou liberação automática de candidato.
