# ELUS 360 — Governança da IA gerenciada (v1.94.0)

> **Gate 2A — contrato e política pura, em PR (28/10/2026).** O código introduzido nesta etapa NÃO instala governança, não altera a configuração de organizações existentes, não protege rotas até o Gate 2B e não executa embeddings. Não anunciar a funcionalidade como disponível. Especificação vinculada ao [contrato de extensões](../elus360/extension-contract.md) já integrado na `main` pela PR #12.

## 1. Problema e objetivos

O ELUS 360 comercial precisa oferecer agentes de IA com provedor, modelo e credencial gerenciados pela instalação, para novos clientes sem chave própria obrigatória. O cliente continua administrando atendimento, prompts, conhecimento e processos permitidos, mas só altera opções técnicas explicitamente liberadas pelo Superadmin. Ocultar Credenciais/Provedores no menu **não é autorização**. Não criar `company_permissions`, `company_ai_settings`, provider paralelo ou nova plataforma de extensões.

Base comprovada em 28/10/2026: `OARANHA/elus360/main@a89364b51bb0b5c94bef8a1b796bc006245bf474`. A instalação Supabase Cloud `tbwcgdmenrcnghogqkqi`, em consulta somente leitura, possui `organizations.settings`, `ai_purpose_bindings`, `ai_provider_credentials`, `ai_agent_versions.operator_model` e `ai_knowledge_versions.embedding_model`, mas NÃO possui `organizations.ai_autonomy`. Estes são fatos de schema, não autorização para DDL.

## 2. Fonte do contrato e isolamento por tenant

Reutilizar seletivamente o ELUS antigo:
- `OARANHA/elus/lib/ai/governanca-da-ia-contrato.ts`: `provider | model | credentials | operator_model`, padrão `false` nos quatro.
- `OARANHA/elus/lib/ai/governanca-da-ia.ts`: leitura da coluna protegida, falha fechada, detecção de mudanças técnicas, referência da versão anterior consultada no servidor. O cliente nunca envia `antes` confiável.
- `OARANHA/elus/app/api/v1/admin/tenants/[id]/ai-permissions/route.ts`: `requirePlatformAdminEscrita` + CAS + auditoria.
- Superadmin com escopo `full`, sem impersonation/suporte, pode configurar; operadores de suporte não herdam escrita. Não conceder permissão só porque o usuário é admin da organização.

**Regra:** autonomia é autorização para ALTERAR configuração técnica, nunca autorização para executar o agente, nem mecanismo para apagar credenciais ou revogar versões publicadas. Ausência de coluna, JSON malformado, erro de consulta ou organização não encontrada: `deny` ao tenant. Sem vazamento entre organizações; resolver `organization_id` do contexto autenticado/capability e verificar a vinculação. Service role não dispensa filtro explícito por `organization_id`.

| Poder | Mutações técnicas que controla | O que NÃO deve bloquear sozinho |
| --- | --- | --- |
| `provider` | Troca de provedor, base URL e ativação do binding | Execução dos agentes autorizados |
| `model` | Troca de modelo de agente/auxiliar ou padrão | Edição apenas do texto do prompt |
| `credentials` | Criar/alterar/desativar chaves próprias e trocar `credential_id` | Uso da credencial já habilitada |
| `operator_model` | Troca de modelo operador | Fluxos, follow-ups ou conteúdo sem mudança do modelo |

Uma mutação com múltiplas alterações exige todos os grants correspondentes. Reenvio **idêntico** não exige grant extra; ausência de campo em PATCH não implica mudança. Os valores `true` têm de ser booleanos verdadeiros, nunca strings truthy.

## 3. Fronteira com o DeskcommCRM e extensões

Conforme `docs/doctrine/extensoes.md` e ADR-0005 do upstream, identidade, autorização, isolamento/RLS, infraestrutura IA e caminhos críticos de agente são **núcleo**. Os perfis oficiais `declarative` e `data` (parcial) não podem instalar guards de rotas; `connected` e `hosted` continuam sem runtime apropriado. Portanto, reutilizar as extensões oficiais para nicho e aparência, mas manter autorização central com pontos de integração mínimos ao núcleo (importando política em `lib/elus360/ai-managed/`); não criar SDK de plugin paralelo.

## 4. Fases de entrega obrigatórias

### Gate 2A — contrato isolado (ESTA PR)

1. Documento da especificação, tipos constantes e funções de decisão puras, sem acesso ao banco, rede, variáveis, sessão ou runtime.
2. Testes de ausência/corrupção, diferenças técnicas, reenvio idêntico, grant independente e nenhuma elevação por valor truthy.
3. Integração com a `main` por PR/CI e evidências; **não marca a governança como ativa**.

### Gate 2B — armazenamento protegido e autorização real (PR distinta)

1. Inventariar **TODOS** os caminhos que alteram provider, model, credential, binding e operator_model: REST, Server Actions, versões e publicação de agentes, wizard, workers, APIs de organizações. O inventário abaixo é **parcial** e precisa ser expandido antes da alteração; proibir desvio por endpoints não enumerados.
2. Adicionar migration nova forward-only com `organizations.ai_autonomy`, default JSONB com quatro flags `false`; preservar settings e grants existentes; validar tripla migration/baseline/upgrade da v1.94, constraints, permissão de escrita e testes de regressão. Nunca editar migration aplicada nem DDL diretamente em produção.
3. Implementar resolvedor fail-closed no servidor, `requirePlatformAdminEscrita` e API com CAS/auditoria; client admin de tenant não pode conceder seus próprios grants.
4. Colocar guards **antes** de qualquer escrita técnica em todos os endpoints inventariados, incluindo BYOK, onboarding e publicação; comparar contra referência lida pelo servidor. Bloquear também mutações com permissão parcial indevida; sempre manter criação inicial configurada pelo servidor para novos tenants.
5. Testes negativos/positivos por tenant, support/impersonation, RLS, conflito CAS, bypass por URL direta, e versões publicadas preservadas após revogação.

### Gate 2C — embeddings Chutes Qwen3 (PR distinta, feature desativada por padrão)

1. Portar seletivamente `OARANHA/crm-wandora/lib/ai/embeddings/chutes-qwen3-tee.ts` e testes offline do PR #121: entrada de consulta/documento, resposta limitada, timeout, vetor finito com 1.536/4.096 elementos, projeção MRL 1.536 + normalização L2, `model=chutes/Qwen3-Embedding-8B-TEE:mrl1536-l2-v1`.
2. Introduzir resolução segura de credencial da instalação no `lib/ai/embeddings/chave.ts` e `lib/ai/embed.ts`, sem fallback silencioso para família de embedding diferente. Nunca usar o modelo Gemma conversacional como embedding.
3. Garantir isolamento da base por `organization_id`, `embedding_model` e família, estratégia de nova versão/reindexação para material existente; sem misturar índices ou reivindicar compatibilidade só porque ambos geram 1.536 dimensões.
4. Contabilizar custos/limites e testar par indexar + consultar (mesma família) e canário real após publicação/health. Ligar por organização apenas após gates de credenciais, pricing e produção.

## 5. Inventário inicial de interfaces sensíveis (NÃO exaustivo)

| Interface atual verificada no GitHub | Efeito a proteger | Estado |
| --- | --- | --- |
| `app/api/v1/ai/providers/route.ts` PUT | Binding de ponto, provider/model, ativação/URL | Exige inspeção detalhada antes do guard |
| `app/api/v1/ai/credentials/route.ts` POST e rotas correlatas | Grava chave de API | Exige inventário de PUT/DELETE/validar |
| `app/api/v1/ai/agents/route.ts` POST | Cria agente e primeira versão com par técnico | Regras de criação inicial compatíveis com plano do tenant |
| `app/api/v1/ai/agents/[id]/publish/route.ts` POST | Publica versão | Referência técnica no servidor, validação antes do write |
| `app/actions/onboarding/acceptWelcome.ts` | Atribui o par de IA central ao concluir onboarding | Preservar o fluxo que já criou Felix |
| `lib/ai/embeddings/chave.ts` e `lib/ai/embed.ts` | Resolver chave/família e executar índice/consulta | Sem suporte Chutes Qwen3 atual; não alterar neste gate |

As rotas de versões, configurações da empresa, fluxos e workers precisam ser inspecionadas antes do Gate 2B. A ausência de uma rota nesta tabela **não** a torna segura.

## 6. Aceite, publicação e rollback

- CI GREEN não equivale a runtime; testes locais não equivalem a CI.
- Gate 2A não cria migration, não altera API ativa nem production.
- Gate 2B: autorização em todas as rotas técnicas, sem bypass pelo URL; Supabase migration forward-only e testes de RLS/admin; política falha fechada se infraestrutura de autorização indisponível.
- Gate 2C: unit offline primeiro; integração, índice e busca em ambiente controlado; nunca fazer chamada real ao Chutes só para investigar se logs/auditoria bastarem.
- Produção somente depois de CI green, merge, imagens app/worker/scheduler para SHA correto, deploy seguro Portainer Vigia, health/version e canário funcional. Preservar digests para rollback; nenhum build pesado na VPS.
- Reconciliar Hindsight `bank_id="Elus360"` + GitHub no início/fim de cada gate e registrar evidências úteis; sem refresh automático.

## 7. Referências e rastreabilidade

- [PR #12 — contrato e preflight integrados](https://github.com/OARANHA/elus360/pull/12), squash `a89364b51bb0b5c94bef8a1b796bc006245bf474`.
- [Doutrina de extensões](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/doctrine/extensoes.md) e [ADR-0005](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/adr/0005-plataforma-de-modulos-de-terceiro.md).
- [Governança anterior](https://github.com/OARANHA/elus/blob/main/lib/ai/governanca-da-ia.ts) e [PR #18](https://github.com/OARANHA/elus/pull/18).
- [Qwen3 anterior](https://github.com/OARANHA/crm-wandora/blob/main/lib/ai/embeddings/chutes-qwen3-tee.ts) e [PR #121](https://github.com/OARANHA/crm-wandora/pull/121).

**Estado nesta PR:** especificação PROPOSTA/EM REVISÃO; contrato puro IMPLEMENTADO e sujeito ao CI; governança no runtime NÃO IMPLEMENTADA, embeddings da instalação NÃO IMPLEMENTADOS.
