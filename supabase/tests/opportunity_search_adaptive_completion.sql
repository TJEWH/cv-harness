-- AF-08: isolated synthetic completion/verification cases only.
begin;

create function pg_temp.af08_completion_case(p_label text,p_item boolean default true,p_status text default 'complete',p_backlog boolean default false,p_source boolean default false,p_reuse boolean default false) returns jsonb
language plpgsql as $$
declare actor uuid:=gen_random_uuid();search_uuid uuid:=gen_random_uuid();run_uuid uuid:=gen_random_uuid();batch_uuid uuid:=gen_random_uuid();
  item_uuid uuid:=gen_random_uuid();query_uuid uuid:=gen_random_uuid();check_uuid uuid:=gen_random_uuid();opportunity_uuid uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();explore_uuid uuid:=gen_random_uuid();
  query_text text:='synthetic completion research '||p_label;at_time timestamptz:=clock_timestamp();payload jsonb;result jsonb;opportunity jsonb;checks jsonb;items jsonb:='[]';
  seed_run uuid:=gen_random_uuid();seed_item uuid:=gen_random_uuid();seed_payload jsonb;
begin
  insert into auth.users(id) values(actor);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(search_uuid,actor,'Synthetic completion '||p_label,
    '{"topicsAndMethods":"Acoustics"}','{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  update public.opportunity_search_adaptive_release set project_ref='bbbbbbbbbbbbbbbbbbbb',enabled=true,
    capability_version=private.opportunity_search_adaptive_capabilities()->>'capability_version' where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization(search_uuid,'bbbbbbbbbbbbbbbbbbbb',true,0);
  if p_reuse then
    perform public.save_opportunity_search_adaptation(search_uuid,true,false,0);
    perform public.set_opportunity_source_reuse(search_uuid,true,168);
  end if;
  if p_source then perform public.save_opportunity_search_source(search_uuid,registry,'{"listing_url":"https://example.invalid/CompletionJobs","enabled":true}');end if;
  execute 'reset role';
  if p_item then
    -- Genuine canonical state is established by the installed writer. Direct
    -- catalogue inserts intentionally lack effective field evidence in v5.
    perform private.begin_opportunity_search(search_uuid,seed_run);
    perform private.save_opportunity_search_queries(seed_run,jsonb_build_array(jsonb_build_object('query',query_text)));
    seed_payload:=jsonb_build_object('opportunity_key','af08-completion-'||search_uuid,'title','Synthetic existing research',
      'contacts','[{"name":"PRIVATE_COMPLETION_CANARY","email":"private.person@example.invalid","roles":["contact"],"entity_id":"private-completion-canary"}]'::jsonb,
      'last_checked_at',clock_timestamp(),'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/'||search_uuid,
        'kind','official','checked_at',clock_timestamp(),'precision','instant','supports',jsonb_build_array('title','contacts'))));
    result:=private.submit_opportunity_search_result(seed_run,seed_item,seed_payload);opportunity_uuid:=(result->>'opportunity_id')::uuid;
    perform private.verify_opportunity_search_result(seed_run,seed_item);
    perform private.complete_opportunity_search(seed_run,'{"status":"failed","notes":"Synthetic canonical fixture seed only; no research execution","unresolvedCount":0}');
    insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values(actor,opportunity_uuid,'strong_interest','PRIVATE_REVIEW_CANARY private.person@example.invalid');
  end if;
  result:=private.begin_adaptive_opportunity_search(search_uuid,run_uuid);
  assert result->'compatible'='true'::jsonb,'Synthetic completion startup unavailable';
  at_time:=clock_timestamp();
  if p_item then
    opportunity:=jsonb_build_object('opportunity_key','af08-completion-'||search_uuid,'title','Synthetic verified completion research',
      'official_url','https://example.invalid/Vacancy/'||search_uuid,'last_checked_at',clock_timestamp(),
      'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/'||search_uuid,'kind','official','checked_at',clock_timestamp(),
        'precision','instant','supports',jsonb_build_array('title','official_url'))));
    if p_reuse then opportunity:=jsonb_set(opportunity,'{sources}',opportunity->'sources'||jsonb_build_array(jsonb_build_object(
      'url','https://example.invalid/CompletionJobs','kind','official_listing','checked_at',clock_timestamp(),'precision','instant','supports',jsonb_build_array('title'))));end if;
    items:=jsonb_build_array(jsonb_build_object('item_id',item_uuid,'opportunity',opportunity,'attribution',jsonb_build_object('execution_refs',jsonb_build_array(check_uuid),'discovered_at',clock_timestamp()))
      ||case when p_reuse then jsonb_build_object('reusable_source',jsonb_build_object('listing_url','https://example.invalid/CompletionJobs','registry_id',registry)) else '{}'::jsonb end);
  end if;
  checks:=jsonb_build_array(jsonb_build_object('check_id',check_uuid,'kind','query','query_id',query_uuid,
    'text_hash',encode(sha256(convert_to(query_text,'UTF8')),'hex'),'attempted_at',at_time,'status',p_status,
    'results_count',case when p_item then 1 else 0 end));
  if p_source then checks:=checks||jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','source','source_registry_id',registry,
    'attempted_at',at_time,'status','complete','results_count',0));end if;
  checks:=checks||coalesce((select jsonb_agg(jsonb_build_object('check_id',gen_random_uuid(),'kind','source',
    'source_registry_id',source->>'registry_id','attempted_at',at_time,'status','complete','results_count',0))
    from jsonb_array_elements(result->'due_sources') source where source->>'registry_id'<>registry::text),'[]'::jsonb);
  if p_reuse then checks:=checks||jsonb_build_array(jsonb_build_object('check_id',gen_random_uuid(),'kind','query','query_id',explore_uuid,
    'text_hash',encode(sha256(convert_to('synthetic retention exploration','UTF8')),'hex'),'attempted_at',at_time,'status','complete','results_count',0));end if;
  payload:=jsonb_build_object('schema_version',1,'query_plan',jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object(
    'query_id',query_uuid,'query',query_text,'role','core','manual',false)||case when p_source then jsonb_build_object('source_registry_id',registry) else '{}'::jsonb end)), 'opportunities',items,
    'execution',jsonb_build_object('checks',checks,'complete',true,'backlog',case when p_backlog then jsonb_build_array(jsonb_build_object(
      'candidate_id',gen_random_uuid(),'url','https://example.invalid/Pending','reason','needs_verification')) else '[]'::jsonb end));
  if p_reuse then payload:=jsonb_set(payload,'{query_plan,queries}',payload#>'{query_plan,queries}'||jsonb_build_array(jsonb_build_object(
    'query_id',explore_uuid,'query','synthetic retention exploration','role','exploration','manual',false)));end if;
  result:=private.submit_adaptive_search_batch(run_uuid,batch_uuid,payload);
  assert result->'batch_schema_version'='1'::jsonb and not(result?'error') and result->'verification_required'='true'::jsonb,'Synthetic batch unavailable';
  if p_item then
    assert exists(select 1 from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_uuid),
      'Synthetic canonical item unavailable; safe batch receipt: '||result::text;
  end if;
  return jsonb_build_object('user_id',actor,'search_id',search_uuid,'run_id',run_uuid,'batch_id',batch_uuid,'item_id',item_uuid,'opportunity_id',opportunity_uuid,'source_registry_id',registry,
    'completion',jsonb_build_object('schema_version',1,'completion_id',gen_random_uuid(),'batch_ids',jsonb_build_array(batch_uuid),
      'manifest_hash',private.opportunity_search_adaptive_manifest(run_uuid)->>'manifest_hash','status','complete'));
end;
$$;

do $$
declare fixture jsonb;other jsonb;result jsonb;again jsonb;historical jsonb;payload jsonb;run_uuid uuid;item_uuid uuid;opportunity_uuid uuid;
  before_summary jsonb;before_receipts integer;before_execution integer;blocked boolean;variant text;
begin
  fixture:=pg_temp.af08_completion_case('normal');run_uuid:=(fixture->>'run_id')::uuid;item_uuid:=(fixture->>'item_id')::uuid;opportunity_uuid:=(fixture->>'opportunity_id')::uuid;
  assert exists(select 1 from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_uuid and verified_at is null),'Intake claimed separate verification';
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result->'compatible'='true'::jsonb and result#>>'{historical_summary,status}'='complete' and result#>'{historical_summary,incomplete}'='false'::jsonb,'Complete actual coverage failed';
  assert result#>'{current_verification,all_saved_items_verified}'='true'::jsonb and result#>'{current_verification,verified_items}'='1'::jsonb
    and result->'persisted_summary_read'='true'::jsonb,'A separate persisted verification/read was missing';
  assert result::text!~'CANARY|private.person|snapshot|effective_fields|field_decisions|"contacts"|"comment"','Private verification values escaped';
  assert result->>'delivery_status'='unknown' and result#>>'{historical_summary,delivery_status}'='unknown','Completion claimed delivery';
  historical:=result->'historical_summary';select summary into before_summary from public.opportunity_search_runs where id=run_uuid;
  select count(*) into before_receipts from private.opportunity_search_adaptive_completions where run_id=run_uuid;
  select count(*) into before_execution from public.opportunity_search_executions where run_id=run_uuid;
  again:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');assert again=result,'Lost final response was not idempotent';
  assert(select count(*) from private.opportunity_search_adaptive_completions where run_id=run_uuid)=before_receipts
    and(select count(*) from public.opportunity_search_executions where run_id=run_uuid)=before_execution,'Completion retry duplicated logs';
  again:=private.verify_and_complete_adaptive_search(run_uuid,(fixture->'completion')||'{"status":"failed"}');
  assert again#>>'{error,code}'='completion_payload_mismatch','Changed completion body reused a stable ID';
  -- A later current change must not reuse the historical verified:true claim.
  update public.opportunities set title='Synthetic subsequent canonical change' where id=opportunity_uuid;
  again:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert again#>'{current_verification,changed_since_save_items}'='1'::jsonb and again#>'{current_verification,all_saved_items_verified}'='false'::jsonb,'Terminal retry hid a subsequent canonical change';
  assert again->'historical_summary'=historical and(select summary from public.opportunity_search_runs where id=run_uuid)=before_summary,'Fresh verification rewrote historical completion';
  update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where run_id=run_uuid and item_id=item_uuid;
  again:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert again#>'{current_verification,rolled_back_items}'='1'::jsonb and again#>'{current_verification,all_saved_items_verified}'='false'::jsonb,'Terminal retry hid rollback';
  assert again->'historical_summary'=historical,'Rollback rewrote original completion receipt';

  fixture:=pg_temp.af08_completion_case('empty',false);result:=private.verify_and_complete_adaptive_search((fixture->>'run_id')::uuid,fixture->'completion');
  assert result#>>'{historical_summary,status}'='complete' and result#>'{historical_summary,item_count}'='0'::jsonb
    and result#>'{historical_summary,batch_count}'='1'::jsonb,'Zero-result batch disappeared or became failure';
  foreach variant in array array['blocked','partial','backlog'] loop
    fixture:=pg_temp.af08_completion_case(variant,false,case when variant='backlog' then 'complete' else variant end,variant='backlog');
    result:=private.verify_and_complete_adaptive_search((fixture->>'run_id')::uuid,fixture->'completion');
    assert result#>>'{historical_summary,status}'='failed' and result#>'{historical_summary,incomplete}'='true'::jsonb,'Incomplete coverage became successful zero results';
  end loop;
  fixture:=pg_temp.af08_completion_case('missing');run_uuid:=(fixture->>'run_id')::uuid;item_uuid:=(fixture->>'item_id')::uuid;
  delete from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_uuid;
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result#>>'{historical_summary,status}'='failed' and result#>'{current_verification,missing_items}'='1'::jsonb,'Missing persisted receipt was verified';

  fixture:=pg_temp.af08_completion_case('expired');run_uuid:=(fixture->>'run_id')::uuid;
  update private.opportunity_search_adaptive_contexts set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=run_uuid;
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result->'compatible'='true'::jsonb and result#>>'{historical_summary,status}'='failed' and result#>'{current_verification,verified_items}'='1'::jsonb,
    'Expired lease lost verification-only partial progress or claimed complete';

  fixture:=pg_temp.af08_completion_case('protected-source',true,'complete',false,true);run_uuid:=(fixture->>'run_id')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'user_id','is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source((fixture->>'search_id')::uuid,(fixture->>'source_registry_id')::uuid,'{"enabled":false}');execute 'reset role';
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result#>>'{historical_summary,status}'='failed' and result#>'{historical_summary,coverage,protected_scope_revoked}'='true'::jsonb
    and result#>'{current_verification,verified_items}'='1'::jsonb,'Protected core scope completion failed; safe receipt: '||result::text;

  fixture:=pg_temp.af08_completion_case('retention-owner-edit',true,'complete',false,true,true);run_uuid:=(fixture->>'run_id')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'user_id','is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source((fixture->>'search_id')::uuid,(fixture->>'source_registry_id')::uuid,
    '{"listing_url":"https://example.invalid/OwnerUpdatedJobs"}');execute 'reset role';
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result->'compatible'='true'::jsonb and result#>'{current_verification,verified_items}'='1'::jsonb
    and result#>'{historical_summary,source_retention_deferred}'='1'::jsonb,'An owner-edited optional listing witness poisoned canonical verification/finalization';
  assert(select listing_url from public.opportunity_search_sources where registry_id=(fixture->>'source_registry_id')::uuid)='https://example.invalid/OwnerUpdatedJobs',
    'Optional retention overwrote the owner listing edit';
  again:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert again->'historical_summary'=result->'historical_summary','Retry repeated or rewrote a deferred retention action';

  fixture:=pg_temp.af08_completion_case('manifest',false);run_uuid:=(fixture->>'run_id')::uuid;
  result:=private.verify_and_complete_adaptive_search(run_uuid,jsonb_set(fixture->'completion','{batch_ids}','[]'));
  assert result#>>'{error,code}'='manifest_mismatch' and not exists(select 1 from private.opportunity_search_adaptive_completions where run_id=run_uuid),'Incomplete manifest finalized';
  result:=private.verify_and_complete_adaptive_search(run_uuid,(fixture->'completion')||jsonb_build_object('notes','PRIVATE_COMPLETION_CANARY private.person@example.invalid'));
  assert result#>>'{error,code}'='invalid_payload' and result::text!~'CANARY|private.person','Rejected payload leaked private notes';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'user_id','is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization((fixture->>'search_id')::uuid,'bbbbbbbbbbbbbbbbbbbb',false,1);execute 'reset role';
  result:=private.verify_and_complete_adaptive_search(run_uuid,fixture->'completion');
  assert result#>>'{error,code}'='authorization_revoked','Revoked human grant still allowed completion';
  assert not exists(select 1 from private.opportunity_search_adaptive_completions where run_id=run_uuid),'Security denial persisted a partial completion';
  execute 'set local role authenticated';
  assert not has_function_privilege(current_user,'private.verify_and_complete_adaptive_search(uuid,jsonb)','EXECUTE'),'Browser gained management completion';
  assert not has_table_privilege(current_user,'private.opportunity_search_adaptive_completions','SELECT'),'Browser could read private completion receipts';
  execute 'reset role';
end;
$$;
rollback;
