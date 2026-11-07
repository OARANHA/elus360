-- manifest: Reconcilia a criacao atomica de agentes IA v1.102 com campos completos de versao, preservando isolamento e autorizacao.

-- ELUS360 forward migration 9901: agent creation v1.102.0.
-- Original 9900 stays byte-exact. No RLS, MFA or tenant grants weakened.
-- New version fields remain inside the single locked transaction.
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
      'proposal_ai_draft_enabled','cases_enabled','image_vision_enabled',
      'split_messages','split_max_chars',
      'inbound_debounce_ms','reply_min_interval_ms','followup',
      'voz_enabled','voz_quando','operator_enabled','operator_model',
      'operator_tool_ids','pipeline_ids','knowledge_source_ids','skill_names','created_by'
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
    handoff_legal_enabled,proposal_ai_draft_enabled,cases_enabled,
    image_vision_enabled,split_messages,split_max_chars,inbound_debounce_ms,
    reply_min_interval_ms,followup,voz_enabled,voz_quando,operator_enabled,
    operator_model,operator_tool_ids,pipeline_ids,knowledge_source_ids,skill_names
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
    v_version.proposal_ai_draft_enabled,v_version.cases_enabled,
    coalesce(v_version.image_vision_enabled,true),v_version.split_messages,
    v_version.split_max_chars,v_version.inbound_debounce_ms,
    v_version.reply_min_interval_ms,v_version.followup,
    coalesce(v_version.voz_enabled,false),coalesce(v_version.voz_quando,'espelhar'),
    v_version.operator_enabled,v_version.operator_model,v_version.operator_tool_ids,
    v_version.pipeline_ids,v_version.knowledge_source_ids,v_version.skill_names
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

