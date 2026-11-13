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
