-- Bounded startup diagnostics only. No prompt, result shape, authorization or saved data changes.
-- RAISE LOG reports function outcomes, not transaction commit or client receipt.
begin;
do $guard$
begin
  if (select md5(prosrc) from pg_catalog.pg_proc where oid=to_regprocedure('private.begin_adaptive_search_brief(uuid,uuid)'))
    is distinct from 'b6de86d0ba66fc0cbe6ec5910b49a970' then
    raise exception 'Expected the reviewed startup logging predecessor: begin_adaptive_search_brief';
  end if;
  if (select md5(prosrc) from pg_catalog.pg_proc where oid=to_regprocedure('private.begin_adaptive_opportunity_search(uuid,uuid)'))
    is distinct from '395f824960b57f5bd0757b4ac041cd99' then
    raise exception 'Expected the reviewed startup logging predecessor: begin_adaptive_opportunity_search';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION private.begin_adaptive_search_brief(p_search_id uuid, p_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare bundle jsonb;brief jsonb;owner_id uuid;previous_run record;
  log_scope jsonb:=jsonb_build_object('diagnostic_version',1,'search_id',p_search_id,'run_id',p_run_id);
  log_stage text:='authorization';
begin
  -- Server logs survive a local connector-decoding failure and transaction
  -- rollback. A returned event describes this function, not client receipt or commit.
  raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','entered','stage',log_stage);
  if current_user<>'postgres' then raise exception 'Management startup access is required' using errcode='42501';end if;
  -- Keep all authorization, pinning, lease and privacy checks in the existing
  -- implementation. Batch verification continues to use its full internal DTO.
  log_stage:='bootstrap';
  bundle:=private.begin_adaptive_opportunity_search(p_search_id,p_run_id);
  if bundle#>>'{error,code}'='run_in_progress'
    and not exists(select 1 from public.opportunity_search_runs where id=p_run_id)
    and not exists(select 1 from private.opportunity_search_lifecycle_operations where restart_run_id=p_run_id) then
    -- The inner startup validated authorization and holds the owner/search
    -- advisory lock until this transaction ends. Replace only for a fresh UUID;
    -- a retry, stale worker or older reserved restart must never evict a new run.
    log_stage:='supersession';
    select user_id into owner_id from public.opportunity_search_templates where id=p_search_id;
    for previous_run in select id from public.opportunity_search_runs
      where user_id=owner_id and search_id=p_search_id and status='running' order by id for update loop
      update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',
        superseded_by_run_id=p_run_id,adaptive_lease_expires_at=NULL,
        summary=jsonb_build_object('adaptive_status','superseded','coverage','partial','status','failed','superseded_by_run_id',p_run_id)
        where id=previous_run.id;
      update private.opportunity_search_adaptive_contexts set lease_expires_at=least(lease_expires_at,clock_timestamp()) where run_id=previous_run.id;
    end loop;
    log_stage:='replacement_startup';
    bundle:=private.begin_adaptive_opportunity_search(p_search_id,p_run_id);
    -- The inner helper returns typed errors rather than throwing. Raise here so
    -- those errors also roll back replacement and retain the previous execution.
    if bundle->'compatible' is distinct from 'true'::jsonb then raise exception 'Replacement startup was rejected' using errcode='PZ005';end if;
  end if;
  if bundle#>>'{error,code}'='scope_oversized' then raise exception 'Adaptive scope exceeds its bound' using errcode='54000';end if;
  if bundle->'compatible' is distinct from 'true'::jsonb then
    raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','returned','stage',log_stage,'compatible',false,
      'error_code',bundle#>>'{error,code}','response_bytes',octet_length(bundle::text));
    return bundle;
  end if;
  log_stage:='projection';
  brief:=bundle||jsonb_build_object('brief_version',1,'response_limit_bytes',65536);
  -- Clarify existing evidence validation in the hosted response without
  -- changing the pinned internal protocol, schema, receipts or retry identity.
  brief:=jsonb_set(brief,'{protocol_text}',to_jsonb((bundle->>'protocol_text')||E'\n\nEVIDENCE FIELD NAMES\n'
    ||E'Each sources[].supports entry identifies a canonical opportunity field actually evidenced by that source. Use an exact name from the following JSON list, or a JSON pointer rooted in one of those names (for example /data/funding). Do not use display labels, prose, source kinds, or an opportunity. prefix. Check every entry locally against this list before submission; no database discovery is needed. Keep only supported claims and never invent a field name.\n'
    ||(select jsonb_agg(key order by key)::text from jsonb_object_keys(private.opportunity_storage_schema()->'properties') as fields(key))));
  -- Transport projection only: bundle has already passed full startup validation.
  -- Keep preferences, context and schema unchanged; retain snapshot statistics.
  select jsonb_set(brief, '{planning}',
    ((bundle->'planning')-array['approved_rules','approved_preferences']) || jsonb_build_object(
      'priorities',coalesce(jsonb_agg(priority order by position) filter (where keep),'[]'::jsonb),
      'priority_projection',jsonb_build_object('policy','approved-and-supported-directions-v1',
        'included_count',count(*) filter (where keep),
        'omitted_advisory_count',count(*) filter (where not keep)))) into brief
  from (
    select priority,position,(priority->>'basis'='approved'
      or (priority->'provisional'='false'::jsonb and priority->>'direction' in ('increase','decrease'))) as keep
    from jsonb_array_elements(bundle#>'{planning,priorities}') with ordinality as p(priority,position)
  ) priorities;
  brief:=jsonb_set(brief,'{feedback}',
    ((bundle->'feedback')-array['approved_preferences','fingerprint_encoding','input_fingerprint']) ||
    jsonb_build_object('example_projection',jsonb_build_object('version',1,
      'selected_ids_and_order_preserved',true,'research_summary_preview_max_characters',240)));
  brief:=jsonb_set(brief,'{feedback,aggregates}',(bundle#>'{feedback,aggregates}')-'groups');
  select jsonb_set(brief,'{feedback,examples}',coalesce(jsonb_agg(
    (select jsonb_object_agg(key,value) from jsonb_each(example) where key=any(array[
      'opportunity_id','title','institution','topics','interest_score','interest_origin','interest_gap',
      'review_state','metric_version','confirmed_submission','reasons','search_feedback_summary','technical_issue_category','manually_archived']))
    || jsonb_build_object('predicted_interest_score',example#>'{original_prediction,score}')
    || case when example ? 'summary_inclusion' then jsonb_build_object('summary_inclusion',
      jsonb_build_object('source_length',example#>'{summary_inclusion,source_length}',
        'truncated',example#>'{summary_inclusion,truncated}')) else '{}'::jsonb end
    || case when example ? 'research_summary' then jsonb_build_object(
      'research_summary',left(example->>'research_summary',240),
      'research_summary_truncated',char_length(example->>'research_summary')>240)
      else '{}'::jsonb end
    order by position),'[]'::jsonb)) into brief
  from jsonb_array_elements(bundle#>'{feedback,examples}') with ordinality as e(example,position);
  brief:=jsonb_set(brief,'{capabilities,allowed_helpers}',
    '["private.begin_adaptive_search_brief(uuid,uuid)","private.submit_adaptive_search_batch(uuid,uuid,jsonb)","private.verify_and_complete_adaptive_search(uuid,jsonb)"]');
  -- Never trim authoritative scope, selected example identities, shared feedback, schema or protocol to make it fit.
  -- Raising here rolls back every nested startup write before returning the
  -- bounded error, so a rejected first start leaves no running lease behind.
  log_stage:='response_bound';
  if octet_length(brief::text)>65536 then raise exception 'Adaptive brief exceeds its response bound' using errcode='54000';end if;
  raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','returned','stage',log_stage,
    'compatible',true,'response_bytes',octet_length(brief::text));
  return brief;
exception when sqlstate 'PZ005' then
  raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','returned','stage',log_stage,'compatible',false,
    'error_code',bundle#>>'{error,code}','sqlstate',SQLSTATE,'response_bytes',octet_length(bundle::text));
  return bundle;
  when program_limit_exceeded then
  -- Numeric diagnostics survive the rollback; never return the oversized data
  -- or require another database read merely to identify which section grew.
  bundle:=private.opportunity_search_adaptive_error('scope_oversized')||jsonb_build_object('brief_version',1,'response_limit_bytes',65536,
    'size_diagnostics',case when brief is null then null else jsonb_build_object('response_bytes',octet_length(brief::text),
      'context_bytes',octet_length((brief-array['planning','protocol_text','result_schema','feedback'])::text),
      'planning_bytes',octet_length((brief->'planning')::text),'protocol_bytes',octet_length((brief->'protocol_text')::text),
      'schema_bytes',octet_length((brief->'result_schema')::text),'feedback_bytes',octet_length((brief->'feedback')::text)) end);
  raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','returned','stage',log_stage,'compatible',false,
    'error_code','scope_oversized','sqlstate',SQLSTATE,'response_bytes',octet_length(bundle::text),
    'size_diagnostics',bundle->'size_diagnostics');
  return bundle;
  when query_canceled then
    raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','exception','stage',log_stage,'sqlstate',SQLSTATE);
    raise;
  when others then
    -- Never log SQLERRM, exception detail/context, or the response payload: all
    -- can contain criteria, feedback, URLs or credentials. Preserve the exception.
    raise log 'CV_HARNESS_STARTUP %',log_scope||jsonb_build_object('event','exception','stage',log_stage,'sqlstate',SQLSTATE);
    raise;
end;
$$;

CREATE OR REPLACE FUNCTION private.begin_adaptive_opportunity_search(p_search_id uuid, p_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare release public.opportunity_search_adaptive_release;runner_authorization public.opportunity_search_runner_authorizations;cached private.opportunity_search_adaptive_contexts;
  run public.opportunity_search_runs;settings public.opportunity_search_adaptive_settings;protocol record;template record;anchor record;
  packet jsonb;preferences jsonb;planning jsonb;plan jsonb;document jsonb;legacy jsonb;due jsonb;source_context jsonb;current_rules jsonb;bundle jsonb;stored jsonb;expectations jsonb;legacy_bootstrap jsonb;
  criteria jsonb:='{}';entry record;query jsonb;filtered jsonb;capabilities jsonb:=private.opportunity_search_adaptive_capabilities();ids text[];allowed_ids text[];
  privacy_changed boolean;is_retry boolean:=false;lease timestamptz:=clock_timestamp()+interval '2 hours';lease_status text:='active';core_count integer;discretionary integer;exploration integer;signature text;
  log_context text;log_location text[];log_code text;
begin
  if current_user<>'postgres' then raise exception 'Management startup access is required' using errcode='42501';end if;
  if p_search_id is null or p_run_id is null then return private.opportunity_search_adaptive_error('scope_unavailable');end if;
  select * into release from public.opportunity_search_adaptive_release where singleton for share;
  if not found or not release.enabled or release.project_ref is null then return private.opportunity_search_adaptive_error('runner_disabled');end if;
  if release.adaptive_contract_version<>1 or release.capability_version is distinct from capabilities->>'capability_version' then return private.opportunity_search_adaptive_error('incompatible_release');end if;
  -- Match the owner RPC's template -> grant lock order. This id-only lookup
  -- does not establish authorization or read the owner's search content.
  perform 1 from public.opportunity_search_templates where id=p_search_id for share;
  if not found then return private.opportunity_search_adaptive_error('authorization_revoked');end if;
  -- This prior owner-approved grant is independent of deriving an owner from a
  -- supplied template UUID. The administrative connector itself stays broad.
  select * into runner_authorization from public.opportunity_search_runner_authorizations where search_id=p_search_id and enabled and project_ref=release.project_ref for share;
  if not found then return private.opportunity_search_adaptive_error('authorization_revoked');end if;
  foreach signature in array array['private.begin_opportunity_search(uuid,uuid)','private.compile_opportunity_feedback_snapshot(uuid,uuid)',
    'private.pin_opportunity_feedback_snapshot(uuid,uuid,uuid)','private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)',
    'private.prepare_opportunity_search_execution(uuid)','private.validate_opportunity_search_result(jsonb)','private.pin_opportunity_search_plan(uuid,uuid,uuid,uuid)',
    'private.save_opportunity_search_queries(uuid,jsonb)','private.inspect_opportunity_search_result(uuid,jsonb)','private.submit_opportunity_search_result(uuid,uuid,jsonb)',
    'private.verify_opportunity_search_result(uuid,uuid)','private.read_opportunity_search_run(uuid)','private.complete_opportunity_search(uuid,jsonb)',
    'private.opportunity_canonical_input(jsonb,jsonb,text)','private.opportunity_payload_storage_valid(jsonb)','private.submit_adaptive_search_batch(uuid,uuid,jsonb)','private.verify_and_complete_adaptive_search(uuid,jsonb)'] loop
    if to_regprocedure(signature) is null then return private.opportunity_search_adaptive_error('incompatible_release');end if;
  end loop;
  select p.version,p.contract_version,p.protocol_hash,p.result_schema into protocol from private.opportunity_search_protocols p
    join private.opportunity_search_settings s on s.active_protocol_version=p.version where s.singleton for share of s;
  if not found or protocol.version<>'opportunity-search-v1-canonical-6' or protocol.contract_version<>1
    or protocol.result_schema is distinct from private.opportunity_search_result_schema() or protocol.result_schema->>'x-canonical-version'<>'6' then
    return private.opportunity_search_adaptive_error('incompatible_release');end if;
  perform pg_advisory_xact_lock(hashtextextended(runner_authorization.user_id::text||':'||p_search_id::text||':adaptive-lease',0));
  perform pg_advisory_xact_lock(hashtextextended('search-run:'||p_run_id::text,0));
  if exists(select 1 from public.opportunity_search_runs where id=p_run_id and(owner_cancel_operation_id is not null or superseded_by_run_id is not null)) then return private.opportunity_search_adaptive_error('run_aborted');end if;
  if exists(select 1 from private.opportunity_search_lifecycle_operations where restart_run_id=p_run_id and(outcome<>'aborted' or verified_at is null)) then
    return private.opportunity_search_adaptive_error('abort_verification_required');end if;
  perform private.guard_adaptive_search_lifecycle_start(p_search_id,p_run_id);
  select * into cached from private.opportunity_search_adaptive_contexts where run_id=p_run_id for update;
  is_retry:=found;
  if is_retry and(cached.user_id,cached.search_id,cached.project_ref) is distinct from(runner_authorization.user_id,p_search_id,release.project_ref) then
    return private.opportunity_search_adaptive_error('scope_unavailable');end if;
  if not is_retry and exists(select 1 from public.opportunity_search_runs where id=p_run_id) then return private.opportunity_search_adaptive_error('scope_unavailable');end if;
  if not is_retry and exists(select 1 from public.opportunity_search_runs r where r.user_id=runner_authorization.user_id and r.search_id=p_search_id and r.status='running'
    and not exists(select 1 from private.opportunity_search_adaptive_contexts c where c.run_id=r.id)) then
    return private.opportunity_search_adaptive_error('run_in_progress');end if;
  -- Expiry and changed grants preserve all receipts/checks, but cannot claim an
  -- empty success or hold the next logical run hostage indefinitely.
  update public.opportunity_search_runs r set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',
    summary=jsonb_build_object('adaptive_status','lease_expired_or_scope_changed','coverage','partial')
    from private.opportunity_search_adaptive_contexts c where r.id=c.run_id and c.user_id=runner_authorization.user_id and c.search_id=p_search_id and r.status='running'
      and(c.lease_expires_at<=clock_timestamp() or c.authorization_epoch<>runner_authorization.authorization_epoch or c.authorization_revision<>runner_authorization.authorization_revision
        or c.project_ref<>release.project_ref or(c.bundle#>>'{release,release_revision}')::bigint<>release.release_revision);
  if is_retry then
    if cached.bundle_hash is distinct from encode(sha256(convert_to(cached.bundle::text,'UTF8')),'hex') or not private.opportunity_search_adaptive_shape('bundle',cached.bundle) then
      return private.opportunity_search_adaptive_error('invalid_bundle');end if;
    if cached.authorization_epoch<>runner_authorization.authorization_epoch or cached.authorization_revision<>runner_authorization.authorization_revision then return private.opportunity_search_adaptive_error('authorization_revoked');end if;
    if(cached.bundle#>>'{release,release_revision}')::bigint<>release.release_revision then return private.opportunity_search_adaptive_error('incompatible_release');end if;
    select * into run from public.opportunity_search_runs where id=p_run_id and user_id=runner_authorization.user_id and search_id=p_search_id;
    if cached.lease_expires_at<=clock_timestamp() and run.status<>'complete' then return private.opportunity_search_adaptive_error('lease_expired');end if;
    bundle:=cached.bundle;lease:=cached.lease_expires_at;lease_status:=case run.status when 'complete' then 'complete' when 'failed' then 'failed' else 'active' end;
    packet:=private.pin_opportunity_feedback_snapshot(runner_authorization.user_id,p_search_id,p_run_id);
    packet:=jsonb_set(packet,'{preference_revision}',to_jsonb(cached.preference_revision));
    select * into settings from public.opportunity_search_adaptive_settings where user_id=runner_authorization.user_id and search_id=p_search_id;
    current_rules:=public.opportunity_search_preference_document(runner_authorization.user_id,p_search_id)->'approved_rules';
    document:=bundle#>'{query_plan,document}';
    if document is not null and private.opportunity_search_adaptive_queries(document,false,false) is null then return private.opportunity_search_adaptive_error('invalid_bundle');end if;
    select coalesce(array_agg(s->>'registry_id'),'{}') into ids from jsonb_array_elements(bundle->'source_context') s;
    source_context:=private.opportunity_search_adaptive_source_context(runner_authorization.user_id,p_search_id,ids,current_rules);
    select coalesce(array_agg(s->>'registry_id'),'{}') into allowed_ids from jsonb_array_elements(source_context) s;
    if document is not null and exists(select 1 from jsonb_array_elements(document->'queries') q where q->>'role'='core' and q?'source_registry_id'
      and not(q->>'source_registry_id'=any(allowed_ids)) and not exists(select 1 from jsonb_array_elements(bundle#>'{planning,blocked_core_queries}') b where b->>'query_id'=q->>'query_id')) then
      update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',summary='{"adaptive_status":"source_scope_changed","coverage":"partial"}' where id=p_run_id and status='running';
      return private.opportunity_search_adaptive_error('authorization_revoked');end if;
    due:=private.opportunity_search_adaptive_sources(runner_authorization.user_id,p_search_id,bundle->'due_sources',current_rules);
    privacy_changed:=cached.privacy_redacted or coalesce((packet->>'privacy_scope_changed')::boolean,false)
      or not coalesce(settings.adaptation_enabled and not settings.adaptation_paused,false)
        and(jsonb_array_length(bundle#>'{planning,priorities}')>0
          or exists(select 1 from jsonb_array_elements(coalesce(document->'queries','[]')) q where q->>'role'<>'core'))
      or due is distinct from bundle->'due_sources' or source_context is distinct from bundle->'source_context';
    if privacy_changed then
      if document is not null then
        document:=private.opportunity_search_adaptive_queries(document,true,false);
        if document is null then return private.opportunity_search_adaptive_error('invalid_bundle');end if;
        bundle:=jsonb_set(bundle,'{query_plan,document}',document);
      end if;
      bundle:=jsonb_set(bundle,'{planning,priorities}','[]');bundle:=jsonb_set(bundle,'{planning,enabled}','false');
      bundle:=jsonb_set(bundle,'{planning,allocation,adaptive}','0');bundle:=jsonb_set(bundle,'{planning,allocation,exploration}','0');
      bundle:=jsonb_set(bundle,'{refresh,privacy_scope_changed}','true');bundle:=jsonb_set(bundle,'{refresh,adaptive_slice}','true');
    end if;
    bundle:=jsonb_set(bundle,'{planning,paused}',to_jsonb(coalesce(settings.adaptation_paused,false)));
    bundle:=jsonb_set(bundle,'{due_sources}',due);bundle:=jsonb_set(bundle,'{source_context}',source_context);
  else
    if exists(select 1 from private.opportunity_search_adaptive_contexts c join public.opportunity_search_runs r on r.id=c.run_id
      where c.user_id=runner_authorization.user_id and c.search_id=p_search_id and r.status='running' and c.lease_expires_at>clock_timestamp()) then return private.opportunity_search_adaptive_error('run_in_progress');end if;
    bundle:=jsonb_build_object('source_retention',private.seed_opportunity_institution_sources(runner_authorization.user_id,p_search_id));
    select t.revision,t.criteria into template from public.opportunity_search_templates t where t.user_id=runner_authorization.user_id and t.id=p_search_id for share;
    if not found or jsonb_typeof(template.criteria) is distinct from 'object' then return private.opportunity_search_adaptive_error('scope_unavailable');end if;
    for entry in select key,value from jsonb_each(template.criteria) loop
      if entry.key not in('opportunityTypes','topicsAndMethods','locationsAndLanguages','fundingAndConditions','fitAndExclusions','sourcesAndQueries','researchAndReporting')
        or jsonb_typeof(entry.value) is distinct from 'string' or not private.opportunity_search_adaptive_text(entry.value#>>'{}',12000) then return private.opportunity_search_adaptive_error('setup_conversion_required');end if;
      criteria:=criteria||jsonb_build_object(entry.key,entry.value);
    end loop;
    packet:=private.compile_opportunity_feedback_snapshot(runner_authorization.user_id,p_search_id);
    preferences:=public.opportunity_search_preference_document(runner_authorization.user_id,p_search_id);current_rules:=preferences->'approved_rules';
    planning:=private.opportunity_search_planning_context(runner_authorization.user_id,p_search_id,packet,null);
    select * into settings from public.opportunity_search_adaptive_settings where user_id=runner_authorization.user_id and search_id=p_search_id;
    plan:=private.read_opportunity_search_plan(runner_authorization.user_id,p_search_id,null);
    if plan is not null then
      document:=private.opportunity_search_adaptive_queries(plan->'document',(planning->>'refresh_required')::boolean or not(planning->>'enabled')::boolean,
        (plan#>>'{basis,base_revision}')::integer<>template.revision);
      if document is null then return private.opportunity_search_adaptive_error('setup_conversion_required');end if;
      plan:=jsonb_build_object('id',plan->'id','revision',plan->'plan_revision','plan_hash',plan->'plan_hash','planning_policy',plan->'planning_policy','document',document,'basis',plan->'basis');
    end if;
    select id,queries into anchor from public.opportunity_search_query_revisions where user_id=runner_authorization.user_id and search_id=p_search_id and template_revision=template.revision and protocol_version=protocol.version;
    if found and plan is null then
      legacy:=private.opportunity_search_adaptive_legacy_queries(anchor.queries);
      if legacy is null then return private.opportunity_search_adaptive_error('setup_conversion_required');end if;
      legacy:=jsonb_build_object('query_revision_id',anchor.id,'queries',legacy);
      core_count:=jsonb_array_length(legacy->'queries');discretionary:=greatest(0,(planning#>>'{policy,maximum_queries}')::integer-core_count);
      exploration:=case when(planning->>'enabled')::boolean and discretionary>0 then least(discretionary,greatest((planning#>>'{policy,minimum_exploration_queries}')::integer,ceil(discretionary*(planning#>>'{policy,exploration_ratio}')::numeric)::integer)) else 0 end;
      planning:=jsonb_set(planning,'{allocation,core_queries}',to_jsonb(core_count));planning:=jsonb_set(planning,'{allocation,discretionary}',to_jsonb(discretionary));
      planning:=jsonb_set(planning,'{allocation,exploration}',to_jsonb(exploration));planning:=jsonb_set(planning,'{allocation,adaptive}',to_jsonb(case when(planning->>'enabled')::boolean then discretionary-exploration else 0 end));
      planning:=jsonb_set(planning,'{allocation,capacity_limited}',to_jsonb(discretionary=0));
    end if;
    if plan is not null then
      select count(*) into core_count from jsonb_array_elements(document->'queries') q where q->>'role'='core';
      discretionary:=greatest(0,(planning#>>'{policy,maximum_queries}')::integer-core_count);
      exploration:=case when(planning->>'enabled')::boolean and discretionary>0 then least(discretionary,greatest((planning#>>'{policy,minimum_exploration_queries}')::integer,ceil(discretionary*(planning#>>'{policy,exploration_ratio}')::numeric)::integer)) else 0 end;
      planning:=jsonb_set(planning,'{allocation,core_queries}',to_jsonb(core_count));planning:=jsonb_set(planning,'{allocation,discretionary}',to_jsonb(discretionary));
      planning:=jsonb_set(planning,'{allocation,exploration}',to_jsonb(exploration));planning:=jsonb_set(planning,'{allocation,adaptive}',to_jsonb(case when(planning->>'enabled')::boolean then discretionary-exploration else 0 end));
      planning:=jsonb_set(planning,'{allocation,capacity_limited}',to_jsonb(discretionary=0));
      if jsonb_array_length(document->'queries')=0 then plan:=null;document:=null;end if;
    end if;
    due:=private.opportunity_search_adaptive_sources(runner_authorization.user_id,p_search_id,private.due_opportunity_search_sources(runner_authorization.user_id,p_search_id,clock_timestamp()),current_rules);
    select coalesce(array_agg(distinct id),'{}') into ids from(select s->>'registry_id' id from jsonb_array_elements(due) s
      union select q->>'source_registry_id' from jsonb_array_elements(coalesce(document->'queries','[]')) q where q?'source_registry_id'
        and not exists(select 1 from jsonb_array_elements(planning->'blocked_core_queries') b where b->>'query_id'=q->>'query_id')) sources;
    source_context:=private.opportunity_search_adaptive_source_context(runner_authorization.user_id,p_search_id,ids,current_rules);
    select coalesce(array_agg(s->>'registry_id'),'{}') into allowed_ids from jsonb_array_elements(source_context) s;
    if document is not null then
      if exists(select 1 from jsonb_array_elements(document->'queries') q where q->>'role'='core' and q?'source_registry_id' and not(q->>'source_registry_id'=any(allowed_ids))
        and not exists(select 1 from jsonb_array_elements(planning->'blocked_core_queries') b where b->>'query_id'=q->>'query_id')) then return private.opportunity_search_adaptive_error('scope_unavailable');end if;
      select coalesce(jsonb_agg(q),'[]') into filtered from jsonb_array_elements(document->'queries') q where q->>'role'='core' or not(q?'source_registry_id') or q->>'source_registry_id'=any(allowed_ids);
      document:=jsonb_set(document,'{queries}',filtered);plan:=jsonb_set(plan,'{document}',document);
    end if;
    if jsonb_array_length(due)>64 or jsonb_array_length(source_context)>64 then return private.opportunity_search_adaptive_error('scope_oversized');end if;
    bundle:=jsonb_build_object('adaptive_contract_version',1,'bootstrap_version',1,'compatible',true,
      'scope',jsonb_build_object('project_ref',release.project_ref,'user_id',runner_authorization.user_id,'search_id',p_search_id,'run_id',p_run_id,'authorization_revision',runner_authorization.authorization_revision,'authorization_epoch',runner_authorization.authorization_epoch),
      'release',jsonb_build_object('schema_version',6,'protocol_version',protocol.version,'protocol_hash',protocol.protocol_hash,'release_revision',release.release_revision),
      'protocol_text',private.opportunity_search_adaptive_protocol_text(),'result_schema',protocol.result_schema,'base',jsonb_build_object('revision',template.revision,'criteria',criteria),
      'source_retention',bundle->'source_retention','feedback',packet,'preferences',jsonb_build_object('revision',preferences->'preference_revision','approved_rules',preferences->'approved_rules','approved_preferences',preferences->'approved_preferences'),
      'query_plan',plan,'legacy_core_queries',legacy,'due_sources',due,'source_context',source_context,'planning',planning,
      'refresh',jsonb_build_object('cold_start',plan is null and legacy is null,'adaptive_slice',planning->'refresh_required','privacy_scope_changed',false),
      'lease',jsonb_build_object('expires_at',lease,'status','active'),'capabilities',capabilities,'execution_contract',private.opportunity_search_adaptive_execution_contract());
    if octet_length(packet::text)>65536 or octet_length(bundle::text)>262144 then return private.opportunity_search_adaptive_error('scope_oversized');end if;
    -- Compose the actual existing run machinery, discarding its broad legacy
    -- bootstrap return; only this reviewed fixed bundle may cross the boundary.
    legacy_bootstrap:=private.begin_opportunity_search(p_search_id,p_run_id);
    if legacy_bootstrap->'compatible' is distinct from 'true'::jsonb or legacy_bootstrap->'bootstrap_version' is distinct from '1'::jsonb then
      raise exception 'Adaptive startup requires compatible legacy machinery' using errcode='0A000';end if;
    packet:=private.pin_opportunity_feedback_snapshot(runner_authorization.user_id,p_search_id,p_run_id);
    update public.opportunity_search_runs set adaptive_contract_version=1,preference_snapshot_revision=(preferences->>'preference_revision')::bigint,
      adaptive_authorization_revision=runner_authorization.authorization_revision,adaptive_project_ref=release.project_ref,adaptive_lease_expires_at=lease where id=p_run_id;
    if plan is not null and not(planning->>'refresh_required')::boolean then perform private.pin_opportunity_search_plan(runner_authorization.user_id,p_search_id,p_run_id,(plan->>'id')::uuid);end if;
    expectations:=private.prepare_opportunity_search_execution(p_run_id);
    expectations:=jsonb_set(expectations,'{sources}',due);
    if expectations->'pending_queries'='false'::jsonb then
      select coalesce(jsonb_agg(q),'[]') into filtered from jsonb_array_elements(expectations->'queries') q where not exists(select 1 from jsonb_array_elements(planning->'blocked_core_queries') b where b->>'query_id'=q->>'query_id');
      expectations:=jsonb_set(expectations,'{queries}',filtered);
    end if;
    expectations:=expectations||jsonb_build_object('authorized_query_skips',planning->'blocked_core_queries');
    update public.opportunity_search_runs set execution_expectations=expectations where id=p_run_id;
    privacy_changed:=false;
  end if;
  -- Never cache summary plaintext twice. AF-03 remains its sole approval-bound
  -- source; each retry resolves the pinned packet internally before returning.
  bundle:=jsonb_set(bundle,'{feedback}',packet);bundle:=jsonb_set(bundle,'{lease}',jsonb_build_object('expires_at',lease,'status',lease_status));
  bundle:=jsonb_set(bundle,'{scope}',jsonb_build_object('project_ref',release.project_ref,'user_id',runner_authorization.user_id,'search_id',p_search_id,'run_id',p_run_id,
    'authorization_revision',runner_authorization.authorization_revision,'authorization_epoch',runner_authorization.authorization_epoch));
  bundle:=jsonb_set(bundle,'{protocol_text}',to_jsonb(private.opportunity_search_adaptive_protocol_text()));
  bundle:=jsonb_set(bundle,'{result_schema}',protocol.result_schema);bundle:=jsonb_set(bundle,'{capabilities}',capabilities);
  bundle:=jsonb_set(bundle,'{execution_contract}',private.opportunity_search_adaptive_execution_contract());
  bundle:=jsonb_set(bundle,'{planning,allocation,source_obligations}',to_jsonb(jsonb_array_length(due)));
  bundle:=jsonb_set(bundle,'{planning,allocation,mandatory_source_checks}',to_jsonb((select count(*) from jsonb_array_elements(due) s where s->'pinned'='true'::jsonb or s->'mandatory'='true'::jsonb)));
  if octet_length(packet::text)>65536 or octet_length(bundle::text)>262144 then raise exception 'Adaptive scope exceeds its bounded envelope' using errcode='54000';end if;
  if not private.opportunity_search_adaptive_shape('bundle',bundle) then raise exception 'Adaptive bundle failed its closed projection' using errcode='22023';end if;
  select jsonb_set(bundle,'{feedback,examples}',coalesce(jsonb_agg(e-array['search_feedback_summary','summary_inclusion']),'[]')) into stored from jsonb_array_elements(packet->'examples') e;
  if is_retry then update private.opportunity_search_adaptive_contexts set bundle=stored,bundle_hash=encode(sha256(convert_to(stored::text,'UTF8')),'hex'),privacy_redacted=privacy_changed where run_id=p_run_id;
  else insert into private.opportunity_search_adaptive_contexts(run_id,user_id,search_id,project_ref,authorization_epoch,authorization_revision,preference_revision,lease_expires_at,bundle,bundle_hash)
    values(p_run_id,runner_authorization.user_id,p_search_id,release.project_ref,runner_authorization.authorization_epoch,runner_authorization.authorization_revision,(preferences->>'preference_revision')::bigint,lease,stored,encode(sha256(convert_to(stored::text,'UTF8')),'hex'));end if;
  return bundle;
exception when deadlock_detected then raise;
  when others then
    -- Preserve the existing error mapping while retaining the SQLSTATE which
    -- would otherwise disappear behind invalid_bundle. Never emit exception prose.
    -- The original class conditions also catch subclasses (for example 54001
    -- and 55P03); retain that behavior as well as the exact code in the log.
    log_code:=case when left(SQLSTATE,2)='54' then 'scope_oversized' when left(SQLSTATE,2)='0A' then 'incompatible_release'
      when left(SQLSTATE,2)='55' then 'restart_unavailable' when SQLSTATE='42501' then 'authorization_revoked' else 'invalid_bundle' end;
    get stacked diagnostics log_context=PG_EXCEPTION_CONTEXT;
    log_location:=regexp_match(log_context,E'^PL/pgSQL function ((?:private|public)\\.[a-z_]{1,100})\\([^\\n]*\\) line ([0-9]{1,6})');
    raise log 'CV_HARNESS_STARTUP %',jsonb_build_object('diagnostic_version',1,'event','caught_exception','stage','bootstrap',
      'search_id',p_search_id,'run_id',p_run_id,'error_code',log_code,'sqlstate',SQLSTATE,
      'function',log_location[1],'line',log_location[2]::integer);
    return private.opportunity_search_adaptive_error(log_code);
end;
$$;

commit;
