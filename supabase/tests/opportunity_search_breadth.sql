-- Synthetic owner controls and allocation only; never production or scheduled tasks.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  action uuid:=gen_random_uuid();r jsonb;again jsonb;before_row public.opportunity_search_adaptive_settings;after_row public.opportunity_search_adaptive_settings;
  policy jsonb;capacity jsonb;blocked boolean;percent integer;protocol text;anchor uuid;doc jsonb;legacy_run uuid:=gen_random_uuid();base_before jsonb;meta_before jsonb;schedule_before jsonb;
  project text:='bbbbbbbbbbbbbbbbbbbb';cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search) values
    (search_a,owner_a,'Synthetic breadth','{"topicsAndMethods":"Acoustics; BCI"}',cadence,'{"version":1,"active":true,"editor":{"private":"BREADTH_PRIVATE_CANARY"},"systemPrompt":"Synthetic system","userPrompt":"Synthetic user","recurringPrompt":"Synthetic task"}'),
    (search_b,owner_b,'Other breadth','{"topicsAndMethods":"OTHER_PRIVATE_CANARY"}',cadence,null);
  select t.criteria,t.meta_search,t.schedule into base_before,meta_before,schedule_before from public.opportunity_search_templates t where id=search_a;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  r:=public.read_opportunity_search_dashboard(search_a,project);
  assert r#>'{settings,search_breadth_percent}'='20'::jsonb and r#>'{settings,breadth_revision}'='0'::jsonb,'Missing breadth default';
  assert r->'planning_capacity'='null'::jsonb,'Cold capacity was invented';
  assert r#>>'{policy,policy_version}'='adaptive-query-v3' and r#>'{policy,exploration_ratio}'='0.2'::jsonb,'Current policy did not use saved default';
  assert not(r::text~'BREADTH_PRIVATE_CANARY|OTHER_PRIVATE_CANARY'),'Breadth response leaked private editor data';
  r:=public.patch_opportunity_search_settings(search_a,action,'{"search_breadth_percent":70}','{"breadth_revision":0}');
  again:=public.patch_opportunity_search_settings(search_a,action,'{"search_breadth_percent":70}','{"breadth_revision":0}');
  assert r=again and r#>'{settings,breadth_revision}'='1'::jsonb,'Exact breadth retry changed receipt/revision';
  assert r#>'{settings,adaptation_enabled}'='false'::jsonb and r#>'{settings,adaptation_revision}'='0'::jsonb,'Breadth implied adaptation';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"search_breadth_percent":80}','{"breadth_revision":0}');exception when serialization_failure then blocked:=true;end;
  assert blocked,'Stale breadth update overwrote current setting';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,action,'{"search_breadth_percent":80}','{"breadth_revision":0}');exception when serialization_failure then blocked:=true;end;
  assert blocked,'Action identity accepted a changed breadth body';
  foreach percent in array array[-5,3,101] loop
    blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),jsonb_build_object('search_breadth_percent',percent),'{"breadth_revision":1}');exception when invalid_parameter_value then blocked:=true;end;
    assert blocked,'Invalid breadth passed';
  end loop;
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"search_breadth_percent":30.5}','{"breadth_revision":1}');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Fractional breadth passed';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"search_breadth_percent":null}','{"breadth_revision":1}');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Null breadth passed';
  -- Breadth has its own CAS axis, so consent and adaptation can use their
  -- unchanged original revisions even after the breadth change.
  perform public.patch_opportunity_search_settings(search_a,gen_random_uuid(),'{"adaptation_enabled":true}','{"adaptation_revision":0}');
  execute 'reset role';
  perform private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  update public.opportunity_search_adaptive_settings set query_plan_dirty=false where user_id=owner_a and search_id=search_a;
  select * into before_row from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a;
  execute 'set local role authenticated';
  -- Direct owner UPDATEs cannot forge the revision. They retain all existing
  -- table guards; only changed breadth marks the query plan dirty.
  update public.opportunity_search_adaptive_settings set search_breadth_percent=50,breadth_revision=999,query_plan_dirty=false where user_id=owner_a and search_id=search_a;
  select * into after_row from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a;
  assert after_row.breadth_revision=before_row.breadth_revision+1 and after_row.query_plan_dirty,'Direct update bypassed breadth derivation';
  assert (after_row.feedback_revision,after_row.feedback_input_fingerprint,after_row.feedback_dirty,after_row.adaptation_revision,after_row.source_reuse_revision)
    is not distinct from(before_row.feedback_revision,before_row.feedback_input_fingerprint,before_row.feedback_dirty,before_row.adaptation_revision,before_row.source_reuse_revision),'Breadth invalidated feedback/adaptation/source evidence';
  update public.opportunity_search_adaptive_settings set search_breadth_percent=50,breadth_revision=999,query_plan_dirty=false where user_id=owner_a and search_id=search_a;
  assert(select breadth_revision=after_row.breadth_revision from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a),'No-op advanced breadth revision';
  action:=gen_random_uuid();
  insert into public.opportunity_search_dashboard_actions(user_id,search_id,action_id,kind,patch,expected_revisions,result)
    values(owner_a,search_a,action,'settings','{"search_breadth_percent":100}',jsonb_build_object('breadth_revision',after_row.breadth_revision),'{"PRIVATE_CANARY":"forged receipt"}');
  r:=public.patch_opportunity_search_settings(search_a,action,'{"search_breadth_percent":100}',jsonb_build_object('breadth_revision',after_row.breadth_revision));
  assert r::text!~'PRIVATE_CANARY' and r#>'{settings,search_breadth_percent}'='100'::jsonb,'Direct action INSERT bypassed guard';
  blocked:=false;begin perform public.read_opportunity_search_dashboard(search_b,project);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Cross-owner dashboard accepted';
  blocked:=false;begin perform public.opportunity_search_planning_capacity(owner_b,search_b);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Cross-owner capacity accepted';
  blocked:=false;begin perform public.patch_opportunity_search_settings(search_b,gen_random_uuid(),'{"search_breadth_percent":100}','{"breadth_revision":0}');exception when insufficient_privilege then blocked:=true;end;assert blocked,'Cross-owner patch accepted';
  execute 'reset role';
  for percent in 0..20 loop
    policy:=public.opportunity_search_adaptation_policy(percent*5);
    assert policy#>>'{policy_version}'='adaptive-query-v3' and (policy->>'exploration_ratio')::numeric=percent::numeric/20,'Policy ratio differs';
    assert private.opportunity_search_adaptive_shape('policy',policy),'Generated v2 policy rejected by startup';
    assert not private.opportunity_search_adaptive_shape('policy',policy||'{"exploration_guidance":"forged instruction"}'),'Forged guidance passed';
  end loop;
  assert private.opportunity_search_adaptive_shape('policy',public.opportunity_search_adaptation_policy()),'Historical v1 policy rejected';
  -- Saved current canonical core anchors provide exact capacity, including
  -- completely full core allocation; source checks never consume these slots.
  perform private.begin_opportunity_search(search_a,legacy_run);
  r:=private.save_opportunity_search_queries(legacy_run,'[{"query":"synthetic protected breadth core"}]');anchor:=(r->>'id')::uuid;
  execute 'set local role authenticated';capacity:=public.opportunity_search_planning_capacity(owner_a,search_a);execute 'reset role';
  assert capacity='{"core_queries":1,"discretionary":29}'::jsonb,'Current legacy core anchor capacity missing';
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(
    jsonb_build_object('query_id',gen_random_uuid(),'query','synthetic protected breadth core','text_hash',encode(sha256(convert_to('synthetic protected breadth core','UTF8')),'hex'),'role','core','manual',false),
    jsonb_build_object('query_id',gen_random_uuid(),'query','synthetic narrow adaptive role','text_hash',encode(sha256(convert_to('synthetic narrow adaptive role','UTF8')),'hex'),'role','adaptive','manual',false)));
  blocked:=false;begin perform private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,1,after_row.feedback_revision,0,protocol);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Direct publisher accepted an active plan below its 100 percent exploration quota';

  perform private.complete_opportunity_search(legacy_run,'{"status":"failed","notes":"Synthetic seed only","unresolvedCount":0}');
  assert(select criteria=base_before and meta_search=meta_before and schedule=schedule_before from public.opportunity_search_templates where id=search_a),'Breadth changed base/editor/cadence';
  assert not exists(select 1 from public.opportunity_search_schedule_bindings where search_id=search_a),'Breadth created a task binding';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',true)::text,true);execute 'set local role authenticated';
  blocked:=false;begin perform public.read_opportunity_search_dashboard(search_a,project);exception when insufficient_privilege then blocked:=true;end;assert blocked,'Anonymous owner accepted';
  execute 'reset role';
end;
$$;
rollback;
