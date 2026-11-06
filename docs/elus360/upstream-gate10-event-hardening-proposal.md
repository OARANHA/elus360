# ELUS360 — Gate 10: mapa de emissão, efeitos e proposta de autorização

**Escopo:** INVESTIGAÇÃO / ESPECIFICAÇÃO / PROVAS ISOLADAS. **NÃO é implementação de hardening.** PR #20 permanece Draft, sem merge; `safe_to_prepare=0`, grafo AST incompleto, incorporação upstream DeskcommCRM v1.95.0 **NO-GO**. Não editar migrations, privilégios, funções SQL, RLS, runtime ou Supabase de produção.

## Proveniência e classificação do que foi medido

- Fork `OARANHA/elus360`, PR #20, branch `feat/elus360-upstream-reconcile-gate2-20261105`; HEAD de entrada **`5678e87fb6c0fa0e75e6bdf443a8f3578b0650d8`**; fork main `749aaf8fbb25b46dddd9138219e2ac032cc83336`. Upstream `melgarafael/DeskcommCRM` main consultada `fcbe56a3ede3fbb07e41f9b04d5dd247ace54427`; pins de reconciliação seguem v1.94.0 `ba24d4d366b7caf056b88553e0ed434cb0fb46de` e v1.95.0 `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36`.
- Gate 9 automatizado **GREEN no SHA de entrada**, [Upstream Sync 42169632675](https://github.com/OARANHA/elus360/actions/runs/42169632675) e [AI Autonomy Migration Triple 42169632678](https://github.com/OARANHA/elus360/actions/runs/42169632678), ambos `completed/success`. PostgreSQL **47/47**, sendo Gate 9 13/13, Gate 8 15/15, três suites antigas 19/19. Os **quatro testes LACUNA reproduzem riscos** com rollback; um PASS não significa seguro. Esses workflows NÃO testam a implantação de controles do Gate 10.
- Autoridade: `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, `docs/specs/07-spec-events-workers.md` (blob `8b68cdfd5bc86c69cf6f2126feef13ed001ad0dc`), `docs/elus360/extension-contract.md`, `docs/elus360/upstream-gate9-event-boundary.md`; skills ELUS e DeskcommCRM consultadas; Hindsight `Elus360` indisponível na tentativa de recall.
- Evidência de SQL: definição final pertinente de `emit_event` e `fn_service_event_contact` em `supabase/migrations/20261023150000_0743_gatilho_de_data_do_funil_alcanca_a_origem.sql` (blob `c284586f0905c6db36495b562f8382a28471107b`); migrations 0223, 0279, 0551 e 0670 são histórico, não substituir a última definição por uma anterior. O baseline real foi testado pelo Gate 9.
- **ALCANCE DO INVENTÁRIO:** tabela abaixo registra emissores/consumidores comprovados por inspeção dos arquivos nomeados no SHA de entrada. Para ampliar a cobertura sem fingir busca exaustiva, o script `scripts/elus-upstream-gate10-inventory.mjs` varre `app/`, `lib/`, `workers/`, `scripts/`, `supabase/migrations/` e `supabase/baseline.sql` e produz candidatos lexicais com caminho/linha/tipo (RPC, SQL e INSERT direto). O artefato do novo CI ainda é **PENDENTE**; tem falsos positivos em comentários e definições históricas e não descobre necessariamente chamadas dinâmicas/reflexivas. **Não declarar 100% do repositório auditado sem revisar o artefato e localizar cada chamador indiretamente.**

## 1. Inventário verificado de emissores / origem / efeito

| Emissor e caminho | Identidade/entrada | Organização e entidade originadas de | Tipos publicados / efeito conhecido | Prova e lacuna |
| --- | --- | --- | --- | --- |
| `app/api/v1/contacts/_handler.ts` | REST/MCP autenticado pelo contexto do handler | `ctx.organization_id`, contato relido por id+org | eventos de contato/telefone e atualizações de CRM | há filtros por org, mas auditoria de TODOS os ramos do handler é pendente |
| `app/api/v1/messages/_handler.ts` | handler canônico com contexto de serviço/ator | organização da conversa relida, `c.organization_id` | `message.sent`; outros módulos podem consumir o fato | relê conversa por org, verifica service boundary; não trocar por produtor paralelo |
| `lib/automation/actions/add-tag.ts` | ação de regra do motor | `ctx.organizationId`, alvo lead/contato da regra | `lead.tag_added`/`contact.tag_added`; pode realimentar automações | RPC tenant-scoped para unir etiquetas e `caused_by_rule` no evento |
| `lib/ai/handoff/orchestrator.ts` | orquestrador administrativo de handoff | `input.organizationId`, conversa e boundary | `ai.handoff_triggered`, Realtime e atividade | verifica boundary; revisão de propagação do payload necessária |
| `workers/ai-sentiment-worker.ts` | worker com admin client após `message.received` | `event.organization_id`/mensagem consultada | `ai.sentiment_alert`; handoff de IA posterior | lookup de message por org, efeitos downstream separados |
| `app/api/v1/cron/contact-birthdays/route.ts` | Cron INTERNAL_SECRET | organização lida das regras; contato na org | `contact.birthday`; automação e envio WhatsApp | segredo protegido; deduplicação no `event_log` por org |
| `app/api/v1/cron/lead-date-field-due/route.ts` | Cron INTERNAL_SECRET | org da regra e lead relido por org | `lead.date_field_due`; automação / mensagem | evento de relógio reservado a servidor; idempotência por regra/fato |
| `app/api/v1/cron/lead-time-triggers/route.ts` | Cron INTERNAL_SECRET | org da regra/lead no DB | `lead.silent_for`, `lead.stage_stale`; automação | duplicação controlada por regra/âncora no log |
| `app/api/v1/webhooks/nuvemshop/[event]/route.ts` | Webhook HMAC validado | `integration.organization_id`, integração vinculada | `nuvemshop.*`, evento do provedor | valida HMAC e dedup por provedor/org; mapping de entidade específico requer teste |
| `app/api/v1/webhooks/cobranca/[provedor]/route.ts` | Webhook provedor (assinatura/token), não sessão de viewer | organização da assinatura resolvida no DB | `cobranca.sinal`; releitura do provedor | exige revisão do parse de provedor, replay e rate limit; custo não é assinatura cobrada automaticamente |
| `lib/schemas/webhooks.ts` + triggers SQL `fn_emit_event_on_lead_change` | Trigger de mutação do negócio, interno ao Postgres | `NEW.organization_id`, lead alterado | `lead.won/lost/reopened/assigned` via `fn_log_event` | compatibilidade de `entity_kind='lead'` no trigger vs `crm_lead` no motor; não permitir spoof por viewer |
| `app/api/v1/webhooks/in/[token]/route.ts` | captação autenticada por token de caminho e assinatura configurada | source.organization_id resolvido pelo token | criação de lead e gatilhos decorrentes | não observado `emit_event` direto neste caminho; pode alcançar triggers e eventos derivados |
| `app/api/v1/webhooks/waha/[token]/route.ts` e `app/api/v1/webhooks/meta/[token]/route.ts` | token vinculado à sessão + assinatura | sessão obtida pelo token, não do body | inbound persistido e eventos `message.received` por fluxo de ingestão | prova indireta: olhar `lib/waha/ingest.ts`/adapters e triggers SQL; não atribuir RPC direta sem evidência |

**Regra de inventário:** `emit_event` direto, `fn_log_event` em trigger, `event_log` por ingestão e tarefas de worker são mecanismos distintos. O scanner cataloga referências; não assume que `rpc('emit_event')` cobre todos os produtores do bus. A revisão de caminhos de emissão indiretos permanece pendente até varredura de artefato e rastreio no código.

## 2. Matriz verificada de consumidores e efeitos

| Consumidor registrado / arquivo | Eventos | Efeito | Validação encontrada e lacuna |
| --- | --- | --- | --- |
| `lib/automation/engine.handler.ts` → `engine.ts` | `TRIGGER_EVENTS` de `lib/schemas/webhooks.ts` | executa regras e ações (tags, envio WhatsApp/IA/e-mail, webhooks, criar/mover lead) | filtra regras por `row.organization_id` e hidrata entidades por id+org; guard `entity_kind`. **Não recusa toda regra sem entidade válida**, pois algumas usam payload; canal inativo tem gate anterior |
| `lib/automation/actions/send-whatsapp.ts` | ação indireta | `sendMessageHandler`, saída real no canal | valida contato/consentimento, service boundary, org da regra; verificar `before_send`/controles comerciais do caminho |
| `lib/automation/actions/send-ai-message.ts` | ação indireta | geração paga de IA, mensagem WhatsApp, possível handoff | valida org/contato, limites e restrições comerciais, sem atravessar a cadeia `before_send` literalmente nesse percurso; gates devem ser equivalentes |
| `lib/automation/actions/call-webhook.ts` | ação indireta | HTTP POST externo com payload de `row.payload` | filtra campos internos conhecidos, configura assinatura, bloqueio SSRF/redirect; **payload é entrada do evento, não prova de origem** |
| `lib/followup/gatilho-lead.handler.ts`, `gatilho-etapa.handler.ts`, `gatilho-caso.handler.ts`, `gatilho-presenca.handler.ts` | `lead.created`, `lead.stage_changed`, `ai.case_opened/closed`, `appointment.outcome_confirmed` | inicia/avança follow-up e pode culminar em mensagens | service boundary via `serviceForEvent` e filtros org nos lookups verificados; não comprova efeitos posteriores de todos os nós |
| `workers/ai-response-worker.handler.ts`, `ai-sentiment-worker.handler.ts` | `message.received` | resposta por IA, sentimento, custos e eventos derivados | mensagem lida por org, evento inbound reservado; executar E2E só após aprovação |
| `workers/ai-handoff-from-sentiment.handler.ts` | `ai.sentiment_alert` | handoff/alteração da conversa | `serviceFromMessage(admin,row.organization_id,messageId)` e leitura do lead por org, mas guarda do efeito completa não foi ensaiada |
| `lib/cobranca/sinal.handler.ts` | `cobranca.sinal` | `sincronizar(admin,row.organization_id)` consulta provedor e atualiza estado | lookup assinatura `organization_id`, coalescer 30s, sem cobrança direta; **viewer pode gerar custo de releitura/ruído na própria organização** |
| `lib/financeiro/comanda-do-ganho.handler.ts` | `lead.won` | cria comanda interna e auditoria | relê lead e pipeline por id+org; evento reservado a trigger |
| `lib/conversoes/envio.handler.ts`, `etapa-meta.handler.ts`, `nascimento-meta.handler.ts` | `lead.won`, `lead.stage_changed`, `lead.created`, retry | reporte Meta/Google de conversões, rede externa | verificações por organização e lead em consumidores examinados; replays precisam de idempotência |
| `workers/lgpd-export-worker.handler.ts` → `lgpd-export-worker.ts` | `lgpd.data_request_received` | gera arquivos sensíveis e pode enviar email | exige `manually_approved=true`, `approved_by`, request na org e claim; conferir também origem confiável da marca — campo em payload não é autenticação suficiente isoladamente |
| `workers/lgpd-redact-worker.handler.ts` → `lgpd-redact-worker.ts` | `lgpd.redact_received` | operação potencialmente irreversível de anonimização | procura `lgpd_requests` por id+org e tipo; requer revisão de legitimidade do pedido e impossibilidade de spoof |
| `lib/event-log/drain.ts` + `dispatcher.ts` | todos os tipos registrados | despacho, retries, dead-letter | claim otimista, `consumed_by`, status da organização; **não valida automaticamente propriedade de entidade por tipo** |

**Atenção:** os blocos acima são caminhos e verificações inspecionados, NÃO certificação de todos os consumidores. O registro completo reside em `lib/event-log/register-handlers.ts`, incluindo notificações push, canais, mídia, campanhas, casos, agenda e conversões; complementar revisão tipo a tipo antes de implementação. `service_role` ignora RLS; todo consumidor precisa tratar organização, entidade e payload como dados a verificar.

## 3. Matriz PROPOSTA de autorização — decisão humana necessária

| Família / exemplo | Origem confiável pretendida | Papel mínimo proposto | Entidade que deve existir/pertencer à organização | Decisão |
| --- | --- | --- | --- | --- |
| Evento de edição simples `lead.stage_changed`, `lead.tag_added`, `contact.tag_added` | mutação real da entidade por REST/MCP com usuário validado, emitida pelo servidor | operador com capability da mutação; **viewer NÃO automaticamente** | lead/contato em org, estado/versão/ação comprovados | **APROVAÇÃO HUMANA de viewer/capability pendente** |
| Gatilhos `lead.created` | criação confirmada por mutação/ingestão autenticada | serviço após criação ou usuário com permissão de criar lead | lead criado sob a org; id/fato exatos | rever legado e deduplicação |
| Desfechos `lead.won/lost/reopened/assigned` | trigger da mudança efetiva em `crm_leads` | exclusivamente trigger/contexto interno | `OLD/NEW` e owner/status reais; impedir spoof por `EXECUTE` | manter reserva; validar contextos de trigger/GUC |
| Mensagens `message.received`/`message.failed`/`message.sent` | ingestão com assinatura ou envio canônico confirmado | serviço interno; não viewer direto | mensagem, conversa, sessão, organização e sender canônico | reservados propostos; `message.failed/sent` exigem conferência de callers |
| Operação IA `ai.case_opened/closed`, `ai.sentiment_alert`, `ai.handoff_triggered` | runtime/worker autenticado com contexto e política ELUS | serviço interno com capability + boundary | caso, conversa ou mensagem por org | reservar família, preservar governança IA |
| Temporais `contact.birthday/phone_added`, `lead.date_field_due/silent_for/stage_stale` | cron autenticado/handler de mutação real | serviço somente | contato/lead com id + org, regra/fato e âncora idempotente | manter envios válidos, bloquear disparo arbitrário |
| Agenda `appointment.*` | mutação de compromisso autorizada/cron | sessão de usuário com permissão de agenda ou serviço interno | compromisso e contato sob org | matriz fina por status precisa aceite |
| `cobranca.sinal` | webhook de provedor verificado, callback/cron confiável | somente serviço | assinatura/provedor sob a org, replay por ID externo | **prioridade alta:** não expor via RPC genérica a viewer |
| `lgpd.data_request_received`, `lgpd.redact_received` | pedido externo assinado + aprovação humana quando exigida | serviço + autorizações LGPD específicas | request aprovado e vinculado à org; prova de origem | **prioridade crítica:** export/anonimização |
| `nuvemshop.*`, `ad_conversion.*`, `knowledge_source.updated` | provedor autenticado ou mutação interna validada | somente serviço ou capability de domínio explícita | integração, origem, conversão, documento e org | revisão por família antes de publicação |

Todos os valores **propostos**, sem efeito em banco. A existência de EXECUTE para `authenticated` e o `fn_role_at_least('viewer')` efetivo NÃO significam que o proprietário aprovou viewer como produtor universal.

## 4. Investigação autenticado com `auth.uid() IS NULL`

**Fato comprovado, restrito à simulação SQL do Gate 9:** `SET LOCAL ROLE authenticated` com `request.jwt.claims` sem `sub` produziu `auth.uid()=NULL` e aceitação pelo ramo `if auth.uid() is not null ...` da função. **Não equivale** a demonstrar que GoTrue/HTTP aceita token de usuário legítimo sem `sub`.

**Código de auth verificado:** `lib/auth/server.ts` e `proxy.ts` usam `supabase.auth.getUser()` no caminho Next autenticado; isso protege essas rotas. Porém `emit_event` com EXECUTE para `authenticated` é uma função em `public`, potencialmente disponível pelo **PostgREST diretamente**, caminho que não obrigatoriamente passa por `proxy.ts` ou `getUser()`. A exposição externa real depende de publicação do schema, roteamento, JWT e configuração atual do servidor; **não foi verificada nesta sessão**.

**Prova HTTP isolada exigida antes de aceite (ainda NÃO EXECUTADA):** subir PostgreSQL com baseline INSTALL+UPDATE e stubs fiéis de roles, PostgREST efêmero ligado somente a `127.0.0.1`, segredo JWT **de teste** e organização A/B criadas no banco descartável. Testar as mesmas requisições `POST /rpc/emit_event` com (1) sem token, (2) JWT inválido, (3) JWT válido papel authenticated SEM `sub`, (4) JWT com `sub` válido e membership A, (5) JWT com `sub` de A tentando org B, (6) serviço permitido pelo protocolo próprio. Para cada uma: HTTP status, corpo/código SQL, `auth.uid()` e contagem de linhas A/B. O caso (3) **deve falhar fechado**; se aceitar e gravar, registrar exposição HTTP comprovada, NO-GO e isolamento de rede, sem explorar endpoints reais. Os casos (1)(2) devem negar, (4) deve passar apenas para entidade A real, (5) negar P0001. **O banco/HTTP de teste precisa reproduzir grants e a função final, não só os stubs SQL.**

Não reutilizar JWT, chaves, tokens ou URL de produção; não executar contra `app.elus360`, Supabase real ou qualquer domínio público. Sem PostgREST descartável instrumentado neste ambiente, classificar prova HTTP como **NÃO MEDIDA**. Não concluir que o cenário é explorável externamente nem que é impossível.

## 5. Alternativas de hardening (PROPOSTAS, sem implementação)

| Alternativa | Benefício | Compatibilidade e risco de regressão | Parecer |
| --- | --- | --- | --- |
| A. Apenas guarda nos consumidores | impede alguns efeitos em pontos específicos | consumidores novos escapam; `event_log` continua aceitando entidades falsas; duplicação de validação | **Insuficiente como controle primário** |
| B. Apenas revogar EXECUTE de authenticated e emitir com service_role | bloqueia chamadas diretas de usuários | pode quebrar rotas/automação legítimas atualmente usando client de sessão; service_role ainda aceita entity_id incorreto; migrar emissores em paralelo requer revisão | medida isolada **insuficiente** |
| C. `emit_event` valida tipo, par entidade-evento, ownership e fonte/identidade antes do INSERT; retorno tipado | centraliza integridade e impede eventos impossíveis no log | polimorfismo de entidades, tipos de evento sem entidade física, triggers antigos `entity_kind='lead'`; latência, baseline idempotente e migrations; risco de bloquear eventos legítimos | **Componente principal preferido, sujeito a desenho humano** |
| D. Separar RPC de comandos autenticados de RPC de eventos internos, proteger canais de serviço | separa fatos reais de comandos públicos, reduz área de spoof | migração dos chamadores, aprovações e compatibilidade de versões, não automaticamente segura service_role | **Complemento preferido, após inventário completo** |
| E. Validar entity↔org e escopo também nos consumidores de alto impacto | defesa em profundidade, isola destinos e replay | não deve substituir C; exigência de serviço/entidade e gating pode causar skips legítimos | **Obrigatório para efeitos externos** |

**Composição proposta para deliberação:** C + D + E, com política explícita de viewer e regressões dos produtores legítimos. Sem a aprovação humana, **nenhuma migration/grant/runtime será escrita**, inclusive em branch isolada. O SQL final deve preservar `service_origin` e `emitted_at` sem tratá-los como prova de autorização do chamador.

## 6. Plano negativo de aceite (não implementado como hardening)

1. Entidade B real com organização A via authenticated membro A ⇒ **rejeitar** antes de INSERT; zero linha nova em `event_log`, zero `consumed_by`, zero webhook/WAHA/IA/provedor.
2. UUID inexistente na organização A ⇒ mesma recusa/zero escrita, para cada `entity_kind` suportado.
3. `entity_kind` incompatível com `event_type` ⇒ rejeitar; não confundir `lead` legado do trigger com `crm_lead` de app.
4. Falta de `sub` com `role=authenticated` (SQL e HTTP) ⇒ negar; token inválido/sem token ⇒ negar.
5. Viewer A→B, usuário removido da org, suporte read-only, anon ⇒ negar; preservar P0001/42501 quando contratos observados exigirem.
6. `service_role` com entidade B/organização A ⇒ negar pelo vínculo físico mesmo sem auth.uid; não depender de RLS.
7. Evento sensível reservado (`message.received`, `lead.won`, `contact.birthday`, `ai.case_opened`, `cobranca.sinal`, LGPD) de viewer ⇒ negar por tipo/origem; nenhum handler externo.
8. Contato e lead reais na organização A emitidos por ação legítima ⇒ manter permitido com sinal temporal, payload e metadata corretos.
9. Evento real de cron com mesma regra/âncora repetida ⇒ não duplicar envio nem consumo; conferir `consumed_by`, `requestId` e idempotência do destino.
10. Inbound assinado de WAHA/Meta/Nuvemshop e checkout provedor ⇒ manter assinatura, dedup e tenant resolvido da origem, nunca do body.
11. Envio de automação legítimo ⇒ preservar `before_send`/gates equivalentes, consentimento, service boundary, limites IA e remetente canônico.
12. Evento inconsistente injetado na fila descartável ⇒ consumidor deve `skip/reject` sem side effect, auditar motivo; webhooks e terceiros simulados com transportes falsos.
13. Teste diferencial/sabotagem controlada em banco descartável: antes do hardening os quatro probes LACUNA mostram admissão, depois **devem reprovar de forma segura**, sem apagar a caracterização histórica nem afirmar sucesso ao inverter asserção.
14. Nenhuma chamada real a WhatsApp, IA paga, provedor de cobrança, LGPD ou Supabase de produção em qualquer teste de segurança; mocks de transporte e banco efêmero.

**Critério final de segurança:** TESTADO em banco/HTTP descartável com chamadas reais por papel, ausência de escrita indevida, nenhum efeito externo não autorizado, regressões positivas e negativas em todas as famílias aprovadas; CI completo em SHA único; revisão formal humana de viewer, RPC interna/externa e entidade polimórfica. GREEN de testes de diagnóstico não substitui essa aprovação.

## 7. Evidências operacionais e continuidade

- `scripts/elus-upstream-gate10-inventory.mjs` e `tests/operational/elus-upstream-gate10-inventory.test.mjs` — somente scanner lexical e testes instrumentais, sem execução de worker/banco.
- CI `.github/workflows/elus360-upstream-sync.yml`: etapa de Gate 10 poderá gerar `gate10-evidence/inventory.json` e rodar testes de scanner, preservando os jobs anteriores. O artefato não é veredito de segurança; depende de execução do **novo HEAD**.
- A conexão Hindsight `bank_id="Elus360"` retornou `UNAVAILABLE` na tentativa de `recall`. `sync_retain` será tentado após publicação; se indisponível, `MEMORY_SYNC_PENDING`.
- **Provas ainda não executadas:** PostgREST/JWT real descartável, gravação/consumo dos efeitos com transportes falsos, cobertura total dos emissores indiretos, sabotagem, configuração completa de branch protection. Nenhum desses pontos pode ser rotulado PASS no checkpoint.
- Status de classificação das melhorias upstream não muda: `safe_to_prepare=0`; dez candidatos restantes/45 novos módulos sob revisão, grafo AST `complete:false`; nenhuma promoção, merge, deploy, `prepare`, operação no banco ou incorporação de v1.95.0.

**Decisões humanas obrigatórias:** (a) permissão exata do viewer por tipo/capability, (b) separar comando autenticado de evento interno, (c) regras de entidades polimórficas e eventos intencionalmente sem entity_id, (d) política para `service_role` e frontend PostgREST público, (e) autorização do patch e validações de aceitação. Até lá, **SEGURANÇA NO-GO**.
