# ELUS Upstream Sync — Gate 2: reconciliação triádica

Estado: **implementado em branch de revisão**. Não demonstra compatibilidade funcional, não publica imagens e só aplica patches classificados como seguros em **worktree isolada** quando o modo prepare é solicitado. Complementa, sem substituir, o Gate 1 em `scripts/elus-upstream-prepare.mjs`.

## Fonte de verdade

- Fork operacional: `OARANHA/elus360`; o repositório `OARANHA/elus` é histórico e não deve ser destino de publicação.
- Base histórica: DeskcommCRM `v1.94.0`; nova release somente após confirmação de tag e SHA oficial.
- Conferir `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, contrato de extensões e inventário `docs/elus360/ai-governance-write-surfaces.json` antes de liberar mudanças.
- `package.json` não determina a versão do upstream.

## Reconciliação

Em checkout descartável contendo os objetos Git dos três commits, executar:

```bash
node scripts/elus-upstream-reconcile.mjs plan --base <SHA40_DA_V194> --target <SHA40_RELEASE_OFICIAL> --fork <SHA40_MAIN_ELUS360>
```

Os três SHAs devem ser **commits completos e verificáveis**. O destino deve ser descendente da base oficial. O código não executa `fetch` e não verifica por si mesmo a autenticidade de tags: o operador/runner deve verificar a proveniência fora do script.

O JSON gerado contém classificação por arquivo:
- `already_integrated`: blob da `main` ELUS360 é idêntico ao blob da nova release; não reaplicar;
- `safe_to_prepare`: alteração de código ordinário fora das áreas sensíveis, e blob ELUS idêntico à base;
- `conflict_requires_review`: o fork modificou o arquivo em relação à base;
- `contract_requires_review`: autenticação, RLS/tenancy, IA, agentes, worker e prospecção;
- `protected_requires_review`: módulos próprios ELUS, SQL/migrations, release, workflows e outros caminhos protegidos;
- `deletion_requires_review`: exclusão pelo upstream.

## Revisão de segurança e detecção inicial de contratos

A classificação por caminho e blob do Gate 2 foi endurecida: o reconciliador examina o texto UTF-8 das versões anterior e nova (até 512 KiB), procura **sinais de contrato** e aplica bloqueio conservador a arquivos fora das pastas tradicionais. Indícios não demonstram vulnerabilidade, e ausência de indícios **não prova segurança**.

Sinais detectados: `tenant_isolation`, `authentication_authorization`, `managed_ai`, `agent_runtime`, `messaging_events`, `sensitive_import`. Mudanças em testes, arquivos não código, objetos Git não regulares, conteúdo binário ou oversized também exigem revisão.

Arquivos de login, áreas administrativas, configurações de tenant, agentes e componentes técnicos passam por revisão obrigatória, mesmo sem palavra-chave correspondente no texto. O JSON exibe `signals` e `suggested_checks` por arquivo, incluindo verificações negativas de RLS cross-tenant, grants de IA, RBAC/MFA, idempotência e compatibilidade de embeddings. Os nomes em `suggested_checks` são **requisitos de verificação**, não testes automaticamente executados ou resultados aprovados.

O modo `prepare` recusa checkout com alterações locais e nunca aplica arquivos que exijam revisão, incluindo symlinks, executáveis, imagens e alterações de testes.

**Limites:** heurísticas não reconhecem todo impacto transitivo de dependências, AST, comportamento de runtime ou regras de segurança futuras. O mapa de 17 superfícies de escrita de IA é um inventário inicial e não exaustivo. Toda atualização exige revisão do diff completo, testes aplicáveis e gates independentes de schema e produção.

A classificação é **por identidade de blobs e caminhos**, não equivalência semântica. Um código com alterações textuais diferentes pode já implementar a funcionalidade; deve ser auditado como conflito, não replicado automaticamente. Não aceitar `safe_to_prepare` como prova de ausência de efeitos colaterais.

## Gate 2 — Dependências diretas e inventário de IA

A análise agora inclui um inventário estático **transitivo de importações locais** na árvore do fork. Ela consulta a árvore Git do SHA ELUS360 fornecido, procura imports/exports de módulos locais (`@/`, `./`, `../`) em `app/`, `lib/`, `components/` e `workers/`, percorre cadeias de dependências com proteção contra ciclos e sinaliza `protected_reverse_dependency` quando um arquivo previamente classificado como `safe_to_prepare` é consumido, diretamente ou por intermediários, por módulos de autenticação, IA, administração, onboarding, workers ou extensões ELUS.

Nesse caso, o candidato passa a `contract_requires_review`, e o JSON passa a incluir `protected_importers` e o check `review_protected_importers`. O campo `dependency_scan` indica quantos arquivos foram lidos e se a inspeção ficou completa **dentro do escopo estático definido**. Se houver mais de 5000 arquivos-fonte no escopo, imports locais não resolvidos, conteúdo não inspecionável ou objeto não regular, a análise sinaliza `dependency_analysis_incomplete` para impedir que candidatos ordinários sejam aceitos sem revisão.

O analisador também compara os caminhos de rotas de IA e ações de onboarding alterados pelo upstream com o inventário `docs/elus360/ai-governance-write-surfaces.json` do fork pinado. Qualquer rota identificada fora desse inventário recebe `uninventoried_ai_surface` e o check `review_ai_write_surface_inventory`. **A ausência de uma rota do inventário não prova que a rota seja insegura; sua presença não prova que esteja protegida.** O inventário é explicitamente inicial.

Limites: não há análise de AST/TypeScript, resolução de aliases além do padrão `@/`, fluxo de dados, imports computados, reexports dinâmicos, importação por nome computado nem prova de autorização em runtime. Sinais e checks são **requisitos de revisão, nunca aprovação automática ou testes executados**. Um scan `complete:true` refere-se somente a esse escopo estático limitado e não à resolução completa do projeto TypeScript.

## Evolução TypeScript/AST — gate estático conservador

O reconciliador usa agora o parser oficial **TypeScript** (`typescript@^6.0.3`) para obter dependências por `import`, `export ... from`, `import()` com string literal, `require()` com string literal e `import = require()`. O resolvedor cobre `@/*` (alias configurado em `tsconfig.json`), caminhos relativos, extensões TS/JS e `index.ts(x)`/JS. O scanner percorre o grafo reverso até encontrar consumidores protegidos; ciclos são rastreados com conjunto de visitados.

O inventário é lido do **SHA do fork**, não da working tree. Uma leitura `git ls-tree` e uma execução `git cat-file --batch` substituem milhares de subprocessos por arquivo. O grafo é processado uma única vez por execução. O limite segue em 5000 fontes UTF-8 de até 2 MiB cada; objetos não regulares e arquivos grandes impedem conclusão automática.

O AST também examina as importações do **arquivo upstream alterado**, antes e depois da mudança. Um novo import direto para um módulo protegido gera `protected_module_import_change` e exige revisão; sintaxe não analisável ou import computado gera `dependency_analysis_incomplete`. Esse controle complementa o grafo reverso do fork, que por si só não enxerga novas arestas introduzidas pelo upstream.

**Fail-closed:** compilador indisponível, falha de parsing, import computado, alias local desconhecido (`~/`, `#`), referência `@/` ou relativa não encontrada, fonte ausente e inspeção truncada resultam em `dependency_scan.complete=false`. Assim, nenhum arquivo candidato é promovido automaticamente sem revisão. O relatório informa `unresolved_count`, sem copiar conteúdo de fontes nem dados de ambiente.

Este gate é **resolução estática limitada**, não equivale ao TypeScript Program/TypeChecker: ainda não resolve `paths` arbitrários, package exports, barrel files fora da árvore analisada, CSS/assets, imports computados nem fluxos de dados. Dependências de terceiro sem sintaxe de alias local não são auditadas transitivamente. Mesmo `complete=true` não autoriza merge/deploy. Testes de segurança e revisão de contratos continuam obrigatórios.

## Gate de resolução complexa e regressão de desempenho

Na resolução de imports locais, variantes concorrentes como `components/widget.ts` e `components/widget/index.ts` tornam a resolução **ambígua**. O scanner registra `ambiguous_local_module` e impede promoção automática até que as opções reais do compilador sejam verificadas. Imports com `~/` ou `#`, não documentados pelo `paths` verificado da aplicação, continuam incompletos, em vez de serem tratados como bibliotecas externas.

A suíte operacional inclui: cadeia de 360 imports indiretos chegando a um módulo `lib/elus360/`, módulos cíclicos, novas importações ao domínio protegido, `index`, `require`, `import()`, aliases sem mapeamento e colisão entre arquivo e diretório. O teste de desempenho usa um **limite de regressão de 15 segundos para a fixture sintética**; esse limite não mede tempo real do repositório nem garante orçamento de CPU em produção. A contagem de módulos inspecionados e `unresolved_count` continuam publicadas no relatório da análise.

## Evidência de regressão CI e correção específica (05/11/2026)

A execução do workflow Gate 1 para o HEAD `2d1b221ef7fb967cefc42e8f1c83a86986af58d2` foi **RED** ([run 41985467145](https://github.com/OARANHA/elus360/actions/runs/41985467145)). O job `contrato-upstream` confirmou instalação do TypeScript e sintaxe, mas os testes operacionais tiveram **20 PASS / 1 FAIL**. O teste de aliases locais desconhecidos esperava equivocadamente `unresolved_local_module`; o código retornou `unsupported_local_specifier`, também um resultado fail-closed. A asserção foi alinhada ao contrato real, sem liberar candidatos.

O mesmo log comprovou que a fixture de 360 imports transitivos passou em **12,571 ms no runner daquela execução**, dentro do limite de regressão de 15 segundos. Essa é uma medição de fixture em CI, **não** um benchmark no repositório real ou garantia de latência futura.

Foram acrescentados testes para `type T = import("@/components/domain").Domain` (import type AST com consumidores em `app/api/`) e imports indiretos de `app/actions/`, `components/auth/` e `lib/mcp/`. A cobertura protegida também foi ampliada nesses domínios. Os novos testes estão publicados e exigem a CI do HEAD subsequente antes de declaração de PASS.

## Gate TS resolver oficial e benchmark da árvore real (05/11/2026)

O grafo tem agora um modo configurado baseado em `ts.resolveModuleName`, com as opções lidas por `ts.parseConfigFileTextToJson` e `ts.convertCompilerOptionsFromJson` do **`tsconfig.json` presente no SHA pinado do fork**. Esse modo considera `paths`, `baseUrl`, extensões e módulos `index`, mantendo o inventário de arquivos vindo exclusivamente do Git; o host de resolução **não acessa o checkout real**. Com `paths` não resolvidos, imports computados, configuração inválida ou `extends` não implementado, a análise é incompleta e nenhum candidato ordinário pode ser promovido automaticamente.

A análise das importações introduzidas pelo upstream usa o mesmo `tsconfig` pinado para detectar aliases como `$security/* → lib/auth/*` e `$governance/* → lib/elus360/ai-managed/*`. Os destinos protegidos sinalizam `protected_module_import_change`. Essa detecção é conservadora e não substitui um `TypeChecker` completo.

Um benchmark **somente leitura** foi acrescentado ao workflow em `scripts/elus-upstream-real-tree-benchmark.mjs`. Ele inspeciona arquivos reais *rastreados* em `app/`, `lib/`, `components/` e `workers/`, informa SHA, quantidade de fontes, completude, categorias de módulos sem resolução, número de consumidores protegidos numa amostra de 100 componentes e `duration_ms`. Se exceder o limite de 5000 fontes ou 2 MiB por fonte, registra `complete:false`; **não reduz arbitrariamente a amostra para declarar segurança**. O benchmark não grava arquivos, não faz rede e não executa SQL.

**Status de evidência:** o workflow antigo foi reportado GREEN pelo Gerente de IA para o HEAD `05543453e83511062454ec974d36ad45a7ad5379` (run `42111557936`). Os novos testes de aliases complexos e o benchmark real foram **publicados em commits posteriores**, mas seus resultados ainda precisam da CI do novo HEAD. Não utilizar o verde antigo como validação dos novos arquivos.

Limitações: módulos externos/package exports, `extends` de tsconfig, dependências fora do inventário inspecionado e importações cujo destino depende do runtime não podem ser declarados seguros. O benchmark da árvore real fornece métricas de execução quando o runner executar o novo HEAD, mas não é prova de cobertura semântica total.

### Inventário Git real verificado em 05/11/2026

A consulta read-only ao Git Trees API para o SHA `0472d4545ec546136e35ebc447a6c0e897db08b9` retornou `truncated=false`, 11.073 entradas e **3.914 fontes** no escopo: `app/` 1.450, `lib/` 2.035, `components/` 394, `workers/` 35, totalizando **32.952.480 bytes**. As duas maiores fontes são `lib/i18n/dicionario.ts` (1.437.443 bytes) e `lib/database.types.ts` (530.189 bytes). Portanto os limites históricos (2.400 arquivos e 512 KiB) impediam a execução do scanner completo, sempre retornando análise incompleta nessa árvore.

O limite atualizado é **5.000 arquivos**, **2 MiB por arquivo** e **48 MiB de saída Git batched**, preservando fail-closed acima do orçamento; leitura por subprocesso segue com timeout de 30 segundos e `maxBuffer` 64 MiB. A resolução TypeScript usa cache de módulos e índice de conteúdo por caminho. Estas quantidades descrevem o inventário de arquivos **e não são medições de tempo de AST na árvore real**. O cronômetro da execução real será exibido pela etapa `Benchmark AST de arvore real (read-only)` da CI do novo HEAD.

## Benchmark real da CI GREEN — evidências e limitações (05/11/2026)

Workflow [42119277811](https://github.com/OARANHA/elus360/actions/runs/42119277811), HEAD de PR `3c12643d36e3bf8d937a7123de7e3a56d7735141`: `contrato-upstream` **SUCCESS**, verificação sintática **PASS**, testes de reconciliação **29/29 PASS** e benchmark read-only **PASS como execução do comando**. O log contém:

```json
{"benchmark":"elus-real-tree-ast","head":"06c7cdfe6f18c08842173cc685a81bc9c5a0da19","sources":3914,"candidate_sample":100,"protected_dependents":58,"complete":false,"unresolved_count":1220,"unresolved_reasons":["invalid_content","unresolved_configured_module"],"duration_ms":4763}
```

**A ressalva é central:** o benchmark terminou com `complete:false` e 1.220 entradas inconclusivas; **CI GREEN não é aprovação funcional do reconciliador**. Mesmo assim o reconciliador permanece fail-closed e impede classificação automática `safe_to_prepare` quando o scan é incompleto. Os números do benchmark são **da execução no runner**, não de uma aplicação real de patch upstream. Nenhuma medida de RSS/heap constava nesse HEAD; o script do benchmark foi instrumentado em commit posterior para publicar `memory_rss_mib`, `memory_heap_mib`, `memory_heap_delta_mib`, `unresolved_counts` e amostras limitadas de caminhos de módulos não resolvidos. Tais métricas **ainda não foram medidas nem aprovadas por CI**.

**Riscos em investigação:** importações de assets e referências de módulos fora do inventário atual podem explicar parte das `unresolved_configured_module`; não reinterpretar a ausência de arquivo como segurança até classificar cada origem. `invalid_content` sinaliza fonte contendo caracteres inválidos sob o contrato do parser (incluindo NUL) e bloqueia aprovação. Foram acrescentados testes para cadeia de componentes → auth → RBAC → API/IA e um caso adversarial de alias `#` que exige simultaneamente revisão de contrato e sinal de análise inconclusiva. Nenhum desses acréscimos equivale a testes executados até a nova CI.

O conector Hindsight `Elus360` retornou `UNAVAILABLE` durante esta rodada. Este checkpoint versionado é o substituto rastreável temporário; **não declara sincronização de memória concluída**.

## Gate de redução de resolução inconclusiva — PR #20

**Baseline comprovado:** execução [42120593035](https://github.com/OARANHA/elus360/actions/runs/42120593035) do commit `03c5e04a0f81c80d57c49526d92434bc767ff8f4` (checkout sintético do merge `a4365d03692f701bc41eacdb20fbcc60a9f355ab`). O workflow concluiu **GREEN**, 12 testes de preparação e **31 testes de reconciliação PASS**. O benchmark no checkout de CI reportou **3.914 fontes, 4.968 ms, RSS 270,4 MiB, heap utilizado 148,9 MiB, variação de heap 127,5 MiB, 58 de 100 componentes amostrados com consumidores protegidos, `complete:false`, 1.220 problemas**. Distribuição: **1.219 `unresolved_configured_module`** e **1 `invalid_content`**. As primeiras referências inconclusivas eram importações em `app/admin/(protected)/audit/[entryId]/_client.tsx` a hooks (ex.: `@/hooks/i18n/useLocaleDeData`); o único `invalid_content` vinha de `lib/waha/webhook-auth.test.ts` contendo NUL dentro de literal em arquivo de teste excluído do `tsconfig.json` de produção.

**Correção estrutural aplicada:** o grafo de produção inspeciona agora `app/`, `lib/`, `components/`, `workers/`, `hooks/`, `types/`, `curso/` e os entrypoints `proxy.ts`, `instrumentation.ts`, `instrumentation-client.ts`. Arquivos `*.test.ts[x]`, formalmente excluídos do `tsconfig.json`, deixam de contaminar a análise do runtime compilado; as mudanças em testes continuam exigindo revisão pelo gate de status e pela suíte de integridade independente. Não se descartam erros em código que pertence ao escopo compilado.

**Validação nova:** benchmark exporta `historical_baseline_unresolved:1220`, `unresolved_reduction`, divisão por categoria `unresolved_specifier_categories`, motivos `unresolved_counts`, RSS e heap. O workflow executa `--require-reduction` e **falha com exit code 2** se não houver redução mensurável em relação à baseline. As causas remanescentes não são ignoradas; `complete:false` continua impedindo preparação automática. A baseline vale para a árvore da PR #20 nesta investigação; mudanças estruturais futuras exigem revalidá-la em novo commit pinado.

**Estado de aceite:** esses commits foram publicados na branch da PR #20, mas o novo CI ainda não foi confirmado. A redução esperada pela inclusão de `hooks/` e exclusão de testes não constitui redução medida. Os testes adversariais publicados cobrem dependência protegida atravessando um hook e teste excluído que não altera a completude do grafo de runtime. Hindsight `Elus360`: indisponibilidade reportada anteriormente; checkpoint não confirmado na memória.

## Gate real 42121748838 — redução comprovada e seis caminhos remanescentes

O Gerente de IA informou GREEN para o HEAD `dc05993e6448a1dfe6ff81412e8e125cca25f3ac`. O job `contrato-upstream` do [run 42121748838](https://github.com/OARANHA/elus360/actions/runs/42121748838) foi confirmado: sintaxe PASS, preparo **12/12**, reconciliação **33/33**. Benchmark (checkout de merge `c002c9e2677bda0a6717bd07f410400982d6e838`) contabilizou **3.192 fontes, 3.870 ms, RSS 247,9 MiB, heap usado 134,6 MiB, delta de heap 113,2 MiB**, e 69 de 100 componentes com dependentes protegidos. Houve redução de **1.220 para 7** inconclusões (1.213, ou 99,43%). O resultado continua `complete:false`: **6** `unresolved_configured_module` relativos e **1** `computed_module_specifier`.

A inspeção dos arquivos concretos identificou a causa dos seis relativos: `app/design/layout.tsx` importa `./showcase.css`; `app/layout.tsx` importa `./globals.css`; `curso/espanhol-demonstracao.ts` importa `./espanhol-demonstracao.json`; `curso/receitas-jornadas.ts` importa `./receitas-jornadas.json`; `instrumentation.ts` importa `./sentry.server.config` e `./sentry.edge.config`. **Todos os seis destinos foram verificados na árvore Git rastreada.** A implementação subsequente inclui ambos os módulos Sentry no inventário fonte e adiciona arquivos CSS/JSON rastreados como **folhas não executáveis**, exigindo correspondência exata no Git; recurso ausente permanece inconclusivo. Alterações upstream de CSS/JSON e dos layouts raiz continuam exigindo revisão, não viram candidatos seguros.

A sétima inconclusão é legítima: `curso/semear-demonstracao.ts` utiliza `await import(arquivo)`, onde `arquivo` é construído em runtime a partir de `process.argv[2]`. **Não inferir nem liberar o destino**. O analisador continua falhando fechado para imports computados; nenhuma exceção especial foi criada para esse arquivo.

O benchmark agora informa `verified_resource_imports` e `tracked_non_source_resources`, além de duas baselines distintas: a histórica `1220` e a última verificada `7`. A etapa CI `--require-reduction` exige redução **relativa a 7**, ou encerra com falha. O resultado esperado é menos de sete problemas, mas **não há nova medição verificada para os commits desta correção**. Novos testes adversariais cobrem CSS/JSON existente, recurso ausente, import dinâmico de Sentry, e classificação do layout raiz e dos assets como revisão obrigatória.

**Limitação:** a comparação de número de fontes não é comparação de conjunto idêntico (escopo ajustado entre as versões); 69 dependentes protegidos não representa cobertura semântica de todas as arestas. O Gate AST permanece em desenvolvimento, sem aprovação funcional, merge, deploy ou alterações no banco.

## Preparação isolada

Opcionalmente, depois da análise e revisão preliminar, executar:

```bash
node scripts/elus-upstream-reconcile.mjs prepare --base <SHA40_DA_V194> --target <SHA40_RELEASE_OFICIAL> --fork <SHA40_MAIN_ELUS360> --out /tmp/elus-upstream-candidate-novo
```

O destino absoluto não deve existir e deve estar **fora do checkout atual**. O comando cria uma worktree detached do commit ELUS e aplica exclusivamente patches de arquivos `safe_to_prepare`. Arquivos sensíveis, conflitos, exclusões e migrations permanecem inalterados. O relatório `.elus-upstream/report.json` lista os arquivos preparados; **não há commit, push, merge nem execução SQL**. Um erro durante o patch não remove automaticamente a worktree, permitindo inspeção. O resultado não é uma versão pronta para produção.

## Invariantes necessários antes de uma PR de atualização

1. Preservar marca ELUS360, onboarding e os contratos de governança em `lib/elus360/ai-managed/` e telas administrativas.
2. Nenhuma alteração de provider/model/credentials/operator_model por tenant sem permissão efetiva conferida **no backend**. Os controles da interface não substituem os guards.
3. Isolamento por `organization_id`, RLS, roles, MFA, trilha de auditoria e testes negativos cross-tenant.
4. Garantir que as superfícies inventariadas de mutação técnica de IA continuem protegidas; verificar novas rotas e ações adicionadas pelo upstream.
5. SQL/migrations/baseline, especialmente comandos destrutivos, seguem gate independente com PostgreSQL descartável e revisão de segurança.
6. Validar app, worker e scheduler. Executar branch → PR → CI → revisão → merge aprovado → imagens GHCR por digest → Portainer Vigia aprovado → canário.
7. Nenhum E2E/Playwright, merge, publicação de imagem, migration ou deploy por este mecanismo sem autorização específica.

## Próxima capacidade

A classificação já está acoplada a um preparador em worktree isolada. Faltam a criação automatizada da PR com revisão dos patches, a detecção semântica profunda baseada em AST, resolução TypeScript abrangente e análise de fluxo e a execução/validação dos testes por contrato. O mapeamento atual de sinais a `suggested_checks` não executa testes. Essas capacidades ainda não são entregues pelo Gate 2. O executor da PR #71 do repositório histórico pode ser usado como referência de implementação, **não** como origem operacional nem migrado sem revisão.
