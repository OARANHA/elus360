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
