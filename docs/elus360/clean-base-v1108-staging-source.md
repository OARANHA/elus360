# ELUS360 — pacote de fonte composta para staging isolado (v1.108.0)

**Estado:** implementação de exportação na PR #37; artifact do novo commit ainda não atestado. Este arquivo **não** autoriza merge, release, banco operacional ou deploy.

## Por que existe

O workflow `.github/workflows/elus360-clean-base-candidate.yml` já compõe o DeskcommCRM oficial **v1.108.0** com o delta ELUS, verifica código, TypeScript, testes de integração selecionados e build. Antes, entregava só relatórios e um patch: isso não era uma fonte íntegra diretamente utilizável para a homologação isolada. A nova exportação entrega **a árvore de código inteira do Git index composto** — sem artefatos não versionados gerados pelo build e sem `.git`.

## Proveniência e comparação

- Release Deskcomm pinada: `0b60c5abaace17922ae645399a6a6183a5f5c357`.
- HEAD anterior verificado da PR #37: `f15fce3c5fc54d058e05e3e92d46affeb8297ebb`.
- GitHub Actions `43476002208`, artifact `14063493764`: **409 overlays seguros, 16 adaptações, 134 itens oficiais preservados, zero conflitos pendentes**, `COMPOSED_TECHNICAL_CHECKS_PASSED`. Oito workflows da PR concluíram com sucesso naquele HEAD.
- O resultado do teste T05-B PostgreSQL descartável é uma prova de ensaio SQL isolado, **não prova de Supabase Auth/Reatime, staging real ou produção**.

## Contrato da exportação

Só gera o artifact `elus360-v1108-composed-staging-source` se o relatório de composição e validação corresponder aos SHAs exatos do fork e da release oficial, não houver conflitos (`unresolved=0`) e `adapters/install/types/unit/build` tiverem todos terminado `success`. Pré-condições adicionais:

1. Worktree do Deskcomm oficial em HEAD destacado (sem branch).
2. SHA-256 e contagem de bytes do patch do Git index idênticos ao relatório da composição.
3. Mínimo esperado de arquivos versionados e recusa de caminhos relativos ascendentes, `.git`, `node_modules`, `.next` ou `.env*` reais (templates `.example` são permitidos).
4. `git write-tree` gera o OID exato da árvore; `git archive` do OID gera o TAR da fonte indexada, usando timestamp fixo; `gzip -n` evita inserir o nome/timestamp no cabeçalho.
5. Manifest `elus360-composed-staging-manifest.json` registra SHA do fork, SHA oficial, OID da árvore, SHA-256 do TAR e `stage=COMPOSED_STAGING_SOURCE_ONLY`.
6. O artifact tem retenção de sete dias, não publica imagem, não contém credenciais do runner nem executa DDL.

A verificação local do arquivo, após extrair o artifact ZIP do GitHub, é:

```bash
sha256sum -c elus360-v1108-composed-staging-source.sha256
mkdir -p /tmp/elus360-staging-candidate
tar -xzf elus360-v1108-composed-staging-source.tar.gz -C /tmp/elus360-staging-candidate
```

A extração acima é somente em diretório descartável. Nenhuma aplicação, imagem ou banco é iniciado pelo artifact.

## Aceite funcional ainda pendente

O pacote habilita validação de **código real composto**, não a comprova. A homologação exige ambiente Supabase e serviços descartáveis, com testes direcionados aos diferenciais ELUS: login/branding em navegador, primeiro onboarding, dois tenants sem acesso cruzado, papéis e MFA, Chutes/credenciais/modelos, atualização de versão do agente sem bypass, e instalação/upgrade com backup/rollback. As rotas da aplicação e o schema devem ser testados juntos. Também é necessário revisar os entrypoints `install.sh`/`update.sh` para a política de arquitetura e build local opt-in que substituiu a regra histórica AMD64 exclusiva. **Um helper com ARM64 não certifica todo o instalador**.

Somente após aceite e autorização expressa do proprietário serão consideradas publicação, merge, imagens por SHA/digest, deploy e canário. Produção permanece **NO-GO**.
