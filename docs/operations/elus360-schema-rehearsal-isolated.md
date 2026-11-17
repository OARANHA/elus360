# ELUS360 — Preparação de ensaio de reconciliação em PostgreSQL isolado

Escopo: PR #42 do repositório OARANHA/elus360. Este documento prepara um
ensaio, mas não executa DDL, não inicia Docker e não autoriza deploy.

## Estado de partida

Em 17/11/2026 o commit 6fd6b522d887ad40b55a73976d22187346bb3287
teve 9/9 workflows GREEN. O main permaneceu em
3d53429a536c2dc585e7c676ef79b4a280871dfd e a PR #42 aberta.
No catálogo read-only do Supabase operacional (16/11/2026), apenas 3 dos
32 requisitos de contatos/filas existiam. A verificação de CI não corrige
essas ausências e não prova compatibilidade com o runtime publicado.

## Gate offline executável

    python3 scripts/elus360-isolated-rehearsal-plan.py --mode plan

O comando produz hashes SHA-256 do baseline e das migrations de revisão,
contagem da cadeia e estado PLAN_ONLY_NO_REPLAY. Não conecta ao banco.

Para validar os insumos, obter com autorização operacional, no mesmo
ponto de corte: (1) dump custom PostgreSQL contendo SOMENTE schema public,
sem linhas de clientes, guardado em diretório privado fora do repositório;
(2) JSON com 32 linhas kind/label/present do script read-only de catálogo;
(3) SHA completo do checkout aprovado. Não armazenar o dump em GitHub.

    python3 scripts/elus360-isolated-rehearsal-plan.py --mode validate \
      --schema-snapshot /local-privado/schema-public.dump \
      --catalog-json /local-privado/catalog.json \
      --expected-sha "$(git rev-parse HEAD)"

INPUTS_VALIDATED_RESTORE_NOT_EXECUTED comprova somente verificação
preliminar de arquivos e HEAD. A assinatura PGDMP não garante que o dump
contenha apenas schema ou que possa ser restaurado; validar seu TOC
privadamente com pg_restore --list antes de avançar.

## Ensaio em banco descartável — ainda NÃO executado

1. Runner próprio de teste fora da VPS, Docker com imagem pgvector/pgvector:pg17,
   sem porta publicada, sem volumes de produção e rede --network none.
   Não fornecer credenciais de Supabase, Portainer ou ambiente operacional.
2. Reutilizar prelude de roles, auth.uid(), storage e extensões do
   scripts/test-db.sh. Restaurar apenas o schema público do dump num banco
   limpo com pg_restore --exit-on-error, documentando incompatibilidades.
3. Rodar o script elus360-schema-catalog-readonly.sql no CLONE e comparar
   com as 32 linhas do catálogo obtido no ponto de corte. Divergência
   inicial é NO-GO e obriga revisar o snapshot; não aceitar por aproximação.
4. Semear dados exclusivamente sintéticos de dois tenants para testar
   backfill dos telefones, propagação de lid, colisões de número, filas,
   composição dos vínculos, preservação de conversas e integridade.
5. Ensaiar no CLONE o caminho canônico de baseline.sql com
   ON_ERROR_STOP=1. Registrar erros, locks, diferenças estruturais e
   sobrevivência dos dados. Repetir para verificar idempotência sem
   duplicações nem regravação indevida. Este passo ainda precisa de execução
   e validação; o pré-flight não é executor de DDL.
6. Comparar o resultado com o conjunto COMPLETO de migrations e com
   tests/invariants/baseline-e-cadeia-chegam-ao-mesmo-schema.test.ts.
   Os arquivos 0801, 9043, 9048, 9062, 9084, 9214 e 9241 são apenas
   dependências já identificadas, não uma whitelist pronta para aplicação.
   Reconciliar também o restante do drift de tabelas, constraints e policies.
7. Exigir catálogo final 32/32, equivalência semântica de funções,
   RLS negativo cross-tenant, grants por papel, FK composta, índices
   válidos, dados preservados, prova de backup/restore e rollback definido.
   Aproveitar testes existentes em tests/invariants e scripts/test-db.sh,
   scripts/test-update-com-dados.sh. Sucesso apenas num baseline limpo
   NÃO prova reconciliação de banco real.

## Bloqueios de promoção

Sem snapshot privado correspondente ao estado real, ensaio de restore
executado, cobertura de todas as migrations necessárias e regressões
de RLS/dados: NO-GO. O ledger do Supabase não basta porque parte do
schema pode ter sido aplicada por baseline sem registro individual.

Nao executar scripts/elus360-portainer-upgrade.sh --schema-only como leitura:
essa opção roda DDL. A publicação de uma nova release, main/tag iguais
e qualquer mudança em Portainer exigem gates e autorização separados.
