---
name: elus-contribuir
description: "Use para qualquer mudança de código no ELUS360, bug, PR, CI GREEN/RED, migrations, testes, release, integração DeskcommCRM upstream ou revisão de compatibilidade. Exige evidências, preservação dos contratos e testes adversariais."
---

# ELUS360 — contribuição, atualização e aceite funcional

Adaptação ELUS360 da skill oficial [`deskcomm-contribuir`](https://github.com/melgarafael/DeskcommCRM/blob/main/.agents/skills/deskcomm-contribuir/SKILL.md). **Não é um script de upgrade**, não substitui `CLAUDE.md` e não autoriza incorporação automática de código upstream.

## 0. Preparação e autoridade

1. Distinguir tarefa ELUS (`OARANHA/elus360`) de contribuição ao DeskcommCRM oficial (`melgarafael/DeskcommCRM`). A base da PR ELUS é a `main` **do fork**, a menos que haja autorização explícita diferente. Nunca criar PR no upstream por inferência.
2. Conferir HEAD de `main`, branch/PR, SHA, working tree/diff (se houver checkout) e instruções `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, specs relevantes e `docs/elus360/extension-contract.md`. Não substituir fonte viva por histórico de chats. Precedência da doutrina conforme `elus-doutrina`.
3. Ler a skill oficial atual `deskcomm-contribuir` na referência real do upstream e aproveitar apenas checks compatíveis com o objetivo do fork. O comando `quem-sou.sh` distingue contribuidores ao projeto original: **não** determina automaticamente autoridade ou fluxos do ELUS360.
4. Recuperar contexto em Hindsight com `bank_id="Elus360"` e reconciliar com GitHub; se indisponível, preservar o checkpoint em arquivos versionados.

## 1. Fluxo de desenvolvimento do ELUS

- `branch → diff auditado → testes pertinentes → PR → CI → revisão humana → merge autorizado → imagens → deploy seguro → canário`. Não executar as etapas posteriores por serem mencionadas aqui.
- Nunca `reset --hard`, `push --force`, rebase em commits publicados, editar migration aplicada ou tocar em checkout sujo de outro agente. Verificar autoria/identidade, sobreposição com a `main` atual e modificações de terceiros antes de escrever.
- Em resposta a `GREEN`, conferir **uma vez** SHA real da PR, jobs e o resultado no HEAD correspondente. Em resposta a `RED`, ler **uma vez** o job com falha e corrigir a causa específica. **Proibido polling de GitHub Actions.** CI verde não equivale a aceite funcional nem prova de proteção de branch não consultada.

## 2. Caso especial: atualizar o DeskcommCRM dentro do ELUS

- Pinagem obrigatória da tríade Git `base oficial → target oficial → fork ELUS` por commits/trees verificáveis. Não usar tags móveis ou `origin/main` não conferida como substituto de SHA.
- Executar o reconciliador `scripts/elus-upstream-reconcile.mjs plan` **somente leitura** e usar a documentação `docs/elus360/upstream-reconcile-gate2.md` / `docs/elus360/upstream-gate5-review.md` quando existirem no HEAD relevante.
- Separar arquivos: integrados, protegidos, conflitos, contratos, testes e candidatos. Examinar imports no **fork e no target**; analisar novos módulos/rotas, consumers transitivos, mudanças de exports, efeitos e imports dinâmicos. Um grafo incompleto bloqueia promoção automática.
- `potential_compatibility_manual_review` é apenas prioridade de inspeção; **não** concede `safe_to_prepare`. Preservar políticas ELUS em agentes, onboarding, multi-tenancy, credenciais, catálogo Chutes, UI, auditoria e Supabase. Não incorporar versões sem gate funcional e decisão humana rastreável.

## 3. Pré-voo e testes

- Rodar os checks pertinentes que **existem no checkout**; consultar `package.json` e workflows antes de escolher comandos. Exemplos oficiais: `pnpm typecheck`, `pnpm lint`, `pnpm lint:channels`, `pnpm test:unit`, `pnpm test:shell`, `pnpm test:db`, `pnpm build`. Os dois últimos exigem recursos e autorizações apropriados; não inferir aprovação a partir de suites parciais.
- Quando há mudança de comportamento, criar teste que detecte sua ausência: em checkout **isolado**, remover só a correção, prever o resultado vermelho, executar, comprovar o caso esperado e restaurar; depois executar novamente em verde. Sem ambiente seguro, marcar `SABOTAGEM_NÃO_EXECUTADA`, não inventar o resultado.
- Validar segurança por cenários negativos: tenant A não acessa B; agente sem capability não altera credencial/provider/modelo; acesso API Token e sessão não confundidos; idempotência, mensagens e mídia fail-closed. Nos fluxos de IA, provar resultado **em par**: agente e ferramenta direta com exatamente a mesma entrada, e E2E quando houver UI.
- Migrations seguem a tripla e validação vigentes do repositório: migration nova, baseline idempotente, marcador `-- manifest: ...`; não rodar SQL em produção como teste. Alteração que afeta quem usa self-host pode requerer `.changes/<slug>.md`, jamais edição manual de versão no `CHANGELOG.md` sem processo oficial.

## 4. Registro de evidências e decisão

Para cada mudança avaliada, registrar no PR ou artefato versionado: `path`, SHA antes/depois/fork, motivo, impacto no contrato, testes positivos e negativos, resultados de sabotagem, prova em par/E2E quando aplicável, resultados do CI no SHA certo, **o que NÃO foi medido**, e decisão `REVIEW | REJECT | APPROVED_BY_HUMAN`. Sem aprovação fundamentada, permanecer em revisão, não preparar patches.

Após checkpoint relevante, tentar `ELUS Memory Admin` (`bank_id="Elus360"`) com fontes e classificações; se indisponível, documentar sincronização pendente. A prova é código/CI/runtime, não memória. Não assumir que este plugin cria automações, executa comandos, escreve em GitHub ou instala hooks sozinho.
