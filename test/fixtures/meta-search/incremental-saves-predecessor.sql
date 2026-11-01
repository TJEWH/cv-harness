-- Historical upgrade fixture only; never install into production.
-- Exact predecessor: c0563fe6ae4664bc3f85ddecce602430368efe21
-- The recurring prompt comes from the retained response-handling-v1 installer.

CREATE OR REPLACE FUNCTION private.adaptive_batch_error(p_code text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('adaptive_contract_version',1,'batch_schema_version',1,'accepted',false,'error',jsonb_build_object('code',case when p_code in(
    'authorization_revoked','scope_unavailable','inactive_run','invalid_batch','scope_oversized','idempotency_conflict','run_batch_limit') then p_code else 'invalid_batch' end,'retryable',false))
$$;

CREATE OR REPLACE FUNCTION private.submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare scope jsonb;prior private.opportunity_search_adaptive_batches;run public.opportunity_search_runs;context private.opportunity_search_adaptive_contexts;
  plan jsonb;startup jsonb;expected jsonb;validation_expected jsonb;execution jsonb;execution_result jsonb;work jsonb:='[]';entry jsonb;item jsonb;opportunity jsonb;effective jsonb;attribution jsonb;
  correction jsonb;corrections jsonb;identity jsonb;receipt jsonb;discovery jsonb;roots jsonb;proposals jsonb;receipt_suggestions jsonb:='[]';incoming_proposal jsonb;existing_proposal public.opportunity_search_adaptive_proposals;
  payload_hash text;item_hash text;item_id_value uuid;ids uuid[]:='{}';deferred text[];code text;root text;field text;missing_expected boolean;correction_deferred boolean;
  primary_id uuid;primary_check jsonb;reported_shrunk boolean:=false;retention_deferred_value boolean;ordinal_value integer;manifest jsonb;batch_receipt_result jsonb;source_url text;source_registry uuid;
begin
  scope:=private.require_adaptive_search_scope(p_run_id,false);
  if p_batch_id is null or p_payload is null then return private.adaptive_batch_error('invalid_batch');end if;
  payload_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into prior from private.opportunity_search_adaptive_batches where run_id=p_run_id and batch_id=p_batch_id;
  if found then
    if prior.payload_hash<>payload_hash then return private.adaptive_batch_error('idempotency_conflict');end if;
    return private.adaptive_batch_receipt(p_run_id,p_batch_id);
  end if;
  if octet_length(p_payload::text)>524288 then raise exception 'Batch exceeds envelope' using errcode='54000';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['schema_version','query_plan','plan_hash','opportunities','execution','preference_suggestions','source_suggestions','query_suggestions']<>'{}'::jsonb
    or p_payload->'schema_version' is distinct from '1'::jsonb or not(p_payload?&array['opportunities','execution'])
    or jsonb_typeof(p_payload->'opportunities') is distinct from 'array' or jsonb_array_length(p_payload->'opportunities')>10
    or p_payload?'plan_hash' and(jsonb_typeof(p_payload->'plan_hash') is distinct from 'string' or p_payload->>'plan_hash'!~'^[0-9a-f]{64}$') then raise exception 'Use the closed batch contract' using errcode='22023';end if;
  select count(*)+1 into ordinal_value from private.opportunity_search_adaptive_batches where run_id=p_run_id;
  if ordinal_value>32 then return private.adaptive_batch_error('run_batch_limit');end if;
  if ordinal_value>1 and not(p_payload?'plan_hash') then raise exception 'Later batches copy their actual plan hash' using errcode='22023';end if;
  perform private.prevalidate_adaptive_opportunities(p_payload->'opportunities');
  proposals:=private.validate_adaptive_proposals(scope,p_payload);
  perform private.require_adaptive_search_scope(p_run_id,true);
  select * into run from public.opportunity_search_runs where id=p_run_id;
  startup:=private.begin_adaptive_opportunity_search(run.search_id,p_run_id);
  if startup->'compatible' is distinct from 'true'::jsonb then
    if startup#>>'{error,code}'='authorization_revoked' then raise exception 'Protected scope changed' using errcode='PZ002';end if;
    raise exception 'Adaptive startup is unavailable' using errcode='22023';end if;
  plan:=private.pin_adaptive_batch_plan(p_run_id,case when p_payload?'query_plan' then p_payload->'query_plan' else null end,p_payload->>'plan_hash');
  expected:=private.refresh_adaptive_execution_scope(p_run_id);
  if coalesce((expected->>'protected_scope_revoked')::boolean,false) then raise exception 'Protected scope changed' using errcode='PZ002';end if;
  execution:=private.normalize_adaptive_execution(p_run_id,p_payload->'execution');
  validation_expected:=expected;
  for entry in select value from jsonb_array_elements(execution->'checks') loop
    if entry->>'kind'='query' and not exists(select 1 from jsonb_array_elements(expected->'queries') q where q->>'query_id'=entry->>'query_id') then
      validation_expected:=jsonb_set(validation_expected,'{queries}',(validation_expected->'queries')||jsonb_build_array(jsonb_build_object('query_id',entry->'query_id','text_hash',entry->'text_hash')));reported_shrunk:=true;
    elsif entry->>'kind'='source' and(exists(select 1 from jsonb_array_elements(coalesce(expected->'authorized_source_skips','[]')) s where s->>'source_registry_id'=entry->>'source_registry_id')
      or exists(select 1 from jsonb_array_elements(plan#>'{document,queries}') q where q->>'source_registry_id'=entry->>'source_registry_id'
        and exists(select 1 from jsonb_array_elements(expected->'authorized_query_skips') s where s->>'query_id'=q->>'query_id'))
      or not exists(select 1 from public.opportunity_search_sources s where s.registry_id=(entry->>'source_registry_id')::uuid and s.user_id=run.user_id and s.search_id=run.search_id)) then
      validation_expected:=jsonb_set(validation_expected,'{sources}',(validation_expected->'sources')||jsonb_build_array(jsonb_build_object('registry_id',entry->'source_registry_id')));reported_shrunk:=true;
    end if;
  end loop;
  update public.opportunity_search_runs set execution_expectations=validation_expected where id=p_run_id;
  -- Reuse the exact AF-05 validator in a rolled-back subtransaction. No actual
  -- check, source metadata or catalogue write survives this validation probe.
  begin
    perform private.record_opportunity_search_execution(p_run_id,p_batch_id,execution);
    raise exception 'Validation probe complete' using errcode='PZ001';
  exception when sqlstate 'PZ001' then null;end;
  -- Prevalidate every proposed canonical record/attribution before the first
  -- catalogue write. Deferred correction inputs are never passed to v5.
  for entry in select value from jsonb_array_elements(p_payload->'opportunities') loop
    if jsonb_typeof(entry) is distinct from 'object' or entry-array['item_id','opportunity','attribution','reusable_source']<>'{}'::jsonb
      or not(entry?&array['item_id','opportunity']) or jsonb_typeof(entry->'item_id') is distinct from 'string'
      or entry->>'item_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid batch item envelope' using errcode='22023';end if;
    item_id_value:=(entry->>'item_id')::uuid;
    if item_id_value=any(ids) then raise exception 'Duplicate batch item' using errcode='22023';end if;
    if exists(select 1 from private.opportunity_search_adaptive_items where run_id=p_run_id and item_id=item_id_value)
      or exists(select 1 from public.opportunity_search_receipts where run_id=p_run_id and item_id=item_id_value) then raise exception 'An item belongs to its original batch' using errcode='40001';end if;
    ids:=array_append(ids,item_id_value);opportunity:=entry->'opportunity';deferred:='{}';correction_deferred:=false;missing_expected:=false;
    if octet_length(opportunity::text)>262144 then raise exception 'Opportunity exceeds envelope' using errcode='54000';end if;
    if opportunity?'merge_control' then
      if jsonb_typeof(opportunity->'merge_control') is distinct from 'object' or(opportunity->'merge_control')-array['corrections']<>'{}'::jsonb
        or jsonb_typeof(opportunity#>'{merge_control,corrections}') is distinct from 'array' then raise exception 'Invalid correction control' using errcode='22023';end if;
      for correction in select value from jsonb_array_elements(opportunity#>'{merge_control,corrections}') loop
        if jsonb_typeof(correction) is distinct from 'object' or correction-array['path','expected','reason']<>'{}'::jsonb
          or jsonb_typeof(correction->'path') is distinct from 'string' or jsonb_typeof(correction->'reason') is distinct from 'string' then raise exception 'Invalid correction shape' using errcode='22023';end if;
        root:=split_part(correction->>'path','/',2);
        if not(correction?'expected') then missing_expected:=true;end if;
        if root not in('contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation') and(not(correction?'expected')
          or not private.adaptive_expected_safe(correction->'expected') or not private.opportunity_search_adaptive_text(correction->>'path',4000)) then correction_deferred:=true;end if;
      end loop;
    end if;
    effective:=opportunity-array['contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation'];
    foreach field in array array['contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation'] loop if opportunity?field then deferred:=array_append(deferred,field);end if;end loop;
    if opportunity?'merge_control' then
      corrections:='[]';
      for correction in select value from jsonb_array_elements(opportunity#>'{merge_control,corrections}') loop
        root:=split_part(correction->>'path','/',2);
        if root in('contacts','supervisors','supervisor_research_focus','supervisor_top_papers','supervisor_reputation') then
          if not(root=any(deferred)) then deferred:=array_append(deferred,root);end if;
        else corrections:=corrections||jsonb_build_array(correction);end if;
      end loop;
      effective:=effective-'merge_control';if jsonb_array_length(corrections)>0 and not correction_deferred then effective:=effective||jsonb_build_object('merge_control',jsonb_build_object('corrections',corrections));end if;
    end if;
    attribution:=coalesce(entry->'attribution','{}'::jsonb);perform private.validate_adaptive_attribution(p_run_id,attribution,execution);
    primary_id:=coalesce((attribution->>'primary_check_id')::uuid,(attribution#>>'{execution_refs,0}')::uuid);primary_check:=null;
    if primary_id is not null then
      select c into primary_check from jsonb_array_elements(execution->'checks') c where c->>'check_id'=primary_id::text;
      if primary_check is null then select jsonb_build_object('kind',e.kind,'query_id',e.query_id,'source_registry_id',e.source_registry_id) into primary_check from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=primary_id;end if;
    end if;
    code:=case when correction_deferred then 'correction_deferred' when primary_check->>'kind'='query' and exists(select 1 from jsonb_array_elements(expected->'authorized_query_skips') s where s->>'query_id'=primary_check->>'query_id')
      or primary_check->>'kind'='source' and exists(select 1 from jsonb_array_elements(coalesce(expected->'authorized_source_skips','[]')) s where s->>'source_registry_id'=primary_check->>'source_registry_id') then 'scope_changed' else null end;
    source_url:=null;source_registry:=null;retention_deferred_value:=false;
    if entry?'reusable_source' then
      if jsonb_typeof(entry->'reusable_source') is distinct from 'object' or(entry->'reusable_source')-array['listing_url','registry_id']<>'{}'::jsonb
        or jsonb_typeof(entry#>'{reusable_source,listing_url}') is distinct from 'string' or private.opportunity_feedback_safe_url(entry#>>'{reusable_source,listing_url}') is null then raise exception 'Invalid reusable source witness' using errcode='22023';end if;
      source_url:=private.opportunity_feedback_safe_url(entry#>>'{reusable_source,listing_url}');
      if(entry->'reusable_source')?'registry_id' then
        source_registry:=(entry#>>'{reusable_source,registry_id}')::uuid;
        if not exists(select 1 from public.opportunity_search_sources s where s.registry_id=source_registry and s.user_id=run.user_id and s.search_id=run.search_id) then raise exception 'Source scope denied' using errcode='42501';end if;
        if exists(select 1 from public.opportunity_search_sources s where s.registry_id=source_registry and s.listing_url is not null and s.listing_url<>source_url) then
          source_url:=null;source_registry:=null;retention_deferred_value:=true;
        end if;
      end if;
    end if;
    work:=work||jsonb_build_array(jsonb_build_object('item_id',item_id_value,'payload_hash',encode(sha256(convert_to(entry::text,'UTF8')),'hex'),'opportunity',effective,'attribution',attribution,
      'deferred_fields',to_jsonb(deferred),'conflict_code',code,'reusable_listing_url',source_url,'reusable_registry_id',source_registry,'retention_deferred',retention_deferred_value));
  end loop;
  execution_result:=private.record_opportunity_search_execution(p_run_id,p_batch_id,execution);
  if reported_shrunk then expected:=expected||'{"scope_report_incomplete":true}';end if;
  update public.opportunity_search_runs set execution_expectations=expected,execution_report_status=case when reported_shrunk then 'partial' else execution_report_status end where id=p_run_id;
  insert into private.opportunity_search_adaptive_batches(run_id,batch_id,user_id,search_id,ordinal,payload_hash,plan_id,plan_hash,item_ids,query_versions,execution_status,recorded_checks,retained_backlog,omitted_backlog,execution_incomplete)
    values(p_run_id,p_batch_id,run.user_id,run.search_id,ordinal_value,payload_hash,(plan->>'id')::uuid,plan->>'plan_hash',ids,
      (select coalesce(jsonb_agg(jsonb_build_object('query_id',q->'query_id','text_hash',q->'text_hash') order by q->>'query_id'),'[]') from jsonb_array_elements(plan#>'{document,queries}') q),
      case when reported_shrunk then 'partial' else execution_result->>'status' end,(execution_result->>'recorded_checks')::integer,(execution_result->>'retained_backlog')::integer,(execution_result->>'omitted_backlog')::integer,
      reported_shrunk or(execution_result->>'incomplete')::boolean);
  for item in select value from jsonb_array_elements(work) loop
    item_id_value:=(item->>'item_id')::uuid;code:=item->>'conflict_code';receipt:=null;discovery:=null;roots:='{}';
    if code is null then
      begin
        identity:='{}';
        foreach field in array array['opportunity_key','institution','vacancy_id','official_url','source_url','application_url'] loop
          if jsonb_typeof(item#>array['opportunity',field])='string' and btrim(item#>>array['opportunity',field])<>'' then identity:=identity||jsonb_build_object(field,item#>array['opportunity',field]);end if;
        end loop;
        if item#>'{opportunity,data,url_roles}' is not null then identity:=identity||jsonb_build_object('data',jsonb_build_object('url_roles',item#>'{opportunity,data,url_roles}'));end if;
        perform private.inspect_opportunity_search_result(p_run_id,identity);
        receipt:=private.submit_opportunity_search_result(p_run_id,item_id_value,item->'opportunity');
        discovery:=private.record_opportunity_search_discovery(p_run_id,item_id_value,item->'attribution');
        roots:=private.adaptive_accepted_roots(p_run_id,item_id_value);
      exception when unique_violation or serialization_failure then code:='identity_conflict';receipt:=null;discovery:=null;
        when check_violation then code:='insufficient_evidence';receipt:=null;discovery:=null;
      end;
    end if;
    insert into private.opportunity_search_adaptive_items(run_id,item_id,batch_id,payload_hash,opportunity_id,outcome,canonical_outcome,conflict_code,accepted_roots,deferred_fields,discovery_id,reusable_listing_url,reusable_registry_id,retention_deferred)
      values(p_run_id,item_id_value,p_batch_id,item->>'payload_hash',(receipt->>'opportunity_id')::uuid,case when code is null then 'saved' else 'unresolved' end,receipt->>'outcome',code,roots,
        array(select jsonb_array_elements_text(item->'deferred_fields')),(discovery->>'discovery_id')::uuid,item->>'reusable_listing_url',(item->>'reusable_registry_id')::uuid,(item->>'retention_deferred')::boolean);
  end loop;
  for incoming_proposal in select value from jsonb_array_elements(proposals) loop
    select * into existing_proposal from public.opportunity_search_adaptive_proposals p where p.user_id=run.user_id and p.search_id=run.search_id and p.suggestion_id=(incoming_proposal->>'suggestion_id')::uuid;
    if not found then
      insert into public.opportunity_search_adaptive_proposals(user_id,search_id,suggestion_id,run_id,batch_id,kind,proposal,evidence_refs,status,reason)
        values(run.user_id,run.search_id,(incoming_proposal->>'suggestion_id')::uuid,p_run_id,p_batch_id,incoming_proposal->>'kind',incoming_proposal->'proposal',
          array(select (r#>>'{}')::uuid from jsonb_array_elements(incoming_proposal->'evidence_refs') r),incoming_proposal->>'status',incoming_proposal->>'reason') returning * into existing_proposal;
      if incoming_proposal->>'kind'='preference' and incoming_proposal->>'status'='pending' then perform private.propose_opportunity_search_preference(run.user_id,run.search_id,(incoming_proposal->>'suggestion_id')::uuid,incoming_proposal->'proposal');end if;
    end if;
    receipt_suggestions:=receipt_suggestions||jsonb_build_array(jsonb_build_object('suggestion_id',existing_proposal.suggestion_id,'kind',existing_proposal.kind,'status',existing_proposal.status,'reason',existing_proposal.reason));
  end loop;
  manifest:=private.opportunity_search_adaptive_manifest(p_run_id);
  update private.opportunity_search_adaptive_batches set manifest_hash=manifest->>'manifest_hash',suggestions=receipt_suggestions where run_id=p_run_id and batch_id=p_batch_id;
  batch_receipt_result:=private.adaptive_batch_receipt(p_run_id,p_batch_id);
  update private.opportunity_search_adaptive_batches set result=batch_receipt_result where run_id=p_run_id and batch_id=p_batch_id;
  return batch_receipt_result;
exception when insufficient_privilege then return private.adaptive_batch_error('authorization_revoked');
  when sqlstate 'PZ002' then
    begin
      perform private.require_adaptive_search_scope(p_run_id,false);
      update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',summary='{"adaptive_status":"source_scope_changed","coverage":"partial"}' where id=p_run_id and status='running';
      return private.adaptive_batch_error('scope_unavailable');
    exception when insufficient_privilege then return private.adaptive_batch_error('authorization_revoked');end;
  when object_not_in_prerequisite_state then return private.adaptive_batch_error('inactive_run');
  when program_limit_exceeded then return private.adaptive_batch_error('scope_oversized');
  when serialization_failure then return private.adaptive_batch_error('idempotency_conflict');
  when deadlock_detected then raise;
  when others then return private.adaptive_batch_error('invalid_batch');
end;
$_$;
