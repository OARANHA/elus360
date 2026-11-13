# ELUS360 — Reconciliação SQL v1.102 → v1.108 (somente evidências)

**Estado: NO-GO para aplicar no banco; documentação da PR #37, não procedimento operacional.**

## Proveniência do resultado

- PR: `OARANHA/elus360#37`, candidata **DRAFT**.
- HEAD verificado no workflow: `fcb3246733c67ccaf01129806f78af3f482a3a80`.
- GitHub Actions: run `43371951030`, artifact `14013307738`, arquivo `elus360-sql-delta-report.json`.
- Referências Git: base oficial v1.102 `4b5815721710c9b1e99078322593838fda1ee740`; fork `fcb3246733c67ccaf01129806f78af3f482a3a80`; destino oficial v1.108 `0b60c5abaace17922ae645399a6a6183a5f5c357`.
- O relatório estático registra `SQL_DELTA_AUDITED_NOT_APPLIED`. Não consultou estado atual do banco nem executou DDL.

## Diferenças de arquivo comprovadas

| Propriedade | Resultado |
|---|---|
| SQL alterados no fork ante base v1.102 | **5** |
| SQL alterados no upstream ante base v1.102 | **39** |
| Caminhos alterados por ambos | **1** — `supabase/baseline.sql` |
| Colisões de prefixo de migration entre os lados | **0** detectadas |
| Prefixos duplicados nas árvores fork ou upstream | **0** detectados |
| Baselines idênticos | **Não** |

O `supabase/baseline.sql` tem blob fork `24a819d0c88822f4887af4e3ca6a797c998124e7` e blob oficial v1.108 `e82bf528e36dce1c3f118c645c7e76fe2f93230b`. Não selecionar arbitrariamente um desses arquivos nem concatená-los. É necessário mapear semanticamente o delta ELUS sobre o baseline oficial, preservando tenant/RLS, permissões, funções e dependências.

O relatório de composição do mesmo workflow confirma que quatro migrations exclusivas do fork foram aplicadas **somente à árvore candidata** (não ao banco):

1. `supabase/migrations/20261028235959_9900_elus_ai_autonomy_guarded.sql` — guarda de autonomia técnica de IA;
2. `supabase/migrations/20261106140000_9901_elus_ai_agent_create_fields.sql` — criação de agente/versão governada;
3. `supabase/migrations/20261106160000_9902_elus_molde_chutes_pt409.sql` — molde de IA com Chutes;
4. `supabase/migrations/20261106170000_9903_elus_agent_version_columns.sql` — contrato de colunas das RPCs de versões.

A semântica desses quatro arquivos vem dos cabeçalhos `-- manifest:` e de trechos do SQL verificados na branch. Esse inventário **não** comprova execução, autorização ativa ou ausência de conflito semântico com as 39 mudanças upstream.

## Estado dos demais conflitos

A composição gerou: **405** overlays sem colisão, **11** adaptações, **131** itens oficiais retidos e **8** conflitos não resolvidos. Além do baseline: `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, `AGENTS.md`, `CLAUDE.md`, `docs/index.md`, `hostgator-setup-kit/README.md` e `README.md`.

O relatório `elus360-composed-validation.json` da mesma execução apresentou sucesso em `adapters`, `install`, `types`, `unit`, `build` — **não** em migração do banco, RLS, autenticação ou homologação de produção. Release gate permanece `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.

## Critérios de reconciliação — pendentes

1. Comparar conteúdo do baseline oficial e do ELUS por **contratos SQL** (colunas, funções, gatilhos, políticas, grants), não por posição de linha. Preservar upstream integral onde não há customização.
2. Identificar dependências de 9900–9903 no baseline novo e na ordem de migração. Não reproduzir migrations históricas com nomes novos sem motivo comprovado.
3. Gerar baseline candidato e validar criação de banco descartável, upgrade a partir de fixture e RLS entre dois tenants. Registrar OIDs/SHA, testes e rollback.
4. Só depois considerar merge/release; **nenhum acesso ao banco operacional, deploy ou DDL está autorizado neste gate**.

Para reproduzir inventário em novos SHAs: `node scripts/elus360-migration-delta-audit.mjs --repo . --base <SHA40> --fork <SHA40> --target <SHA40>`. O commit posterior que adiciona `local_sql_changes` e `upstream_sql_changes` ao JSON fornece os caminhos/OIDs individualizados no próximo workflow; os totais acima pertencem **ao artifact do HEAD anterior**, não a uma nova execução.

## Gate semântico — inspeção de contratos fonte (13/11/2026)

Fontes confrontadas diretamente pelos blobs Git, **sem usar memória como prova**:

- baseline oficial v1.108: `e82bf528e36dce1c3f118c645c7e76fe2f93230b` (80.922 linhas);
- baseline do fork: `24a819d0c88822f4887af4e3ca6a797c998124e7` (75.064 linhas);
- quatro migrations ELUS 9900–9903, lidas diretamente no HEAD `bd04e65e...`.

A inspeção isolada de 13 contratos de presença/ordem passou em **13/13 verificações estáticas**, com o veredito `ELUS_MIGRATIONS_REQUIRED_NOT_EXECUTED`. Esses checks não executam PostgreSQL.

| Contrato | Baseline oficial v1.108 | Migração ELUS proposta | Resultado / risco |
|---|---|---|---|
| `organizations` e `ai_agent_versions` | Tabelas presentes | 9900 e 9903 dependem delas | Dependência nominal identificada, execução ainda não comprovada |
| `organizations.ai_autonomy` | Ausente | 9900: `ADD COLUMN IF NOT EXISTS`, default `{}`, trigger `trg_guard_organizations_ai_autonomy` | Obrigatória para as RPCs governadas; requer prova de proteção contra writes diretos |
| `fn_elus_ai_*_guarded` | Ausentes no baseline oficial | 9900 define 8 RPCs, 9901 reescreve a criação, 9902 o salvamento de rascunhos, 9903 versões/criação | Verificar assinaturas finais, invoker, grants, tenant, MFA em dois tenants |
| `fn_llm_do_molde_de_ia` e `fn_molde_de_ia_na_org_nova` | Existem, sem `chutes` na allowlist da definição-base | 9902: `CREATE OR REPLACE` das funções incluindo `chutes` | A definição *final* após 9902 deve ser verificada; preserve os outros providers e `SECURITY DEFINER` com permissões restritas |
| `fn_seed_org_llm_defaults` | Presente; consulta `fn_llm_do_molde_de_ia` | Não redefinida pelas quatro migrations | Dependência indireta identificada; exige ensaio funcional de novo tenant com molde Chutes |
| `ai_agent_versions_provider_check` | Aparece na definição inicial de tabela; o baseline também inclui `DROP CONSTRAINT IF EXISTS` mais adiante | As migrations ELUS não devem presumir somente a definição inicial | Conferir **estado final** da constraint no banco descartável, não inferir lista efetiva pela primeira ocorrência |
| RLS / grants / identidades de tenant | Baseline oficial inclui políticas e grants próprios | 9900–9903 adicionam RPCs com `GRANT EXECUTE` para `service_role` e `REVOKE` de papéis públicos | Validar `pg_proc.proacl`, `pg_policies`, acesso `anon`/`authenticated` e revogação em banco real descartável |

**Decisão de composição proposta, ainda NÃO implementada como instalação:** preservar o baseline oficial v1.108 byte-exato e, em área descartável, aplicar as quatro migrations versionadas na ordem **9900 → 9901 → 9902 → 9903**. Não substituir pelo baseline antigo do fork nem concatenar SQL sem testar. A posição de cada migration em relação às migrations oficiais e à geração final do baseline deve ser estabelecida pela ferramenta de upgrade do projeto.

**Bloqueio de execução:** este ambiente não dispõe de `postgres`, `initdb`, `psql` ou Docker locais. Portanto, não houve ensaio em PostgreSQL descartável, rollback, aplicação de migration, teste com dois tenants ou prova de permissões. **NO-GO permanece.**

### Aceite necessário para liberar o próximo estágio

1. Criar banco Postgres **isolado e descartável**, com extensões/roles/auth schema equivalentes ao alvo, sem conexão com produção.
2. Inicializar com baseline oficial v1.108; aplicar as quatro migrations em ordem, falhando fechado em qualquer erro SQL. Executar um ciclo de reinstalação/upgrade separado a partir do baseline v1.102 com fixture e snapshot.
3. Verificar objetos finais (`pg_attribute`, `pg_proc`, `pg_trigger`, `pg_policies`, `pg_constraint`, `information_schema`) e revogação/grants das RPCs, além de inserção da organização com molde Chutes.
4. Exercitar chamadas permitidas como `service_role` *após* autorização da API e chamadas proibidas como `anon`/`authenticated`; testar isolamento entre dois tenants, concorrência/revogação e falha com dados inválidos.
5. Anexar log com commit/ref, hashes de cada SQL, resultados de assertivas, plano de rollback e estado do banco descartável; apenas então revisar o gate SQL.

O relatório estático **não autoriza alterar `supabase/baseline.sql`**, migrar dados reais, fazer merge ou publicar imagens.
