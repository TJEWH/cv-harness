-- Test-only deployed predecessor bodies not present in earlier standalone releases.
-- Captured from the reviewed pre-current-saves schema; never installed in production.


CREATE OR REPLACE FUNCTION private.read_adaptive_search_rollback(p_search_id uuid, p_rollback_id uuid, p_project_ref text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare scope jsonb;requested public.opportunity_search_rollback_requests;config public.opportunity_search_runner_config;
  binding public.opportunity_search_schedule_bindings;operation private.opportunity_search_setup_operations;archive record;entry record;protocol record;
  template record;prompt text;origin text;normalized text;latest_revision bigint;
begin
  scope:=private.require_adaptive_setup_scope(p_search_id,p_project_ref,false);
  if p_rollback_id is null then return private.adaptive_search_rollback_error('rollback_not_requested');end if;
  perform pg_advisory_xact_lock(hashtextextended('search-schedule:'||p_search_id::text,0));
  select * into requested from public.opportunity_search_rollback_requests where user_id=(scope->>'user_id')::uuid and search_id=p_search_id and rollback_id=p_rollback_id;
  if not found or requested.project_ref is distinct from p_project_ref then return private.adaptive_search_rollback_error('rollback_not_requested');end if;
  if exists(select 1 from public.opportunity_search_setup_claims where search_id=p_search_id and setup_id<>p_rollback_id)
    or exists(select 1 from private.opportunity_search_schedule_claims where search_id=p_search_id) then return private.adaptive_search_rollback_error('setup_in_progress');end if;
  select * into config from public.opportunity_search_runner_config where user_id=requested.user_id and search_id=p_search_id for update;
  select * into binding from public.opportunity_search_schedule_bindings where user_id=requested.user_id and search_id=p_search_id;
  select max(r.rollback_revision) into latest_revision from public.opportunity_search_rollback_requests r where r.user_id=requested.user_id and r.search_id=p_search_id;
  if latest_revision<>requested.rollback_revision or config.revision<>requested.runner_revision or config.setup_id<>p_rollback_id
    or config.mode is distinct from 'adaptive' then return private.adaptive_search_rollback_error('rollback_stale');end if;
  if requested.binding_hash<>private.adaptive_search_binding_hash(requested.user_id,p_search_id) or binding.runner_capability is distinct from 'adaptive-batch-v1'
    or not public.adaptive_search_setup_task_id(binding.task_id) then return private.adaptive_search_rollback_error('binding_changed');end if;
  select p.contract_version,p.version,p.result_schema into protocol from private.opportunity_search_settings s
    join private.opportunity_search_protocols p on p.version=s.active_protocol_version where s.singleton;
  if protocol.contract_version is distinct from 1 or protocol.version is distinct from 'opportunity-search-v1-canonical-6'
    or protocol.result_schema is distinct from private.opportunity_search_result_schema()
    or not coalesce((select bool_and(to_regprocedure(signature) is not null) from unnest(array[
      'private.begin_opportunity_search(uuid,uuid)','private.refresh_opportunity_search_protocol(uuid)',
      'private.save_opportunity_search_queries(uuid,jsonb)','private.inspect_opportunity_search_result(uuid,jsonb)',
      'private.submit_opportunity_search_result(uuid,uuid,jsonb)','private.verify_opportunity_search_result(uuid,uuid)',
      'private.complete_opportunity_search(uuid,jsonb)','private.read_opportunity_search_run(uuid)',
      'private.opportunity_canonical_input(jsonb,jsonb,text)','private.opportunity_payload_storage_valid(jsonb)']) signature),false)
    then return private.adaptive_search_rollback_error('legacy_prerequisite_missing');end if;
  select t.criteria,t.schedule,t.revision into template from public.opportunity_search_templates t where t.user_id=requested.user_id and t.id=p_search_id;
  for entry in select key,value from jsonb_each(template.criteria) loop
    if entry.key not in('opportunityTypes','topicsAndMethods','locationsAndLanguages','fundingAndConditions','fitAndExclusions','sourcesAndQueries','researchAndReporting')
      or jsonb_typeof(entry.value) is distinct from 'string' or not private.opportunity_search_adaptive_text(entry.value#>>'{}',12000) then
      return private.adaptive_search_rollback_error('setup_conversion_required');end if;
  end loop;
  -- Acknowledged archives establish a past task-tool attestation, not proof of
  -- unattended execution. Only known dynamic legacy instructions are reusable.
  for archive in select o.recurring_prompt,o.recurring_prompt_hash from private.opportunity_search_setup_operations o
    join private.opportunity_search_setup_acknowledgements a on a.setup_id=o.setup_id
    where o.user_id=requested.user_id and o.search_id=p_search_id and o.project_ref=p_project_ref and o.mode='legacy' and o.purpose='setup'
      and a.result->'acknowledged'='true'::jsonb and a.result->>'task_id'=binding.task_id order by o.created_at desc,o.setup_id loop
    normalized:=regexp_replace(replace(regexp_replace(archive.recurring_prompt,p_search_id::text,'SEARCH_UUID','gi'),p_project_ref,'PROJECT_REF'),'execute_sql','CONNECTOR','gi');
    if encode(sha256(convert_to(archive.recurring_prompt,'UTF8')),'hex')=archive.recurring_prompt_hash
      -- An old acknowledgement plus a text sanitizer is not an instruction
      -- allowlist. Only this reviewed known dynamic technical prompt is an
      -- automatically restorable archive; unknown old prose needs explicit
      -- acceptance of the reviewed fallback instead of execution by inference.
      and archive.recurring_prompt=private.legacy_dynamic_search_rollback_prompt(p_search_id,p_project_ref)
      and position(p_search_id::text in lower(archive.recurring_prompt))>0 and position(p_project_ref in archive.recurring_prompt)>0
      and position('private.begin_opportunity_search(' in archive.recurring_prompt)>0
      and archive.recurring_prompt!~*'begin_adaptive_opportunity_search|submit_adaptive_search_batch|verify_and_complete_adaptive_search'
      and private.opportunity_search_adaptive_text(normalized,12000) then prompt:=archive.recurring_prompt;origin:='acknowledged_legacy';exit;end if;
  end loop;
  if prompt is null then
    if not requested.accept_reviewed_fallback then return private.adaptive_search_rollback_error('fallback_acceptance_required');end if;
    prompt:=private.legacy_dynamic_search_rollback_prompt(p_search_id,p_project_ref);origin:='reviewed_legacy_fallback';
  end if;
  select * into operation from private.opportunity_search_setup_operations where setup_id=p_rollback_id for update;
  if found then
    if(operation.user_id,operation.search_id,operation.project_ref,operation.purpose,operation.mode,operation.config_revision,operation.binding_hash,
      operation.schedule,operation.template_revision,operation.recurring_prompt,operation.rollback_prompt_origin)
      is distinct from(requested.user_id,p_search_id,p_project_ref,'rollback','legacy',config.revision,requested.binding_hash,
        template.schedule,template.revision,prompt,origin) then return private.adaptive_search_rollback_error('rollback_stale');end if;
  else
    insert into private.opportunity_search_setup_operations(setup_id,user_id,search_id,project_ref,mode,config_revision,release_revision,authorization_epoch,authorization_revision,
      binding_hash,target_task_id,runner_capability,template_revision,schedule,recurring_prompt,recurring_prompt_hash,handoff,purpose,rollback_prompt_origin)
      values(p_rollback_id,requested.user_id,p_search_id,p_project_ref,'legacy',config.revision,(scope->>'release_revision')::bigint,
        (scope->>'authorization_epoch')::uuid,(scope->>'authorization_revision')::bigint,requested.binding_hash,binding.task_id,'legacy-v1',template.revision,
        template.schedule,prompt,encode(sha256(convert_to(prompt,'UTF8')),'hex'),'{}','rollback',origin);
    insert into public.opportunity_search_setup_claims(search_id,user_id,setup_id) values(p_search_id,requested.user_id,p_rollback_id);
    update private.opportunity_search_setup_operations set handoff=private.adaptive_search_rollback_handoff(p_rollback_id) where setup_id=p_rollback_id;
  end if;
  return private.adaptive_search_rollback_handoff(p_rollback_id);
exception when insufficient_privilege then return private.adaptive_search_rollback_error('scope_unavailable');
  when unique_violation then return private.adaptive_search_rollback_error('setup_in_progress');
  when others then return private.adaptive_search_rollback_error('invalid_rollback');
end;
$$;

CREATE OR REPLACE FUNCTION private.read_adaptive_search_setup(p_search_id uuid, p_setup_id uuid, p_project_ref text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare result jsonb;
begin
  result:=private.read_adaptive_search_setup_internal(p_search_id,p_setup_id,p_project_ref);
  if result->'compatible'='true'::jsonb and result->>'mode'='legacy'
    and(private.adaptive_search_rollback_publication_pending(p_search_id)
      or(result->>'recurringPrompt')~*'begin_adaptive_opportunity_search|submit_adaptive_search_batch|verify_and_complete_adaptive_search') then
    raise exception 'Republish the legacy technical prompt first' using errcode='PZ004';end if;
  return result;
exception when sqlstate 'PZ004' then return private.adaptive_search_setup_error('setup_conversion_required');
end;
$$;
