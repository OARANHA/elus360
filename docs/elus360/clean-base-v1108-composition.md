# ELUS360 — composição real com DeskcommCRM v1.108.0 (PR #37)

Estado: **IMPLEMENTADO EM PR / VALIDAÇÃO DA ÁRVORE COMPOSTA PENDENTE**. Nenhum merge, release, deploy, DDL ou acesso a dados de cliente.

## Trabalho realizado

A PR deixa de apenas classificar o overlay e passa a produzir um **segundo artefato**: worktree com a árvore oficial limpa v1.108.0, o delta independente ELUS (393 caminhos **no artifact anterior**, número sujeito a revisão após os novos commits) e oito adaptadores explicitamente versionados e limitados por SHA de blob oficial. A etapa de composição preserva o patch original da preparação e cria `elus360-composed.patch` e `elus360-composed-report.json`. Divergência de SHA, patch original, lista de caminhos ou âncora causa falha antes de qualquer escrita de adaptadores.

| Caminho | Composição pontual | Invariante upstream preservado |
| --- | --- | --- |
| `app/app/ai/agents/_components/AgentsList.tsx` | Prop ELUS `mostrarModelo` repassada ao `AgentCard` | O filtro extraído `filtrarAgentes` permanece oficial |
| `lib/agent-engine/env.ts` | `CHUTES_API_KEY` opcional no schema do worker | Controle de polling/recuo oficial |
| `lib/env.ts` | `CHUTES_API_KEY` opcional para servidor | Novo teto de cadência de e-mails |
| `lib/audit/actions.ts` | `platform_admin.ai_autonomy_updated` e `platform_admin.ai_default_updated` | Novos eventos de auditoria oficiais permanecem |
| `.env.example` | Chave Chutes e default de IA ELUS documentados | Parâmetros e avisos operacionais oficiais permanecem |
| `package.json` | Script `test:operational` ELUS | Dependências, scripts oficiais e lockfile oficiais preservados |
| `app/app/ai/agents/[id]/_components/AgentForm.tsx` | 25 adaptações de governança por autonomia técnica, defaults de modelo/credencial e visibilidade por concessão | Form oficial 1.927 linhas, voz, agenda, aviso de funil, aviso de handoff, rolagem de chegada |
| `lib/i18n/dicionario.ts` | Adiciona **48 traduções exclusivas** do fork com verificação de colisões e blob pinado | Mantém as 1.079 linhas oficiais adicionadas e os módulos de cadências, contratação e linguagem do agente |

**Gate do adaptador:** todos os oito caminhos devem constar como `both_changed` no inventário; blobs devem ser os oito SHA Git fixados; o patch original deve bater **bytes, SHA-256 e conjunto de caminhos** com o relatório da montagem. O worktree deve estar em HEAD detached da release oficial. Se qualquer pré-condição divergir, operação falha fechada.

## Testar a aplicação composta — e não o fork antigo

O workflow `.github/workflows/elus360-clean-base-candidate.yml` na PR #37 agora executa no **worktree composto** (`$RUNNER_TEMP/elus360-official-clean`):
1. `pnpm install --frozen-lockfile` sobre `package.json` e lockfile da v1.108.0, sem editar o fork;
2. `pnpm typecheck` sobre código composto, incluindo TypeScript da aplicação;
3. `pnpm exec vitest run` para governança ELUS, credenciais Chutes, autorização de edição de versões;
4. `pnpm build` para Next.js composto, sem publicação de imagens.
5. Grava `elus360-composed-validation.json` com o estado de **cada** gate; reprova CI se um falhar. O job publica artifacts mesmo em falha.

O workflow de preparação já tinha passado no HEAD anterior, **mas isso não conta como resultado dos testes acima**, que só existirão quando executados no HEAD atual.

## Pendências bloqueantes

- A execução real do workflow 43173103091 verificou **400 caminhos reaplicados + 6 adaptadores, 144 pendências**, 9/9 testes operacionais, 41/41 governança. TypeScript falhou por OOM; o build compilou mas reprovou por TS2322 (AgentForm ausente). Agora existe um sétimo adaptador para AgentForm; previsão de 143 pendências, **ainda não comprovada** no novo SHA. `lib/i18n/dicionario.ts`, `baseline.sql`, instalador e CI continuam em revisão.
- `AgentForm.tsx` recebeu transposição semântica pontual (25 alterações com blob pinado, não substituição integral). Falta comprovar TypeScript, build e comportamento de UI no novo worktree. A governança no servidor é uma validação independente, não substituída pela visibilidade do formulário.
- `lib/i18n/dicionario.ts` foi recuperado integralmente via GitHub Git Blob API (o caminho `fetch_file` retornava vazio por tamanho). O oitavo adaptador adiciona apenas 48 chaves exclusivas ELUS, sem colisão com 12.388 chaves diretas verificadas no oficial. Conflito resolvido em script, pendente de teste no worktree.
- `supabase/baseline.sql` e migrations: sem upgrade seguro com dados e sem regressão RLS não há release.
- `hostgator-setup-kit/_common.sh` e `update.sh`: segurança de origem, AMD64 e rollback ELUS devem coexistir com os reparos oficiais. Não fazer builds na VPS.
- CI da árvore composta **não substitui E2E real do produto instalado** nem ensaio de instalação limpa/upgrade com dados.
- `COMPOSED_TECHNICAL_CHECKS_PASSED`, caso obtido, indica somente typecheck, build e unitários selecionados; release continua `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.

**Próximo gate:** verificar CI do SHA exato por ocasião do retorno green/red; ler artefatos da árvore composta, corrigir falhas específicas e resolver os adaptadores restantes com testes de segurança de produto. Previsão atual após oito adaptadores: **142 conflitos não resolvidos**, ainda sem comprovação em artifact desta nova versão.

## Ciclo após o workflow #17 (12/11/2026)

- Logs do job `131030826900` (run `43173103091`): montador e seis adaptadores passaram, instalação frozen passou, **9/9 testes operacionais e 41/41 testes de governança** passaram. `pnpm typecheck` encerrou com `FATAL ERROR: Ineffective mark-compacts near heap limit` e status 134; `pnpm build` compilou mas falhou com **dois TS2322** em `AgentTabs.tsx:95` e `new/page.tsx:73` pelo `AgentForm` sem contrato de autonomia/defaults do fork.
- Remediação implementada: sétimo adaptador de `AgentForm` em `scripts/elus360-clean-base-adapters.mjs`, pinado no blob oficial `956e6ff33a369e2a9a7f5df3c8aae81125b49992`, 25 substituições/adições precisas. Verificada em simulação de transformação que preserva as linhas e referências oficiais de `RolagemDeChegada`, `VozDoAgente`, `FraseDoAviso`, `EscolhaQuandoHaCompromisso` e `aviso-vender-sem-funil`.
- Regra específica de memória: `NODE_OPTIONS=--max-old-space-size=4096` somente nos passos TypeScript e build no runner GitHub; não relaxa tests, timeouts, regras de negócio ou segurança.
- **CI deste novo lote ainda não verificado; não declarar aprovação.** Artifacts e resultados são por SHA exato.

## Ciclo de i18n — oito adaptadores (12/11/2026)

- Artefato **confirmado do workflow anterior**: run `43173103091`, ZIP `13923476564`, `elus360-clean-base-report.json` com 400 staged, 150 conflicts e `elus360-composed-report.json` com seis adaptações, 144 conflitos restantes. `PainelDoOperador.tsx` já estava em `staged` e não era conflito; não criar adaptador redundante.
- `lib/i18n/dicionario.ts`: `fetch_file` retornou conteúdo vazio para blobs de 1,5–1,7 MB, mas `fetch_blob` devolveu conteúdo íntegro. Comparados base `35128d288f690aeed671c88d95f52753d2d14032`, fork `d53989b17bf5b86f74deff07d5ee94653296828f`, oficial `7884118824fb6fb17b420e9038e1ede60dbe33b6`. O fork acrescentou 48 entradas novas agrupadas em dois blocos (página pública e governança de IA), **nenhuma colidiu com chaves diretas oficiais**. Outras diferenças de tradução preexistentes permanecem na versão oficial, sem sobrescrita silenciosa.
- O adaptador usa o OID `7884118824fb6fb17b420e9038e1ede60dbe33b6` e substituição ancorada exclusivamente no fechamento do dicionário. Proteções: pré-condição `both_changed`, blob oficial fixado, âncora única, teste de unicidade e contagem 48 e gate de composição que confere módulos oficiais importados, texto do idioma do agente e painel do Operador com permissão técnica.
- Estes checks estáticos **não demonstram** TypeScript/build/E2E da nova candidata, nem liberam release. Status continua `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.

## Ciclo de memória TypeScript — gate integral em shards (12/11/2026)

**Causa comprovada**: execução `43191496612`, job `131091664810`, TypeScript 6.0.3 e `NODE_OPTIONS=--max-old-space-size=4096`. O `tsc --noEmit -p tsconfig.typecheck.json` monolítico morreu após Mark-Compact de aproximadamente **4.04 GiB** (status 134). O build `next build` compilou e terminou TypeScript com sucesso; `tsconfig.json` exclui testes, enquanto `tsconfig.typecheck.json` os inclui expressamente. Logo, o build verde NÃO substitui a verificação de tipos de testes.

**Remediação em branch, pendente de CI**: `scripts/elus360-composed-typecheck.mjs` usa a API de `typescript` instalada no worktree composto para recuperar **exatamente** as raízes compiladas pelas duas configurações oficiais; valida `strict` e `noEmit`, produz uma partição de produção e 12 partições de testes (quando existem pelo menos 12 raízes extras). Todo arquivo raiz original pertence a **exatamente uma** partição; arquivos `.d.ts` globais são adicionados a todas as partições de testes. Para cada partição, gera `tsconfig` estendendo `tsconfig.typecheck.json`, alterando somente `files`, `include: []` e `incremental: false`; não altera `strict`, `skipLibCheck`, `noEmit`, resolução, plugins ou tipo. Executa `pnpm exec tsc --noEmit -p <config> --pretty false --extendedDiagnostics` em subprocessos independentes, sequencialmente e com heap de 4 GiB. O **primeiro erro de TypeScript ou falta de cobertura reprova** o workflow. Arquivo `elus360-composed-typecheck.json` registra versão TS, SHA-256 do conjunto original, número de raízes e resultado de cada subprocesso.

**Ensaios locais do método, sem substituir CI**: em fixture TypeScript 5.8.3 isolada, todos os shards retornaram sucesso com raízes completas. Inserida falha `TS2322: Type 'string' is not assignable to type 'number'` em arquivo `.test.ts`, o shard correspondente falhou com exit 2 e veredito `TYPES_SHARDED_FAILED`. Testes Node para cobertura determinística, raízes duplicadas, proteção contra omissões e distribuidor adicionados em `tests/operational/elus360-composed-typecheck.test.mjs`.

**Limite declarado**: a partição mantém todos os arquivos e checa seus tipos, mas não executa um único programa TypeScript gigante. Declarações globais `.d.ts` são compartilhadas; integração real e verificação de produção continuam como gates independentes. Não declarar equivalência perfeita entre todos os cruzamentos possíveis de programas TypeScript separados sem evidência adicional.

**Release**: ainda `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E` e CI do SHA corrente não foi consultada. Não remover o gate de build nem aprovar com 142 conflitos restantes.

## Ajuste do contexto Vitest compartilhado — RED após shards (12/11/2026)

**Evidência:** run `43215996766`, job `131175271916`, SHA `c843cd087635f8749b3048591cd926e2df9f334d`. A partição de produção passou com memória abaixo de 4 GiB, e `next build` concluiu com TypeScript GREEN. A partição `tests-08` falhou com `TS2339` para matchers DOM como `toBeInTheDocument`, `toHaveAttribute` e `toHaveTextContent`, em vários testes `.tsx`. Assim, o OOM do processo gigante foi evitado, mas faltava uma declaração de tipos distribuída pelo Vitest.

**Contrato encontrado no upstream real:** `vitest.config.ts` declara `setupFiles: ["./tests/setup/vitest.setup.ts"]`. Esse setup faz `import "@testing-library/jest-dom/vitest";` e amplia os tipos de `Assertion` utilizados por `expect(...)`. Não é um arquivo `.d.ts` e, portanto, não entrava na lista de declarações compartilhadas pelo particionador.

**Correção na branch:** `scripts/elus360-composed-typecheck.mjs` descobre o setup pelo arquivo de configuração Vitest da árvore composta, exige exatamente um caminho, verifica que ele pertence ao conjunto de arquivos do `tsconfig.typecheck.json`, é externo ao conjunto de produção, e realmente importa `@testing-library/jest-dom/vitest`. Reaproveita a mesma raiz como `sharedTestRoots` em todos os shards de teste. Essa repetição é **somente de contexto de tipos**: cada arquivo original continua possuindo apenas um `owned`, e o gate recusa qualquer divergência, raiz indevida, duplicata ou setup sem o import.

**Regressões:** `tests/operational/elus360-composed-typecheck.test.mjs` tem controles positivos e negativos para contexto distribuído, unicidade, vínculo com o setup real e ausência do import. O workflow exige `shared_type_context_in_every_test_shard=true` e `shared_test_type_context.length===1` no relatório, além de `TYPES_SHARDED_PASSED`, sem `continue` silencioso.

**Status:** implementação não implica CI GREEN: o HEAD do ajuste precisa passar testes de regressão, verificação TypeScript completa e build antes de considerar os gates técnicos concluídos. Release permanece NO-GO por conflitos remanescentes, banco, segurança e E2E da versão composta.
