-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
  opportunity_a uuid:=gen_random_uuid(); opportunity_b uuid:=gen_random_uuid(); opportunity_c uuid:=gen_random_uuid();
  app_a uuid:=gen_random_uuid(); app_b uuid:=gen_random_uuid(); app_c uuid:=gen_random_uuid(); empty_app uuid:=gen_random_uuid();
  request_ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  proposal_ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  app_ids uuid[]; owner_ids uuid[]; opportunity_ids uuid[]; idx integer;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z"},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Robotics research."}}';
  request jsonb; proposal jsonb; saved_state jsonb; result jsonb; current_revision integer;
  saved_applications jsonb; saved_cvs jsonb; saved_opportunities jsonb; saved_other_states jsonb;
  saved_requests jsonb; saved_proposals jsonb; saved_reviews jsonb; candidate uuid;
begin
  app_ids:=array[app_a,app_b,app_c];
  owner_ids:=array[owner_a,owner_b,owner_a];
  opportunity_ids:=array[opportunity_a,opportunity_a,opportunity_b];
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
          (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title)
    values(opportunity_a,'clear-history-'||opportunity_a::text,'History fixture A'),
          (opportunity_b,'clear-history-'||opportunity_b::text,'History fixture B'),
          (opportunity_c,'clear-history-'||opportunity_c::text,'Empty history fixture');
  for idx in 1..3 loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_ids[idx],'role','authenticated','is_anonymous',false)::text,true);
    execute 'set local role authenticated';
    perform public.create_job_application(app_ids[idx],opportunity_ids[idx]);
    perform public.assign_job_application_cv(app_ids[idx],gen_random_uuid(),'History CV '||idx::text,content,'{}',7,'{"notes":"Keep application notes"}');
    perform public.save_refinement_state(app_ids[idx],setup,'{"cv":null,"letter":null}',0);
    request:=jsonb_build_object('schemaVersion',2,'requestId',request_ids[idx],'applicationId',app_ids[idx],
      'cv',jsonb_build_object('schemaVersion',1,'requestId',request_ids[idx],
        'fields',jsonb_build_array(jsonb_build_object('id','field-1','label','Profile','text','Robotics research.')),
        'opportunity','{}'::jsonb,'instructions','Preserve evidence.'),
      'letter',setup||'{"text":"Original letter."}','scope','letter','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[{"fieldId":"field-1","reason":"Keep source evidence unchanged."}]}'::jsonb);
    perform public.publish_refinement_request(request);
    perform public.save_refinement_review(app_ids[idx],request_ids[idx],'feedback','{"text":"Focus on research.","scope":"letter"}',gen_random_uuid());
    execute 'reset role';
    proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_ids[idx],'summary','Research draft.',
      'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,'letterText','A complete research letter.');
    perform private.save_refinement_proposal(request_ids[idx],proposal_ids[idx],proposal);
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  select revision into current_revision from public.application_refinement_state where application_id=app_a;
  perform public.save_refinement_review(app_a,null,'approve_cv',jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',current_revision),gen_random_uuid());
  select revision into current_revision from public.application_refinement_state where application_id=app_a;
  perform public.save_refinement_review(app_a,null,'approve_letter',jsonb_build_object('revision','v1:'||repeat('b',64),'expectedRevision',current_revision),gen_random_uuid());
  select to_jsonb(s),s.revision into saved_state,current_revision from public.application_refinement_state s where application_id=app_a;
  perform public.create_job_application(empty_app,opportunity_c);
  if public.clear_refinement_history(empty_app,0) is distinct from 'null'::jsonb then raise exception 'FAIL: empty owned history receipt'; end if;
  begin perform public.clear_refinement_history(empty_app,1); raise exception 'FAIL: missing state stale revision accepted'; exception when serialization_failure then null; end;
  begin perform public.clear_refinement_history(app_a,0); raise exception 'FAIL: existing state zero revision accepted'; exception when serialization_failure then null; end;
  begin perform public.clear_refinement_history(app_a,current_revision-1); raise exception 'FAIL: stale history clear accepted'; exception when serialization_failure then null; end;
  begin perform public.clear_refinement_history(app_a,null); raise exception 'FAIL: null revision accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.clear_refinement_history(app_b,current_revision); raise exception 'FAIL: cross-owner clear accepted'; exception when insufficient_privilege then null; end;
  begin perform private.clear_refinement_history(app_b,current_revision); raise exception 'FAIL: private helper bypassed ownership'; exception when insufficient_privilege then null; end;
  begin perform private.read_refinement_request(request_ids[1]); raise exception 'FAIL: schema usage exposed management read'; exception when insufficient_privilege then null; end;
  begin perform private.save_refinement_proposal(request_ids[1],gen_random_uuid(),proposal); raise exception 'FAIL: schema usage exposed management write'; exception when insufficient_privilege then null; end;
  perform set_config('cv_builder.clearing_refinement_history',owner_a::text||':'||app_a::text,true);
  begin delete from public.application_refinement_requests where application_id=app_a; raise exception 'FAIL: client spoofed history deletion scope'; exception when insufficient_privilege then null; end;
  perform set_config('cv_builder.clearing_refinement_history','',true);
  if (select to_jsonb(s) from public.application_refinement_state s where application_id=app_a)<>saved_state
    or not exists(select 1 from public.application_refinement_requests where id=request_ids[1])
    or not exists(select 1 from public.application_refinement_proposals where id=proposal_ids[1])
    or (select count(*) from public.application_refinement_reviews where application_id=app_a)<>3 then
    raise exception 'FAIL: rejected clears changed state or history';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  begin perform public.clear_refinement_history(app_a,current_revision); raise exception 'FAIL: anonymous account clear'; exception when insufficient_privilege then null; end;
  begin perform private.clear_refinement_history(app_a,current_revision); raise exception 'FAIL: private helper allowed anonymous account'; exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  begin perform public.clear_refinement_history(app_a,current_revision); raise exception 'FAIL: anon endpoint access'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform public.clear_refinement_history(app_a,current_revision); raise exception 'FAIL: service-role endpoint access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  begin delete from public.application_refinement_requests where id=request_ids[1]; raise exception 'FAIL: ordinary postgres request deletion allowed'; exception when check_violation then null; end;
  begin delete from public.application_refinement_proposals where id=proposal_ids[1]; raise exception 'FAIL: ordinary postgres proposal deletion allowed'; exception when check_violation then null; end;
  begin delete from public.application_refinement_reviews where application_id=app_a; raise exception 'FAIL: ordinary postgres review deletion allowed'; exception when check_violation then null; end;
  begin update public.application_refinement_proposals set proposal_json=proposal_json where id=proposal_ids[1]; raise exception 'FAIL: proposal update allowed'; exception when check_violation then null; end;
  select jsonb_agg(to_jsonb(a) order by a.id) into saved_applications from public.applications a where a.id=any(app_ids||array[empty_app]);
  select jsonb_agg(to_jsonb(c) order by c.id) into saved_cvs from public.cv_variants c where user_id in (owner_a,owner_b);
  select jsonb_agg(to_jsonb(o) order by o.id) into saved_opportunities from public.opportunities o where o.id=any(opportunity_ids||array[opportunity_c]);
  select jsonb_agg(to_jsonb(s) order by s.application_id) into saved_other_states from public.application_refinement_state s where s.application_id in (app_b,app_c);
  select jsonb_agg(to_jsonb(r) order by r.id) into saved_requests from public.application_refinement_requests r where r.application_id in (app_b,app_c);
  select jsonb_agg(to_jsonb(p) order by p.id) into saved_proposals from public.application_refinement_proposals p where p.application_id in (app_b,app_c);
  select jsonb_agg(to_jsonb(r) order by r.id) into saved_reviews from public.application_refinement_reviews r where r.application_id in (app_b,app_c);
  execute 'set local role authenticated';
  result:=public.clear_refinement_history(app_a,current_revision);
  if result->'setup_json'<>saved_state->'setup_json' or result->'approvals_json'<>saved_state->'approvals_json'
    or result->>'application_id'<>app_a::text or result->>'user_id'<>owner_a::text
    or result->'current_request_id'<>'null'::jsonb or (result->>'revision')::integer<>current_revision+1 then
    raise exception 'FAIL: clear receipt changed preparation or approvals';
  end if;
  if exists(select 1 from public.application_refinement_requests where application_id=app_a)
    or exists(select 1 from public.application_refinement_proposals where application_id=app_a)
    or exists(select 1 from public.application_refinement_reviews where application_id=app_a) then
    raise exception 'FAIL: incomplete history removal';
  end if;
  begin perform public.clear_refinement_history(app_a,current_revision); raise exception 'FAIL: stale retry accepted'; exception when serialization_failure then null; end;
  result:=public.clear_refinement_history(app_a,current_revision+1);
  if (result->>'revision')::integer<>current_revision+2 or result->'approvals_json'<>saved_state->'approvals_json' then raise exception 'FAIL: clearing an already-empty history'; end if;
  execute 'reset role';
  if (select jsonb_agg(to_jsonb(a) order by a.id) from public.applications a where a.id=any(app_ids||array[empty_app]))<>saved_applications
    or (select jsonb_agg(to_jsonb(c) order by c.id) from public.cv_variants c where user_id in (owner_a,owner_b))<>saved_cvs
    or (select jsonb_agg(to_jsonb(o) order by o.id) from public.opportunities o where o.id=any(opportunity_ids||array[opportunity_c]))<>saved_opportunities
    or (select jsonb_agg(to_jsonb(s) order by s.application_id) from public.application_refinement_state s where s.application_id in (app_b,app_c))<>saved_other_states
    or (select jsonb_agg(to_jsonb(r) order by r.id) from public.application_refinement_requests r where r.application_id in (app_b,app_c))<>saved_requests
    or (select jsonb_agg(to_jsonb(p) order by p.id) from public.application_refinement_proposals p where p.application_id in (app_b,app_c))<>saved_proposals
    or (select jsonb_agg(to_jsonb(r) order by r.id) from public.application_refinement_reviews r where r.application_id in (app_b,app_c))<>saved_reviews then
    raise exception 'FAIL: clear changed application documents or another history';
  end if;
  proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_ids[1],'summary','Late draft.', 'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,'letterText','Late complete letter.');
  begin perform private.save_refinement_proposal(request_ids[1],gen_random_uuid(),proposal); raise exception 'FAIL: late proposal revived cleared history'; exception when invalid_parameter_value then null; end;
  begin delete from public.application_refinement_requests where id=request_ids[3]; raise exception 'FAIL: deletion scope leaked after RPC'; exception when check_violation then null; end;
  if has_table_privilege('authenticated','public.application_refinement_requests','DELETE')
    or has_table_privilege('authenticated','public.application_refinement_proposals','DELETE')
    or has_table_privilege('authenticated','public.application_refinement_reviews','DELETE')
    or not has_function_privilege('authenticated','private.clear_refinement_history(uuid,integer)','EXECUTE')
    or has_function_privilege('authenticated','private.read_refinement_request(uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.save_refinement_proposal(uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','private.resolve_application_reference(text)','EXECUTE')
    or has_schema_privilege('authenticated','private','CREATE')
    or has_function_privilege('anon','public.clear_refinement_history(uuid,integer)','EXECUTE')
    or has_function_privilege('service_role','public.clear_refinement_history(uuid,integer)','EXECUTE') then
    raise exception 'FAIL: history deletion privileges exceed the scoped helper';
  end if;
  -- Existing application cascades still work with the stricter direct-delete path.
  execute 'set local role authenticated';
  perform public.remove_job_application(app_c);
  if exists(select 1 from public.application_refinement_requests where application_id=app_c) then raise exception 'FAIL: application deletion cascade'; end if;
  execute 'reset role';
end;
$$;
rollback;
select 'PASS: owner-scoped atomic history clearing, revision conflicts, preserved documents/setup/approvals, missing state, immutable direct writes, late proposal rejection and scoped helper grants; synthetic fixtures rolled back.' as result;
