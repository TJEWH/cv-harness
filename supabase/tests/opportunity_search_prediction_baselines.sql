-- AF-05 baseline integration. Synthetic real canonical receipts/audits only.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();run_a uuid:=gen_random_uuid();
  items uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];opportunity_ids uuid[]:='{}';discoveries uuid[]:='{}';
  payload jsonb;reply jsonb;baseline jsonb;metric jsonb;projected jsonb;before_row public.opportunity_reviews;after_row public.opportunity_reviews;
  assessment_time timestamptz;submission_time timestamptz;application uuid:=gen_random_uuid();blocked boolean;affected integer;index integer;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(search_a,owner_a,'Synthetic assessment research',
    '{"topicsAndMethods":"Acoustic sensing research"}',
    '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  perform private.begin_opportunity_search(search_a,run_a);
  perform private.save_opportunity_search_queries(run_a,'[{"query":"synthetic acoustic research"}]');
  for index in 1..3 loop
    payload:=jsonb_build_object('opportunity_key','af05-baseline-'||items[index]::text,'title','Synthetic acoustic research',
      'institution','Example Institute','topics',jsonb_build_array('Acoustics'),'last_checked_at',clock_timestamp()-interval '1 hour',
      'personal_fit',jsonb_build_object('score',8,'scale_min',0,'scale_max',10,'summary','Prospective synthetic assessment'),
      'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/'||items[index]::text,'kind','official',
        'checked_at',clock_timestamp()-interval '1 hour','precision','instant','supports',jsonb_build_array('title','personal_fit'))));
    reply:=private.submit_opportunity_search_result(run_a,items[index],payload);
    opportunity_ids:=array_append(opportunity_ids,(reply->>'opportunity_id')::uuid);
    reply:=private.record_opportunity_search_discovery(run_a,items[index],'{}');
    discoveries:=array_append(discoveries,(reply->>'discovery_id')::uuid);
  end loop;
  assert (select discovered_at is null from public.opportunity_search_discoveries where discovery_id=discoveries[1]),
    'Historical attribution gained an invented discovery time';
  perform private.verify_opportunity_search_result(run_a,items[1]);
  perform private.verify_opportunity_search_discovery(run_a,items[1]);
  select assessment_recorded_at into assessment_time from public.opportunity_search_discoveries where discovery_id=discoveries[1];
  baseline:=jsonb_build_object('user_id',owner_a,'opportunity_id',opportunity_ids[1],'score',8,'scale_min',0,'scale_max',10,
    'predicted_at',assessment_time,'source_kind','historical_snapshot','source_ref','opportunity-search-receipt:'||run_a::text||':'||items[1]::text);
  assert private.opportunity_feedback_baseline_matches(baseline,owner_a,opportunity_ids[1],clock_timestamp()),
    'The additive discovery proof extension broke existing exact historical receipt baselines';

  -- An owner write reads protected assessment metadata, without private audit
  -- EXECUTE/SELECT grants, and pins the exact genuine prediction once.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity_ids[1],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[1]),'interested');
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[1];
  baseline:=before_row.prediction_baseline;
  assert baseline->>'source_kind'='discovery_assessment' and baseline->>'source_ref'='opportunity-discovery-assessment:'||discoveries[1]::text,
    'A verified prospective assessment was not automatically pinned';
  assert (baseline->>'predicted_at')::timestamptz=assessment_time and baseline->'score'='8'::jsonb,
    'The server fabricated a prediction date or used current catalogue fit';
  assert not has_function_privilege(current_user,'private.opportunity_feedback_baseline_matches(jsonb,uuid,uuid,timestamptz)','EXECUTE')
    and not has_table_privilege(current_user,'private.opportunity_search_merge_audit','SELECT'),'Automatic pinning widened private privileges';
  blocked:=false;
  begin update public.opportunity_reviews set state='strong_interest',prediction_baseline=baseline||'{"score":9}'
    where user_id=owner_a and opportunity_id=opportunity_ids[1];
  exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'A browser injected its own baseline';
  blocked:=false;
  begin update public.opportunity_search_discoveries set assessment_verified_at=null where discovery_id=discoveries[1];
  exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'An owner forged protected assessment metadata';
  perform public.save_opportunity_comment(opportunity_ids[1],'Private synthetic explanation person@example.invalid');
  perform public.review_job_opportunity(opportunity_ids[1],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[1]),null);
  select * into after_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[1];
  assert after_row.prediction_baseline=baseline and after_row.feedback_revision=before_row.feedback_revision
    and after_row.feedback_updated_at=before_row.feedback_updated_at,'A view or private comment rebased the frozen prediction';
  execute 'reset role';
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[1]);
  assert metric->'interest_score'='6'::jsonb and metric->'interest_gap'='-2'::jsonb and metric->>'metric_version'='opportunity-interest-v2',
    'Discovery baseline changed interest conventions';
  projected:=private.project_opportunity_feedback(owner_a,opportunity_ids[1]);
  assert projected#>>'{original_prediction,source_kind}'='discovery_assessment'
    and projected#>>'{original_prediction,source_ref}'=baseline->>'source_ref','The outgoing DTO relabelled genuine discovery provenance';
  assert projected::text not like '%person@example.invalid%','Private explanation leaked in prediction metadata';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_b,opportunity_ids[1],clock_timestamp()),'Other-owner prediction accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_a,opportunity_ids[2],clock_timestamp()),'Other-opportunity prediction accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline||'{"score":7}',owner_a,opportunity_ids[1],clock_timestamp()),'Counterfeit score accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline||'{"scale_max":100}',owner_a,opportunity_ids[1],clock_timestamp()),'Wrong scale accepted';
  assert not private.opportunity_feedback_baseline_matches(baseline,owner_a,opportunity_ids[1],assessment_time-interval '1 microsecond'),
    'A prediction after feedback was treated as ex ante';
  update public.opportunities as o set personal_fit='{"score":1,"scale_min":0,"scale_max":10,"summary":"Later catalogue assessment"}' where o.id=opportunity_ids[1];
  assert private.opportunity_interest_metric(owner_a,opportunity_ids[1])->'interest_gap'='-2'::jsonb,'Current catalogue updates rebased the original prediction';
  update private.opportunity_search_merge_audit set rolled_back_at=clock_timestamp() where run_id=run_a and item_id=items[1];
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[1]);
  assert metric->'interest_gap'='null'::jsonb and metric->>'baseline_status'='unavailable','Rolled-back prediction retained a gap';
  assert (select prediction_baseline=baseline from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[1]),
    'Invalid proof rewrote rather than withheld the frozen baseline';

  -- Verification arriving later does not retrospectively attach a baseline to
  -- unchanged explicit feedback, a repeated choice, or a viewed-source receipt.
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),'interested');
  select * into before_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[2];
  assert before_row.prediction_baseline is null,'An unverified assessment was pinned';
  execute 'reset role';
  perform private.verify_opportunity_search_result(run_a,items[2]);
  perform private.verify_opportunity_search_discovery(run_a,items[2]);
  assert private.opportunity_interest_metric(owner_a,opportunity_ids[2])->'interest_gap'='null'::jsonb,'Late verification retrospectively rebased an explicit outcome';
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),null);
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),'interested');
  select * into after_row from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[2];
  assert after_row.prediction_baseline is null and after_row.feedback_revision=before_row.feedback_revision,'A no-op review created a new observation';
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),'strong_interest');
  execute 'reset role';
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[2]);
  assert metric->'interest_gap'='0'::jsonb and metric->>'baseline_status'='available','A genuine new explicit revision could not pin the verified assessment';

  -- A current submission fallback can independently match a genuine prediction
  -- before its known submission time. It does not manufacture a review event.
  perform private.verify_opportunity_search_result(run_a,items[3]);
  perform private.verify_opportunity_search_discovery(run_a,items[3]);
  submission_time:=clock_timestamp();
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage,submitted_at)
    values(application,owner_a,opportunity_ids[3],'submitted','tracking',submission_time);
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity_ids[3],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[3]),null);
  update public.opportunity_reviews set interest_reasons='[{"category":"method","polarity":"positive","target":"Prototyping"}]'
    where user_id=owner_a and opportunity_id=opportunity_ids[3];
  assert (select prediction_baseline is null from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity_ids[3]),
    'A reason-only submission fallback pinned a post-submission explicit baseline';
  execute 'reset role';
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[3]);
  assert metric->'interest_score'='9.5'::jsonb and metric->'interest_gap'='1.5'::jsonb,'Known submission lost its genuine ex-ante assessment';
  projected:=private.project_opportunity_feedback(owner_a,opportunity_ids[3]);
  assert projected#>>'{original_prediction,source_kind}'='discovery_assessment' and projected->'interest_gap'='1.5'::jsonb,
    'Submission fallback did not preserve its actual baseline provenance';
  update public.applications set submitted_at=null,status='rejected' where id=application;
  perform set_config('cv_builder.resetting_application_history',owner_a::text||':'||application::text,true);
  update public.applications set status_history='[{"status":"submitted","changedAt":null},{"status":"rejected","changedAt":null}]' where id=application;
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[3]);
  assert metric->'interest_score'='9.5'::jsonb and metric->'submission_at'='null'::jsonb and metric->'interest_gap'='null'::jsonb,
    'Unknown submission time established an invented baseline ordering';
  execute 'set local role authenticated';perform public.reset_job_application_history(application);execute 'reset role';
  metric:=private.opportunity_interest_metric(owner_a,opportunity_ids[3]);
  assert metric->'interest_score'='9'::jsonb and metric->'interest_gap'='null'::jsonb,'Reset did not remove submission evidence while retaining current application interest';

  -- Another owner can review the shared vacancy but cannot see or inherit this
  -- owner's protected assessment metadata or pin its prediction reference.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  select count(*) into affected from public.opportunity_search_discoveries where user_id=owner_a;
  assert affected=0,'Owner B read owner A assessment history';
  perform public.review_job_opportunity(opportunity_ids[2],(select o.updated_at from public.opportunities o where o.id=opportunity_ids[2]),'interested');
  assert (select prediction_baseline is null from public.opportunity_reviews where user_id=owner_b and opportunity_id=opportunity_ids[2]),
    'Owner B inherited owner A original prediction';
  execute 'reset role';
end;
$$;
rollback;
