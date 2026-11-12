# ELUS360 — composição real com DeskcommCRM v1.108.0 (PR #37)

Estado: **IMPLEMENTADO EM PR / VALIDAÇÃO DA ÁRVORE COMPOSTA PENDENTE**. Nenhum merge, release, deploy, DDL ou acesso a dados de cliente.

## Trabalho realizado

A PR deixa de apenas classificar o overlay e passa a produzir um **segundo artefato**: worktree com a árvore oficial limpa v1.108.0, o delta independente ELUS (393 caminhos **no artifact anterior**, número sujeito a revisão após os novos commits) e sete adaptadores explicitamente versionados e limitados por SHA de blob oficial. A etapa de composição preserva o patch original da preparação e cria `elus360-composed.patch` e `elus360-composed-report.json`. Divergência de SHA, patch original, lista de caminhos ou âncora causa falha antes de qualquer escrita de adaptadores.

| Caminho | Composição pontual | Invariante upstream preservado |
| --- | --- | --- |
| `app/app/ai/agents/_components/AgentsList.tsx` | Prop ELUS `mostrarModelo` repassada ao `AgentCard` | O filtro extraído `filtrarAgentes` permanece oficial |
| `lib/agent-engine/env.ts` | `CHUTES_API_KEY` opcional no schema do worker | Controle de polling/recuo oficial |
| `lib/env.ts` | `CHUTES_API_KEY` opcional para servidor | Novo teto de cadência de e-mails |
| `lib/audit/actions.ts` | `platform_admin.ai_autonomy_updated` e `platform_admin.ai_default_updated` | Novos eventos de auditoria oficiais permanecem |
| `.env.example` | Chave Chutes e default de IA ELUS documentados | Parâmetros e avisos operacionais oficiais permanecem |
| `package.json` | Script `test:operational` ELUS | Dependências, scripts oficiais e lockfile oficiais preservados |
| `app/app/ai/agents/[id]/_components/AgentForm.tsx` | 25 adaptações de governança por autonomia técnica, defaults de modelo/credencial e visibilidade por concessão | Form oficial 1.927 linhas, voz, agenda, aviso de funil, aviso de handoff, rolagem de chegada |

**Gate do adaptador:** todos os sete caminhos devem constar como `both_changed` no inventário; blobs devem ser os sete SHA Git fixados; o patch original deve bater **bytes, SHA-256 e conjunto de caminhos** com o relatório da montagem. O worktree deve estar em HEAD detached da release oficial. Se qualquer pré-condição divergir, operação falha fechada.

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
- `lib/i18n/dicionario.ts` exige diff íntegro (a API de conteúdo retornou string vazia apesar de blobs diferentes); não forçar mudança sem evidência.
- `supabase/baseline.sql` e migrations: sem upgrade seguro com dados e sem regressão RLS não há release.
- `hostgator-setup-kit/_common.sh` e `update.sh`: segurança de origem, AMD64 e rollback ELUS devem coexistir com os reparos oficiais. Não fazer builds na VPS.
- CI da árvore composta **não substitui E2E real do produto instalado** nem ensaio de instalação limpa/upgrade com dados.
- `COMPOSED_TECHNICAL_CHECKS_PASSED`, caso obtido, indica somente typecheck, build e unitários selecionados; release continua `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.

**Próximo gate:** verificar CI do SHA exato por ocasião do retorno green/red; ler artefatos da árvore composta, corrigir falhas específicas e resolver os adaptadores restantes com testes de segurança de produto.

## Ciclo após o workflow #17 (12/11/2026)

- Logs do job `131030826900` (run `43173103091`): montador e seis adaptadores passaram, instalação frozen passou, **9/9 testes operacionais e 41/41 testes de governança** passaram. `pnpm typecheck` encerrou com `FATAL ERROR: Ineffective mark-compacts near heap limit` e status 134; `pnpm build` compilou mas falhou com **dois TS2322** em `AgentTabs.tsx:95` e `new/page.tsx:73` pelo `AgentForm` sem contrato de autonomia/defaults do fork.
- Remediação implementada: sétimo adaptador de `AgentForm` em `scripts/elus360-clean-base-adapters.mjs`, pinado no blob oficial `956e6ff33a369e2a9a7f5df3c8aae81125b49992`, 25 substituições/adições precisas. Verificada em simulação de transformação que preserva as linhas e referências oficiais de `RolagemDeChegada`, `VozDoAgente`, `FraseDoAviso`, `EscolhaQuandoHaCompromisso` e `aviso-vender-sem-funil`.
- Regra específica de memória: `NODE_OPTIONS=--max-old-space-size=4096` somente nos passos TypeScript e build no runner GitHub; não relaxa tests, timeouts, regras de negócio ou segurança.
- **CI deste novo lote ainda não verificado; não declarar aprovação.** Artifacts e resultados são por SHA exato.
