# ELUS360 — preparação da migração de nomes das skills

**Estado em 10/11/2026:** auditoria read-only integrada na PR #30; Academia integrada na PR #29; gate GHCR do fork integrado na PR #32. A PR #31 foi reconciliada com `main` sem reescrita de histórico, está aberta em DRAFT e tem CI GREEN no commit reconciliado `391c76515db0d973d052d75cca8d671c0d6eb11f`. A edição deste runbook exige **novo CI**; nenhuma evidência anterior aprova um SHA posterior. Sem merge da PR #31, release ou deploy. **Homologação real dos CLIs ainda pendente.**

## Autoridade e riscos comprovados

- Fonte: `.agents/skills/`; espelho: `.claude/skills/`, mantido por `pnpm skills:sync`.
- Inventário da `main` em 09/11/2026, **histórico**: 11 skills; dez `deskcomm-*` e uma `sistema-vivo`. A PR #31 propõe as dez `elus360-*`, preservando `sistema-vivo`.
- `tests/unit/skills-embutidas.test.ts` exige `name` igual ao diretório, `agents/openai.yaml`, rastreamento Git, espelho fiel e referências corretas em `CLAUDE.md`, `AGENTS.md`, Cursor e Antigravity.
- `.claude/settings.json`, `.codex/hooks.json` e `tests/shell/deskcomm-contribuir.test.sh` dependem do caminho de execução `deskcomm-contribuir`. Mover apenas o diretório quebra guardas de migrations, pré-push e sessão.
- A PR #29 (Academia) modificou `deskcomm-curso` e seu runbook e foi integrada na `main` em 10/11/2026 (squash `30721550375a6afc005259dd394ccd6ae34d3f37`). A PR #31 **preserva essa edição** no novo nome `elus360-curso`; não substituir pelo conteúdo antigo.
- A PR #40 pertence ao repositório `OARANHA/elus360-landing` e não faz parte desta migração.

## Comandos de auditoria offline

```bash
node scripts/skills-embutidas/auditar-namespace-elus360.mjs > /tmp/elus360-skills-namespace.json
node --test tests/operational/skills-namespace.test.mjs
```

O comando lista somente caminhos, categorias e nomes relacionados; não exibe trechos de conteúdo ou credenciais e não altera arquivos. `EXIGE_MIGRACAO_DE_HOOKS` é bloqueador para um simples `git mv`; `BLOQUEADO_COLISAO` proíbe sobrescrever skills. Revisar separadamente os arquivos grandes ou binários que não entram no inventário.

## Sequência aplicada na PR #31 e gates para integração

1. **Feito:** revalidar `main`, PR #29 e SHA; migrar `deskcomm-curso` preservando o conteúdo atualizado da Academia.
2. **Feito no código/CI:** revisar a saída da auditoria, incluindo referências executáveis, pontos de invocação e documentação canônica; separar menções históricas do upstream.
3. **Feito no código/CI:** migrar `deskcomm-contribuir` em conjunto com Git hooks e instaladores, com regressões para migrations e push.
4. **Feito no código/CI:** renomear dez skills para `elus360-*` e atualizar `name`/`display_name`; preservar `sistema-vivo`, descoberta e allowlist do `.gitignore`.
5. **Espelhos verificados por testes CI; comando direto ainda a conferir:** `pnpm skills:sync --check` deve terminar sem divergências na bancada de homologação.
6. **CI GREEN no SHA anterior à edição deste runbook:** testes operacionais (39/39), testes de skills/espelhos, documentação, hooks e suites de CI; conferir novamente o novo HEAD antes de integração.
7. **PENDENTE — homologação funcional externa:** executar `/elus360-curso` no Claude Code e `$elus360-curso` no Codex em instalações reais aplicáveis, verificar `SessionStart`/hooks e decidir explicitamente a compatibilidade com invocações antigas. Testes de scripts chamados de 'CLI real' no CI não comprovam invocação de skills nos agentes.
8. **PENDENTE:** conferir CI do novo HEAD, resultado funcional dos CLIs e autorização específica do proprietário antes do merge da PR #31. Não fazer polling de Actions nem publicar curso automaticamente.

**Aceite final (ainda pendente):** dez skills `elus360-*`, uma `sistema-vivo`, duas árvores espelhadas, todos os hooks funcionando, skill de curso com fluxo ELUS360 e nenhuma referência ativa quebrada.

## Auditoria depois da migração (PR #31)

O auditor v2 é válido nas fases `antes_da_migracao` (dez `deskcomm-*`), `mista` (nomes dos dois namespaces) e `apos_migracao` (dez `elus360-*`), além de sinalizar `sem_namespace_reconhecido`.

- Em `apos_migracao`, o auditor **continua procurando os nomes antigos** nos arquivos versionados, mesmo sem existir diretório `deskcomm-*`. Separar as referências históricas de caminhos ativos.
- `BLOQUEADO_ESTADO_MISTO` e `BLOQUEADO_COLISAO`: impedir migração parcial ou sobreposição de nomes.
- `BLOQUEADO_ESPELHO_DESATUALIZADO`: nomes ausentes/órfãos em `.claude/skills`.
- `BLOQUEADO_REFERENCIA_ATIVA_LEGADA`: referência antiga em `.claude/settings.json`, `.codex/hooks.json` ou regras sempre ativas de Cursor/Antigravity. Não executar hooks obsoletos.
- `EXIGE_HOMOLOGACAO_CLI`: o inventário e as entradas conhecidas não apresentam bloqueio, mas **não equivalem** à execução real em Claude Code, Codex, Cursor, OpenCode ou Antigravity.

Antes da integração da PR #31: a PR #29 já foi aprovada e integrada; a PR #30 já está integrada, assim como a correção GHCR da PR #32. A PR #31 já aponta para `main` e preserva as mudanças das três integrações. **Ainda falta** verificar `pnpm skills:sync --check` diretamente, homologar hooks/instalador e invocações dos CLIs reais, obter CI GREEN do SHA definitivo e aprovação específica para merge. Não presumir aliases `/deskcomm-*` ou `$deskcomm-*`. O site `OARANHA/elus360-landing` e sua PR #40 permanecem fora deste escopo.

