-- AF-11 release security/privacy/legacy-call acceptance. Synthetic and rolled back.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  old_run uuid:=gen_random_uuid();new_run uuid:=gen_random_uuid();old_item uuid:=gen_random_uuid();opportunity uuid;registry uuid:=gen_random_uuid();
  now_text text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');project text:='ssssssssssssssssssss';
  payload jsonb;result jsonb;packet jsonb;proof public.opportunity_reviews;relation text;scope_owner_count bigint;blocked boolean;legacy_definitions jsonb;
  public_tables text[]:=array['opportunity_search_adaptive_settings','opportunity_search_feedback_snapshots',
    'opportunity_search_sources','opportunity_search_query_plans','opportunity_search_executions','opportunity_search_execution_receipts',
    'opportunity_search_discoveries','opportunity_search_preference_suggestions','opportunity_search_preference_actions',
    'opportunity_search_runner_authorizations','opportunity_search_adaptive_proposals','opportunity_search_runner_config',
    'opportunity_search_setup_claims','opportunity_feedback_prediction_proofs','opportunity_search_dashboard_actions','opportunity_search_rollback_requests'];
  private_tables text[]:=array['opportunity_search_adaptive_contexts','opportunity_search_adaptive_batches','opportunity_search_adaptive_items',
    'opportunity_search_adaptive_completions','opportunity_search_setup_operations','opportunity_search_setup_acknowledgements'];
  cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  assert current_database()='adaptive_feedback_test','Only the isolated adaptive fixture is allowed';
  foreach relation in array public_tables loop
    assert(select c.relrowsecurity from pg_class c where c.oid=('public.'||relation)::regclass),'New public relation lacks RLS: '||relation;
    assert not has_table_privilege('anon','public.'||relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'Anonymous grant on adaptive relation: '||relation;
    assert not has_table_privilege('authenticated','public.'||relation,'TRUNCATE,REFERENCES,TRIGGER'),'Unneeded owner table privilege: '||relation;
    assert exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=relation
      and(coalesce(p.qual,'')||coalesce(p.with_check,'')) like '%auth.uid()%'
      and(coalesce(p.qual,'')||coalesce(p.with_check,'')) like '%is_anonymous%'),'Owner/nonanonymous policy missing: '||relation;
  end loop;
  foreach relation in array private_tables loop
    assert(select c.relrowsecurity from pg_class c where c.oid=('private.'||relation)::regclass),'New private relation lacks RLS: '||relation;
    assert not has_table_privilege('authenticated','private.'||relation,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('anon','private.'||relation,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('service_role','private.'||relation,'SELECT,INSERT,UPDATE,DELETE'),'Runtime grant on private log: '||relation;
  end loop;
  assert not has_sequence_privilege('anon','public.opportunity_search_preference_actions_sequence_seq','USAGE,SELECT,UPDATE'),'Anonymous preference sequence grant';
  assert(select relrowsecurity from pg_class where oid='public.opportunity_search_adaptive_release'::regclass),'Release flag lacks RLS';
  assert not has_table_privilege('authenticated','public.opportunity_search_adaptive_release','INSERT,UPDATE,DELETE'),'Owner can enable release';
  assert not has_function_privilege('authenticated','private.begin_adaptive_opportunity_search(uuid,uuid)','EXECUTE')
    and not has_function_privilege('service_role','private.submit_adaptive_search_batch(uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','private.ack_adaptive_search_rollback(uuid,uuid,jsonb)','EXECUTE'),'Management helper runtime grant';
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in('public','private')
    and(p.proname like '%adaptive_search%' or p.proname like '%opportunity_feedback%' or p.proname like '%opportunity_search_dashboard%')),'Adaptive definer helper found';

  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
    (search_a,owner_a,'AF11 legacy caller','{"topicsAndMethods":"Synthetic physical sensing"}',cadence),
    (search_b,owner_b,'AF11 isolated caller','{"topicsAndMethods":"Synthetic BCI"}',cadence);
  -- Fully upgraded deployment still supports the original separately verified
  -- canonical caller while adaptive release is disabled.
  result:=private.begin_opportunity_search(search_a,old_run);
  assert exists(select 1 from public.opportunity_search_runs r where r.id=old_run and r.adaptive_contract_version is null),'Old caller silently became adaptive';
  perform private.save_opportunity_search_queries(old_run,'[{"query":"synthetic physical sensing base"}]');
  payload:=jsonb_build_object('opportunity_key','af11-oldcaller-'||old_run,'title','Synthetic legacy caller research','official_url','https://example.invalid/Legacy/'||old_run,
    'personal_fit','{"score":8,"scale_min":0,"scale_max":10,"summary":"Synthetic technical alignment."}'::jsonb,
    'contacts','[{"name":"CONTACT_PRIVATE_CANARY","email":"contact@example.invalid","roles":["contact"],"entity_id":"contact-private-canary"}]'::jsonb,'last_checked_at',now_text,
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Legacy/'||old_run,'kind','official','checked_at',now_text,'precision','instant','supports','["title","official_url","personal_fit","contacts"]'::jsonb)));
  perform private.submit_opportunity_search_result(old_run,old_item,payload);
  perform private.verify_opportunity_search_result(old_run,old_item);
  perform private.complete_opportunity_search(old_run,'{"status":"complete","unresolvedCount":0,"notes":"Synthetic legacy caller, no web execution claimed."}');
  select r.opportunity_id into opportunity from public.opportunity_search_receipts r where r.run_id=old_run and r.item_id=old_item;
  assert exists(select 1 from public.opportunity_search_receipts r where r.run_id=old_run and r.verified_at is not null),'Old caller lost persistence verification';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_comment(opportunity,'COMMENT_PRIVATE_CANARY contact@example.invalid');
  perform public.review_job_opportunity(opportunity,null,'strong_interest');
  perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"adaptation_enabled":true}','{"adaptation_revision":0}');
  perform public.patch_opportunity_search_source(search_a,registry,gen_random_uuid(),'{"listing_url":"https://example.invalid/ReusableResearch","enabled":true,"pinned":true}',0);
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet::text not like '%Synthetic physical prototype evaluation.%' and packet::text!~'PRIVATE_CANARY|contact@example.invalid',
    'Default inclusion bypassed full-source safety because of a historical approval';
  execute 'set local role authenticated';
  perform public.save_opportunity_comment(opportunity,'Synthetic physical prototype evaluation.');
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet::text like '%Synthetic physical prototype evaluation.%' and packet::text like '%summary_inclusion%'
    and packet::text!~'PRIVATE_CANARY|contact@example.invalid','Default safe evaluation was omitted or leaked private evidence';
  update public.opportunity_search_adaptive_release set enabled=true,project_ref=project where singleton;
  execute 'set local role authenticated';perform public.set_opportunity_search_runner_authorization(search_a,project,true,0);execute 'reset role';
  result:=private.begin_adaptive_opportunity_search(search_a,new_run);
  assert result->'compatible'='true'::jsonb and result::text!~'CONTACT_PRIVATE_CANARY|COMMENT_PRIVATE_CANARY|contact@example.invalid','New caller leaked old caller contact payload';
  -- The shared per-opportunity exclusion eagerly redacts all old packets; a
  -- same-run retry cannot restore formerly included text from snapshot metadata.
  execute 'set local role authenticated';perform public.save_opportunity_feedback(opportunity,'{"feedback_excluded":true}');execute 'reset role';
  result:=private.begin_adaptive_opportunity_search(search_a,new_run);
  assert result::text not like '%Synthetic physical prototype evaluation.%','Excluded feedback survived same-run retry';
  assert not exists(select 1 from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and s.packet::text like '%Synthetic physical prototype evaluation.%'),'Excluded feedback survived direct cached packet read';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  foreach relation in array public_tables loop
    execute format('select count(*) from public.%I where user_id=$1',relation) into scope_owner_count using owner_a;
    assert scope_owner_count=0,'Cross-owner adaptive row visible: '||relation;
  end loop;
  blocked:=false;begin perform public.preview_opportunity_search_feedback(search_a);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner preview accepted another search';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);
  foreach relation in array public_tables loop
    execute format('select count(*) from public.%I where user_id=$1',relation) into scope_owner_count using owner_a;
    assert scope_owner_count=0,'Anonymous session saw adaptive metadata: '||relation;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  -- The baseline grants no browser search DELETE. Keep that boundary, then
  -- simulate the authorized management cleanup path for cascade verification.
  blocked:=false;begin delete from public.opportunity_search_templates t where t.user_id=owner_a and t.id=search_a;
  exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Release widened the existing search deletion permission';
  execute 'reset role';
  delete from public.opportunity_search_templates t where t.user_id=owner_a and t.id=search_a;
  foreach relation in array public_tables loop
    if relation in('opportunity_feedback_prediction_proofs') then continue;end if;
    execute format('select count(*) from public.%I where user_id=$1',relation) into scope_owner_count using owner_a;
    assert scope_owner_count=0,'Search/account scope cleanup retained adaptive rows: '||relation;
  end loop;
  assert not exists(select 1 from private.opportunity_search_adaptive_contexts where run_id=new_run),'Search deletion retained private run context';
  assert exists(select 1 from public.opportunities o where o.id=opportunity),'Feature/search cleanup deleted canonical research';
  assert exists(select 1 from public.opportunity_search_templates t where t.user_id=owner_b and t.id=search_b),'Cleanup affected another owner';
  -- Account-level approval/proof rows are independent of search settings and
  -- remain valid until their own owner is deleted. Simulate the normal admin
  -- account-deletion path; authenticated is never granted auth.users DELETE.
  delete from auth.users where id=owner_a;
  assert not exists(select 1 from public.opportunity_reviews where user_id=owner_a)
    and not exists(select 1 from public.opportunity_feedback_prediction_proofs where user_id=owner_a),'Account cleanup retained review/proof metadata';
end;
$$;
rollback;
