-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  opportunity uuid := gen_random_uuid();
  application uuid := gen_random_uuid();
  source_version timestamptz;
  original jsonb;
  result jsonb;
  previous jsonb;
  choice text;
  affected integer;
begin
  if (select prosecdef from pg_proc where oid = 'public.save_opportunity_comment(uuid,text)'::regprocedure)
     or not has_function_privilege('authenticated', 'public.save_opportunity_comment(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.save_opportunity_comment(uuid,text)', 'execute') then
    raise exception 'FAIL: comment RPC must be invoker and authenticated-only';
  end if;
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity, 'comment-test-' || opportunity::text, 'Comment test');
  select to_jsonb(o), coalesce(o.updated_at, o.created_at) into original, source_version
    from public.opportunities o where id = opportunity;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  result := public.save_opportunity_comment(opportunity, E'Excellent research fit.\nAsk about funding.');
  if result ->> 'comment' is distinct from E'Excellent research fit.\nAsk about funding.'
     or result ->> 'user_id' is distinct from user_a::text
     or result ->> 'opportunity_id' is distinct from opportunity::text
     or result ->> 'state' is distinct from 'unreviewed'
     or result ->> 'reviewed_updated_at' is not null then
    raise exception 'FAIL: comment-only creation must retain text and leave preference/receipt unreviewed';
  end if;

  foreach choice in array array['strong_interest', 'not_interested', 'interested', 'unreviewed'] loop
    result := public.review_job_opportunity(opportunity, source_version, choice);
    if result ->> 'comment' is distinct from E'Excellent research fit.\nAsk about funding.' then
      raise exception 'FAIL: interest update erased comment';
    end if;
    previous := result;
    result := public.save_opportunity_comment(opportunity, 'Updated reason');
    if result ->> 'comment' is distinct from 'Updated reason'
       or result ->> 'state' is distinct from choice
       or (result ->> 'reviewed_updated_at')::timestamptz is distinct from source_version
       or result ->> 'created_at' is distinct from previous ->> 'created_at' then
      raise exception 'FAIL: comment edit lost interest, receipt or creation identity';
    end if;
    perform public.save_opportunity_comment(opportunity, E'Excellent research fit.\nAsk about funding.');
  end loop;
  result := public.review_job_opportunity(opportunity, source_version);
  if result ->> 'comment' is distinct from E'Excellent research fit.\nAsk about funding.' then
    raise exception 'FAIL: opening opportunity erased comment';
  end if;

  -- Empty values clear the evaluation without deleting the review; full text is otherwise lossless.
  result := public.save_opportunity_comment(opportunity, '');
  if result ->> 'comment' is not null or result ->> 'state' is distinct from 'unreviewed'
     or (result ->> 'reviewed_updated_at')::timestamptz is distinct from source_version then
    raise exception 'FAIL: clearing a comment changed the review';
  end if;
  perform public.save_opportunity_comment(opportunity, 'A replacement');
  result := public.save_opportunity_comment(opportunity, null);
  if result ->> 'comment' is not null then raise exception 'FAIL: null did not clear comment'; end if;
  result := public.save_opportunity_comment(opportunity, repeat('ü', 12000));
  if char_length(result ->> 'comment') <> 12000 then raise exception 'FAIL: valid Unicode boundary rejected'; end if;
  begin
    perform public.save_opportunity_comment(opportunity, repeat('x', 12001));
    raise exception 'FAIL: oversized comment accepted by RPC';
  exception when invalid_parameter_value then null; end;
  begin
    update public.opportunity_reviews set comment = repeat('x', 12001)
      where user_id = user_a and opportunity_id = opportunity;
    raise exception 'FAIL: direct write bypassed comment bound';
  exception when check_violation then null; end;
  if (select char_length(comment) from public.opportunity_reviews where opportunity_id = opportunity) <> 12000 then
    raise exception 'FAIL: invalid comment changed the saved value';
  end if;
  begin
    perform public.save_opportunity_comment(gen_random_uuid(), 'Unavailable');
    raise exception 'FAIL: missing opportunity accepted';
  exception when insufficient_privilege then null; end;

  -- Application creation and removal preserve private reasoning and the receipt.
  perform public.save_opportunity_comment(opportunity, 'Not enough funding');
  perform public.review_job_opportunity(opportunity, source_version, 'not_interested');
  perform public.create_job_application(application, opportunity);
  if not exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity
      and comment = 'Not enough funding' and state = 'not_interested' and reviewed_updated_at = source_version) then
    raise exception 'FAIL: application creation changed private review';
  end if;
  select to_jsonb(r) into previous from public.opportunity_reviews r where user_id = user_a and opportunity_id = opportunity;
  perform public.remove_job_application(application);
  if (select to_jsonb(r) from public.opportunity_reviews r where user_id = user_a and opportunity_id = opportunity) is distinct from previous then
    raise exception 'FAIL: application removal changed private evaluation or receipt';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity) then
    raise exception 'FAIL: another owner can read private comment';
  end if;
  update public.opportunity_reviews set comment = 'Cross-owner write'
    where user_id = user_a and opportunity_id = opportunity;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-owner comment updated'; end if;
  begin
    insert into public.opportunity_reviews(user_id, opportunity_id, comment)
      values (user_a, opportunity, 'Spoofed owner');
    raise exception 'FAIL: comment owner spoofing accepted';
  exception when insufficient_privilege then null; end;
  result := public.save_opportunity_comment(opportunity, 'Different private reason');
  if result ->> 'user_id' is distinct from user_b::text or result ->> 'comment' is distinct from 'Different private reason' then
    raise exception 'FAIL: caller could not save independent comment';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  if exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity) then
    raise exception 'FAIL: anonymous account can read private comment';
  end if;
  begin
    perform public.save_opportunity_comment(opportunity, 'Anonymous');
    raise exception 'FAIL: anonymous account saved comment';
  exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.save_opportunity_comment(opportunity, 'Signed out');
    raise exception 'FAIL: signed-out comment write';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select count(*) from public.opportunity_reviews where opportunity_id = opportunity) <> 2
     or not exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity
       and user_id = user_a and comment = 'Not enough funding') then
    raise exception 'FAIL: independent private reviews were overwritten';
  end if;
  if (select to_jsonb(o) from public.opportunities o where id = opportunity) is distinct from original then
    raise exception 'FAIL: private comments mutated shared research';
  end if;
end;
$$;
rollback;
select 'PASS: private comments, preference/receipt/application preservation, blank clearing, Unicode bounds, direct-write validation, shared research integrity, owner isolation and anonymous denial. All fixtures rolled back.' as result;
