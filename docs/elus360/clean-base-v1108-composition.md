# ELUS360 — composição real com DeskcommCRM v1.108.0 (PR #37)

Estado: **IMPLEMENTADO EM PR / VALIDAÇÃO DA ÁRVORE COMPOSTA PENDENTE**. Nenhum merge, release, deploy, DDL ou acesso a dados de cliente.

## Trabalho realizado

A PR deixa de apenas classificar o overlay e passa a produzir um **segundo artefato**: worktree com a árvore oficial limpa v1.108.0, 393 caminhos independentes ELUS, e seis adaptadores explicitamente versionados e limitados por SHA de blob oficial. A etapa de composição preserva o patch original da preparação e cria `elus360-composed.patch` e `elus360-composed-report.json`. Divergência de SHA, patch original, lista de caminhos ou âncora causa falha antes de qualquer escrita de adaptadores.

| Caminho | Composição pontual | Invariante upstream preservado |
| --- | --- | --- |
| `app/app/ai/agents/_components/AgentsList.tsx` | Prop ELUS `mostrarModelo` repassada ao `AgentCard` | O filtro extraído `filtrarAgentes` permanece oficial |
| `lib/agent-engine/env.ts` | `CHUTES_API_KEY` opcional no schema do worker | Controle de polling/recuo oficial |
| `lib/env.ts` | `CHUTES_API_KEY` opcional para servidor | Novo teto de cadência de e-mails |
| `lib/audit/actions.ts` | `platform_admin.ai_autonomy_updated` e `platform_admin.ai_default_updated` | Novos eventos de auditoria oficiais permanecem |
| `.env.example` | Chave Chutes e default de IA ELUS documentados | Parâmetros e avisos operacionais oficiais permanecem |
| `package.json` | Script `test:operational` ELUS | Dependências, scripts oficiais e lockfile oficiais preservados |

**Gate do adaptador:** todos os seis caminhos devem constar como `both_changed` no inventário; blobs devem ser os seis SHA Git fixados; o patch original deve bater **bytes, SHA-256 e conjunto de caminhos** com o relatório da montagem. O worktree deve estar em HEAD detached da release oficial. Se qualquer pré-condição divergir, operação falha fechada.

## Testar a aplicação composta — e não o fork antigo

O workflow `.github/workflows/elus360-clean-base-candidate.yml` na PR #37 agora executa no **worktree composto** (`$RUNNER_TEMP/elus360-official-clean`):
1. `pnpm install --frozen-lockfile` sobre `package.json` e lockfile da v1.108.0, sem editar o fork;
2. `pnpm typecheck` sobre código composto, incluindo TypeScript da aplicação;
3. `pnpm exec vitest run` para governança ELUS, credenciais Chutes, autorização de edição de versões;
4. `pnpm build` para Next.js composto, sem publicação de imagens.
5. Grava `elus360-composed-validation.json` com o estado de **cada** gate; reprova CI se um falhar. O job publica artifacts mesmo em falha.

O workflow de preparação já tinha passado no HEAD anterior, **mas isso não conta como resultado dos testes acima**, que só existirão quando executados no HEAD atual.

## Pendências bloqueantes

- Seis adaptadores entregues **não são os 150 conflitos resolvidos**: a contagem prevista da próxima execução é de 144 itens não resolvidos, incluindo `AgentForm.tsx`, `lib/i18n/dicionario.ts`, o `baseline.sql`, instalador e CI. Confirmar contagem no novo artifact; não tratá-la como verificada antes do job.
- `AgentForm.tsx` exige transposição semântica da governança de provedores/modelos/credenciais sobre novas opções oficiais. Não substituir o arquivo novo pelo antigo.
- `lib/i18n/dicionario.ts` exige diff íntegro (a API de conteúdo retornou string vazia apesar de blobs diferentes); não forçar mudança sem evidência.
- `supabase/baseline.sql` e migrations: sem upgrade seguro com dados e sem regressão RLS não há release.
- `hostgator-setup-kit/_common.sh` e `update.sh`: segurança de origem, AMD64 e rollback ELUS devem coexistir com os reparos oficiais. Não fazer builds na VPS.
- CI da árvore composta **não substitui E2E real do produto instalado** nem ensaio de instalação limpa/upgrade com dados.
- `COMPOSED_TECHNICAL_CHECKS_PASSED`, caso obtido, indica somente typecheck, build e unitários selecionados; release continua `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.

**Próximo gate:** verificar CI do SHA exato por ocasião do retorno green/red; ler artefatos da árvore composta, corrigir falhas específicas e resolver os adaptadores restantes com testes de segurança de produto.
