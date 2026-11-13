# ELUS360 v1.108 — fechamento estrutural e aceite funcional (PR #37)

**Fase:** implementação proposta na PR, sem CI do novo HEAD. Não é certificado de produção.

## Proveniência e fato verificado

- PR: https://github.com/OARANHA/elus360/pull/37
- Último HEAD GREEN examinado: `48f33b0b9751a9bf28160f1f9d572a60193405d0`.
- Upstream alvo: DeskcommCRM v1.108.0, commit `0b60c5abaace17922ae645399a6a6183a5f5c357`.
- Artifact do workflow `43465677134`: `14057844478`. Resultado: 408 caminhos próprios reaplicados, 12 adaptações, 131 arquivos oficiais preservados, **7 diferenças estruturais pendentes**; a árvore composta passou testes selecionados de tipos, unitários e build. `NO_GO_PENDING_ADAPTERS_DB_AUTH_E2E`.
- O baseline SQL já consta como adaptador: v1.108 oficial + quatro migrations ELUS com blobs fixados. O workflow T05-B em PostgreSQL descartável foi GREEN no SHA acima, sem atestar Supabase/Auth real nem banco operacional.

## Decisões de integração das 7 diferenças (alvo do próximo artifact)

| Caminho | Decisão de código | Controles que não podem se perder |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Adaptar apenas execução ELUS, runners públicos e memória do typecheck sobre a CI v1.108 | Manter janela oficial pg15/pg17 de 45 min, demais gates e proteção contra `skipped`; não transportar workaround v1.102 obsoleto |
| `.github/workflows/e2e.yml` | Adaptar no oficial: runner isolado e seed exclusivo de identidade de plataforma, sem elevar `e2e-admin` | Mantém banco efêmero e fluxo oficial completo; não executar seed contra produção |
| `README.md` | Adaptar os três comandos/guias específicos da distribuição ELUS | Restante do documento permanece Deskcomm v1.108 |
| `hostgator-setup-kit/README.md` | Adaptar apenas clonagem do fork e nome do guia ELUS | Regras oficiais de HostGator, ARM64 e instalação permanecem |
| `CLAUDE.md` | Preservar oficial por blob e modo; não trazer instrução antiga exclusiva AMD64 | Doutrina do Deskcomm e especificação do ELUS separadas |
| `AGENTS.md` | Preservar oficial por blob e modo; não trazer proibição obsoleta de build local/ARM64 | Agentes do Deskcomm e governança do ELUS em documentos próprios |
| `docs/index.md` | Preservar oficial por blob e modo, não recolocar ADR de versão superada | Referências ELUS em `docs/elus360/` e ADR-0007 com adendo superveniente |

**Integridade:** `scripts/elus360-clean-base-adapters.mjs` compara os blobs oficiais de cada adaptador e, para os três documentos retidos, compara também blobs do fork no commit exato. Ausência de item `both_changed`, mudança de SHA, âncora duplicada/ausente, path inesperado ou arquivo já staged reprova. Não é política geral para ignorar colisões em releases futuras: os pins exigem revisão.

## Testes de produto específicos agregados na árvore composta

São executados por `pnpm exec vitest run` no **worktree oficial+ELUS** em runner efêmero. Novos alvos direcionados:

- Identidade visual `tests/unit/branding.test.ts`.
- Política de IA e boas-vindas `tests/unit/elus360-ia-gerenciada-policy.test.ts`, `tests/unit/elus360-ia-incluida-welcome.test.ts`.
- Chutes `tests/unit/elus360-chutes-fontes-independentes.test.ts`.
- Proteção contra bypass de criação `tests/unit/elus360-create-agent-bypass.test.ts`.
- Segregação de executores `tests/unit/elus360-executores-nao-se-misturam.test.ts`.
- Contrato de colunas `tests/unit/agent-version-columns-drift.test.ts`.
- Configuração por tenant `app/api/v1/admin/tenants/[id]/ai-default/route.test.ts` e `app/api/v1/admin/tenants/[id]/ai-permissions/route.test.ts`.

O gate pré-existente de versões governadas, AgentForm, Chutes, build e TypeScript integral continua obrigatório. Testes não são E2E de navegador nem homologação manual: registrar aprovação apenas após resultados do SHA exato.

## Critérios ainda obrigatórios antes de release

1. Inspecionar artifact **do novo HEAD** e comprovar `unresolved=0`, quatro adaptadores estruturais com SHA correto, três documentos oficiais mantidos e nenhum enfraquecimento dos workflows.
2. Confirmar sucesso dos testes exclusivos ELUS sobre a árvore composta. Falha/skip não é aprovado.
3. Homologar em staging isolado login, branding, onboarding de duas organizações, governança/credenciais Chutes, sessão full/MFA, RBAC cross-tenant e revogação, com negativo de autorização. Os testes unitários não substituem esse passo.
4. Confirmar o comportamento de `install.sh`/`update.sh` com imagens e plataforma da máquina (amd64/arm64), backup, rollback e build local **somente opt-in**; provar que nenhuma ação com efeito ocorre depois de preflight inválido.
5. Validar upgrade de dados reais **somente em cópia descartável/snapshot**; não tocar banco operacional. Avaliar caminhos Supabase reais, políticas e grants.
6. Somente após gates e autorização explícita: merge, imagens por SHA/digest, deploy seguro, health e canário.

Sem merge, produção, segredos, dados reais ou rollout nesta etapa. É incorreto inferir que CI verde da composição equivale a ELUS360 publicado ou aceito.
