-- Run as postgres. Uses only ordinary application APIs after fixture setup.
-- All synthetic users, records and status changes roll back.
begin;
set constraints all immediate;
do $$
declare
  owner_id uuid := gen_random_uuid(); opportunity uuid := gen_random_uuid(); app uuid := gen_random_uuid();
  stage text; expected_status text; saved public.applications;
  previous_history jsonb; current_entry jsonb; before_reset jsonb;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values (owner_id, 'authenticated', 'authenticated', owner_id::text || '@example.invalid', '{}', '{}');
  insert into public.opportunities(id, opportunity_key, title)
    values (opportunity, 'tracking-navigation-' || opportunity::text, 'Synthetic tracking navigation');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  perform public.create_job_application(app, opportunity);

  select to_jsonb(a) into before_reset from public.applications a where a.id = app;
  foreach expected_status in array array['shortlist', 'unsupported_status', null] loop
    begin
      update public.applications set status = expected_status where id = app;
      raise exception 'FAIL: unsupported status was accepted';
    exception when check_violation then null;
    end;
  end loop;
  if (select to_jsonb(a) from public.applications a where a.id = app) <> before_reset then
    raise exception 'FAIL: rejecting a status changed application data';
  end if;

  foreach stage in array array['preparation','refinement','review'] loop
    expected_status := case stage when 'review' then 'attachments' else stage end;
    saved := public.set_job_application_stage(app, stage);
    if saved.status <> expected_status or saved.tracking_started then
      raise exception 'FAIL: % did not derive its workflow status', stage;
    end if;
    previous_history := saved.status_history;
    current_entry := previous_history -> -1;
    saved := public.set_job_application_stage(app, 'tracking');
    if saved.workflow_stage <> 'tracking' or saved.status <> expected_status or saved.tracking_started
      or saved.status_history <> previous_history then
      raise exception 'FAIL: opening Tracking from % changed status or history', stage;
    end if;

    update public.applications set notes = 'Draft saved in Tracking from ' || stage where id = app;
    perform public.set_job_application_checklist_item(app, 'documents:cv', true);
    select * into saved from public.applications where id = app;
    if saved.status <> expected_status or saved.tracking_started or saved.status_history <> previous_history then
      raise exception 'FAIL: saving in Tracking from % changed status or history', stage;
    end if;
    before_reset := to_jsonb(saved);
    saved := public.reset_job_application_history(app);
    if saved.status_history <> jsonb_build_array(current_entry)
      or (to_jsonb(saved) - array['status_history','updated_at']) <> (before_reset - array['status_history','updated_at']) then
      raise exception 'FAIL: resetting Tracking history from % changed status, timestamp or another field', stage;
    end if;
    before_reset := to_jsonb(saved);
    saved := public.reset_job_application_history(app);
    if to_jsonb(saved) <> before_reset then raise exception 'FAIL: reset from % is not idempotent', stage; end if;
    saved := public.set_job_application_stage(app, 'tracking');
    if saved.status <> expected_status or saved.tracking_started or saved.status_history <> jsonb_build_array(current_entry) then
      raise exception 'FAIL: reopening Tracking after reset from % changed status or history', stage;
    end if;
  end loop;

  -- Explicit choices still start sticky tracking and record exactly one event.
  previous_history := saved.status_history;
  update public.applications set status = 'ready', tracking_started = true where id = app;
  select * into saved from public.applications where id = app;
  if saved.status <> 'ready' or not saved.tracking_started
    or jsonb_array_length(saved.status_history) <> jsonb_array_length(previous_history) + 1
    or saved.status_history -> -1 ->> 'status' <> 'ready' then
    raise exception 'FAIL: explicit Ready did not start tracking';
  end if;
  previous_history := saved.status_history;
  update public.applications set status = 'ready', tracking_started = true where id = app;
  foreach stage in array array['preparation','refinement','review','tracking'] loop
    saved := public.set_job_application_stage(app, stage);
    if saved.status <> 'ready' or not saved.tracking_started or saved.status_history <> previous_history then
      raise exception 'FAIL: % navigation replaced explicit Ready', stage;
    end if;
  end loop;
  current_entry := saved.status_history -> -1;
  saved := public.reset_job_application_history(app);
  if saved.status <> 'ready' or not saved.tracking_started or saved.status_history <> jsonb_build_array(current_entry) then
    raise exception 'FAIL: reset removed explicit Ready or its tracking lock';
  end if;
  update public.applications set status = 'submitted' where id = app;
  saved := public.set_job_application_stage(app, 'tracking');
  if saved.status <> 'submitted' or not saved.tracking_started or jsonb_array_length(saved.status_history) <> 2
    or saved.status_history -> 0 <> current_entry or saved.status_history -> 1 ->> 'status' <> 'submitted' then
    raise exception 'FAIL: status tracking did not continue after reset';
  end if;
  execute 'reset role';
end;
$$;
rollback;
