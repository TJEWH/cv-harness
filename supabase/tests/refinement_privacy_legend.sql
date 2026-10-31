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
  current_revision integer; invalid_count integer:=0; legend jsonb; item jsonb;
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
  legend:='[{"fieldId":"field-1","token":"{{PRIVATE_1}}","type":"organization","description":"Engineering company specializing in sensor technology!!"}]';
  request:=request||jsonb_build_object('privacyLegend',legend);
  original:=public.publish_refinement_request(request);
  if original->'request_json'<>request or public.publish_refinement_request(request)<>original then raise exception 'FAIL: legend request retry'; end if;
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  receipt:=private.read_refinement_request(request_a);
  if receipt#>'{request_json,privacyLegend}' is distinct from legend then raise exception 'FAIL: MCP lost approved legend'; end if;
  if receipt::text like '%originalValue%' or receipt::text like '%bindings%' then raise exception 'FAIL: unexpected private map'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,legend||legend,
    jsonb_set(legend,'{0,originalValue}','"Private original"'),jsonb_set(legend,'{0,fieldId}','"field-2"'),
    jsonb_set(legend,'{0,token}','"{{PRIVATE_9}}"'),jsonb_set(legend,'{0,type}','"automatic"'),
    jsonb_set(legend,'{0,description}','""'),jsonb_set(legend,'{0,description}','"   "'),
    jsonb_set(legend,'{0,description}',to_jsonb(repeat('😀',251))),jsonb_set(legend,'{0,description}','"Alex Muster"'),
    jsonb_set(legend,'{0,description}','"{{PRIVATE_1}}"'),jsonb_set(legend,'{0,description}','"<b>HTML</b>"'),
    jsonb_set(legend,'{0,description}',to_jsonb(E'two\nlines'::text)),jsonb_set(legend,'{0,description}','null'),
    jsonb_set(legend,'{0,type}','null'),jsonb_set(legend,'{0,description}',to_jsonb(E'\u00a0\ufeff'::text))
  )) loop
    candidate:=gen_random_uuid();
    item:=jsonb_set(jsonb_set(request,'{requestId}',to_jsonb(candidate::text)),'{cv,requestId}',to_jsonb(candidate::text));
    begin
      perform public.publish_refinement_request(item||jsonb_build_object('privacyLegend',invalid));
      raise exception 'FAIL: invalid privacy legend accepted';
    exception when invalid_parameter_value then invalid_count:=invalid_count+1; end;
  end loop;
  if invalid_count<>17 then raise exception 'FAIL: incomplete invalid-legend coverage'; end if;
  perform public.refinement_validate_privacy_legend(jsonb_set(legend,'{0,description}',to_jsonb(repeat('😀',250))),fields);
  -- Version-2 requests publish without a legend, or with an explicitly empty legend.
  for current_revision in 1..2 loop
    candidate:=gen_random_uuid();
    item:=jsonb_set(jsonb_set(request-'privacyLegend','{requestId}',to_jsonb(candidate::text)),'{cv,requestId}',to_jsonb(candidate::text));
    if current_revision=2 then item:=item||'{"privacyLegend":[]}'; end if;
    perform public.publish_refinement_request(item);
  end loop;
  -- The shared field validator cannot transfer a token to an unrelated bullet, even within the same field.
  proposal:=jsonb_build_object('schemaVersion',1,'requestId',request_a,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',E'Built research tools.\nDocumented workflows with {{PRIVATE_1}}.')));
  begin
    perform public.cv_adjustment_validate_response(proposal,request->'cv',request_a);
    raise exception 'FAIL: moved field token accepted';
  exception when invalid_parameter_value then null; end;
  proposal:=jsonb_set(proposal,'{edits,0,text}',to_jsonb(E'Built tools with {{PRIVATE_1}}.\r\nDocumented workflows.'::text));
  perform public.cv_adjustment_validate_response(proposal,request->'cv',request_a);
  execute 'reset role'; perform set_config('request.jwt.claims','{}',true);
  if has_function_privilege('anon','public.refinement_validate_privacy_legend(jsonb,jsonb)','execute')
    or has_function_privilege('service_role','public.refinement_validate_privacy_legend(jsonb,jsonb)','execute')
    or not has_function_privilege('authenticated','public.refinement_validate_privacy_legend(jsonb,jsonb)','execute') then
    raise exception 'FAIL: privacy validator privileges';
  end if;
end;
$$;
rollback;
