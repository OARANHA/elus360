# ELUS360 — Gate 8: contratos de integração SQL

**Estado:** IMPLEMENTADO EM PR; CI novo PENDENTE. Sem incorporação upstream, sem prepare, sem merge, sem deploy. Este documento separa benefício funcional do Gate 7 de segurança de integração ainda não comprovada.

## Proveniência

| Fonte | SHA |
| --- | --- |
| Fork main comparado | `749aaf8fbb25b46dddd9138219e2ac032cc83336` |
| DeskcommCRM base v1.94.0 | `ba24d4d366b7caf056b88553e0ed434cb0fb46de` |
| DeskcommCRM target v1.95.0 | `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36` |
| Gate 7 GREEN no fork | `45137171c2db276b8d8bd129cfaf7909e4fbabc4` |
| Migration 0601, fork e target | `eacf3a22aebe4e79e1f470421bb2aa5acb7e94a6` |
| Migration 0682, fork e target | `c2dd80dcb0d3cf1e5ab2583833a57cede77215e6` |
| Página `/admin/cobranca`, fork e target | `3349837fcf619cdea95e48e29b4176aa98630f48` |

Os blobs das duas migrations e da porta administrativa são **idênticos** entre fork e target oficial. Isso comprova identidade do código-fonte desses arquivos, não paridade de bancos implantados. O Gate 8 usa SQL do próprio fork em Docker efêmero; não copia migration ou módulo do upstream.

Gate 7 GREEN confirmado para o SHA anterior, workflows [Upstream Sync 42161629749](https://github.com/OARANHA/elus360/actions/runs/42161629749) e [AI Autonomy Migration Triple 42161629745](https://github.com/OARANHA/elus360/actions/runs/42161629745), ambos completed/success. O GREEN não é transferível para HEAD posterior.

## 1. Contrato de `emit_event`

**Fonte efetiva:** `lib/automation/actions/add-tag.ts`, `tests/invariants/add-tag-concorrente-nao-apaga.test.ts` e `tests/invariants/gov-hardening-anon-definer.test.ts`.

- Assinatura observada no call site real: `public.emit_event(text, text, uuid, jsonb, jsonb, uuid)`. Os argumentos correspondem a tipo do evento, espécie e id de entidade, payload, metadata e organização.
- Depois da junção RPC `fn_lead_adicionar_etiquetas` ou `fn_contato_adicionar_etiquetas`, a ação envia `lead.tag_added` / `contact.tag_added` **apenas quando** há `adicionadas`. O campo `caused_by_rule` serve ao anti-loop. A ausência de `ruleId` é caso adversarial, pois a interface de `ActionCtx` exige a string.
- `service_role` não tem a barreira RLS do usuário. A organização do evento deve ser `ctx.organizationId` de origem confiável. `emit_event` não substitui autorização no call site.
- O Gate 8 testa no banco real (não dublê): assinatura de seis parâmetros; papéis anon/authenticated sem EXECUTE; service_role autorizado; tentativa de forjar evento da organização B pelo usuário A; persistência em `event_log` com `organization_id`, `event_type`, `entity_kind`, `payload`, `metadata` e `status=pending`.
- `fn_lead_adicionar_etiquetas` deve ser idempotente para etiqueta repetida e responder nulo para id de outra organização. Seu SQL usa `FOR UPDATE` e lista efetiva; a função de junção **não** emite evento diretamente — isso é responsabilidade de `add_tag`.
- **Risco não eliminado:** nenhuma prova de dreno real→handler→mensageria ou deduplicação por reentrega de `emit_event`. O caso de concorrência no SQL é coberto pelo teste existente `add-tag-concorrente-nao-apaga.test.ts` e foi incluído no novo job.

## 2. Contrato de `fn_cobranca_reconciliaveis()`

**Fonte:** `supabase/migrations/20261008111858_0601_cobranca_webhook_e_avisos.sql`.

- Sem argumentos; `RETURNS TABLE(organization_id uuid, relida_em timestamptz, precisa_reler boolean)`.
- `LANGUAGE sql STABLE SECURITY INVOKER`, com `set search_path = ''`, `REVOKE EXECUTE FROM public, anon, authenticated` e `GRANT EXECUTE TO service_role`.
- Junta `cobranca_assinaturas` e `organizations`, filtrando provedor configurado e estado/checkout/suspensão. `precisa_reler` considera nulo, idade de leitura superior a seis horas e aviso final sem atualização da última hora.
- **Abrangência administrativa global deliberada:** não recebe `p_org`; a barreira de usuário está em `app/admin/(protected)/cobranca/page.tsx`, que chama `requirePlatformAdmin()` antes de usar `createAdminClient()`. Restringir silenciosamente o conjunto a um tenant é incompatível com o painel do owner.
- Diferença isolada do target: `admin.rpc("fn_cobranca_reconciliaveis").order("relida_em", { ascending:false, nullsFirst:false }).limit(1)`. O Gate 7 simulou a correção do teto de 1.000 linhas. O Gate 8 mede com PostgreSQL verdadeiro o resultado `ORDER BY relida_em DESC NULLS LAST LIMIT 1` contra `MAX(relida_em)`, linhas de três organizações, todas nulas e permissões reais.
- **Risco não eliminado:** o ensaio SQL não é uma prova HTTP/PostgREST da serialização e ordenação do RPC (nem teste de `db-max-rows` real); erro de rede/timeouts, volume real e barreiras da tela seguem como aceite específico.

## 3. Execução real planejada no CI descartável

Novo arquivo: `tests/invariants/elus-upstream-gate8-contratos-sql.test.ts`, 10 casos com identidades/organizações sintéticas, sem PII real.

Workflow `.github/workflows/elus360-upstream-sync.yml` ganhou job `gate8-contratos-postgresql-descartavel`, dependente de `contrato-upstream`. A infraestrutura reaproveitada é `scripts/test-db.sh`: imagem `pgvector/pgvector:pg15`, Docker isolado, baseline do fork aplicado duas vezes (instalação e atualização), banco dedicado por arquivo de teste e remoção de container/volume por trap.

Comando executado pelo job, quando iniciado no GitHub:

~~~bash
pnpm test:db \
  tests/invariants/elus-upstream-gate8-contratos-sql.test.ts \
  tests/invariants/add-tag-concorrente-nao-apaga.test.ts \
  tests/invariants/cobranca-reconciliacao.test.ts \
  tests/invariants/cobranca-isolamento.test.ts
~~~

Os três testes existentes verificam concorrência em transações reais, predicado/ACL da reconciliação e RLS por tenant. O arquivo novo acrescenta assinaturas (`pg_proc`), grants, execução negativa, valores nulos, persistência de eventos, isolamento e idempotência da junção. **Nenhum SQL ou migration do produto foi alterado.**

**Validação local nesta sessão:** Node/TypeScript estão disponíveis, mas Docker e `psql` não foram encontrados. Assim não há execução nativa PostgreSQL local para afirmar PASS. O workflow verifica o teste em ambiente descartável; **o resultado do novo HEAD será classificado PENDENTE até verificação independente**, sem polling.

## 4. Matriz de aceite

| Verificação | Estado |
| --- | --- |
| Gate 7, dois candidatos, VMs com dependências simuladas | **22/22 PASS**, SHA anterior |
| Migrations 0601 e 0682 iguais entre fork/target | **BLOBS CONFIRMADOS** |
| Job PostgreSQL descartável do Gate 8 | **PUBLICADO / CI PENDENTE** |
| Assinatura, ACL, RLS e `NULL` no banco real | **PENDENTE do job novo** |
| Persistência real `emit_event`, metadata e idempotência de etiqueta | **PENDENTE do job novo** |
| PostgREST HTTP e teto real 1.001 linhas | **NÃO MEDIDO** |
| Propagação worker→consumidor, replay, falhas RPC, E2E da tela | **NÃO MEDIDO** |
| 5 candidatos de adaptação e 5 bloqueados | **Mesma classificação; sem promoção** |
| 45 módulos novos | **Em revisão; sem autorização** |
| Grafo AST global | `complete:false`, permanece inconclusivo |
| Autorizados a `safe_to_prepare` | **0** |

**Proibição:** sem `prepare` v1.95.0, incorporação de upstream, merge, deploy, canário produtivo, escrita no Supabase de produção ou alteração dos contratos do ELUS. Gate 8 é investigação/validação isolada; aceite funcional integral continua **NO-GO**.

**Hindsight:** `ELUS Memory Admin` com `bank_id="Elus360"` retornou `UNAVAILABLE` em `recall`. Tentar `sync_retain` após publicar o checkpoint e, se falhar, manter `MEMORY_SYNC_PENDING`, preservando estes dados na PR.
