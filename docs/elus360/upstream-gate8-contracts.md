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
- O Gate 8 testa no banco real (não dublê): assinatura de seis parâmetros; anon sem EXECUTE; authenticated autorizado com guards internos; service_role autorizado; tentativa de forjar evento da organização B pelo usuário A; persistência em `event_log` com `organization_id`, `event_type`, `entity_kind`, `payload`, `metadata` e `status=pending`.
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

## Incidente de contratos SQL — Gate 8 RED no HEAD b1d07450 (06/11/2026)

**CI verificado:** [Upstream Sync 42164395109](https://github.com/OARANHA/elus360/actions/runs/42164395109) `completed/failure` apenas em Gate 8 (job `127717712179`); [AI Autonomy Migration Triple 42164394920](https://github.com/OARANHA/elus360/actions/runs/42164394920) `completed/success`. O job verificou tags oficiais v1.102.0/v1.63.0, instalou e reaplicou o baseline, executou as três verificações de isolamento do kit e chegou ao Vitest. **31 testes: 27 PASS, 4 FAIL; as três suítes preexistentes PASS; novo arquivo 8/12 PASS.** Os logs não sustentam falha de produção nem regressão upstream.

### Definição SQL e fronteiras do contrato

A migration fonte `supabase/migrations/20260906030000_0223_origem_imutavel_do_evento.sql` (Git blob `7c9472ed878e4853d288dbf0268207132587ed05`) redefine `public.emit_event(text,text,uuid,jsonb,jsonb,uuid)` como `SECURITY DEFINER`, com três guardas específicas quando `auth.uid() IS NOT NULL`:

1. `message.received` é reservado, código `42501`; não é permitido forjar evento inbound de mensagem autenticado.
2. `service_origin` e `service_boundary` em payload/metadata são reservados, `42501`.
3. `fn_role_at_least(v_org_id,'viewer')` deve demonstrar membership ativo; negativa lança `P0001: caller_not_authorized_for_org`. Há, adicionalmente, `fn_support_write_allowed(v_org_id)`, que recusa `support_readonly` com `42501`.

O PostgreSQL descartável comprovou `has_function_privilege('authenticated',emit_event,'EXECUTE') = true`, `anon=false`, `service_role=true`. `EXECUTE` **não** equivale à permissão irrestrita; a RPC aceita membros ativos da organização e aplica controles no corpo. O arquivo de migration não apresenta `REVOKE` direto para essa função; a origem exata do grant efetivo deve ser obtida do catálogo `pg_proc/proacl/pg_default_acl` em ambiente descartável se houver necessidade de auditar herança de privileges. **Não presumir que foi intencional expor a função para qualquer viewer só porque o SQL aceita esse papel**: isso é uma decisão contratual a submeter à revisão de segurança.

`metadata` NÃO é preservado como objeto idêntico: o SQL grava `coalesce(p_metadata,'{}') || jsonb_build_object('emitted_at',extract(epoch from now()))`; `emitted_at` numérico é gerado no banco, sobrescrevendo valor do chamador. `caused_by_rule` é mantido quando informado e permanece ausente se omitido. Os consumidores verificados `lib/automation/engine.ts` usam `caused_by_rule` ou `request_id` para anti-loop; `lib/event-log/drain.ts` usa `created_at`, `consumed_by`, `status`, `next_attempt_at`, e NÃO usa `metadata.emitted_at` como chave de idempotência. Isto **não prova** todos os consumidores downstream, nem impede duplicação de `emit_event` em retransmissões: `emitted_at` não é chave única.

**Gap crítico de entidade:** a definição examinada faz validação de identidade, de organização e de campos reservados, mas **não consulta `crm_leads`, `contacts` ou `messages` para provar `entity_id` na organização escolhida** antes de inserir no `event_log`. Em `service_role`, autenticação de usuário não está presente e a responsabilidade recai no call site. O motor de automações ao hidratar usa `.eq("organization_id",row.organization_id)`, mas isso **não prova rejeição de emissão de entidade incoerente** no SQL. Este risco fica **NÃO RESOLVIDO / NO-GO**; nenhuma alteração à função ou grants está autorizada neste gate.

### Correção dos testes, sem mudar produção

Somente o invariante novo `tests/invariants/elus-upstream-gate8-contratos-sql.test.ts` é ajustado, sem enfraquecer a recusa cross-tenant:

- A ACL separa `emit_event` (`authenticated=true` com guard interno) de `fn_cobranca_reconciliaveis` (`authenticated=false`).
- Metadata com e sem `caused_by_rule` exige `emitted_at` numérico válido e **ausência de chave de anti-loop** quando não informada, sem apagar campos SQL.
- Cross-tenant A→B exige `P0001` e `caller_not_authorized_for_org`; anon permanece `42501` e `permission denied`, e nenhuma escrita em B.
- Adiciona três negativos/controles: execução autenticada em A por membro, rejeição de `message.received` e campos de origem reservados **sem nova escrita**, e `emitted_at` injetado/inescrutável pelo chamador.
- Mantém todos os casos de cobrança, RLS, idempotência da junção e falha SQL `22023`, além das três suítes existentes.

**Contagem esperada após mudança:** 15 casos novos (12 anteriores + 3), mais 19 casos das três suítes existentes (os logs anteriores comprovaram 31 = 12 + 19). **CI novo ainda não executado/verificado.** Não houve execução PostgreSQL local (sem Docker/psql); o workflow existente dispara os quatro arquivos no SHA do próximo commit, sem polling.

**Decisão:** Gate 8 contratual **RED no SHA anterior / CI PENDENTE no SHA corretivo**; autenticação/entidade e propagação integral ainda exigem aceite de segurança, e `safe_to_prepare=0`. **Sem mudança de SQL, RLS, grants, migrations, código produtivo, prepare, merge, deploy ou incorporação upstream.**

## Incidente e correção da infraestrutura — Gate 8 RED, 06/11/2026

- **HEAD de falha:** `93ee80f836677c7dfb315bf63966ff781bb7d62e`; execução [Upstream Sync 42163353841](https://github.com/OARANHA/elus360/actions/runs/42163353841): `completed/failure` apenas em `gate8-contratos-postgresql-descartavel` (job `127714339711`); [AI Autonomy Migration Triple 42163353917](https://github.com/OARANHA/elus360/actions/runs/42163353917): `completed/success`. `contrato-upstream` e ensaio read-only passaram.
- **Log comprovado:** Docker `pgvector/pgvector:pg15` iniciou; INSTALL `✓ install ok`, UPDATE `✓ update ok`. O próximo passo em `scripts/test-db.sh` invoca obrigatoriamente `scripts/conferir-isolamento-do-kit.sh`. O script falhou em `FATAL: não consegui saber qual é a última release publicada`; executou teardown. **Nenhum dos 15 novos testes SQL nem as três suítes existentes foi executado** neste RED.
- **Causa técnica:** o checkout do job tem `origin` no fork `OARANHA/elus360`, sem release própria. `CONFERENCIA_KIT_RELEASE` por si só não troca `origem_das_tags="origin"` no script; se a tag não existe localmente, `git fetch origin refs/tags/...` buscaria no fork, não no oficial.
- **Referências oficiais verificadas em GitHub** (releases públicas, não `main` móvel): [v1.102.0](https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.102.0) publicada em 05/11/2026, release estável mais recente na consulta de 06/11/2026; tag **anotada** `1d6dcd2b6a4295ad414d27cde30971690a5d342e` → commit `4b5815721710c9b1e99078322593838fda1ee740`, script `hostgator-setup-kit/update.sh` blob `6a229ef11d85207105e9db05b77ceab6026f39d3`. [v1.63.0](https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.63.0) publicada em 29/09/2026, último kit anterior ao filtro de tabela; tag **anotada** `093e0656a8c6895659878445018395214ab44561` → commit `0fd9bda24fac7430dbb240e87c35cc9fd7ce7633`, script blob `51a138fc616a4f562b0a3e93fe89976747e1c69c`. Ambos os scripts possuem os marcadores de isolamento usados pelo recorte.
- **Correção sem alterar harness/SQL:** novo step no **job Gate 8** faz `git fetch --no-tags --depth=1` das duas tags diretamente de `https://github.com/melgarafael/DeskcommCRM.git` para refs locais e exige os **oito checks** de tipo, tag objeto, commit e blob do `update.sh`. Só então executa o **mesmo** `pnpm test:db` com `CONFERENCIA_KIT_RELEASE=v1.102.0`. O script continua fazendo os **três** testes de isolamento (checkout, release oficial e v1.63.0), mantendo `fail-closed` para regra faltante, recorte vazio e erro de execução. Nenhuma tag do fork é presumida nem release é descoberta por API móvel durante o job.
- **Limite de medição:** a correção da origem da release foi inspecionada estaticamente; ainda **não há reexecução comprovada** de INSTALL, UPDATE, kit e Vitest no HEAD da correção. O CI novo deve informar o SHA dos workflows, passos realmente completados, contagem dos 12 casos e das três suítes e quaisquer falhas; sem resultado completo, Gate 8 continua **PENDENTE/NO-GO**.
- **Escopo protegido:** não editados `scripts/test-db.sh`, `scripts/conferir-isolamento-do-kit.sh`, migrations, `emit_event`, `fn_cobranca_reconciliaveis`, RLS, permissões, assertions ou testes pré-existentes. `safe_to_prepare=0`, PR Draft, nenhuma incorporação upstream.

## 3. Execução real planejada no CI descartável

Novo arquivo: `tests/invariants/elus-upstream-gate8-contratos-sql.test.ts`, 15 casos com identidades/organizações sintéticas, sem PII real.

Workflow `.github/workflows/elus360-upstream-sync.yml` ganhou job `gate8-contratos-postgresql-descartavel`, dependente de `contrato-upstream`. A infraestrutura reaproveitada é `scripts/test-db.sh`: imagem `pgvector/pgvector:pg15`, Docker isolado, baseline do fork aplicado duas vezes (instalação e atualização), banco dedicado por arquivo de teste e remoção de container/volume por trap.

Comando executado pelo job, quando iniciado no GitHub:

~~~bash
pnpm test:db \
  tests/invariants/elus-upstream-gate8-contratos-sql.test.ts \
  tests/invariants/add-tag-concorrente-nao-apaga.test.ts \
  tests/invariants/cobranca-reconciliacao.test.ts \
  tests/invariants/cobranca-isolamento.test.ts
~~~

Os três testes existentes verificam concorrência em transações reais, predicado/ACL da reconciliação e RLS por tenant. O arquivo novo acrescenta assinaturas (`pg_proc`), grants, execução negativa, valores nulos, persistência de eventos com metadata presente/vazia, isolamento, idempotência da junção e rejeição SQLSTATE `22023` de lista vazia sem efeito colateral. **Nenhum SQL ou migration do produto foi alterado.**

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
