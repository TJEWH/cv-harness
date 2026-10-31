-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid();
  app_a uuid:=gen_random_uuid(); app_b uuid:=gen_random_uuid(); request_a uuid:=gen_random_uuid();
  request_b uuid:=gen_random_uuid(); request_c uuid:=gen_random_uuid(); proposal_a uuid:=gen_random_uuid();
  legacy_request uuid:=gen_random_uuid(); legacy_proposal uuid:=gen_random_uuid(); review_a uuid:=gen_random_uuid(); candidate uuid;
  setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-09-22T00:00:00Z"},"language":"en","maxWords":400}';
  content jsonb:='{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Research evidence."}}';
  fields jsonb:=jsonb_build_array(
    jsonb_build_object('id','field-1','label','Research bullets','text',E'Built robust Alex Muster research tools with {{PRIVATE_1}}.\nDocumented reproducible workflows.'),
    jsonb_build_object('id','field-2','label','Second entry','text','Evaluated prototpe systems carefully.'),
    jsonb_build_object('id','field-3','label','Profile','text','Study research evidence https://example.invalid/report and method.'),
    jsonb_build_object('id','field-4','label','Complex block','text','Nested data untouched.'));
  structure jsonb:='{"schemaVersion":1,"areas":[{"id":"body","sectionIds":["section-1","section-2"]},{"id":"sidebar","sectionIds":["section-3"]}],"sections":[{"id":"section-1","label":"Research","area":"body","entryIds":["entry-1","entry-2"]},{"id":"section-2","label":"Profile","area":"body","entryIds":["entry-3"]},{"id":"section-3","label":"Skills","area":"sidebar","entryIds":[]}],"entries":[{"id":"entry-1","sectionId":"section-1","label":"Research role","bulletIds":["bullet-1","bullet-2"]},{"id":"entry-2","sectionId":"section-1","label":"Second role","bulletIds":["bullet-3"]},{"id":"entry-3","sectionId":"section-2","label":"Profile","bulletIds":[]}],"bullets":[{"id":"bullet-1","entryId":"entry-1","fieldId":"field-1","text":"Built robust Alex Muster research tools with {{PRIVATE_1}}."},{"id":"bullet-2","entryId":"entry-1","fieldId":"field-1","text":"Documented reproducible workflows."},{"id":"bullet-3","entryId":"entry-2","fieldId":"field-2","text":"Evaluated prototpe systems carefully."}],"ranges":[{"id":"range-1","fieldId":"field-1","bulletId":"bullet-1","text":"Built robust Alex Muster research tools with {{PRIVATE_1}}.","label":"First bullet"},{"id":"range-2","fieldId":"field-1","bulletId":"bullet-2","text":"Documented reproducible workflows.","label":"Second bullet"},{"id":"range-3","fieldId":"field-2","bulletId":"bullet-3","text":"Evaluated prototpe systems carefully.","label":"Third bullet"},{"id":"range-4","fieldId":"field-3","bulletId":null,"text":"Study research evidence https://example.invalid/report and method.","label":"Profile"}],"unsupported":[{"fieldId":"field-4","reason":"Nested structure remains unchanged."}]}';
  operations jsonb:='[{"id":"change-1","type":"reorder_sections","targetId":"body","explanation":"Prioritize the profile.","order":["section-2","section-1"]},{"id":"change-2","type":"reorder_entries","targetId":"section-1","explanation":"Prioritize recent evidence.","order":["entry-2","entry-1"]},{"id":"change-3","type":"reorder_bullets","targetId":"entry-1","explanation":"Move reproducibility earlier.","order":["bullet-2","bullet-1"]},{"id":"change-4","type":"omit_bullet","targetId":"bullet-2","explanation":"Remove less relevant detail."},{"id":"change-5","type":"shorten_text","targetId":"range-1","explanation":"Keep the evidence concise.","text":"Built tools with {{PRIVATE_1}}."},{"id":"change-6","type":"shorten_text","targetId":"range-4","explanation":"Remove redundant wording.","text":"Study evidence https://example.invalid/report and method."}]';
  request jsonb; proposal jsonb; invalid jsonb; original jsonb; receipt jsonb; decisions jsonb; prior_state jsonb;
  unicode_request jsonb; unicode_proposal jsonb;
  current_revision integer; invalid_count integer:=0;
begin
  if public.refinement_utf16_length('')<>0 or public.refinement_utf16_length('a😀é')<>4 then raise exception 'FAIL: UTF16 length'; end if;
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
    (owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
    (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title,requirements,required_documents)
    values(opportunity,'structured-test-'||opportunity::text,'Structured CV fixture','[{"text":"400 word motivation letter","status":"required","stage":"recruitment","entity_id":"400-word-motivation-letter"}]','[{"text":"CV","status":"required","stage":"recruitment","entity_id":"cv"}]');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a,opportunity);
  perform public.assign_job_application_cv(app_a,gen_random_uuid(),'Structured fixture',content,'{}',7,'{}');
  perform public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0);
  request:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'applicationId',app_a,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',request_a,'fields',fields,'opportunity','{}'::jsonb,'instructions','Preserve evidence.'),
    'letter',setup||'{"text":"Existing letter."}','scope','cv','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure',structure);
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request or public.publish_refinement_request(request)<>original then raise exception 'FAIL: v2 immutable request receipt'; end if;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(structure,'{sections,0,label}',to_jsonb(repeat('😀',101))),
    jsonb_set(structure,'{unsupported,0,reason}',to_jsonb(repeat('😀',600))),
    structure||'{"paths":[]}',structure-'ranges',jsonb_set(structure,'{sections,0,label}','" "'),jsonb_set(structure,'{ranges,0,label}','""'),
    jsonb_set(structure,'{bullets,0,text}',to_jsonb(E'Built robust Alex Muster research tools with {{PRIVATE_1}}.\nDocumented reproducible workflows.'::text)), jsonb_set(structure,'{areas,0,sectionIds}','["section-1","section-3"]'),
    jsonb_set(structure,'{areas,0,sectionIds}','["section-1","section-1"]'),jsonb_set(structure,'{sections,0,entryIds}','["entry-1"]'),
    jsonb_set(structure,'{entries,0,bulletIds}','["bullet-1","bullet-3"]'),jsonb_set(structure,'{entries,0,sectionId}','"section-999"'),
    jsonb_set(structure,'{bullets,0,fieldId}','"field-999"'),jsonb_set(structure,'{bullets,0,text}','"Invented evidence."'),
    jsonb_set(structure,'{ranges,0,text}','"Built"'),jsonb_set(structure,'{ranges,3,text}','"Study"'),
    jsonb_set(structure,'{ranges,1,bulletId}','"bullet-1"'),jsonb_set(structure,'{ranges,0,bulletId}','null'),
    jsonb_set(structure,'{unsupported,0,fieldId}','"field-1"'),jsonb_set(structure,'{unsupported,0,reason}','""'),
    jsonb_set(structure,'{bullets,1,id}','"bullet-1"'),jsonb_set(structure,'{areas}','[]')
  )) loop
    candidate:=gen_random_uuid();
    begin
      perform public.publish_refinement_request(jsonb_set(jsonb_set(request||jsonb_build_object('requestId',candidate,'cvStructure',invalid),'{cv,requestId}',to_jsonb(candidate)),'{schemaVersion}','2'));
      raise exception 'FAIL: invalid structure accepted: %',invalid;
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'summary','Order evidence and remove redundant wording.',
    'cvOperations',operations,'cvComments','[{"id":"comment-1","fieldId":"field-4","explanation":"Review this nested block manually."}]'::jsonb,
    'letterText','Existing letter.');
  begin perform private.save_refinement_proposal(request_a,proposal_a,proposal); raise exception 'FAIL: owner wrote management proposal'; exception when insufficient_privilege then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  perform public.refinement_validate_cv_operations(jsonb_set(proposal,'{cvOperations,0,explanation}',to_jsonb(repeat('😀',500))),request,request_a);
  receipt:=private.save_refinement_proposal(request_a,proposal_a,proposal);
  if private.save_refinement_proposal(request_a,proposal_a,proposal)<>receipt or receipt->>'user_id'<>owner_a::text then raise exception 'FAIL: v2 proposal receipt/ownership'; end if;
  receipt:=private.save_refinement_proposal(request_a,gen_random_uuid(),jsonb_set(proposal,'{cvOperations}',
    '[{"id":"change-1","type":"fix_typos","targetId":"range-3","text":"Evaluated prototype systems carefully.","explanation":"Correct the spelling of prototype."}]'::jsonb));
  if receipt#>>'{proposal_json,cvOperations,0,type}' is distinct from 'fix_typos' then raise exception 'FAIL: typo operation not persisted'; end if;
  begin perform private.save_refinement_proposal(request_a,proposal_a,proposal||'{"summary":"Changed"}'); raise exception 'FAIL: conflicting retry accepted'; exception when unique_violation then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(proposal,'{cvOperations,0,explanation}',to_jsonb(repeat('😀',600))),
    jsonb_set(proposal,'{cvComments,0,explanation}',to_jsonb(repeat('😀',600))),
    proposal||'{"cvEdits":[]}',proposal-'cvComments',proposal||'{"schemaVersion":1}',
    jsonb_set(proposal,'{cvOperations,1}', '{"id":"change-2","type":"reorder_entries","targetId":"section-3","order":[],"explanation":"Invalid empty container."}'),
    jsonb_set(proposal,'{cvOperations,4,text}',to_jsonb(E'Built tools\nwith {{PRIVATE_1}}.'::text)),
    jsonb_set(proposal,'{cvOperations,0,order}','["section-1"]'),jsonb_set(proposal,'{cvOperations,0,order}','["section-1","section-1"]'),
    jsonb_set(proposal,'{cvOperations,0,order}','["section-1","section-3"]'),jsonb_set(proposal,'{cvOperations,0,targetId}','"section-1"'),
    jsonb_set(proposal,'{cvOperations,1,order}','["entry-1","entry-3"]'),jsonb_set(proposal,'{cvOperations,2,order}','["bullet-1","bullet-3"]'),
    jsonb_set(proposal,'{cvOperations,3,targetId}','"bullet-999"'),jsonb_set(proposal,'{cvOperations,3,text}','"extra"'),
    jsonb_set(proposal,'{cvOperations,3,type}','"add_bullet"'),jsonb_set(proposal,'{cvOperations,3,id}','"change-1"'),
    jsonb_set(proposal,'{cvOperations,3,explanation}','""'),jsonb_set(proposal,'{cvOperations,4,targetId}','"range-999"'),
    jsonb_set(proposal,'{cvOperations,4,text}','"Built novel tools with {{PRIVATE_1}}."'),
    jsonb_set(proposal,'{cvOperations,4,text}','"tools Built with {{PRIVATE_1}}."'),
    jsonb_set(proposal,'{cvOperations,4,text}','"Built tools."'),jsonb_set(proposal,'{cvOperations,4,text}','"built tools with {{PRIVATE_1}}."'),
    jsonb_set(proposal,'{cvOperations,4,text}',structure#>'{ranges,0,text}'),jsonb_set(proposal,'{cvOperations,4,text}','""'),
    jsonb_set(proposal,'{cvOperations,5,text}','"Study evidence and method."'),
    jsonb_set(proposal,'{cvOperations,5,text}','"Study evidence https://evil.invalid/report and method."'),
    jsonb_set(proposal,'{cvOperations,3,targetId}','"bullet-1"'),
    jsonb_set(proposal,'{cvOperations}',operations||jsonb_build_array(jsonb_set(operations->0,'{id}','"change-7"'))),
    jsonb_set(proposal,'{cvOperations}',operations||jsonb_build_array(jsonb_set(operations->4,'{id}','"change-7"'))),
    jsonb_set(proposal,'{cvComments,0,fieldId}','"field-999"'),jsonb_set(proposal,'{cvComments,0,text}','"Mutation"'),
    jsonb_set(proposal,'{letterText}','"Dear {{PRIVATE_1}}"')
  )) loop
    begin perform private.save_refinement_proposal(request_a,gen_random_uuid(),invalid); raise exception 'FAIL: invalid operation/proposal accepted: %',invalid;
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  -- Unicode codepoints, non-ASCII words and Unicode whitespace follow the same extractive rule.
  perform public.refinement_validate_cv_operations(
    '{"cvOperations":[{"id":"change-1","type":"shorten_text","targetId":"range-1","explanation":"Shorter","text":"Étude méthode."}],"cvComments":[]}',
    jsonb_build_object('cvStructure',jsonb_build_object('ranges',jsonb_build_array(jsonb_build_object('id','range-1','fieldId','field-1','bulletId',null,'text',E'Étude\u00a0de méthode.'))),'cv',jsonb_build_object('fields',fields)),request_a);
  unicode_request:=jsonb_set(jsonb_set(request,'{cv,fields,2,text}',to_jsonb(E'Study research https://example.invalid/report\u00a0and method.'::text)),
    '{cvStructure,ranges,3,text}',to_jsonb(E'Study research https://example.invalid/report\u00a0and method.'::text));
  unicode_proposal:='{"cvOperations":[{"id":"change-1","type":"shorten_text","targetId":"range-4","explanation":"Shorter","text":"Study https://example.invalid/report and method."}],"cvComments":[]}';
  perform public.refinement_validate_cv_structure(unicode_request->'cvStructure',unicode_request#>'{cv,fields}');
  perform public.refinement_validate_cv_operations(unicode_proposal,unicode_request,request_a);
  perform public.refinement_validate_cv_operations(jsonb_set(unicode_proposal,'{cvOperations,0,text}',to_jsonb(E'Study https://example.invalid/report\u00a0method.'::text)),unicode_request,request_a);
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(unicode_proposal,'{cvOperations,0,text}','"Study method."'),
    jsonb_set(unicode_proposal,'{cvOperations,0,text}','"Study https://other.invalid/report and method."')
  )) loop
    begin perform public.refinement_validate_cv_operations(invalid,unicode_request,request_a); raise exception 'FAIL: Unicode-space URL protection';
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  begin update public.application_refinement_proposals set proposal_json='{}' where id=proposal_a; raise exception 'FAIL: proposal history mutable'; exception when check_violation then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  decisions:=jsonb_build_object('proposalId',proposal_a,'accepted','["change-1","change-5"]'::jsonb,'rejected','["change-2","change-3","change-4","change-6"]'::jsonb,'revision','v1:'||repeat('a',64));
  select to_jsonb(s) into prior_state from public.application_refinement_state s where application_id=app_a;
  receipt:=public.save_refinement_review(app_a,request_a,'cv_decisions',decisions,review_a);
  if public.save_refinement_review(app_a,request_a,'cv_decisions',decisions,review_a)<>receipt then raise exception 'FAIL: decision retry'; end if;
  if (select to_jsonb(s) from public.application_refinement_state s where application_id=app_a)<>prior_state then raise exception 'FAIL: decisions changed approval/state'; end if;
  begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',decisions||'{"accepted":[]}',review_a); raise exception 'FAIL: changed decision retry'; exception when unique_violation then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    decisions||'{"extra":true}',decisions-'revision',decisions||'{"revision":"raw private content"}',
    decisions||'{"accepted":[]}',decisions||'{"accepted":["change-1","change-1"]}',
    decisions||'{"accepted":["change-1","change-2"]}',decisions||'{"accepted":["change-1","change-999"]}'
  )) loop
    begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',invalid,gen_random_uuid()); raise exception 'FAIL: invalid partition accepted';
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  begin perform public.save_refinement_review(app_a,null,'cv_decisions',decisions,gen_random_uuid()); raise exception 'FAIL: unbound decision accepted'; exception when serialization_failure then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',decisions||jsonb_build_object('proposalId',gen_random_uuid()),gen_random_uuid()); raise exception 'FAIL: unknown proposal accepted'; exception when insufficient_privilege then null; end;
  select revision into current_revision from public.application_refinement_state where application_id=app_a;
  perform public.save_refinement_review(app_a,request_a,'approve_cv',jsonb_build_object('revision','v1:'||repeat('a',64),'expectedRevision',current_revision),gen_random_uuid());
  begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',decisions,gen_random_uuid()); raise exception 'FAIL: approved CV accepted operations'; exception when invalid_parameter_value then null; end;
  perform public.save_refinement_review(app_a,request_a,'cv_decisions',jsonb_set(jsonb_set(decisions,'{accepted}','[]'),'{rejected}','["change-1","change-2","change-3","change-4","change-5","change-6"]'),gen_random_uuid());
  request:=jsonb_set(request||jsonb_build_object('requestId',request_b,'scope','letter'),'{cv,requestId}',to_jsonb(request_b));
  perform public.publish_refinement_request(request);
  begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',decisions,gen_random_uuid()); raise exception 'FAIL: stale decision accepted'; exception when invalid_parameter_value then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  proposal:=proposal||jsonb_build_object('requestId',request_b);
  begin perform private.save_refinement_proposal(request_b,gen_random_uuid(),proposal); raise exception 'FAIL: letter scope accepted CV operations'; exception when invalid_parameter_value then null; end;
  perform private.save_refinement_proposal(request_b,gen_random_uuid(),proposal||'{"cvOperations":[],"cvComments":[]}');
  -- Late results remain readable; decisions on them stay blocked by current_request_id.
  perform private.save_refinement_proposal(request_a,gen_random_uuid(),proposal||jsonb_build_object('requestId',request_a));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  select revision into current_revision from public.application_refinement_state where application_id=app_a;
  perform public.save_refinement_review(app_a,request_a,'reopen_cv',jsonb_build_object('expectedRevision',current_revision),gen_random_uuid());
  request:=jsonb_set(request||jsonb_build_object('requestId',request_c,'scope','cv'),'{cv,requestId}',to_jsonb(request_c));
  perform public.publish_refinement_request(request);
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  proposal:=proposal||jsonb_build_object('requestId',request_c,'letterText','Changed letter.');
  begin perform private.save_refinement_proposal(request_c,gen_random_uuid(),proposal); raise exception 'FAIL: CV scope changed letter'; exception when invalid_parameter_value then null; end;
  perform private.save_refinement_proposal(request_c,gen_random_uuid(),proposal||'{"letterText":"Existing letter."}');
  -- The outer v1 wire format is retired; inner CV and structure versions stay 1.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  request:=jsonb_set((request-'cvStructure')||jsonb_build_object('schemaVersion',1,'requestId',legacy_request,'scope','cv'),'{cv,requestId}',to_jsonb(legacy_request));
  begin perform public.publish_refinement_request(request); raise exception 'FAIL: retired v1 request accepted'; exception when invalid_parameter_value then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  proposal:=jsonb_build_object('schemaVersion',1,'requestId',request_a,'summary','Retired wording review','cvEdits','[]'::jsonb,'letterText','Dear committee.');
  begin perform private.save_refinement_proposal(request_a,gen_random_uuid(),proposal); raise exception 'FAIL: retired v1 proposal accepted'; exception when invalid_parameter_value or serialization_failure then null; end;
  begin perform public.refinement_validate_cv_decisions(jsonb_build_object('proposalId',legacy_proposal,'accepted','[]'::jsonb,'rejected','[]'::jsonb,'revision','v1:'||repeat('b',64)),proposal); raise exception 'FAIL: retired field decisions accepted'; exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  perform public.create_job_application(app_b,opportunity);
  if exists(select 1 from public.application_refinement_requests where application_id=app_a)
    or exists(select 1 from public.application_refinement_proposals where application_id=app_a)
    or exists(select 1 from public.application_refinement_reviews where application_id=app_a) then raise exception 'FAIL: cross-owner visibility'; end if;
  begin perform public.save_refinement_review(app_a,request_a,'cv_decisions',decisions,gen_random_uuid()); raise exception 'FAIL: cross-owner decision'; exception when insufficient_privilege then null; end;
  execute 'set local role anon'; perform set_config('request.jwt.claims','{}',true);
  begin perform public.refinement_validate_cv_structure(structure,fields); raise exception 'FAIL: anon helper access'; exception when insufficient_privilege then null; end;
  begin perform private.read_refinement_request(request_a); raise exception 'FAIL: anon management access'; exception when insufficient_privilege then null; end;
  execute 'set local role service_role';
  begin perform private.save_refinement_proposal(request_a,gen_random_uuid(),proposal); raise exception 'FAIL: service management access'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  delete from auth.users where id=owner_a;
  if exists(select 1 from public.application_refinement_reviews where application_id=app_a) then raise exception 'FAIL: decisions prevent account cascade'; end if;
  if invalid_count<50 then raise exception 'FAIL: insufficient negative cases executed: %',invalid_count; end if;
end;
$$;
rollback;
select 'PASS: structured CV graph, bounded operations, extractive shortening, privacy/link preservation, scopes, immutable retries, exact decisions, approved/stale/cross-owner refusal, retired v1 refusal and cascade; all fixtures rolled back.' as result;
