-- Additive interval support for saved meta-search schedules.
-- Apply after the current adaptive payload contract. No schedule, task or stored
-- search content changes; widen the validation bound and admit the typed editor
-- cadence key in legacy setup. The row's schedule stays authoritative.
begin;
do $schedule_intervals$
declare definition text; updated_definition text;
begin
  select pg_get_functiondef('private.validate_opportunity_search_definition(text,jsonb,jsonb)'::regprocedure) into definition;
  if encode(sha256(convert_to(definition,'UTF8')),'hex') is distinct from 'b1ba59d70286941da4a1d1fab838f2eedc4054da7aff1190c4c724ef50dc4681' then
    raise exception 'Schedule interval upgrade requires the reviewed PostgreSQL 17 search-definition validator.' using errcode='55000';
  end if;
  updated_definition := replace(definition, '(p_schedule->>''intervalHours'')::numeric not between 1 and 168',
    '(p_schedule->>''intervalHours'')::numeric not between 1 and 8760');
  if updated_definition = definition then raise exception 'Reviewed schedule interval bound is missing.' using errcode='55000'; end if;
  execute updated_definition;

  select pg_get_functiondef('private.read_adaptive_search_setup_internal(uuid,uuid,text)'::regprocedure) into definition;
  if encode(sha256(convert_to(definition,'UTF8')),'hex') is distinct from '13e76fcd9f116d8017e078e6cf152d6cf72b65e99acaa37b41c09949778bd499' then
    raise exception 'Schedule interval upgrade requires the reviewed current search-setup reader.' using errcode='55000';
  end if;
  updated_definition := replace(definition, '''dailyTime'',''timezone'',''cloud''', '''dailyTime'',''timezone'',''cadence'',''cloud''');
  if updated_definition = definition then raise exception 'Reviewed editor cadence whitelist is missing.' using errcode='55000'; end if;
  execute updated_definition;
end;
$schedule_intervals$;
commit;
