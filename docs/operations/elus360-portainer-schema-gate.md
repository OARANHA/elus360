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
textual com arquivo recuperável. A opção `waived` requer decisão explícita
e não implica que a reversão de schema seja segura. Antes de implantar, confirmar
cópia recuperável, esquema compatível com rollback de imagem, imagens/digests
anteriores e sequência de parada segura. Após um erro de rede na atualização,
**nunca repetir a mutação sem reconciliar a stack e o runtime**.

**Testes:** `tests/distribution/test_elus360_portainer_redeploy.py` cobre
contratos isolados e `test_elus360_portainer_upgrade_flow.py` executa o
entrypoint com simulações de Portainer/rede/Supabase para cenários de sucesso,
no-go de schema, concorrência e falha após a mutação. Passar nesses testes,
mesmo com CI verde, **não equivale** ao ensaio integrado com Docker/PostgreSQL
descartáveis nem ao aceite funcional na instalação. O workflow existente
`elus360-homologacao-descartavel.yml` confere imagens AMD64 e restore de dado
sintético, mas declara expressamente que não verifica a migração completa de
Supabase/Portainer. Permanece **NO-GO para produção** sem homologação integrada
e autorização de deploy separada.
