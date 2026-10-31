-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
  attachment_a uuid:=gen_random_uuid(); attachment_b uuid:=gen_random_uuid();
  opportunity uuid:=gen_random_uuid(); application_a uuid:=gen_random_uuid();
  invalid text; saved jsonb; original_application jsonb; invalid_count integer:=0;
begin
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema='public' and table_name='local_attachment_metadata')
    <>array['id','user_id','name','description'] then
    raise exception 'FAIL: attachment table contains file content or additional metadata columns';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.local_attachment_metadata'::regclass)
    or exists(select 1 from pg_proc where oid in (
      'public.save_local_attachment_metadata(uuid,text,text)'::regprocedure,
      'public.delete_local_attachment_metadata(uuid)'::regprocedure) and prosecdef)
    or has_table_privilege('anon','public.local_attachment_metadata','select')
    or has_table_privilege('service_role','public.local_attachment_metadata','select')
    or has_column_privilege('authenticated','public.local_attachment_metadata','id','update')
    or has_column_privilege('authenticated','public.local_attachment_metadata','user_id','update')
    or has_function_privilege('anon','public.save_local_attachment_metadata(uuid,text,text)','execute')
    or has_function_privilege('service_role','public.save_local_attachment_metadata(uuid,text,text)','execute')
    or has_function_privilege('anon','public.delete_local_attachment_metadata(uuid)','execute')
    or has_function_privilege('service_role','public.delete_local_attachment_metadata(uuid)','execute') then
    raise exception 'FAIL: attachment security boundary is not owner-only';
  end if;
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
    (owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
    (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title) values
    (opportunity,'attachment-test-'||opportunity::text,'Synthetic attachment application');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(application_a,opportunity);
  original_application:=(select to_jsonb(a) from public.applications a where id=application_a);
  saved:=public.save_local_attachment_metadata(attachment_a,' Transcript of records ',E'\nCoursework and grades selected by the user.\n');
  if saved<>jsonb_build_object('id',attachment_a,'user_id',owner_a,'name','Transcript of records','description','Coursework and grades selected by the user.')
    or saved<>public.save_local_attachment_metadata(attachment_a,'Transcript of records','Coursework and grades selected by the user.') then
    raise exception 'FAIL: metadata round trip, trimming or retry changed the user description';
  end if;
  perform public.save_local_attachment_metadata(attachment_a,'Transcript','Revised manual description.');
  if (select count(*) from public.local_attachment_metadata where id=attachment_a)<>1
    or (select description from public.local_attachment_metadata where id=attachment_a)<>'Revised manual description.' then
    raise exception 'FAIL: update duplicated attachment or lost manually entered description';
  end if;
  perform public.save_local_attachment_metadata(attachment_b,repeat('😀',100),repeat('😀',2000));
  perform public.save_local_attachment_metadata(attachment_b,U&'\00a0Transcript\feff',E'Coursework\nGrades\tContext\rEnd');
  if (select name from public.local_attachment_metadata where id=attachment_b)<>'Transcript' then
    raise exception 'FAIL: Unicode whitespace differs from JavaScript trim';
  end if;
  foreach invalid in array array['',E' \t\n',U&'\00a0\feff',repeat('a',201),repeat('😀',101),E'Name\nLine','Name'||chr(1),'Name'||chr(127)] loop
    begin
      perform public.save_local_attachment_metadata(attachment_b,invalid,'Valid user description.');
      raise exception 'FAIL: invalid attachment name accepted';
    exception when check_violation then invalid_count:=invalid_count+1; end;
  end loop;
  foreach invalid in array array['',E' \t\n',U&'\00a0\feff',repeat('a',4001),repeat('😀',2001),'Description'||chr(1),'Description'||chr(127)] loop
    begin
      perform public.save_local_attachment_metadata(attachment_b,'Valid user name',invalid);
      raise exception 'FAIL: invalid attachment description accepted';
    exception when check_violation then invalid_count:=invalid_count+1; end;
  end loop;
  if invalid_count<>15 then raise exception 'FAIL: incomplete invalid metadata coverage'; end if;
  begin
    perform public.save_local_attachment_metadata(attachment_b,null,'Valid');
    raise exception 'FAIL: null name accepted';
  exception when not_null_violation then null; end;
  begin
    perform public.save_local_attachment_metadata(attachment_b,'Valid',null);
    raise exception 'FAIL: null description accepted';
  exception when not_null_violation then null; end;
  begin
    update public.local_attachment_metadata set user_id=owner_b where id=attachment_a;
    raise exception 'FAIL: owner changed';
  exception when insufficient_privilege then null; end;
  begin
    update public.local_attachment_metadata set id=gen_random_uuid() where id=attachment_a;
    raise exception 'FAIL: identity changed';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  if exists(select 1 from public.local_attachment_metadata where id in (attachment_a,attachment_b)) then
    raise exception 'FAIL: another owner read attachment metadata';
  end if;
  begin
    perform public.save_local_attachment_metadata(attachment_a,'Spoofed','Other account update.');
    raise exception 'FAIL: another owner overwrote attachment metadata';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.local_attachment_metadata values(gen_random_uuid(),owner_a,'Spoofed','Other account insert.');
    raise exception 'FAIL: forged attachment ownership accepted';
  exception when insufficient_privilege then null; end;
  perform public.delete_local_attachment_metadata(attachment_a);
  update public.local_attachment_metadata set name='Spoofed' where id=attachment_a;
  if found then raise exception 'FAIL: direct cross-owner update succeeded'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  if exists(select 1 from public.local_attachment_metadata where id=attachment_a) then raise exception 'FAIL: anonymous account read attachment metadata'; end if;
  begin
    perform public.save_local_attachment_metadata(attachment_a,'Anonymous','Anonymous description.');
    raise exception 'FAIL: anonymous account saved attachment metadata';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delete_local_attachment_metadata(attachment_a);
    raise exception 'FAIL: anonymous account deleted attachment metadata';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.save_local_attachment_metadata(attachment_a,'No identity','Missing identity.');
    raise exception 'FAIL: missing identity saved attachment metadata';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  if (select name from public.local_attachment_metadata where id=attachment_a)<>'Transcript'
    or original_application<>(select to_jsonb(a) from public.applications a where id=application_a)
    or exists(select 1 from public.application_refinement_requests where application_id=application_a) then
    raise exception 'FAIL: metadata operations changed application/refinement state or another account data';
  end if;
  perform public.delete_local_attachment_metadata(attachment_a);
  perform public.delete_local_attachment_metadata(attachment_a);
  if exists(select 1 from public.local_attachment_metadata where id=attachment_a) then raise exception 'FAIL: removal/retry retained metadata'; end if;
  execute 'reset role';
  delete from auth.users where id=owner_a;
  if exists(select 1 from public.local_attachment_metadata where user_id=owner_a) then raise exception 'FAIL: deleted account retained metadata'; end if;
end;
$$;
rollback;
select 'local attachment metadata checks passed' as result;
