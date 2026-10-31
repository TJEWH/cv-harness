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
    jsonb_build_object('id','field-1','label','Research bullets','text',E'Built robust research tools with {{PRIVATE_1}}.\nDocumented reproducible workflows.'),
    jsonb_build_object('id','field-2','label','Second entry','text','Evaluated prototype systems carefully.'),
    jsonb_build_object('id','field-3','label','Profile','text','Study research evidence https://example.invalid/report and method.'),
    jsonb_build_object('id','field-4','label','Complex block','text','Nested data untouched.'));
  structure jsonb:='{"schemaVersion":1,"areas":[{"id":"body","sectionIds":["section-1","section-2"]},{"id":"sidebar","sectionIds":["section-3"]}],"sections":[{"id":"section-1","label":"Research","area":"body","entryIds":["entry-1","entry-2"]},{"id":"section-2","label":"Profile","area":"body","entryIds":["entry-3"]},{"id":"section-3","label":"Skills","area":"sidebar","entryIds":[]}],"entries":[{"id":"entry-1","sectionId":"section-1","label":"Research role","bulletIds":["bullet-1","bullet-2"]},{"id":"entry-2","sectionId":"section-1","label":"Second role","bulletIds":["bullet-3"]},{"id":"entry-3","sectionId":"section-2","label":"Profile","bulletIds":[]}],"bullets":[{"id":"bullet-1","entryId":"entry-1","fieldId":"field-1","text":"Built robust research tools with {{PRIVATE_1}}."},{"id":"bullet-2","entryId":"entry-1","fieldId":"field-1","text":"Documented reproducible workflows."},{"id":"bullet-3","entryId":"entry-2","fieldId":"field-2","text":"Evaluated prototype systems carefully."}],"ranges":[{"id":"range-1","fieldId":"field-1","bulletId":"bullet-1","text":"Built robust research tools with {{PRIVATE_1}}.","label":"First bullet"},{"id":"range-2","fieldId":"field-1","bulletId":"bullet-2","text":"Documented reproducible workflows.","label":"Second bullet"},{"id":"range-3","fieldId":"field-2","bulletId":"bullet-3","text":"Evaluated prototype systems carefully.","label":"Third bullet"},{"id":"range-4","fieldId":"field-3","bulletId":null,"text":"Study research evidence https://example.invalid/report and method.","label":"Profile"}],"unsupported":[{"fieldId":"field-4","reason":"Nested structure remains unchanged."}]}';
  operations jsonb:='[{"id":"change-1","type":"reorder_sections","targetId":"body","explanation":"Prioritize the profile.","order":["section-2","section-1"]},{"id":"change-2","type":"reorder_entries","targetId":"section-1","explanation":"Prioritize recent evidence.","order":["entry-2","entry-1"]},{"id":"change-3","type":"reorder_bullets","targetId":"entry-1","explanation":"Move reproducibility earlier.","order":["bullet-2","bullet-1"]},{"id":"change-4","type":"omit_bullet","targetId":"bullet-2","explanation":"Remove less relevant detail."},{"id":"change-5","type":"shorten_text","targetId":"range-1","explanation":"Keep the evidence concise.","text":"Built tools with {{PRIVATE_1}}."},{"id":"change-6","type":"shorten_text","targetId":"range-4","explanation":"Remove redundant wording.","text":"Study evidence https://example.invalid/report and method."}]';
  request jsonb; proposal jsonb; invalid jsonb; original jsonb; receipt jsonb; decisions jsonb; prior_state jsonb;
  unicode_request jsonb; unicode_proposal jsonb;
  first_review uuid:=gen_random_uuid(); feedback_review uuid:=gen_random_uuid(); note jsonb; review_payload jsonb; saved_feedback jsonb;
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
    'letter',setup||'{"text":"Existing letter."}','scope','letter','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure',structure);
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request or public.publish_refinement_request(request)<>original then raise exception 'FAIL: v2 immutable request receipt'; end if;

  proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'summary','Legacy summary remains plain text; TODO is not an annotation.',
    'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,'letterText','😀 Evidence is documented.',
    'annotations','[{"id":"annotation-1","type":"question","document":"letter","location":null,"text":"Which methods did you use?"},{"id":"annotation-2","type":"todo","document":"letter","location":{"start":2,"quote":"Evidence is documented."},"text":"Confirm the research interest."},{"id":"annotation-3","type":"comment","document":"letter","location":null,"text":"Consider a documented example!!"}]'::jsonb);
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  receipt:=private.save_refinement_proposal(request_a,proposal_a,proposal);
  if private.save_refinement_proposal(request_a,proposal_a,proposal)<>receipt then raise exception 'FAIL: annotation proposal retry'; end if;
  if receipt->'proposal_json'->>'letterText'<>'😀 Evidence is documented.' then raise exception 'FAIL: annotations changed letter'; end if;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,proposal->'annotations'||jsonb_build_array(proposal#>'{annotations,0}'),
    jsonb_set(proposal->'annotations','{0,id}','"unknown"'),jsonb_set(proposal->'annotations','{0,type}','"replace"'),
    jsonb_set(proposal->'annotations','{0,document}','"both"'),jsonb_set(proposal->'annotations','{0,location}','{"fieldId":"field-999"}'),
    jsonb_set(proposal->'annotations','{1,location,start}','3'),jsonb_set(proposal->'annotations','{1,location,start}','-1'),
    jsonb_set(proposal->'annotations','{1,location,quote}','"Invented quote"'),jsonb_set(proposal->'annotations','{0,text}','""'),
    jsonb_set(proposal->'annotations','{0,text}',to_jsonb(repeat('😀',2001))),jsonb_set(proposal->'annotations','{0,text}','"Alex Muster"'),
    jsonb_set(proposal->'annotations','{0,status}','"resolved"'),jsonb_set(proposal->'annotations','{0,response}','"Not user input"')
  )) loop
    begin
      perform private.save_refinement_proposal(request_a,gen_random_uuid(),proposal||jsonb_build_object('annotations',invalid));
      raise exception 'FAIL: invalid annotation accepted: %',invalid;
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  -- Old v2 proposals keep free-text summary notes without inferring annotations.
  perform private.save_refinement_proposal(request_a,gen_random_uuid(),proposal-'annotations');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  prior_state:=(select to_jsonb(s) from public.application_refinement_state s where application_id=app_a);
  -- Unanswered open annotations can be explicitly included as ordinary referenced feedback.
  perform public.save_refinement_review(app_a,request_a,'feedback',jsonb_build_object('text','Open question: Which methods did you use?','scope','letter',
    'annotation',jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-1','reviewId',null)),gen_random_uuid());
  review_payload:=jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-1','status','resolved','response','Controlled experiments!!','previousReviewId',null);
  receipt:=public.save_refinement_review(app_a,request_a,'annotation',review_payload,first_review);
  if public.save_refinement_review(app_a,request_a,'annotation',review_payload,first_review)<>receipt then raise exception 'FAIL: review retry'; end if;
  if prior_state<>(select to_jsonb(s) from public.application_refinement_state s where application_id=app_a) then raise exception 'FAIL: annotation changed document approvals/state'; end if;
  if (select payload->>'status' from public.application_refinement_reviews where id=first_review)<>'resolved' then raise exception 'FAIL: status persistence'; end if;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload,gen_random_uuid()); raise exception 'FAIL: stale concurrent update'; exception when serialization_failure then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('previousReviewId',first_review,'status','dismissed'),gen_random_uuid()); raise exception 'FAIL: retired annotation alias accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('previousReviewId',first_review,'response','Alex Muster'),gen_random_uuid()); raise exception 'FAIL: private response'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('previousReviewId',first_review,'response',repeat('😀',6001)),gen_random_uuid()); raise exception 'FAIL: response bound'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('annotationId','annotation-999'),gen_random_uuid()); raise exception 'FAIL: unknown annotation'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('proposalId',gen_random_uuid()),gen_random_uuid()); raise exception 'FAIL: unknown proposal'; exception when insufficient_privilege then null; end;
  note:=jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-1','reviewId',first_review);
  saved_feedback:=jsonb_build_object('text','Question: Which methods did you use? User response: Controlled experiments!!','scope','letter','annotation',note);
  receipt:=public.save_refinement_review(app_a,request_a,'feedback',saved_feedback,feedback_review);
  if public.save_refinement_review(app_a,request_a,'feedback',saved_feedback,feedback_review)<>receipt then raise exception 'FAIL: feedback retry'; end if;
  begin perform public.save_refinement_review(app_a,request_a,'feedback',saved_feedback||'{"scope":"cv"}',gen_random_uuid()); raise exception 'FAIL: annotation scope'; exception when invalid_parameter_value then null; end;
  begin perform public.save_refinement_review(app_a,request_a,'feedback',jsonb_set(saved_feedback,'{annotation,reviewId}','null'),gen_random_uuid()); raise exception 'FAIL: stale feedback reference'; exception when serialization_failure then null; end;
  -- Resolved/ignored annotations without answers cannot become follow-up feedback.
  candidate:=gen_random_uuid();
  perform public.save_refinement_review(app_a,request_a,'annotation',jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-2','status','ignored','response',null,'previousReviewId',null),candidate);
  begin perform public.save_refinement_review(app_a,request_a,'feedback',jsonb_build_object('text','Excluded note','scope','letter','annotation',jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-2','reviewId',candidate)),gen_random_uuid()); raise exception 'FAIL: unanswered ignored feedback'; exception when invalid_parameter_value then null; end;
  select jsonb_agg(jsonb_build_object('id',id,'text',payload->'text','scope',payload->'scope','createdAt',created_at,'annotation',payload->'annotation') order by created_at,id)
    into saved_feedback from public.application_refinement_reviews where application_id=app_a and kind='feedback';
  request:=jsonb_set(request||jsonb_build_object('requestId',request_b,'feedback',saved_feedback),'{cv,requestId}',to_jsonb(request_b));
  receipt:=public.publish_refinement_request(request);
  if receipt#>'{request_json,feedback}'<>saved_feedback then raise exception 'FAIL: preserved referenced feedback'; end if;
  invalid:=jsonb_set(jsonb_set(request||jsonb_build_object('requestId',request_c),'{cv,requestId}',to_jsonb(request_c)),'{feedback,1,annotation,annotationId}','"annotation-2"');
  begin perform public.publish_refinement_request(invalid); raise exception 'FAIL: changed annotation history'; exception when serialization_failure then null; end;
  -- Historical annotations remain answerable after publication of a later round.
  perform public.save_refinement_review(app_a,request_a,'annotation',review_payload||jsonb_build_object('previousReviewId',first_review,'status','open'),gen_random_uuid());
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_b,opportunity); perform public.assign_job_application_cv(app_b,gen_random_uuid(),'Other fixture',content,'{}',1,'{}');
  perform public.save_refinement_state(app_b,setup,'{"cv":null,"letter":null}',0);
  if exists(select 1 from public.application_refinement_reviews where application_id=app_a) then raise exception 'FAIL: cross-user annotation read'; end if;
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload,gen_random_uuid()); raise exception 'FAIL: cross-user annotation write'; exception when insufficient_privilege then null; end;
  begin perform public.save_refinement_review(app_b,null,'annotation',review_payload,gen_random_uuid()); raise exception 'FAIL: foreign proposal in owned app'; exception when insufficient_privilege then null; end;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true); execute 'set local role anon';
  begin perform public.save_refinement_review(app_a,request_a,'annotation',review_payload,gen_random_uuid()); raise exception 'FAIL: anonymous review'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if invalid_count<>15 then raise exception 'FAIL: missing negative cases %',invalid_count; end if;
end;
$$;
rollback;
select 'refinement annotations checks passed' as result;
