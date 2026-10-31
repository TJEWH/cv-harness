-- AF-10 synthetic owner dashboard/control acceptance. Always rolled back.
-- Relational history fixtures isolate projection and denominators; canonical
-- intake/separate verification are covered by AF-05/08 protocol suites.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  registry uuid:=gen_random_uuid();pending_registry uuid:=gen_random_uuid();source_action uuid:=gen_random_uuid();consent_action uuid:=gen_random_uuid();
  source_revision bigint;action uuid;opportunity uuid:=gen_random_uuid();run_value uuid:=gen_random_uuid();failed_run uuid:=gen_random_uuid();
  item uuid:=gen_random_uuid();check_value uuid:=gen_random_uuid();query_id uuid:=gen_random_uuid();adaptive_query uuid:=gen_random_uuid();exploration_query uuid:=gen_random_uuid();anchor uuid;plan_id uuid;
  suggestion uuid:=gen_random_uuid();rule_id uuid:=gen_random_uuid();decision uuid:=gen_random_uuid();app_id uuid:=gen_random_uuid();
  r jsonb;again jsonb;original jsonb;source_receipt jsonb;dashboard jsonb;packet jsonb;settings jsonb;doc jsonb;
  original_base jsonb;original_meta jsonb;original_schedule jsonb;original_application jsonb;original_revision integer;
  protocol text;blocked boolean;n integer;v_run uuid;source_row jsonb;run_row jsonb;
  project text:='dddddddddddddddddddd';when_value timestamptz:='2026-10-20T10:00:00Z';
  cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values
    (search_a,owner_a,'Synthetic dashboard','{"topicsAndMethods":"BCI; Acoustics"}',cadence,
      '{"version":1,"active":true,"editor":{"legacySearchArchive":"ARCHIVE_PRIVATE_CANARY"},"systemPrompt":"SYSTEM_PRIVATE_CANARY","userPrompt":"USER_PRIVATE_CANARY","recurringPrompt":"TASK_PRIVATE_CANARY"}'),
    (search_b,owner_b,'Other dashboard','{"topicsAndMethods":"OTHER_OWNER_PRIVATE_CANARY"}',cadence,null);
  select criteria,meta_search,schedule,revision into original_base,original_meta,original_schedule,original_revision from public.opportunity_search_templates where id=search_a;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);
  assert dashboard->>'dashboard_version'='1' and dashboard#>'{settings,adaptation_enabled}'='false'::jsonb and dashboard#>'{settings,successful_source_reuse_enabled}'='false'::jsonb,'Dashboard defaults implied consent';
  assert dashboard#>'{runner_authorization,authorization_revision}'='0'::jsonb and dashboard#>'{queries,plan}'='null'::jsonb
    and dashboard->'sources'='[]'::jsonb and dashboard->'runs'='[]'::jsonb,'Cold dashboard invented history';
  assert dashboard->'feedback_preview'=public.preview_opportunity_search_feedback(search_a),'Dashboard modified the exact outgoing packet';
  r:=public.patch_opportunity_search_settings(search_a,consent_action,'{"adaptation_enabled":true}','{"adaptation_revision":0}');original:=r;
  again:=public.patch_opportunity_search_settings(search_a,consent_action,'{"adaptation_enabled":true}','{"adaptation_revision":0}');
  assert r=again and r#>'{settings,adaptation_revision}'='1'::jsonb,'Lost-response settings retry duplicated a revision';
  r:=public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"successful_source_reuse_enabled":true,"reuse_check_interval_hours":96}','{"source_reuse_revision":0}');
  assert r#>'{settings,adaptation_revision}'='1'::jsonb and r#>'{settings,source_reuse_revision}'='1'::jsonb,'Independent settings axes overwrote consent';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"adaptation_enabled":false}','{"adaptation_revision":0}');exception when serialization_failure then blocked:=true;end;
  assert blocked,'Stale same-axis settings edit silently overwrote consent';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,consent_action,'{"adaptation_enabled":false}','{"adaptation_revision":0}');exception when serialization_failure then blocked:=true;end;
  assert blocked,'Changed body reused an existing action identity';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"systemPrompt":"PRIVATE_CANARY"}','{}');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Control patch accepted arbitrary template/private fields';
  r:=public.patch_opportunity_search_source(search_a,registry,source_action,'{"listing_url":"https://example.invalid/Jobs?VacancyID=CaseA","institution":"Synthetic Institute","topics":["BCI"],"enabled":true,"pinned":true,"mandatory":false,"check_interval_hours":96}',0);source_receipt:=r;
  source_revision:=(r#>>'{source,source_revision}')::bigint;
  again:=public.patch_opportunity_search_source(search_a,registry,source_action,'{"listing_url":"https://example.invalid/Jobs?VacancyID=CaseA","institution":"Synthetic Institute","topics":["BCI"],"enabled":true,"pinned":true,"mandatory":false,"check_interval_hours":96}',0);
  assert r=again and source_revision>0,'Source create exact retry changed identity or revision';
  r:=public.patch_opportunity_search_source(search_a,registry,gen_random_uuid(),'{"enabled":false}',source_revision);
  assert r#>'{source,owner_disabled}'='true'::jsonb and r#>'{source,enabled}'='false'::jsonb,'Explicit source disable did not preserve owner opt-out';
  blocked:=false;begin perform public.patch_opportunity_search_source(search_a,registry,gen_random_uuid(),'{"pinned":false}',source_revision);exception when serialization_failure then blocked:=true;end;
  assert blocked,'Stale source edit overwrote a newer disable';
  r:=public.patch_opportunity_search_source(search_a,pending_registry,gen_random_uuid(),'{"vacancy_url":"https://example.invalid/Vacancy/CaseA"}',0);
  assert r#>'{source,status}'='"pending_identification"'::jsonb and r#>'{source,enabled}'='false'::jsonb,'Vacancy-only source invented a verified listing';
  blocked:=false;begin perform public.patch_opportunity_search_source(search_a,gen_random_uuid(),gen_random_uuid(),'{"listing_url":"https://example.invalid/jobs?token=PRIVATE_CANARY"}',0);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Unsafe contact/token URL passed source controls';
  -- Direct owner inserts must use exactly the RPC guard and cannot inject a
  -- receipt result that later leaks arbitrary JSON on retry.
  action:=gen_random_uuid();
  insert into public.opportunity_search_dashboard_actions(user_id,search_id,action_id,kind,patch,expected_revisions,result)
    values(owner_a,search_a,action,'settings','{"adaptation_paused":false}','{"adaptation_revision":1}','{"PRIVATE_CANARY":{"contacts":["person@example.invalid"]}}');
  again:=public.patch_opportunity_search_settings(search_a,action,'{"adaptation_paused":false}','{"adaptation_revision":1}');
  assert again::text!~'PRIVATE_CANARY|contacts|person@','Supplied control receipt bypassed its derivation guard';
  blocked:=false;begin update public.opportunity_search_dashboard_actions set result='{}' where user_id=owner_a;exception when insufficient_privilege or check_violation then blocked:=true;end;
  assert blocked,'Owner could mutate immutable control receipts';
  execute 'reset role';
  insert into public.opportunities(id,opportunity_key,title,institution,topics,contacts,requirements)
    values(opportunity,'af10-'||opportunity,'Synthetic opportunity','Synthetic Institute',array['BCI'],
      '[{"entity_id":"synthetic-contact","name":"CONTACT_PRIVATE_CANARY","email":"person@example.invalid","roles":["contact"]}]','[{"entity_id":"synthetic-requirement","text":"REQUIREMENT_PRIVATE_CANARY","status":"required","stage":"recruitment","conditions":[]}]');
  insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,comment) values(owner_a,opportunity,'interested',9,'COMMENT_PRIVATE_CANARY person@example.invalid');
  execute 'set local role authenticated';perform public.create_job_application(app_id,opportunity);execute 'reset role';
  update public.applications set notes='APPLICATION_PRIVATE_CANARY',context_json=context_json||'{"PRIVATE_CONTEXT_CANARY":{"people":["person@example.invalid"]}}'::jsonb where id=app_id;
  select context_json into original_application from public.applications where id=app_id;
  perform private.begin_opportunity_search(search_a,run_value);
  r:=private.save_opportunity_search_queries(run_value,'[{"query":"synthetic BCI opportunities"}]');anchor:=(r->>'id')::uuid;
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object('query_id',query_id,'query','synthetic BCI opportunities',
    'text_hash',encode(sha256(convert_to('synthetic BCI opportunities','UTF8')),'hex'),'role','core','manual',true,'source_registry_id',registry),
    jsonb_build_object('query_id',adaptive_query,'query','synthetic adapted acoustics','text_hash',encode(sha256(convert_to('synthetic adapted acoustics','UTF8')),'hex'),'role','adaptive','manual',false),
    jsonb_build_object('query_id',exploration_query,'query','synthetic exploration sensing','text_hash',encode(sha256(convert_to('synthetic exploration sensing','UTF8')),'hex'),'role','exploration','manual',false)));
  r:=private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,original_revision,(packet->>'feedback_revision')::bigint,0,protocol);plan_id:=(r->>'id')::uuid;
  update public.opportunity_search_runs set status='complete',completed_at=when_value+interval '1 hour',execution_report_status='complete',
    execution_expectations=jsonb_build_object('pending_queries',false,'queries',jsonb_build_array(jsonb_build_object('query_id',query_id,'text_hash',repeat('a',64))),
      'sources',jsonb_build_array(jsonb_build_object('registry_id',registry))),summary='{"unresolvedCount":0,"notes":"RUN_NOTES_PRIVATE_CANARY"}' where id=run_value;
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,source_registry_id,attempted_at,status,results_count,payload_hash)
    values(run_value,check_value,owner_a,search_a,'query',query_id,encode(sha256(convert_to('synthetic BCI opportunities','UTF8')),'hex'),registry,when_value,'complete',1,repeat('a',64));
  insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result,verified_at)
    values(run_value,item,owner_a,opportunity,'{"PRIVATE_PAYLOAD_CANARY":{"contacts":["person@example.invalid"]}}','{"outcome":"new","snapshot":{"PRIVATE_SNAPSHOT_CANARY":"person@example.invalid"}}',when_value+interval '1 hour');
  insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,base_revision,feedback_revision,preference_revision,protocol_version,
    primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,verified_at,institution,topics,deadline_quality,payload_hash)
    values(owner_a,search_a,run_value,item,opportunity,1,0,0,protocol,true,array[check_value],check_value,when_value+interval '5 minutes',when_value+interval '5 minutes',
      when_value+interval '1 hour','Synthetic Institute',array['BCI'],'{"late_discovery_status":"possible","precision":"date_only_conservative","provisional":true,"lead_time_lower_hours":48,"lead_time_upper_hours":72,"PRIVATE_DEADLINE_CANARY":"person@example.invalid"}',repeat('a',64));
  perform private.begin_opportunity_search(search_a,failed_run);
  update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='failed',summary='{"unresolvedCount":1,"notes":"FAILED_PRIVATE_CANARY"}',execution_backlog='[{"url":"https://example.invalid/Backlog","reason":"candidate_limit"}]',execution_backlog_omitted=2,execution_report_overflow=true where id=failed_run;
  insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,source_registry_id,attempted_at,status,failure_reason,payload_hash)
    values(failed_run,gen_random_uuid(),owner_a,search_a,'source',registry,when_value+interval '2 hours','blocked','access_denied',repeat('b',64));
  execute 'set local role authenticated';
  r:=public.propose_opportunity_search_preference(search_a,suggestion,jsonb_build_object('rule_id',rule_id,'kind','emphasis','category','topic','polarity','positive','target','BCI','evidence_refs',jsonb_build_array(opportunity)));
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);
  assert dashboard::text!~'PRIVATE_CANARY|PRIVATE_CONTEXT_CANARY|person@|"contacts"|"requirements"|"context_json"|"snapshot"|"payload"|"definition"|"notes"','Dashboard exposed a private source or nested raw blob';
  assert dashboard->'feedback_preview'=public.preview_opportunity_search_feedback(search_a),'Dashboard packet differs from current runner projection';
  source_row:=(select x from jsonb_array_elements(dashboard->'sources') x where x->>'registry_id'=registry::text);
  assert source_row#>'{coverage,last_status}'='"blocked"'::jsonb and source_row#>'{coverage,last_failure_reason}'='"access_denied"'::jsonb
    and source_row#>'{outcomes,sample_size}'='1'::jsonb and source_row#>'{outcomes,mean_interest}'='9.000000'::jsonb,'Source coverage or distinct reviewed cohort is missing';
  assert dashboard#>>'{queries,plan,id}'=plan_id::text and jsonb_array_length(dashboard#>'{queries,executions}')=2
    and dashboard#>'{queries,plan,queries,0,outcomes,sample_size}'='1'::jsonb and dashboard#>'{queries,plan,queries,0,outcomes,explicit_high_interest}'='1'::jsonb
    and dashboard#>>'{queries,plan,queries,1,query}'='synthetic adapted acoustics','Saved query plan and actual execution history were conflated';
  run_row:=(select x from jsonb_array_elements(dashboard->'runs') x where x->>'run_id'=run_value::text);
  assert run_row#>'{counts,new}'='1'::jsonb and run_row#>'{counts,verified}'='1'::jsonb and run_row#>'{counts,incomplete_sources}'='1'::jsonb
    and run_row#>'{deadline,exact_lead_time_hours}'='null'::jsonb and run_row#>'{deadline,lower_lead_time_hours}'='48.000000'::jsonb
    and run_row#>'{deadline,upper_lead_time_hours}'='72.000000'::jsonb and run_row#>'{deadline,uncertain}'='true'::jsonb,'Run counts, missing direct check, or uncertain deadline bounds were invented';
  run_row:=(select x from jsonb_array_elements(dashboard->'runs') x where x->>'run_id'=failed_run::text);
  assert run_row->>'status'='failed' and run_row#>'{counts,new}'='0'::jsonb and run_row->>'execution_report_status'='failed'
    and run_row->'backlog_candidates'='1'::jsonb and run_row->'backlog_omitted'='2'::jsonb and run_row->'backlog_overflow'='true'::jsonb,'Failed zero-result run looked like successful empty research';
  assert dashboard#>>'{preferences,suggestions,0,state}'='pending' and dashboard#>'{preferences,approved_rules}'='[]'::jsonb,'Suggestion became an approved rule without explicit action';
  r:=public.decide_opportunity_search_preference(search_a,suggestion,'approve',0,decision);
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);
  assert dashboard#>>'{preferences,suggestions,0,state}'='approved' and dashboard#>'{preferences,revision}'='1'::jsonb
    and dashboard#>'{queries,plan,queries,1,query}'='null'::jsonb and dashboard#>'{queries,plan,queries,1,withheld}'='true'::jsonb,'Explicit approval missing from separate preference layer';
  r:=public.decide_opportunity_search_preference(search_a,suggestion,'undo',1,gen_random_uuid());
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);assert dashboard#>>'{preferences,suggestions,0,state}'='undone','Undo not visible';
  r:=public.decide_opportunity_search_preference(search_a,suggestion,'reject',2,gen_random_uuid());
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);assert dashboard#>>'{preferences,suggestions,0,state}'='rejected','Reject not visible';
  r:=public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"adaptation_paused":true}','{"adaptation_revision":1}');
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);
  assert dashboard#>'{feedback_preview,counts,eligible}'='1'::jsonb and dashboard#>'{settings,adaptation_paused}'='true'::jsonb
    and jsonb_array_length(dashboard->'sources')=2 and dashboard#>>'{queries,plan,id}'=plan_id::text
    and dashboard#>'{queries,plan,queries,2,query}'='null'::jsonb and dashboard#>>'{queries,plan,queries,0,query}'='synthetic BCI opportunities','Pausing deleted underlying sources/history or retained outgoing adaptive examples';
  r:=public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"adaptation_enabled":false}','{"adaptation_revision":2}');
  assert r#>'{settings,adaptation_enabled}'='false'::jsonb,'Disabling learning did not persist';
  assert public.preview_opportunity_search_feedback(search_a)#>'{counts,eligible}'='1'::jsonb,'Disabling learning suppressed default outgoing feedback';
  again:=public.patch_opportunity_search_settings(search_a,consent_action,'{"adaptation_enabled":true}','{"adaptation_revision":0}');assert again=original,'Historical settings retry was rebased to current state';
  assert(select criteria=original_base and meta_search=original_meta and schedule=original_schedule and revision=original_revision from public.opportunity_search_templates where id=search_a),'Adaptive controls edited base criteria, task text, schedule, or base revision';
  assert(select context_json=original_application from public.applications where id=app_id),'Dashboard controls edited frozen application context';
  -- Public owner RPCs never need access to the private merge/runner schema.
  assert not has_function_privilege(current_user,'private.begin_adaptive_opportunity_search(uuid,uuid)','EXECUTE')
    and not has_function_privilege(current_user,'private.submit_adaptive_search_batch(uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege(current_user,'private.verify_and_complete_adaptive_search(uuid,jsonb)','EXECUTE'),'Dashboard widened technical runner privileges';
  blocked:=false;begin perform public.read_opportunity_search_dashboard(search_b,project);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner dashboard read another search';
  blocked:=false;begin perform public.opportunity_search_dashboard_outcomes(search_b,registry);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Direct outcome helper omitted its owner guard';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_b,gen_random_uuid(),'{"adaptation_enabled":true}','{"adaptation_revision":0}');exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner patched another search';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);
  blocked:=false;begin perform public.read_opportunity_search_dashboard(search_a,project);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Anonymous authenticated session read dashboard';
  blocked:=false;begin perform public.opportunity_search_dashboard_outcomes(search_a,registry);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Anonymous authenticated session read outcomes directly';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);
  assert not exists(select 1 from public.opportunity_search_dashboard_actions where user_id=owner_a),'Action receipts crossed owner RLS';
  execute 'reset role';
  -- Deterministic omission counts, with no invented pagination/content fetch.
  for n in 1..12 loop
    v_run:=gen_random_uuid();perform private.begin_opportunity_search(search_a,v_run);
    update public.opportunity_search_runs set status='complete',execution_report_status='unreported' where id=v_run;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  dashboard:=public.read_opportunity_search_dashboard(search_a,project);
  assert jsonb_array_length(dashboard->'runs')=10 and dashboard#>'{omitted,runs}'='4'::jsonb and octet_length(dashboard::text)<=262144,'Dashboard output bounds or omissions incorrect';
  assert dashboard#>'{bounds,maximum_feedback_bytes}'='65536'::jsonb and dashboard#>'{bounds,maximum_sources}'='64'::jsonb,'Declared dashboard bounds drifted';
  execute 'reset role';
end;
$$;
rollback;
