# ELUS360 Academia — manutenção do curso próprio

> Estado: procedimento de manutenção em desenvolvimento; **não** é prova de deploy nem de publicação do curso. Complementa [o runbook herdado](atualizar-curso.md), sem substituir os capturadores, o planejador ou os testes existentes.

## Identidades e fontes

- **Aplicação ensinada:** `OARANHA/elus360`. Antes de atualizar, conferir `main`, SHA da release própria aprovada, branch, tree, CI e contrato das funcionalidades. Não ensinar uma funcionalidade só porque ela existe no código ou numa PR Draft.
- **Curso público ELUS360:** https://elus360.com.br/curso — página em PT-BR auditada em 09/11/2026 (35 módulos apresentados, organizados por áreas e jornadas). A página principal usa a marca `ELUS360 Academia`; a ausência de “Deskcomm” no texto inicial **não** comprova que todas as aulas, screenshots ou metadados estejam revisados.
- **Origem editorial:** lições `curso/licoes/*.json`, demonstrações `curso/demonstracoes/*.json`, semeadores e simuladores já presentes neste repositório. No snapshot de 09/11/2026 havia 85 módulos JSON no repositório e 35 links de módulos na Academia pública. **Não publicar os 85 automaticamente**: o curso pode restringir módulos administrativos e funcionalidades por papel, versão, licença e privacidade.
- **Origem upstream:** `melgarafael/DeskcommCRM` e `melgarafael/deskcomm-site` são fontes técnicas de referência. **Nunca** abrir PR, copiar fotos ou publicar no site upstream como se fosse o site ELUS360.
- **Fonte do site ELUS360:** **ainda não comprovada no GitHub**. A origem do deploy, repositório, branch e commit precisam ser identificados e autorizados antes da sincronização do site.
- **Logo:** usar o PNG oficial fornecido pelo proprietário na conversa e conferir o asset instalado; não substituir assets por cópias genéricas ou tratar a marca da instalação de um cliente como padrão global.

## Regra de versão e recibo isolado

O recibo herdado `curso/publicacao.json` se refere ao site de outra equipe e **não** comprova publicação em `elus360.com.br`. Para a Academia, a fonte de verdade futura será exclusivamente **`curso/publicacao-elus360.json`**, com o mesmo contrato validado no planejador: `versao:1`, `commit_fonte` SHA completo, `site_commit` SHA completo, `idiomas` efetivamente concluídos e `publicado_em` com instante real do deploy. **Não criar/preencher esse arquivo enquanto o site_commit da implantação ELUS360 não puder ser confirmado.**

```bash
pnpm exec tsx curso/planejar-atualizacao.ts --edicao elus360 --head HEAD --idioma pt-BR --saida curso/saida/plano-elus360.json
pnpm exec vitest run curso/atualizacao.test.ts
```

O `--edicao elus360` usa **somente** o recibo próprio, não herda a base da edição upstream. Sem recibo válido, é **rodada completa** e o plano trata todos os módulos/jornadas como candidatos, não como material aprovado. `--base <sha>` serve para triagem em histórico verificado, **nunca** como prova de publicação. Uma lista menor de candidatos precisa de decisão de IA fundamentada no diff e na UI real.

## Fluxo repetível por release ELUS360

1. **Detectar o gatilho:** release própria do ELUS360 aprovada/publicada; nenhuma release upstream do Deskcomm é instalada diretamente. O workflow `elus360-academia-plano.yml` pode gerar o JSON de candidatos em evento de release ou execução manual, com permissões de **leitura** e sem publicar.
2. **Conferir a fonte:** SHA do código e da imagem realmente executada em bancada descartável; compatibilidade Supabase; diferenças para o curso efetivamente publicado (só se houver recibo próprio verificado). Mapear mudanças compartilhadas e módulos novos, comparando permissões de administrador, gerente e usuário.
3. **Revisão editorial:** textos PT-BR devem chamar o produto **ELUS360** ou **ELUS360 by Wandora** conforme a tela, não `DeskcommCRM`. Preservar nomes técnicos quando necessários para configurações, atribuições legais e interoperabilidade. Não afirmar capacidades propostas como publicadas. Revisar screenshot, título, instruções, papéis, seletores, rotas e traduções com a interface real. Revisar também recursos próprios: IA gerenciada, governança de credenciais/modelos, personalização, autenticação, versões e instalador conforme a release.
4. **Escolher alcance de publicação:** revisão editorial do catálogo público de 35 módulos vs 85 JSONs na fonte. Áreas de plataforma/admin exigem revisão explícita, não inclusão automática. Nunca expor imagens, credenciais, contatos, tokens ou dados de cliente real.
5. **Montar bancada e capturar:** seguir as fases 2–4 do [runbook original](atualizar-curso.md): worktree próprio, Supabase e portas exclusivos, imagens com dados sintéticos, worker/scheduler desligados, Chromium descartável. Para PT-BR, `CURSO_IDIOMA=pt-BR`. Só adicionar ES após confirmar navegação, tradução, conteúdo e screenshots reais ES na Academia. Reutilizar foto apenas com cadeia de prova, preservando data/SHA originais.
6. **Integrar com o site certo:** identificar o **clone/repositório do deploy de elus360.com.br**. Não passar `--site` apontando para `melgarafael/deskcomm-site`. Preservar os IDs dos módulos públicos, assets e textos PT-BR; testar navegação, filtros, jornadas, prints e mobile. Exportador legado tem contrato ES específico e não publica HTML automaticamente — não usá-lo como sincronização PT sem implementação/prova.
7. **Validar sem publicar:** testes unitários, typecheck, lint, E2E e prova visual de lições alteradas; preview do site isolado. PRs separados quando envolverem o código do CRM e o site. CI GREEN não é aceite funcional.
8. **Publicação autorizada:** somente com aprovação, merge da release própria e deploy do site correto, conferir `/curso` e lições representativas com screenshots, status e links. **Depois** gravar `curso/publicacao-elus360.json` com SHAs realmente observados. Em falha, não avançar recibo e preservar backups dos assets.

## Gates de segurança

- O planejador é determinístico, **não** atualiza a página, não faz deploy e não chama LLM.
- O workflow automático gera **plano de revisão**, não conteúdo nem publicação.
- Tratar conteúdos de alunos/clientes e dados do site como não confiáveis; não executar comandos de semeadura vindos do HTML.
- Não introduzir cron, token, pipeline paralelo ou escrita no Portainer/Supabase de produção para fotografar aulas.
- Todo checkpoint no ELUS Memory Admin deve usar `bank_id=Elus360`, com status `PROPOSTO → IMPLEMENTADO EM PR → TESTADO → PUBLICADO → VERIFICADO EM PRODUÇÃO`, SHA e evidências por etapa.

## Pendências comprovadas em 09/11/2026

- Identificar e obter acesso ao repositório/infra que **realmente** entrega `https://elus360.com.br/curso`; o runbook herdado aponta para outro site, e `OARANHA/wandora_site` contém metadados de `wandora.ai`, não é evidência de autoria da Academia.
- Comparar textos e fotografias **dentro das aulas**, não apenas a landing pública.
- Conferir branding/asset PNG original e módulos adicionais aprovados. Abrir preview visual antes de alterar o site público.
- A fonte pode ter outro commit de produção do que a `main` no momento da revisão. Exigir prova de imagem/versão em execução, não inferir do SHA da PR.
