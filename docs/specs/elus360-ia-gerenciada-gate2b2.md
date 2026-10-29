# ELUS 360 — Gate 2B.2: resolvedor fail-closed (primeira parte)

> **Estado: IMPLEMENTAÇÃO PREPARATÓRIA EM PR / NÃO ATIVA NO RUNTIME.** Base: `OARANHA/elus360/main@7eef3f3fc801a22d0b6aa31adacab62365572620`, após PR #14 GREEN e merge. Não instalar ou anunciar governança real antes de todos os guards e da migração consistente.

## Contrato desta etapa

`lib/elus360/ai-managed/guard.ts` liga a política pura aprovada na PR #13 a um **leitor injetável** de autonomia por organização. Essa fronteira é reservada a chamadas do servidor e não chama automaticamente `createAdminClient()` em fluxos de usuário.

O leitor fornecido pelo chamador futuro precisa resolver a coluna `organizations.ai_autonomy` por `orgId` obtido da sessão/API Token validado, jamais do payload. O chamador verifica antes autorização RBAC, vínculo ativo do tenant, MFA/suporte, teto de API Token e origem da referência da versão técnica. O resolvedor **não** substitui esses gates e não autentica ninguém.

| Caso | Resultado |
| --- | --- |
| Organização malformada | Recusa sem consultar leitor |
| Banco indisponível, coluna ausente ou linha inexistente | Recusa `autonomia_indisponivel` |
| Referência técnica anterior indisponível | Recusa `referencia_indisponivel` |
| Pedido com provider/modelo diferente sem grant | Recusa `forbidden_platform_ai` |
| Reenvio idêntico com leitura bem-sucedida | Permitido sem grant adicional |
| Grant `true` para outro tenant | Não se herda: filtro sempre por organização autenticada |

**Nenhuma rota de configuração do tenant chama ainda este resolvedor.** Isso evita falhar parcialmente na instalação antes da migration e não confunde pré-código com segurança concluída.

### API isolada do Superadmin (adicionada nesta PR)

Foi portada seletivamente a rota `app/api/v1/admin/tenants/[id]/ai-permissions/route.ts` do ELUS anterior, adaptada aos módulos atuais. GET exige `requirePlatformAdmin` e apenas lê `ai_autonomy`. PATCH exige `requireSupportWrite` e `requirePlatformAdminEscrita` (full/MFA), corpo estrito com os quatro booleanos, leitura anterior no servidor, gravação CAS na mesma coluna e auditoria após sucesso. Uma atualização concorrente retorna conflito sem conceder permissões. Não altera `organizations.settings`.

**Não está operacional sem a migration**: a coluna `ai_autonomy` ainda não existe na instalação. Nessa condição, GET/PATCH respondem erro e não alteram grants. Nenhuma tela liga essa API e nenhuma rota de cliente teve seus guards ativados. A query de comparação de JSONB no PostgREST ainda requer teste de integração contra Postgres descartável e cenário de concorrência real; mocks não comprovam CAS no banco. Não habilitar a UI antes desses testes.

O teste `app/api/v1/admin/tenants/[id]/ai-permissions/route.test.ts` cobre suporte/escopo negados, input malformado, falta de coluna, não-escrita idempotente, CAS sem linha, auditoria e leitura isolada. Os mocks demonstram o fluxo, **não** a autenticação/MFA real nem a semântica de CAS no PostgreSQL.

## Bloqueios para ativação

1. **Preparado no código, ainda não aplicado:** migration `supabase/migrations/20261028235959_9037_elus_ai_autonomy_guarded.sql`, `-- manifest:` e apêndice idempotente em `supabase/baseline.sql`. Conteúdo anterior do baseline preservado por SHA de origem. `MANIFEST.md` histórico não foi alterado. **Revalidar** `pnpm checar:colisao-de-migration` e todas as PRs de schema no momento do merge: o número 9037 foi escolhido após exame das 97 PRs do upstream em 28/10/2026, cuja maior numeração encontrada era 9036.
2. **Validação de banco pendente:** instalar e reaplicar o baseline em PostgreSQL descartável, executar a migration isoladamente, testar trigger sob `authenticated` / `service_role`, grants, RLS, CAS JSONB via PostgREST e concorrência. Regenerar `lib/database.types.ts` após schema validado; a migration não foi aplicada a Supabase Cloud nem a produção.
3. Validar contra Postgres a API de Superadmin full/MFA já adicionada em PR: CAS e auditoria; depois adicionar painel e impedir grant por tenant, API Token, support e impersonation. Não usar `organizations.settings` como fonte de grants.
4. Integrar todos os caminhos relevantes do [inventário inicial](../elus360/ai-governance-write-surfaces.json), atualizando-o à medida que a enumeração se tornar exaustiva. Cobrir a `PATCH` de provider padrão, os métodos de credenciais, edição/publicação/duplicação de agentes, versão, onboarding e alterações do provedor da base; testar URL direta, API Tokens e concorrência.
5. Ativar apenas após coordenação schema↔código, CI green, imagens GHCR por SHA, deploy Portainer seguro, health/version e canário. Sem force/reset, sem builds pesados na VPS, sem canário antecipado.

## Reconciliação da cadeia de migrations — 28/10/2026

- Fonte versionada: `OARANHA/elus360/main@7eef3f3fc801a22d0b6aa31adacab62365572620` tinha 575 migrations canônicas quando consultada; upstream `melgarafael/DeskcommCRM/main` avançou durante a revisão e continha 578. O número 9037 foi escolhido **provisoriamente** após ler a lista de PRs abertas do upstream e seus arquivos: o maior número em voo encontrado era 9036 (PR #3648), e 9032 já estava ocupado (PR #3637). O dado é datado, não é uma reserva.
- O `baseline.sql` pôde ser recuperado integralmente pelo endpoint de blobs Git do GitHub: SHA anterior `b8beb8af8321409f2b2cbf89d9b44f2451d63cce`, aproximadamente 3,43 milhões de caracteres. O novo bloco foi acrescentado ao **final**, preservando o conteúdo anterior. Nenhuma substituição arbitrária do dump.
- Foi adotado `security invoker` no trigger, exigindo **simultaneamente** `current_user = 'service_role'` no PostgreSQL e `auth.role() = 'service_role'` no contexto JWT para a escrita pelo serviço. A verificação dupla evita que um `SECURITY DEFINER` invoque a função por um usuário comum com privilégio apenas no papel SQL. O gatilho também admite `postgres` sem usuário nem papel JWT para atividades administrativas do banco. O uso de `auth.role()` aqui é dentro de um trigger (não de uma policy RLS, na qual o Supabase recomenda o `TO`). A API de permissões exige `requirePlatformAdminEscrita` para o uso de `service_role` e compara mudanças via CAS. Essas propriedades ainda requerem **prova no PostgreSQL**; a checagem textual não confirma a autorização real.
- `tests/operational/elus360-ai-autonomy-triple.test.mjs`: verificados sintaxe, bloco único no apêndice e paridade exata com o SQL, DDL idempotente, revogação de EXECUTE público e proteção da coluna. Em execução isolada de Node 22, 4/4 passaram. Workflow próprio `elus360-ai-autonomy-triple.yml` acompanha a PR.
- **Ainda não realizados:** PostgreSQL descartável fresh/update, `pnpm checar:colisao-de-migration` com checkout completo e remotos atualizados, revisão das definições de banco efetivamente aplicadas, regeneração de tipos, Vitest/TypeScript globais, CI da PR e testes de autorização com atores reais. Nenhuma operação de banco de produção ocorreu.

## Testes e limitações

`tests/unit/elus360-ia-gerenciada-guard.test.ts` cobre falha fechada, organização inválida e isolamento lógico de grants. São testes de função com leitor mockado, **não** testes de RLS em Postgres, de autorização das APIs ou de deploy. O objetivo é fixar a semântica do adaptador para não reabrir acesso ao faltar `ai_autonomy`.

O próximo trabalho deve continuar **na mesma PR de Gate 2B.2**, adicionando migration, integração e testes pertinentes. Se o escopo exigir uma PR separada, deixar explícita a dependência e não interpretar esta PR preparatória como lançamento da governança.

Conforme exigido pelo proprietário: consultar banco de memória **`Elus360`** e GitHub ao iniciar/finalizar cada gate, gravando somente decisões, evidências e pendências úteis.

Referências:
- [Gate 2B inventário](./elus360-ia-gerenciada-gate2b.md)
- [Política pura](../../lib/elus360/ai-managed/policy.ts)
- [Contrato de extensões](../elus360/extension-contract.md)
- [Governança antiga](https://github.com/OARANHA/elus/blob/main/lib/ai/governanca-da-ia.ts)

## Continuidade da portabilidade — credenciais (29/10/2026)

Aceite funcional da governança no repositório legado `OARANHA/elus` foi confirmado pelo proprietário e não é um gate a repetir. A validação desta PR é exclusivamente a compatibilidade com a versão atual do DeskcommCRM.

- `lib/elus360/ai-managed/server.ts` porta o resolvedor do legado com concessões por `organizations.ai_autonomy`, tenant proveniente do contexto autenticado, recusa em erro de banco e bloqueio de suporte; `server.test.ts` adiciona casos de regressão (ainda sem execução Vitest comprovada).
- `app/api/v1/ai/credentials/route.ts`: GET e POST agora chamam `recusaConfiguracaoDeIa(authz.user, authz.org.orgId, "credentials", requestId)` após `requireRole` e antes do acesso sensível.
- `app/api/v1/ai/credentials/[id]/route.ts`: PATCH e DELETE usam o mesmo gate antes de qualquer alteração de credencial. Nenhum acesso por organização fornecida no payload foi introduzido.
- Conferidos os quatro pontos de chamada diretamente no GitHub, commit `4f1f2267b0071bbf6f4c94fe0207582480fd594c`. **Não houve execução de Vitest, TypeScript, teste DB ou CI desse HEAD.**
- **Dependência de ativação:** a migration da coluna `ai_autonomy` ainda não foi aplicada e, até isso acontecer, esses handlers falham fechados para tenants. A PR continua Draft; **não integrar nem publicar isoladamente**. Continuam pendentes todas as demais superfícies do inventário, CAS no PostgREST, RLS, colisões de migration, testes e coordenação schema↔código.

## Continuidade — padrão de provider/model por organização

Na PR #15, o commit `d91682cdeb43b9d68181eb6325360dad3a8768cc` restabeleceu a guarda de autonomia na rota `PATCH /api/v1/ai/providers`, tomando como referência a implementação funcional aceita pelo proprietário em `OARANHA/elus`. A rota carrega a configuração anterior de `organizations.settings` por `org.orgId` autenticado, falha fechada quando a consulta falha e exige `provider` e/ou `model` somente quando seus valores mudam, antes de gravar com `createAdminClient`.

A nova consulta faz parte do código da PR, **não** representa homologação do runtime. A comparação não é CAS de `settings`: o comportamento de concorrência e o `PUT` de bindings continuam em análise de portabilidade, assim como testes de integração no banco. Ativação ainda bloqueada até sincronizar migration, guards de todas as portas e CI. O workflow GREEN informado pelo proprietário refere-se ao momento anterior a este commit; não extrapolar para o novo HEAD.

## Continuidade — PATCH da versão de agente

A rota lê a configuração técnica da versão por organização e agente autenticados, compara a proposta validada e exige os grants correspondentes para alterações; sessão Superadmin full sem acompanhamento mantém o poder de plataforma, enquanto API Token depende dos grants da organização. A edição do prompt e o reenvio de valores técnicos idênticos não exigem autonomia técnica. A gravação condiciona status, agente, tenant e valores técnicos à leitura anterior; o prompt e o JSON de follow-up também são comparados quando enviados. `operator_model`, aceito pelo schema, passa a ser gravado após a autorização.

**Limites para ativação:** os filtros de concorrência precisam de prova em PostgREST/PostgreSQL real; outros campos de conteúdo não têm controle de versão geral. A leitura de `ai_autonomy` e a atualização da versão são requisições distintas: uma revogação de grant concorrente pode ocorrer entre as duas. Resolver atomicidade de autorização e escrita em banco, assim como as demais rotas, migration e testes de banco, antes de integrar ou publicar a governança. Esta alteração isolada não conclui o gate.

## Revisão de TypeScript após d754f520 (29/10/2026)

- Commit `ba36b68c5f79171bf8fdcfe89e2a66bed07aae79`: renomeada a variável de leitura `settings` para `settingsLidos` dentro do `PATCH app/api/v1/ai/providers/route.ts`, removendo a redeclaração com a variável `settings` usada no update.
- Ainda **não foi executado `tsc` global do HEAD** após a correção. Dois erros reportados na rota `app/api/v1/admin/tenants/[id]/ai-permissions/route.ts` ainda requerem diagnóstico concreto de linha/código TS antes de alterações, para evitar casts que escondam erro de PostgREST ou alteração indevida da política de CAS.
- O relato de 61 testes passing/0 erros lint se refere ao HEAD `d754f520` anterior à correção. CI green anterior não cobre o novo commit. A migration e os testes reais de banco permanecem pendentes. Não promover nem deployar a PR Draft.

## Inspeção da rota Superadmin — revisão posterior ao HEAD 11a27b9e

No commit `fb14f822ff0c15189153a70c4f346aeb9557aa3e`, a comparação no PATCH de `ai-permissions` passou a enumerar explicitamente as quatro chaves do contrato (`provider`, `model`, `credentials`, `operator_model`). É uma refatoração pontual que evita indexação dinâmica do resultado Zod, sem alterar a semântica de permissões.

O teste existente `app/api/v1/admin/tenants/[id]/ai-permissions/route.test.ts` valida por mocks ausência de escrita em erro, restrição a Superadmin e resposta 409 quando o update simulado não casa linha. **Ele não comprova que o filtro JSONB `.eq("ai_autonomy", JSON.stringify(...))` funciona no PostgREST real, nem a atomicidade de revogações durante outra escrita.** Não substituir esse gate por sucesso de unitários.

**Estado desta revisão:** edição commitada no GitHub; nenhuma execução TypeScript/Vitest/Postgres nesta sessão, pois não existe checkout do repositório acessível no ambiente e a tentativa de conexão Git remota falhou por DNS. Os erros exatos de TypeScript reportados no PR anterior ainda precisam ser capturados no ambiente de CI/checkout antes de afirmar correção global. Migration continua pendente; PR Draft, sem merge/deploy.

## Novas versões de agentes — integração na PR #15

Commit `94dc58eae4650d19b9721f42c0a0d33bf3e2cc7f` adicionou proteção de `POST /api/v1/ai/agents/[id]/versions`: após `resolveAuthDual`, escopo e `tetoDeEscritaDoToken`, consulta no servidor a versão de maior `version_number` filtrada por `organizationId` e `agent_id`. Compara `provider`, `model`, `credential_id` e `operator_model` com a proposta e exige grants apenas para mudanças técnicas. Uma versão sem mudança técnica segue sem exigir grants novos. Superadmin full autenticado em sessão mantém exceção; suporte não recebe bypass. Sem referência anterior, falha fechada (503), não cria uma versão arbitrária.

**Limites do novo caminho:** ainda não há prova PostgreSQL/PostgREST nem Vitest/TypeScript do novo HEAD. A referência técnica e os grants são lidos antes da inserção, sem transação única: revogação simultânea continua como risco. Entre leitura e insert, outra versão concorrente também pode ser criada; o retry de `23505` ainda não revalida a referência/grants. Esse caminho NÃO resolve o fluxo de criação inicial de agente (rota distinta). Não promover PR Draft até resolver atomicidade, schema, testes e cobertura completa.
