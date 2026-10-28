# ELUS 360 — Chutes.ai como IA incluída (branch ELUS, sem alterar upstream)

Status: implementação em revisão, **não publicada em produção**. Origem: DeskcommCRM v1.94.0, repositório `OARANHA/elus360`.

## Decisão
- O cliente recebe a opção de **IA incluída pela instalação ELUS 360**; BYOK por organização continua disponível e tem precedência. O segredo global nunca é enviado ao navegador ou gravado em `organizations.settings`.
- Chutes é um **provedor nativo** (id `chutes`) com endereço fixo `https://llm.chutes.ai/v1`, API OpenAI-compatible via **Chat Completions**, ferramenta/visão derivadas do catálogo, não um `custom` que uma organização pode apontar a outro host.
- Credencial central: `CHUTES_API_KEY` no Portainer da stack `elus`, presente no **app e no worker**. Não definir como `OPENAI_API_KEY`: isso poderia enviar chave Chutes ao endpoint da OpenAI.
- Ativação para empresas novas: `ELUS_DEFAULT_AI_PROVIDER=chutes` no serviço app. Após o aceite de boas-vindas no primeiro onboarding, a rotina canônica `definirPadraoDeIaDaOrganizacao` escolhe e grava **provedor+modelo** juntos, somente se houver chave central e modelo compatível no catálogo. Não troca automaticamente IA das empresas existentes e não altera a seleção BYOK que o administrador fizer posteriormente.
- O catálogo oficial `GET https://llm.chutes.ai/v1/models` é sincronizado pelo cron de modelos existente, em linhas `source=chutes`, isoladas das fontes OpenRouter/manual. Capacidade de `tools` e preços vêm dos metadados publicados; a Chutes informa preços em **USD por milhão de tokens**, diferentemente dos preços por token da OpenRouter.
- Sem catálogo ou sem modelo com tool calling, o onboarding **não pode fingir publicação**: o agente fica em rascunho, preservando as mensagens de erro da v1.94.

## Instalação e operação
1. Cadastrar `CHUTES_API_KEY` no Portainer sem inserir segredo no GitHub.
2. Definir `ELUS_DEFAULT_AI_PROVIDER=chutes` **apenas quando a integração tiver sido validada e publicada**.
3. Rodar/verificar a sincronização do catálogo de modelos antes de receber os primeiros clientes. O cron executa Chutes e OpenRouter de forma independente: falha de uma fonte não impede sincronizar a outra. Se ambas falharem, o endpoint responde 503; erro de uma fonte aparece como código sanitizado no resultado e nos logs. **Ainda não há prova operacional de sincronização na instalação nova.**
4. Configurar limites de consumo de IA por organização/plano em `ai_budgets`; sem orçamento, o fallback compartilhado transfere todo o custo para a instalação. Validar o enforcement real em uma organização de teste.
5. Validar jornada fresca (conta → organização → boas-vindas → treinar IA → criar/publicar agente → testar resposta por ferramentas), política de autorização e telemetria de custos; **CI unitário sozinho não basta**.

## Atualizações
- `feat/elus360-chutes-plataforma-20261028` é branch de desenvolvimento, **não é mecanismo de rollback em produção**.
- Depois de revisão, merge por PR em `OARANHA/elus360/main` e releases da nossa imagem GHCR. Atualizações oficiais do DeskcommCRM são integradas por PR com verificação de compatibilidade de catálogo, credenciais, registry, worker e onboarding.
- Preservar `OARANHA/elus360-landing` e a PR visual do login (#3) separadas. Não alterar a produção, Caddy, Supabase ou Portainer nesta PR de desenvolvimento.

Referências: `lib/ai/pontos/provedores.ts`, `lib/agent-engine/edge/llm/credentials.ts`, `app/onboarding/setup-ai`, `app/actions/onboarding/acceptWelcome.ts`, `app/api/v1/cron/sync-model-catalog/route.ts`.
