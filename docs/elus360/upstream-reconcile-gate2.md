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
