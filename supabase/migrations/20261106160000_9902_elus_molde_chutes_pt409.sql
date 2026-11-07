-- manifest: Corrige o molde de IA para Chutes com chave de instalacao e a recusa definitiva de conflito de rascunho, preservando a cadeia historica 9096/9900.

-- 9096 permanece imutavel: atualiza apenas a definicao EFETIVA instalada.
-- Chutes e copiavel somente sem base_url e sem credencial de outra organizacao.
create or replace function public.fn_llm_do_molde_de_ia()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_llm jsonb;
begin
  select jsonb_build_object(
           'provider', o.settings->'llm'->>'provider',
           'default_model', o.settings->'llm'->>'default_model')
    into v_llm
    from public.platform_settings ps
    join public.organizations o on o.id = ps.molde_de_ia_org_id
   where ps.id = 1
     and o.settings->'llm'->>'provider' in ('anthropic', 'chutes', 'openai', 'openrouter')
     and coalesce(btrim(o.settings->'llm'->>'default_model'), '') <> '';
  return v_llm;
end;
$$;

revoke execute on function public.fn_llm_do_molde_de_ia() from public, anon, authenticated;

create or replace function public.fn_molde_de_ia_na_org_nova()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_molde          uuid;
  v_copiadas       integer := 0;
  v_deixadas       integer := 0;
  v_llm            jsonb;
  v_padrao_copiado boolean;
begin
  select ps.molde_de_ia_org_id into v_molde
    from public.platform_settings ps
   where ps.id = 1;
  if v_molde is null then
    return null;
  end if;

  with copiadas as (
    insert into public.ai_purpose_bindings
      (organization_id, purpose, provider, credential_id, model_id, base_url, is_enabled)
    select new.id, b.purpose, b.provider, null::uuid, b.model_id, null::text, b.is_enabled
      from public.ai_purpose_bindings b
     where b.organization_id = v_molde
       and nullif(btrim(b.base_url), '') is null
       and b.provider in ('anthropic', 'chutes', 'openai', 'openrouter')
    on conflict (organization_id, purpose) do nothing
    returning 1
  )
  select count(*) into v_copiadas from copiadas;

  select count(*) into v_deixadas
    from public.ai_purpose_bindings b
   where b.organization_id = v_molde
     and not (nullif(btrim(b.base_url), '') is null
              and b.provider in ('anthropic', 'chutes', 'openai', 'openrouter'));

  -- O padrão foi decidido pelo BEFORE (`fn_seed_org_llm_defaults`); aqui só se
  -- confere se ele é o do molde, para a auditoria dizer a verdade.
  v_llm := public.fn_llm_do_molde_de_ia();
  v_padrao_copiado := v_llm is not null
    and ((new.settings->'llm')->>'provider') is not distinct from (v_llm->>'provider')
    and ((new.settings->'llm')->>'default_model') is not distinct from (v_llm->>'default_model');

  if v_copiadas = 0 and not v_padrao_copiado then
    return null;
  end if;

  insert into public.api_audit_log
    (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
  values (
    new.id, 'ai.molde_de_ia_aplicado', 'organization', new.id, true,
    jsonb_build_object(
      'molde_org_id', v_molde,
      'funcoes_copiadas', v_copiadas,
      'funcoes_deixadas', v_deixadas,
      'padrao_copiado', v_padrao_copiado,
      'padrao', case when v_padrao_copiado then v_llm end));
  return null;
end;
$$;

revoke execute on function public.fn_molde_de_ia_na_org_nova() from public, anon, authenticated;

-- O agente foi bloqueado e selecionado por tenant. Se o UPDATE nao alterar
-- a linha, a recusa e definitiva nesta transacao: PT409 provoca rollback
-- sem o retry infinito de SQLSTATE 40001 pelo PostgREST.
create or replace function public.fn_elus_ai_draft_save_guarded(
  p_org uuid, p_agent uuid, p_mode text, p_version uuid,
  p_version_payload jsonb, p_expected jsonb, p_agent_patch jsonb,
  p_platform_bypass boolean default false
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $elus_draft_save$
declare
  v_key text;
  v_result jsonb;
  v_agent public.ai_agents%rowtype;
  v_next public.ai_agents%rowtype;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception 'elus_ai_draft_save_restricted' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('patch','create')
     or jsonb_typeof(p_agent_patch) is distinct from 'object'
     or jsonb_typeof(p_version_payload) is distinct from 'object' then
    raise exception 'elus_ai_draft_save_invalid' using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(p_agent_patch) loop
    if v_key <> all(array['name','description','priority']::text[]) then
      raise exception 'elus_ai_draft_save_column_restricted' using errcode='42501';
    end if;
  end loop;
  -- Mesma ordem de locks: organização, agente, versão.
  perform 1 from public.organizations where id=p_org for update;
  if not found then return jsonb_build_object('error','organization_not_found'); end if;
  select * into v_agent from public.ai_agents
    where id=p_agent and organization_id=p_org and archived_at is null for update;
  if not found then return jsonb_build_object('error','agent_not_found'); end if;
  if p_mode = 'patch' then
    if p_version is null then return jsonb_build_object('error','version_not_found'); end if;
    v_result := public.fn_elus_ai_version_patch_guarded(
      p_org,p_agent,p_version,p_version_payload,p_expected,p_platform_bypass);
  else
    v_result := public.fn_elus_ai_version_create_guarded(
      p_org,p_agent,p_version_payload,p_platform_bypass);
  end if;
  if v_result is null or v_result ? 'error' then
    return coalesce(v_result,jsonb_build_object('error','version_conflict'));
  end if;
  if p_agent_patch <> '{}'::jsonb then
    select * into v_next from jsonb_populate_record(v_agent,p_agent_patch);
    update public.ai_agents set
      name=v_next.name, description=v_next.description,
      priority=v_next.priority, updated_at=now()
      where id=p_agent and organization_id=p_org;
    if not found then raise exception 'elus_ai_draft_save_agent_conflict' using errcode='PT409'; end if;
  end if;
  return v_result;
end
$elus_draft_save$;

revoke all on function public.fn_elus_ai_draft_save_guarded(
  uuid,uuid,text,uuid,jsonb,jsonb,jsonb,boolean
) from public,anon,authenticated;
grant execute on function public.fn_elus_ai_draft_save_guarded(
  uuid,uuid,text,uuid,jsonb,jsonb,jsonb,boolean
) to service_role;

notify pgrst, 'reload schema';
