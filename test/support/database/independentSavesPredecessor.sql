-- Synthetic upgrade test only: reviewed pre-isolation discovery function.
CREATE FUNCTION private.record_opportunity_search_discovery(p_run_id uuid, p_item_id uuid, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare run public.opportunity_search_runs;receipt record;audit record;facts record;support record;
  existing public.opportunity_search_discoveries;saved public.opportunity_search_discoveries;plan public.opportunity_search_query_plans;
  fingerprint text;refs uuid[]:='{}';referenced_check uuid;primary_check uuid;discovered timestamptz;encountered timestamptz;event jsonb;
  primary_value boolean;assessment jsonb;evidence jsonb;institution_value text;topic_values text[];deadline jsonb;verified_deadline boolean;generated boolean;
begin
  if p_item_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768
    or p_payload-array['execution_refs','primary_check_id','discovered_at','encountered_at','recommendation_generated','updated_only']<>'{}'::jsonb then
    raise exception 'Use the bounded discovery attribution contract' using errcode='22023';end if;
  fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into existing from public.opportunity_search_discoveries where run_id=p_run_id and item_id=p_item_id;
  if found then
    if existing.payload_hash<>fingerprint then raise exception 'Discovery identity already has different attribution' using errcode='40001';end if;
    return jsonb_build_object('discovery_id',existing.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',existing.opportunity_id,'recorded',true,'verification_required',true,
      'recommendation_eligible',existing.recommendation_eligible,'recommendation_policy_violation',existing.recommendation_policy_violation,'delivery_status','unknown');
  end if;
  select * into run from public.opportunity_search_runs where id=p_run_id for update;
  if not found or run.status<>'running' then raise exception 'An active search run is required' using errcode='22023';end if;
  select * into existing from public.opportunity_search_discoveries where run_id=p_run_id and item_id=p_item_id;
  if found then
    if existing.payload_hash<>fingerprint then raise exception 'Discovery identity already has different attribution' using errcode='40001';end if;
    return jsonb_build_object('discovery_id',existing.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',existing.opportunity_id,'recorded',true,'verification_required',true,
      'recommendation_eligible',existing.recommendation_eligible,'recommendation_policy_violation',existing.recommendation_policy_violation,'delivery_status','unknown');
  end if;
  select r.run_id,r.item_id,r.user_id,r.opportunity_id,nullif(r.payload->'personal_fit','null'::jsonb) original_assessment,r.result->>'outcome' outcome
    into receipt from public.opportunity_search_receipts r where r.run_id=p_run_id and r.item_id=p_item_id and r.user_id=run.user_id;
  select a.run_id,a.item_id,a.opportunity_id,a.recorded_at,a.rolled_back_at into audit from private.opportunity_search_merge_audit a where a.run_id=p_run_id and a.item_id=p_item_id;
  if receipt.run_id is null or audit.run_id is null or audit.opportunity_id is distinct from receipt.opportunity_id or audit.rolled_back_at is not null then
    raise exception 'The exact persisted canonical receipt is required' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(run.user_id::text||':'||receipt.opportunity_id::text||':discovery',0));
  if p_payload?'execution_refs' then
    if jsonb_typeof(p_payload->'execution_refs') is distinct from 'array' or jsonb_array_length(p_payload->'execution_refs')>16 then
      raise exception 'Use at most 16 actual execution references' using errcode='22023';end if;
    for event in select e.value from jsonb_array_elements(p_payload->'execution_refs') e loop
      if jsonb_typeof(event) is distinct from 'string' or event#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid execution reference' using errcode='22023';end if;
      referenced_check:=(event#>>'{}')::uuid;
      if not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=referenced_check
        and e.user_id=run.user_id and e.status in('complete','partial','paginated','dynamic') and (e.results_count is null or e.results_count>0)) then
        raise exception 'Discovery path was not actually executed with relevant results' using errcode='22023';end if;
      if not(referenced_check=any(refs)) then refs:=array_append(refs,referenced_check);end if;
    end loop;
  end if;
  primary_check:=refs[1];
  if p_payload?'primary_check_id' then
    primary_check:=(p_payload->>'primary_check_id')::uuid;
    if primary_check is null or not(primary_check=any(refs)) then raise exception 'Primary attribution must name an actual referenced check' using errcode='22023';end if;
  end if;
  discovered:=private.opportunity_feedback_time(p_payload->>'discovered_at');encountered:=private.opportunity_feedback_time(p_payload->>'encountered_at');
  if p_payload?'discovered_at' and p_payload->'discovered_at'<>'null'::jsonb and discovered is null
    or p_payload?'encountered_at' and p_payload->'encountered_at'<>'null'::jsonb and encountered is null
    or discovered>clock_timestamp()+interval '5 minutes' or encountered>clock_timestamp()+interval '5 minutes'
    or discovered is not null and cardinality(refs)=0 or discovered is not null and encountered is not null and discovered>encountered
    or discovered is not null and not exists(select 1 from public.opportunity_search_executions e where e.run_id=p_run_id and e.check_id=primary_check and e.attempted_at<=discovered) then
    raise exception 'Unknown discovery time stays null; actual attribution requires an executed path' using errcode='22023';end if;
  if p_payload?'recommendation_generated' and jsonb_typeof(p_payload->'recommendation_generated') is distinct from 'boolean'
    or p_payload?'updated_only' and jsonb_typeof(p_payload->'updated_only') is distinct from 'boolean' then
    raise exception 'Recommendation/update facts must be boolean' using errcode='22023';end if;
  primary_value:=discovered is not null and cardinality(refs)>0
    and not exists(select 1 from public.opportunity_search_discoveries where user_id=run.user_id and opportunity_id=receipt.opportunity_id and primary_discovery);
  assessment:=receipt.original_assessment;
  select coalesce(jsonb_agg(jsonb_build_object('url',private.opportunity_feedback_safe_url(s->>'url'),'kind',s->'kind','checked_at',s->'checked_at','precision',s->'precision')),'[]'::jsonb)
    into evidence from(select jsonb_build_object('url',s->'url','kind',s->'kind','checked_at',s->'checked_at','precision',s->'precision') s
      from public.opportunity_search_receipts r cross join lateral jsonb_array_elements(coalesce(r.payload->'sources','[]')) s
      where r.run_id=p_run_id and r.item_id=p_item_id and private.opportunity_feedback_safe_url(s->>'url') is not null order by s->>'url') sources;
  -- Freeze only explicit public facts from the exact saved version. Never read
  -- a whole before/after snapshot or mutable current catalogue assessment.
  select a.after_snapshot->>'institution' institution,
    array(select jsonb_array_elements_text(coalesce(a.after_snapshot->'topics','[]'))) topics,
    (a.after_snapshot->>'deadline')::date deadline,(a.after_snapshot->>'deadline_time_local')::time deadline_time_local,
    a.after_snapshot->>'deadline_timezone' deadline_timezone,a.after_snapshot->>'deadline_original_text' deadline_original_text,
    a.after_snapshot->>'availability' availability into facts
    from private.opportunity_search_merge_audit a where a.run_id=p_run_id and a.item_id=p_item_id;
  institution_value:=facts.institution;
  if not private.opportunity_feedback_projection_text(institution_value,200) then institution_value:=null;end if;
  select coalesce(array_agg(t order by t collate "C"),'{}') into topic_values from(select distinct t from unnest(facts.topics) t
    where private.opportunity_feedback_projection_text(t,120) order by t) topics;
  -- V5's source log includes rejected historical claims. Only the effective
  -- field binding can establish authority for the value saved in this receipt.
  select coalesce(bool_or(k='deadline'),false) deadline,
    coalesce(bool_or(k='deadline_timezone'),false) zone,
    coalesce(bool_or(k='deadline_time_local'),false) local_time,
    coalesce(bool_or(k='deadline_original_text'),false) original,
    coalesce(bool_or(k='availability'),false) availability into support
    from private.opportunity_search_merge_audit a
      cross join lateral unnest(array['deadline','deadline_timezone','deadline_time_local','deadline_original_text','availability']) k
      cross join lateral jsonb_array_elements(coalesce(a.after_state#>array['/'||k,'evidence'],'[]')) s
    where a.run_id=p_run_id and a.item_id=p_item_id
      and a.after_state#>array['/'||k,'value'] is not distinct from a.after_snapshot->k
      and s->>'kind' in('official','official_listing','institution','graduate_school')
      and private.opportunity_feedback_safe_url(s->>'url') is not null and (s->>'precision'='instant'
        and private.opportunity_feedback_time(s->>'checked_at')<=clock_timestamp()+interval '5 minutes'
        or s->>'precision'='date' and s->>'checked_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and (s->>'checked_at')::date<=(clock_timestamp()+interval '14 hours')::date);
  -- An official date alone does not verify a more precise timestamp found in
  -- another field. Use the whole original only with its own evidence, or with
  -- separately established date, local time and timezone evidence.
  if private.opportunity_feedback_time(facts.deadline_original_text) is not null
    and not (support.original or support.deadline and support.local_time and support.zone) then
    facts.deadline_original_text:=null;
  end if;
  verified_deadline:=case when private.opportunity_feedback_time(facts.deadline_original_text) is not null then true
    when facts.deadline is not null then support.deadline and support.zone else support.availability end;
  if facts.deadline_time_local is not null and not support.local_time and private.opportunity_feedback_time(facts.deadline_original_text) is null then facts.deadline_time_local:=null;end if;
  deadline:=private.opportunity_search_deadline_quality(facts.deadline,facts.deadline_time_local,facts.deadline_timezone,facts.deadline_original_text,facts.availability,verified_deadline,discovered,clock_timestamp());
  generated:=coalesce((p_payload->>'recommendation_generated')::boolean,false);
  if run.query_plan_id is not null then select * into plan from public.opportunity_search_query_plans where id=run.query_plan_id;end if;
  insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,query_plan_id,base_revision,feedback_revision,preference_revision,protocol_version,
    primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,original_assessment,assessment_recorded_at,assessment_version,assessment_evidence,
    institution,topics,recommendation_eligible,recommendation_generated,recommendation_policy_violation,updated_only,deadline_quality,payload_hash)
    values(run.user_id,run.search_id,p_run_id,p_item_id,receipt.opportunity_id,run.query_plan_id,run.template_revision,coalesce(run.feedback_snapshot_revision,0),coalesce(plan.preference_revision,0),run.protocol_version,
      primary_value,refs,primary_check,discovered,encountered,assessment,case when assessment is not null then audit.recorded_at else null end,case when assessment is not null then run.protocol_version else null end,evidence,
      institution_value,topic_values,(deadline->>'recommendation_eligible')::boolean,generated,generated and not coalesce((deadline->>'recommendation_eligible')::boolean,false),
      coalesce((p_payload->>'updated_only')::boolean,receipt.outcome<>'new'),deadline,fingerprint) returning * into saved;
  return jsonb_build_object('discovery_id',saved.discovery_id,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',saved.opportunity_id,'recorded',true,'verification_required',true,
    'recommendation_eligible',saved.recommendation_eligible,'recommendation_policy_violation',saved.recommendation_policy_violation,'delivery_status','unknown');
end;
$_$;
