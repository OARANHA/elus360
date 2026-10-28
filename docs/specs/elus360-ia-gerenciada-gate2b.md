# ELUS 360 — Gate 2B: superfícies de escrita de IA (pré-integração)

> **Estado: INVENTÁRIO INICIAL, NÃO É AUTORIZAÇÃO IMPLEMENTADA.** Preparado a partir de `OARANHA/elus360/main@7ba91446510d687e9232663cbf1fc3ff68d26c55`, após merge GREEN da PR #13 em 28/10/2026. Não houve alteração de runtime nem de Supabase neste trabalho.

## 1. Por que este gate existe

A política pura dos quatro grants `provider`, `model`, `credentials` e `operator_model` já está na `main`. Ela não protege nada enquanto não for chamada **antes das escritas** por todas as entradas relevantes. Esconder menus não impede acesso HTTP direto. O DeskcommCRM possui acessos pela interface, API REST, API Tokens, Server Actions e onboarding; uma correção isolada na tela seria insegura.

A [lista JSON auditável](../elus360/ai-governance-write-surfaces.json) identifica **17 entradas verificadas no código**. O teste de pré-cobertura garante que os caminhos e métodos continuem existindo após updates. O teste **NÃO declara o conjunto exaustivo nem aprova guard**: todas as entradas permanecem `PENDING_REVIEW`.

## 2. Fronteiras do gate

| Superfície | Pontos encontrados | Próxima regra |
| --- | --- | --- |
| Configuração de pontos/padrão | `providers/route.ts` `PUT` e `PATCH` | Identificar campos mudados e grants independentes; referência atual lida do banco pela organização autenticada |
| Cofre de credenciais | `credentials/route.ts POST`, `credentials/[id] PATCH/DELETE`, `revalidate POST` | Revalidação pode atualizar apenas metadados sem alterar chave: distinguir ação operacional de concessão BYOK. Revogação técnica requer grant |
| Agentes e versões | Criação, `[id] PATCH`, `versions POST`, `versions/[vid] PATCH`, `publish POST`, `duplicate POST` | Preservar edição de prompt e execução; impedir alteração técnica por criação, cópia, versão e publicação, inclusive via API Token |
| Conhecimento | `knowledge/provedor PUT` | Família de embedding altera índice; validação de identidade e reindexação. Ainda não se usa Qwen3 na instalação atual |
| Onboarding | `salvarChaveDaIa`, `acceptWelcome`, `createDefaultAgent` | Onboarding server-owned pode aplicar a escolha central. BYOK fornecido pelo usuário deve obedecer à autonomia concedida |
| Admin da plataforma | `admin/tenants/[id] PATCH` | Já exige `requirePlatformAdminEscrita`; revisar campos permitidos, MFA, CAS e audit, sem permitir ao tenant elevar seu próprio grant |

### Achados de segurança no código atual

1. `app/api/v1/ai/providers/route.ts` tem **DUAS** escritas (`PUT` em binding, `PATCH` em `organizations.settings.llm`); proteger só `PUT` deixa mudança global por `PATCH`.
2. `app/api/v1/ai/credentials/[id]/route.ts` possui `PATCH` e `DELETE`; adicionar guard apenas em `POST` é insuficiente. O cofre também é acessado por `app/actions/onboarding/chaveDaIa.ts`.
3. `app/api/v1/ai/agents/route.ts` aceita **autenticação dual** (usuário ou API Token) e resolve par provider+modelo; o guard deve distinguir ator autenticado e proveniência do par. Nunca confiar em `organization_id`, referência anterior ou um `is_platform_admin` enviado pelo cliente.
4. `app/api/v1/ai/agents/[id]/versions/[vid]/route.ts` lê `status,agent_id,organization_id,followup` antes do PATCH, **sem provider/model/credential_id/operator_model naquele SELECT**; na integração deve recuperar a referência técnica real do servidor para comparar mudanças.
5. `app/api/v1/ai/knowledge/provedor/route.ts` troca família e programa reindexação; o modelo Gemma conversacional não atende os dois pontos de embeddings.
6. Mesmo com `requireRole('admin')`, o administrador do tenant ainda pode gravar alterações técnicas permitidas pelo core atual. Isso **não equivale** a autorização da plataforma ELUS.

## 3. Sequência obrigatória para implementação de verdade

**Gate 2B.1 (este PR):** inventário verificável + testes de presença; nenhuma garantia de proteção; status `PENDING_REVIEW`.

**Gate 2B.2 (PR de código):** expandir levantamento a toda rota/ação/worker que altera configurações técnicas; desenhar estratégia de referências atuais e privilégios por ator; implementar migration **nova e compatível** para `organizations.ai_autonomy`, default deny, CAS e trigger de proteção contra escrita direta; atualizar tripla de schema do DeskcommCRM conforme `CLAUDE.md`/specs, sem sobrescrever baseline às cegas. Revisar RLS, service role e MFA. Integrar API do Superadmin e todos os guards; não ativar parcialmente.

**Gate 2B.3 (aceite e liberação):** testes positivos/negativos por organização e ator, incluindo API Token, URL direta, reenvio idêntico, concorrência, onboarding server-owned, revogação de grant, modelos publicados e reindexação. Garantir sequência de migration/feature code sem indisponibilidade; não ativar contra produção antes de CI, imagem por SHA, deploy seguro e canário. Sem build pesado na VPS; preservar digests para rollback.

**Atenção:** a coluna `organizations.ai_autonomy` **não existe** no Supabase da instalação no momento da auditoria. Qualquer guard que dependa dela **não pode ser ligado nessa instalação** antes da migration e da respectiva validação, nem deve falhar aberto após a ativação. Os registros de conhecimento no Hindsight `bank_id="Elus360"` não são prova de alteração de schema.

## 4. Não-objetivos e limitações

- Esta PR não declara que as 17 entradas cobrem todos os consumidores. Caminhos de organizações, fluxos e outros workers ainda exigem leitura transversal.
- O teste atual valida **presença do método**, não seu corpo, semântica, autorização nem completude. É preflight para detectar remoção/renomeação após upgrades.
- Nenhum guard em API, feature flag de runtime, schema/migration, deploy, alteração de agente ou custo de IA foi implementado neste Gate 2B.1.
- As extensões oficiais `declarative/data` do DeskcommCRM continuam separadas: infraestrutura IA, autorização e isolamento são responsabilidade do núcleo. Não criar instalador de extensões paralelo.

## 5. Referências

- `docs/specs/elus360-ia-gerenciada-governanca-v194.md` (Gate 2A integrado PR #13).
- `lib/elus360/ai-managed/policy.ts` e teste unitário correspondente (sem I/O).
- [Contrato de extensões](../elus360/extension-contract.md).
- [Governança antiga](https://github.com/OARANHA/elus/blob/main/lib/ai/governanca-da-ia.ts).
- [ADR-0005 DeskcommCRM](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/adr/0005-plataforma-de-modulos-de-terceiro.md).

**Memória:** consultar e registrar no banco exclusivo `Elus360` antes/depois de cada gate, com GitHub como fonte de verdade. Sem polling de GitHub Actions.
