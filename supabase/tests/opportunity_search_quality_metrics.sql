-- AF-05 owner metrics: synthetic relational fixtures only, always rolled back.
-- The attribution suite separately exercises the canonical write/verify protocol;
-- these rows isolate aggregation, denominator and historical-uncertainty cases.
begin;
do $$
declare
  v_owner uuid:=gen_random_uuid();v_other uuid:=gen_random_uuid();v_search uuid:=gen_random_uuid();v_other_search uuid:=gen_random_uuid();
  v_run uuid;v_first_run uuid;v_item uuid;v_check uuid;v_secondary uuid:=gen_random_uuid();v_idle uuid:=gen_random_uuid();
  v_query uuid:=gen_random_uuid();v_secondary_query uuid:=gen_random_uuid();v_source uuid:=gen_random_uuid();v_other_source uuid:=gen_random_uuid();
  v_due_source uuid:=gen_random_uuid();v_opps uuid[]:='{}';v_opp uuid;v_metric jsonb;v_original jsonb;v_protocol text;v_n integer;v_blocked boolean;
  v_expectations jsonb;v_when timestamptz:='2026-10-20T10:00:00Z';
  v_schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(v_owner),(v_other);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
    (v_search,v_owner,'Synthetic metric search','{"topicsAndMethods":"Synthetic BCI"}',v_schedule),
    (v_other_search,v_other,'Synthetic private search','{"topicsAndMethods":"Synthetic acoustics"}',v_schedule);
  select active_protocol_version into v_protocol from private.opportunity_search_settings where singleton;
  v_expectations:=jsonb_build_object('pending_queries',false,'queries',jsonb_build_array(
    jsonb_build_object('query_id',v_query,'text_hash',repeat('a',64)),jsonb_build_object('query_id',v_idle,'text_hash',repeat('c',64))),
    -- This ordinary due source is expected even though it is neither pinned nor mandatory.
    'sources',jsonb_build_array(jsonb_build_object('registry_id',v_due_source,'mandatory',false,'pinned',false)));
  for v_n in 1..6 loop
    v_opp:=gen_random_uuid();v_opps:=array_append(v_opps,v_opp);
    insert into public.opportunities(id,opportunity_key,title) values(v_opp,'af05-quality-'||v_opp,'Synthetic metric opportunity');
  end loop;
  -- Ten encounters of the same canonical opportunity are one discovery/outcome.
  for v_n in 1..10 loop
    v_run:=gen_random_uuid();v_check:=gen_random_uuid();v_item:=gen_random_uuid();
    perform private.begin_opportunity_search(v_search,v_run);
    update public.opportunity_search_runs set status='complete',execution_expectations=v_expectations,execution_report_status='complete' where id=v_run;
    insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,source_registry_id,attempted_at,status,results_count,payload_hash)
      values(v_run,v_check,v_owner,v_search,'query',v_query,repeat('a',64),v_source,v_when,'complete',1,repeat('a',64));
    if v_n=1 then
      v_first_run:=v_run;
      insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,source_registry_id,attempted_at,status,results_count,payload_hash)
        values(v_run,v_secondary,v_owner,v_search,'query',v_secondary_query,repeat('b',64),v_other_source,v_when,'complete',1,repeat('b',64));
    end if;
    insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result,verified_at)
      values(v_run,v_item,v_owner,v_opps[1],'{}','{}',v_when+interval '1 hour');
    insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,base_revision,feedback_revision,preference_revision,
      protocol_version,primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,original_assessment,assessment_recorded_at,
      assessment_verified_at,verified_at,institution,topics,recommendation_eligible,recommendation_generated,deadline_quality,payload_hash)
      values(v_owner,v_search,v_run,v_item,v_opps[1],1,0,0,v_protocol,v_n=1,
        case when v_n=1 then array[v_check,v_secondary] else array[v_check] end,v_check,v_when+interval '10 minutes',v_when+interval '10 minutes',
        '{"score":4.2,"scale_min":0,"scale_max":10,"summary":"Private prediction rationale person@example.invalid"}',v_when,
        v_when+interval '1 hour',v_when+interval '1 hour','Synthetic Institute',array['BCI','Robotics','person@example.invalid'],true,true,'{}',repeat('a',64));
  end loop;
  select original_assessment into v_original from public.opportunity_search_discoveries where run_id=v_first_run and opportunity_id=v_opps[1];
  -- Zero rating, confirmed-submission fallback, excluded submission, unknown
  -- attribution, and an unverified pending result each remain distinct cases.
  for v_n in 2..6 loop
    v_item:=gen_random_uuid();
    insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result,verified_at)
      values(v_first_run,v_item,v_owner,v_opps[v_n],'{}','{}',case when v_n=6 then null else v_when+interval '1 hour' end);
    insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,base_revision,feedback_revision,preference_revision,
      protocol_version,primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,verified_at,institution,topics,deadline_quality,payload_hash)
      select v_owner,v_search,v_first_run,v_item,v_opps[v_n],1,0,0,v_protocol,v_n<5,
        case when v_n=5 then '{}'::uuid[] else d.execution_refs[1:1] end,case when v_n=5 then null else d.primary_check_id end,
        case when v_n=5 then null else v_when+interval '10 minutes' end,null,
        case when v_n=6 then null else v_when+interval '1 hour' end,
        case when v_n=5 then 'Private person@example.invalid' else 'Synthetic Institute' end,array['BCI'],'{}',repeat('c',64)
        from public.opportunity_search_discoveries d where d.run_id=v_first_run and d.opportunity_id=v_opps[1];
  end loop;
  insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,feedback_excluded,comment) values
    (v_owner,v_opps[1],'strong_interest',null,false,'Private comment person@example.invalid'),
    (v_owner,v_opps[2],'not_interested',0,false,null),
    (v_owner,v_opps[4],'not_interested',null,true,null),
    (v_owner,v_opps[6],'strong_interest',10,false,null),
    (v_other,v_opps[1],'not_interested',1,false,'Other owner private comment');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'is_anonymous',false)::text,true);
  perform public.create_job_application(gen_random_uuid(),v_opps[3]);
  perform public.create_job_application(gen_random_uuid(),v_opps[4]);
  update public.applications set status='submitted',notes='Private application notes person@example.invalid' where user_id=v_owner;
  execute 'set local role authenticated';
  v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{overall,unique_discoveries}'='4'::jsonb and v_metric#>'{overall,unique_encounters}'='5'::jsonb,'Rediscoveries, unknown attribution or pending results inflated discovery facts';
  assert v_metric#>'{overall,reviewed}'='3'::jsonb and v_metric#>'{overall,with_interest}'='3'::jsonb,'Explicit review and numeric-score denominators were conflated';
  assert v_metric#>'{overall,mean_interest}'='6.5'::jsonb and v_metric#>'{overall,explicit_high_interest}'='2'::jsonb
    and v_metric#>'{overall,high_interest_rate}'='0.666667'::jsonb,'Current categorical and submitted interests were averaged incorrectly: '||v_metric::text;
  assert v_metric#>'{overall,confirmed_submissions}'='1'::jsonb and v_metric#>'{overall,submission_fallback}'='1'::jsonb
    and v_metric#>'{overall,explicit_rating}'='0'::jsonb and v_metric#>'{overall,categorical_review}'='2'::jsonb,'Excluded submission rewarded feedback or fallback became an explicit review';
  assert v_metric#>'{attribution,primary}'='4'::jsonb and v_metric#>'{attribution,unknown}'='1'::jsonb,'Unknown historical attribution was silently promoted';
  assert (select q->'unique_discoveries' from jsonb_array_elements(v_metric->'queries') q where q->>'query_id'=v_secondary_query::text)='0'::jsonb
    and (select q->'unique_encounters' from jsonb_array_elements(v_metric->'queries') q where q->>'query_id'=v_secondary_query::text)='1'::jsonb,'Secondary query received primary discovery credit';
  assert (select s->'unique_discoveries' from jsonb_array_elements(v_metric->'sources') s where s->>'registry_id'=v_other_source::text)='0'::jsonb,'Secondary source received primary discovery credit';
  assert (select q->'executions' from jsonb_array_elements(v_metric->'queries') q where q->>'query_id'=v_idle::text)='0'::jsonb
    and v_metric#>'{coverage,missing_checks}'='20'::jsonb,'Planned zero-execution query or ordinary due source disappeared from coverage';
  assert v_metric#>'{recommendations,generated}'='1'::jsonb and v_metric#>>'{recommendations,delivery_status}'='unknown','Generated notification was treated as confirmed delivery';
  assert v_metric->'groups_overlap'='true'::jsonb and jsonb_array_length(v_metric->'topics')=2,'Overlapping topic groups were lost or unsafe labels leaked';
  assert v_metric::text!~'person@example.invalid|Private prediction|Private comment|Private application|Other owner|context_json|contacts|original_assessment|interest_reasons','Private records or raw fields leaked through the fixed metrics DTO';
  perform public.review_job_opportunity(v_opps[1],null,'not_interested');
  v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{overall,mean_interest}'='4.5'::jsonb and v_metric#>'{overall,explicit_high_interest}'='1'::jsonb,'Current explicit correction did not update the deduplicated quality signal';
  execute 'reset role';
  assert (select original_assessment=v_original from public.opportunity_search_discoveries where run_id=v_first_run and opportunity_id=v_opps[1]),'Metrics or current feedback rewrote the immutable prediction';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  v_blocked:=false;begin perform public.read_opportunity_search_metrics(v_search);exception when insufficient_privilege then v_blocked:=true;end;
  assert v_blocked,'Another owner read private metrics';
  assert not has_function_privilege(current_user,'private.opportunity_interest_metric(uuid,uuid)','EXECUTE'),'Metrics RPC widened private helper permissions';
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'is_anonymous',true)::text,true);execute 'set local role authenticated';
  v_blocked:=false;begin perform public.read_opportunity_search_metrics(v_search);exception when insufficient_privilege then v_blocked:=true;end;
  assert v_blocked,'Anonymous owner read private metrics';execute 'reset role';
  assert not has_function_privilege('anon','public.read_opportunity_search_metrics(uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.read_opportunity_search_metrics(uuid)','EXECUTE'),'Metrics received broad automation/public grants';
end;
$$;

-- Coverage observes actual attempts and run lifecycle; planned checks do not run
-- themselves, and old success cannot hide a later failed attempt.
do $$
declare
  v_owner uuid:=gen_random_uuid();v_search uuid:=gen_random_uuid();v_run uuid:=gen_random_uuid();v_failed uuid:=gen_random_uuid();
  v_query uuid:=gen_random_uuid();v_metric jsonb;v_n integer;v_expectations jsonb;
begin
  insert into auth.users(id) values(v_owner);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(v_search,v_owner,'Synthetic coverage',
    '{"topicsAndMethods":"Synthetic research"}','{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  v_expectations:=jsonb_build_object('pending_queries',false,'queries',jsonb_build_array(jsonb_build_object('query_id',v_query,'text_hash',repeat('d',64))),'sources','[]'::jsonb);
  perform private.begin_opportunity_search(v_search,v_run);
  update public.opportunity_search_runs set status='complete',execution_expectations=v_expectations,execution_report_status='complete' where id=v_run;
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,results_count,payload_hash)
    values(v_run,gen_random_uuid(),v_owner,v_search,'query',v_query,repeat('d',64),'2026-10-20T10:00:00Z','complete',0,repeat('d',64));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>>'{coverage,status}'='complete_empty' and v_metric#>'{coverage,empty_successes}'='1'::jsonb,'A successful empty actual check was misclassified';
  execute 'reset role';
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,failure_reason,payload_hash)
    values(v_run,gen_random_uuid(),v_owner,v_search,'query',v_query,repeat('d',64),'2026-10-20T11:00:00Z','blocked','access_denied',repeat('d',64));
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,incomplete}'='true'::jsonb and v_metric#>'{coverage,unresolved_checks}'='1'::jsonb,'Earlier empty success hid a later blocked attempt';
  execute 'reset role';
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,results_count,payload_hash)
    values(v_run,gen_random_uuid(),v_owner,v_search,'query',v_query,repeat('d',64),'2026-10-20T12:00:00Z','complete',0,repeat('d',64));
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,incomplete}'='false'::jsonb and v_metric#>'{coverage,blocked_checks}'='1'::jsonb,'Later successful retry did not resolve coverage while retaining the failed attempt';
  execute 'reset role';
  -- A failed zero-report run cannot be hidden by a separate complete empty run.
  perform private.begin_opportunity_search(v_search,v_failed);
  update public.opportunity_search_runs set status='failed' where id=v_failed;
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,incomplete}'='true'::jsonb and v_metric#>'{coverage,failed_runs}'='1'::jsonb
    and v_metric#>'{coverage,unreported_runs}'='1'::jsonb,'A failed unreported run disappeared behind an empty success';
  execute 'reset role';
  update public.opportunity_search_runs set execution_expectations=v_expectations,execution_report_status='complete' where id=v_failed;
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,results_count,payload_hash)
    values(v_failed,gen_random_uuid(),v_owner,v_search,'query',v_query,repeat('d',64),'2026-10-20T12:00:00Z','complete',0,repeat('d',64));
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,incomplete}'='true'::jsonb and v_metric#>'{coverage,failed_runs}'='1'::jsonb,'A complete report overrode the failed run lifecycle';
  execute 'reset role';
  -- Lifetime history is not an oversized incoming report.
  update public.opportunity_search_runs set status='complete' where id=v_failed;
  for v_n in 1..129 loop
    v_run:=gen_random_uuid();perform private.begin_opportunity_search(v_search,v_run);
    update public.opportunity_search_runs set status='complete',execution_expectations=v_expectations,execution_report_status='complete' where id=v_run;
    insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,results_count,payload_hash)
      values(v_run,gen_random_uuid(),v_owner,v_search,'query',v_query,repeat('d',64),'2026-10-20T12:00:00Z','complete',0,repeat('d',64));
  end loop;
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,report_overflow}'='false'::jsonb and v_metric#>'{coverage,incomplete}'='false'::jsonb
    and v_metric#>'{coverage,executed_checks}'='133'::jsonb,'Lifetime execution history was treated as one oversized report';
  execute 'reset role';
  update public.opportunity_search_runs set execution_backlog='[{"candidate_id":"00000000-0000-4000-8000-000000000001","reason":"needs_verification"}]',
    execution_backlog_omitted=2,execution_report_overflow=true where id=v_run;
  execute 'set local role authenticated';v_metric:=public.read_opportunity_search_metrics(v_search);
  assert v_metric#>'{coverage,incomplete}'='true'::jsonb and v_metric#>'{coverage,report_overflow}'='true'::jsonb
    and v_metric->'backlog'='{"retained":1,"omitted":2,"incomplete":true}'::jsonb,'Known bounded backlog/report omissions disappeared';
  execute 'reset role';
end;
$$;
rollback;
