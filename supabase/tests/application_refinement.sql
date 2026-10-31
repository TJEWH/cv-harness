-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid();
  app_a uuid:=gen_random_uuid(); app_b uuid:=gen_random_uuid(); cv_a uuid:=gen_random_uuid();
  request_a uuid:=gen_random_uuid(); request_b uuid:=gen_random_uuid(); proposal_a uuid:=gen_random_uuid();
  feedback_a uuid:=gen_random_uuid(); review_a uuid:=gen_random_uuid(); candidate uuid;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z","exampleText":"Dear committee!! I am interested in {{APPLICANT_NAME}}."},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"European region","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Robotics research."}}';
  request jsonb; proposal jsonb; result jsonb; original jsonb; review jsonb; approval jsonb;
  invalid jsonb; current_revision integer; bad_text text; original_source jsonb;
begin
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
          (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title,requirements,required_documents)
    values(opportunity,'refinement-test-'||opportunity::text,'Robotics PhD fixture','[{"text":"400 word motivation letter","status":"required","stage":"recruitment","entity_id":"400-word-motivation-letter"}]','[{"text":"CV","status":"required","stage":"recruitment","entity_id":"cv"},{"text":"Transcript","status":"required","stage":"recruitment","entity_id":"transcript"}]');
  select to_jsonb(o) into original_source from public.opportunities o where id=opportunity;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a,opportunity);
  perform public.assign_job_application_cv(app_a,cv_a,'Refinement CV fixture',content,'{}',7,'{"notes":"Private note excluded"}');
  result:=public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0);
  if result->>'revision'<>'1' then raise exception 'FAIL: initial state revision'; end if;
  begin
    perform public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0);
    raise exception 'FAIL: stale state revision accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.save_refinement_state(app_a,setup||'{"baselineState":{}}','{"cv":null,"letter":null}',1);
    raise exception 'FAIL: private state container accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_refinement_state(app_a,setup,jsonb_build_object('cv','v1:'||repeat('b',64),'letter',null),1);
    raise exception 'FAIL: approval without recorded review';
  exception when check_violation then null; end;
  request:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'applicationId',app_a,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',request_a,'fields',jsonb_build_array(
      jsonb_build_object('id','field-1','label','Profile','text','Research work with {{PRIVATE_1}}.'),
      jsonb_build_object('id','field-2','label','Evidence','text','An explicitly chosen Alex Muster label!!')),
      'opportunity','{}'::jsonb,'instructions','Use evidenced qualifications!!'),
    'letter',setup||'{"text":""}','scope','letter','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure','{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[{"id":"range-1","fieldId":"field-1","bulletId":null,"text":"Research work with {{PRIVATE_1}}.","label":"Profile"}],"unsupported":[{"fieldId":"field-2","reason":"Preserve authored privacy wording."}]}'::jsonb);
  -- Authored CV privacy fields survive unchanged; other input channels still require identity filtering.
  begin
    perform public.publish_refinement_request(jsonb_set(request,'{cv,instructions}','"Alex Muster"'));
    raise exception 'FAIL: unfiltered context identity accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_refinement_request(jsonb_set(request,'{letter,text}','"Alex Muster"'));
    raise exception 'FAIL: unfiltered letter identity accepted';
  exception when invalid_parameter_value then null; end;
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request or original#>>'{opportunity_snapshot,title}'<>'Robotics PhD fixture'
    or original#>>'{cv_snapshot,content,contact,name}'<>'Alex Muster'
    or original#>>'{cv_snapshot,content,contact,location}'<>'European region'
    or original#>'{cv_snapshot,content}'<>content
    or original::text like '%Private note%' or original->>'user_id'<>owner_a::text then
    raise exception 'FAIL: captured context / privacy / ownership';
  end if;
  if public.publish_refinement_request(request)<>original then raise exception 'FAIL: request retry changed receipt'; end if;
  begin
    perform public.publish_refinement_request(jsonb_set(request,'{scope}','"cv"'));
    raise exception 'FAIL: request ID overwrite';
  exception when unique_violation then null; end;
  proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'summary','Emphasized research experience.',
    'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,
    'letterText','Dear committee!! '||repeat('research ',401));
  begin perform private.read_refinement_request(request_a); raise exception 'FAIL: owner accessed management helper'; exception when insufficient_privilege then null; end;
  begin perform private.save_refinement_proposal(request_a,proposal_a,proposal); raise exception 'FAIL: owner wrote management proposal'; exception when insufficient_privilege then null; end;
  begin
    insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json) values(proposal_a,app_a,owner_a,request_a,proposal);
    raise exception 'FAIL: owner direct proposal write';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  if private.read_refinement_request(request_a)<>original then raise exception 'FAIL: management read without JWT'; end if;
  result:=private.save_refinement_proposal(request_a,proposal_a,proposal);
  if result->>'user_id'<>owner_a::text or result->>'application_id'<>app_a::text or private.save_refinement_proposal(request_a,proposal_a,proposal)<>result then raise exception 'FAIL: management ownership / retry'; end if;
  begin
    perform private.save_refinement_proposal(request_a,proposal_a,jsonb_set(proposal,'{summary}','"Different"'));
    raise exception 'FAIL: proposal ID overwrite';
  exception when unique_violation then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'[]'::jsonb,proposal||'{"baselineState":{}}',proposal-'summary',
    jsonb_set(proposal,'{requestId}',to_jsonb(gen_random_uuid())),
    jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]'),
    jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]'),
    jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]'),
    jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]'),
    jsonb_set(proposal,'{letterText}','"Hello <b>HTML</b>"')
  )) loop
    begin perform private.save_refinement_proposal(request_a,gen_random_uuid(),invalid); raise exception 'FAIL: invalid proposal accepted'; exception when invalid_parameter_value then null; end;
  end loop;
  begin
    insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
      values(gen_random_uuid(),app_b,owner_b,request_a,jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]'));
    raise exception 'FAIL: direct write bypassed validation';
  exception when invalid_parameter_value then null; end;
  begin update public.application_refinement_proposals set proposal_json='{}' where id=proposal_a; raise exception 'FAIL: privileged proposal mutation'; exception when check_violation then null; end;
  begin delete from public.application_refinement_requests where id=request_a; raise exception 'FAIL: privileged history delete'; exception when check_violation then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  if (select count(*) from public.application_refinement_proposals where request_id=request_a)<>1 then raise exception 'FAIL: owner cannot read proposal'; end if;
  select revision into current_revision from public.application_refinement_state where application_id=app_a;
  approval:=jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',current_revision);
  result:=public.save_refinement_review(app_a,null,'approve_cv',approval,review_a);
  if (select approvals_json->>'cv' from public.application_refinement_state where application_id=app_a)<>'v1:'||repeat('a',64) then raise exception 'FAIL: approval not atomic'; end if;
  if public.save_refinement_review(app_a,null,'approve_cv',approval,review_a)<>result then raise exception 'FAIL: review retry changed approval'; end if;
  begin perform public.save_refinement_review(app_a,null,'reopen_cv',jsonb_build_object('expectedRevision',current_revision),gen_random_uuid()); raise exception 'FAIL: stale review accepted'; exception when serialization_failure then null; end;
  review:=public.save_refinement_review(app_a,request_a,'feedback','{"text":"Preserve the technical evidence; shorten the letter.","scope":"letter"}',feedback_a);
  if public.save_refinement_review(app_a,request_a,'feedback',review->'payload',feedback_a)<>review then raise exception 'FAIL: feedback retry'; end if;
  request:=jsonb_set(jsonb_set(request,'{requestId}',to_jsonb(request_b)),'{cv,requestId}',to_jsonb(request_b));
  request:=jsonb_set(request,'{parentProposalId}',to_jsonb(proposal_a));
  request:=jsonb_set(request,'{scope}','"letter"');
  begin perform public.publish_refinement_request(request); raise exception 'FAIL: omitted accumulated feedback'; exception when serialization_failure then null; end;
  request:=jsonb_set(request,'{feedback}',jsonb_build_array(jsonb_build_object('id',feedback_a,'text',review#>>'{payload,text}','scope','letter','createdAt',review->>'created_at')));
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request then raise exception 'FAIL: feedback snapshot changed'; end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  proposal:=jsonb_set(proposal,'{requestId}',to_jsonb(request_b));
  begin perform private.save_refinement_proposal(request_b,gen_random_uuid(),jsonb_set(proposal,'{cvOperations}','[{"id":"change-1","type":"invalid"}]')); raise exception 'FAIL: letter-only CV mutation'; exception when invalid_parameter_value then null; end;
  proposal:=jsonb_set(proposal,'{cvOperations}','[]');
  perform private.save_refinement_proposal(request_b,gen_random_uuid(),proposal);
  -- Superseded rounds remain readable but cannot receive new replies.
  begin perform private.save_refinement_proposal(request_a,gen_random_uuid(),jsonb_set(proposal,'{requestId}',to_jsonb(request_a))); raise exception 'FAIL: superseded reply accepted'; exception when serialization_failure then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_b,opportunity);
  if exists(select 1 from public.application_refinement_state where application_id=app_a)
    or exists(select 1 from public.application_refinement_requests where id=request_a)
    or exists(select 1 from public.application_refinement_proposals where request_id=request_a)
    or exists(select 1 from public.application_refinement_reviews where application_id=app_a) then raise exception 'FAIL: cross-owner visibility'; end if;
  begin perform public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0); raise exception 'FAIL: cross-owner state RPC'; exception when insufficient_privilege then null; end;
  begin perform public.save_refinement_review(app_a,null,'feedback','{"text":"Cross owner","scope":"letter"}',gen_random_uuid()); raise exception 'FAIL: cross-owner feedback'; exception when insufficient_privilege then null; end;
  candidate:=gen_random_uuid();
  begin
    perform public.publish_refinement_request(jsonb_set(jsonb_set(request,'{requestId}',to_jsonb(candidate)),'{cv,requestId}',to_jsonb(candidate)));
    raise exception 'FAIL: cross-owner publication';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  if exists(select 1 from public.application_refinement_requests where id=request_a) then raise exception 'FAIL: anonymous-account visibility'; end if;
  begin perform public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0); raise exception 'FAIL: anonymous-account write'; exception when insufficient_privilege then null; end;
  execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
  begin perform 1 from public.application_refinement_requests; raise exception 'FAIL: signed-out table read'; exception when insufficient_privilege then null; end;
  begin perform private.read_refinement_request(request_a); raise exception 'FAIL: signed-out management helper'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform private.read_refinement_request(request_a); raise exception 'FAIL: service-role management helper'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.remove_job_application(app_a);
  if exists(select 1 from public.application_refinement_state where application_id=app_a)
    or exists(select 1 from public.application_refinement_requests where application_id=app_a)
    or exists(select 1 from public.application_refinement_proposals where application_id=app_a)
    or exists(select 1 from public.application_refinement_reviews where application_id=app_a) then raise exception 'FAIL: application cascade'; end if;
  execute 'reset role';
  delete from auth.users where id=owner_a;
  -- A second owner's account removal cascades a complete active refinement graph.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.assign_job_application_cv(app_b,gen_random_uuid(),'Account cascade CV',content,'{}',7,'{}');
  perform public.save_refinement_state(app_b,setup,'{"cv":null,"letter":null}',0);
  candidate:=gen_random_uuid();
  request:=request||jsonb_build_object('requestId',candidate,'applicationId',app_b,'scope','cv','feedback','[]'::jsonb,'parentProposalId',null);
  request:=jsonb_set(request,'{cv,requestId}',to_jsonb(candidate));
  perform public.publish_refinement_request(request);
  execute 'reset role';
  proposal:=jsonb_set(proposal,'{requestId}',to_jsonb(candidate));
  begin perform private.save_refinement_proposal(candidate,gen_random_uuid(),proposal); raise exception 'FAIL: CV-only changed letter'; exception when invalid_parameter_value then null; end;
  perform private.save_refinement_proposal(candidate,gen_random_uuid(),jsonb_set(proposal,'{letterText}','""'));
  delete from auth.users where id=owner_b;
  if exists(select 1 from public.application_refinement_state where user_id=owner_b)
    or exists(select 1 from public.application_refinement_requests where user_id=owner_b)
    or exists(select 1 from public.application_refinement_proposals where user_id=owner_b) then raise exception 'FAIL: account cascade'; end if;
  if (select to_jsonb(o) from public.opportunities o where id=opportunity)<>original_source then raise exception 'FAIL: shared opportunity mutation'; end if;
end;
$$;
rollback;
select 'PASS: refinement setup, immutable captured context, 400-word advisory, atomic approvals, feedback accumulation, scoped proposals, private-token checks, owner RLS, admin-only MCP, retries and cascades; synthetic fixtures rolled back.' as result;
