# ELUS360 — candidato experimental sobre DeskcommCRM v1.108.0 limpo

Status: **montador preparado para PR, não homologado**. Sem merge, banco ou deploy.

## Modelo de montagem

1. Fixar release oficial DeskcommCRM `v1.102.0` (`4b5815721710c9b1e99078322593838fda1ee740`) como referência do delta próprio e release oficial de destino `v1.108.0` (`0b60c5abaace17922ae645399a6a6183a5f5c357`). Verificar releases publicadas e SHAs Git das tags, inclusive anotadas.
2. Criar worktree **exatamente do commit oficial de destino**, sem copiar arquivos antigos em lote.
3. Extrair `diff` Git da base oficial antiga para o fork ELUS360 no HEAD da PR. Reaplicar apenas os caminhos modificados exclusivamente no fork e com tipos Git regulares; incluir arquivos novos e modos executáveis com `git apply --index`.
4. Se um caminho mudou também no Deskcomm oficial, **não sobrescrever**: registrar colisão e deixar a versão oficial intacta. Recusar exclusões do fork, symlinks, submodules, alterações de tipo e entradas Git inválidas.
5. Exportar JSON do inventário e patch binário **do índice** da candidata, com SHA-256. `staged` indica reaplicação técnica de arquivos, não aprovação de contrato ou de segurança.
6. Exigir ajustes específicos para colisões e testes obrigatórios de governança IA, tenancy/RLS, Chutes.ai, login, onboarding, instalação limpa, upgrade do banco e E2E antes de qualquer merge ou release ELUS.

## Alcance deliberadamente restrito

O montador prepara uma candidata e permite quantificar a superfície de engenharia. Não resolve conflitos automaticamente, não valida contratos transitivos, não executa migrations, testes da aplicação, builds AMD64 ou deploy. Mesmo sem conflitos de caminho, comportamento não está comprovado. Base de código limpa **não** significa banco de dados limpo em produção.

A PR #34 permanece como ferramenta de auditoria/reconciliação. PR #36 é uma integração antiga e pontual, não necessária como passo sequencial para montar v1.108.0. Não alterar `main`, fechar PRs existentes ou interromper produção por esta experiência.

## Próximos gates

`PR + testes do montador → artifact real (inventário e patch) → resolução dirigida de colisões/adaptadores → testes completos do produto + schema/migrations + E2E em ambiente descartável → revisão e aprovação → merge/release/imagens Linux AMD64 → deploy controlado + canário`.
