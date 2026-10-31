-- AF-07: synthetic metadata only; no production connection or schedule work.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();bad_search uuid:=gen_random_uuid();
  first_run uuid:=gen_random_uuid();next_run uuid:=gen_random_uuid();third_run uuid:=gen_random_uuid();oversized_run uuid:=gen_random_uuid();legacy_run uuid:=gen_random_uuid();bad_run uuid:=gen_random_uuid();target uuid:=gen_random_uuid();
  registry uuid:=gen_random_uuid();query_id_value uuid:=gen_random_uuid();adaptive_id uuid:=gen_random_uuid();anchor uuid;protocol text;proof public.opportunity_reviews;
  packet jsonb;result jsonb;again jsonb;doc jsonb;cache_original jsonb;tainted jsonb;before_count integer;before_schedules integer;blocked boolean;n integer;rev integer;
  project text:='aaaaaaaaaaaaaaaaaaaa';schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values
    (search_a,owner_a,'Synthetic startup','{"topicsAndMethods":"Acoustics; BCI","fundingAndConditions":"Start 2027-01-01; EUR 60000 annually"}',schedule,
      '{"version":1,"active":true,"editor":{"privateArchive":"EDITOR_CANARY_CONTACT"},"systemPrompt":"SYSTEM_PROMPT_CANARY","userPrompt":"USER_ARCHIVE_CANARY","recurringPrompt":"TASK_CANARY"}'),
    (search_b,owner_b,'Synthetic other owner','{"topicsAndMethods":"Synthetic research"}',schedule,null),
    (bad_search,owner_a,'Synthetic retired archive','{"topicsAndMethods":"BCI","fitAndExclusions":"CV Harness meta-search context v1\n{\"contacts\":[{\"name\":\"LEGACY_CANARY\"}]}"}',schedule,null);
  result:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert result#>>'{error,code}'='runner_disabled','Release did not default disabled';
  update public.opportunity_search_adaptive_release set project_ref=project,enabled=true where singleton;
  result:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert result#>>'{error,code}'='authorization_revoked','Search UUID possession silently authorized a runner';
  blocked:=false;begin insert into public.opportunity_search_runner_authorizations(user_id,search_id,project_ref,enabled) values(owner_a,search_a,project,true);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Management manufactured human owner authorization';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  result:=public.set_opportunity_search_runner_authorization(search_a,project,true,0);
  assert result=public.set_opportunity_search_runner_authorization(search_a,project,true,0),'Lost owner authorization response was not idempotent';
  perform public.set_opportunity_search_runner_authorization(bad_search,project,true,0);
  perform public.save_opportunity_search_adaptation(search_a,true,false,0);
  perform public.save_opportunity_search_source(search_a,registry,'{"listing_url":"https://example.invalid/ResearchJobs","enabled":true,"pinned":true}');
  execute 'reset role';
  insert into public.opportunities(id,opportunity_key,title,topics) values(target,'af07-'||target,'Synthetic acoustic research',array['Acoustics']);
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values(owner_a,target,'strong_interest','PRIVATE_COMMENT_CANARY person@example.invalid');
  execute 'set local role authenticated';perform public.save_opportunity_comment(target,'Prefer acoustic interface prototypes.');execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  perform private.begin_opportunity_search(search_a,legacy_run);
  result:=private.save_opportunity_search_queries(legacy_run,'[{"query":"synthetic protected acoustic core"}]');anchor:=(result->>'id')::uuid;
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(
    jsonb_build_object('query_id',query_id_value,'query','synthetic protected acoustic core','text_hash',encode(sha256(convert_to('synthetic protected acoustic core','UTF8')),'hex'),'role','core','manual',true,'source_registry_id',registry),
    jsonb_build_object('query_id',adaptive_id,'query','adaptive acoustic interface preference','text_hash',encode(sha256(convert_to('adaptive acoustic interface preference','UTF8')),'hex'),'role','adaptive','manual',false),jsonb_build_object('query_id',gen_random_uuid(),'query','synthetic adjacent research exploration','text_hash',encode(sha256(convert_to('synthetic adjacent research exploration','UTF8')),'hex'),'role','exploration','manual',false)));
  perform private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,1,(packet->>'feedback_revision')::bigint,0,protocol);
  result:=private.begin_adaptive_opportunity_search(search_a,legacy_run);
  assert result#>>'{error,code}'='scope_unavailable','An existing legacy run was silently adopted';
  result:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert result#>>'{error,code}'='run_in_progress','A running legacy search was ignored during activation';
  perform private.complete_opportunity_search(legacy_run,'{"status":"failed","notes":"Synthetic query seed only; no research was executed.","unresolvedCount":0}');
  result:=private.begin_adaptive_opportunity_search(bad_search,bad_run);
  assert result#>>'{error,code}'='setup_conversion_required' and result::text!~'LEGACY_CANARY','Retired criteria archive escaped or was silently used';
  assert not exists(select 1 from public.opportunity_search_runs where id=bad_run),'Failed setup left an orphan run';
  select count(*) into before_count from public.opportunities;select count(*) into before_schedules from public.opportunity_search_schedule_bindings;
  result:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert result->'compatible'='true'::jsonb and result->'adaptive_contract_version'='1'::jsonb,'Complete startup failed';
  assert result#>'{capabilities,batch}'='true'::jsonb and result#>'{capabilities,completion}'='true'::jsonb,'Current startup omitted installed batch/finalization capability';
  assert jsonb_array_length(result->'source_context')=8 and result#>'{planning,allocation,source_obligations}'='8'::jsonb,'Complete source context/obligations missing';
  assert result::text!~'CANARY|person@example.invalid|systemPrompt|context_json','Nested private/editor content escaped startup';
  assert octet_length(result::text)<=262144 and octet_length((result->'feedback')::text)<=65536,'Startup exceeded its envelope';
  assert (select count(*) from public.opportunities)=before_count and(select count(*) from public.opportunity_search_schedule_bindings)=before_schedules,'Startup wrote opportunities or schedules';
  assert not exists(select 1 from private.opportunity_search_adaptive_contexts c cross join lateral jsonb_array_elements(c.bundle#>'{feedback,examples}') e where c.run_id=first_run and e?'search_feedback_summary'),'Cached approved summary plaintext twice';
  select bundle into cache_original from private.opportunity_search_adaptive_contexts where run_id=first_run;
  foreach tainted in array array[
    cache_original-'base',cache_original-'preferences',
    cache_original||'{"compatible":false}'::jsonb,
    jsonb_set(cache_original,'{feedback,counts,eligible}','{"contacts":"CACHE_CANARY"}'),
    jsonb_set(cache_original,'{planning,policy,maximum_queries}','{"private":"CACHE_CANARY"}'),
    jsonb_set(cache_original,'{planning,approved_rules}',jsonb_build_array(jsonb_build_object('rule_id',gen_random_uuid(),'kind','emphasis','category','topic','polarity','positive','target','BCI','evidence_refs','[{"contacts":"CACHE_CANARY"}]'::jsonb))),
    jsonb_set(cache_original,'{query_plan,document,queries,0,raw_snapshot}','{"contacts":"CACHE_CANARY"}'),
    jsonb_set(cache_original,'{due_sources,0,contacts}','{"name":"CACHE_CANARY"}'),
    jsonb_set(cache_original,'{lease,expires_at}','{"private":"CACHE_CANARY"}')
  ] loop
    update private.opportunity_search_adaptive_contexts set bundle=tainted,bundle_hash=encode(sha256(convert_to(tainted::text,'UTF8')),'hex') where run_id=first_run;
    again:=private.begin_adaptive_opportunity_search(search_a,first_run);
    assert again#>>'{error,code}'='invalid_bundle' and again::text!~'CACHE_CANARY','A nested malformed cache value escaped despite a recomputed hash';
  end loop;
  update private.opportunity_search_adaptive_contexts set bundle=cache_original,bundle_hash=encode(sha256(convert_to(cache_original::text,'UTF8')),'hex') where run_id=first_run;
  again:=private.begin_adaptive_opportunity_search(search_a,first_run);assert result=again,'Same-run retry changed frozen bundle';
  again:=private.begin_adaptive_opportunity_search(search_a,next_run);assert again#>>'{error,code}'='run_in_progress','Overlapping run acquired another active lease';
  execute 'set local role authenticated';perform public.review_job_opportunity(target,null,'not_interested');execute 'reset role';
  again:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert again#>>'{feedback,feedback_revision}'=result#>>'{feedback,feedback_revision}','Ordinary new feedback rebased an active run';
  execute 'set local role authenticated';perform public.save_opportunity_feedback(target,'{"feedback_excluded":true}');execute 'reset role';
  again:=private.begin_adaptive_opportunity_search(search_a,first_run);
  assert again#>'{refresh,privacy_scope_changed}'='true'::jsonb and again::text!~'Prefer acoustic interface prototypes|adaptive acoustic interface preference',
    'Revoked text survived through feedback or old adaptive query prose';
  assert again#>>'{query_plan,document,queries,0,query}'='synthetic protected acoustic core','Privacy revocation erased safe protected core';
  update public.opportunity_search_runs set status='complete' where id=first_run;
  again:=private.begin_adaptive_opportunity_search(search_a,next_run);assert again->'compatible'='true'::jsonb and again#>>'{feedback,feedback_revision}'<>result#>>'{feedback,feedback_revision}','Next run failed to see latest committed feedback';
  perform private.record_opportunity_search_execution(next_run,gen_random_uuid(),jsonb_build_object('checks',jsonb_build_array(jsonb_build_object(
    'check_id',gen_random_uuid(),'kind','source','source_registry_id',registry,'attempted_at',clock_timestamp(),'status','complete','results_count',0))));
  update private.opportunity_search_adaptive_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=next_run;
  again:=private.begin_adaptive_opportunity_search(search_a,third_run);
  assert again->'compatible'='true'::jsonb and(select status='failed' and execution_report_status='partial' from public.opportunity_search_runs where id=next_run)
    and(select count(*) from public.opportunity_search_executions where run_id=next_run)=1,'Expired lease lost progress, claimed empty success, or blocked a new run';
  -- Direct cache tampering fails before exposing even a known safe field.
  update private.opportunity_search_adaptive_contexts set bundle=bundle||'{"contacts":{"name":"CACHE_CANARY"}}' where run_id=next_run;
  again:=private.begin_adaptive_opportunity_search(search_a,next_run);
  assert again#>>'{error,code}'='invalid_bundle' and again::text!~'CACHE_CANARY','Cached nested data bypassed closed projection/integrity';
  update public.opportunity_search_runs set status='complete' where id=third_run;
  execute 'set local role authenticated';
  for n in 1..65 loop perform public.save_opportunity_search_source(search_a,gen_random_uuid(),jsonb_build_object('listing_url','https://example.invalid/Jobs/'||n,'enabled',true,'mandatory',true));end loop;
  execute 'reset role';
  again:=private.begin_adaptive_opportunity_search(search_a,oversized_run);
  assert again#>>'{error,code}'='scope_oversized' and not exists(select 1 from public.opportunity_search_runs where id=oversized_run),'Oversized required-source scope was silently truncated or left an orphan run';
  execute 'set local role authenticated';perform public.set_opportunity_search_runner_authorization(search_a,project,false,1);execute 'reset role';
  again:=private.begin_adaptive_opportunity_search(search_a,first_run);assert again#>>'{error,code}'='authorization_revoked','Revoked owner authorization still returned context';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  assert not exists(select 1 from public.opportunity_search_runner_authorizations where user_id=owner_a),'Other owner read runner authorization';
  blocked:=false;begin perform public.set_opportunity_search_runner_authorization(search_a,project,true,0);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Other owner authorized a private search';
  assert not has_function_privilege(current_user,'private.begin_adaptive_opportunity_search(uuid,uuid)','EXECUTE'),'Browser received administrative startup execution';
  assert not has_table_privilege(current_user,'private.opportunity_search_adaptive_contexts','SELECT'),'Browser could read cached startup context';
  execute 'reset role';
end;
$$;
do $$begin
  assert private.opportunity_search_adaptive_text('Start 2027-01-01; EUR 60000 annually; € 50000–60000',12000),'Legitimate funding/date facts rejected';
  assert not private.opportunity_search_adaptive_text('€1234567890123',12000),'Currency mask hid an oversized numeric token';
  assert not private.opportunity_search_adaptive_text('+2026-10-29-12345',12000),'Date mask hid a phone-like numeric chain';
end;$$;
rollback;
