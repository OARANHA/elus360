---
name: elus-doutrina
description: "Use sempre que revisar ou alterar arquitetura, API, segurança, autenticação, RBAC, Supabase, multi-tenancy, canais, IA gerenciada, credenciais, agentes, migrations ou contratos do repositório OARANHA/elus360."
---

# ELUS360 — doutrina viva para código e segurança

Skill ELUS360 adaptada dos princípios da skill oficial [`deskcomm-doutrina`](https://github.com/melgarafael/DeskcommCRM/blob/main/.agents/skills/deskcomm-doutrina/SKILL.md). **Não substitui** as regras oficiais, `CLAUDE.md` nem a verificação do repositório em tempo real.

## 1. Identidade, fontes e precedência

1. Destino operacional: `OARANHA/elus360`; upstream técnico: `melgarafael/DeskcommCRM`. `OARANHA/elus` e `crm-wandora` são históricos, não destino de alterações.
2. Confirmar no GitHub o HEAD real de `main`, branch/PR, arquivos existentes e estado do CI **do SHA em questão**. Antes de mudar código, consultar `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, `docs/specs/` relevantes e `docs/elus360/extension-contract.md`. Precedência: `CLAUDE.md > docs/specs/ > docs/prd/ > HANDOFF-*.md > README.md`. A presente skill é orientação operacional subordinada à doutrina.
3. Consultar a skill `deskcomm-doutrina` oficial na referência atual do upstream **quando necessário** e comparar com os contratos efetivos do fork. Não copiar uma regra incompatível como se já estivesse aplicada no ELUS.
4. Consultar contexto de memória Hindsight exclusivamente com `bank_id="Elus360"` em gates relevantes; tratar memória como histórico, nunca como comprovação de implantação. Se indisponível, registrar pendência na documentação versionada.

## 2. Invariantes que nunca podem ser perdidas

**Organizações e acesso:** dados tenant-aware precisam preservar `organization_id`, RLS e checagens explícitas de organização. `service_role` contorna RLS: qualquer acesso administrativo deve receber a organização de identidade confiável e filtrar por ela. Validar autorização real em rotas e ações; ocultar UI não é RBAC. Usar `getUser()` no servidor, não confiar em `getSession()` para autenticação. Provar negação entre duas organizações com teste negativo.

**Banco e self-host:** migration exige a tripla oficial aplicável: migration nova, atualização idempotente do `supabase/baseline.sql` e marcador `-- manifest: ...` na migration; revisar regras de versionamento vigentes antes de executar. Não alterar migration já aplicada. Não executar SQL, baseline ou migrar produção como efeito de uma análise de upstream. Não presumir esquema real do Supabase sem evidência.

**Separação de providers:** regras de canais dependem de `lib/channels/` e seu contrato, nunca de condicionais de provider espalhadas por features; consultar `pnpm lint:channels` quando pertinente. Provedores/modelos de **IA** são outro domínio: preservar governança gerenciada ELUS, defaults, `provider`, `model`, `credential_id`, `operator_model`, permissões e revisão de credenciais. Não adicionar adaptador paralelo ou conceder BYOK/edição a tenant sem grant comprovado.

**Agentes, integrações e mensagens:** preservar guards de sessão/token, membership, capacidade, auditoria, `before_send`, envio com remetente canônico, proteção de mídia privada e idempotência. Não tratar uma resposta convincente do agente como prova de ferramenta. Para fluxos de IA, executar prova em par com a mesma entrada bruta (agente e ferramenta direta) e E2E quando o percurso do usuário exigir.

**Produção ELUS:** imagens versionadas e Portainer/VPS não equivalem à instalação genérica do DeskcommCRM. Não executar `update.sh`, builds na VPS, merge, deploy, migrations ou canários sem as autorizações e gates próprios. Antes de mexer no código, distinguir estado `PROPOSTO`, `IMPLEMENTADO`, `TESTADO`, `PUBLICADO` e `VERIFICADO EM PRODUÇÃO`.

## 3. Definition of Done baseada em evidências

- Mostrar SHA/ref, arquivos consultados, contratos afetados, diffs, evidências de testes e lacunas; não usar resumos ou CI de outro HEAD como prova.
- Mudança de comportamento requer teste positivo, negativo de segurança e, quando viável, **sabotagem controlada**: retirar somente a correção em checkout isolado, confirmar falha esperada, restaurá-la e obter verde. Nunca sabotar produção ou branch compartilhada.
- Mudanças de UX requerem prova em tela apropriada; mudanças sensíveis exigem auth/RBAC, RLS multi-tenant, auditoria e regressão. `pnpm test:unit`, `lint`, `typecheck`, `lint:channels`, `test:db`, `build` e E2E são executados conforme escopo, recursos e doutrina atual; não afirmar que uma suíte menor cobre tudo.
- Para atualização upstream, não promover candidato por mero sinal AST ausente, conexão distante, assinatura parecida ou CI verde. Use `elus-contribuir`, `docs/elus360/upstream-reconcile-gate2.md` e a matriz correspondente. Quando o grafo é inconclusivo, autorização permanece fechada.
- Nunca inventar autorização, resultado de canário, conteúdo de ferramenta, SHAs ou testes não executados. Declarar explicitamente **o que não foi medido**.

## 4. Limite de invocação

Esta skill orienta revisão e execução **somente dentro da autorização efetiva da tarefa**. Não fornece acesso ao GitHub, Supabase, Docker ou Hindsight por si só e não instala hooks automaticamente. Para alterações no projeto, consultar também `elus-contribuir`.
