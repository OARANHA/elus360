# ELUS360 — triagem real dos conflitos v1.108.0

Status: **EVIDÊNCIA REPRODUZÍVEL / SEM HOMOLOGAÇÃO DE PRODUTO**. Este documento descreve o artifact já executado em HEAD `99a2d06613793edd742872f8bebe5e317d1cc1ca`. Mudanças posteriores na PR #37 exigem novo artifact no SHA correspondente.

## Proveniência
- Origem: [run 43155349222](https://github.com/OARANHA/elus360/actions/runs/43155349222), artifact 13915133187.
- SHA-256 do JSON extraído `elus360-clean-base-report.json`: `c2d09032ce26753ff7141303d54b6e7ce7b3c84b6c69f7a9f9a1c90d306da7ea`.
- Base oficial: Deskcomm v1.102.0, `4b5815721710c9b1e99078322593838fda1ee740`.
- Destino oficial: Deskcomm v1.108.0, `0b60c5abaace17922ae645399a6a6183a5f5c357`.
- Fork do artifact: `99a2d06613793edd742872f8bebe5e317d1cc1ca`.
- Delta fork 543 caminhos; delta oficial 1628; reaplicados 393 caminhos; requerem revisão 150; 77 dos 393 reaplicados estão na superfície sensível e precisam de testes próprios.
- Patch candidato do artifact: SHA-256 `5a225fd753519638e797e78148f9b7d145941b947d36e8a8699877508106f353`.

## Desagregação dos 150 (todos encaminhados, nenhum aceito)

| Grupo | Quantidade | Tratamento |
|---|---:|---|
| Exclusões locais de docs/skills em `.agents/` ou `.claude/`, sem arquivos em `scripts/` | 102 | **Candidato a conservar o upstream**; revisar identidade e instruções antes da decisão |
| Exclusões locais de scripts/hooks nessas duas árvores | 22 | **Revisão de execução/segurança obrigatória**; não reativar hooks silenciosamente |
| Arquivos de referência de skills alterados nos dois lados | 6 | Comparar e manter documentação oficial, reaplicando apenas orientações específicas ELUS verificadas |
| Runtime original: agentes, ambiente, auditoria, traduções | 6 | **Adaptador de núcleo a analisar/implementar**; nunca repor arquivo antigo inteiro |
| `supabase/baseline.sql` | 1 | Reconciliação de migrations, RLS e upgrade de banco com dados |
| Kit `hostgator-setup-kit/` | 4 | Compor instalador/distribuição próprios sobre atualizações oficiais |
| Workflows `ci.yml` e `e2e.yml` | 2 | Conciliar gates; nenhum teste oficial pode desaparecer |
| `.env.example` e `package.json` | 2 | Compor variáveis e dependências; revalidar lockfile |
| `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, `README.md` | 4 | Preservar doutrina upstream e adendos ELUS governados |
| Teste de preâmbulo do CI | 1 | Reconciliar expectativa e regressão |
| **Total** | **150** | Todas as decisões ainda são revisão, não autorização |

**Interpretação:** os 150 bloqueios não são 150 conflitos de código de runtime. São 124 exclusões de material de agentes + 26 caminhos editados nos dois lados. Os 22 scripts de agente continuam sujeitos a revisão específica; somente documentos não executáveis são candidatos iniciais a permanecer como no oficial.

## Runtime: seis confrontos de blobs oficiais/fork

| Caminho | Diferença ELUS verificada | Diferença upstream v1.108.0 | Decisão |
|---|---|---|---|
| `app/app/ai/agents/_components/AgentsList.tsx` | Prop `mostrarModelo` e passagem ao `AgentCard` | Extração de filtro para `filtrarAgentes` | Reintroduzir prop ELUS na **nova** lista oficial; não restaurar filtro antigo |
| `app/app/ai/agents/[id]/_components/AgentForm.tsx` | `AutonomiaIa`, provedores/oferta, defaults e controles de credenciais | Ferramentas, voz, agenda e outras opções novas | **Adaptador de maior risco:** comparar comportamento/validações; testes de permissões e edição obrigatórios |
| `lib/agent-engine/env.ts` | Campo `CHUTES_API_KEY` | Novas configurações de ritmo/recuo da fila | Composição aditiva com verificação de contexto |
| `lib/audit/actions.ts` | `platform_admin.ai_autonomy_updated`, `platform_admin.ai_default_updated` | Eventos adicionais de auditoria upstream | Composição aditiva sem remover códigos oficiais |
| `lib/env.ts` | `CHUTES_API_KEY` | `CADENCIA_LIMITE_EMAILS_POR_DIA` | Composição aditiva preservando ambas as configurações |
| `lib/i18n/dicionario.ts` | SHA divergente | SHA divergente | **Não analisado semanticamente**: ferramenta de leitura retornou conteúdo vazio; requer diff íntegro antes de decidir |

Comparações pontuais de texto acima utilizaram os blobs das três árvores: Deskcomm v1.102.0, Deskcomm v1.108.0 e ELUS360 `main` `fa76cf8c1197c7007e1feb0fef35397fe98336c6`. Diferenças aditivas são hipóteses de adaptadores simples, não provas de compatibilidade transitiva.

## Configuração, distribuição e banco

- `.env.example`: o fork acrescenta `CHUTES_API_KEY` e `ELUS_DEFAULT_AI_PROVIDER`; o upstream acrescentou knobs de fila e cadência. Manter os dois conjuntos.
- `package.json`: o fork introduziu `test:operational`; o upstream alterou versões de várias dependências. Preservar o script e usar dependências oficiais com lockfile resolvido e validado, sem transplantar `package.json` antigo.
- `hostgator-setup-kit/update.sh`: o ELUS colocou barreiras de origem/release e gates antes de mutações; o upstream adicionou espera de trava do backup. Adaptar ambos, não restaurar o script antigo nem descartar a trava.
- `hostgator-setup-kit/_common.sh`: preservar exclusivamente Linux AMD64, imagens e rollback ELUS; incorporar atualizações oficiais de healthcheck/timeout após testes. **Nunca construir imagens na VPS.**
- `supabase/baseline.sql`: o caminho é colisão fiscalizada; nenhuma migração ou substituição de baseline está aprovada. Exigir reconciliação histórica, RLS, integridade e upgrade reversível em banco descartável.

## Plano de execução

1. Preservar arquivos de código **oficiais** em todos os caminhos sobrepostos até prova de adaptação.
2. Resolver primeiro os quatro adaptadores de composição aparentemente aditiva com diffs pinados e testes; depois o `AgentForm`; por último o dicionário, somente após obter blob íntegro.
3. Trazer o kit ELUS, migrations e workflows para cima da nova base; verificar no runner a instalação limpa E a atualização de instalação existente.
4. Acompanhar a classificação por `scripts/elus360-clean-base-classify.mjs` no workflow, incluindo todo caminho e SHA do relatório. Nenhuma categoria autoriza aplicação automática.
5. A candidata só avança após testes funcionais da **árvore composta**, não pelos testes do fork antigo; preservar `main` e produção até aprovação do proprietário.
