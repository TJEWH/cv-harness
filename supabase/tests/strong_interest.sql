-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  opportunity_a uuid := gen_random_uuid();
  opportunity_b uuid := gen_random_uuid();
  application uuid := gen_random_uuid();
  version_a timestamptz := now() - interval '2 days';
  version_b timestamptz;
  result jsonb;
  original jsonb;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title, deadline, personal_fit, source_context, created_at, updated_at)
    values (opportunity_a, 'strong-interest-' || opportunity_a::text, 'Synthetic historical research role', current_date - 30, '{"score":4.2,"scale_min":0,"scale_max":10,"summary":"Synthetic assessment"}', 'Original search A', version_a, version_a),
           (opportunity_b, 'strong-interest-' || opportunity_b::text, 'Synthetic current research role', current_date + 30, '{"score":6.1,"scale_min":0,"scale_max":10,"summary":"Synthetic assessment"}', 'Different original search B', version_a, version_a);
  select to_jsonb(o), o.updated_at into original, version_a from public.opportunities o where id = opportunity_a;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  result := public.review_job_opportunity(opportunity_a, version_a, 'strong_interest');
  if result ->> 'state' <> 'strong_interest' or result ->> 'user_id' <> user_a::text
    or (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_a then
    raise exception 'FAIL: strong interest on low-fit historical opportunity was not saved';
  end if;
  perform public.review_job_opportunity(opportunity_b, version_a, 'strong_interest');
  if (select count(*) from public.opportunity_reviews where state = 'strong_interest') <> 2 then
    raise exception 'FAIL: preferences across original searches were not retained';
  end if;
  result := public.review_job_opportunity(opportunity_a, version_a);
  if result ->> 'state' <> 'strong_interest' then raise exception 'FAIL: opening changed strong interest'; end if;
  perform public.create_job_application(application, opportunity_a);
  if not exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity_a and state = 'strong_interest') then
    raise exception 'FAIL: application creation changed strong interest';
  end if;
  perform public.remove_job_application(application);
  if not exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity_a and state = 'strong_interest') then
    raise exception 'FAIL: application removal changed strong interest';
  end if;
  if (select to_jsonb(o) from public.opportunities o where id = opportunity_a) <> original then
    raise exception 'FAIL: explicit preference changed shared research';
  end if;

  execute 'reset role';
  update public.opportunities set title = 'Synthetic updated research role', updated_at = now()
    where id = opportunity_a returning updated_at into version_b;
  execute 'set local role authenticated';
  result := public.review_job_opportunity(opportunity_a, version_a, 'strong_interest');
  if (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_a then
    raise exception 'FAIL: stale strong-interest review acknowledged unseen changes';
  end if;
  result := public.review_job_opportunity(opportunity_a, version_b);
  if result ->> 'state' <> 'strong_interest' or (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_b then
    raise exception 'FAIL: current review lost strong interest or receipt';
  end if;
  begin
    perform public.review_job_opportunity(opportunity_a, version_b, 'invalid');
    raise exception 'FAIL: invalid review state accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.opportunity_reviews set state = 'invalid' where opportunity_id = opportunity_a;
    raise exception 'FAIL: invalid direct review state accepted';
  exception when check_violation then null; end;
  begin
    update public.opportunity_reviews set user_id = user_b where opportunity_id = opportunity_a;
    raise exception 'FAIL: preference ownership change accepted';
  exception when insufficient_privilege or check_violation then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists (select 1 from public.opportunity_reviews where opportunity_id in (opportunity_a, opportunity_b)) then
    raise exception 'FAIL: another account can read strong interests';
  end if;
  result := public.review_job_opportunity(opportunity_a, version_b, 'interested');
  if result ->> 'user_id' <> user_b::text or result ->> 'state' <> 'interested' then
    raise exception 'FAIL: independent account preference not retained';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin
    perform public.review_job_opportunity(opportunity_a, version_b, 'strong_interest');
    raise exception 'FAIL: anonymous account can save strong interest';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.review_job_opportunity(opportunity_a, version_b, 'strong_interest');
    raise exception 'FAIL: signed-out strong-interest write';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select count(*) from public.opportunity_reviews where user_id = user_a and state = 'strong_interest') <> 2 then
    raise exception 'FAIL: owner strong interests were modified';
  end if;
end;
$$;
rollback;
select 'PASS: strong interest across deadlines, low fit and search origins; persistent preferences, application lifecycle, receipts, source integrity, owner isolation, invalid-state and anonymous denial. All fixtures rolled back.' as result;
