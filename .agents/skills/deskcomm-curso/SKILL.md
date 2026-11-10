---
name: deskcomm-curso
description: 'Atualizar o curso visual.'
metadata:
  fonte-de-verdade: curso/publicacao-elus360.json
  procedimento: docs/runbooks/atualizar-curso-elus360.md
---

# Manter o curso atual

> **No fork `OARANHA/elus360`:** executar o procedimento próprio
> [`docs/runbooks/atualizar-curso-elus360.md`](../../../docs/runbooks/atualizar-curso-elus360.md)
> e iniciar o planejamento com `--edicao elus360`. O recibo e o repositório
> `melgarafael/deskcomm-site` são do upstream e **não comprovam nem autorizam**
> publicação de `https://elus360.com.br/curso`. A captura conserva a mesma
> bancada, os mesmos capturadores e os gates de qualidade; a publicação só
> ocorrerá após identificar o repositório e o commit realmente servidos na
> Academia ELUS360. O nome técnico desta skill é preservado por compatibilidade.

Invocação: `/deskcomm-curso` no Claude Code; `$deskcomm-curso` no Codex, seguido do pedido.

Esta skill é a automação com IA: você lê as mudanças, corrige o material e executa os
capturadores existentes. O planejador só faz a triagem determinística. Não inicie um daemon,
agendamento pago nem outra CLI de IA para substituir o trabalho desta sessão.

No fork, localize o clone de **OARANHA/elus360** e leia `CLAUDE.md`, `AGENTS.md` e
[`docs/runbooks/atualizar-curso-elus360.md`](../../../docs/runbooks/atualizar-curso-elus360.md)
antes de operar a bancada. O site público pertence ao repositório
**OARANHA/elus360-landing**, com currículo editorial próprio e PR #40 de auditoria.
O repositório **melgarafael/deskcomm-site** é apenas referência upstream e
**nunca** é destino de publicação do ELUS360.

## Decisões essenciais

- No ELUS360, a base é `commit_fonte` de `curso/publicacao-elus360.json`,
  **somente após** recibo gerado com deploy do site comprovado; o arquivo
  herdado `curso/publicacao.json` é do upstream e não prova a Academia.
  A base deve ser conferida contra o curso que foi efetivamente publicado. Não use “última tag”, data de imagem ou `package.json` como substituto.
  O recibo exige também `site_commit` com SHA completo. Se falta esse vínculo ou uma publicação
  anterior comprovada, faça rodada completa e diga por quê.
- Compare commits exatos. Alteração local ainda não faz parte de `head`; registre o estado da
  fonte que o app usa e recalcule o plano depois de correções e merges.
- O plano oferece **candidatos**, não cobertura exata. Leia o diff inteiro e os arquivos ligados
  às telas. Mudança compartilhada/API sem mapa pede revisão global. Reduza um recorte só com
  justificativa pública sustentada pelo código e pela interface observada.
- Aula em espanhol exige a interface real em espanhol, seletores que existem nessa interface e
  geometria medida de novo. Nunca reutilize a foto ou as caixas de PT como se fossem ES.
- Não abra nem mostre `.env*`, chaves ou `curso/saida/contas.json`. Os programas podem carregar a
  configuração local gerada. Use somente a bancada descartável, dados fictícios e worker parado;
  não se conecte ao CRM de um cliente para fotografar ou semear.

## Executar a atualização

1. Confira a fonte publicada e o commit a ensinar. Rode:

   ```bash
   pnpm exec tsx curso/planejar-atualizacao.ts --edicao elus360 --head HEAD --idioma pt-BR --saida curso/saida/plano-elus360.json
   ```

   `--idioma pt-BR` e `--idioma es` restringem idiomas; sem eles o plano inclui ambos.
   `--base <ref>` é triagem com **base informada**, nunca prova de publicação, e exige revisão IA.
   Se der `sem-recaptura`, confira que a base corresponde à publicação; não fotografe nem altere
   datas/versões para simular uma atualização. Se houver pendências, resolva o alcance antes de
   capturar só um subconjunto.

2. Revise as aulas candidatas, os roteiros das jornadas e o que o aluno faz na tela. Corrija
   textos, ordem dos passos, seletores e sementes com base no comportamento real. Se aparecer
   recurso novo, atualize o catálogo; não esconda a novidade porque o mapa anterior não a conhece.
   Traduza também título, instruções, busca, dicas, rótulos e o conteúdo correspondente no site.
   ES não pode recorrer silenciosamente ao texto ou às imagens de PT.
   Prepare também as dependências declaradas da história: a consulta de pedidos, por exemplo,
   usa uma fonte fictícia real separada, descrita no runbook. Uma tela de erro ou outra conexão
   não substitui a integração exigida pelo roteiro.

3. Prepare a bancada pelo runbook. Fotografe somente o recorte confirmado, em cada idioma pedido,
   usando `capturar.ts [modulo] [licao]` e `capturar-jornadas.ts [nicho/jornada]` com
   `CURSO_IDIOMA` e `CURSO_SAIDA`. Restaure a semente antes de cada aula que muda o estado.
   Preserve as falhas persistidas: foto antiga existente não conclui uma tentativa nova.

4. Monte o curso, verifique manifestos e arquivos, abra o resultado no browser e percorra leitura,
   simulador e jornadas nos dois idiomas. Confira setas, caixas, cliques, textos, mobile e erros.
   Em falha, corrija a causa, restaure o estado e repita a aula/jornada inteira afetada. Não apague
   a pendência à mão nem mude metadados da foto para conseguir montar.

5. **Não publique via exportador do Deskcomm.** No ELUS360, compare os módulos
   permitidos do currículo editorial em **OARANHA/elus360-landing** com a fonte do
   CRM, utilizando a auditoria somente leitura documentada em
   [`docs/runbooks/atualizar-curso-elus360.md`](../../../docs/runbooks/atualizar-curso-elus360.md)
   e a PR de auditoria do site. Preserve títulos, IDs, imagens, marcações, simulador e
   progresso dos alunos. O exportador legado tem contrato ES específico e não faz
   atualização automática do HTML PT. Valide capturas, textos e conteúdo no preview
   real da Academia; depois use PR e checks obrigatórios nos dois repositórios.
   Publicação exige autorização separada, verificação da imagem/commit implantados
   e prova visual do curso. Só registre o recibo próprio após essa prova, com SHA
   da fonte, idiomas realmente publicados, data e SHA do site. Em falha não altere
   o recibo nem apresente a atualização como concluída.

O runbook detalha os comandos de bancada, o recibo de publicação e a retomada de falhas.
Os cenários de avaliação estão em [`evals/evals.json`](evals/evals.json).
