# ELUS Upstream Sync — preparação segura de atualizações

> **Gate 1 em revisão, 28/10/2026.** O comando deste gate é somente de leitura. Não incorpora releases, não instala módulo, não executa migrations e não publica imagens. `update.sh` oficial foi estudado como referência, **não** é executado na produção Portainer do ELUS 360.

## Objetivo

Atualizar a base DeskcommCRM sem perder a camada ELUS compilada nas imagens `OARANHA/elus360`. Separar os estágios:

`memória + GitHub → origem verificada → pré-validação → branch de integração → diffs/contratos/migrations → PR → testes e CI → merge → GHCR por digest → Portainer → canário`.

Não basta fazer `git pull`: o `hostgator-setup-kit/update.sh` faz `git checkout` na tag da release, reaplica o `supabase/baseline.sql` e troca imagens. Ele não mescla automaticamente customizações. O Compose atual depende de imagens ELUS publicadas no GHCR, não de compilar a VPS.

## 0. Memória, autoridade e versão real

No começo de **cada gate relevante**, executar `recall` e pesquisar a KB do ELUS Memo com `bank_id="Elus360"`; confrontar com `CLAUDE.md`, `AGENTS.md`, `docs/index.md` e GitHub (`main`, PRs e SHAs). Ao terminar, gravar apenas fatos novos, decisões e pendências verificadas (sem credenciais, PII ou logs extensos). Não ativar atualização automática do Hindsight.

O comando só deve ser aplicado a releases oficiais identificadas, não a `upstream/main` móvel. O repositório anterior `OARANHA/elus` e `OARANHA/crm-wandora` é biblioteca de **código histórico**, nunca autoridade sobre o estado atual de `OARANHA/elus360`.

## 1. Executar o analisador do Gate 1

Use checkout **de desenvolvimento**, separado da produção, com `main` limpa. Confira remotes antes de começar. Os exemplos `v1.94.0` e `v1.95.0` são ilustrativos; **não afirmam que a v1.95.0 foi publicada**.

```bash
git clone https://github.com/OARANHA/elus360.git elus360-integracao
cd elus360-integracao
git remote add upstream https://github.com/melgarafael/DeskcommCRM.git
git switch main
git status --short
git fetch --no-tags upstream refs/tags/v1.94.0:refs/elus-upstream/tags/v1.94.0
git fetch --no-tags upstream refs/tags/v1.95.0:refs/elus-upstream/tags/v1.95.0
node scripts/elus-upstream-prepare.mjs --from v1.94.0 --to v1.95.0
```

A etapa de `git fetch` atualiza apenas refs no checkout de desenvolvimento. O analisador em si **não faz fetch, checkout, merge, push, escrita de arquivos, acesso ao banco ou chamadas externas**. Requer `origin` apontando para `OARANHA/elus360`, `upstream` para `melgarafael/DeskcommCRM`, `main` ativa, working tree limpa, duas refs de release existentes e ancestralidade progressiva entre elas.

### Limites do diagnóstico e proveniência

- O comando confere o **nome e endereço configurado do remoto** e examina apenas as refs Git locais. Isso **não comprova por si só** que elas foram baixadas da release oficial, que a tag foi assinada ou que o `main` local está sincronizado com GitHub. Confrontar release/tag, commit (inclusive tag anotada) e `main` com o GitHub antes de qualquer PR de atualização.
- **Falha fechada para caminhos novos:** código, componentes de UI, `package.json`, lockfile, scripts, configuração, pipelines e caminhos não classificados exigem revisão manual. Apenas documentação textual comum fora de `docs/elus360/` é ordinária. Um arquivo do upstream colidindo com a camada ELUS bloqueia a análise.
- `analysis_ready` é apenas uma classificação de caminhos, **não uma autorização de merge**. O analisador não detecta incompatibilidades semânticas entre o código ELUS e o upstream, não valida RLS, não garante ausência de regressões nem é um verificador de integridade criptográfica de tags.
- A [ADR-0005 do DeskcommCRM](https://github.com/melgarafael/DeskcommCRM/blob/main/docs/adr/0005-plataforma-de-modulos-de-terceiro.md) é referência de reutilização. Extensões `connected` e `hosted` não estão disponíveis na implementação atual; integrações de segurança/runtime permanecem em adaptadores próprios ELUS com gates no núcleo (ver [contrato](./extension-contract.md)).

### Códigos de saída

| Código | Resultado | Procedimento |
| --- | --- | --- |
| 0 | `analysis_ready`: diff sem arquivo classificado sensível | A análise não aprova merge; revisar os demais arquivos normalmente |
| 2 | `manual_review_required` / `blocked_collision` | Revisar contratos, testes, schema, rota e conflitos; não automatizar merge |
| 3 | Pré-condição não atendida: origem, refs, versão, estado do checkout, etc. | Resolver somente a causa indicada; nenhuma mudança executada |

O JSON informa SHAs das duas releases, SHA da `main` local, caminhos alterados, riscos e motivo da classificação. **Não demonstra compatibilidade de runtime, RBAC, migrations ou RAG**. Não contém segredos nem aplica correções. Alterações em diretórios próprios `lib/elus360/` e `docs/elus360/` pela origem são bloqueios até reconciliação explícita.

## 2. Gate futuro: integração do código

1. Confirmar a tag/release no GitHub oficial e que o checkout de integração está limpo.
2. Determinar se existe ancestralidade Git comum. **Não presumir** que `OARANHA/elus360` é um fork Git com o mesmo histórico: importações por snapshot podem exigir integração por diff/reconstrução controlada, não `git merge upstream/main`.
3. Criar branch temporária `upgrade/deskcommcrm-vX.Y.Z` a partir de `OARANHA/elus360/main` verificada.
4. Aplicar a base nova no branch de trabalho preservando arquivos exclusivos ELUS. Revisar diferenças nos pontos de extensão anotados em [extension-contract.md](./extension-contract.md).
5. **Nunca trocar automaticamente `supabase/baseline.sql` nem aplicar migrations antigas fora de ordem**: verificar MANIFEST, tabelas, funções, policies, triggers e invariantes em base sintética/restaurável. Nova migration ELUS deve ser específica, idempotente quando aplicável e compatível com baseline e upgrade.
6. Rodar lint, TypeScript, unitários, gates SQL e testes de autorização. E2E/Playwright só quando o escopo e gate permitirem. Produção sempre depois.
7. Abrir PR, conferir HEAD e CI uma vez quando o proprietário informar GREEN/RED, sem polling de Actions; resolver conflitos e só então integrar por merge autorizado.

## 3. Gate futuro: publicação

- Confirmar SHA `main` e três imagens app/worker/scheduler publicadas para ele.
- Preservar digests anteriores para rollback; não compilar pesado na VPS.
- Portainer Vigia: confirmar endpoint/stack, imagens localmente antes do redeploy (IPv4 se necessária devido ao incidente GHCR/IPv6 anterior); `prune:false`, sem repull se imagens carregadas e verificadas.
- Verificar containers healthy, `/api/v1/health` e revisão efetiva. Se rota pública retornar 403, investigar a origem sem declarar health aprovado ou indisponibilidade global.
- Canário funcional: organização criada, IA gerenciada, permissão de editar provider/modelo negada ao tenant sem grant, BYOK explicitamente concedido, agente com tools, embeddings indexar+buscar e limites/custos.
- Só então classificar `VERIFICADO EM PRODUÇÃO`. CI GREEN e deploy HTTP 200 não substituem canário.

## 4. Evolução prevista (não implementada neste gate)

Um futuro `elus:upstream:prepare` poderá automatizar consultas de release, relatórios e criação da branch/PR com intervenção explícita, mas **nunca** auto-merge, auto-migration ou auto-deploy de alterações de segurança. O Gate 1 entrega apenas o inventário de impactos para fundamentar esse projeto.

## Referências

- [Contrato da camada ELUS](./extension-contract.md)
- [Atualizador original](../../hostgator-setup-kit/update.sh)
- [CI build ELUS atual](../../.github/workflows/build-elus360.yml)
- [Origem oficial](https://github.com/melgarafael/DeskcommCRM)
