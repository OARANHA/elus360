# ELUS360 — Gate 7: comparação funcional controlada (sem incorporação)

**Estado:** testes e protocolo de evidências publicados na PR #20; execução do novo HEAD **PENDENTE**. Este documento **não é aceite funcional** da v1.95.0. Nenhum item vira `safe_to_prepare`, e a PR permanece Draft.

## Proveniência e autoridade

- Fork operacional: `OARANHA/elus360`, main-base `749aaf8fbb25b46dddd9138219e2ac032cc83336`; Gate 6 GREEN em `19b60be7a84da5413ecfd844d35bf13d21b146cf`.
- Upstream base DeskcommCRM v1.94.0: `ba24d4d366b7caf056b88553e0ed434cb0fb46de`. Target v1.95.0: `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36`.
- Gates confirmados nesse HEAD anterior: [Upstream Sync 42158431268](https://github.com/OARANHA/elus360/actions/runs/42158431268) e [AI Autonomy Migration Triple 42158431259](https://github.com/OARANHA/elus360/actions/runs/42158431259), ambos `completed/success`. O novo teste exige execução independente; verde anterior não se transfere.
- Autoridades: `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, `docs/elus360/extension-contract.md`, skills `elus-live-context`, `elus-doutrina`, `elus-contribuir`, `deskcomm-doutrina`, `deskcomm-contribuir`.
- Memória: `Elus360` (`recall`) retornou `UNAVAILABLE` neste gate; registrar sincronização pendente. A memória não é prova de runtime.

## Ensaio comparativo — blobs reais, sem integração

Teste: `tests/operational/elus-upstream-gate7-functional-compare.test.mjs`. Ele **não copia** arquivos do target para a árvore ELUS. Lê os objetos do Git temporário do ensaio oficial, exige SHA de commit e **blob exato**, transpila os dois módulos TypeScript e executa cada versão em contexto `node:vm` separado, com somente os imports expressamente simulados. Não tem acesso a rede, Supabase ou ambiente de produção. O dublê das RPCs não constitui medição de comportamento transacional do PostgreSQL.

O workflow `.github/workflows/elus360-upstream-sync.yml` executa o comparador **depois** da geração do `gate6-evidence.json`, no mesmo repositório Git temporário com tags e trees fixadas. O teste recusa refs ou blobs divergentes; o comando CI é:

```bash
ELUS_COMPARE_GIT_REPO="$(dirname "$ARTIFACT_DIR")/repo" \
ELUS_GATE6_EVIDENCE="$ARTIFACT_DIR/gate6-evidence.json" \
  node --test tests/operational/elus-upstream-gate7-functional-compare.test.mjs
```

O log TAP é publicado como `gate7-functional-compare.tap` no artefato `elus360-official-reconcile-plan`, com SHA-256 em `SHA256SUMS`, se o passo chegar ao fim. Em caso de falha, o TAP parcial também é coletável pelo `upload-artifact` condicionado a `always()`. **Resultados PASS do novo HEAD: NÃO MEDIDOS neste checkpoint.**

### Candidato 1 — add_tag / automações

- Fork/base: blob `22354e3e992a117e11f44bb699a2562bfc2f7b39`.
- Target: blob `45e507424de1e2bc581b0c9597d418c2f93f56a4`.
- Diff preciso: antes `p_metadata: { caused_by_rule: ctx.ruleId }`; depois cria `metadata={}` e só inclui `caused_by_rule` quando `ctx.ruleId` é truthy.
- Comparações propostas: com regra presente, mesmo evento, `p_org`, `added_tags`, origem e foto; sem regra, o target omite a chave enquanto o fork mantém uma propriedade JavaScript cujo valor é `undefined` (**ambos serializam a metadata como `{}`**); duplicata não cria evento; id de outro tenant não recebe escrita nem evento; sabotagem em memória que remove a condição deve disparar o discriminador.
- Aceite **ainda não executado**: concorrência real entre drenos no SQL `fn_lead_adicionar_etiquetas` / `fn_contato_adicionar_etiquetas`, idempotência de `emit_event`, replay, isolamento efetivo da função em banco descartável e passagem pelo runtime de automações. O teste de concorrência da base fica em `tests/invariants/add-tag-concorrente-nao-apaga.test.ts`.
- Decisão: **REVIEW**. O comparador comprova apenas semântica isolada quando passar no CI, nunca autorização para integrar.

### Candidato 2 — visão geral de cobrança / RPC

- Fork/base: blob `905ae3d957027828389293cf1c624b045b14eefc`.
- Target: blob `3606e150a22f4ab4ce7cc0cc20664431d9d0d788`.
- Diff preciso: `admin.rpc("fn_cobranca_reconciliaveis")` passa a encadear `.order("relida_em", { ascending: false, nullsFirst: false }).limit(1)`.
- Comparações propostas: conjunto desordenado e valores `NULL`, mesma maior leitura anterior e nova, uma só linha no target, suporte a conjunto vazio, erro de RPC continua lançando; sabotagem que remove a ordenação mantendo limite devolve data errada no dublê e deve ser detectada.
- Aceite **ainda não executado**: provar a função `fn_cobranca_reconciliaveis` como retorno ordenável/limitável no PostgREST real, paridade do SQL, timezone, timestamps empatados, erro de provider, RBAC de painel e ausência de leaks. `limit(1)` exige prova de semântica em PostgreSQL descartável, não inferência pelo stub.
- Decisão: **REVIEW**, sem `prepare`.

## Separação de revisão: cinco candidatos requerem adaptação

| Arquivo | Blob fork → target | Contrato a provar antes de qualquer decisão |
| --- | --- | --- |
| `lib/automation/texto-do-followup.ts` | `d58eda4a` → `3f092557` | Labels do funil só na organização autorizada, `campos-do-render`, falha de consulta e dados nulos; teste de tenant A/B e comparação de templates |
| `lib/channels/pos-entrada.ts` | `791b6f8c` → `1d72ac02` | `is_personal` vs helper compartilhado; privacidade de contato/mídia, erro de leitura, reentrega e sender sem efeitos duplicados |
| `lib/channels/zernio/ingest.ts` | `7a5b5301` → `9c8f7cda` | Telefone extra não vira principal; E.164, identidade do contato, tenant A/B, colisões e replay idempotente |
| `lib/contacts/cliente-pela-agenda.ts` | `063a727f` → `0a8e9254` | Defaults e `organizations.settings` equivalentes ao helper `lerRegrasDeCliente`; falta/erro e separação de tenant |
| `lib/crm-b2b/import-process.ts` | `d146f4cd` → `075465ad` | Associação por `contact_phones`, conflitos de pessoa, deduplicação, reimportação e isolamento organizacional |

**Resultado deste checkpoint:** as cinco diferenças de blob foram verificadas diretamente nas duas árvores; os dez cenários de contrato acima são critérios de aceite **pendentes**, não testes funcionais executados. O ensaio automatizado verifica individualmente que permanecem `requires_adaptation` e `authorization:none`.

## Separação de revisão: cinco candidatos bloqueados

| Arquivo | Blob fork → target | Razão para bloqueio e teste negativo obrigatório |
| --- | --- | --- |
| `lib/channels/adapters/meta-cloud.ts` | `41bf1b93` → `8553e644` | Operações de template Meta/WABA: negar leitura/escrita sem capability, sessão, credencial/WABA vinculados e autorização de tenant |
| `lib/cobranca/uso.ts` | `84b28c88` → `c0fef9a3` | Mudança de contagem QR `FAILED/STOPPED`: comparar resultado com trigger/limites SQL sob os mesmos estados; sem migration neste gate |
| `lib/lgpd/pdf-renderer.tsx` | `ba4b467c` → `120e8b7b` | Endereço na exportação LGPD: dono do dado, tenant A/B, escaping, PII e autorização da exportação |
| `lib/messaging/presenca.ts` | `25f807d3` → `0398186a` | Destinatário de presença: último endereço da conversa, sender canônico, LID/grupos, telefone extra e tenant |
| `lib/wacalls/events-bridge.ts` | `fd372795` → `9addc48c` | Query SQL por telefone extra: filtro de organização, contato mesclado, ambiguidade de número, parâmetros e ausência de associação cross-tenant |

**Resultado deste checkpoint:** divergência de blobs comprovada; todos permanecem `blocked_pending_contract_proof` e `authorization:none`. Os testes de autenticação, RBAC, mensageria, LGPD, cobrança e integrações **contra comportamento target real** ainda não foram executados. A verificação automatizada das dez classificações **não** é teste funcional.

## Imports computados — hipótese delimitada, sem promover segurança

No fork, `curso/semear-demonstracao.ts` (blob `efc36079668c67e56529113ee173e611e09ebd9b`) contém `await import(arquivo)` (linha 1018). No target (blob `aa2c70106a6408eafe846e2543c0cf04420ee1d0`), há `await import(path.join(pasta, arquivo))` na rotina de limpeza e `await import(arquivo)` no carregamento de aula (linhas 1088 e 1105).

O argumento `modulo` do caminho explícito vem de `process.argv[2]`, valida `/^[a-z0-9-]+$/` e é combinado a `curso/semear/<modulo>.ts`; o caminho de limpeza enumera nomes terminados em `.ts` em `curso/semear`. Isso sugere um escopo operacional de sementes de demonstração, **não prova** todos os destinos dinâmicos, ausência de symlinks, segurança de resolução ou completude global do scanner.

Proposta técnica, **não implementada**: inventário fechado de arquivos do diretório de sementes baseado na árvore target pinada; resolver caminhos computados com diretório base e `realpath`, negar symlinks e traversal; cobrir caminhos ausentes, extensões, erro de leitura e alterações de enumeração; computar cobertura **local separada**, sem marcar o grafo global completo nem liberar candidato. Reavaliar os imports do fork e target em testes adversariais antes de mudar o classificador. Até lá: `graph_complete:false`, um import inconclusivo no fork, dois no target, `safe_to_prepare:0`.

## Critérios de aceite e lacunas

1. **Evidência automatizada do novo SHA:** novo workflow `completed/success`, teste comparativo TAP auditado e SHA-256 conferido, além de Gate 6 e ensaio read-only. Sem polling; gerente informa GREEN/RED.
2. **Prova comportamental dos dois candidatos:** os testes comparativos em VM devem passar, incluindo casos negativos e sabotagem; registrar payloads observáveis e limites de dublês.
3. **Prova real ainda obrigatória:** PostgreSQL descartável (sem Supabase de produção), chamadas RPC/PostgREST, RBAC, privacidade/PII, tempos/concorrência/idempotência, mensagens, integração de automações e superfície do usuário.
4. **Dez candidatos adicionais:** nenhum desbloqueio até testes específicos com os contratos acima, revisão de dependências, compatibilidade e decisão humana; os 45 novos módulos seguem sem incorporação.
5. **Proibição:** nenhum `prepare`, merge, deploy, alteração do banco de produção, mudança em `safe_to_prepare` ou incorporação do upstream v1.95.0.

**Classificação:** ensaio comparativo **IMPLEMENTADO EM BRANCH**; resultado CI novo **PENDENTE**; equivalência runtime **NÃO COMPROVADA**; decisão funcional **NO-GO**.
