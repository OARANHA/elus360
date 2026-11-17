# ELUS360 — Gate de esquema antes de atualizar imagens via Portainer

## Contexto

A stack GitOps `elus` no Portainer Vigia usa `APP_IMAGE`, `WORKER_IMAGE` e
`SCHEDULER_IMAGE`. Atualizar essas variáveis **não executa migrations do Supabase**.
O `hostgator-setup-kit/update.sh` executa `baseline.sql` no modo self-host,
mas **não é invocado** pelo redeploy Git do Portainer.

Incidente de 08/11/2026: imagem da release v1.102.0 referenciada no Portainer
com esquema Supabase ainda desatualizado. GET de contatos e histórico falharam
com HTTP 500. Foi necessário aplicar migrations oficiais 9041 e 9033, seguidas
de 9024, 9095 e 9092 para outras ausências documentadas.

## Regra operacional

**NÃO é permitido marcar deploy como concluído só porque os contêineres estão
healthy.** A sequência para uma release do fork `OARANHA/elus360` é:

1. Verificar GitHub Release publicada, tag imutável contida em `main`,
   todos os digests OCI AMD64 do fork e compatibilidade do changelog ELUS360.
   Changelog do Deskcomm upstream é entrada de reconciliação, não autorização
   para usar imagem do upstream na produção.
2. Comparar schema atual com o `supabase/baseline.sql` e a cadeia de migrations
   no checkout da tag escolhida. Executar migrations necessárias no banco certo
   através de procedimento de banco autorizado. NÃO usar `supabase db push`
   indiscriminadamente em banco inicializado por baseline: o histórico de
   `schema_migrations` pode não refletir o baseline.
3. Executar o gate read-only, a partir do **checkout da mesma release**:
   
   ```bash
   export ELUS360_SUPABASE_URL=https://<project-ref>.supabase.co
   export ELUS360_SUPABASE_SERVICE_ROLE_KEY=<obtida-do-gestor-de-segredos>
   python3 scripts/elus360-portainer-schema-gate.py --release v1.102.0
   ```

   Os valores são passados exclusivamente via ambiente protegido; nunca colar
   tokens em comandos persistidos, logs ou PR. Saída `ELUS360_SCHEMA_NO_GO`
   bloqueia o redeploy. A sonda usa REST `limit=0`: não lê linhas de clientes.
4. **Apenas com o schema compatível:** atualizar os três digests oficiais,
   manter as demais variáveis e dependências, `prune:false`, não fazer build
   na VPS, registrar digests anteriores para rollback. Não fazer deploy da voz
   se ela não estiver na topologia.
**SHA do Portainer durante upgrades:** `GitConfig.ConfigHash` identifica o commit
da **última implantação concluída**, não necessariamente o commit que será
implantado. No pré-deploy ele deve ser um SHA válido, ainda que anterior à
release alvo. Imediatamente antes do redeploy o controller relê a stack e
bloqueia qualquer alteração concorrente de `GitConfig`, `Env` ou identidade.
A release alvo continua obrigada a corresponder ao `main` remoto no instante
da mutação. Somente **depois** do Git redeploy a verificação exige que
`ConfigHash` seja igual ao SHA da release e que as imagens, health e versão
também correspondam ao esperado. Isso não autoriza pular o gate do banco.
Se o Portainer aceitar a ação e houver timeout, reconciliar o estado real
antes de tentar novamente — nunca repetir o redeploy cegamente.

5. Verificar `elus-app`, `elus-worker`, `elus-scheduler`, dependências,
   `/api/v1/health`, versão real do runtime e endpoints autenticados.
   CI verde e healthcheck TCP, isolados, não comprovam aceite funcional.

O contrato em `deploy/elus360-schema-contract.json` é **mínimo e versionado**,
não uma auditoria completa de todas as migrations. Para v1.103.0 ou outra
release, a verificação recusa um manifesto cujo campo `release` ainda é
`v1.102.0`. Cada release deve atualizar o contrato com os campos exigidos
pelos novos handlers e conferir a cadeia completa de migrations.

**Importante:** O script isolado `elus360-portainer-schema-gate.py` não
executa DDL nem aciona o Portainer. **Já existe** o orquestrador manual
`scripts/elus360-portainer-upgrade.sh`, exposto exclusivamente pelo workflow
`.github/workflows/elus360-portainer-upgrade.yml`: primeiro consulta a release
oficial e faz preflight sem DDL; no modo `--execute`, sob aprovação operacional,
reutiliza `reaplicar_baseline` do kit canônico, solicita recarga do PostgREST,
confirma o contrato da release e só então chama `elus360-portainer-redeploy.py`
para alterar os três digests e conferir imagens, SHA GitOps e health. O controller
não usa as imagens do Deskcomm upstream nem modifica a stack por outro caminho.

**Limites de aceite:** O fluxo **não é transação atômica** entre banco, Git e
Portainer. A política `ELUS360_BACKUP_POLICY=verified` é uma declaração do
operador, **não uma verificação automática de backup**; não confundir confirmação
textual com arquivo recuperável. A opção `waived` foi removida: o workflow
recusa renúncia ao backup. Antes de executar DDL, exigir evidência de restauração
real em banco isolado, plano de retorno e inventário de schema; confirmar
cópia recuperável, esquema compatível com rollback de imagem, imagens/digests
anteriores e sequência de parada segura. Após um erro de rede na atualização,
**nunca repetir a mutação sem reconciliar a stack e o runtime**.

**Testes:** `tests/distribution/test_elus360_portainer_redeploy.py` cobre
contratos isolados e `test_elus360_portainer_upgrade_flow.py` executa
**somente o controller Python** `elus360-portainer-redeploy.py` com chamadas
Portainer/rede/Supabase simuladas (sucesso, no-go, concorrência e falha após
mutação). **Não** executa o entrypoint Bash `elus360-portainer-upgrade.sh`,
o `reaplicar_baseline` com DDL real, nem um ambiente Portainer/PostgreSQL
descartável. O workflow de upgrade deve validar a **publicação e o SHA de
main da tag antes de fazer checkout ou executar qualquer código da release**
com segredos operacionais. Passar nesses testes,
mesmo com CI verde, **não equivale** ao ensaio integrado com Docker/PostgreSQL
descartáveis nem ao aceite funcional na instalação. O workflow existente
`elus360-homologacao-descartavel.yml` confere imagens AMD64 e restore de dado
sintético, mas declara expressamente que não verifica a migração completa de
Supabase/Portainer. Permanece **NO-GO para produção** sem homologação integrada
e autorização de deploy separada.

## Correção do transporte — 16/11/2026 (proposta para release posterior)

O operador confirmou que o transporte oficial de Portainer Vigia é a capacidade
existente **Remote-Ops-MCP**, conexão nomeada `vigia-elus`. A rota alternativa
`GitHub Actions -> HTTPS direto ao Portainer` introduzida no controlador da
PR #27 recebeu HTTP 403 até em `/api/status` nos runners externos, embora
o MCP e o operador possam acessar a stack. Não afrouxar firewall/WAF para
contornar uma mudança indevida de transporte.

O workflow `.github/workflows/elus360-portainer-upgrade.yml` agora executa
apenas `bash scripts/elus360-portainer-upgrade.sh <release> --schema-only`,
após validar a release oficial e o SHA de `main` **antes** do checkout com
segredos. A reconciliação do `supabase/baseline.sql`, o reload PostgREST e o
schema gate ocorrem no executor protegido; **nenhuma API do Portainer é
chamada pelo workflow** e o runner não recebe chave de Portainer.

Depois de `ELUS360_SCHEMA_GREEN`, a implantação continua como **gate
administrativo independente**, exclusivamente por
`Remote-Ops-MCP.portainer_stack_update_env(connection='vigia-elus', stack_id=5,
confirm_stack_name='elus', changes=[APP_IMAGE, WORKER_IMAGE, SCHEDULER_IMAGE],
replace_all=false, prune=false)`. Antes de executar, capturar em canal seguro
as referências/digests anteriores para rollback, verificar release/SHA,
conferir `GitConfig` e variáveis da stack sem alteração concorrente, preservar
segredos, obter autorização administrativa e verificar resultado sem repetir
a mutação após timeout. Após a implantação, conferir contêineres e
`/api/v1/health` com SHA exato da release. **GREEN do schema não é deploy.**

As alterações de script nesta PR não modificam a tag imutável v1.108.1.
O novo workflow requer merge, testes e nova release com tag==main
antes de poder executar com os segredos de produção. O `--execute` legado
continua fora do workflow oficial e não deve ser usado para o ambiente Vigia.

## Ampliação do contrato de runtime — PR #42 (16/11/2026)

O gate antigo da tag imutável `v1.108.1` conferiu apenas **8 tabelas /
43 colunas** e passou no Supabase hospedado. Isso **não era equivalência ao
baseline**: uma verificação de catálogo identificou, no mesmo banco, ausência
dos campos `contacts.phone_type`, `contacts.phone_whatsapp` e
`conversations.sector_id`; das tabelas `contact_phones`,
`attendant_sectors` e `attendant_sector_members`; e das funções de
telefone e escopo de setor. A API da release já usa essas estruturas.

A PR #42 amplia o manifesto read-only para **11 tabelas e 60 colunas**,
cobrando os campos efetivamente usados pelos módulos (inclui
`attendant_sectors.schedule`). O verificador continua utilizando PostgREST
`select=...&limit=0` e não lê dados de clientes. A ausência de tabela/coluna
retorna `SCHEMA_NO_GO`; um `GREEN` ampliado ainda não certifica
functions/policies/triggers/grants, dados migrados ou rollback de DDL.

As definições oficiais já existem nas migrations do fork:
- `20261029091541_9043_ficha_com_varios_telefones.sql` — campos,
  tabela, constraints, triggers e funções dos telefones. Inclui backfill,
  exigindo análise antes de qualquer execução em base populada.
- `20261026220000_0801_setores_de_atendimento.sql` — tabelas,
  FKs, policies e grants dos setores.
- `20261031180000_9062_fila_de_atendimento_destino_e_horario.sql` —
  `conversations.sector_id`, FK composta e agenda; depende de 0801.
- `20261105191500_9214_conversas_do_setor.sql` — ampliação das políticas
  de visibilidade e funções; depende das anteriores.

**Não criar um provider SQL alternativo nem aplicar somente as colunas**:
isso deixaria triggers, relações e isolamento incompletos. Antes do próximo
upgrade em produção, comparar o catálogo atual com o conjunto de migrations,
ensaiar a reconciliação em clone isolado compatível com dados existentes e
verificar backup operacional correspondente ao ponto de corte. O
`--schema-only` **executa DDL**; não é diagnóstico. O deploy de imagens
continua separado via Remote-Ops-MCP.

**Atenção à origem:** esse manifesto reforçado está na PR, NÃO na tag
`v1.108.1` já publicada. A `v1.108.2` também foi publicada a partir
do mesmo SHA de `v1.108.1`, sem o contrato reforçado desta PR. Após merge
publicar `v1.108.3` com `main == tag`, sem mover nenhuma tag anterior;
não usar a PR para
declarar que o gate de uma release imutável foi retroativamente modificado.


## Inventário de catálogo read-only — PR #42 (16/11/2026)

Nova consulta versionada: `scripts/elus360-schema-catalog-readonly.sql`. Ela
retorna 32 presenças verificáveis do runtime de **contatos com vários
telefones** e **setores/filas**: tabelas, colunas, assinaturas de funções,
policies, referência da policy `conversations_select` ao escopo de setor,
triggers habilitados, FK validada, PK, índices válidos e RLS habilitada.
Não consulta registros de tenants e não contém DDL. Execute como consulta
no SQL Editor autorizado ou em um cliente PostgreSQL **de somente leitura**.
Resultado `present=false` significa **NO-GO** para habilitar o respectivo
módulo; resultado inteiro `true` ainda é insuficiente para aceitar deploy.

**Evidência real de 16/11/2026:** Supabase hospedado com 57 migrations no
registro; os nomes oficiais `0801`, `9043`, `9062` e `9214` não figuravam
no histórico. Inventário executado via consulta SELECT em `pg_catalog`:
**3/32 presentes e 29/32 ausentes**. Presentes: as tabelas
`public.contacts`, `public.conversations` e a *assinatura* de
`fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text)`. A função pode ser
a versão anterior sem guarda de setor; a simples existência **não prova
compatibilidade semântica**. O registro de migrations também não comprova,
sozinho, ausência ou presença de DDL porque instalações por baseline não
reconstituem necessariamente o ledger.

**Dependências e riscos antes de reconciliação:**
- `0801` cria setores, membros, FKs compostas, RLS e privilégios; exige as
  chaves existentes de `organizations` e `user_organizations`.
- `9043` cria telefones extras, índices de unicidade, triggers e funções; faz
  backfill de `contacts` consultando `messages`/`channel_sessions`,
  desligando temporariamente o trigger de `updated_at` dentro de um bloco.
  Pode exigir análise de conflitos de números e bloqueios de escrita.
- `9048` e `9241` dependem dos telefones extras; `9062` depende de
  `0801` e troca a PK de membros para permitir vários setores, acrescentando
  FK composta e substituindo `fn_channel_routing_claim`.
- `9084` acrescenta cor dos setores; `9214` depende de `9062` e substitui
  `conversations_select` (RLS), o que exige cenários negativos cross-tenant
  e equivalência funcional com a policy vigente. **Não reaplicar isoladamente
  apenas a coluna ou a última policy**.
- Há outras divergências entre o baseline completo e o catálogo hospedado;
  este inventário **não** significa que as sete migrations acima constituam
  o plano de upgrade completo. Inspecionar a cadeia total, conflitos de objetos,
  segurança/permissions, custo operacional de DDL e dados em clone de staging.

**Critério de promoção:** prova de backup e restauração no ponto de corte,
drift reconciliado por migrations oficiais testadas em clone isolado, funções
e RLS semanticamente verificadas, contrato PostgREST ampliado GREEN, imagens
publicadas para uma **nova tag igual ao SHA da main**, aprovação de operação
e deploy via Remote-Ops-MCP. `--schema-only` executa DDL; nunca usá-lo
como substituto deste SELECT. Nenhuma alteração foi aplicada no banco nesta
auditoria.

