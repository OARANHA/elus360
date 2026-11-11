# ELUS360 — primeiro ciclo real do Upstream Sync: Deskcomm v1.107.0

Status: **CANDIDATO EM PR**, sem merge, publicação ou alterações de banco/Portainer.

## Proveniência verificada em 11/11/2026

- Upstream: `melgarafael/DeskcommCRM`, release oficial pública `v1.107.0`.
- Base já reconciliada no fork: `v1.102.0`, commit oficial `4b5815721710c9b1e99078322593838fda1ee740`.
- Destino: `v1.107.0`, commit oficial `f1d53aaccfd3552f75be0c641c1d72ee8b22257f` (tag anotada foi resolvida ao commit).
- Fork `OARANHA/elus360/main` usado neste levantamento: `fa76cf8c1197c7007e1feb0fef35397fe98336c6`.

## Inventário preliminar reproduzível

Árvores Git completas dos três commits, sem truncamento: base **10.559** blobs, destino **11.127**, fork **10.656**.
Foram detectados **1.351 caminhos alterados** entre as duas releases oficiais. Comparação por pathname, SHA de blob e modo de arquivo, sem equivalência semântica:

| Categoria preliminar | Quantidade |
| --- | ---: |
| Arquivos novos no upstream ausentes no fork | 575 |
| Alterações em caminhos com blob base preservado e sem proteção de caminho no inventário preliminar | 654 |
| Alterações em caminho sensível (SQL, IA, auth, infra etc.) com blob base preservado | 103 |
| Divergências diretas onde fork e upstream alteraram o mesmo blob | 18 |
| Exclusão pelo upstream | 1 |
| Já idênticos ao destino | 0 |

**Essas categorias NÃO são o resultado final do reconciliador**: 654 são apenas candidatos *por blob/caminho*, sujeitos ao AST TypeScript e às proteções de importação transitiva. Os 575 novos não foram automaticamente classificados como seguros. Qualquer falha ou ambiguidade implica revisão.

## Entrega e execução

Esta PR recupera **apenas** o analisador triádico, seus 3 módulos auxiliares e testes da branch de revisão PR #20, sem incorporar as alterações experimentais de Gate 8/9/10 em SQL, autorizações ou runtime.

Workflow `.github/workflows/elus360-upstream-reconcile.yml`:

1. Examina, em runner hospedado, se a release é oficial e publicada; confere SHA completo das tags (inclusive anotadas) e ancestralidade.
2. Executa testes offline do reconciliador e `plan` sobre os objetos Git das três versões reais.
3. Executa `prepare` em **worktree detached separado**, somente para `safe_to_prepare`, produzindo patch de candidato e JSON completo.
4. Publica artefatos para revisão humana: `elus-upstream-plan.json`, `elus-upstream-safe.patch`, `elus-upstream-prepare.json` e resumo.
5. **Não faz push, merge, migrations, alteração de stack ou deploy.**

As entradas manuais do workflow permitem outras versões oficiais, desde que o operador forneça os dois SHAs exatos. A PR preserva o `scripts/elus-upstream-prepare.mjs` do Gate 1 e o controlador de produção. O próximo gate é transformar o patch revisado em uma PR de integração do código da v1.107.0, resolver arquivos classificados para revisão, conferir baseline e invariantes de segurança. CI GREEN da análise não é aceite funcional da atualização.

## Não confundir os mecanismos

- **Upstream Sync:** comparação, preparação e bloqueio conservador de conflitos.
- **Distribuição ELUS360:** release própria do fork, imagens Linux AMD64, Supabase/schema, Portainer e canário.

A versão `v1.107.0` do Deskcomm **não** é uma release instalável do ELUS360 sem essa integração.

## Evidência do workflow real — run #42994738258 (CI GREEN anterior)

A execução associada ao HEAD `2e39a43ddb5f1157c6a45bc6ac2947da77ca2e98` publicou
o [artifact `elus360-upstream-reconcile-artifacts`](https://github.com/OARANHA/elus360/actions/runs/42994738258)
(ID `13843692575`). O JSON do plano real foi inspecionado, não inferido do comparador Git.

- `gate=manual_review_required` para **1.351 caminhos**;
- `contract_requires_review=1081`, `protected_requires_review=263`,
  `conflict_requires_review=6`, `deletion_requires_review=1`;
- `dependency_scan.executed=true`, **3.470** fontes analisadas, `complete=false`,
  **2 referências de importação calculadas não resolvidas**;
- **691** candidatos preliminares comuns, reclassificados para revisão por sinais de contratos;
- **12** candidatos com `potential_compatibility_manual_review` — classificação **apenas de triagem**;
- `prepare.preparedFiles=0`, patch `elus-upstream-safe.patch` com **0 bytes**.

A contagem de **18 divergências por blob** do inventário inicial não contradiz
`conflict_requires_review=6` no reconciliador: os demais caminhos podem receber
`protected_requires_review` por prioridade de classificação. Nenhuma das duas
contagens prova resolução de um conflito.

### Doze arquivos para revisão dirigida (não autorização)

1. `lib/agenda/google/mudanca-vinda-do-google.ts`
2. `lib/agenda/servicos/motivos.ts`
3. `lib/automation/actions/register-all.ts`
4. `lib/campanhas/elegibilidade.ts`
5. `lib/channels/adapters/meta-cloud.ts`
6. `lib/channels/adapters/waha.ts`
7. `lib/channels/adapters/zernio.ts`
8. `lib/email/estado.ts`
9. `lib/followup/fluxos-da-etapa.ts`
10. `lib/mcp/tools/pipelines.ts`
11. `lib/modulos/catalogo.ts`
12. `lib/waha/ingest.ts`

Todos continuam exigindo revisão humana. O primeiro arquivo de vocabulário aditivo
`lib/agenda/servicos/motivos.ts` foi isolado na [PR #36](https://github.com/OARANHA/elus360/pull/36),
com verificação de blob oficial e testes de regressão; **não** representa
a atualização funcional completa da agenda nem da v1.107.0.

### Nova fila automatizada de revisão

`scripts/elus-upstream-review-queue.mjs` consome o plano oficial fixado do
workflow, valida SHAs completos, integridade dos totais, caminhos e duplicações,
e gera `elus-upstream-review-queue.json` e `.md` com as classes de risco e
o digest SHA-256 do plano. O output mantém `authorization:none` para todos
os itens. Essa fila é **somente para revisar**, nunca para aprovar patches,
resolver conflitos, fazer merge, aplicar migrations ou atualizar o Portainer.

A geração dos novos artefatos e seus testes foram adicionados à PR #34;
a evidência acima refere-se à **execução anterior**. O novo HEAD ainda
precisa de seu próprio CI para ser considerado testado.

## Delta-first: preparo de candidatos sem sobrescrever o fork (11/11/2026)

Modo `--delta-first`: usa comparação de blob Git **e modo** entre base oficial, destino oficial e ELUS360 para selecionar `stage_direct_candidate`. Mantém o status histórico do reconciliador, análise AST, sinais de risco e bloqueios próprios. Arquivos alterados pelo fork, exclusões, modes não regulares, schema, distribuição, namespace ELUS, consumidores personalizados e imports novos para customizações não são preparados automaticamente. Os demais são preparados somente em **worktree detached descartável**, não em `main`.

O patch `elus-upstream-direct-candidate.patch` é um **candidato**, não um patch homologado. O grafo incompleto continua reportado; os testes completos de integração/segurança/banco/E2E, revisão e aprovação para merge/deploy permanecem obrigatórios. Sem `--delta-first`, o modo conservador original continua disponível e com os testes existentes.
