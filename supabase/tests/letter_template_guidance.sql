-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
-- All users, opportunities, requests, proposals and reviews are synthetic and rolled back.
begin;
do $$
declare
  owner_a uuid:=gen_random_uuid(); opportunity uuid:=gen_random_uuid(); app_a uuid:=gen_random_uuid();
  request_a uuid:=gen_random_uuid(); request_b uuid:=gen_random_uuid(); proposal_a uuid:=gen_random_uuid();
  answer_a uuid:=gen_random_uuid(); feedback_a uuid:=gen_random_uuid(); field_name text; invalid jsonb;
  legacy_setup jsonb:='{"template":{"id":"research","name":"Research","revision":1,"structure":"Opening, evidence, fit, closing","tone":"Professional","language":"en","maxWords":400,"updatedAt":"2026-10-03T00:00:00Z"},"language":"en","maxWords":400}';
  setup jsonb; request jsonb; proposal jsonb; original jsonb; receipt jsonb; before_state jsonb; feedback jsonb;
  content jsonb:='{"contact":{"name":"Alex Muster","location":"Neustadt","role":"Software Engineer","email":"muster-ex@mp.le","phone":"+49 123 456789","website":"https://alexmuster.dev","linkedin":"https://link.com/in/alexmuster","github":"https://git.com/musterlex"},"about":{"text":"Built reproducible research tools."}}';
  structure jsonb:='{"schemaVersion":1,"areas":[{"id":"body","sectionIds":[]},{"id":"sidebar","sectionIds":[]}],"sections":[],"entries":[],"bullets":[],"ranges":[],"unsupported":[{"fieldId":"field-1","reason":"Keep source evidence unchanged."}]}';
  invalid_count integer:=0;
begin
  -- The additive validator keeps the existing security boundary and legacy setup contract.
  if exists(select 1 from pg_proc where oid='public.refinement_validate_setup(jsonb)'::regprocedure and (prosecdef or provolatile<>'i'))
    or not has_function_privilege('authenticated','public.refinement_validate_setup(jsonb)','execute')
    or has_function_privilege('anon','public.refinement_validate_setup(jsonb)','execute')
    or has_function_privilege('service_role','public.refinement_validate_setup(jsonb)','execute') then
    raise exception 'FAIL: template validator privileges or volatility changed';
  end if;
  perform public.refinement_validate_setup(legacy_setup);
  perform public.refinement_validate_setup(jsonb_set(legacy_setup,'{template}',legacy_setup->'template'||'{"researchInterests":"","questionGuidance":"","refinementSystemPrompt":""}'));
  foreach field_name in array array['researchInterests','questionGuidance','refinementSystemPrompt'] loop
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,array['template',field_name],to_jsonb(repeat('a',4000))));
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,array['template',field_name],to_jsonb(repeat('😀',2000))));
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,array['template',field_name],to_jsonb(E'Methods\nQuestions\tContext\r{{CONFIDENTIAL}}'::text)));
    for invalid in select value from jsonb_array_elements(jsonb_build_array(
      'null'::jsonb,'42'::jsonb,'false'::jsonb,'[]'::jsonb,'{}'::jsonb,
      to_jsonb(repeat('a',4001)),to_jsonb(repeat('😀',2001)),to_jsonb('Control'||chr(1)),
      to_jsonb('Alex Muster'::text)
    )) loop
      begin
        perform public.refinement_validate_setup(jsonb_set(legacy_setup,array['template',field_name],invalid));
        raise exception 'FAIL: invalid % accepted',field_name;
      exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
    end loop;
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,array['template',field_name],to_jsonb('Research !!focus!! [link](https://example.invalid/!!research!!)'::text)));
    perform public.refinement_validate_setup(public.job_drafting_redact_samples(jsonb_set(legacy_setup,array['template',field_name],to_jsonb('Alex Muster investigates !!Private synthetic research!!.'::text))));
  end loop;
  if invalid_count<>27 then raise exception 'FAIL: incomplete negative guidance cases'; end if;
  begin
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,'{template,privateMapping}','{}'));
    raise exception 'FAIL: unrelated private property accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.refinement_validate_setup(jsonb_set(legacy_setup,'{template,subjectInstructions}',to_jsonb(repeat('a',1001))));
    raise exception 'FAIL: existing instruction bound changed';
  exception when invalid_parameter_value then null; end;

  setup:=jsonb_set(legacy_setup,'{template}',legacy_setup->'template'||jsonb_build_object(
    'researchInterests','Reliable learning systems and reproducible scientific tools; not every interest needs to appear.',
    'questionGuidance','When an advertised requirement lacks CV evidence, ask whether relevant experience exists and why it would help the letter.',
    'refinementSystemPrompt','Include resolved answers only when they strengthen the central narrative. Ask a follow-up if an answer is too vague to evaluate.'));
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}');
  insert into public.opportunities(id,opportunity_key,title,requirements,required_documents)
    values(opportunity,'template-guidance-test-'||opportunity::text,'Synthetic research role','[{"text":"Experience evaluating learning systems is beneficial","status":"required","stage":"recruitment","entity_id":"experience-evaluating-learning-systems-is-beneficial"}]','[{"text":"Motivation letter","status":"required","stage":"recruitment","entity_id":"motivation-letter"}]');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.create_job_application(app_a,opportunity);
  perform public.assign_job_application_cv(app_a,gen_random_uuid(),'Synthetic template guidance CV',content,'{}',1,'{}');
  perform public.save_refinement_state(app_a,setup,'{"cv":null,"letter":null}',0);
  request:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'applicationId',app_a,
    'cv',jsonb_build_object('schemaVersion',1,'requestId',request_a,'fields',jsonb_build_array(
      jsonb_build_object('id','field-1','label','Evidence','text','Built reproducible research tools.')),
      'opportunity','{}'::jsonb,'instructions','Use only confirmed qualifications.'),
    'letter',setup||'{"text":""}','scope','letter','feedback','[]'::jsonb,'parentProposalId',null,'cvStructure',structure);
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request or public.publish_refinement_request(request)<>original
    or original#>'{request_json,letter,template}'<>setup->'template' then
    raise exception 'FAIL: publication lost frozen research interests or question guidance';
  end if;
  begin
    perform public.publish_refinement_request(jsonb_set(request,'{letter,template,researchInterests}','"Changed interests"'));
    raise exception 'FAIL: frozen request guidance was overwritten';
  exception when unique_violation then null; end;
  begin
    perform public.publish_refinement_request(jsonb_set(request,'{letter,template,refinementSystemPrompt}','"Changed iteration instructions"'));
    raise exception 'FAIL: frozen refinement system prompt was overwritten';
  exception when unique_violation then null; end;

  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  proposal:=jsonb_build_object('schemaVersion',2,'requestId',request_a,'summary','Draft uses confirmed evidence and asks about a beneficial requirement.',
    'cvOperations','[]'::jsonb,'cvComments','[]'::jsonb,
    'letterText','I am interested in reliable learning systems and have built reproducible research tools.',
    'annotations','[{"id":"annotation-1","type":"question","document":"letter","location":null,"text":"The role values evaluating learning systems, which is not documented in this CV. Have you used evaluation methods in coursework, projects or work? A concrete example could strengthen the motivation letter; no experience is assumed."}]'::jsonb);
  receipt:=private.save_refinement_proposal(request_a,proposal_a,proposal);
  if receipt->'proposal_json'<>proposal then raise exception 'FAIL: question changed draft text'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  before_state:=(select to_jsonb(s) from public.application_refinement_state s where application_id=app_a);
  perform public.save_refinement_review(app_a,request_a,'annotation',jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-1',
    'status','resolved','response','I compared cross-validation results in a supervised coursework project.','previousReviewId',null),answer_a);
  if exists(select 1 from public.application_refinement_reviews where application_id=app_a and kind='feedback')
    or before_state<>(select to_jsonb(s) from public.application_refinement_state s where application_id=app_a)
    or proposal<>(select proposal_json from public.application_refinement_proposals where id=proposal_a) then
    raise exception 'FAIL: answering implicitly published feedback or changed documents/approvals';
  end if;
  receipt:=public.save_refinement_review(app_a,request_a,'feedback',jsonb_build_object(
    'text','Question: Have you evaluated learning systems? User response: I compared cross-validation results in a supervised coursework project.',
    'scope','letter','annotation',jsonb_build_object('proposalId',proposal_a,'annotationId','annotation-1','reviewId',answer_a)),feedback_a);
  feedback:=jsonb_build_array(jsonb_build_object('id',feedback_a,'text',receipt#>'{payload,text}','scope','letter','createdAt',receipt->'created_at','annotation',receipt#>'{payload,annotation}'));
  request:=jsonb_set(request||jsonb_build_object('requestId',request_b,'parentProposalId',proposal_a,'feedback',feedback),'{cv,requestId}',to_jsonb(request_b));
  receipt:=public.publish_refinement_request(request);
  if receipt#>'{request_json,feedback}'<>feedback or receipt#>'{request_json,letter,template}'<>setup->'template'
    or original->'request_json'<>(select request_json from public.application_refinement_requests where id=request_a) then
    raise exception 'FAIL: next round lost referenced answer/guidance or changed original request';
  end if;
  execute 'reset role';
end;
$$;
rollback;
select 'letter template guidance checks passed' as result;
