-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid();
  version_a timestamptz := now() - interval '2 hours';
  version_b timestamptz;
  result jsonb;
  original jsonb;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title, created_at, updated_at)
    values (opportunity, 'receipt-test-' || opportunity::text, 'Receipt test', now() - interval '2 days', version_a);
  select to_jsonb(o), o.updated_at into original, version_a from public.opportunities o where id = opportunity;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  result := public.review_job_opportunity(opportunity, version_a);
  if result ->> 'user_id' <> user_a::text or result ->> 'state' <> 'unreviewed'
     or (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_a then
    raise exception 'FAIL: opening must record only the observed version for the current account';
  end if;
  perform public.review_job_opportunity(opportunity, version_a, 'not_interested');
  result := public.review_job_opportunity(opportunity, version_a);
  if result ->> 'state' <> 'not_interested' then raise exception 'FAIL: reopening changed interest'; end if;
  if (select to_jsonb(o) from public.opportunities o where id = opportunity) <> original then
    raise exception 'FAIL: private review mutated shared research';
  end if;

  execute 'reset role';
  update public.opportunities set title = 'Updated receipt test', updated_at = now() where id = opportunity
    returning updated_at into version_b;
  if version_b = version_a then raise exception 'FAIL: invalid source-update fixture'; end if;
  execute 'set local role authenticated';
  result := public.review_job_opportunity(opportunity, version_a, 'interested');
  if (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_a or result ->> 'state' <> 'interested' then
    raise exception 'FAIL: stale browser acknowledged unseen research or lost interest';
  end if;
  result := public.review_job_opportunity(opportunity, version_b);
  if (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_b then raise exception 'FAIL: updated research cannot be reviewed'; end if;
  result := public.review_job_opportunity(opportunity, version_a, 'unreviewed');
  if (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_b or result ->> 'state' <> 'unreviewed' then
    raise exception 'FAIL: old request regressed receipt or blocked state reset';
  end if;
  result := public.review_job_opportunity(opportunity, version_b + interval '1 day');
  if (result ->> 'reviewed_updated_at')::timestamptz is distinct from version_b then raise exception 'FAIL: future version accepted'; end if;
  begin
    perform public.review_job_opportunity(opportunity, version_b, 'invalid');
    raise exception 'FAIL: invalid state accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.review_job_opportunity(gen_random_uuid(), version_b);
    raise exception 'FAIL: missing opportunity accepted';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity) then raise exception 'FAIL: cross-account receipt visible'; end if;
  result := public.review_job_opportunity(opportunity, version_b, 'interested');
  if result ->> 'user_id' <> user_b::text then raise exception 'FAIL: receipt owner spoofing'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin
    perform public.review_job_opportunity(opportunity, version_b);
    raise exception 'FAIL: anonymous account can save receipt';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.review_job_opportunity(opportunity, version_b);
    raise exception 'FAIL: signed-out receipt write';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select count(*) from public.opportunity_reviews where opportunity_id = opportunity) <> 2 then
    raise exception 'FAIL: per-account receipts not retained';
  end if;
end;
$$;
rollback;
select 'PASS: private persistent receipts, preserved interest, stale/future version rejection, monotonic receipts, shared source integrity, account isolation and anonymous denial. All fixtures rolled back.' as result;
