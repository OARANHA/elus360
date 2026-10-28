# ELUS 360 — Chutes.ai como IA incluída (branch ELUS, sem alterar upstream)

Status: suporte Chutes integrado à `main` na PR #8 (squash `66072e0`), publicado na instalação ELUS 360 com imagem da revisão `36f09a9` (28/10/2026). O ajuste do aviso de primeiro acesso vive em PR separada de revisão; não presumir esse ajuste publicado até merge/deploy. Base: DeskcommCRM v1.94.0.

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
3. Rodar/verificar a sincronização do catálogo antes de receber clientes. O cron executa Chutes e OpenRouter de modo independente. Em 28/10/2026, a chamada autenticada pelo caminho interno da aplicação respondeu HTTP 200: 10 modelos Chutes gravados, 10 aptos a ferramentas; 464 OpenRouter gravados. A mesma rota pelo domínio público retornara 403 (origem do bloqueio externo não isolada); não abrir a rota do cron sem autenticação ou expor `INTERNAL_SECRET`. Um novo ambiente precisa de verificação própria, não inferir deste aceite.
4. Configurar limites de consumo de IA por organização/plano em `ai_budgets`; sem orçamento, o fallback compartilhado transfere todo o custo para a instalação. Validar o enforcement real em uma organização de teste.
5. Validar jornada fresca (conta → organização → boas-vindas → treinar IA → criar/publicar agente → testar resposta por ferramentas), política de autorização e telemetria de custos; **CI unitário sozinho não basta**.

## Isolamento, primeiro acesso e futuras atualizações
- O próprio núcleo do DeskcommCRM cria uma organização com `settings.llm` provisório da Anthropic. A integração ELUS só persiste `chutes` **junto com um modelo compatível do catálogo** no aceite inicial de boas-vindas. Se o catálogo estiver vazio, não troca só o provedor nem inventa modelo.
- **Marca voltada ao cliente:** no primeiro acesso, usar somente “IA incluída no ELUS 360”; não exibir o nome do provider técnico. O provider `chutes` permanece visível às áreas técnicas/administrativas onde sua escolha for necessária. A decisão fica encapsulada em `textoChutesIncluido`, com textos pt-BR/es e testes que impedem a volta do nome na tela.
- A personalização visual reside em `lib/elus360/onboarding/ia-incluida.ts`, consumida por dois pontos pequenos: `lib/instalacao/retrato.ts` (leitura somente, com flag e prova de catálogo) e `app/onboarding/_components/JaEstaPronto.tsx` (rótulo). Antes do aceite, com chave mas sem catálogo, mostrar **catálogo pendente**, nunca **falta a chave** ou **agente pronto**. Após o aceite, as regras originais do runtime/tenant vencem.
- **Feature flag de ativação:** `ELUS_DEFAULT_AI_PROVIDER=chutes` com `CHUTES_API_KEY` apenas em ambiente de servidor. Desligar a flag restaura o comportamento original do primeiro acesso em um novo deploy, mas **não reverte automaticamente** provedores/modelos já escolhidos por empresas existentes — isso exige decisão explícita da organização. BYOK continua prioritário.
- **Branch é veículo de desenvolvimento, não de operação ou rollback.** Novas alterações vão por branch específica → testes → PR → CI → merge em `main` → imagens por digest → deploy. Atualizações upstream entram em PR separada, revisando apenas as interfaces com `lib/elus360/`, sem sobrescrever módulos ELUS. Um rollback de produção usa digest conhecido, não checkout antigo.
- A correção visual está isolada na branch `fix/elus360-chutes-onboarding-ready-20261028`, com testes cobrindo flag ligada/desligada, modelo presente/ausente, BYOK, organização já iniciada, e ausência de segredo no HTML. Sem merge/deploy até gates.
- Preservar `OARANHA/elus360-landing` e o fluxo de login da PR #3; esta correção não altera autenticação, Caddy, Supabase nem Portainer.

Referências: `lib/ai/pontos/provedores.ts`, `lib/agent-engine/edge/llm/credentials.ts`, `app/onboarding/setup-ai`, `app/actions/onboarding/acceptWelcome.ts`, `app/api/v1/cron/sync-model-catalog/route.ts`.
