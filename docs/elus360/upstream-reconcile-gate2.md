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

A inspeção dos arquivos concretos identificou a causa dos seis relativos: `app/design/layout.tsx` importa `./showcase.css`; `app/layout.tsx` importa `./globals.css`; `curso/espanhol-demonstracao.ts` importa `./espanhol-demonstracao.json`; `curso/receitas-jornadas.ts` importa `./receitas-jornadas.json`; `instrumentation.ts` importa `./sentry.server.config` e `./sentry.edge.config`. **Todos os seis destinos foram verificados na árvore Git rastreada.** A implementação subsequente inclui ambos os módulos Sentry no inventário fonte e adiciona arquivos CSS/JSON rastreados como **folhas não executáveis**, exigindo correspondência exata com objetos Git regulares (`100644 blob`); recurso ausente, não regular ou não inventariado permanece inconclusivo. O relatório passa a contar `tracked_non_source_resources` e `verified_resource_imports`, sem contabilizar recursos como nós de código ou esconder imports locais ausentes. Alterações upstream de CSS/JSON e dos layouts raiz continuam exigindo revisão, não viram candidatos seguros.

A sétima inconclusão é legítima: `curso/semear-demonstracao.ts` utiliza `await import(arquivo)`, onde `arquivo` é construído em runtime a partir de `process.argv[2]`. **Não inferir nem liberar o destino**. O analisador continua falhando fechado para imports computados; nenhuma exceção especial foi criada para esse arquivo.

O benchmark agora informa `verified_resource_imports` e `tracked_non_source_resources`, além de duas baselines distintas: a histórica `1220` e a última verificada `7`. A etapa CI `--require-reduction` exige redução **relativa a 7**, ou encerra com falha. O resultado esperado é menos de sete problemas, mas **não há nova medição verificada para os commits desta correção**. Novos testes adversariais cobrem CSS/JSON existente, recurso ausente, import dinâmico de Sentry, e classificação do layout raiz e dos assets como revisão obrigatória.

**Limitação:** a comparação de número de fontes não é comparação de conjunto idêntico (escopo ajustado entre as versões); 69 dependentes protegidos não representa cobertura semântica de todas as arestas. O Gate AST permanece em desenvolvimento, sem aprovação funcional, merge, deploy ou alterações no banco.

## Gate 1 run 42124114060 — redução a 1 e preservação do inventário (05/11/2026)

A execução [42124114060](https://github.com/OARANHA/elus360/actions/runs/42124114060) foi confirmada **SUCCESS** para HEAD da PR `328f735f81eb87fdf26fb614bb887b48be7a54d0`: 12/12 testes de preparação, 37/37 testes de reconciliação, sintaxe e benchmark. O runner usou checkout sintético do merge `ab9096582877f4490232d0e3cf0f09cdebd133af`. Benchmark real: `sources:3194`, `tracked_non_source_resources:239`, `verified_resource_imports:4`, `candidate_sample:100`, `protected_dependents:69`, `duration_ms:2746`, `memory_rss_mib:246.9`, `memory_heap_mib:135.3`, `memory_heap_delta_mib:113.9`, `unresolved_count:1`, `complete:false`. O último caso é `computed_module_specifier` em `curso/semear-demonstracao.ts`; o caminho `arquivo` depende de `process.argv[2]` e não pode ser tratado como resolvido sem execução. O fail-closed continua exigido.

Comparação adicional, por Git Trees API read-only: inventário anterior no merge `c002c9e2677bda0a6717bd07f410400982d6e838` = 3.192 fontes; inventário atual no merge `ab9096582877f4490232d0e3cf0f09cdebd133af` = 3.194 fontes. Interseção **3.192/3.192**, **zero arquivos removidos**; os únicos novos são `sentry.edge.config.ts` e `sentry.server.config.ts`. Esta evidência demonstra **inclusão de fontes sem exclusões**, mas não prova igualdade semântica de todos os imports entre os dois snapshots. Em ambos os benchmarks, 69/100 componentes da amostra apresentaram consumidores protegidos.

Na mesma PR foram acrescentados testes determinísticos para: (a) import computado em uma fonte do fork impedindo `safe_to_prepare` para candidato ordinário, e (b) ampliação do inventário com módulos Sentry sem perda das arestas anteriores do exemplo componentes → hooks → auth. O grafo passa a calcular `edge_count` e o benchmark publica `module_edges`, para permitir comparação numérica de arestas em execuções posteriores. Os novos testes e a nova métrica **ainda dependem de CI do HEAD subsequente**; não inferir PASS com base no GREEN anterior.

A sincronização no Hindsight `Elus360` continua não confirmada caso o conector permaneça `UNAVAILABLE`. A PR continua Draft; sem merge, deploy nem mudanças em banco.

## Gate 1 42125199338 — métrica de arestas e prova de conservação

A execução [42125199338](https://github.com/OARANHA/elus360/actions/runs/42125199338) confirmou SUCCESS no HEAD `d3ac3fcbddd340fa4608108108a9c7148fd012b6`, com sintaxe PASS, preparo **12/12** e reconciliação **39/39**. Benchmark no checkout de merge `0cd72381214cc95a9b531772216c8427d07686cd`: **3.194 fontes, 15.290 arestas dirigidas de importação, 239 recursos rastreados, 4 imports de recursos confirmados, 69/100 componentes da amostra com importadores protegidos, 3.648 ms, RSS 246,7 MiB, heap 135,5 MiB, delta heap 114 MiB**. O resultado permanece `complete:false` com **1** `computed_module_specifier` em `curso/semear-demonstracao.ts`. A etapa de benchmark teve sucesso operacional sem liberar o reconciliador para atualizações automáticas.

**Comparação exata de blobs:** as árvores Git dos merges `c002c9e2677bda0a6717bd07f410400982d6e838` (3.192 fontes) e `0cd72381214cc95a9b531772216c8427d07686cd` (3.194 fontes) foram verificadas via Git Trees API com `truncated:false`. **Todos os 3.192 caminhos históricos mantiveram o mesmo SHA de blob**; zero modificados, zero removidos. Foram acrescidos apenas `sentry.edge.config.ts` e `sentry.server.config.ts`. Logo, não houve regressão do conteúdo das fontes anteriores entre esses dois snapshots. Isso não comprova automaticamente igualdade das arestas do resolvedor; esse é um gate separado.

**Próximo gate publicado, pendente de CI:** o benchmark reconstrói o grafo do inventário histórico no mesmo checkout (sem as duas novas fontes) e compara o conjunto completo de pares `[dependência, importador]` com o grafo expandido. Registra `prior_inventory_sources`, `prior_inventory_edges`, `retained_prior_edges`, `lost_prior_edges` e `added_module_edges`. A opção `--require-edge-preservation` faz a CI falhar se o inventário anterior não tiver 3.192 fontes ou se qualquer par anterior desaparecer. Há teste adversarial com remoção intencional de um import para confirmar que a comparação detecta perda de aresta. Esta prova mede conservação de arestas em um conjunto de fontes idênticas, porém não realiza verificação de semântica/autorização em runtime. Se o inventário mudar em commit futuro, será preciso revalidar a baseline pinada, não desativar o gate.

**Evidência fail-closed:** o run 42125199338 executou o teste de integração `import computado em fonte runtime bloqueia candidato ordinario e prepare` (PASS). O teste exige `dependency_scan.complete=false`, motivo `computed_module_specifier` e `status=contract_requires_review` para o candidato ordinário; nunca `safe_to_prepare`. O teste de remoção de CSS também passou no mesmo workflow, provando que a ausência de um blob regular torna o scan inconclusivo. Os demais testes de módulos Sentry, hooks e dependências protegidas ficaram GREEN nesse HEAD. A avaliação funcional final, incluindo novos commits e eventual teste canário controlado, permanece **não aprovada**.

**Memória:** consultar o Hindsight `Elus360`; enquanto o serviço continuar `UNAVAILABLE`, este documento e o comentário de PR constituem checkpoint operacional versionado, sem afirmar gravação no banco da memória.

## Gate 1 42127652555 — conservação de pares de arestas comprovada

No workflow [42127652555](https://github.com/OARANHA/elus360/actions/runs/42127652555), o HEAD da PR `e2ebc60ba582b470823c102989cc08b7a5245ab3` foi verificado com job `contrato-upstream` **SUCCESS**, testes de preparação **12/12 PASS** e de reconciliação **40/40 PASS**. O benchmark do checkout de merge `570660923f4cf399e8ae6fb3d9320a58b0d28568` registrou:

| Métrica | Evidência do runner |
| --- | ---: |
| Fontes históricas | 3.192 |
| Fontes expandidas | 3.194 |
| Arestas históricas (`prior_inventory_edges`) | 15.284 |
| Arestas preservadas (`retained_prior_edges`) | 15.284 |
| Arestas perdidas (`lost_prior_edges`) | **0** |
| Arestas novas (`added_module_edges`) | **6** |
| Arestas totais (`module_edges`) | **15.290** |
| Recursos rastreados CSS/JSON | 239 |
| Imports de recursos comprovados | 4 |
| Componentes da amostra de 100 com importadores protegidos | 69 |
| Tempo do benchmark | 6.314 ms |
| RSS / heap usado / delta heap | 297,3 / 187,7 / 166,2 MiB |
| Inconclusões | **1 — `computed_module_specifier`** |
| Completude | **`false`** |

A etapa do workflow executou `node scripts/elus-upstream-real-tree-benchmark.mjs --require-reduction --require-edge-preservation`. O código compara **pares exatos** `[dependência, importador]` em conjuntos, faz `exitCode=3` se desaparecer qualquer aresta anterior ou se a contagem histórica deixar de ser 3.192, e o workflow falhou se o comando retornasse código não zero. Por isso, o GREEN do job demonstra que `lost_prior_edges=0` não foi somente apresentado: **a condição de falha foi avaliada**.

Os testes adversariais relevantes estão explicitamente aprovados no log: `entrypoints Sentry seguem dependencias TS protegidas, sem ignorar modulo ausente` (#35); `scanner pinado reconhece CSS Git regular e bloqueia recurso removido` (#37); `import computado em fonte runtime bloqueia candidato ordinario e prepare` (#38); `cobertura reversa adicionada nao remove arestas ou consumidores protegidos` (#39); `comparacao exata do conjunto de arestas nao oculta regressao do grafo` (#40). O caso #40 remove propositalmente uma importação da fixture e exige detectar a perda do par de aresta. O caso #38 exige `complete:false`, sinal `dependency_analysis_incomplete` e `contract_requires_review`, nunca `safe_to_prepare`.

**Limitação probatória:** os grafos de 3.192 e 3.194 fontes são reconstruídos com o **mesmo resolvedor da versão atual**, no mesmo checkout pinado, omitindo apenas os dois módulos Sentry do inventário histórico. Isso prova conservação de todas as arestas **que esse resolvedor reconhece** e complementa a comparação prévia de SHA de blobs. Não prova ausência de falsos negativos próprios do parser nem equivalência comportamental das rotas auth/RBAC/multi-tenant/IA em runtime. A inconclusão `curso/semear-demonstracao.ts` permanece porque o caminho de importação é calculado em runtime. A PR continua em Draft; Gate 1 GREEN não autoriza merge, deploy, modificação de banco ou aceite funcional final.

**Memória:** Hindsight `Elus360` segue sujeito à verificação de conectividade. Não afirmar `sync_retain` bem-sucedido sem confirmação explícita do serviço.

## Gate semântico/operacional — contrato exportado e worktree isolada (05/11/2026)

**Contexto de início:** Gerente IA confirmou **Gate 1 GREEN** run [42128546326](https://github.com/OARANHA/elus360/actions/runs/42128546326) para HEAD `90935d0ff437586617857e1579a464c36c82fd30`. Esta autorização **não** incluiu merge, deploy, alteração de banco ou aceite funcional do reconciliador. Hindsight `Elus360` foi consultado antes da implementação, mas a chamada retornou `UNAVAILABLE`; o checkpoint permanece versionado e a sincronização segue pendente.

**Evolução publicada:** além do grafo de imports, `scripts/elus-upstream-contract-risk.mjs` agora examina AST das versões anterior/nova de código JS/TS, incluindo JSX/TSX, exports diretos, exports nomeados, export default e atribuições CommonJS `module.exports` / `exports.nome`. Mudanças em declarações exportadas geram `exported_contract_change`; alterações em implementações internas de módulos com exports inalterados geram `exported_module_internal_change`; falha de parsing ou ausência do compilador TypeScript gera `semantic_analysis_incomplete`. Todos são sinais de revisão, **nunca autorização automática**. A comparação é sintática/conservadora, **não** comprova equivalência comportamental ou tipos em runtime.

### Matriz de cenários esperados versus observados

| Cenário representativo DeskcommCRM / ELUS360 | Fixture | Resultado esperado | Evidência observada |
| --- | --- | --- | --- |
| Autenticação: função pública deixa de exigir papel admin | `components/policy.ts` | `exported_contract_change`, revisão | Teste novo publicado; CI pendente |
| RBAC: assinatura de autorização passa a aceitar papel genérico | `components/role.ts` | `exported_contract_change`, revisão | Teste novo publicado; CI pendente |
| Multi-tenancy: filtro de organização deixa de comparar tenant | `components/tenant.ts` | `exported_contract_change`, revisão | Teste novo publicado; CI pendente |
| Governança IA: função exportada passa a ignorar grant | `components/agent.ts` | `exported_contract_change`, revisão | Teste novo publicado; CI pendente |
| API: serializador público muda o payload sem novo import | `components/endpoint.ts` | `exported_contract_change`, revisão | Teste novo publicado; CI pendente |
| API PATCH: handler deixa de validar autorização | `app/api/v1/ai/agents/[id]/versions/[vid]/route.ts` (código sintético representativo) | Revisão obrigatória | Teste novo publicado; CI pendente |
| Implementação interna de função exposta via `export {canManage}` | `components/access.ts` | `exported_module_internal_change`, revisão | Teste novo publicado; CI pendente |
| Export CommonJS muda retorno/ignora papel | `components/access.cjs` | `exported_module_internal_change` ou `exported_contract_change` | Teste novo publicado; CI pendente |
| Resolução de cinco links import/reexport auth, RBAC, IA, API e MCP | `TypeScript Program/CompilerHost` independente vs grafo AST | Destinos e pares idênticos | Teste novo publicado; CI pendente |
| Prepare com alteração de contrato exportado + alteração ordinária | Git temporário e worktree detached | Aplicar só arquivo ordinário; preservar contrato e checkout de origem | Teste novo publicado; CI pendente |
| Import computado sem destino estático | `curso/semear-demonstracao.ts` e fixture | `complete:false`; nenhum `safe_to_prepare` | **PASS** nos 40/40 testes do run [42127652555](https://github.com/OARANHA/elus360/actions/runs/42127652555) |
| Recurso CSS removido após estar presente no Git | Git temporário e worktree | `contract_requires_review` | **PASS** no run 42127652555 |
| Alteração ordinária sem export público, sem signals, sem consumidores protegidos | `components/plain.ts` | Pode ser `safe_to_prepare` após gates completos | Teste novo publicado; CI pendente |

Os nomes de arquivos `components/*` da matriz são **fixtures sintéticas** inspiradas nas categorias de contrato existentes; não foram alterados os endpoints de produção. A fixture `PATCH` utiliza a nomenclatura de uma rota efetivamente presente no repositório, mas seu conteúdo simplificado **não equivale** ao handler real. Nenhum teste real de HTTP, Supabase, RLS ou autorização em produção foi executado.

**Verificação isolada executada:** no ambiente local disponível, TypeScript **5.8.3** via `ts.createProgram` e `program.getResolvedModuleFromModuleSpecifier` resolveu **5/5 imports/reexports** da mesma topologia sintética usada pelo teste independente (componentes → barrel → auth → RBAC → API/IA, e auth → MCP). Isso confirma somente o oráculo local; não substitui a execução do teste completo em **TypeScript 6**, versão instalada pela CI do repositório, nem verifica a resolução de toda a árvore real.

**Critérios para avançar:** (1) CI de sintaxe e testes sem falhas; (2) oráculo independente `TypeScript Program/CompilerHost` concorda nos cinco vínculos de imports/reexports da fixture; (3) nenhuma alteração de contrato exportado ou import computado recebe `safe_to_prepare`; (4) `prepare` em worktree destacada preserva o arquivo de contrato no commit de origem e aplica somente mudanças ordinárias; (5) relatórios documentam os caminhos bloqueados e o erro de parsing; (6) para aceite funcional final, ainda falta validação de comportamento e autorização em ambiente isolado antes de qualquer canário real, respeitando governança e deploy.

**Riscos residuais:** um AST sintático não detecta todas as mudanças indiretas possíveis, inclusive efeitos colaterais em módulos sem exports, chamadas remotas, aliases de runtime, mudanças ambientais ou semântica entre frameworks. Diferenças de imports só foram confrontadas em fixtures do `CompilerHost`; o inventário real ainda não foi integralmente comparado por um segundo compilador. O fail-closed do grafo permanece necessário.

## Gate de compatibilidade operacional — simulação multiversão e preservação ELUS (05/11/2026)

### Evidência confirmada do Gate 1 anterior

O workflow [42131658615](https://github.com/OARANHA/elus360/actions/runs/42131658615), referente ao HEAD `63c595b8a4b6c1a8435517f64a52abe442a5daad`, apresentou `contrato-upstream: SUCCESS`, **12/12 testes de preparação PASS** e **47/47 testes operacionais PASS**. O log confirmou individualmente a matriz semântica (#41), a integração Git triádica contra mudança em export (#42), a comparação independente `TypeScript Program/CompilerHost` (#43), `prepare` em worktree destacada preservando contrato exportado (#44), helper com reexport nominal (#45), handler PATCH alterando autorização sem import novo (#46) e CommonJS (#47). O benchmark registrou 3.194 fontes, 15.290 arestas, 15.284/15.284 anteriores preservadas, zero perdidas, seis novas; 3.652 ms, RSS 297,5 MiB, heap usado 189,6 MiB e **uma inconclusão** (`computed_module_specifier` em `curso/semear-demonstracao.ts`); `complete:false`.

### Cenários adicionais de atualização simulada (commits posteriores; CI pendente)

Os testes da PR representam **revisões sintéticas** DeskcommCRM v1→v2→v3, criadas em repositório Git temporário, **não** releases oficiais nem patches do upstream remoto. Uma revisão upstream altera contratos de auth, tenant, IA e API; a versão seguinte modifica novamente um arquivo ordinário. Em paralelo, o fork ELUS adiciona uma correção em `components/fork-custom.ts` e mantém `lib/elus360/identity.ts` sob controle próprio. O `prepare` executa em worktree detached temporária, sem merge e sem alterar o checkout do fork. Matriz de asserções:

| Caminho no fixture | Mudança | Status esperado | Exigência no worktree |
| --- | --- | --- | --- |
| `components/ordinary.ts` | Melhoria ordinária upstream v1→v3, sem export | `safe_to_prepare` | Aplicar apenas versão v3 |
| `components/fork-custom.ts` | Correção própria ELUS divergente da base | `conflict_requires_review` | Manter literalmente `FIXED_BY_ELUS` |
| `lib/elus360/identity.ts` | Contrato exclusivo ELUS modificado pelo upstream | `protected_requires_review` | Manter versão ELUS |
| `lib/auth/require-role.ts` | Política de papel relaxada | `contract_requires_review` | Preservar exigência admin |
| `lib/tenant/scope.ts` | Filtro de tenant removido | `contract_requires_review` | Preservar filtro |
| `lib/ai/agent-policy.ts` | Grant de agente ignorado | `contract_requires_review` | Preservar validação |
| `app/api/v1/ai/agents/route.ts` | Endpoint PATCH ignora recusa | `contract_requires_review` | Preservar resposta 403 |

O teste exige **um único arquivo preparado**, relatório `.elus-upstream/report.json` coerente e `HEAD` e `git status --porcelain` do fork inalterados. As categorias representadas foram escolhidas a partir de superfícies existentes no repositório, mas os conteúdos do fixture não são implementações reais. Logo, esta simulação **não autoriza** substituição de correções reais na produção.

**Outras lacunas sem imports:** o detector AST foi ampliado para mudanças em efeitos executáveis no topo de módulos sem exports, incluindo inicialização de auth, ativação de políticas de tenant e configuração de IA. O sinal `module_initialization_change` exige revisão. Declarações ordinárias sem export e sem efeito de inicialização continuam elegíveis quando todos os demais gates passam. Parsing inválido, TypeScript ausente e exports alterados permanecem fail-closed. Esta proteção não equivale a análise interprocedural completa ou verificação de chamadas remotas.

**Validação em novo HEAD:** o código e os fixtures estão publicados, mas os novos testes e sinais **ainda não possuem CI confirmada**. O Gate 1 anterior não prova sucesso dos novos cenários. O próximo requisito é PASS da suíte e inspeção de que nenhuma correção local seja silenciosamente substituída. Mesmo com CI GREEN, aprovação funcional completa exige testes negativos de autenticação, RLS e governança de IA em ambiente apropriado e autorização específica para canário.

**Hindsight `Elus360`:** `recall` retornou `UNAVAILABLE` antes da etapa. Não afirmar sincronização de memória concluída sem retorno explícito de `sync_retain`. Evidências versionadas neste documento e na discussão da PR.

## Gate 1 GREEN — multiversão detalhada e simulação de alterações mistas (05/11/2026)

Workflow [42133021290](https://github.com/OARANHA/elus360/actions/runs/42133021290) para HEAD `979c7f16e4ec3c063dc3060b358ffca6741c8afd`: **SUCCESS**, `contrato-upstream` PASS, **12/12 testes de preparação** PASS e **49/49 testes operacionais** PASS. Evidência individual no log: **#48** `simulacao DeskcommCRM v1-v2-v3 preserva correcoes ELUS no fork e aplica somente patches ordinarios` PASS; **#49** `bootstrap nao exportado que altera autorizacao ou inicializacao exige revisao sem novos imports` PASS. No teste #48 o relatório exige **exatamente 1 arquivo** `safe_to_prepare`, preserva em worktree detached `components/fork-custom.ts` (correção ELUS), `lib/elus360/identity.ts`, `lib/auth/require-role.ts`, `lib/tenant/scope.ts`, `lib/ai/agent-policy.ts` e `app/api/v1/ai/agents/route.ts`; também compara os conteúdos literais esperados, o HEAD e o estado limpo do checkout de origem. O teste #49 exige `module_initialization_change` para mudanças em inicializações sem exports e nenhum sinal para mudança ordinária em constante sem export.

O benchmark dessa execução usou checkout de merge `7879d41e31315163d799f3ddc7c744d59162bb4c`: 3.194 fontes, 15.290 arestas, 15.284 anteriores preservadas, `lost_prior_edges:0`, `added_module_edges:6`, 239 recursos inventariados e quatro imports de recursos reconhecidos; tempo **6.790 ms**, RSS **297,2 MiB**, heap **190,0 MiB** e delta **168,6 MiB**. Inconclusão única `computed_module_specifier` em `curso/semear-demonstracao.ts`; `complete:false`, sem liberação automática.

### Novo caso adversarial — mistura dentro de um arquivo

Publicado em commit posterior um teste Git triádico com upstream modificando simultaneamente: (a) arquivo ordinário `components/ordinary.ts`; (b) `components/mixed.ts`, com melhoria de interface e remoção da exigência `role==='admin'` no mesmo arquivo; (c) `components/shared-correction.ts`, cuja outra região já foi corrigida localmente pelo ELUS360. Matriz de resultados **exigidos**, com execução ainda pendente na nova CI:

| Caminho | Classificação exigida | Resultado exigido na worktree destacada |
| --- | --- | --- |
| `components/ordinary.ts` | `safe_to_prepare` | Aplicar conteúdo upstream |
| `components/mixed.ts` | `contract_requires_review` / `exported_contract_change` | **Preservar arquivo completo da base**, sem aplicar parcialmente a melhoria misturada |
| `components/shared-correction.ts` | `conflict_requires_review` | **Preservar literalmente a correção `ELUS_CORRECTED`**, ainda que o upstream altere outro trecho |

O teste adicional exige `preparedFiles: ["components/ordinary.ts"]`, preservação do `HEAD` original, `git status --porcelain` vazio e conteúdo exato dos três arquivos. Não foram consultadas APIs reais, nenhuma versão oficial do DeskcommCRM foi atualizada e nenhuma mudança de produção foi realizada.

**Riscos e aceite:** o mecanismo é conservador **por arquivo**, não faz merge semântico de hunks em arquivos contendo contratos; uma melhoria legítima misturada com alteração perigosa exige revisão manual integral. A classificação AST não substitui autorização, RLS, modelos de IA ou comportamento de endpoint em execução, e o import computado conhecido mantém o grafo inconclusivo. O Gate 1 GREEN anterior valida somente testes já existentes naquele SHA; o novo caso misto requer CI própria. O Hindsight `Elus360` permaneceu `UNAVAILABLE` na consulta antes desta etapa, sendo a sincronização ainda pendente.

## Gate adversarial distribuído — resultados confirmados e novos bloqueios (05/11/2026)

A execução [42134125381](https://github.com/OARANHA/elus360/actions/runs/42134125381), para HEAD `85071b32d2f7dae1085b5355ad8b13a42dcd158b`, foi confirmada **SUCCESS**: **12/12 testes de preparação** e **50/50 testes operacionais**. O teste específico **#50** `mesmo arquivo mistura melhoria legitima e enfraquecimento RBAC: bloqueio atomico com fork corrigido` retornou **PASS**. Suas asserções exigem que `components/mixed.ts` contenha melhoria legítima e bypass RBAC, receba `contract_requires_review` e fique integralmente intocado; `components/shared-correction.ts` receba `conflict_requires_review` e conserve `ELUS_CORRECTED`; `preparedFiles` contenha apenas `components/ordinary.ts`; a worktree detached aplique somente esse arquivo e o HEAD/checkout de origem permaneçam intactos.

O benchmark desse run: checkout de merge `f03e87dd0cf12ba880a1d13519160f86ed53e655`, **3.194 fontes, 15.290 arestas resolvidas, 15.284 preservadas, zero perdidas, seis acrescentadas, 239 recursos rastreados, quatro imports verificados, 3.709 ms, RSS 297,7 MiB, heap 177,7 MiB**, `complete:false` por um import computado em `curso/semear-demonstracao.ts`.

### Novos riscos identificados (commits posteriores, CI pendente)

**Risco 1 — lote perigoso distribuído:** dois arquivos modificados podem compartilhar uma dependência intermediária; cada arquivo isoladamente pode parecer seguro, embora a atualização simultânea altere autorização/tenant/IA. O gate `changedRiskCouplings` agora forma componentes conectados sobre pares de imports reais do fork e sinaliza `unsafe_changed_dependency_chain` para qualquer candidato ligado transitivamente a arquivos do mesmo lote já classificados para revisão. A análise é conservadora em **ambas direções** da dependência. O teste usa `components/feature.ts` → `hooks/useFlag.ts` → `components/shared.ts` (cadeia de importação) conectada a mudanças perigosas em `components/unsafe.ts` (RBAC), `components/tenant-policy.ts` (tenant) e `components/ai-policy.ts` (grant IA). Exige bloqueio do candidato relacionado, preservação das três políticas e preparação exclusiva de `components/ordinary.ts`.

**Risco 2 — ligação criada somente no target upstream:** o grafo do fork não detecta imports que ainda não existiam em sua versão. O gate `newUnsafeImportSignals` examina a diferença de imports base→target do candidato; um import recém-introduzido para outro arquivo perigoso alterado no lote gera `unsafe_changed_import_edge` e impede `safe_to_prepare`. Aplica resolução configurada por `tsconfig.paths` para aliases e falha fechado quando a nova referência local não puder ser resolvida. Testes cobrem import novo direto `@/components/unsafe` e alias `#risk/*` → `components/*`.

### Matriz de aceitação

| Propriedade | Resultado esperado | Evidência observada | Estado |
| --- | --- | --- | --- |
| Um arquivo contém UI legítima e bypass RBAC | Bloqueio atômico, sem patch parcial | Teste #50 no run 42134125381 PASS | **Demonstrado em fixture** |
| Correção local ELUS em trecho distinto | `conflict_requires_review` e conteúdo ELUS intacto | Teste #50 PASS | **Demonstrado em fixture** |
| Somente melhoria independente entra em `preparedFiles` | Exatamente um arquivo, checkout e HEAD preservados | Teste #50 PASS | **Demonstrado em fixture** |
| Lote com regressões RBAC, tenant e IA ligadas por hook | `unsafe_changed_dependency_chain`, nenhum arquivo relacionado preparado | Fixture adicional publicada, CI não executada/confirmada | **Pendente** |
| Import novo no target para arquivo do lote inseguro | `unsafe_changed_import_edge`; candidato bloqueado | Fixture adicional publicada, CI não executada/confirmada | **Pendente** |
| Alias configurado conecta novo import a arquivo inseguro | Alvo inferido pelo TS, candidato bloqueado | Fixture `#risk/*` publicada, CI não executada/confirmada | **Pendente** |
| Candidato independente do lote perigoso | Preparação em worktree isolada | Fixture adicional publicada, CI não executada/confirmada | **Pendente** |
| Import computado em código do fork | `complete:false`, bloqueio | Benchmark real e testes anteriores PASS | **Demonstrado como bloqueio** |
| Atualização oficial real DeskcommCRM | Contratos ELUS preservados em runtime | Não realizada | **Não demonstrado** |

**Limites de cobertura:** a conectividade transitiva do lote é intencionalmente conservadora e pode bloquear candidatos legítimos em grandes componentes compartilhados (falso positivo). Não detecta todas as ligações de runtime, reflection, chamadas remotas ou efeitos sem imports estáticos; o segundo gate para imports novos do target reduz, mas não elimina, falsos negativos. Os testes usam Git temporário com SHAs pinados e não substituem validações negativas de auth/RLS/IA ou um release oficial. A PR permanece Draft, sem merge, deploy ou mudanças de banco. Hindsight `Elus360` permanece com sincronização pendente se as tentativas continuarem `UNAVAILABLE`.

## Gate distribuído GREEN e casos de exclusão/renomeação (06/11/2026 UTC)

A execução [42135722415](https://github.com/OARANHA/elus360/actions/runs/42135722415) no HEAD `cde978cdb9dc094437dc70976ceed4f0a86f5814` concluiu **SUCCESS** no job `contrato-upstream`: **12/12 testes de preparação PASS**, **53/53 operacionais PASS**. Evidência individual: #51 `mudancas perigosas distribuidas por arquivos e importacao transitiva bloqueiam candidato ligado, mas nao independente` **PASS**; #52 `import novo somente no upstream aponta a arquivo perigoso e impede a promocao do consumidor` **PASS**; #53 `alias configurado novo aponta para arquivo modificado e perigoso, sem depender do grafo anterior` **PASS**. Esses testes demonstram, em fixtures, os sinais `unsafe_changed_dependency_chain` e `unsafe_changed_import_edge` e a elegibilidade do candidato independente. Benchmark do merge `7d69ae2aaafe3b77c3a37962bb020a67ef24bb7c`: 3.194 fontes, 15.290 arestas, 15.284 anteriores preservadas, zero perdidas, seis adicionadas, 6.456 ms, RSS 297,2 MiB, heap 190,0 MiB, `complete:false` com um import computado.

### Cobertura adicional: dependência compartilhada, exclusão e renomeação

Após esse GREEN, foram publicados **dois novos testes de integração em repositórios Git temporários**, ainda **sem execução confirmada na CI**:

| Alteração upstream | Candidato relacionado | Esperado na worktree detached | Independente |
| --- | --- | --- | --- |
| Exclusão de `hooks/shared.ts`, antes importado pelo componente | `components/safe.tsx` → `unsafe_changed_dependency_chain` / `contract_requires_review` | Preservar o hook e a versão anterior do componente; não aplicar exclusão | `components/independent.ts` continua `safe_to_prepare` |
| Renomeação `components/old-policy.ts`→`components/new-policy.ts` com relaxamento de autorização | `components/safe.tsx` introduz import para o novo arquivo → `unsafe_changed_import_edge` / `contract_requires_review` | Preservar política antiga; não introduzir nova implementação sem revisão | `components/ordinary.ts` continua `safe_to_prepare` |

Ambos exigem `preparedFiles=1`, conteúdo protegido intacto e `git status --porcelain` vazio na origem. Renomeações são tratadas por `git diff --no-renames` como exclusão + adição, não como identidade implicitamente preservada. **Não foram atualizadas versões reais do DeskcommCRM.**

### Matriz consolidada de riscos

| Categoria | Mecanismo | Evidência | Limite |
| --- | --- | --- | --- |
| Falso negativo: nova aresta para módulo inseguro | `newUnsafeImportSignals` | #52 e #53 PASS | Imports computados e efeitos de runtime exigem bloqueio separado |
| Falso negativo: regressão distribuída via hook compartilhado | `changedRiskCouplings` | #51 PASS | Conectividade é baseada em grafo AST pinado |
| Falso negativo: módulo compartilhado excluído | `deletion_requires_review` + cadeia de risco | Fixture publicada, CI pendente | Mudança pode exigir migração manual de importadores |
| Falso negativo: módulo renomeado e autorização relaxada | Exclusão + adição + import novo inseguro | Fixture publicada, CI pendente | Renomeações legítimas também são revisadas conservadoramente |
| Falso positivo: grande componente conectado do grafo | Bloqueio conservador bidirecional | Possibilidade arquitetural; não quantificada | Exige avaliação de taxa de bloqueios legítimos em lotes reais |
| Falso positivo: módulo exportado muda apenas formatação | Comparação textual AST | Possibilidade; não quantificada | Não autoriza promoção só por equivalência aparente |
| Falso negativo: autorização, RLS, IA fora da análise estática | Testes negativos de runtime ainda necessários | Não verificado em release real | Gate funcional permanece bloqueado |

**Aceite atual:** Gate 1 GREEN para os testes até #53; os novos cenários de exclusão/renomeação exigem confirmação própria de CI. Nem o GREEN anterior nem a preservação de arestas autorizam merge/deploy/banco. Hindsight `Elus360` segue com sincronização pendente enquanto o conector retornar `UNAVAILABLE`.

## Gate Exclusão/Renomeação — RED 42136704565, correção específica

**Fonte:** Gerente de IA confirmou [run 42136704565](https://github.com/OARANHA/elus360/actions/runs/42136704565) RED no HEAD `58599f5a363a381a650bc53c64eb71724fa8bac1`: instalação e verificação sintática PASS, **54/55** testes operacionais PASS, benchmark SKIPPED. Teste #54 em `tests/operational/elus-upstream-reconcile.test.mjs` esperava `deletion_requires_review` ao excluir `hooks/shared.ts`; o resultado real foi `protected_requires_review`. Teste #55 de renomeação PASS.

**Diagnóstico por leitura do classificador:** `impact("hooks/shared.ts")` é `unclassified` porque `hooks/` está fora da allowlist de caminhos preparáveis (`SAFE`), e `statusFor` aplica `protected_requires_review` a domínios `unclassified` **antes** da regra geral de exclusão. Isso é comportamento de proteção intencional: a exclusão continua indisponível para `safe_to_prepare`. Outras exclusões ordinárias continuam recebendo `deletion_requires_review`, inclusive a fixture já testada `app/app/delete.tsx`. Alterar a precedência global sem uma decisão de contrato criaria mudança desnecessária em segurança.

**Correção minimalista publicada:** a asserção do teste #54 agora espera `protected_requires_review`, verifica `impact:unclassified` e exige status distinto de `safe_to_prepare`. Nenhum código de produção, regra de autorização, resolvedor, política de exclusão, `prepare` ou banco foi alterado. O teste continua exigindo que consumidores da dependência removida recebam revisão, que somente o arquivo independente seja preparado e que o hook excluído permaneça íntegro no worktree isolado.

**Validação pendente:** a CI do novo HEAD ainda não foi confirmada. Para aceite deste RED específico, são necessários os **55/55 operacionais** e **12/12 de preparação** PASS no mesmo HEAD, além do benchmark. Não atribuir GREEN ao commit corretivo antes da execução. A sincronização Hindsight `Elus360` deve permanecer marcada como pendente enquanto a ferramenta retornar `UNAVAILABLE`.

## Ensaio com tags oficiais DeskcommCRM v1.94.0 → v1.95.0 (06/11/2026 UTC)

**Escopo real, somente leitura.** Fonte oficial: `melgarafael/DeskcommCRM`. A tag Git anotada `v1.94.0` aponta para o commit `ba24d4d366b7caf056b88553e0ed434cb0fb46de` (tagger 27/10/2026); `v1.95.0` aponta para `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36` (tagger 30/10/2026). Referência do fork: HEAD da PR #20 `306af520be45689388b293128c0d7d4ebb7f717b`. Todas as referências foram consultadas por objetos/árvores da API GitHub, sem inferir SHA de changelog ou memória. As três consultas `git/trees/<SHA>?recursive=1` retornaram `truncated:false`.

**Resultado da reconciliação triádica de blobs (base, target, fork):**

| Medida | Contagem |
| --- | ---: |
| Caminhos alterados entre releases oficiais | **787** |
| Modificados / adicionados / excluídos no upstream | **470 / 315 / 2** |
| Blob do fork idêntico ao da base histórica nos caminhos alterados | **777** |
| Caminhos com divergência local frente à base histórica | **10** |
| Arquivos já iguais ao target, nos caminhos alterados | **0** |
| `protected_requires_review` por domínio/caminho (preliminar) | **235** |
| `contract_requires_review` por domínio/caminho (preliminar) | **191** |
| `conflict_requires_review` por SHA local divergente (preliminar) | **7** |
| Caminhos ordinários ainda exigindo AST, sinais, dependências e análise de lote | **354** |
| Arquivos autorizados para `safe_to_prepare` | **0 comprovados** |

As quatro últimas categorias são uma **pré-classificação conservadora por SHA e domínio**, equivalente à precedência conhecida de `impact`/`statusFor`, mas **não representam uma execução do `reconcile plan` completo**. Os 354 candidatos potenciais **não** foram autorizados: é necessário analisar seus conteúdos, contratos, imports novos, consumidores protegidos e interação com outras alterações. O grafo do fork reportado pelo Gate 1 ainda possui `complete:false`, por um `computed_module_specifier` em `curso/semear-demonstracao.ts`; portanto, no estado comprovado, não há base para preparar arquivo algum automaticamente.

**Dez divergências locais que exigem proteção explícita** (todos os três blobs consultados são diferentes, salvo onde a versão do fork não contém o arquivo):

| Caminho | Classificação preliminar | Risco |
| --- | --- | --- |
| `.env.example` | `protected_requires_review` | Configuração local distinta |
| `.github/workflows/e2e.yml` | `protected_requires_review` | Workflow ausente do fork; não reintroduzir sem revisão |
| `app/api/v1/cron/sync-model-catalog/route.ts` | `conflict_requires_review` | Catálogo de modelos e runtime |
| `app/app/ai/agents/[id]/_components/AgentForm.tsx` | `conflict_requires_review` | Configuração de agente / UI ELUS |
| `lib/agent-engine/edge/llm/providers.ts` | `conflict_requires_review` | Provedores de IA |
| `lib/ai/credenciais/guardar.ts` | `conflict_requires_review` | Proteção de credenciais |
| `lib/ai/credenciais/login-codex.ts` | `conflict_requires_review` | Fluxo de autenticação de credenciais |
| `lib/ai/runtime/agent.ts` | `conflict_requires_review` | Execução dos agentes |
| `lib/audit/actions.ts` | `conflict_requires_review` | Auditoria |
| `supabase/baseline.sql` | `protected_requires_review` | Divergência de esquema; operações no banco proibidas |

**Outras superfícies upstream a revisar antes da preparação:** arquivos modificados em autenticação Google e senha, MFA, `app/actions/settings/updateTenant.ts`, rotas administrativas de tenant, `app/api/v1/ai/providers/[provider]/models/route.ts`, `app/api/v1/ai/routers/[id]/route.ts` e Inbox. Seus blobs do fork ainda correspondem à base, mas isso não significa compatibilidade de comportamento, governança de IA ou isolamento. A comparação oficial via API de commits informa 431 commits, porém retorna somente 300 entradas de arquivo; **o inventário de 787 deriva da diferença das árvores Git completas**, não do limite da resposta de compare.

**Reprodução autorizável em checkout local descartável que disponha de todos os objetos dos três SHAs** (comando a executar, **não executado neste ambiente**):

```bash
node scripts/elus-upstream-reconcile.mjs plan --base ba24d4d366b7caf056b88553e0ed434cb0fb46de --target ca37cb7f2a35c1a0f6abc968139dd263b20ccb36 --fork 306af520be45689388b293128c0d7d4ebb7f717b
```

O ambiente de execução atual não consegue clonar GitHub (sem DNS externo) e não possui o repositório íntegro com esses objetos. Por isso, **não se alegou execução do programa `plan`, do AST sobre 787 mudanças, nem criação de worktree**. A operação realizada foi comparação real **read-only** dos inventários completos de objetos Git via conector GitHub. **Decisão de segurança:** sem candidatos comprovados, `prepare` não foi executado; nenhum arquivo do DeskcommCRM foi aplicado. Essa distinção impede que um relatório parcial seja confundido com aceite funcional.

**Próximo bloqueio a resolver:** executar `plan` em checkout efêmero que contenha os três commits, capturar `totals`, `files[]`, sinais semânticos, `dependency_scan` e evidência de ausência de sobrescrita de customizações. Somente se houver `safe_to_prepare` após todos os gates será admissível criar worktree descartável. Ainda são pendentes testes negativos em runtime para auth, RBAC, multi-tenancy, agentes e credenciais. PR #20 continua Draft; nenhum merge, deploy ou operação no banco foi feito. A sincronização no Hindsight `Elus360` continua pendente enquanto indisponível.

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

## Ensaio independente de referências oficiais — 06/11/2026 UTC

**Checkpoint verificado:** PR #20 Draft, HEAD `d470ff5695b76198c2187a775b7ab30b87745ea0` antes desta atualização documental, base `main` `749aaf8fbb25b46dddd9138219e2ac032cc83336`. O workflow [Gate 1 #42138997558](https://github.com/OARANHA/elus360/actions/runs/42138997558) concluiu `completed/success` **nesse HEAD**, job `contrato-upstream` `success`. São **12 testes de preparação e 55 operacionais PASS**; nenhum check posterior é inferido após a edição deste documento.

**Proveniência Git:** tag anotada oficial `v1.94.0` (objeto `9b20e5983de83dadadd62cb43d68ff55c5336247`) aponta para commit `ba24d4d366b7caf056b88553e0ed434cb0fb46de` (tree `a337f7a1ea64c9bbe4d13cb82a25f17401f03616`); tag `v1.95.0` (objeto `317229a9f5e25a310fafc7e9f42e93e14d2bd7fe`) aponta para `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36` (tree `8253470b44c82323912e352615ea385e69965012`). Fork `main` usa tree `d5691861a3c39668dcabc4ed62046fd13259936b`. Três Git Trees recursivas retornaram `truncated=false`. A API de comparação verificou `ahead_by=431`, `behind_by=0`.

**Inventário integral independente:** 787 caminhos alterados entre releases; pré-classificação de `impact/statusFor`: 235 `protected_requires_review`, 191 `contract_requires_review`, 7 `conflict_requires_review`, 354 candidatos à análise AST e **zero `safe_to_prepare` comprovado**. A matriz nominal completa, com 787 caminhos e legenda, está no [comentário auditável da PR #20](https://github.com/OARANHA/elus360/pull/20#issuecomment-6673810443). É uma comparação de blobs/caminhos; **não foi executado o `reconcile plan` completo** e não se atribui aos 354 arquivos aprovação semântica.

**Dez divergências locais observadas:** `.env.example`, `.github/workflows/e2e.yml`, `supabase/baseline.sql`, `app/api/v1/cron/sync-model-catalog/route.ts`, `app/app/ai/agents/[id]/_components/AgentForm.tsx`, `lib/agent-engine/edge/llm/providers.ts`, `lib/ai/credenciais/guardar.ts`, `lib/ai/credenciais/login-codex.ts`, `lib/ai/runtime/agent.ts` e `lib/audit/actions.ts`. Nenhum pode ser substituído automaticamente. Preservar catálogo Chutes, controle de providers/modelos e credenciais no backend, RPC guardada, autonomia de IA, callbacks/runtime, eventos de auditoria próprios, SQL e workflows do fork.

**AST real do Gate 1:** benchmark no merge sintético `cc1ca4cb93bb6664ae30a057e8c83a722dcfbe6c`: 3.194 fontes, 15.290 arestas, zero arestas anteriores perdidas, `complete:false` com um `computed_module_specifier` em `curso/semear-demonstracao.ts`. Pelo reconciliador, incompletude significa `dependency_analysis_incomplete` e bloqueia promoção automática de todos os candidatos ordinários. Corrigir ou delimitar de modo comprovado a causa antes de `prepare`.

**Mudanças v1.95.0 para avaliação manual:** anexos arrastados com prévia/guardrails no Inbox; ferramentas MCP externas configuráveis por agente; descoberta Models.dev; preservação dos modelos disponíveis na renovação Codex; eventos de auditoria ampliados; seleção de endereço WhatsApp por última mensagem. Não há aceite de incorporação: testes negativos de auth, RBAC, RLS multi-tenant, governança de IA, mensageria e schema ainda faltam.

**Reprodução pendente com todos os objetos Git presentes localmente** (não executada neste ambiente sem DNS para clone):

```bash
node scripts/elus-upstream-reconcile.mjs plan --base ba24d4d366b7caf056b88553e0ed434cb0fb46de --target ca37cb7f2a35c1a0f6abc968139dd263b20ccb36 --fork 749aaf8fbb25b46dddd9138219e2ac032cc83336
```

O retorno esperado a capturar é `totals`, `files[]`, `signals`, `suggested_checks`, `dependency_scan`, `protected_importers` e impacto de lote. Não houve checkout completo, CLI `plan`, `prepare`, merge, deploy ou escrita no Supabase. Consulta de branch protection de `main` retornou **403** (`Resource not accessible by integration`); rulesets `[]` não comprova ausência de checks obrigatórios. Hindsight `Elus360` retornou **UNAVAILABLE** em `recall` e `search_knowledge_base`; nenhuma gravação nele foi alegada. **Estado funcional: NO-GO.**


## Gate 3 — cobertura AST diagnostica do ensaio oficial real (06/11/2026 UTC)

### Evidência medida no Gate anterior

A execução [42142957604](https://github.com/OARANHA/elus360/actions/runs/42142957604) corresponde ao HEAD \`5239ba9357bc69d9eee1db6d20f6d84a89f23e63\`. O GitHub confirmou os jobs \`contrato-upstream\` e \`Ensaio oficial de reconcile plan (read-only)\` como \`completed/success\`. O artefato \`elus360-official-reconcile-plan\` (ID **13469630347**) foi baixado e os arquivos \`plan.json\`, \`matrix-787.csv\`, \`summary.md\` e \`provenance.txt\` tiveram seus hashes SHA-256 verificados contra \`SHA256SUMS\`.

**Medição do \`plan\` real** (não preparação): 787 alterações, \`protected_requires_review=235\`, \`contract_requires_review=545\`, \`conflict_requires_review=7\`, \`safe_to_prepare=0\`, \`gate=manual_review_required\`. Na matriz preliminar 354 arquivos tinham domínio \`application_code\` e correspondência de blob com a base, mas **todos os 354** foram bloqueados por sinais estáticos ainda antes do grafo. A implementação retornava \`dependency_scan: {scanned:0,complete:true,unresolved_count:0}\` porque \`inspectForkDependencies\` recebia somente os arquivos *já* classificados \`safe_to_prepare\` e tinha um retorno antecipado para a lista vazia. **Esse \`complete:true\` não significava AST executado**; o gate permaneceu fail-closed por não haver nenhum \`safe_to_prepare\`.

Sinais presentes nos 354 inicialmente ordinários, por arquivo (categorias sobrepostas; não somar):

| Sinal | Ocorrências |
| --- | ---: |
| \`test_change_requires_review\` | 184 |
| \`tenant_isolation\` | 175 |
| \`module_initialization_change\` | 171 |
| \`exported_contract_change\` | 156 |
| \`protected_module_import_change\` | 146 |
| \`messaging_events\` | 123 |
| \`sensitive_import\` | 102 |
| \`managed_ai\` | 71 |
| \`authentication_authorization\` | 55 |
| \`agent_runtime\` | 13 |
| \`exported_module_internal_change\` | 11 |
| \`uninspectable_content\` | 1 |
| \`dependency_analysis_incomplete\` | 1 |

**Interpretação técnica, sem liberar candidatos:** os 184 arquivos de testes continuam exigindo revisão de integridade. O sinal \`exported_contract_change\` sinaliza diferença textual das declarações exportadas; exige verificar comportamento/contratos, mas não prova uma regressão. O sinal lexical \`tenant_isolation\` é encontrado no texto concatenado de antes e depois; pode se referir a uma ocorrência *retida* em código que não alterou o controle de tenant. \`protected_module_import_change\` também percorre imports das versões antiga e nova, não apenas imports introduzidos; o nome não deve ser confundido com uma prova de que a aresta mudou. \`module_initialization_change\` pode representar corpo alterado de fixture ou efeito real e segue bloqueante. O \`uninspectable_content\` foi observado em \`lib/database.types.ts\`, acima do orçamento de 512 KiB para inspeção de conteúdo do delta; requer gate manual, sem truncamento silencioso.

### Instrumentação adicionada na PR #20

1. O reconciliador passa a registrar \`preliminary_status\` por caminho, calculado antes dos sinais, e \`candidate_analysis\` separado do status final. Para cada candidato preliminar, registra origem lexical de sinais (\`retained\`, \`introduced\`, \`removed\`), resultado da inspeção de contratos do arquivo, presença na árvore do fork, consumidores protegidos (contagem + amostra limitada) e conexões com alterações já bloqueadas (contagem + amostra).
2. A inspeção de dependências passa a receber **todos os candidatos preliminares** mesmo que todos já estejam bloqueados por heurísticas ou AST de arquivo. O relatório publica \`dependency_scan.executed\`, \`not_run_reason\`, \`scanned\`, \`complete\` e \`unresolved_count\` separadamente. **Lista vazia retorna \`executed:false\`, \`complete:null\`, não \`true\`**. Falhas de leitura/orçamento continuam \`complete:false\` e não autorizam preparação.
3. \`candidate_coverage\` separa o total preliminar, varreduras de contrato avaliadas/inconclusivas, bloqueio anterior ao grafo, presença/ausência de fontes no fork, dependentes protegidos, acoplamento com lote inseguro e status finais. Estes campos são **diagnósticos**; não alimentam \`statusFor\` para afrouxar bloqueios.
4. O job de ensaio oficial passa a exigir um grafo efetivamente executado quando houver candidatos preliminares, inclusive com zero aprovados. Publica \`ast-coverage-354.json\`, \`plan.json\`, \`matrix-787.csv\` estendida, \`summary.md\`, \`provenance.txt\` e \`SHA256SUMS\` no artefato. O teste de segurança do job reprova \`safe_to_prepare\` sempre que \`complete\` não for estritamente \`true\`.

### Preservação das dez divergências ELUS

A classificação e os sinais abaixo foram extraídos do \`plan.json\` da execução **42142957604**, não presumidos por nome de arquivo. Status mantidos, e nenhum foi preparado:

| Caminho | Status real | Sinais observados e gate de revisão |
| --- | --- | --- |
| \`.env.example\` | \`protected_requires_review\` | \`non_source_asset\`, \`tenant_isolation\`, \`managed_ai\`, \`agent_runtime\`, \`messaging_events\`; preservar variáveis Chutes e defaults |
| \`.github/workflows/e2e.yml\` | \`protected_requires_review\` | \`non_source_asset\`, \`tenant_isolation\`, \`authentication_authorization\`, \`managed_ai\`, \`agent_runtime\`, \`messaging_events\`; workflow ausente no fork, não reintroduzir |
| \`app/api/v1/cron/sync-model-catalog/route.ts\` | \`conflict_requires_review\` | \`tenant_isolation\`, \`managed_ai\`, \`sensitive_import\`, \`exported_module_internal_change\`, \`protected_module_import_change\`; preservar catálogo Chutes separado de Models.dev |
| \`app/app/ai/agents/[id]/_components/AgentForm.tsx\` | \`conflict_requires_review\` | \`managed_ai\`, \`agent_runtime\`, \`messaging_events\`, \`sensitive_import\`, \`exported_contract_change\`, \`protected_module_import_change\`; preservar defaults/autonomia IA ELUS |
| \`lib/agent-engine/edge/llm/providers.ts\` | \`conflict_requires_review\` | \`managed_ai\`, \`messaging_events\`, \`exported_contract_change\`, \`protected_module_import_change\`; preservar provider Chutes |
| \`lib/ai/credenciais/guardar.ts\` | \`conflict_requires_review\` | \`tenant_isolation\`, \`managed_ai\`, \`sensitive_import\`, \`exported_contract_change\`, \`protected_module_import_change\`; preservar RPC guardada |
| \`lib/ai/credenciais/login-codex.ts\` | \`conflict_requires_review\` | \`tenant_isolation\`, \`managed_ai\`, \`sensitive_import\`, \`exported_contract_change\`, \`protected_module_import_change\`; preservar renovação local e revisar \`manterModelos\` |
| \`lib/ai/runtime/agent.ts\` | \`conflict_requires_review\` | \`tenant_isolation\`, \`managed_ai\`, \`agent_runtime\`, \`messaging_events\`, \`sensitive_import\`, \`exported_contract_change\`, \`protected_module_import_change\`; preservar Chutes, roteamento e isolamentos |
| \`lib/audit/actions.ts\` | \`conflict_requires_review\` | \`tenant_isolation\`, \`messaging_events\`, \`exported_contract_change\`; preservar eventos administrativos próprios ELUS |
| \`supabase/baseline.sql\` | \`protected_requires_review\` | \`non_source_asset\`, \`uninspectable_content\`; jamais substituir/aplicar baseline sem gate de banco independente |

### Testes e estado do Gate 3

Foram publicados quatro testes adversariais em \`tests/operational/elus-upstream-reconcile.test.mjs\` para exigir: (i) análise do grafo mesmo sem \`safe_to_prepare\`; (ii) import computado ainda devolve \`complete:false\` e zero preparo; (iii) ausência real de candidato declara grafo **não executado** com \`complete:null\`; e (iv) distinguir sinal lexical herdado de introduzido sem remover bloqueio. Os cenários anteriores de mutações distribuídas, dependências, exclusões, renomeações, tenants, IA e credenciais permanecem.

**Estado:** implementado em branch da PR #20, sem declarar execução/testes GREEN do novo HEAD antes da CI correspondente. A instrumentação não prova equivalência semântica; candidatos com indícios legítimos ou falsos positivos permanecem bloqueados. Pendente leitura do artefato novo para medir efetivamente cobertura de AST, distinguir bloqueios contextuais e preparar recomendações **somente de revisão**, nunca patches automáticos. Hindsight \`Elus360\` respondeu \`UNAVAILABLE\` em \`recall\` e KB nesta rodada; checkpoint versionado preserva a continuidade até nova sincronização.

**Restrições:** PR Draft, sem \`prepare\`, merge, deploy, publicação de imagem, alteração de schema/banco ou incorporação da v1.95.0.
