# ELUS360 — Gate 10C | Parecer para decisão de segurança (SEM implementação)

**Data:** 2026-11-06. **Classificação:** PARECER / PROPOSTA — não aprovado como política, não implementado, não testado em produção. **Segurança:** NO-GO. **Upstream:** `safe_to_prepare=0`. **PR #20:** Draft, sem merge ou deploy.

## 1. Proveniência e limites

- Repositório operacional `OARANHA/elus360`; PR #20, branch `feat/elus360-upstream-reconcile-gate2-20261105`; HEAD de entrada `7b307c2a713725eefb63be0f6d77a49f4634fbc8`; `main` de entrada `749aaf8fbb25b46dddd9138219e2ac032cc83336`.
- A Gerência informou Gate 10B CI GREEN no HEAD de entrada: [Upstream Sync 42174781196](https://github.com/OARANHA/elus360/actions/runs/42174781196) e [AI Autonomy Migration Triple 42174781388](https://github.com/OARANHA/elus360/actions/runs/42174781388). **A classificação GREEN se limita àquele HEAD e aos testes de diagnóstico**, não ao novo commit documental.
- Artefato `elus360-gate10-inventory`: ID `13483435031`, criado pelo run `42174781196`, SHA `7b307c2a...`, digest ZIP publicado pelo GitHub `sha256:6b9ffa22bf358dde771e80e293b0e81e1310a656c1f9a81024f73440d27a31dc`. Inspecionados `inventory.json` e `inventory-classified.json`.
- Proveniência integral: 295/295 ocorrências classificadas: baseline 105, migrations históricas 94, RPC runtime 78, INSERT runtime 8, indiretas 7, instrumentação 3. Os **86 pontos** são ocorrências operacionais em **69 arquivos**, não 86 fluxos independentes; a classificação é lexical e não substitui AST/call graph nem execução de cada ramo.
- Feita inspeção estática dos locais de emissão nos 69 arquivos usando o HEAD de entrada. **Não foi provada a alcançabilidade real de cada ramo nem o contrato de autorização completo de cada fluxo; permanece `reachability_verified=false` / `authorization_verified=false` até análise dos chamadores e testes dedicados.** O apêndice preserva todas as 86 localizações.
- Fontes de autoridade: `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, `docs/specs/07-spec-events-workers.md`, `docs/elus360/upstream-gate9-event-boundary.md`, `docs/elus360/upstream-gate10-classification-http.md` e `docs/elus360/upstream-gate10-event-hardening-proposal.md`; SQL efetivo do baseline e redefinição 0743. Não substituir código efetivo por intenção de spec.
- Hindsight `Elus360`: `recall` e `search_knowledge_base` indisponíveis nesta rodada (`UNAVAILABLE`); **`MEMORY_SYNC_PENDING`**. Este arquivo é o checkpoint versionado.
- Configuração **somente leitura** do Supabase conectado, projeto chamado `elus`: consulta ao catálogo (sem invocar a RPC, sem JWT, sem segredo) observou `public.emit_event(text,text,uuid,jsonb,jsonb,uuid)` como `SECURITY DEFINER`, owner `postgres`, `EXECUTE` negado para `anon`, permitido para `authenticated` e `service_role`. `pg_get_functiondef` confirmou guardas condicionadas a `auth.uid() IS NOT NULL` e lookup de entidade opcional. **A associação desse projeto conectado ao runtime ELUS360 não foi documentalmente provada; o catálogo não prova publicação externa da Data API nem que GoTrue emita token sem sub.** Nenhum teste na produção.

## 2. Resultado do diagnóstico (não corrigido)

| Teste HTTP sintético em PostgREST 12.2.3 isolado | Resultado informado no Gate 10B | Leitura de segurança |
| --- | --- | --- |
| Sem JWT / assinatura inválida | Recusado | Controle negativo observado; não prova exposição pública |
| Viewer A, lead A, organização A | Aceito | Comportamento legado; **política normativa de viewer não aprovada** |
| Viewer A, organização B | Recusado | Guarda de membership da org declarada |
| `authenticated` sintético sem `sub` | Aceito | **LACUNA:** guardas dependem de `auth.uid()` não nulo; emissão real do JWT por GoTrue não provada |
| Viewer A, entidade B declarada sob A | Aceito | **LACUNA:** ausência de vínculo obrigatório entidade↔organização |
| Entidade inexistente | Aceito | **LACUNA:** origem não encontrada não bloqueia `INSERT` |
| `service_role`, entidade A declarada sob B | Aceito | **LACUNA:** bypass RLS + entidade não verificada |

Nos casos diagnósticos, houve rollback; ausência de persistência é propriedade do ensaio, **não da RPC em produção**. Os 55/55 testes PostgreSQL e 8/8 cenários HTTP reportados como PASS não encerram as quatro lacunas.

## 3. Alcançabilidade e fronteiras por família — achados estáticos

| Família | Evidência de origem e efeitos | Fronteira visível | Pendência antes de hardening |
| --- | --- | --- | --- |
| Cobrança | `app/api/v1/webhooks/cobranca/[provedor]/route.ts:130` publica `cobranca.sinal` via admin; consumidor relembra assinatura/consulta provedor | Webhook autenticado e organização da assinatura no código | Validar assinatura, replays e origem do sinal; **viewer não pode forjar custo/efeito** |
| LGPD | `app/api/v1/lgpd/anonymize/route.ts:150` usa sessão e `requireRole(admin)`; `requests/[id]/approve:149` usa admin após leitura org; workers emitem `lgpd.export_*` / `lgpd.redact_*` | Operações potencialmente irreversíveis e documentos sensíveis | Provar aprovação persistida, pedido/status e ator; nunca aceitar `manually_approved` do payload como autorização |
| Mensagens/canais | `messages/_handler.ts:1451` publica `message.sent`; ingestões WAHA/Meta/Zernio/grupos e workers publicam `media.persist_requested`, `ai_agent.dispatch_requested`, `message.send_requested`, `message.failed` | Remetente/sessão/mensagem/conversa, before_send, ledger e WAHA | Exigir message→conversation→channel_session→org e emissão por sender/ingestor interno; revisar duplicações e replays |
| IA/conhecimento | `lib/ai/runtime/agent.ts:312`, `finalize.ts:74`, `handoff/orchestrator.ts:343`, fontes de conhecimento e workers | Workers `service_role`, rotas de conhecimento com `requireRole(manager)` | Conferir agente/versão/credential e contexto; não aceitar custo ou dispatch por evento de viewer |
| CRM/automações | `leads/[id]/move:323` usa `requireRole(agent)`, `lib/automation/actions/add-tag:171` publica após gravação, triggers de desfecho existem fora das 86 chamadas runtime | Efeito de stage, follow-up, conversão, webhook e mensagens | Comprovar mudança real e owner/tenant por tipo; reservar `lead.won/lost/reopened/assigned` ao trigger |
| Webhooks | `nuvemshop/[event]:175` verifica HMAC, callback:181 e customer/store-redact:235 publicam após contexto de integração | Organização derivada da integração, não do body | Replay/idempotência e evento sem entidade física; captação e triggers indiretos não estão integralmente no inventário |
| Temporais | Três crons publicam aniversário/data/estagnação | Acesso por segredo interno; IDs de lead/contato obtidos da regra | Conferir `INTERNAL_SECRET`, regra ativa, âncora e deduplicação, nenhum disparo por RPC pública |
| INSERT diretos | Oito locais: onboarding 2, incidentes 1, operator-turn 1, agent-activity 1, propostas 1, prospecting 1, wacalls 1 | Não passam pela RPC `emit_event` | Autoridade própria e `organization_id` do contexto; um hardening apenas da RPC **não os cobre** |
| Outros | Perfil/tenant, contatos, agenda, conversas, transferência e governança MCP | Sessão, role, ator, organização e API Token variam por superfície | Validar cada entrada antes da ação; `user.mentioned` usa `conversation_note` com `entity_id` de conversa e exige contrato/compatibilidade explícitos |

**Compatibilidade observável a tratar antes de qualquer validação obrigatória:** `lead` (trigger legado) e `crm_lead` (app), eventos sem `entity_id` (`nuvemshop.*`, bulk, onboarding, publicação), `agent.operator_turn` grava `entity_kind='contact'` com valor nomeado `leadId`, `conversation_note` pode carregar ID de conversa. Não aplicar FK genérica nem regra uniforme que descarte eventos legítimos; primeiro fixar contrato tipado por evento e marcar exceções que exigem correção posterior.

## 4. Matriz de alternativas — decisão humana

| Alternativa | Segurança/alcance | Compatibilidade, custo e rollback | Parecer |
| --- | --- | --- | --- |
| A. Proteger somente consumidores | Pode barrar efeito conhecido; outras filas continuam expostas a evento falso | Espalha guardas e não corrige integridade do log | **Insuficiente isoladamente** |
| B. Revogar `EXECUTE` de `authenticated` e migrar chamadores a serviço | Reduz porta direta | Quebra RPCs hoje usadas com client de sessão; `service_role` continua podendo declarar entidade incorreta | **Insuficiente isoladamente** |
| C. Validar identidade, tipo, par evento/entidade, existência/ownership e fonte no ponto de publicação | Impede inserção inconsistente antes de consumidores | Requer tipagem de eventos virtuais e legado; migrações e guardas com teste de regressão | **Base recomendada, a aprovar** |
| D. Separar API de comandos autenticados de publicação de fatos internos | Evita tratar input de usuário como fato operacional | Migração de 78 chamadas RPC e triggers, sem ruptura abrupta; autenticação de serviço real | **Complemento recomendado, a aprovar** |
| E. Verificação adicional no consumidor antes do efeito externo | Protege mensagens, IA, cobrança, LGPD, webhook e replay | Não substitui validação de origem e deve preservar idempotência | **Defesa em profundidade recomendada** |

**Proposta sujeita à decisão humana:** C+D+E; não executar nenhuma alternativa agora. `metadata.source`, `actor_kind`, `emitted_at` e `service_origin` autoatribuídos não constituem prova de autorização. Um evento deve representar fato efetivamente persistido, não declaração de quem chamou.

## 5. Matriz normativa PROPOSTA — não aprovada

| Família | Quem poderia solicitar o comando | Quem deve publicar o fato | Vínculo mínimo a validar | Aceite mínimo |
| --- | --- | --- | --- | --- |
| Leads, contatos e conversas | Agente/manager/admin conforme capability de mutação real; viewer apenas ação explicitamente autorizada por domínio | Handler após persistir mutação ou trigger protegido | id+org, actor, versão/transição, contato/lead relacionado | Viewer sem capability e entidade de outra org negados |
| Mensagens/WAHA/mídia | Usuário autorizado no sender, provedor assinado ou worker | Sender, ingestor e worker canônicos | mensagem+conversa+canal+org; opt-out/before_send | Sem envio por spoof, replays idempotentes |
| Cobrança | Provedor validado, reconciliação/cron interno | Serviço interno com assinatura/ID externo | assinatura+org+provedor+replay key | Viewer não publica `cobranca.sinal` |
| LGPD | Titular/operador via pedido formal; aprovação por autoridade do domínio | Handler LGPD/worker interno, condicionado ao pedido aprovado | request+org+status+approval real; contato/titular se aplicável | Payload simulado não dispara export/redact |
| IA/automações | Operador com capability do domínio ou comando interno | Runtime/worker; triggers reais | agente/versão/conversa/mensagem/org; rule e boundary | Sem custo, handoff ou envio a partir de evento forjado |
| Cron/temporais | Configuração/agenda válida, não emissão direta por cliente | Cron autenticado e deduplicado | regra+entidade+org+âncora | Repetição não duplica efeito |
| Webhooks/integrações | Provedor externo autenticado | Adaptador/handler após verificar assinatura e integração | integração+org+external_id; tipos virtuais conforme contrato | Replays/inválidos sem efeito |
| Admin/onboarding/outros | Usuário da organização ou platform admin com capability específica | Handler/serviço ou transação SQL com auditoria | organização e recurso específicos; contexto de suporte | Sem transposição de tenant |
| Inserções diretas | Nunca por payload arbitrário | Serviço interno com contrato próprio | mesmos gates de entidade/org e event_type | Cobertura equivalente à RPC |

**Viewer:** proposta é **não poder publicar `emit_event` diretamente**; pode executar comandos de negócio explicitamente aprovados (inclusive ações de leitura ou outras capacidades legítimas), e o servidor publica o fato após a mutação autorizada. Qualquer exceção legada por evento/capability exige decisão humana específica. Não alterar o comportamento atual por inferência.

**Entidades:** `crm_lead/lead`, `contact`, `conversation`, `message`, `calendar_appointment`, `lgpd_request`, `ai_agent_run`, `ai_knowledge_source`, `proposal` e equivalentes físicos exigem registro real na organização, além de referências dependentes. `organization` exige id igual à org do contexto e prova de origem; `user` exige membership/identidade conforme o evento; tipos virtuais/agregados exigem correlação a registro, callback assinado, job ou execução interna identificável, não UUID fictício.

**service_role:** bypass de RLS NÃO exime de origem de serviço confiável, contexto org derivado do registro, validação de entidade, tipagem de evento e auditoria. O chamador não pode declarar livremente `organization_id` a partir do payload. Triggers de fato do negócio têm autoridade diferente de RPC exposta a usuário.

## 6. Plano de migração compatível (para aprovação futura, não executado)

1. **Gate humano:** aprovar política viewer, taxonomia tipo↔entidade, origens internas e exceções legadas; apontar owner por família. Até então nenhum patch.
2. **Mapa de alcance:** para cada linha do apêndice, percorrer entrada → autenticação/role → client Supabase → entidade/org → RPC/INSERT → handlers → efeito. Executar testes de branch e classificar `reachable`, `unreachable`, `conditional` ou `unknown`; não inferir seguro a partir de ausência de teste. Incluir emissões indiretas (triggers).
3. **Contratos e testes de caracterização em DB descartável:** preservar fluxos positivos atuais, reproduzir os quatro negativos HTTP e efeitos com transportes falsos; eventos sem entidade física e aliases recebem fixture explícita.
4. **Mecanismo central planejado:** validar tipo, origem, ator, entidade/org e dados relevantes antes de INSERT; comandos da sessão permanecem sob auth+RBAC, eventos internos exigem fronteira de serviço separada. Modo diagnóstico de sombra **sem duplicar mensagens/eventos** se necessário para medir compatibilidade.
5. **Migração de produtores por família:** cobrança/LGPD/mensagens primeiro por impacto, depois IA/automação/webhooks/temporais, depois os demais e oito INSERT diretos. Preservar idempotência, ledger, retries, `service_origin`, `caused_by_rule`, `emitted_at` e triggers legítimos; nenhuma origem migra sem teste de ponta a ponta isolado.
6. **Schema:** somente quando autorizado, migration nova + baseline idempotente + `-- manifest: ...`, revisão de GRANT/REVOKE e função final, sem modificar migrations aplicadas. Não remover RPC legada antes de migrar e validar todos os chamadores; não abrir uma segunda porta universal.
7. **Rollback:** preservar definição e grants anteriores no pacote versionado, com plano de reversão compatível de DB/runtime. Reverter código e grants de modo coordenado e, se necessário, suspender somente consumo de efeitos externos até revalidar; **não reabrir indefinidamente emissão insegura como fallback silencioso**. Sem replay automático de eventos suspeitos ou envio duplicado.
8. **Gates:** branch isolada → testes unitários/invariants/PG15+17/HTTP sintético (sem produção) → PR → CI no SHA exato → revisão adversarial → decisão humana → merge/imagens/deploy saudável → canário deliberado. CI GREEN de diagnóstico NÃO é gate de lançamento.

## 7. Matriz de aceite por família (planejada)

| Domínio | Prova positiva obrigatória | Provas negativas obrigatórias | Reversibilidade/efeitos |
| --- | --- | --- | --- |
| Geral RPC | `authenticated` válido pode executar somente comando permitido; serviço interno emite fato real | Sem JWT, assinatura inválida, `authenticated` sem sub, viewer sem capability, org B sob A, entidade inexistente, tipo/entity incompatível | zero INSERT e zero dispatch antes do guard; rollback de banco descartável |
| Leads/contatos | Mutação real cria um fato exato, com origem e assinatura de contexto | Fato não ocorrido, lead de B sob A, ID direto, status divergente | sem follow-up/ganho/conversão por spoof; idempotência |
| Cobrança | Callback validado produz sinal único e reconciliado | viewer forja sinal, HMAC inválido, external_id duplicado | sem chamadas a provedor por evento falso |
| LGPD | Pedido e aprovação verificados produzem um trabalho único | request não aprovado, request B sob A, `manually_approved` de payload, replay | zero export/redact/enviar indevido |
| Mensagens/canais | Ingestão/autorização de envio verdadeira, media e sessão coerentes | mensagem alheia, sessão incorreta, destino opt-out, spoof de `message.send_requested` | zero WhatsApp indevido, ledger correto |
| IA/automações | Agente/versão/regra válidos, um job legítimo por fato | agente de outra org, event_type arbitrário, regra inexistente, replay | zero LLM custo/transferência por spoof |
| Webhooks e cron | Origem assinada ou cron autenticado, registro/âncora real | assinatura inválida, entidade órfã, relógio de outra org, replay | zero HTTP externo indevido |
| INSERT direto | Evento gravado por serviço correto e org/entidade consistente | usuário ou serviço com entidade/org incongruente | mesmo padrão de integridade do bus |

**Evidências de aceite exigidas:** resultado e contagens de INSERT/consumer/ledger por cenário, corpo de erro tipado, mesma entrada no teste de regressão; nenhuma autorização a partir de metadado do próprio evento; sem tokens reais, PII real, WAHA real ou endpoint público. Medir impacto de latência da validação central e registrar matriz de compatibilidade com 86 pontos e triggers adicionais.

## 8. Perguntas de decisão humana — TODAS PENDENTES

- **D1 — Viewer:** somente leitura/ações de domínio autorizadas sem publicação direta, ou exceções explícitas por tipo? Quem aprova cada exceção?
- **D2 — Evento como fato:** quais pares `event_type/entity_kind` exigem prova de mutação e quais são observabilidade/sinais sem entidade física?
- **D3 — Identidade:** que tipos exigem contato/conversa/mensagem/lead/compromisso e referências cruzadas? Como compatibilizar `lead` legado, `crm_lead`, `conversation_note` e ausência de `entity_id`?
- **D4 — Serviço:** quais componentes têm identidade de serviço confiável e quais eventos exigem exclusivamente serviço/trigger? Como limitar `service_role` por tenant e origem?
- **D5 — Fronteira externa:** escolher C+D+E ou outra composição, preservando compatibilidade de 78 RPCs e oito INSERTs?
- **D6 — Infra:** confirmar por configuração read-only que schema `public` e `emit_event` estão realmente publicados ao cliente externo na implantação ELUS360; identificar mapeamento inequívoco do banco conectado ao runtime. Não testar RPC pública nem autenticar com token real nesta rodada.
- **D7 — Aceite/rollback:** aprovar ordem de migração, isolamento do rollback, canários e critérios por família antes de qualquer mudança.

**Decisão técnica recomendada para deliberação:** C+D+E, viewer sem publicação de fatos arbitrários, entity↔org comprovada, emissão interna por origem autenticada e consumers com guardrails próprios. **Essa recomendação NÃO é aprovação humana.** Permanecem `security_approved=false`, `safe_to_prepare=0`, segurança **NO-GO**.

## Apêndice A — 86 localizações operacionais (inspecionadas apenas estaticamente)

Cada linha preserva a ocorrência do classificador; **não classifica alcançabilidade ou autorização como provadas**. Fonte completa: artefato `elus360-gate10-inventory`, `inventory-classified.json`, run `42174781196`.

| Arquivo:linha | Emissão | Família (triagem) | Estado da prova |
| --- | --- | --- | --- |
| `app/actions/onboarding/createDefaultAgent.ts:251` | INSERT SQL | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/actions/onboarding/finishOnboarding.ts:45` | INSERT SQL | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/actions/settings/atualizarInterfaceDaEmpresa.ts:157` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/actions/settings/updateProfile.ts:69` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/actions/settings/updateTenant.ts:86` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/admin/incidents/[id]/resolve/route.ts:104` | INSERT SQL | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/admin/tenants/[id]/route.ts:257` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/agenda/agendamentos/_handler.ts:1082` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/ai/knowledge/sources/[id]/reindex/route.ts:102` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/ai/knowledge/sources/[id]/route.ts:230` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/ai/knowledge/sources/route.ts:301` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/ai/knowledge/sources/upload/route.ts:220` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/_handler.ts:671` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/_handler.ts:898` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/_handler.ts:915` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/_handler.ts:952` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/_handler.ts:1201` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/contacts/import/route.ts:281` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/conversations/[id]/notes/route.ts:169` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/conversations/[id]/transfer/route.ts:133` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/cron/contact-birthdays/route.ts:188` | RPC | Temporal | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/cron/lead-date-field-due/route.ts:258` | RPC | Temporal | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/cron/lead-time-triggers/route.ts:324` | RPC | Temporal | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/integrations/nuvemshop/callback/route.ts:181` | RPC | Webhook | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/[id]/move/route.ts:323` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/_handler.ts:836` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/_handler.ts:1134` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/_handler.ts:1151` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/_handler.ts:1446` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/bulk/route.ts:459` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/bulk/route.ts:530` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/leads/bulk/route.ts:569` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/lgpd/anonymize/route.ts:150` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/lgpd/requests/[id]/approve/route.ts:149` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/messages/_handler.ts:1451` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/webhooks/cobranca/[provedor]/route.ts:130` | RPC | Cobrança | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/webhooks/nuvemshop/[event]/route.ts:175` | RPC | Webhook | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/webhooks/nuvemshop/customer-redact/route.ts:235` | RPC | Webhook | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `app/api/v1/webhooks/nuvemshop/store-redact/route.ts:235` | RPC | Webhook | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/agenda/google/mudanca-vinda-do-google.ts:105` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/agent-engine/agent/operator-turn.ts:759` | INSERT SQL | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/ai/handoff/orchestrator.ts:343` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/ai/knowledge/reprepara-tudo.ts:78` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/ai/runtime/agent.ts:312` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/ai/runtime/finalize.ts:74` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/automation/actions/add-tag.ts:171` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/historico/rodada.ts:731` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/marcar-conversa.ts:68` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/meta/ingest.ts:335` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/meta/ingest.ts:493` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/pos-entrada.ts:610` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/zernio/ingest.ts:444` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/channels/zernio/localizacao.ts:164` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/contacts/agenda-do-celular.ts:481` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/contacts/proposta-de-dado.ts:391` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/contacts/telefone-ganho.ts:41` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/escalacao/handoff-tecnico.ts:408` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/escalacao/retomada.ts:290` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/grupos/ingest.ts:355` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/grupos/ingest.ts:447` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/inbox/assumir-conversa-apos-envio.ts:105` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/inbox/assumir-conversa.ts:77` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/activity-write-failure.ts:52` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/agent-activity.ts:74` | INSERT SQL | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/agent-stage-sync.ts:472` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/appointment-stage-move.ts:237` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/handoff-stage-move.ts:244` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/nascimento-do-lead.ts:567` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/leads/risk-seed.ts:211` | RPC | CRM | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/mcp/tools/governance.ts:264` | RPC | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/messaging/falha-de-entrega.ts:91` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/propostas/aviso-de-revisao.ts:87` | INSERT SQL | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/prospecting/agent-setup.ts:516` | INSERT SQL | IA | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/wacalls/events-bridge.ts:457` | INSERT SQL | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/waha/ingest.ts:393` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/waha/ingest.ts:1266` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `lib/waha/ingest.ts:1755` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/ai-response-worker.ts:1260` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/ai-response-worker.ts:1285` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/ai-sentiment-worker.ts:575` | RPC | Outros | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/lgpd-export-worker.ts:492` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/lgpd-export-worker.ts:506` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/lgpd-redact-worker.ts:424` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/lgpd-redact-worker.ts:569` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/lgpd-redact-worker.ts:639` | RPC | LGPD | Inspeção estática; caminho e autorização ponta a ponta não homologados |
| `workers/media-persist-worker.ts:259` | RPC | Mensagens | Inspeção estática; caminho e autorização ponta a ponta não homologados |

**Total do apêndice:** 86 ocorrências, 69 arquivos; 78 RPC e 8 INSERT. `MEMORY_SYNC_PENDING`. Este checkpoint não aprova alterações de código, DDL, deploy, canário ou upstream sync.
