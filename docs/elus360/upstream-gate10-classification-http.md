# ELUS360 — Gate 10B: classificação integral 295 e prova HTTP PostgREST descartável

**Estado:** investigação e provas isoladas, sem hardening. Gate 10 GREEN confirmado somente em `50cbff0195306972f97f48688d7584744d1c1ca0` (PR #20 Draft), [Upstream Sync 42172489557](https://github.com/OARANHA/elus360/actions/runs/42172489557) e [AI Autonomy Migration Triple 42172489521](https://github.com/OARANHA/elus360/actions/runs/42172489521) `completed/success`. **CI deste novo checkpoint ainda não verificado**. Segurança e incorporação upstream **NO-GO**, `safe_to_prepare=0`, sem prepare, merge, deploy, alteração do Supabase produtivo ou contrato de produção.

## 1. Inventário real recuperado

Artefato oficial `elus360-gate10-inventory` **ID 13481543624**, workflow `42172489557`, vinculado ao SHA exato `50cbff0195306972f97f48688d7584744d1c1ca0`, SHA-256 do ZIP `680b248cd0cf90ddb8e408f7fd0389c743382e3a33eb830366335481badebc28`. Recuperado o ZIP e extraído `inventory.json`: **3.284 arquivos, 295 ocorrências, 113 caminhos**, cinco classes lexicais originais: 78 RPC, 85 SQL emit_event, 45 fn_log_event, 55 INSERT direto e 32 triggers. NÃO representam 295 emissores em execução.

Classificação **de todas as 295 entradas** por origem e linha, sem apagar nenhuma:

| Classe revista | Ocorrências | Significado e limite |
| --- | ---: | --- |
| `baseline_snapshot` | 105 | snapshot SQL do estado instalado; inclui funções e triggers, **não são 105 emissores independentes** |
| `historical_migration` | 94 | DDL, versões antigas, GRANT/REVOKE, triggers e chamadas ao longo do histórico; algumas foram substituídas; validar a definição final no catálogo |
| `runtime_rpc_callsite` | 78 | ocorrências de `.rpc("emit_event")` em **61 arquivos** app/lib/workers; código inspecionado, sem ocorrências em linhas declaradas como comentários; invocação e autorização de cada ramo não comprovadas por execução |
| `runtime_direct_insert` | 8 | oito pontos inspecionados de `event_log.insert` / SQL `INSERT INTO`: onboarding 2, incidentes 1, operator-turn 1, agent-activity 1, proposta 1, prospecting 1, wacalls 1; necessitam RLS/serviço e ownership por domínio |
| `indirect_code_or_comment_reference` | 7 | referências a função de trigger / SQL em comentários/contratos de código; não são sete novas chamadas |
| `test_instrumentation` | 3 | SQL de ferramenta E2E em `scripts/e2e-followup-journey-helpers.ts`, não produto |
| **TOTAL** | **295** | revisão por proveniência concluída, **call graph e reachability pendentes** |

Os **86 pontos operacionais em código (78+8)** são locais de chamada/verificações de fonte, NÃO 86 fluxos distintos nem autorização comprovada. A revisão por sintaxe/linha de fonte identificou explicitamente os 8 inserts diretos: `app/actions/onboarding/createDefaultAgent.ts:251`, `finishOnboarding.ts:45`, `app/api/v1/admin/incidents/[id]/resolve/route.ts:104`, `lib/agent-engine/agent/operator-turn.ts:759`, `lib/leads/agent-activity.ts:74`, `lib/propostas/aviso-de-revisao.ts:87`, `lib/prospecting/agent-setup.ts:516` e `lib/wacalls/events-bridge.ts:457`.

**Artefato permanente/CI:** `scripts/elus-upstream-gate10-classify.mjs` classifica os 295 candidatos e adiciona prioridade do efeito, preservando caminho, linha, classe original, flags `reachability_verified=false`, `authorization_verified=false`, `security_approved=false`. `tests/operational/elus-upstream-gate10-classify.test.mjs` testa as seis categorias, a cobertura de 295 e proteção contra falso-verde. O workflow gerará `gate10-evidence/inventory-classified.json` além de `inventory.json` no artefato `elus360-gate10-inventory`. O artefato JSON permite revisar cada ocorrência sem repetir 295 linhas no Markdown; **classificar não significa verificar todas as branches de autorização**.

## 2. Priorização de chamadores e cadeia de efeitos

| Prioridade | Pontos de emissão (confirmados no código) | Destino/efeito e controles adicionais a validar |
| --- | --- | --- |
| CRÍTICO — cobrança | `app/api/v1/webhooks/cobranca/[provedor]/route.ts:130` emite `cobranca.sinal`; consumidor `lib/cobranca/sinal.handler.ts` | origem de webhook e assinatura, organização da assinatura, releitura no provedor e coalescência; viewer NÃO deve poder produzir o evento diretamente |
| CRÍTICO — LGPD | `app/api/v1/lgpd/anonymize/route.ts:150`; `app/api/v1/lgpd/requests/[id]/approve/route.ts:149`; `workers/lgpd-export-worker.ts`/`lgpd-redact-worker.ts` emitem eventos derivados | aprovação de exportação, escopo/request_id por organização, anonimização; perigo de campos `manually_approved`/`approved_by` controlados por evento não confiável |
| ALTO — lead/stage | `app/api/v1/leads/[id]/move/route.ts:323`, `app/api/v1/leads/_handler.ts`, bulk, `lib/leads/agent-stage-sync.ts:472`, `lib/automation/actions/add-tag.ts:171` e trigger `fn_emit_event_on_lead_change` | automações e follow-ups, mudanças de stage/atribuição, comanda de ganho, conversões, bloqueios de loops; validar fato real no banco e role/capability |
| ALTO — mensagens/canais | `app/api/v1/messages/_handler.ts:1451`, `lib/waha/ingest.ts`, `lib/channels/meta/ingest.ts`, `lib/messaging/falha-de-entrega.ts` e canais correlatos | saída WhatsApp, notificações, IA reativa, eventos derivados; exigir conversa/mensagem/sessão na org e `before_send`/sender/canal permitidos |
| ALTO — IA | `lib/ai/handoff/orchestrator.ts:343`, `workers/ai-response-worker.ts`, `workers/ai-sentiment-worker.ts:575`, `lib/ai/runtime/*` | LLM, custos, handoff, RAG, mensagens, governança; confirmar agente/versão/contato, tenant e origem interna |
| ALTO — webhooks externos | `app/api/v1/webhooks/nuvemshop/[event]/route.ts:175`, `nuvemshop/customer-redact`, `store-redact`, além de `lib/automation/actions/call-webhook.ts` | verificação HMAC/token, mapeamento org a partir de fonte confiável, replay, proteção SSRF e exposição de payload |
| ALTO — temporais | `cron/contact-birthdays`, `lead-date-field-due`, `lead-time-triggers` | segredos do cron, regra↔entidade↔organização, deduplicação por âncora e efeitos externos |
| MÉDIO/ALTO — inserts diretos | oito pontos listados acima | nem todos passam por `emit_event`; auditar controle de `organization_id`, `status` e `metadata` separadamente |

Em consumidores, `buildContext` filtra entidades por id+org; `cobranca.sinal` consulta assinatura por org; LGPD relê o pedido por id+org e exige estado; follow-ups aplicam origem/serviço; ações de webhook podem usar payload do evento. **Nenhum desses mecanismos converte automaticamente um evento forjado em evento autorizado.** As matrizes detalhadas por tipo, papel e entidade e as alternativas de hardening permanecem em `docs/elus360/upstream-gate10-event-hardening-proposal.md`.

## 3. Prova HTTP com JWT sintético — método e isolamento

Nova suíte `tests/invariants/elus-upstream-gate10-http-jwt.test.ts`, somente no `pnpm test:db` do CI, após baseline PostgreSQL **INSTALL + UPDATE** e tripla conferência de isolamento. Roda contra **banco clonado limpo por arquivo** e container PostgREST **v12.2.3 por digest imutável** `sha256:729bf65c733b73f5b52777f0e4b853f22ed73aa67a22d38269d289779b0a8401`. Configuração `PGRST_SERVER_HOST=127.0.0.1`, `PGRST_DB_URI=127.0.0.1:TEST_DB_PORT`, `PGRST_DB_TX_END=rollback`. Nenhum domínio externo ou chaves reais. JWTs HS256 gerados somente para o teste; segredo aleatório criado durante o teste; sem PII real, envio a provedor, WAHA, IA ou worker.

**Casos HTTP (8):** sem JWT e JWT inválido (recusa), viewer A com `sub` e lead A real (controle positivo), viewer A tenta org B (recusa e `P0001`), JWT assinado sintético `role=authenticated` **sem `sub`** (observação de aceite/recusa sem assumir resultado; se admitido: `[NO-GO]`), viewer A com lead B declarado sob A, viewer A com UUID inexistente, `service_role` de teste com entidade A declarada sob B (diagnósticos de lacuna). **Todos** confirmam `event_log` sem alteração depois do HTTP; qualquer COMMIT significa falha do harness. O teste imprime `[Gate10][HTTP][NO-GO]` nos resultados que revelem admissão indevida. O status PASS desses diagnósticos **NÃO É ACEITE DE SEGURANÇA**.

**Limite essencial:** PostgREST descartável com JWT sintético **não é GoTrue, proxy Next, nem a configuração de Supabase público/produção**. Token sintético `authenticated` sem `sub` testa o comportamento da RPC sob uma implementação compatível de PostgREST; não prova que um usuário pode obter um JWT autenticado válido sem `sub` através de GoTrue, nem que a porta da RPC real está exposta. A mesma prova precisará ser confrontada separadamente com a configuração real, somente com autorização de análise read-only. **A execução HTTP ainda não foi comprovada neste checkpoint**; resultados serão registrados após CI do novo SHA, sem polling.

O docker sidecar é removido por `afterAll`; PostgreSQL e volumes pelo trap do harness. Sem alterações em runtime, SQL, função, grant ou migration para obter GREEN.

## 4. Decisões humanas obrigatórias antes de qualquer hardening

1. **Viewer:** recomendação PROPOSTA — viewer deve ler e executar apenas operações com capability aprovada; não publicar fatos operacionais arbitrários. Decidir se há compatibilidade legada que exige exceção por tipo e endpoint. **NÃO APROVADO.**
2. **Taxonomia de entidades:** grupos físicos `crm_lead`, `contact`, `conversation`, `message`, `calendar_appointment`, `cobranca_assinatura`, `lgpd_request` etc. exigem vínculo id+org comprovado e, quando aplicável, entidade relacionada (contato/conversa). Eventos agregados ou sem linha física própria (tenant, incidente, sinal externo, lifecycle de worker) exigem prova de fonte e chave externa/registro de referência tipado — **não** permitir UUID arbitrário por falta de tabela. Confirmar aliases históricos `lead` vs `crm_lead` antes de qualquer patch.
3. **service_role:** permitir somente origens internas auditáveis; organização derivada de sessão/registro/webhook validado, não do payload. Exigir validação entidade↔organização mesmo com RLS bypassada; documentar exceções por tipo, nunca waiver genérico.
4. **RPC pública vs interna:** comparar opção de RPC pública limitada a comandos, RPC interna de emissão com identidade de serviço, validação central pré-insert e consumidores defensivos. Prever rollback/compatibilidade para triggers, crons, IA, automações, eventos legítimos sem entidade física e replay.
5. **Aceite:** rejeitar entidade B sob A, inexistente, tipo incompatível, viewer sem capability, status inválido e serviço de origem não atestada; sem INSERT/efeito externo; preservar fluxos legítimos, `service_origin`, `emitted_at`, `caused_by_rule` e idempotência. Todos os testes com duas orgs sintéticas, banco efêmero e transportes falsos. **A aprovação humana da política e desenho é anterior à implementação.**

## 5. Estado, evidências e limitações

- Gate 10 do SHA anterior: GREEN, scanner original `3/3`, PostgreSQL Gates 8/9 `47/47`, TypeScript global e reconciliação read-only PASS.
- Classificação por origem: **295/295** itens do artefato oficial; 78 referências RPC revisadas por presença de chamada em arquivos e oito inserts diretos por contexto; falta validar *alcançabilidade* e *segurança* de cada ramo.
- Teste HTTP: **PROPOSTO/IMPLEMENTADO EM PR**, **NÃO EXECUTADO** nesta sessão (ambiente sem Docker, PostgREST e checkout integral). CI novo PENDENTE. Não atribuir 8/8 antes do runner.
- Hindsight: `ELUS Memory Admin` `recall(bank_id="Elus360")` retornou `UNAVAILABLE`; nova tentativa de `sync_retain` após publicação; se indisponível, checkpoint versionado com `MEMORY_SYNC_PENDING`.
- Proibido: prepare, merge, deploy, alteração no Supabase produtivo, migration, RLS, grants, função `emit_event`, runtime, incorporação upstream v1.95.0. `safe_to_prepare=0`, PR Draft, grafo AST incompleto. **Segurança NO-GO mesmo com CI GREEN.**
