-- Current owner feedback preview is the exact outgoing projection; no disclosure approval API.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
 opportunity uuid:=gen_random_uuid();application uuid:=gen_random_uuid();preview jsonb;packet jsonb;before_catalogue jsonb;before_application jsonb;blocked boolean;
 cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
 insert into auth.users(id) values(owner_a),(owner_b);
 insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
 (search_a,owner_a,'Synthetic preview','{"topicsAndMethods":"BCI"}',cadence),(search_b,owner_b,'Other preview','{"topicsAndMethods":"Acoustics"}',cadence);
 insert into public.opportunities(id,opportunity_key,title,institution,topics,contacts) values(opportunity,'preview-'||opportunity,'Synthetic sensing research',
 'Synthetic Institute',array['BCI'],'[{"name":"Hidden Person","email":"person@example.invalid","roles":["contact"],"entity_id":"hidden-person"}]');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
 perform public.review_job_opportunity(opportunity,null,'very_high_interest');
 perform public.save_opportunity_comment(opportunity,'Prefer practical sensing and hardware evaluation.');
 perform public.create_job_application(application,opportunity);
 update public.applications set notes='APPLICATION_PRIVATE_CANARY' where id=application;execute 'reset role';
 select to_jsonb(o) into before_catalogue from public.opportunities o where id=opportunity;
 select to_jsonb(a) into before_application from public.applications a where id=application;
 execute 'set local role authenticated';preview:=public.preview_opportunity_search_feedback(search_a);
 assert preview=public.build_opportunity_search_feedback(owner_a,search_a),'Preview differs from public outgoing builder';
 assert preview#>'{counts,eligible}'='1'::jsonb and preview#>'{counts,application}'='1'::jsonb,'Current application evidence missing';
 assert preview#>>'{examples,0,search_feedback_summary}'='Prefer practical sensing and hardware evaluation.','Safe full evaluation was not projected';
 assert preview::text!~'person@example.invalid|Hidden Person|APPLICATION_PRIVATE_CANARY|"contacts"|"context_json"','Preview leaked private source fields';
 assert octet_length(preview::text)<=65536,'Preview exceeded declared outgoing bound';
 blocked:=false;begin perform public.build_opportunity_search_feedback(owner_b,search_b);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Cross-owner builder accepted';
 blocked:=false;begin perform public.preview_opportunity_search_feedback(search_b);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Cross-owner preview accepted';
 assert not has_function_privilege(current_user,'private.compile_opportunity_feedback_snapshot(uuid,uuid)','EXECUTE')
 and not has_table_privilege(current_user,'private.opportunity_search_merge_audit','SELECT'),'Preview widened private grants';
 execute 'reset role';packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);assert preview=packet,'Preview differs from persisted snapshot';
 execute 'set local role authenticated';perform public.save_opportunity_search_adaptation(search_a,true,false,0);
 perform public.save_opportunity_search_adaptation(search_a,true,true,1);
 assert public.preview_opportunity_search_feedback(search_a)#>'{counts,eligible}'='1'::jsonb,'Pausing learning suppressed default outgoing feedback';
 perform public.save_opportunity_feedback(opportunity,'{"feedback_excluded":true}');
 assert public.preview_opportunity_search_feedback(search_a)#>'{counts,eligible}'='0'::jsonb,'Per-opportunity exclusion was ignored';
 execute 'reset role';
 assert before_catalogue=(select to_jsonb(o) from public.opportunities o where id=opportunity)
 and before_application=(select to_jsonb(a) from public.applications a where id=application),'Preview/control mutated research or frozen application';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);execute 'set local role authenticated';
 blocked:=false;begin perform public.preview_opportunity_search_feedback(search_a);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Anonymous authenticated preview accepted';
 execute 'reset role';
 assert to_regprocedure('public.approve_opportunity_feedback_summary(uuid,text,text,bigint)') is null,'Retired text approval API remains';
end $$;
rollback;
