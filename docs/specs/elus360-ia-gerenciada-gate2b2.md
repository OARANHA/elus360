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

**Nenhuma rota chama ainda este resolvedor.** Isso evita falhar parcialmente na instalação antes da migration e não confunde pré-código com segurança concluída.

## Bloqueios para ativação

1. Confrontar `supabase/migrations` e PRs de schema em voo para reservar número e timestamp sem colisão.
2. Criar migration nova com `organizations.ai_autonomy` e proteção em banco, com `-- manifest:` no cabeçalho; **também** adicionar apêndice idempotente ao `supabase/baseline.sql`, preservando o dump existente. Não editar `MANIFEST.md` histórico. Cumprir `CLAUDE.md` (tripla migration + baseline + manifest), testes fresh/update Postgres e revisão de permissões/RLS.
3. Adicionar API e painel somente para Superadmin full/MFA, escrita CAS e auditoria; impedir grant por tenant, API Token, support e impersonation. Não usar `organizations.settings` como fonte de grants.
4. Integrar todos os caminhos relevantes do [inventário inicial](../elus360/ai-governance-write-surfaces.json), atualizando-o à medida que a enumeração se tornar exaustiva. Cobrir a `PATCH` de provider padrão, os métodos de credenciais, edição/publicação/duplicação de agentes, versão, onboarding e alterações do provedor da base; testar URL direta, API Tokens e concorrência.
5. Ativar apenas após coordenação schema↔código, CI green, imagens GHCR por SHA, deploy Portainer seguro, health/version e canário. Sem force/reset, sem builds pesados na VPS, sem canário antecipado.

## Testes e limitações

`tests/unit/elus360-ia-gerenciada-guard.test.ts` cobre falha fechada, organização inválida e isolamento lógico de grants. São testes de função com leitor mockado, **não** testes de RLS em Postgres, de autorização das APIs ou de deploy. O objetivo é fixar a semântica do adaptador para não reabrir acesso ao faltar `ai_autonomy`.

O próximo trabalho deve continuar **na mesma PR de Gate 2B.2**, adicionando migration, integração e testes pertinentes. Se o escopo exigir uma PR separada, deixar explícita a dependência e não interpretar esta PR preparatória como lançamento da governança.

Conforme exigido pelo proprietário: consultar banco de memória **`Elus360`** e GitHub ao iniciar/finalizar cada gate, gravando somente decisões, evidências e pendências úteis.

Referências:
- [Gate 2B inventário](./elus360-ia-gerenciada-gate2b.md)
- [Política pura](../../lib/elus360/ai-managed/policy.ts)
- [Contrato de extensões](../elus360/extension-contract.md)
- [Governança antiga](https://github.com/OARANHA/elus/blob/main/lib/ai/governanca-da-ia.ts)
