# ELUS360 — Gate 9: autorização e integridade de eventos

**Estado:** testes e matriz publicados na PR #20; execução dos testes Gate 9 no HEAD novo **CI PENDENTE**. Segurança de integração **NO-GO**. Nenhuma mudança no runtime, migrations, grants, RLS ou produção.

## Incidente Gate 9 — CI RED no HEAD d3310fac (06/11/2026)

- **Fonte comprovada:** PR #20 HEAD `d3310fac21da8f2b2f7f8dc5c16d64f0bd4f8258`, [Upstream Sync 42168468352](https://github.com/OARANHA/elus360/actions/runs/42168468352) `completed/failure` exclusivamente no job PostgreSQL descartável `127730685083`; os dois outros jobs do workflow passaram. [AI Autonomy Migration Triple 42168468392](https://github.com/OARANHA/elus360/actions/runs/42168468392) `completed/success`. TypeScript global e governança IA passaram no SHA anterior. **Vitest PostgreSQL: 46/47 PASS; Gate 9: 12/13; Gate 8: 15/15; três suítes existentes: 19/19.**
- **Único erro:** `tests/invariants/elus-upstream-gate9-emit-event-boundaries.test.ts:124` exigia diretamente `select contact_id into v_contact from public.crm_leads`, mas `pg_get_functiondef(emit_event)` instalado contém `select f.contact_id into v_contact from public.fn_service_event_contact(v_org_id, p_event_type, p_entity_kind, p_entity_id) f`. Isso é uma asserção historicamente desatualizada, não evidência de falha de isolamento.
- **Rastreio SQL efetivo:** migration `0551_aniversario_e_compromisso_alcancam_a_origem.sql` (blob `e801cafd464d6b30547d9b38d3e5c3b40fc0fee9`) criou o auxiliar `fn_service_event_contact(uuid,text,text,uuid) RETURNS TABLE(contact_id uuid,suportado boolean)`, compartilhado pelo emissor e `fn_service_event_origin`. A `0670_o_telefone_ganho_alcanca_a_origem.sql` (blob `ee8cc3ee009fd9dc0ab529b53c412316ab03ae7c`) ampliou o ramo de contatos. A `0743_gatilho_de_data_do_funil_alcanca_a_origem.sql` (blob `c284586f0905c6db36495b562f8382a28471107b`) incluiu `lead.date_field_due`, preservou os demais ramos e redefiniu `emit_event`. O retorno `suportado=true` significa que **o par evento/tipo é conhecido**, NÃO que a entidade foi encontrada; nesse caso `contact_id` pode ser `NULL`.
- **Semântica preservada:** o auxiliar filtra `organization_id=p_org` com `entity_id=p_entity_id` nos ramos de `crm_leads`, `contacts` e `calendar_appointments`. `emit_event` usa o resultado para carimbar `service_origin` **somente se houver contato válido**, mas não exige que o lookup produza entidade/contato. Caso não encontre, grava o evento sem origem. Logo o vínculo entidade–organização segue **NÃO AUTORIZADO / NO-GO**, independentemente do resultado do CI.
- **Correção limitada ao teste:** o mesmo teste passa a verificar no `pg_get_functiondef` do banco as definições do emissor e do auxiliar, inclusive os três filtros por organização; e executa o auxiliar em PostgreSQL descartável para (a) contato correto/org correta, (b) contato existente sob outra organização — `contact_id NULL` e `suportado true`, (c) tipo não reconhecido — `contact_id NULL` e `suportado false`. Mantidos **os 13 casos Gate 9**, incluindo 4 sondas `LACUNA` com `BEGIN/ROLLBACK`, os negativos P0001/42501 e os quatro arquivos existentes do job. Nenhuma asserção de segurança foi suprimida.
- **Validação no novo SHA:** CI **PENDENTE DE CONFERÊNCIA INDEPENDENTE**, sem polling. Não há Docker/psql nem checkout ELUS360 integral no ambiente atual, portanto `pnpm test:db` e `pnpm typecheck` não puderam ser executados localmente. O workflow existente dispara os dois fluxos no commit publicado. **Não inferir GREEN de commit anterior**. Se ambos GREEN futuramente, aceite de segurança seguirá **NO-GO** pelos quatro diagnósticos de lacuna e a política viewer pendente.
- **Memória:** Hindsight `Elus360` `recall` indisponível; `sync_retain` a tentar após checkpoint; se indisponível, `MEMORY_SYNC_PENDING`.



## Autoridade e pins

Fork operacional `OARANHA/elus360` PR #20 Draft. Base fork `749aaf8fbb25b46dddd9138219e2ac032cc83336`; base upstream DeskcommCRM v1.94.0 `ba24d4d366b7caf056b88553e0ed434cb0fb46de`; target v1.95.0 `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36`. Nenhuma incorporação upstream.

**Gate 8 GREEN confirmado somente no SHA `bc0318caf3e315712403135b1a0550f938ab698a`**: [Upstream Sync 42166578283](https://github.com/OARANHA/elus360/actions/runs/42166578283) e [AI Autonomy Migration Triple 42166578326](https://github.com/OARANHA/elus360/actions/runs/42166578326), ambos `completed/success`. PostgreSQL 34/34 (15 Gate 8, 19 nas três suítes anteriores), TypeScript global, kit de isolamento e reconciliação read-only aprovados. Não demonstram comportamento dos novos casos Gate 9 nem configuração completa de proteção da branch.

**Fontes do contrato:** `docs/specs/07-spec-events-workers.md` (blob `8b68cdfd5bc86c69cf6f2126feef13ed001ad0dc`), migration histórica `supabase/migrations/20260906030000_0223_origem_imutavel_do_evento.sql` (blob `7c9472ed878e4853d288dbf0268207132587ed05`) e redefinições posteriores `0279` (blob `4fd895ad393c13d0ec98601d6904ad5c640259a9`), `0551` (blob `e801cafd464d6b30547d9b38d3e5c3b40fc0fee9`), `0670` (blob `ee8cc3ee009fd9dc0ab529b53c412316ab03ae7c`) e `0743` (blob `c284586f0905c6db36495b562f8382a28471107b`), `lib/automation/actions/add-tag.ts`, `lib/automation/engine.ts`, `lib/event-log/drain.ts`, `lib/event-log/dispatcher.ts` e `tests/invariants/evento-de-negocio-so-nasce-do-negocio.test.ts`. A spec tem intenção arquitetural; o SQL/consumidores do fork demonstram o que funciona hoje.

## Política implementada vs. política pretendida para viewer

**Implementado:** `emit_event` é SECURITY DEFINER, tem EXECUTE para `authenticated`, não para `anon` (medido no Gate 8), e verifica `fn_role_at_least(v_org_id, 'viewer')` **quando `auth.uid() IS NOT NULL`**. Também consulta `fn_support_write_allowed` e impede `message.received` e campos reservados `service_origin/service_boundary` para identidade presente. O teste existente `evento-de-negocio-so-nasce-do-negocio.test.ts` demonstra que um viewer pode emitir `lead.stage_changed`, enquanto não pode forjar os eventos reservados de desfecho `lead.won/lost/reopened/assigned`. A Spec 07 prevê o bus interno escrito por ServerActions/triggers/RPC, com INSERT direto revogado para usuários.

**Não estabelecido:** a aprovação normativa de que qualquer viewer possa publicar arbitrariamente outros eventos operacionais, quais event types devem exigir papel/ação específica, e como um endpoint deve autenticar origem e entidade. **Não converter o comportamento existente em autorização humana presumida.** A política final e a eventual alteração de grants/guards são **DECISÃO HUMANA PENDENTE**, fora do escopo de Gate 9.

**Três camadas distintas:**

1. **Chamada da RPC:** `has_function_privilege` no catálogo e acesso a `emit_event`. EXECUTE não comprova autorização do evento.
2. **Organização e entidade:** validação do usuário/membership é interna; a definição efetiva da 0743 **usa `fn_service_event_contact` para consultar `crm_leads`/`contacts`/`calendar_appointments` com `organization_id`** para **tentar** anexar `service_origin`, porém **não exige que uma entidade seja encontrada**: a ausência de `v_contact` não bloqueia o `INSERT`. A consulta de origem é enriquecimento opcional, NÃO autorização de entidade. O teste Gate 9 inspeciona via `pg_get_functiondef` o corpo efetivo do baseline. `service_role` contorna RLS, e o chamador deve filtrar organização confiável.
3. **Consumo:** `buildContext` do motor filtra `crm_leads.id` E `organization_id`; o dispatcher seleciona por tipo e `consumed_by`, e o dreno trabalha com `status` e retries. A filtração em um consumidor **não conserta** evento forjado nem garante demais consumidores sem prova adicional.

## Matriz de evidências e decisão

| Camada / caso | Fonte | Resultado já demonstrado | Nova prova | Classificação |
| --- | --- | --- | --- | --- |
| `anon` tenta executar RPC | Catálogo/ACL e migration | Gate 8 recusa | chamada real, 42501, zero escrita | Negativo obrigatório |
| `authenticated` possui EXECUTE | ACL/PG Proc | Gate 8 permite | catálogo + SECURITY DEFINER | Chamada, não autorização de entidade |
| Viewer A, entidade A | `fn_role_at_least(viewer)`; teste histórico | Comportamento previsto | chamada em transação e ROLLBACK | Política humana pendente |
| Viewer B, entidade B | Membership próprio | Não medido | controle positivo, rollback | Compatibilidade sob revisão |
| Viewer A tenta publicar sob org B | Guard interno | Gate 8 P0001 sem evento | P0001 e zero escrita | Deve rejeitar |
| Revogado e sem membership | `fn_role_at_least` | Fonte SQL | negativos reais, P0001 e zero escrita | Deve rejeitar |
| Viewer A com **lead real B**, declarando org A | Ausência de lookup entidade na função | Gap no código SQL | **diagnóstico de emissão e inconsistência**, rollback | **NO-GO mesmo se PASS** |
| Viewer A com id de entidade inexistente | Ausência de FK para domínio | Gap de código | **diagnóstico de emissão**, rollback | **NO-GO mesmo se PASS** |
| `authenticated` sem JWT `sub` | Guards condicionados a `auth.uid() != null` | Hipótese lógica — não equivale a JWT externo aceito | sonda SQL com papel real e claim sem `sub` | **NO-GO se admitido; PostgREST não medido** |
| `service_role` com entidade de A declarando org B | RLS bypass | Verificação de entidade ausente | diagnóstico e rollback | **NO-GO, dependente do chamador** |
| Hidratação pelo motor | `buildContext` usa filtro por organização | Fonte TS | método real com adaptador SQL de leitura, B-lead sob org A | Mitigação parcial, NÃO autorização |
| Dispatcher e drain reais | ``event_log` + handlers` | Fonte TS | somente inspeção, sem executar worker | Side effects E2E não medidos |

### Como ler os resultados do Gate 9

O arquivo `tests/invariants/elus-upstream-gate9-emit-event-boundaries.test.ts` acrescenta **13 casos** (incluindo introspecção do SQL efetivo via `pg_get_functiondef`). Parte exige negação com ausência de escrita. **Quatro casos têm nome LACUNA e reproduzem comportamento que seria incompatível com autorização entidade↔organização completa.** O `PASS` de caso LACUNA demonstra a **existência do risco**, NÃO sua solução. O log desses testes expõe `[Gate9][NO-GO]`. Se um hardening futuro eliminar a emissão indevida, esses testes caracterizadores devem falhar até revisão da matriz, nunca ser ajustados silenciosamente para esconder a mudança.

Os casos que admitem eventos usam `BEGIN`, `SET LOCAL ROLE`, JWT sintético apenas no PostgreSQL, consultas de proveniência e `ROLLBACK` com verificação de **zero persistência após a transação**. Não processam eventos, não acessam WAHA, não enviam mensagens, não acionam handlers nem escrevem no Supabase real. A sonda `auth.uid()` nulo **NÃO comprova exposição via JWT válido/PostgREST**. O `buildContext` real é executado com um adaptador de leitura de banco descartável — isso comprova o filtro do consumer específico, não todos os efeitos downstream.

**Workflow:** `.github/workflows/elus360-upstream-sync.yml` mantém o job Gate 8 PostgreSQL com INSTALL, UPDATE e tripla conferência oficial de isolamento. Acrescenta o arquivo Gate 9, preservando `elus-upstream-gate8-contratos-sql.test.ts` e os três arquivos preexistentes de concorrência/cobrança. **Contagem esperada: 34 existentes + 13 Gate 9 = 47 casos**, não verificados ainda no novo HEAD. TypeScript global/IA no workflow irmão deverão ser conferidos no mesmo SHA; não usar o GREEN do commit anterior.

## Riscos residuais e decisões humanas

- **Permissão de viewer:** o estado implementado é permissivo para certos event types; não há decisão aprovada de quais eventos um viewer deveria emitir diretamente. Exige especificação e análise de compatibilidade antes de hardening.
- **Entidade↔organização:** a chamada RPC valida membership na org informada, mas não o ownership do `entity_id`. A validação posterior do consumer não transforma um evento inconsistente em seguro.
- **Identidade sem sub:** guardas condicionados à presença de `auth.uid()` podem deixar um ramo sem autorização de membership; avaliação externa PostgREST/JWT ainda não feita. Não inferir ataque remoto a partir de sessão SQL artificial.
- **service_role e emissores:** `add-tag.ts` deriva organização de `ctx.organizationId` e usa RPC de união por organização. É uma mitigação desse call site, não prova cobertura de todos os emissores.
- **Outros consumers:** filtragem do motor de automações não comprova webhook, IA, mensagens, auditoria, retries, compensação e envio sob `before_send`. Não executar canário real neste gate.
- **Revisão upstream:** 5 `requires_adaptation`, 5 `blocked_pending_contract_proof`, 45 módulos novos sob revisão, grafo AST incompleto. `safe_to_prepare=0`. Não promover automaticamente.

**Estado novo:** `PROPOSTO/IMPLEMENTADO EM PR` para testes e matriz; `CI PENDENTE` para o novo SHA. Ambiente local desta sessão sem Docker/psql ou checkout completo: execução PostgreSQL e TypeScript globais **não realizadas localmente**. Evidência futura do runner deverá usar SHA exato, reportar resultado real e distinguir PASS de teste caracterizador de autorização segura.

**Hindsight:** `recall(bank_id="Elus360")` indisponível (`UNAVAILABLE`); tentar `sync_retain` após o checkpoint, ou manter `MEMORY_SYNC_PENDING` versionado.

**Proibições:** PR #20 Draft; sem prepare, merge, deploy, alterações no banco de produção, migrations, grants, RLS, código runtime ou incorporação v1.95.0. **Veredito de aceitação funcional: NO-GO independente do sinal automatizado do Gate 9.**
