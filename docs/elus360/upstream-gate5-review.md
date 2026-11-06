# Gate 5 — Matriz de revisão humana sobre upstream oficial v1.95.0

**Estado:** PROPOSTO para validação diagnóstica; **não** é autorização de incorporação. PR #20 Draft. Referências imutáveis:
- Upstream base v1.94.0: `ba24d4d366b7caf056b88553e0ed434cb0fb46de`.
- Upstream target v1.95.0: `ca37cb7f2a35c1a0f6abc968139dd263b20ccb36`.
- Fork ELUS360 `main`: `749aaf8fbb25b46dddd9138219e2ac032cc83336`.
- Gate 4 GREEN: [run 42148158083](https://github.com/OARANHA/elus360/actions/runs/42148158083), HEAD `a7412fc489020fa6201043a95fabf574fa852eca`. Artefato `13471051678`, `SHA256SUMS` de seis arquivos validado.
- Gate 4: **354** candidatos preliminares, **342** em revisão direcionada, **12** para triagem de compatibilidade potencial; `safe_to_prepare=0`. Grafo do fork `complete:false`, sem prova funcional.

## Critério e evidências

As 12 linhas abaixo resultam da leitura direta dos conteúdos oficiais base/target e da matriz `manual-compatibility-review.json`. Os doze caminhos possuem blob do fork idêntico à base oficial, **não** equivalência dos módulos que os consomem. Seus diffs são de comportamento ou contrato, não se tornam seguros apenas por assinatura estável. Risco por distância mínima é bidirecional no grafo do fork; indica proximidade, não caminho de chamada executado. **11** dos 12 estão a dois saltos de revisão dura e **um** a três ou mais.

### Doze arquivos — decisões fundamentadas

| Caminho | Diferença real v1.94 → v1.95 | Risco/contrato ELUS360 | Testes necessários e decisão |
| --- | --- | --- | --- |
| `lib/automation/actions/add-tag.ts` | `p_metadata` passa a incluir `caused_by_rule` somente se `ctx.ruleId` existir | Origem de regra e recibos/eventos; distância 2 | Idempotência de evento, reentrância regra→regra, metadado ausente/presente, auditoria; **revisão manual** |
| `lib/automation/texto-do-followup.ts` | Consulta `crm_pipelines.settings` vinculada por `organization_id` e `pipeline_id` e injeta labels de campos do funil no contexto | Escopo do tenant, output de templates e dados de lead; distância 2 | Dois tenants, campos ausentes, erro da consulta, variáveis/renderização e before-send; **revisão manual** |
| `lib/channels/adapters/meta-cloud.ts` | Adapter passa a oferecer `templates: metaCloudTemplateOps` | Ferramenta de escrita na conta WhatsApp e credenciais WABA; distância 2 | Permissão admin no backend, WABA/tenant, operações deny/allow, falha token, erro remoto; **revisão manual alta** |
| `lib/channels/pos-entrada.ts` | Consulta local de `contacts.is_personal` substituída por `lerPessoalDoContato` compartilhado | Privacidade, fluxo após mensagem e erro do provider; distância 2 | Consulta isolada por organização, falha técnica versus contato não pessoal, reentrega, não disparo de IA; **revisão manual alta** |
| `lib/channels/zernio/ingest.ts` | Impede execução de trecho de identidade por telefone quando contato foi achado pelo número extra (`achado_pelo_extra`) | Unicidade de contato, deduplicação e roteamento de entrada; distância 2 | Telefone principal/extra, contato mesclado, tenant cruzado e mensagens recebidas; **revisão manual alta** |
| `lib/cobranca/uso.ts` | Ajusta filtros para sessões WAHA sem telefone e em conexão, sem contar WACalls | Contagem de canais, planos e cobrança por organização; distância 3+ | Provedor/status, sessão expirada, contador limite e cobrança por tenant; **revisão manual alta** |
| `lib/cobranca/visao-geral.ts` | Adiciona `order(relida_em DESC).limit(1)` à consulta RPC de cobranças reconciliáveis | Recência do indicador e compatibilidade do retorno RPC/Supabase; distância 2 | RPC paginada, mais de mil assinaturas, linhas sem data, último status de pagamento; **revisão manual** |
| `lib/contacts/cliente-pela-agenda.ts` | Usa `lerRegrasDeCliente` para resolver configuração que era lida diretamente de `organizations.settings` | Sinalização de cliente e fallback com erro de banco; distância 2 | Tenants distintos, ausência de org, flags default, falha técnica, sem duplicação de lead; **revisão manual** |
| `lib/crm-b2b/import-process.ts` | Busca contato existente também por telefone adicional antes de importar empresa | Duplicação, identidade externa e mesclagem de fichas; distância 2 | Telefone extra, aliases, não vazar contato de outra organização, reimportação idempotente; **revisão manual alta** |
| `lib/lgpd/pdf-renderer.tsx` | Exportação LGPD inclui endereço de pessoa física, quando informado | Exposição de PII e integridade da resposta ao titular; distância 2 | Permissão do export, mesma organização, PII mascarada onde aplicável, layout sem dados, escaping; **revisão manual alta** |
| `lib/messaging/presenca.ts` | Resolução do remetente considera `contact_id` e `enderecoDaUltimaRecebida` | Número real da conversa, privacidade e roteamento WhatsApp; distância 2 | Número principal/extra, grupo, sessão compartilhada, último recebimento e remetente canônico; **revisão manual alta** |
| `lib/wacalls/events-bridge.ts` | SQL de identificação de contato faz `coalesce` entre telefone principal e tabela `contact_phones` por organização | Associação de chamadas ao contato correto, SQL parametrizado e tenant; distância 2 | Número alternativo, contato mesclado, chamada repetida, falso positivo cross-tenant, caracteres no E.164; **revisão manual alta** |

**Decisão para os 12:** selecionar por valor de negócio e demonstrar testes contra os contratos de cada coluna antes de qualquer branch de integração. Nenhuma linha tem autorização `safe_to_prepare`. O relatório automatizado `gate5-triad12.md` deverá conter os diffs completos e as três identidades Git por arquivo.

## 45 módulos novos de produção — inventário verificado no Gate 4

Motivo de ausência: `new_upstream_source_not_in_fork`, não falha comprovada do resolvedor. Os módulos existem apenas no target; sem grafo de consumidores do target, a leitura dos seus nomes e sinais **não identifica** segurança nem dependências transitivas. O novo job Gate 5 examinará a árvore completa target com parser TypeScript e reportará imports, consumidores diretos, consumidores protegidos transitivos, módulos alterados no lote e erros de resolução.

Legenda dos testes necessários: **UI** = renderização, permissões e visibilidade; **TEN** = isolamento org/RLS; **AUTH** = papel/capability no servidor; **MSG** = remetente, idempotência e eventos; **LGPD** = integridade e privacidade; **FIN** = valores/regra fiscal/assinatura; **FILES** = MIME, tamanho, bucket e SSRF; **AI/MCP** = versão, grants, tools read-only; **TIME** = agenda e fuso; **OPS** = identidade de runtime e operação.

| # | Módulo novo target v1.95.0 | Superfície a revisar | Testes mínimos |
| ---: | --- | --- | --- |
| 1 | `app/app/team/_components/SectorsClient.tsx` | Setores e autorização administrativa na UI | UI, AUTH, TEN |
| 2 | `app/app/templates/_components/ListaDeRespostas.tsx` | Respostas rápidas e grupos | UI, TEN, MSG |
| 3 | `components/connections/DialogoDeApagarModelo.tsx` | Exclusão de template no canal remoto | UI, AUTH, MSG |
| 4 | `components/connections/FormularioDaDefinicao.tsx` | Formulário de modelo Meta/canal | UI, AUTH, MSG |
| 5 | `components/contacts/ComparacaoDeFichas.tsx` | Comparação de contatos antes da mesclagem | UI, TEN, LGPD |
| 6 | `components/contacts/ConfirmarJuncao.tsx` | Confirmação destrutiva de mesclagem | UI, AUTH, TEN, LGPD |
| 7 | `components/contacts/JuntarComOutraFicha.tsx` | Entrada de mesclagem | UI, AUTH, TEN |
| 8 | `components/contacts/ListaDeLinks.tsx` | Social/links de contato | UI, LGPD, TEN |
| 9 | `components/inbox/DialogoDosModulos.tsx` | Personalização de lateral de Inbox | UI, AUTH, TEN |
| 10 | `components/kanban/ArquivosNoCard.tsx` | Anexos do negócio | UI, TEN, FILES |
| 11 | `components/kanban/AtalhosDoCard.tsx` | Atalhos/URLs parametrizadas no card | UI, FILES, TEN |
| 12 | `lib/agenda/duracao-escolhida.ts` | Duração personalizada e janelas de agenda | TIME, TEN |
| 13 | `lib/agenda/google/rodizio-de-conexoes.ts` | Conexões e escopo da agenda Google | AUTH, TEN, TIME |
| 14 | `lib/atendimento/setores-modulo.ts` | Recurso opcional de setores | AUTH, TEN, UI |
| 15 | `lib/automation/campos-do-render.ts` | Variáveis da automação | TEN, MSG |
| 16 | `lib/automation/resultado-para-recibo.ts` | Recibo de execução de regra | MSG, LGPD |
| 17 | `lib/channels/descartar-sem-parear.ts` | Sessão QR nunca conectada | MSG, TEN, FIN |
| 18 | `lib/channels/endereco-da-ultima-recebida.ts` | Seleção da identidade do último chat | MSG, TEN |
| 19 | `lib/channels/meta/templates.ts` | Gestão de templates Meta por WABA | AUTH, TEN, MSG |
| 20 | `lib/channels/numero-do-atendente.ts` | Remetente associado ao atendente | AUTH, TEN, MSG |
| 21 | `lib/channels/social/adaptador-da-porta.ts` | Adaptação de canal social | MSG, TEN |
| 22 | `lib/channels/social/porta.ts` | Contrato de canal social | MSG, TEN |
| 23 | `lib/channels/telefone-da-mensagem.ts` | Resolução de telefone por mensagem | MSG, TEN |
| 24 | `lib/channels/templates-graph.ts` | Cliente de templates Meta | AUTH, TEN, MSG |
| 25 | `lib/channels/templates-midia.ts` | Upload de mídia para templates | AUTH, TEN, FILES, MSG |
| 26 | `lib/contacts/contato-pessoal.ts` | Preferência de privacidade de contato | TEN, LGPD, MSG |
| 27 | `lib/contacts/conversa-ao-criar.ts` | Abertura de conversa ao criar contato | TEN, MSG |
| 28 | `lib/contacts/dispensar-par.ts` | Dispensar duplicidade de contatos | AUTH, TEN, LGPD |
| 29 | `lib/contacts/regras-de-cliente.ts` | Regras de cliente após compra/agendamento | TEN, FIN |
| 30 | `lib/financeiro/comissao-do-item.ts` | Comissão por item | FIN, TEN |
| 31 | `lib/inbox/modulos-da-lateral.ts` | Persistência de preferências individuais | UI, AUTH |
| 32 | `lib/inbox/resposta-rapida.ts` | Resposta com mídias e grupos | MSG, FILES, TEN |
| 33 | `lib/kanban/anexos-no-card.ts` | Anexos e cards de negócio | FILES, TEN |
| 34 | `lib/kanban/filtros-da-lista.ts` | Filtros no funil | UI, TEN |
| 35 | `lib/leads/atalhos-do-card.ts` | URLs externas parametrizadas do lead | FILES, TEN |
| 36 | `lib/leads/cliente-pela-venda.ts` | Cliente após venda/ganho de negócio | FIN, TEN, MSG |
| 37 | `lib/leads/valor-recorrente.ts` | Valor mensal/duração em negócio | FIN, TEN |
| 38 | `lib/mcp/servidor-externo/escolha-do-editor.ts` | Ferramentas externas e escopo de execução | AI/MCP, AUTH, TEN |
| 39 | `lib/messaging/mencoes-de-grupo.ts` | Identidade em menções de grupo | MSG, LGPD |
| 40 | `lib/planilha/ler-arquivo.ts` | CSV/XLSX não confiável | FILES, TEN |
| 41 | `lib/system/runtime-identity.ts` | Identidade do runtime/instalação | OPS, AUTH |
| 42 | `lib/templates/catalogo-de-variaveis.ts` | Fontes de placeholders de templates | MSG, TEN |
| 43 | `lib/templates/grupo-da-resposta.ts` | Associação de resposta ao grupo | TEN, AUTH |
| 44 | `lib/templates/grupos.ts` | Grupos de respostas rápidas | TEN, AUTH |
| 45 | `lib/waha/ultima-recebida.ts` | Última mensagem real e sender WAHA | MSG, TEN |

O status efetivo de todos os 45 continua `contract_requires_review` (por arquivo novo com exports e/ou sinais sensíveis). A tabela identifica **alvos de teste**, não riscos verificados no runtime. O novo relatório `gate5-target-matrix.md` deverá acrescentar dependências reais calculadas na árvore target e `gate5-evidence.json` preservará os caminhos.

## Análise das conexões distantes

No grafo do fork do Gate 4, a menor distância até uma mudança de revisão dura foi: **75** `direct`, **48** `two_hops`, **2** `indirect_three_or_more` e **229** sem caminho estático identificado; dentre os 12 candidatos prioritários, `lib/cobranca/uso.ts` está a três ou mais saltos. O agregador original `changedRiskCouplings` marcava 125 candidatos com o mesmo conjunto de 265 arquivos inseguros na componente bidirecional. Essa aproximação é útil como alerta, **não** como 265 relações diretas de contrato. A direção efetiva e a rota de execução devem ser confrontadas com o target antes de sugerir mudança no critério.

## Aceite futuro e limites

**Etapas pendentes:** executar o novo Gate 5 com três commits pinados; conferir `gate5-evidence.json`, matriz dos 45, diffs dos 12, TS AST incompleto, testes de precisão e contratos negativos. A análise do target é distinta da análise do fork, não muda `statusFor`, não cria `safe_to_prepare` e não faz `prepare`. Mesmo um arquivo de risco aparentemente baixo precisa de revisão de dependências, testes, build, autorização e canário em gate futuro, só com aprovação explícita.

**Restrições mantidas:** PR Draft; sem incorporação upstream, merge, deploy, imagem, migração, alterações no banco ou escrita em produção. Hindsight `Elus360` retornou `UNAVAILABLE`; registrar checkpoint quando voltar.