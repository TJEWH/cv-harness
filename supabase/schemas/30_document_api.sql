-- Current desired schema: 30_document_api.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.reset_job_application_history(uuid)
CREATE FUNCTION private.reset_job_application_history(p_application_id uuid) RETURNS public.applications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor uuid := auth.uid(); saved public.applications; latest jsonb; retained jsonb;
  previous_scope text := current_setting('cv_builder.resetting_application_history', true);
begin
  if current_user <> 'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before resetting application history.' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'An application is required.' using errcode = '22023';
  end if;
  -- Serialize with status/stage writes, so a concurrent transition is not lost.
  select * into saved from public.applications where id = p_application_id and user_id = actor for update;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  latest := saved.status_history -> -1;
  retained := jsonb_build_object('status', saved.status, 'changedAt', null);
  if jsonb_typeof(latest) = 'object' and latest->>'status' = saved.status then
    if latest->'changedAt' = 'null'::jsonb then
      retained := jsonb_build_object('status', saved.status, 'changedAt', null);
    elsif jsonb_typeof(latest->'changedAt') = 'string' then
      begin
        if isfinite((latest->>'changedAt')::timestamptz) then
          retained := jsonb_build_object('status', saved.status, 'changedAt', latest->'changedAt');
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        -- Legacy malformed/unknown times must not become a new transition date.
        null;
      end;
    end if;
  end if;
  retained := jsonb_build_array(retained);
  if saved.status_history = retained then return saved; end if;
  perform set_config('cv_builder.resetting_application_history', actor::text || ':' || p_application_id::text, true);
  update public.applications set status_history = retained
    where id = p_application_id and user_id = actor returning * into saved;
  -- Exceptions roll back both the update and the transaction-local scope.
  perform set_config('cv_builder.resetting_application_history', coalesce(previous_scope, ''), true);
  return saved;
end;
$$;

-- public.reset_job_application_history(uuid)
CREATE FUNCTION public.reset_job_application_history(p_application_id uuid) RETURNS public.applications
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.reset_job_application_history(p_application_id);
$$;

-- public.set_job_application_stage(uuid, text)
CREATE FUNCTION public.set_job_application_stage(p_application_id uuid, p_stage text) RETURNS public.applications
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare actor uuid := auth.uid(); saved public.applications;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before changing an application stage.' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('preparation','refinement','review','tracking') then
    raise exception 'Select a valid application stage.' using errcode = '22023';
  end if;
  -- One UPDATE takes the row lock. A concurrent explicit status save wins in
  -- either order because the trigger reads the current row's sticky lock.
  update public.applications set workflow_stage = p_stage
    where id = p_application_id and user_id = actor returning * into saved;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  return saved;
end;
$$;
