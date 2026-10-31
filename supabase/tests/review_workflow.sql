-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
set constraints all immediate;
do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  opportunity_a uuid := gen_random_uuid();
  opportunity_b uuid := gen_random_uuid();
  app_a uuid := gen_random_uuid();
  app_b uuid := gen_random_uuid();
  direct_app uuid := gen_random_uuid();
  got uuid;
  affected integer;
  captured timestamptz;
  saved_context jsonb;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (user_a, 'authenticated', 'authenticated', user_a::text || '@example.invalid', '{}', '{}'),
           (user_b, 'authenticated', 'authenticated', user_b::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title, requirements, required_documents, contacts,
    supervisor_research_focus, supervisor_top_papers)
    values (opportunity_a, 'review-test-' || opportunity_a::text, 'Research role', '[{"entity_id":"signal-processing","text":"Signal processing","status":"required","stage":"recruitment"}]', '[{"entity_id":"cv","text":"CV","status":"required","stage":"recruitment"},{"entity_id":"motivation-letter","text":"Motivation letter","status":"required","stage":"recruitment"}]',
      '[{"name":"Research contact","email":"employer@example.org","roles":["contact"],"entity_id":"research-contact"}]',
      '{"profiles":[{"entity_id":"research-contact","name":"Research contact","summary":"Acoustic sensing","topics":["DSP"]}]}',
      '[{"entity_id":"sensing-paper","title":"Representative sensing paper","year":2025,"selection_basis":"Relevant public work","url":"https://example.org/paper"}]'),
      (opportunity_b, 'review-test-' || opportunity_b::text, 'Second role', '[]', '[]', '[]', '{}', '[]');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.opportunity_reviews) then raise exception 'FAIL: another user reviews are visible'; end if;
  insert into public.opportunity_reviews(user_id, opportunity_id, state) values (user_a, opportunity_a, 'interested')
    on conflict (user_id, opportunity_id) do update set state = excluded.state;
  insert into public.opportunity_reviews(user_id, opportunity_id, state) values (user_a, opportunity_a, 'not_interested')
    on conflict (user_id, opportunity_id) do update set state = excluded.state;
  if not exists (select 1 from public.opportunity_reviews where opportunity_id = opportunity_a and state = 'not_interested')
     or (select count(*) from public.opportunity_reviews) <> 1 then raise exception 'FAIL: review upsert failed'; end if;
  update public.opportunity_reviews set state = 'unreviewed', updated_at = '2000-01-01' where opportunity_id = opportunity_a;
  if not exists (select 1 from public.opportunity_reviews where state = 'unreviewed' and updated_at = now()) then
    raise exception 'FAIL: review reset/server timestamp failed';
  end if;
  begin
    update public.opportunity_reviews set state = 'invalid' where opportunity_id = opportunity_a;
    raise exception 'FAIL: invalid interest state accepted';
  exception when check_violation then null; end;
  begin
    update public.opportunity_reviews set user_id = user_b where opportunity_id = opportunity_a;
    raise exception 'FAIL: review ownership change accepted';
  exception when insufficient_privilege or check_violation then null; end;

  got := public.create_job_application(app_a, opportunity_a);
  if got <> app_a then raise exception 'FAIL: create returned wrong ID'; end if;
  if not exists (select 1 from public.applications where id = app_a and cv_variant_id is null and contact_email is null)
     or exists (select 1 from public.cv_variants) then
    raise exception 'FAIL: one-click creation requires or creates CV/email';
  end if;
  select context_json, context_captured_at into saved_context, captured from public.applications where id = app_a;
  if saved_context ->> 'id' <> opportunity_a::text or captured <> now()
     or saved_context -> 'requirements' <> '[{"entity_id":"signal-processing","text":"Signal processing","status":"required","stage":"recruitment"}]'::jsonb
     or saved_context -> 'required_documents' <> '[{"entity_id":"cv","text":"CV","status":"required","stage":"recruitment"},{"entity_id":"motivation-letter","text":"Motivation letter","status":"required","stage":"recruitment"}]'::jsonb
     or saved_context #>> '{contacts,0,email}' <> 'employer@example.org'
     or saved_context #>> '{supervisor_research_focus,profiles,0,summary}' <> 'Acoustic sensing'
     or saved_context #>> '{supervisor_top_papers,0,title}' <> 'Representative sensing paper' then
    raise exception 'FAIL: complete research context was not captured';
  end if;
  got := public.create_job_application(app_a, opportunity_a);
  if got <> app_a then raise exception 'FAIL: same-ID create retry'; end if;
  got := public.create_job_application(gen_random_uuid(), opportunity_a);
  if got <> app_a or (select count(*) from public.applications) <> 1 then
    raise exception 'FAIL: repeated one-click creation made a duplicate';
  end if;
  begin
    perform public.create_job_application(app_a, opportunity_b);
    raise exception 'FAIL: reused application ID could change opportunity';
  exception when unique_violation then null; end;
  update public.applications set context_json = '{"requirements":["Forged"]}', context_captured_at = '2000-01-01' where id = app_a;
  if not exists (select 1 from public.applications where id = app_a and context_json = saved_context and context_captured_at = captured) then
    raise exception 'FAIL: a client could forge research or the capture timestamp';
  end if;
  begin
    update public.applications set opportunity_id = opportunity_b where id = app_a;
    raise exception 'FAIL: captured application can switch opportunity';
  exception when check_violation then null; end;
  update public.applications set notes = 'Prepare later', status = 'contacted' where id = app_a;
  insert into public.applications(id, user_id, opportunity_id, context_json, context_captured_at)
    values (direct_app, user_a, opportunity_b, '{"fake":"client payload"}', '2000-01-01');
  if not exists (select 1 from public.applications where id = direct_app
    and context_json ->> 'id' = opportunity_b::text and not context_json ? 'fake' and context_captured_at = now()) then
    raise exception 'FAIL: direct INSERT bypassed authoritative snapshot';
  end if;

  -- Source edits do not silently rewrite an existing application's research.
  execute 'reset role';
  update public.opportunities set requirements = '[{"entity_id":"new-source-requirement","text":"New source requirement","status":"required","stage":"recruitment"}]', supervisor_top_papers = '[]' where id = opportunity_a;
  execute 'set local role authenticated';
  if not exists (select 1 from public.applications where id = app_a and context_json = saved_context and context_captured_at = captured) then
    raise exception 'FAIL: source change rewrote saved application research';
  end if;
  got := public.refresh_job_application_context(app_a);
  if got <> app_a or not exists (select 1 from public.applications where id = app_a
     and context_json -> 'requirements' = '[{"entity_id":"new-source-requirement","text":"New source requirement","status":"required","stage":"recruitment"}]'::jsonb
     and context_json -> 'supervisor_top_papers' = '[]'::jsonb and context_captured_at = now()
     and cv_variant_id is null and contact_email is null and notes = 'Prepare later' and status = 'contacted') then
    raise exception 'FAIL: explicit refresh did not update research while preserving application fields';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  if exists (select 1 from public.opportunity_reviews) or exists (select 1 from public.applications) then
    raise exception 'FAIL: cross-user reviews or research snapshots visible';
  end if;
  begin
    perform public.refresh_job_application_context(app_a);
    raise exception 'FAIL: cross-user research refresh';
  exception when insufficient_privilege or check_violation then null; end;
  update public.opportunity_reviews set state = 'interested' where opportunity_id = opportunity_a and user_id = user_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user review update'; end if;
  delete from public.opportunity_reviews where opportunity_id = opportunity_a and user_id = user_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user review delete'; end if;
  begin
    insert into public.opportunity_reviews(user_id, opportunity_id, state) values (user_a, opportunity_b, 'interested');
    raise exception 'FAIL: review owner spoof';
  exception when insufficient_privilege or check_violation then null; end;
  insert into public.opportunity_reviews(user_id, opportunity_id, state) values (user_b, opportunity_a, 'interested');
  got := public.create_job_application(app_b, opportunity_a);
  if got <> app_b then raise exception 'FAIL: another user cannot create their own application'; end if;
  if not exists (select 1 from public.applications where id = app_b and context_json -> 'requirements' = '[{"entity_id":"new-source-requirement","text":"New source requirement","status":"required","stage":"recruitment"}]'::jsonb) then
    raise exception 'FAIL: new application did not capture current research';
  end if;
  delete from public.opportunity_reviews where user_id = user_b and opportunity_id = opportunity_a;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: own review delete'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  if exists (select 1 from public.opportunity_reviews) then raise exception 'FAIL: anonymous-auth review read'; end if;
  begin
    insert into public.opportunity_reviews(user_id, opportunity_id) values (user_b, opportunity_b);
    raise exception 'FAIL: anonymous-auth review insert';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    perform public.create_job_application(gen_random_uuid(), opportunity_b);
    raise exception 'FAIL: anonymous-auth one-click create';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    perform public.refresh_job_application_context(app_b);
    raise exception 'FAIL: anonymous-auth research refresh';
  exception when insufficient_privilege or check_violation then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform 1 from public.opportunity_reviews;
    raise exception 'FAIL: signed-out review read';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    perform public.create_job_application(gen_random_uuid(), opportunity_b);
    raise exception 'FAIL: signed-out one-click create';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    perform public.refresh_job_application_context(app_b);
    raise exception 'FAIL: signed-out research refresh';
  exception when insufficient_privilege or check_violation then null; end;

  execute 'reset role';
  delete from auth.users where id = user_a;
  if exists (select 1 from public.opportunity_reviews where user_id = user_a)
     or exists (select 1 from public.applications where user_id = user_a) then
    raise exception 'FAIL: account delete did not cascade new records';
  end if;
end;
$$;
rollback;
select 'PASS: private interest review CRUD/upsert/isolation, optional CV/email, duplicate-free creation, authoritative complete research snapshots, source-change stability, safe explicit refresh, anonymous denial, and account cascades. All fixtures rolled back.' as result;
