# ELUS360 — preparação da migração de nomes das skills

**Estado:** auditoria read-only implementada na PR #30; renomeação das dez skills realizada na PR #31, ainda DRAFT e empilhada na PR #29. Sem merge/deploy.

## Autoridade e riscos comprovados

- Fonte: `.agents/skills/`; espelho: `.claude/skills/`, mantido por `pnpm skills:sync`.
- Inventário da `main` em 09/11/2026: 11 skills; dez `deskcomm-*` e uma `sistema-vivo` (manter).
- `tests/unit/skills-embutidas.test.ts` exige `name` igual ao diretório, `agents/openai.yaml`, rastreamento Git, espelho fiel e referências corretas em `CLAUDE.md`, `AGENTS.md`, Cursor e Antigravity.
- `.claude/settings.json`, `.codex/hooks.json` e `tests/shell/deskcomm-contribuir.test.sh` dependem do caminho de execução `deskcomm-contribuir`. Mover apenas o diretório quebra guardas de migrations, pré-push e sessão.
- A PR #29 (Academia, HEAD `22cbb913f4e5a945a413158e2553979d2b3e7a78`) modifica `deskcomm-curso` e seu runbook. Está Draft, não integrada. A migração deve preservar seu conteúdo; não copiar a versão antiga de `main` por cima.
- A PR #40 pertence ao repositório `OARANHA/elus360-landing` e não faz parte desta migração.

## Comandos de auditoria offline

```bash
node scripts/skills-embutidas/auditar-namespace-elus360.mjs > /tmp/elus360-skills-namespace.json
node --test tests/operational/skills-namespace.test.mjs
```

O comando lista somente caminhos, categorias e nomes relacionados; não exibe trechos de conteúdo ou credenciais e não altera arquivos. `EXIGE_MIGRACAO_DE_HOOKS` é bloqueador para um simples `git mv`; `BLOQUEADO_COLISAO` proíbe sobrescrever skills. Revisar separadamente os arquivos grandes ou binários que não entram no inventário.

## Ordem correta da próxima PR de migração

1. Revalidar `main`, PR #29 e SHA. Somente migrar `deskcomm-curso` sobre o conteúdo atualizado da Academia.
2. Revisar a saída da auditoria, incluindo referências executáveis, pontos de invocação e documentação canônica; separar menções históricas do upstream.
3. Migrar `deskcomm-contribuir` em conjunto com todos os Git hooks e instaladores de hooks, preservando os testes de proteção de migrations e push.
4. Renomear as dez skills para `elus360-*` e seus `name`/`display_name`; preservar `sistema-vivo`, ajustar regras de descoberta e a allowlist do `.gitignore`.
5. Sincronizar espelhos com `pnpm skills:sync`; exigir `pnpm skills:sync --check` sem divergências.
6. Testar pelo menos `tests/unit/skills-embutidas.test.ts`, `tests/unit/documentacao-aponta-para-o-que-existe.test.ts`, `tests/shell/deskcomm-contribuir.test.sh`, além de lint, TypeScript e testes da Academia.
7. Provar os comandos `/elus360-curso` e `$elus360-curso` nos agentes aplicáveis e decidir a compatibilidade temporária com os nomes antigos.
8. PR separada, gates do novo HEAD, revisão e autorização antes de qualquer merge. Não fazer polling de Actions nem publicar curso automaticamente.

**Aceite final (ainda pendente):** dez skills `elus360-*`, uma `sistema-vivo`, duas árvores espelhadas, todos os hooks funcionando, skill de curso com fluxo ELUS360 e nenhuma referência ativa quebrada.

## Auditoria depois da migração (PR #31)

O auditor v2 é válido nas fases `antes_da_migracao` (dez `deskcomm-*`), `mista` (nomes dos dois namespaces) e `apos_migracao` (dez `elus360-*`), além de sinalizar `sem_namespace_reconhecido`.

- Em `apos_migracao`, o auditor **continua procurando os nomes antigos** nos arquivos versionados, mesmo sem existir diretório `deskcomm-*`. Separar as referências históricas de caminhos ativos.
- `BLOQUEADO_ESTADO_MISTO` e `BLOQUEADO_COLISAO`: impedir migração parcial ou sobreposição de nomes.
- `BLOQUEADO_ESPELHO_DESATUALIZADO`: nomes ausentes/órfãos em `.claude/skills`.
- `BLOQUEADO_REFERENCIA_ATIVA_LEGADA`: referência antiga em `.claude/settings.json`, `.codex/hooks.json` ou regras sempre ativas de Cursor/Antigravity. Não executar hooks obsoletos.
- `EXIGE_HOMOLOGACAO_CLI`: o inventário e as entradas conhecidas não apresentam bloqueio, mas **não equivalem** à execução real em Claude Code, Codex, Cursor, OpenCode ou Antigravity.

Antes da integração da PR #31: aprovar a PR #29 separadamente, reconciliar sua base com `main`, conferir `pnpm skills:sync --check`, testar hooks, instalador e CLIs reais; a PR #30 pode integrar antes, independentemente, **somente com autorização do proprietário**. Não presumir aliases `/deskcomm-*` ou `$deskcomm-*`. O site `OARANHA/elus360-landing` e sua PR #40 permanecem fora deste escopo.

