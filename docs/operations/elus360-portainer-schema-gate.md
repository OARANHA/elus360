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
5. Verificar `elus-app`, `elus-worker`, `elus-scheduler`, dependências,
   `/api/v1/health`, versão real do runtime e endpoints autenticados.
   CI verde e healthcheck TCP, isolados, não comprovam aceite funcional.

O contrato em `deploy/elus360-schema-contract.json` é **mínimo e versionado**,
não uma auditoria completa de todas as migrations. Para v1.103.0 ou outra
release, a verificação recusa um manifesto cujo campo `release` ainda é
`v1.102.0`. Cada release deve atualizar o contrato com os campos exigidos
pelos novos handlers e conferir a cadeia completa de migrations.

**Importante:** Este gate por si só não executa DDL e não aciona o Portainer.
É uma proteção reutilizável de pré-deploy, **não é ainda uma implantação
atômica automatizada**. O orquestrador futuro deve torná-lo obrigatório após a
etapa de migrations e antes de modificar qualquer imagem. Não confundir
este documento com garantia de backup ou com execução automática do upstream.
