-- AF-05 integration: real v1/v5 protocol, synthetic owners and web evidence.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  run_id_value uuid;first_run uuid;run_failed uuid:=gen_random_uuid();run_empty uuid:=gen_random_uuid();run_overflow uuid:=gen_random_uuid();
  query_main uuid:=gen_random_uuid();query_idle uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();extra_registry uuid:=gen_random_uuid();
  query_anchor uuid;plan_id uuid;protocol text;item_id_value uuid;first_item uuid;first_discovery uuid;opportunity uuid;late_opportunity uuid;
  report_id_value uuid;first_report_id uuid;check_main uuid;check_source uuid;candidate uuid:=gen_random_uuid();n integer;blocked boolean;
  now_value timestamptz;payload jsonb;result jsonb;canonical_receipt jsonb;report jsonb;first_report jsonb;attribution jsonb;first_attribution jsonb;
  metrics jsonb;expectations jsonb;original jsonb;original_time timestamptz;source jsonb;plan_doc jsonb;checks jsonb;
  schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
    (search_a,owner_a,'Synthetic attribution search','{"topicsAndMethods":"Synthetic physical sensing"}',schedule),
    (search_b,owner_b,'Synthetic private metrics','{"topicsAndMethods":"Synthetic BCI"}',schedule);
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  run_id_value:=gen_random_uuid();perform private.begin_opportunity_search(search_a,run_id_value);
  result:=private.save_opportunity_search_queries(run_id_value,'[{"query":"synthetic physical sensing"},{"query":"unexecuted synthetic query"}]');query_anchor:=(result->>'id')::uuid;
  plan_doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(
    jsonb_build_object('query_id',query_main,'query','synthetic physical sensing','text_hash',encode(sha256(convert_to('synthetic physical sensing','UTF8')),'hex'),'role','core','manual',false),
    jsonb_build_object('query_id',query_idle,'query','unexecuted synthetic query','text_hash',encode(sha256(convert_to('unexecuted synthetic query','UTF8')),'hex'),'role','core','manual',false)));
  result:=private.publish_opportunity_search_plan(owner_a,search_a,query_anchor,plan_doc,1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);plan_id:=(result->>'id')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source(search_a,registry,'{"listing_url":"https://example.invalid/Jobs","enabled":true,"pinned":true,"mandatory":true,"check_interval_hours":24}');
  execute 'reset role';

  for n in 1..10 loop
    if n>1 then run_id_value:=gen_random_uuid();perform private.begin_opportunity_search(search_a,run_id_value);end if;
    perform private.pin_opportunity_search_plan(owner_a,search_a,run_id_value,plan_id);
    expectations:=private.prepare_opportunity_search_execution(run_id_value);
    now_value:=clock_timestamp();check_main:=gen_random_uuid();check_source:=null;report_id_value:=gen_random_uuid();
    checks:=jsonb_build_array(jsonb_build_object('check_id',check_main,'kind','query','query_id',query_main,
      'text_hash',encode(sha256(convert_to('synthetic physical sensing','UTF8')),'hex'),'attempted_at',now_value,'status','complete','results_count',1));
    if n=1 then
      check_source:=gen_random_uuid();checks:=checks||jsonb_build_array(jsonb_build_object('check_id',check_source,'kind','source','source_registry_id',registry,'attempted_at',now_value,'status','complete','results_count',1));
    end if;
    report:=jsonb_build_object('checks',checks,'backlog','[]'::jsonb,'complete',true);
    result:=private.record_opportunity_search_execution(run_id_value,report_id_value,report);
    assert result->>'status'='partial','A saved but unexecuted query counted as covered';
    item_id_value:=gen_random_uuid();now_value:=clock_timestamp();
    source:=jsonb_build_object('url','https://example.invalid/Vacancy/AF05','kind','official','checked_at',now_value,'precision','instant',
      'supports',case when n=1 then jsonb_build_array('title','institution','topics','deadline','deadline_timezone','deadline_time_local','personal_fit','official_url') else jsonb_build_array('title') end);
    payload:=jsonb_build_object('opportunity_key','af05-main-'||search_a,'title','Synthetic sensing researcher','institution','Synthetic Institute','topics',jsonb_build_array('BCI'),
      'official_url','https://example.invalid/Vacancy/AF05','deadline',(current_date+10)::text,'deadline_time_local','12:00:00','deadline_timezone','UTC',
      'personal_fit',jsonb_build_object('score',case when n=1 then 8.4 else 9.9 end,'scale_min',0,'scale_max',10,'summary','Synthetic evidence-based prediction'),
      'sources',jsonb_build_array(source),'last_checked_at',now_value);
    canonical_receipt:=private.submit_opportunity_search_result(run_id_value,item_id_value,payload);opportunity:=(canonical_receipt->>'opportunity_id')::uuid;
    attribution:=jsonb_build_object('execution_refs',case when check_source is null then jsonb_build_array(check_main) else jsonb_build_array(check_main,check_source) end,
      'primary_check_id',check_main,'discovered_at',clock_timestamp(),'encountered_at',clock_timestamp(),'recommendation_generated',true);
    result:=private.record_opportunity_search_discovery(run_id_value,item_id_value,attribution);
    assert (select assessment_verified_at is null and verified_at is null from public.opportunity_search_discoveries where run_id=run_id_value and item_id=item_id_value),'Pending attribution gained verification';
    perform private.verify_opportunity_search_result(run_id_value,item_id_value);
    perform private.verify_opportunity_search_discovery(run_id_value,item_id_value);
    assert (select assessment_verified_at is not null from public.opportunity_search_discoveries where run_id=run_id_value and item_id=item_id_value),'Separate canonical verification did not establish the assessment';
    if n=1 then
      first_run:=run_id_value;first_item:=item_id_value;first_discovery:=(result->>'discovery_id')::uuid;
      first_report_id:=report_id_value;first_report:=report;first_attribution:=attribution;
      select original_assessment,assessment_recorded_at into original,original_time from public.opportunity_search_discoveries where discovery_id=first_discovery;
    else
      assert (select assessment_score=9.9 from public.opportunity_search_discoveries where run_id=run_id_value and item_id=item_id_value),'Per-run prediction was replaced by mutable canonical fit';
    end if;
  end loop;
  assert (select count(*) from public.opportunity_search_discoveries where user_id=owner_a and opportunity_id=opportunity)=10,'Rediscovery audits were lost';
  assert (select count(*) from public.opportunity_search_discoveries where user_id=owner_a and opportunity_id=opportunity and primary_discovery)=1,'Ten encounters became ten primary discoveries';
  assert (select personal_fit->'score' from public.opportunities where id=opportunity)='8.4'::jsonb,'The fixture failed to distinguish incoming and canonical assessments';
  update public.opportunity_search_runs set status='complete' where id=first_run;
  assert private.record_opportunity_search_execution(first_run,first_report_id,first_report)->>'status'='partial','Lost report response could not be replayed after completion';
  assert private.record_opportunity_search_discovery(first_run,first_item,first_attribution)->>'discovery_id'=first_discovery::text,'Lost discovery response could not be replayed after completion';
  blocked:=false;
  begin perform private.record_opportunity_search_execution(first_run,first_report_id,first_report||'{"complete":false}');exception when serialization_failure then blocked:=true;end;
  assert blocked,'A reused report ID accepted a different body';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  metrics:=public.read_opportunity_search_metrics(search_a);
  assert metrics#>'{overall,unique_discoveries}'='1'::jsonb and metrics#>'{overall,unique_encounters}'='1'::jsonb,'Metrics double-counted rediscoveries';
  assert (select q->'executions' from jsonb_array_elements(metrics->'queries') q where q->>'query_id'=query_idle::text)='0'::jsonb,'Saved query received invented execution credit';
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),'strong_interest');
  perform public.review_job_opportunity(opportunity,null,'not_interested');
  metrics:=public.read_opportunity_search_metrics(search_a);
  assert metrics#>'{overall,reviewed}'='1'::jsonb and metrics#>'{overall,mean_interest}'='2'::jsonb,'Current categorical choice did not update deduplicated aggregates';
  perform public.save_opportunity_feedback(opportunity,'{"feedback_excluded":true}');
  metrics:=public.read_opportunity_search_metrics(search_a);
  assert metrics#>'{overall,reviewed}'='0'::jsonb and metrics#>'{overall,explicit_high_interest}'='0'::jsonb and metrics#>'{overall,confirmed_submissions}'='0'::jsonb,'Excluded feedback penalized preference rates';
  execute 'reset role';
  assert (select original_assessment=original and assessment_recorded_at=original_time from public.opportunity_search_discoveries where discovery_id=first_discovery),'Feedback rewrote the original run prediction';
  blocked:=false;
  begin update public.opportunity_search_discoveries set original_assessment='{"score":0,"scale_min":0,"scale_max":10}' where discovery_id=first_discovery;exception when check_violation then blocked:=true;end;
  assert blocked,'Historical assessment changed in place';

  -- Complete empty checks and failed zero-result checks have different meanings.
  perform private.begin_opportunity_search(search_a,run_empty);perform private.pin_opportunity_search_plan(owner_a,search_a,run_empty,plan_id);perform private.prepare_opportunity_search_execution(run_empty);
  checks:=jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','query','query_id',query_main,'text_hash',plan_doc#>>'{queries,0,text_hash}','attempted_at',clock_timestamp(),'status','complete','results_count',0),
    jsonb_build_object('check_id',gen_random_uuid(),'kind','query','query_id',query_idle,'text_hash',plan_doc#>>'{queries,1,text_hash}','attempted_at',clock_timestamp(),'status','complete','results_count',0));
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),jsonb_build_object('checks',checks,'complete',true));
  assert result->>'status'='complete','Genuine complete zero-result checks were not successful';
  -- Extra actual paths are part of coverage even when they were not due/planned.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source(search_a,extra_registry,'{"listing_url":"https://example.invalid/ExtraJobs","enabled":false}');
  execute 'reset role';
  checks:=jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','source','source_registry_id',extra_registry,'attempted_at',clock_timestamp(),'status','blocked','failure_reason','access_denied'));
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),jsonb_build_object('checks',checks,'complete',true));
  assert result->>'status'='partial','An extra actually blocked path was silently reported complete';
  checks:=jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','source','source_registry_id',extra_registry,'attempted_at',clock_timestamp(),'status','complete','results_count',0));
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),jsonb_build_object('checks',checks,'complete',true));
  assert result->>'status'='complete','A later successful retry did not resolve its actual blocked path';
  assert (select not enabled and owner_disabled from public.opportunity_search_sources where registry_id=extra_registry),'Coverage metadata reactivated an owner-disabled source';
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),jsonb_build_object('checks','[]'::jsonb,'complete',true,
    'backlog',jsonb_build_array(jsonb_build_object('candidate_id',candidate,'url','https://example.invalid/Vacancy/Pending','reason','needs_verification'))));
  assert result->>'status'='partial' and result->'retained_backlog'='1'::jsonb,'Unverified candidate disappeared from coverage';
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),'{"checks":[],"backlog":[],"complete":true}');
  assert result->'retained_backlog'='1'::jsonb and result->>'status'='partial','Empty backlog implicitly erased an unresolved candidate';
  perform private.submit_opportunity_search_result(run_empty,candidate,payload);
  perform private.verify_opportunity_search_result(run_empty,candidate);
  result:=private.record_opportunity_search_execution(run_empty,gen_random_uuid(),'{"checks":[],"backlog":[],"complete":true}');
  assert result->>'status'='complete' and result->'retained_backlog'='0'::jsonb,'Separately verified candidate did not resolve its backlog entry';
  perform private.begin_opportunity_search(search_a,run_failed);perform private.pin_opportunity_search_plan(owner_a,search_a,run_failed,plan_id);perform private.prepare_opportunity_search_execution(run_failed);
  checks:=jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','query','query_id',query_main,'text_hash',plan_doc#>>'{queries,0,text_hash}','attempted_at',clock_timestamp(),'status','failed','failure_reason','network_error'));
  result:=private.record_opportunity_search_execution(run_failed,gen_random_uuid(),jsonb_build_object('checks',checks,'complete',true));
  assert result->>'status'='failed','Failed zero-result run was reported as empty success';
  perform private.begin_opportunity_search(search_a,run_overflow);perform private.pin_opportunity_search_plan(owner_a,search_a,run_overflow,plan_id);perform private.prepare_opportunity_search_execution(run_overflow);
  select jsonb_agg(jsonb_build_object('unsafe_private','person@example.invalid','check_id',gen_random_uuid())) into checks from generate_series(1,129);
  result:=private.record_opportunity_search_execution(run_overflow,gen_random_uuid(),jsonb_build_object('checks',checks));
  assert result->>'status'='incomplete' and result::text!~'person@example.invalid','Oversized report silently succeeded or returned raw rejected data';
  assert not exists(select 1 from public.opportunity_search_executions where run_id=run_overflow),'Oversized unvalidated checks were persisted';
  assert (select execution_report_overflow and execution_report_status='partial' from public.opportunity_search_runs where id=run_overflow),'Overflow incompleteness was lost';

  -- Unknown attribution remains unknown; unsupported historical times are rejected.
  run_id_value:=gen_random_uuid();perform private.begin_opportunity_search(search_a,run_id_value);perform private.pin_opportunity_search_plan(owner_a,search_a,run_id_value,plan_id);perform private.prepare_opportunity_search_execution(run_id_value);
  now_value:=clock_timestamp();check_main:=gen_random_uuid();item_id_value:=gen_random_uuid();
  perform private.record_opportunity_search_execution(run_id_value,gen_random_uuid(),jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('check_id',check_main,'kind','query','query_id',query_main,
    'text_hash',plan_doc#>>'{queries,0,text_hash}','attempted_at',now_value,'status','partial','results_count',1))));
  -- A historical after-image can contain a precise string without evidence for
  -- its time. The attribution reader must retain only official date precision.
  select jsonb_agg(jsonb_build_object('url','https://example.invalid/Evidence/'||i,'kind','official','checked_at',clock_timestamp(),'precision','instant',
    'supports',jsonb_build_array('title','official_url','deadline','deadline_timezone'))) into source from generate_series(1,20) i;
  payload:=payload||jsonb_build_object('sources',source);
  canonical_receipt:=private.submit_opportunity_search_result(run_id_value,item_id_value,payload);
  update private.opportunity_search_merge_audit set after_snapshot=after_snapshot||jsonb_build_object(
    'deadline',(current_date+10)::text,'deadline_timezone','UTC','deadline_time_local','23:59:00',
    'deadline_original_text',(current_date+10)::text||'T23:59:00Z','sources',source,
    'topics',(select jsonb_agg('Topic '||i) from generate_series(1,20) i)) where run_id=run_id_value and item_id=item_id_value;
  result:=private.record_opportunity_search_discovery(run_id_value,item_id_value,jsonb_build_object('execution_refs',jsonb_build_array(check_main),'discovered_at',clock_timestamp()));
  assert (select deadline_quality->>'precision'='date_only_conservative' and deadline_quality->'official_deadline_at'='null'::jsonb
    and cardinality(topics)=20 and jsonb_array_length(assessment_evidence)=20 from public.opportunity_search_discoveries where discovery_id=(result->>'discovery_id')::uuid),
    'Unsupported exact time was promoted, or safe canonical topics/evidence were silently truncated';
  item_id_value:=gen_random_uuid();
  perform private.submit_opportunity_search_result(run_id_value,item_id_value,payload);
  -- A rejected historical claim in the log cannot repair an absent/mismatched
  -- effective field binding. These changes affect synthetic audit fixtures only.
  update private.opportunity_search_merge_audit set after_snapshot=after_snapshot||jsonb_build_object(
    'deadline',(current_date+11)::text,'deadline_original_text',(current_date+11)::text||'T23:59:00Z',
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/RejectedClaim','kind','official','checked_at',clock_timestamp(),'precision','instant',
      'supports',jsonb_build_array('deadline','deadline_timezone','deadline_time_local','deadline_original_text'))))
    where run_id=run_id_value and item_id=item_id_value;
  result:=private.record_opportunity_search_discovery(run_id_value,item_id_value,jsonb_build_object('execution_refs',jsonb_build_array(check_main),'discovered_at',clock_timestamp()));
  assert (select deadline_quality->>'precision'='provisional' and deadline_quality->'recommendation_eligible'='null'::jsonb
    and deadline_quality->'official_deadline_at'='null'::jsonb from public.opportunity_search_discoveries where discovery_id=(result->>'discovery_id')::uuid),
    'Historical rejected claims blessed values without matching effective evidence';
  item_id_value:=gen_random_uuid();
  payload:=payload||jsonb_build_object('opportunity_key','af05-historical-'||search_a,'title','Historical unknown attribution',
    'official_url','https://example.invalid/Vacancy/Historical/'||search_a,'personal_fit',jsonb_build_object('score',null,'scale_min',0,'scale_max',10,'summary',null));
  canonical_receipt:=private.submit_opportunity_search_result(run_id_value,item_id_value,payload);late_opportunity:=(canonical_receipt->>'opportunity_id')::uuid;
  blocked:=false;
  begin perform private.record_opportunity_search_discovery(run_id_value,item_id_value,jsonb_build_object('execution_refs',jsonb_build_array(check_main),'discovered_at','2020-01-01T00:00:00Z'));exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Unrelated old timestamps gained causal primary attribution';
  result:=private.record_opportunity_search_discovery(run_id_value,item_id_value,'{}');
  assert (select discovered_at is null and encountered_at is null and primary_check_id is null and not primary_discovery from public.opportunity_search_discoveries where discovery_id=(result->>'discovery_id')::uuid),'Historical attribution/time was fabricated';
  run_id_value:=gen_random_uuid();item_id_value:=gen_random_uuid();check_main:=gen_random_uuid();
  perform private.begin_opportunity_search(search_a,run_id_value);perform private.pin_opportunity_search_plan(owner_a,search_a,run_id_value,plan_id);perform private.prepare_opportunity_search_execution(run_id_value);
  perform private.record_opportunity_search_execution(run_id_value,gen_random_uuid(),jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('check_id',check_main,'kind','query','query_id',query_main,
    'text_hash',plan_doc#>>'{queries,0,text_hash}','attempted_at',clock_timestamp(),'status','complete','results_count',1))));
  perform private.submit_opportunity_search_result(run_id_value,item_id_value,payload);
  result:=private.record_opportunity_search_discovery(run_id_value,item_id_value,jsonb_build_object('execution_refs',jsonb_build_array(check_main),'discovered_at',clock_timestamp()));
  assert (select primary_discovery from public.opportunity_search_discoveries where discovery_id=(result->>'discovery_id')::uuid)
    and (select count(*) from public.opportunity_search_discoveries where user_id=owner_a and opportunity_id=late_opportunity and primary_discovery)=1,
    'An unknown historical encounter consumed the first evidenced discovery slot';

  -- Clearing canonical proof invalidates cached readonly baseline metadata.
  update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where run_id=first_run and item_id=first_item;
  assert (select verified_at is null and assessment_verified_at is null from public.opportunity_search_discoveries where discovery_id=first_discovery),'Rolled-back assessment kept trusted verification';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  blocked:=false;begin perform public.read_opportunity_search_metrics(search_a);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner B read A private metrics';
  assert not exists(select 1 from public.opportunity_search_discoveries where user_id=owner_a),'Owner B read A private assessments';
  assert not has_function_privilege(current_user,'private.record_opportunity_search_discovery(uuid,uuid,jsonb)','EXECUTE'),'Management attribution writer exposed';
  execute 'reset role';
end;
$$;

do $$declare q jsonb;begin
  q:=private.opportunity_search_deadline_quality('2026-11-01','12:00','Europe/Berlin',null,null,true,'2026-10-29T11:00:00Z','2026-10-29T11:00:00Z');
  assert q->>'precision'='official_local' and q->'lead_time_hours'='72'::jsonb and q->'recommendation_eligible'='true'::jsonb,'Official local 72-hour boundary wrong';
  q:=private.opportunity_search_deadline_quality('2026-11-01',null,'UTC',null,null,true,'2026-10-29T12:00:00Z','2026-10-29T12:00:00Z');
  assert q->>'precision'='date_only_conservative' and q->'lead_time_hours'='null'::jsonb and q->'official_deadline_at'='null'::jsonb
    and q->'lead_time_lower_hours'='60'::jsonb and q->'lead_time_upper_hours'='84'::jsonb and q->>'late_discovery_status'='possible','Date-only bounds claimed precise lead time';
  q:=private.opportunity_search_deadline_quality('2026-10-25','02:30','Europe/Berlin',null,null,true,'2026-10-22T01:00:00Z','2026-10-22T01:00:00Z');
  assert q->>'precision'='ambiguous_bound' and q->'lead_time_hours'='null'::jsonb and q->'lead_time_lower_hours'='71.5'::jsonb
    and q->'lead_time_upper_hours'='72.5'::jsonb and q->>'late_discovery_status'='possible' and q->'recommendation_eligible'='false'::jsonb,'Repeated DST time was treated as exact or optimistically eligible';
  q:=private.opportunity_search_deadline_quality('2026-03-29','02:30','Europe/Berlin',null,null,true,null,'2026-03-25T00:00:00Z');
  assert q->>'precision'='unknown' and q->'deadline_at'='null'::jsonb,'Nonexistent DST time invented a deadline';
  q:=private.opportunity_search_deadline_quality('2026-11-01','12:00',null,null,null,true,null,'2026-10-29T00:00:00Z');
  assert q->>'precision'='unknown','Missing timezone fell back to execution-host timezone';
  q:=private.opportunity_search_deadline_quality('2026-11-01','12:00','UTC',null,null,false,null,'2026-10-29T00:00:00Z');
  assert q->>'precision'='provisional' and q->'recommendation_eligible'='null'::jsonb and q->'official_deadline_at'='null'::jsonb,'Unverified deadline authorized recommendations';
  q:=private.opportunity_search_deadline_quality(null,null,null,null,'open_until_filled',true,null,'2026-10-29T00:00:00Z');
  assert q->>'precision'='rolling' and q->'recommendation_eligible'='true'::jsonb and q->'lead_time_hours'='null'::jsonb,'Confirmed rolling deadline was fabricated as an instant';
end;$$;
rollback;
