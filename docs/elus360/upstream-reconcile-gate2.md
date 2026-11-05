# ELUS Upstream Sync — Gate 2: reconciliação triádica

Estado: **implementado em branch de revisão**. Não demonstra compatibilidade funcional, não publica imagens e não aplica alterações upstream. Complementa, sem substituir, o Gate 1 em `scripts/elus-upstream-prepare.mjs`.

## Fonte de verdade

- Fork operacional: `OARANHA/elus360`; o repositório `OARANHA/elus` é histórico e não deve ser destino de publicação.
- Base histórica: DeskcommCRM `v1.94.0`; nova release somente após confirmação de tag e SHA oficial.
- Conferir `CLAUDE.md`, `AGENTS.md`, `docs/index.md`, contrato de extensões e inventário `docs/elus360/ai-governance-write-surfaces.json` antes de liberar mudanças.
- `package.json` não determina a versão do upstream.

## Reconciliação

Em checkout descartável contendo os objetos Git dos três commits, executar:

```bash
node scripts/elus-upstream-reconcile.mjs --base <SHA40_DA_V194> --target <SHA40_RELEASE_OFICIAL> --fork <SHA40_MAIN_ELUS360>
```

Os três SHAs devem ser **commits completos e verificáveis**. O destino deve ser descendente da base oficial. O código não executa `fetch` e não verifica por si mesmo a autenticidade de tags: o operador/runner deve verificar a proveniência fora do script.

O JSON gerado contém classificação por arquivo:
- `already_integrated`: blob da `main` ELUS360 é idêntico ao blob da nova release; não reaplicar;
- `safe_to_prepare`: alteração de código ordinário fora das áreas sensíveis, e blob ELUS idêntico à base;
- `conflict_requires_review`: o fork modificou o arquivo em relação à base;
- `contract_requires_review`: autenticação, RLS/tenancy, IA, agentes, worker e prospecção;
- `protected_requires_review`: módulos próprios ELUS, SQL/migrations, release, workflows e outros caminhos protegidos;
- `deletion_requires_review`: exclusão pelo upstream.

A classificação é **por identidade de blobs e caminhos**, não equivalência semântica. Um código com alterações textuais diferentes pode já implementar a funcionalidade; deve ser auditado como conflito, não replicado automaticamente. Não aceitar `safe_to_prepare` como prova de ausência de efeitos colaterais.

## Invariantes necessários antes de uma PR de atualização

1. Preservar marca ELUS360, onboarding e os contratos de governança em `lib/elus360/ai-managed/` e telas administrativas.
2. Nenhuma alteração de provider/model/credentials/operator_model por tenant sem permissão efetiva conferida **no backend**. Os controles da interface não substituem os guards.
3. Isolamento por `organization_id`, RLS, roles, MFA, trilha de auditoria e testes negativos cross-tenant.
4. Garantir que as superfícies inventariadas de mutação técnica de IA continuem protegidas; verificar novas rotas e ações adicionadas pelo upstream.
5. SQL/migrations/baseline, especialmente comandos destrutivos, seguem gate independente com PostgreSQL descartável e revisão de segurança.
6. Validar app, worker e scheduler. Executar branch → PR → CI → revisão → merge aprovado → imagens GHCR por digest → Portainer Vigia aprovado → canário.
7. Nenhum E2E/Playwright, merge, publicação de imagem, migration ou deploy por este mecanismo sem autorização específica.

## Próxima capacidade

Acoplar a classificação ao preparador isolado e à criação de PR, preservando arquivos sensíveis e exigindo testes aplicáveis por contrato. Esta capacidade ainda não é entregue pelo Gate 2. O executor da PR #71 do repositório histórico pode ser usado como referência de implementação, **não** como origem operacional nem migrado sem revisão.
