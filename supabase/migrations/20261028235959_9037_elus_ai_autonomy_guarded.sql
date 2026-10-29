-- manifest: ELUS 360 — isolar autonomia tecnica de IA das settings da organizacao; so Superadmin full/MFA via service_role pode alterar grants, com trigger que impede writes diretos JWT e preserva revogacoes.
-- GATE 2B.2 (proposto): port seleto do contrato ELUS antigo, sem aplicar em producao.
-- Numero 9037 confrontado em 28/10/2026 com main do upstream e arquivos das PRs abertas;
-- revalidar pnpm checar:colisao-de-migration antes do merge.
-- 9037 ELUS: autonomia tecnica de IA isolada das settings mutaveis do tenant.
-- Nao armazenar grants em organizations.settings: rotas manager+ gravam snapshots
-- inteiros dessa coluna e podem ressuscitar um grant que o Superadmin revogou.
-- A coluna isolada permite atualizar settings sem tocar em autorizacoes.
alter table public.organizations
  add column if not exists ai_autonomy jsonb not null default '{}'::jsonb;

comment on column public.organizations.ai_autonomy is
  'ELUS: grants tecnicos de IA emitidos somente via Superadmin full/MFA. Objetos com flags provider, model, credentials e operator_model; ausencia = false. Isolado de settings para nao ressuscitar revogacoes por writes concorrentes.';

-- O grant de tabela para authenticated eh ALL no baseline. RLS orgs_write_platform_admin
-- nao distingue scope full de support_readonly, portanto proteger no banco tambem.
-- Nenhuma operacao JWT authenticated, inclusive via SECURITY DEFINER, pode escrever
-- a coluna. A API governada usa service_role, apos autenticar full/MFA e auditar.
create or replace function public.fn_guard_organizations_ai_autonomy()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_changed boolean;
  v_privileged boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.ai_autonomy is distinct from '{}'::jsonb;
  else
    v_changed := new.ai_autonomy is distinct from old.ai_autonomy;
  end if;

  if v_changed then
    v_privileged :=
      (current_user = 'service_role' and auth.role() = 'service_role')
      or (current_user = 'postgres' and auth.uid() is null and auth.role() is null);
    if not coalesce(v_privileged, false) then
      raise exception 'elus_ai_autonomy_restricted'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_organizations_ai_autonomy on public.organizations;
create trigger trg_guard_organizations_ai_autonomy
before insert or update on public.organizations
for each row
execute function public.fn_guard_organizations_ai_autonomy();

revoke all on function public.fn_guard_organizations_ai_autonomy()
  from public, anon, authenticated;


-- Escrita técnica atômica: service_role apenas, após auth/tenant/RBAC no servidor.
-- A row lock de organizations serializa este PATCH com a revogação de grants.
create or replace function public.fn_elus_ai_version_patch_guarded(
  p_org uuid, p_agent uuid, p_version uuid,
  p_patch jsonb, p_expected jsonb, p_platform_bypass boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $elus_patch$
declare
  v_grants jsonb;
  v_old public.ai_agent_versions%rowtype;
  v_new public.ai_agent_versions%rowtype;
  v_row jsonb;
  v_key text;
  v_required text;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception 'elus_ai_version_patch_restricted' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or jsonb_typeof(p_expected) is distinct from 'object'
     or p_patch = '{}'::jsonb then
    raise exception 'elus_ai_version_patch_invalid' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key <> all(array['system_prompt', 'provider', 'model', 'credential_id', 'operator_model', 'operator_enabled', 'operator_tool_ids', 'tool_ids', 'trigger_config', 'channel_session_id', 'max_steps', 'token_budget', 'cost_budget_cents', 'history_message_window', 'history_token_window', 'handoff_keywords', 'handoff_tool_enabled', 'handoff_legal_enabled', 'proposal_ai_draft_enabled', 'cases_enabled', 'split_messages', 'split_max_chars', 'inbound_debounce_ms', 'pipeline_ids', 'knowledge_source_ids', 'followup']::text[]) then
      raise exception 'elus_ai_version_patch_column_restricted' using errcode = '42501';
    end if;
  end loop;
  -- Lock order: organization primeiro, depois version. Revogação usa a mesma linha.
  select ai_autonomy into v_grants from public.organizations
    where id = p_org for update;
  if not found then return jsonb_build_object('error', 'organization_not_found'); end if;
  select * into v_old from public.ai_agent_versions
    where id=p_version and agent_id=p_agent and organization_id=p_org for update;
  if not found then return jsonb_build_object('error', 'version_not_found'); end if;
  if v_old.status <> 'draft' then return jsonb_build_object('error', 'version_immutable'); end if;
  -- CAS do servidor (não aceitar referências do corpo do cliente sem leitura anterior).
  if (to_jsonb(v_old)->'provider') is distinct from (p_expected->'provider')
     or (to_jsonb(v_old)->'model') is distinct from (p_expected->'model')
     or (to_jsonb(v_old)->'credential_id') is distinct from (p_expected->'credential_id')
     or (to_jsonb(v_old)->'operator_model') is distinct from (p_expected->'operator_model')
     or (p_patch ? 'system_prompt' and
         (to_jsonb(v_old)->'system_prompt') is distinct from (p_expected->'system_prompt'))
     or (p_patch ? 'followup' and
         (to_jsonb(v_old)->'followup') is distinct from (p_expected->'followup'))
  then return jsonb_build_object('error', 'version_conflict'); end if;
  if not coalesce(p_platform_bypass,false) then
    for v_key, v_required in
      select column_name, grant_name from (values
        ('provider','provider'), ('model','model'),
        ('credential_id','credentials'), ('operator_model','operator_model')
      ) as technical(column_name,grant_name)
    loop
      if p_patch ? v_key
         and (p_patch->v_key) is distinct from (to_jsonb(v_old)->v_key)
         and (v_grants->v_required) is distinct from 'true'::jsonb
      then return jsonb_build_object('error', 'forbidden_platform_ai'); end if;
    end loop;
  end if;
  select * into v_new from jsonb_populate_record(v_old,p_patch);
  update public.ai_agent_versions
  set
    system_prompt = v_new.system_prompt,
    provider = v_new.provider,
    model = v_new.model,
    credential_id = v_new.credential_id,
    operator_model = v_new.operator_model,
    operator_enabled = v_new.operator_enabled,
    operator_tool_ids = v_new.operator_tool_ids,
    tool_ids = v_new.tool_ids,
    trigger_config = v_new.trigger_config,
    channel_session_id = v_new.channel_session_id,
    max_steps = v_new.max_steps,
    token_budget = v_new.token_budget,
    cost_budget_cents = v_new.cost_budget_cents,
    history_message_window = v_new.history_message_window,
    history_token_window = v_new.history_token_window,
    handoff_keywords = v_new.handoff_keywords,
    handoff_tool_enabled = v_new.handoff_tool_enabled,
    handoff_legal_enabled = v_new.handoff_legal_enabled,
    proposal_ai_draft_enabled = v_new.proposal_ai_draft_enabled,
    cases_enabled = v_new.cases_enabled,
    split_messages = v_new.split_messages,
    split_max_chars = v_new.split_max_chars,
    inbound_debounce_ms = v_new.inbound_debounce_ms,
    pipeline_ids = v_new.pipeline_ids,
    knowledge_source_ids = v_new.knowledge_source_ids,
    followup = v_new.followup
  where id=p_version and agent_id=p_agent and organization_id=p_org and status='draft'
  returning to_jsonb(ai_agent_versions) into v_row;
  if v_row is null then return jsonb_build_object('error','version_conflict'); end if;
  return v_row;
end
$elus_patch$;

revoke all on function public.fn_elus_ai_version_patch_guarded(
  uuid, uuid, uuid, jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.fn_elus_ai_version_patch_guarded(
  uuid, uuid, uuid, jsonb, jsonb, boolean
) to service_role;

-- Criação atômica de versão. A linha de organizations serializa revogação
-- e a linha ai_agents serializa version_number para o mesmo agente.
create or replace function public.fn_elus_ai_version_create_guarded(
  p_org uuid, p_agent uuid, p_payload jsonb, p_platform_bypass boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $elus_create$
declare
  v_grants jsonb;
  v_reference public.ai_agent_versions%rowtype;
  v_next integer;
  v_key text;
  v_grant text;
  v_row jsonb;
  v_values public.ai_agent_versions%rowtype;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception 'elus_ai_version_create_restricted' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'elus_ai_version_create_invalid' using errcode='22023';
  end if;
  -- Somente campos de versão permitidos; org/agent/id/status e número
  -- são sempre escolhidos nesta transação, jamais a partir do request.
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key <> all(array[
      'system_prompt','provider','model','credential_id','tool_ids',
      'trigger_config','channel_session_id','max_steps','token_budget',
      'cost_budget_cents','history_message_window','history_token_window',
      'handoff_keywords','handoff_tool_enabled','handoff_legal_enabled',
      'proposal_ai_draft_enabled','cases_enabled','split_messages',
      'split_max_chars','inbound_debounce_ms','followup','operator_enabled',
      'operator_model','operator_tool_ids','pipeline_ids',
      'knowledge_source_ids','created_by'
    ]::text[]) then
      raise exception 'elus_ai_version_create_column_restricted' using errcode='42501';
    end if;
  end loop;
  select ai_autonomy into v_grants from public.organizations
    where id=p_org for update;
  if not found then return jsonb_build_object('error','organization_not_found'); end if;
  perform 1 from public.ai_agents where id=p_agent and organization_id=p_org
    and archived_at is null for update;
  if not found then return jsonb_build_object('error','agent_not_found'); end if;
  select * into v_reference from public.ai_agent_versions
    where organization_id=p_org and agent_id=p_agent
    order by version_number desc limit 1;
  if not found then return jsonb_build_object('error','reference_not_found'); end if;
  if not coalesce(p_platform_bypass,false) then
    for v_key,v_grant in
      select column_name,grant_name from (values
        ('provider','provider'),('model','model'),
        ('credential_id','credentials'),('operator_model','operator_model')
      ) as t(column_name,grant_name)
    loop
      if p_payload ? v_key
        and (p_payload->v_key) is distinct from (to_jsonb(v_reference)->v_key)
        and (v_grants->v_grant) is distinct from 'true'::jsonb
      then return jsonb_build_object('error','forbidden_platform_ai'); end if;
    end loop;
  end if;
  select coalesce(max(version_number),0)+1 into v_next
    from public.ai_agent_versions where organization_id=p_org and agent_id=p_agent;
  select * into v_values from jsonb_populate_record(
    null::public.ai_agent_versions,p_payload);
  insert into public.ai_agent_versions (
    organization_id,agent_id,version_number,system_prompt,provider,model,
    credential_id,tool_ids,trigger_config,channel_session_id,max_steps,
    token_budget,cost_budget_cents,history_message_window,history_token_window,
    handoff_keywords,handoff_tool_enabled,handoff_legal_enabled,
    proposal_ai_draft_enabled,cases_enabled,split_messages,split_max_chars,
    inbound_debounce_ms,followup,operator_enabled,operator_model,operator_tool_ids,
    pipeline_ids,knowledge_source_ids,status,created_by
  ) values (
    p_org,p_agent,v_next,v_values.system_prompt,v_values.provider,v_values.model,
    v_values.credential_id,coalesce(v_values.tool_ids,'{}'::text[]),
    coalesce(v_values.trigger_config,
      '{"events":["message"],"filters":{},"concurrency":"one_per_conversation"}'::jsonb),
    v_values.channel_session_id,coalesce(v_values.max_steps,10),
    coalesce(v_values.token_budget,50000),coalesce(v_values.cost_budget_cents,50),
    coalesce(v_values.history_message_window,20),coalesce(v_values.history_token_window,8000),
    coalesce(v_values.handoff_keywords,'{}'::text[]),
    coalesce(v_values.handoff_tool_enabled,true),v_values.handoff_legal_enabled,
    v_values.proposal_ai_draft_enabled,v_values.cases_enabled,v_values.split_messages,
    v_values.split_max_chars,v_values.inbound_debounce_ms,v_values.followup,
    v_values.operator_enabled,v_values.operator_model,v_values.operator_tool_ids,
    v_values.pipeline_ids,v_values.knowledge_source_ids,'draft',v_values.created_by
  ) returning to_jsonb(ai_agent_versions) into v_row;
  return v_row;
end
$elus_create$;

revoke all on function public.fn_elus_ai_version_create_guarded(
  uuid,uuid,jsonb,boolean
) from public,anon,authenticated;
grant execute on function public.fn_elus_ai_version_create_guarded(
  uuid,uuid,jsonb,boolean
) to service_role;

-- Criação inicial atômica: agente e draft juntos ou nenhum.
-- Nunca aceita tenant/identidade do request como autoridade: parâmetros e
-- payloads são construídos pelo handler após auth, tenancy e escopo.
create or replace function public.fn_elus_ai_agent_create_guarded(
  p_org uuid, p_agent jsonb, p_version jsonb,
  p_platform_bypass boolean default false
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $elus_agent_create$
declare
  v_grants jsonb;
  v_settings jsonb;
  v_default_provider text;
  v_default_model text;
  v_key text;
  v_grant text;
  v_agent public.ai_agents%rowtype;
  v_version public.ai_agent_versions%rowtype;
  v_agent_row jsonb;
  v_version_row jsonb;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception 'elus_ai_agent_create_restricted' using errcode='42501';
  end if;
  if jsonb_typeof(p_agent) is distinct from 'object' or
     jsonb_typeof(p_version) is distinct from 'object' then
    raise exception 'elus_ai_agent_create_invalid' using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(p_agent) loop
    if v_key <> all(array[
      'id','name','description','model','system_prompt','kind','priority',
      'is_active','is_default','created_by'
    ]::text[]) then
      raise exception 'elus_ai_agent_create_column_restricted' using errcode='42501';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_version) loop
    if v_key <> all(array[
      'id','system_prompt','provider','model','credential_id','tool_ids',
      'trigger_config','channel_session_id','max_steps','token_budget',
      'cost_budget_cents','history_message_window','history_token_window',
      'handoff_keywords','handoff_tool_enabled','handoff_legal_enabled',
      'proposal_ai_draft_enabled','cases_enabled','split_messages','split_max_chars',
      'inbound_debounce_ms','followup','operator_enabled','operator_model',
      'operator_tool_ids','pipeline_ids','knowledge_source_ids','created_by'
    ]::text[]) then
      raise exception 'elus_ai_agent_create_version_column_restricted' using errcode='42501';
    end if;
  end loop;
  select ai_autonomy,settings into v_grants,v_settings
    from public.organizations where id=p_org for update;
  if not found then return jsonb_build_object('error','organization_not_found'); end if;
  v_default_provider := coalesce(nullif(v_settings #>> '{llm,provider}',''),'anthropic');
  v_default_model := nullif(v_settings #>> '{llm,default_model}','');
  if not coalesce(p_platform_bypass,false) then
    for v_key,v_grant in
      select column_name,grant_name from (values
        ('provider','provider'),('model','model'),
        ('credential_id','credentials'),('operator_model','operator_model')
      ) as t(column_name,grant_name)
    loop
      if p_version ? v_key and (
        case v_key
          when 'provider' then p_version->v_key is distinct from to_jsonb(v_default_provider)
          when 'model' then p_version->v_key is distinct from to_jsonb(v_default_model)
          else p_version->v_key is distinct from 'null'::jsonb
        end
      ) and (v_grants->v_grant) is distinct from 'true'::jsonb then
        return jsonb_build_object('error','forbidden_platform_ai');
      end if;
    end loop;
  end if;
  select * into v_agent from jsonb_populate_record(null::public.ai_agents,p_agent);
  select * into v_version from jsonb_populate_record(null::public.ai_agent_versions,p_version);
  if v_agent.id is null or v_version.id is null
     or v_agent.kind is distinct from 'mcp_agent'
     or v_version.provider is null or v_version.model is null
     or v_version.system_prompt is null
     or v_agent.created_by is distinct from v_version.created_by then
    raise exception 'elus_ai_agent_create_invalid_payload' using errcode='22023';
  end if;
  insert into public.ai_agents(
    id,organization_id,name,description,model,system_prompt,kind,priority,
    is_active,is_default,created_by
  ) values (
    v_agent.id,p_org,v_agent.name,v_agent.description,v_agent.model,
    v_agent.system_prompt,'mcp_agent',v_agent.priority,coalesce(v_agent.is_active,false),false,v_agent.created_by
  ) returning to_jsonb(ai_agents) into v_agent_row;
  insert into public.ai_agent_versions(
    id,organization_id,agent_id,version_number,status,created_by,system_prompt,
    provider,model,credential_id,tool_ids,trigger_config,channel_session_id,
    max_steps,token_budget,cost_budget_cents,history_message_window,
    history_token_window,handoff_keywords,handoff_tool_enabled,
    handoff_legal_enabled,proposal_ai_draft_enabled,cases_enabled,split_messages,
    split_max_chars,inbound_debounce_ms,followup,operator_enabled,operator_model,
    operator_tool_ids,pipeline_ids,knowledge_source_ids
  ) values (
    v_version.id,p_org,v_agent.id,1,'draft',v_version.created_by,v_version.system_prompt,
    v_version.provider,v_version.model,v_version.credential_id,
    coalesce(v_version.tool_ids,'{}'::text[]),
    coalesce(v_version.trigger_config,
      '{"events":["message"],"filters":{},"concurrency":"one_per_conversation"}'::jsonb),
    v_version.channel_session_id,coalesce(v_version.max_steps,10),
    coalesce(v_version.token_budget,50000),coalesce(v_version.cost_budget_cents,50),
    coalesce(v_version.history_message_window,20),coalesce(v_version.history_token_window,8000),
    coalesce(v_version.handoff_keywords,'{}'::text[]),
    coalesce(v_version.handoff_tool_enabled,true),v_version.handoff_legal_enabled,
    v_version.proposal_ai_draft_enabled,v_version.cases_enabled,v_version.split_messages,
    v_version.split_max_chars,v_version.inbound_debounce_ms,v_version.followup,
    v_version.operator_enabled,v_version.operator_model,v_version.operator_tool_ids,
    v_version.pipeline_ids,v_version.knowledge_source_ids
  ) returning to_jsonb(ai_agent_versions) into v_version_row;
  return jsonb_build_object('agent',v_agent_row,'version',v_version_row);
end
$elus_agent_create$;

revoke all on function public.fn_elus_ai_agent_create_guarded(
  uuid,jsonb,jsonb,boolean
) from public,anon,authenticated;
grant execute on function public.fn_elus_ai_agent_create_guarded(
  uuid,jsonb,jsonb,boolean
) to service_role;

-- Salva cadastro e versão no mesmo comando PostgreSQL. Falha de qualquer
-- etapa aborta a transação inteira, sem gravar dados parciais.
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
    if not found then raise exception 'elus_ai_draft_save_agent_conflict' using errcode='40001'; end if;
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


-- A escolha de IA por ponto deve serializar com a revogação dos grants.
-- O handler verifica sessão/RBAC/MFA; a RPC aplica a permissão ATUAL sob lock.
create or replace function public.fn_elus_ai_purpose_binding_write_guarded(
  p_org uuid, p_purpose text, p_values jsonb, p_expected jsonb,
  p_platform_bypass boolean default false
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $elus_binding_write$
declare
  v_grants jsonb;
  v_previous public.ai_purpose_bindings%rowtype;
  v_value public.ai_purpose_bindings%rowtype;
  v_result jsonb;
  v_key text;
begin
  if current_user <> 'service_role' or auth.role() is distinct from 'service_role' then
    raise exception 'elus_ai_binding_restricted' using errcode='42501';
  end if;
  if p_org is null or nullif(p_purpose,'') is null
     or jsonb_typeof(p_values) is distinct from 'object'
     or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'elus_ai_binding_invalid' using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(p_values) loop
    if v_key <> all(array['provider','model_id','credential_id','base_url','is_enabled']::text[]) then
      raise exception 'elus_ai_binding_column_restricted' using errcode='42501';
    end if;
  end loop;
  select ai_autonomy into v_grants from public.organizations where id=p_org for update;
  if not found then return jsonb_build_object('error','organization_not_found'); end if;
  select * into v_previous from public.ai_purpose_bindings
    where organization_id=p_org and purpose=p_purpose for update;
  if found then
    if (to_jsonb(v_previous)->'provider') is distinct from (p_expected->'provider')
       or (to_jsonb(v_previous)->'model_id') is distinct from (p_expected->'model_id')
       or (to_jsonb(v_previous)->'credential_id') is distinct from (p_expected->'credential_id')
       or (to_jsonb(v_previous)->'base_url') is distinct from (p_expected->'base_url')
       or (to_jsonb(v_previous)->'is_enabled') is distinct from (p_expected->'is_enabled') then
      return jsonb_build_object('error','version_conflict');
    end if;
  elsif p_expected <> '{}'::jsonb then
    return jsonb_build_object('error','version_conflict');
  end if;
  select * into v_value from jsonb_populate_record(
    case when v_previous.id is null then null::public.ai_purpose_bindings else v_previous end,
    p_values);
  if v_value.provider is null or v_value.model_id is null or v_value.is_enabled is null then
    raise exception 'elus_ai_binding_invalid_payload' using errcode='22023';
  end if;
  if not coalesce(p_platform_bypass,false) then
    if (v_value.provider is distinct from v_previous.provider or
        v_value.base_url is distinct from v_previous.base_url or
        v_value.is_enabled is distinct from v_previous.is_enabled) and
       (v_grants->'provider') is distinct from 'true'::jsonb then
      return jsonb_build_object('error','forbidden_platform_ai');
    end if;
    if v_value.model_id is distinct from v_previous.model_id and
       (v_grants->'model') is distinct from 'true'::jsonb then
      return jsonb_build_object('error','forbidden_platform_ai');
    end if;
    if v_value.credential_id is distinct from v_previous.credential_id and
       (v_grants->'credentials') is distinct from 'true'::jsonb then
      return jsonb_build_object('error','forbidden_platform_ai');
    end if;
  end if;
  if v_previous.id is null then
    insert into public.ai_purpose_bindings(
      organization_id,purpose,provider,model_id,credential_id,base_url,is_enabled)
    values(p_org,p_purpose,v_value.provider,v_value.model_id,
      v_value.credential_id,v_value.base_url,v_value.is_enabled)
    returning jsonb_build_object('id',id,'purpose',purpose,'provider',provider,
      'model_id',model_id,'credential_id',credential_id,'base_url',base_url,
      'is_enabled',is_enabled) into v_result;
  else
    update public.ai_purpose_bindings set
      provider=v_value.provider,model_id=v_value.model_id,
      credential_id=v_value.credential_id,base_url=v_value.base_url,
      is_enabled=v_value.is_enabled,updated_at=now()
      where id=v_previous.id and organization_id=p_org
      returning jsonb_build_object('id',id,'purpose',purpose,'provider',provider,
        'model_id',model_id,'credential_id',credential_id,'base_url',base_url,
        'is_enabled',is_enabled) into v_result;
  end if;
  return v_result;
end
$elus_binding_write$;
revoke all on function public.fn_elus_ai_purpose_binding_write_guarded(
  uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.fn_elus_ai_purpose_binding_write_guarded(
  uuid,text,jsonb,jsonb,boolean) to service_role;
