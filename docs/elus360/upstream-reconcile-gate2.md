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
