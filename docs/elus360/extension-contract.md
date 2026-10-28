# ELUS 360 — contrato de extensão sobre DeskcommCRM

> **Gate 1 — PROPOSTO/EM REVISÃO (28/10/2026).** Este documento estabelece limites para novos desenvolvimentos; não declara suporte a plugins de código arbitrário nem autoriza atualização automática ou produção.

## Identidade e autoridades

- **Produto e origem do código executado:** `OARANHA/elus360`. Fonte de versões oficiais: `melgarafael/DeskcommCRM`.
- **Histórico distinto:** `OARANHA/crm-wandora` e `OARANHA/elus` têm código reutilizável de governança e embeddings, mas não devem ser confundidos com a `main` do ELUS 360.
- **Autoridade:** `CLAUDE.md` > `docs/specs/` > `docs/prd/` > `HANDOFF-*.md` > `README.md`. Também consultar `AGENTS.md` e `docs/index.md`.
- **Gate de evidências:** GitHub/código e Supabase/Portainer comprovados vencem memórias, resumos ou afirmações anteriores.

## Camadas e o que NÃO substituir

| Camada | Reutilização | Limite |
| --- | --- | --- |
| DeskcommCRM | Auth, RLS, organizações, workers, autorização e runtime de IA | Não duplicar as rotas críticas nem tratar interface oculta como autorização |
| ELUS (`lib/elus360/`, `components/elus360/`) | Política e adaptadores próprios para IA gerenciada e onboarding | Nenhum módulo é automaticamente carregado pelo runtime; pontos de conexão no núcleo continuam necessários |
| Configuração existente | `organizations.settings.llm`, `ai_purpose_bindings`, credenciais por organização e perfis de interface | Não criar `company_ai_settings` ou `company_permissions` paralelas sem prova de necessidade |
| Segurança própria ELUS | Portar seletivamente a autonomia técnica original: `provider`, `model`, `credentials`, `operator_model` | A coluna `organizations.ai_autonomy` **não existe na instalação atual** (consulta de 28/10); nova migration e gates SQL serão necessários em PR própria |
| Conhecimento | Portar seletivamente o adaptador Chutes Qwen3-Embedding-8B-TEE e seu resolvedor de família | Não misturar vetores com modelo/família diferente; implantação, custo e canário pendentes |

### Por que não usar apenas `/admin/modulos`

`lib/modulos/catalogo.ts` e `lib/modulos/service.ts` oferecem **módulos de tabela da instalação** (`honorarios` e `financeiro`/Comandas). O botão Instalar executa `fn_modulo_instalar` para criar estruturas na instância. Ele não instala bibliotecas Node/Next.js nem introduz guards nas rotas já existentes.

O sistema de extensões (`lib/extensions/manifest.ts`) aceita perfis declarativos/de dados e contribuições limitadas, não plugins arbitrários que substituam o runtime de autenticação e agentes. Logo, governança e embeddings devem ser *módulos de código ELUS* compilados nas nossas imagens, com integração mínima e explícita às rotas oficiais. Módulos de negócio e extensões originais permanecem intactos.

## Reuso obrigatório da plataforma oficial de extensões (ADR-0005)

**Reconciliação em 28/10/2026.** Verificados `melgarafael/DeskcommCRM/main` (`f13d26f6`) e `OARANHA/elus360/main` (`0693fc8d`): `docs/doctrine/extensoes.md`, `docs/adr/0005-plataforma-de-modulos-de-terceiro.md`, `lib/extensions/manifest.ts` e `lib/extensions/capacidades.ts` possuíam os mesmos blobs. A [ADR-0005](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/adr/0005-plataforma-de-modulos-de-terceiro.md) é a autoridade arquitetural para **módulos de terceiro**, sem substituir o núcleo.

| Classe oficial | Estado comprovado no código | Uso proposto no ELUS |
| --- | --- | --- |
| `declarative` | **IMPLEMENTADA**: manifesto JSON estrito; cards, tema e portas de navegação fechadas | Guias, aparência e navegação sem lógica privilegiada |
| `data` | **PARCIAL** (onda 1a): objetos declarados, tabelas compiladas pelo host, leitura e fichas no contato; faltam escrita/telas próprias/LGPD/reaplicação completa | Dados adicionais de nichos após gates de tenancy e manutenção |
| `connected` | **PROPOSTA O2**; ainda não aceita pelo `ExtensionManifest` atual | Futuras integrações externas, quando o upstream fornecer os contratos e provas |
| `hosted` | **ADIADA**; executor Wasm não disponível | Não planejar como dependência do ELUS atual |

**As classes oficiais não recebem código executável no processo Next/worker** e suas capacidades efetivas são as de `lib/extensions/capacidades.ts`: `tasks.open`, `inbox.open`, `kanban.open`, `contacts.open`, `agenda.open`, `radar.open`. Credenciais, configurações administrativas, webhooks e provedores de IA ficam **fora** desse contrato. O núcleo é responsável por autenticação, autorização, RLS, auditoria, infraestrutura de IA e envio; instalar extensão **não** concede autorização técnica.

**Decisão de integração ELUS:** não construir catálogo ou instalador de extensões paralelo. Entregar capacidades de nicho pelas extensões nativas quando o contrato presente atender; preservar no **núcleo** os guards de autorização, seleção segura de provider/modelo e embeddings — via adaptadores de código ELUS com pontos de integração pequenos, explícitos e testados. Uma futura API oficial mais capaz poderá substituir alguns adaptadores **após** prova de equivalência/migração, sem comprometer o núcleo com zero extensões ativas.

A ADR-0005 D6 proíbe extensões de terceiro no caminho quente de ingestão, turno do agente e envio. Não resolver proteção de IA ou embeddings por chamada de serviço de extensão a cada turno. Novos ganchos oficiais só entram mediante consumidor real, contrato e prova dos dois lados (D10). Atualização do upstream não é autorização para migrar recursos já entregues silenciosamente (doutrina, não-negociável 12).

Referências: [Doutrina](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/doctrine/extensoes.md), [ADR-0005](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/adr/0005-plataforma-de-modulos-de-terceiro.md), [Spec atual](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/specs/extensoes-declarativas-v1.md).

## Contratos a portar seletivamente — não copiar cegamente

1. **Autorização técnica:** contrato original `OARANHA/elus/lib/ai/governanca-da-ia.ts`, `governanca-da-ia-contrato.ts` e painel `TenantAiPermissions.tsx`. Política falha-fechada; autorização de escrita no backend, não apenas ocultação de Credenciais/Provedores. Apenas Platform Admin full/MFA quando aplicável concede poderes, sempre com auditoria.
2. **Configuração do tenant:** reutilizar campos existentes; `CHUTES_API_KEY` é segredo da instalação e `ELUS_DEFAULT_AI_PROVIDER=chutes` é padrão para **novo onboarding**, sem trocar configurações já persistidas. Credenciais próprias (BYOK) continuam com precedência quando autorizadas.
3. **Embeddings:** contrato original `OARANHA/crm-wandora`, PR #121, modelo `chutes/Qwen3-Embedding-8B-TEE:mrl1536-l2-v1`; preservação da família/índice. Não confundir o modelo conversacional Gemma com embeddings, nem anunciar RAG funcional antes de indexação e busca comprovadas.
4. **Ajustes mínimos do núcleo:** cada chamada a `lib/elus360/` usada por uma API/worker do DeskcommCRM exige teste de contrato e inventário neste documento. Nenhuma rota que permita escrita pode ficar sem gate só por não aparecer no menu.
5. **Banco:** migration nova, numerada após inspecionar migrations reais; não reescrever migrations antigas ou `baseline.sql` manualmente sem plano de consistência e testes de instalação + atualização. O baseline upstream é reaplicado pelo `hostgator-setup-kit/update.sh`; a proteção das nossas estruturas precisa ser demonstrada, nunca presumida.

## Matriz de interoperabilidade para cada release nova

- `lib/elus360/`, `components/elus360/`, `docs/elus360/`, `scripts/elus-*`: arquivos **próprios**, alteração upstream significa colisão e bloqueio.
- Rotas `app/api/v1/ai/**`, `app/api/v1/admin/tenants/**`, `app/actions/onboarding/**` e agentes/workers: interfaces **sensíveis**; diffs upstream exigem revisão, tests de autorização e preservação da seleção provider+modelo.
- `lib/ai/embeddings/**`, `lib/ai/pontos/**`, `lib/agent-engine/**`: contratos **sensíveis**; verificar resolução de credenciais, tools e RAG.
- `supabase/baseline.sql`, `supabase/migrations/**`: **gate SQL obrigatório**, isolamento RLS, snapshots/restore e schema verificado antes de qualquer produção.
- `compose.portainer.yml`, `Dockerfile*`, `.github/workflows/**`: **gate de publicação**, sha/digest app-worker-scheduler e rollback, sem build pesado na VPS.

## Protocolo de memória e continuidade (pedido do proprietário)

**Sempre ao iniciar uma tarefa ou gate relevante deste projeto:**
1. Consultar `mcp__ELUS_Memory_Admin__recall` com `bank_id="Elus360"`, e a KB pertinente, sem assumir que as páginas estejam recentes.
2. Reconciliar `main`, branch/PR, diffs, contratos e evidências em `OARANHA/elus360`; consultar a fonte oficial quando necessário.
3. Classificar fatos `PROPOSTO → APROVADO → IMPLEMENTADO → TESTADO → PUBLICADO → VERIFICADO EM PRODUÇÃO`.
4. Gravar no ELUS Memo **somente** decisões, resultados, aprendizados e pendências úteis, com fontes, SHAs, caminhos e data, consultando se já existem antes de criar. Nunca guardar tokens ou PII.
5. Repetir em cada **novo gate** (não a cada leitura trivial); não habilitar refresh automático e não prometer execução em outras sessões sem o agente efetivamente adotar este protocolo.

## Registro de estado ao iniciar o Gate 1

- `OARANHA/elus360/main` conferida em **`0693fc8d01b1eac872fa0180a9524ee2de9b4ca5`** (28/10/2026).
- [PR #10](https://github.com/OARANHA/elus360/pull/10) integrada e mensagem de IA incluída comprovada visualmente; não confundir com canário completo de ferramentas.
- [PR #11](https://github.com/OARANHA/elus360/pull/11) **OPEN/DRAFT**, HEAD `c8f2ab83285a2e7f5fa5bfc27a717b80a8eb3a39` na checagem deste gate.
- **Escopo do Gate 1:** contrato + analisador read-only de comparação de releases + testes. Sem migrations, merge, imagens, alterações de stack, credenciais ou produção.

## Referências de código verificáveis

- [Governança e autonomia — ELUS antigo](https://github.com/OARANHA/elus/blob/main/lib/ai/governanca-da-ia.ts)
- [Embeddings Chutes — PR #121 CRM antigo](https://github.com/OARANHA/crm-wandora/pull/121)
- [Atualizador oficial presente no fork](https://github.com/OARANHA/elus360/blob/main/hostgator-setup-kit/update.sh)
- [Módulos instaláveis](https://github.com/OARANHA/elus360/blob/main/lib/modulos/service.ts)
- [Manifesto de extensões declarativas](https://github.com/OARANHA/elus360/blob/main/lib/extensions/manifest.ts)
