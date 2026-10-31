-- Current interest-v2 behavior. Run only in the isolated synthetic database.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid(); application uuid;
  outcome jsonb; catalogue jsonb; stage text; expected numeric; rating numeric; blocked boolean;
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunities(id,opportunity_key,title) values(opportunity,'synthetic-current-interest-'||opportunity,'Synthetic acoustic research');
  select to_jsonb(o) into catalogue from public.opportunities o where id=opportunity;
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->>'metric_version'='opportunity-interest-v2';
  assert outcome->'interest_score'='null'::jsonb and outcome->>'interest_origin'='none';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity,(select updated_at from public.opportunities where id=opportunity),null);
  perform public.save_opportunity_comment(opportunity,'Evidence from acoustic experiments.');
  execute 'reset role';
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='null'::jsonb, 'views and evaluation text cannot manufacture an interest decision';

  foreach stage in array array['unreviewed','not_interested','interested','strong_interest','very_high_interest'] loop
    update public.opportunity_reviews set state=stage where user_id=owner_a and opportunity_id=opportunity;
    expected:=case stage when 'not_interested' then 2 when 'interested' then 6 when 'strong_interest' then 8 when 'very_high_interest' then 9 else null end;
    outcome:=private.opportunity_interest_metric(owner_a,opportunity);
    assert (outcome->>'interest_score')::numeric is not distinct from expected, 'current categorical mapping changed';
    foreach rating in array array[0::numeric,7.25::numeric,10::numeric] loop
      update public.opportunity_reviews set interest_rating=rating where user_id=owner_a and opportunity_id=opportunity;
      outcome:=private.opportunity_interest_metric(owner_a,opportunity);
      assert (outcome->>'interest_score')::numeric is not distinct from expected, 'numeric record metadata overrode a current decision';
    end loop;
  end loop;

  update public.opportunity_reviews set state='unreviewed',interest_rating=null where user_id=owner_a and opportunity_id=opportunity;
  foreach stage in array array['preparation','refinement','attachments','ready','contacted','interview','offer','rejected','withdrawn'] loop
    application:=gen_random_uuid();
    insert into public.applications(id,user_id,opportunity_id,status,workflow_stage) values(application,owner_a,opportunity,stage,'tracking');
    outcome:=private.opportunity_interest_metric(owner_a,opportunity);
    assert outcome->'interest_score'='9'::jsonb and outcome->>'interest_origin'='application', 'a saved application is a current interest decision';
    assert outcome->'confirmed_submission'='false'::jsonb, 'an employer status invented a submission';
    delete from public.applications where id=application;
  end loop;

  application:=gen_random_uuid();
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage) values(application,owner_a,opportunity,'submitted','tracking');
  update public.applications set status='rejected' where id=application;
  update public.opportunity_reviews set state='not_interested',interest_rating=0 where user_id=owner_a and opportunity_id=opportunity;
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='9.5'::jsonb and outcome->>'interest_origin'='confirmed_submission', 'submission must take precedence over review metadata';
  assert outcome->'confirmed_submission'='true'::jsonb, 'later rejection lost recorded submission evidence';
  update public.opportunity_reviews set feedback_excluded=true where user_id=owner_a and opportunity_id=opportunity;
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='null'::jsonb and outcome->>'interest_origin'='excluded';
  assert outcome->'confirmed_submission'='true'::jsonb, 'exclusion must withhold the outcome without rewriting its source';
  update public.opportunity_reviews set feedback_excluded=false where user_id=owner_a and opportunity_id=opportunity;

  execute 'set local role authenticated';
  perform public.reset_job_application_history(application);
  execute 'reset role';
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='9'::jsonb and outcome->>'interest_origin'='application', 'a reset removes submission evidence while the application remains';
  delete from public.applications where id=application;
  outcome:=private.opportunity_interest_metric(owner_a,opportunity);
  assert outcome->'interest_score'='2'::jsonb and outcome->>'interest_origin'='categorical_review';

  update public.opportunity_reviews set interest_reasons='[{"category":"topic","polarity":"positive","target":"  Acoustics  "},{"category":"requirements","polarity":"negative"}]'
    where user_id=owner_a and opportunity_id=opportunity;
  assert (select interest_reasons @> '[{"category":"topic","polarity":"positive","target":"Acoustics"}]'::jsonb from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity);
  blocked:=false;
  begin
    update public.opportunity_reviews set interest_reasons='[{"category":"requirements","polarity":"positive"}]' where user_id=owner_a and opportunity_id=opportunity;
  exception when check_violation then blocked:=true; end;
  assert blocked, 'requirements cannot be a positive preference tag';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  update public.opportunity_reviews set state='very_high_interest' where user_id=owner_a and opportunity_id=opportunity;
  execute 'reset role';
  assert (select state='not_interested' from public.opportunity_reviews where user_id=owner_a and opportunity_id=opportunity), 'another owner overwrote the decision';
  outcome:=private.opportunity_interest_metric(owner_b,opportunity);
  assert outcome->'interest_score'='null'::jsonb, 'another owner inherited private feedback';
  assert not outcome ?| array['comment','notes','context_json','contacts','documents','interest_reasons'];
  assert (select to_jsonb(o)=catalogue from public.opportunities o where id=opportunity), 'feedback changed the shared catalogue';
end;
$$;
rollback;
