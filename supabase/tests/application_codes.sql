-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;

-- Force the first generated code to collide with another owner's code. nextval is
-- intentionally not rolled back by an insert's subtransaction, unlike a test GUC.
create temporary sequence application_code_collision_attempts;
grant usage on sequence application_code_collision_attempts to authenticated;
create function pg_temp.force_application_code_collision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id::text=current_setting('test.application_code.target',true) then
    if nextval('pg_temp.application_code_collision_attempts')=1 or current_setting('test.application_code.mode',true)='always' then
      new.application_code:=current_setting('test.application_code.collision',true);
    end if;
  end if;
  return new;
end;
$$;
create trigger zz_test_application_code_collision before insert on public.applications
  for each row execute function pg_temp.force_application_code_collision();

do $$
declare
  user_a uuid:=gen_random_uuid(); user_b uuid:=gen_random_uuid();
  opportunity_a uuid:=gen_random_uuid(); opportunity_b uuid:=gen_random_uuid(); opportunity_c uuid:=gen_random_uuid(); opportunity_d uuid:=gen_random_uuid();
  app_a uuid:=gen_random_uuid(); app_b uuid:=gen_random_uuid(); app_c uuid:=gen_random_uuid(); app_d uuid:=gen_random_uuid(); direct_app uuid:=gen_random_uuid();
  snapshot_cv uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  code_a text; code_b text; code_c text; direct_code text; result jsonb; baseline jsonb; request jsonb;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening and evidence","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-10-01T00:00:00Z"},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"","role":"","email":"muster-ex@mp.le","phone":"","website":"","linkedin":"","github":""},"about":{"text":"Research experience."}}';
begin
  if exists(select 1 from public.applications where application_code is null or application_code !~ '^APP-[A-F0-9]{10}$')
    or exists(select 1 from public.applications group by application_code having count(*)>1) then
    raise exception 'FAIL: application-code backfill/uniqueness';
  end if;
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(user_a,'authenticated','authenticated',user_a::text||'@example.invalid','{}','{}'),
          (user_b,'authenticated','authenticated',user_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values
    (opportunity_a,'code-test-'||opportunity_a::text,'Application code fixture A'),
    (opportunity_b,'code-test-'||opportunity_b::text,'Application code fixture B'),
    (opportunity_c,'code-test-'||opportunity_c::text,'Application code fixture C'),
    (opportunity_d,'code-test-'||opportunity_d::text,'Application code fixture D');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',user_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a,opportunity_a);
  select application_code,to_jsonb(a) into code_a,baseline from public.applications a where id=app_a;
  if code_a !~ '^APP-[A-F0-9]{10}$' then raise exception 'FAIL: generated code format'; end if;
  if public.create_job_application(app_a,opportunity_a)<>app_a or public.create_job_application(gen_random_uuid(),opportunity_a)<>app_a
    or (select to_jsonb(a) from public.applications a where id=app_a)<>baseline then raise exception 'FAIL: retry changed application/code'; end if;
  result:=public.resolve_application_reference('  '||lower(code_a)||'  ','cv');
  if result<>jsonb_build_object('application_id',app_a,'application_code',code_a,'scope','cv','current_request_id',null)
    or public.resolve_application_reference(upper(app_a::text),'cv')<>result then raise exception 'FAIL: owner resolution/code normalization/UUID fallback'; end if;
  begin perform public.resolve_application_reference(left(code_a,8),'cv'); raise exception 'FAIL: partial-code match'; exception when invalid_parameter_value then null; end;
  begin perform public.resolve_application_reference('Application code fixture A','cv'); raise exception 'FAIL: title lookup'; exception when invalid_parameter_value then null; end;
  begin perform public.resolve_application_reference(null,'cv'); raise exception 'FAIL: null reference'; exception when invalid_parameter_value then null; end;
  begin perform public.resolve_application_reference(gen_random_uuid()::text,'cv'); raise exception 'FAIL: missing application resolved'; exception when insufficient_privilege then null; end;
  begin update public.applications set application_code='APP-0000000000' where id=app_a; raise exception 'FAIL: owner changed code'; exception when check_violation then null; end;
  begin update public.applications set application_code=null where id=app_a; raise exception 'FAIL: owner cleared code'; exception when check_violation then null; end;
  update public.applications set status='submitted',notes='Private application note',submitted_at=now() where id=app_a;
  perform public.refresh_job_application_context(app_a);
  if (select application_code from public.applications where id=app_a)<>code_a then raise exception 'FAIL: code changed after edit/context refresh'; end if;
  insert into public.applications(id,user_id,opportunity_id,application_code) values(direct_app,user_a,opportunity_b,code_a);
  select application_code into direct_code from public.applications where id=direct_app;
  if direct_code=code_a or direct_code !~ '^APP-[A-F0-9]{10}$' then raise exception 'FAIL: browser supplied code accepted'; end if;
  begin perform private.resolve_application_reference(code_a,'cv'); raise exception 'FAIL: owner accessed management resolver'; exception when insufficient_privilege then null; end;

  -- Application creation recovers an actual UNIQUE violation, including a code
  -- belonging to a different user and therefore invisible through owner RLS.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',user_b,'role','authenticated','is_anonymous',false)::text,true);
  perform set_config('test.application_code.target',app_b::text,true);
  perform set_config('test.application_code.collision',code_a,true);
  perform set_config('test.application_code.mode','once',true);
  perform public.create_job_application(app_b,opportunity_a);
  select application_code into code_b from public.applications where id=app_b;
  if code_b=code_a or currval('pg_temp.application_code_collision_attempts')<>2 then raise exception 'FAIL: two-argument collision retry'; end if;
  begin perform public.resolve_application_reference(code_a,'cv'); raise exception 'FAIL: cross-owner code resolution'; exception when insufficient_privilege then null; end;
  begin perform public.resolve_application_reference(app_a::text,'cv'); raise exception 'FAIL: cross-owner UUID resolution'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.applications where application_code=code_a) then raise exception 'FAIL: cross-owner table lookup'; end if;
  execute 'reset role';
  alter sequence pg_temp.application_code_collision_attempts restart with 1;
  execute 'set local role authenticated';
  perform set_config('test.application_code.target',app_c::text,true);
  perform public.create_job_application(app_c,opportunity_b);
  select application_code into code_c from public.applications where id=app_c;
  if code_c=code_a or currval('pg_temp.application_code_collision_attempts')<>2 then raise exception 'FAIL: second opportunity collision retry'; end if;
  perform public.assign_job_application_cv(app_c,snapshot_cv,'Assigned code fixture',content,'{}',7,'{"contact_email":"employer@example.org"}');
  select to_jsonb(a) into baseline from public.applications a where id=app_c;
  if public.create_job_application(app_c,opportunity_b)<>app_c
    or (select to_jsonb(a) from public.applications a where id=app_c)<>baseline then raise exception 'FAIL: creation retry changed assigned application'; end if;
  if public.assign_job_application_cv(app_c,snapshot_cv,'Assigned code fixture',content,'{}',7,'{"contact_email":"employer@example.org"}')<>snapshot_cv
    or (select application_code from public.applications where id=app_c)<>code_c then raise exception 'FAIL: assignment retry changed code'; end if;
  begin perform public.create_job_application(app_c,opportunity_c); raise exception 'FAIL: changed opportunity retry accepted'; exception when unique_violation then null; end;
  perform set_config('test.application_code.target',app_d::text,true);
  perform set_config('test.application_code.mode','always',true);
  begin
    perform public.create_job_application(app_d,opportunity_c);
    raise exception 'FAIL: exhausted allocation succeeded';
  exception when unique_violation then null; end;
  if exists(select 1 from public.applications where id=app_d) or (select count(*) from public.cv_variants)<>1 then raise exception 'FAIL: collision exhaustion changed application/CV records'; end if;
  perform set_config('test.application_code.target','',true);

  -- Resolution selects the explicitly current immutable request without exposing
  -- private notes or acting as an instruction to publish any new request.
  perform public.save_refinement_state(app_c,setup,'{"cv":null,"letter":null}',0);
  request:=jsonb_build_object('schemaVersion',2,'requestId',request_id,'applicationId',app_c,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',request_id,'fields','[]'::jsonb,'opportunity','{}'::jsonb,'instructions',''),
    'letter',setup||'{"text":""}','scope','cv','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[]}'::jsonb);
  perform public.publish_refinement_request(request);
  result:=public.resolve_application_reference(code_c,'cv');
  if result->>'current_request_id'<>request_id::text or result-array['application_id','application_code','scope','current_request_id']<>'{}'::jsonb then raise exception 'FAIL: current request mapping/privacy'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',user_b,'role','authenticated','is_anonymous',true)::text,true);
  begin perform public.resolve_application_reference(code_b,'cv'); raise exception 'FAIL: anonymous account resolver'; exception when insufficient_privilege then null; end;
  execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
  begin perform public.resolve_application_reference(code_a,'cv'); raise exception 'FAIL: signed-out resolver'; exception when insufficient_privilege then null; end;
  begin perform private.resolve_application_reference(code_a,'cv'); raise exception 'FAIL: signed-out management resolver'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform private.resolve_application_reference(code_a,'cv'); raise exception 'FAIL: service-role management resolver'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if private.resolve_application_reference(' '||lower(code_c)||' ','cv')<>result or private.resolve_application_reference(app_c::text,'cv')<>result then raise exception 'FAIL: management resolver'; end if;
  if private.read_refinement_request((result->>'current_request_id')::uuid)->>'application_id'<>app_c::text then raise exception 'FAIL: resolved wrong immutable request'; end if;
  begin update public.applications set application_code='APP-0000000000' where id=app_a; raise exception 'FAIL: privileged code mutation'; exception when check_violation then null; end;
  begin perform private.resolve_application_reference(gen_random_uuid()::text,'cv'); raise exception 'FAIL: management missing reference'; exception when invalid_parameter_value then null; end;
  begin perform private.resolve_application_reference('APP-%','cv'); raise exception 'FAIL: management wildcard'; exception when invalid_parameter_value then null; end;
end;
$$;
rollback;
select 'PASS: server application codes, immutable identity, creation and assignment retries, cross-owner forced collisions, bounded allocation rollback, owner RLS, admin-only resolution, code/UUID matching and current request mapping. All synthetic fixtures rolled back.' as result;
