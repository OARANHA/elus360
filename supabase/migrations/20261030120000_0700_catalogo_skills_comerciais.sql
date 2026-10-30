-- Catalogo comercial reutilizavel. Registro GLOBAL: todas as organizacoes podem instalar.
-- Guardas: idempotencia e skill_versions imutaveis; nao altera versoes ja publicadas.
-- IMPORTANTE: o runtime pode consumir skills de plataforma como fallback antes de "Instalar".
-- Liberacao a producao requer teste de matcher/fallback e aceite explicito.
alter table public.skill_versions add column if not exists catalog_only boolean not null default false;

do $seed$
declare v_id uuid;
begin
  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'diagnostico-consultivo') then
    insert into public.skill_versions (organization_id, name, description, body, matcher, catalog_only)
    values (
      null,
      'diagnostico-consultivo',
      'Descoberta consultiva: identificar problema, contexto e impacto antes de oferecer solução.',
      $skill_diagnostico_consultivo$# Diagnóstico consultivo

## Quando usar
A pessoa explica uma dificuldade no atendimento, relacionamento ou vendas e busca orientação.

## Como conduzir
- Reconheça o contexto já fornecido. Não faça a mesma pergunta duas vezes.
- Faça uma pergunta curta por vez para identificar segmento, operação atual, obstáculo principal, impacto e urgência.
- Confirme sua hipótese em linguagem simples, como hipótese, não diagnóstico definitivo.
- Ofereça uma orientação útil e pequena antes de apresentar uma solução.
- Só conecte o problema a uma capacidade realmente documentada no conhecimento da empresa.
- Se não houver dados suficientes, pergunte; não invente números, resultados, casos ou funcionalidades.
- Respeite quem não quer avançar. Não pressione nem finja identidade humana.
## Encerramento
Resuma a dor e sugira próximo passo proporcional ao interesse explicitado.$skill_diagnostico_consultivo$,
      '{"any_keywords":["preciso de ajuda","tenho problema","não consigo vender","atendimento","quero melhorar"],"probe_keywords":["como funciona","preciso automatizar"]}'::jsonb,
      true
    )
    returning id into v_id;
    insert into public.skill_pointers (organization_id, name, version_id)
    values (null, 'diagnostico-consultivo', v_id);
  end if;

  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'qualificacao-comercial') then
    insert into public.skill_versions (organization_id, name, description, body, matcher, catalog_only)
    values (
      null,
      'qualificacao-comercial',
      'Qualificação consultiva de oportunidades A/B/C/D sem excluir nem constranger interessados.',
      $skill_qualificacao_comercial$# Qualificação comercial

## Quando usar
Há intenção comercial e contexto suficiente para orientar o próximo passo.

## Critérios qualitativos
- A: problema claro, urgência e capacidade de avançar declaradas; ofereça passo comercial concreto.
- B: interesse real, mas timing, prioridade ou objeções pendentes; esclareça e combine retorno.
- C: início de pesquisa ou baixa maturidade; compartilhe orientação pertinente sem pressão.
- D: não há orçamento no momento; respeite e sugira uma opção de entrada somente se documentada.
- A classificação é hipótese operacional revisável, nunca rótulo para diminuir a pessoa.
- Não afirme que o sistema gravou uma classe, alterou funil ou agendou ação sem confirmação da ferramenta.
- Não invente orçamento, urgência ou autoridade de decisão; pergunte só o necessário.
- Uma pergunta por mensagem; use as respostas já fornecidas.
## Próximo passo
Sintetize problema, necessidade, restrição e ação combinada para eventual passagem humana.$skill_qualificacao_comercial$,
      '{"any_keywords":["quero contratar","quero orçamento","quero começar","tenho urgência","tenho verba"],"probe_keywords":["me interessa","quero conhecer"]}'::jsonb,
      true
    )
    returning id into v_id;
    insert into public.skill_pointers (organization_id, name, version_id)
    values (null, 'qualificacao-comercial', v_id);
  end if;

  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'apresentacao-de-valor') then
    insert into public.skill_versions (organization_id, name, description, body, matcher, catalog_only)
    values (
      null,
      'apresentacao-de-valor',
      'Relacionar capacidades verificadas do negócio ao problema identificado, sem prometer resultados.',
      $skill_apresentacao_de_valor$# Apresentação de valor

## Quando usar
A pessoa já revelou um problema ou pede esclarecimento sobre valor e diferenciais.

## Como atuar
- Comece pelo problema relatado e explique uma capacidade comprovada que possa ajudar.
- Use documentação e catálogo atualizados como fonte da verdade.
- Explique o fluxo do antes e depois como possibilidade, não como resultado garantido.
- Não afirme funcionalidades, integrações, disponibilidade, cases, economia, taxa de conversão ou SLA sem fonte.
- Evite despejar uma lista de recursos; destaque no máximo dois pontos relevantes.
- Pergunte se a aplicação faz sentido para aquele cenário.
- Se a capacidade for incerta, diga que precisa verificar e encaminhe para validação humana.
## Próximo passo
Convide para demonstração somente quando existir um caminho real e o interesse estiver claro.$skill_apresentacao_de_valor$,
      '{"any_keywords":["qual a vantagem","benefícios","o que resolve","por que usar","diferença"],"probe_keywords":["me explique","quais recursos"]}'::jsonb,
      true
    )
    returning id into v_id;
    insert into public.skill_pointers (organization_id, name, version_id)
    values (null, 'apresentacao-de-valor', v_id);
  end if;

  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'recomendacao-de-plano') then
    insert into public.skill_versions (organization_id, name, description, body, matcher, catalog_only)
    values (
      null,
      'recomendacao-de-plano',
      'Orientar escolha de plano a partir do catálogo de cobrança vigente, limites e necessidade.',
      $skill_recomendacao_de_plano$# Recomendação de plano

## Quando usar
A pessoa deseja escolher um plano, comparar limites ou iniciar contratação.

## Como atuar
- Consulte somente a fonte comercial vigente e autorizada da organização.
- Considere número de usuários, canais, demanda e necessidades declaradas.
- Compare no máximo duas opções adequadas; explique o critério em linguagem simples.
- Nunca invente preço, teto de IA, taxa, promoção, desconto, parcelamento, trial ou disponibilidade.
- Não anuncie plano em proposta, rascunho ou arquivado como contratável.
- Se o checkout não estiver operacional, não diga que a contratação foi concluída; indique o próximo passo realmente disponível.
- Se nenhuma opção estiver confirmada, ofereça validação por pessoa autorizada.
## Próximo passo
Registre ou encaminhe a preferência, sem declarar pagamento ou assinatura sem confirmação.$skill_recomendacao_de_plano$,
      '{"any_keywords":["qual plano","melhor plano","assinar","mensalidade","pacote"],"probe_keywords":["quanto custa","preços","valores"]}'::jsonb,
      true
    )
    returning id into v_id;
    insert into public.skill_pointers (organization_id, name, version_id)
    values (null, 'recomendacao-de-plano', v_id);
  end if;

  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'followup-contextual') then
    insert into public.skill_versions (organization_id, name, description, body, matcher, catalog_only)
    values (
      null,
      'followup-contextual',
      'Retomar oportunidades com contexto real, respeito à resposta e às regras de envio.',
      $skill_followup_contextual$# Follow-up contextual

## Quando usar
Há uma retomada autorizada e permitida pelo fluxo de acompanhamento configurado.

## Como agir
- Retome a dor, objeção ou combinação específica da conversa; nunca finja memória ausente.
- Uma mensagem breve, útil e contextual; não repita textos iguais nem crie urgência artificial.
- Reforce um próximo passo real: responder uma dúvida, ver material validado ou confirmar intenção de avançar.
- Não invente consentimento, horário, prazo, compromisso ou proposta.
- A skill NÃO agenda nem envia sozinha. O workflow, o agendamento e as proteções de envio determinam se e quando há contato.
- Resposta da pessoa, pedido para parar, bloqueio ou handoff prevalecem sobre qualquer campanha.
- Se não existir contexto verificável, não personalize artificialmente.
## Encerramento
Deixe uma pergunta opcional clara e respeite silêncio ou recusa.$skill_followup_contextual$,
      '{"any_keywords":["vou pensar","depois falo","me chama depois","vou avaliar","retorno"],"probe_keywords":["mais tarde","semana que vem"]}'::jsonb,
      true
    )
    returning id into v_id;
    insert into public.skill_pointers (organization_id, name, version_id)
    values (null, 'followup-contextual', v_id);
  end if;
end
$seed$;
