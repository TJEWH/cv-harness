-- AF-04. Real recovered bootstrap, synthetic fixtures, transaction rollback.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
  run_a uuid:=gen_random_uuid();run_b uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();candidate uuid:=gen_random_uuid();portal_candidate uuid:=gen_random_uuid();other_registry uuid:=gen_random_uuid();
  opportunity_a uuid:=gen_random_uuid();opportunity_b uuid:=gen_random_uuid();query_core uuid:=gen_random_uuid();query_adaptive uuid:=gen_random_uuid();query_new_core uuid:=gen_random_uuid();
  anchor_a uuid;anchor_b uuid;protocol text;legacy jsonb;legacy_before jsonb;doc jsonb;next_doc jsonb;core jsonb;adaptive jsonb;new_core jsonb;exploration jsonb;
  first_plan jsonb;second_plan jsonb;wrong_plan jsonb;reply jsonb;retained jsonb;before_source jsonb;source_row public.opportunity_search_sources;
  blocked boolean;affected integer;listing text:='https://example.invalid/Jobs?area=Audio';verified_at timestamptz:=now()-interval '1 hour';
  schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
    (search_a,owner_a,'Active synthetic research','{"topicsAndMethods":"Acoustic sensing research"}',schedule),
    (search_b,owner_b,'Other owner research','{"topicsAndMethods":"Synthetic BCI research"}',schedule);
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  perform private.begin_opportunity_search(search_a,run_a);
  legacy:='[{"query":"acoustic sensing PhD","sources":["EXAMPLE.invalid"]}]';
  reply:=private.save_opportunity_search_queries(run_a,legacy);anchor_a:=(reply->>'id')::uuid;legacy_before:=reply;
  perform private.begin_opportunity_search(search_b,run_b);
  reply:=private.save_opportunity_search_queries(run_b,'[{"query":"other synthetic research"}]');anchor_b:=(reply->>'id')::uuid;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  reply:=public.save_opportunity_search_source(search_a,registry,'{"listing_url":"https://EXAMPLE.invalid:443/Jobs?area=Audio","kind":"university","enabled":true,"pinned":true,"mandatory":true,"check_interval_hours":24,"topics":["Acoustics"]}');
  assert reply->>'listing_url'=listing and reply->'last_attempted_at'='null'::jsonb,'Source normalization changed public identity or invented coverage';
  assert reply->>'registry_id'=registry::text,'Source registry identity not retained';
  perform public.save_opportunity_search_source(search_a,candidate,'{"vacancy_url":"https://example.invalid/Vacancy/A","kind":"lab"}');
  perform public.save_opportunity_search_source(search_a,portal_candidate,'{"vacancy_url":"https://apply.example.invalid/Portal"}');
  select * into source_row from public.opportunity_search_sources where registry_id=candidate;
  assert source_row.listing_url is null and not source_row.enabled and source_row.status='pending_identification','Vacancy reference became a fabricated reusable listing';
  blocked:=false;
  begin perform public.save_opportunity_search_source(search_a,gen_random_uuid(),'{"listing_url":"https://example.invalid/Jobs?token=secret"}');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Secret source URL accepted';
  blocked:=false;
  begin perform public.save_opportunity_search_source(search_a,registry,'{"institution":"SB_SECRET_short"}');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Short case-variant token entered source metadata';
  update public.opportunity_search_sources set last_successful_at=now(),status='checked',listing_verified_at=now() where registry_id=registry;
  select * into source_row from public.opportunity_search_sources where registry_id=registry;
  assert source_row.last_successful_at is null and source_row.listing_verified_at is null and source_row.status='ready','Owner forged executed coverage';
  execute 'reset role';
  reply:=private.due_opportunity_search_sources(owner_a,search_a,now());
  assert jsonb_array_length(reply)=1 and reply->0->>'registry_id'=registry::text and reply->0->>'action'='direct_check','Due pinned/mandatory source omitted without a web-search hit';
  update public.opportunity_search_sources set status='blocked',last_attempted_at=now(),last_successful_at=now()-interval '2 days' where registry_id=registry;
  assert private.due_opportunity_search_sources(owner_a,search_a,now())='[]'::jsonb,'Blocked cadence ignored';
  assert jsonb_array_length(private.due_opportunity_search_sources(owner_a,search_a,now()+interval '24 hours'))=1,'Blocked source was deleted or never became due';
  update public.opportunity_search_sources set status='incomplete' where registry_id=registry;
  assert (select status='incomplete' and last_successful_at is not null from public.opportunity_search_sources where registry_id=registry),'Incomplete check lost previous successful coverage';

  -- Canonical verification links a listing to an opportunity, without claiming
  -- that an old query discovered it or confusing an application portal with it.
  insert into public.opportunities(id,opportunity_key,title,official_url,application_url,data,sources) values
    (opportunity_a,'af04-'||opportunity_a,'Synthetic research A','https://example.invalid/Vacancy/A','https://apply.example.invalid/Portal',
      '{"url_roles":{"official_url":"vacancy","application_url":"application_portal"}}',
      jsonb_build_array(jsonb_build_object('source_id','af04-listing-a','url','https://listing.example.invalid/Openings','kind','official_listing','checked_at',verified_at,'precision','instant','supports',jsonb_build_array('title')))),
    (opportunity_b,'af04-'||opportunity_b,'Synthetic research B','https://example.invalid/Vacancy/B','https://apply.example.invalid/Portal',
      '{"url_roles":{"official_url":"vacancy","application_url":"application_portal"}}',
      jsonb_build_array(jsonb_build_object('source_id','af04-listing-b','url','https://listing.example.invalid/Openings','kind','official_listing','checked_at',verified_at,'precision','instant','supports',jsonb_build_array('title'))));
  insert into private.opportunity_search_merge_state(opportunity_id,fields)
    select id,jsonb_build_object('/title',jsonb_build_object('value',title,'evidence',sources)) from public.opportunities where id in(opportunity_a,opportunity_b);
  insert into public.opportunity_reviews(user_id,opportunity_id,state) values(owner_a,opportunity_a,'strong_interest'),(owner_a,opportunity_b,'strong_interest');
  assert private.retain_successful_opportunity_source(owner_a,search_a,opportunity_a,'https://listing.example.invalid/Openings',candidate) is null,'Source reuse activated without explicit policy';
  execute 'set local role authenticated';perform public.save_opportunity_search_adaptation(search_a,true,false,0);perform public.set_opportunity_source_reuse(search_a,true,168);execute 'reset role';
  assert private.retain_successful_opportunity_source(owner_a,search_a,opportunity_b,'https://listing.example.invalid/Openings',candidate) is null,'Unrelated vacancy promoted another pending entry';
  assert private.retain_successful_opportunity_source(owner_a,search_a,opportunity_a,'https://listing.example.invalid/Openings',portal_candidate) is null,'Shared application portal proved a vacancy identity';
  retained:=private.retain_successful_opportunity_source(owner_a,search_a,opportunity_a,'https://listing.example.invalid/Openings',candidate);
  assert retained->>'registry_id'=candidate::text and retained->'enabled'='true'::jsonb and retained->'mandatory'='false'::jsonb,'Verified useful listing lost stable candidate identity or became daily mandatory';
  assert retained->'last_attempted_at'='null'::jsonb and retained->'last_successful_at'='null'::jsonb and retained->>'status'='ready','Retaining a listing invented completed coverage';
  assert (retained->>'listing_verified_at')::timestamptz=verified_at,'Listing verification time fabricated';
  assert (private.retain_successful_opportunity_source(owner_a,search_a,opportunity_a,'https://listing.example.invalid/Openings')->>'registry_id')::uuid=candidate,'Retry duplicated a retained source';
  execute 'set local role authenticated';perform public.save_opportunity_search_source(search_a,candidate,'{"enabled":false}');
  update public.opportunity_search_sources set owner_disabled=false where registry_id=candidate;
  assert (select owner_disabled and not enabled from public.opportunity_search_sources where registry_id=candidate),'Stale owner CRUD cleared sticky disabled state';
  execute 'reset role';
  retained:=private.retain_successful_opportunity_source(owner_a,search_a,opportunity_a,'https://listing.example.invalid/Openings');
  assert retained->'enabled'='false'::jsonb and retained->'owner_disabled'='true'::jsonb,'Automatic reuse reactivated an owner-disabled source';
  assert (select count(*) from public.opportunities where application_url='https://apply.example.invalid/Portal' and id in(opportunity_a,opportunity_b))=2,'Source operations merged distinct vacancies sharing a portal';

  -- Sidecar publication preserves the legacy strict contract and exact manual core.
  core:=jsonb_build_object('query_id',query_core,'query','acoustic sensing PhD','text_hash',encode(sha256(convert_to('acoustic sensing PhD','UTF8')),'hex'),
    'role','core','manual',true,'sources',jsonb_build_array('EXAMPLE.invalid'),'source_registry_id',registry);
  adaptive:=jsonb_build_object('query_id',query_adaptive,'query','BCI funded research','text_hash',encode(sha256(convert_to('BCI funded research','UTF8')),'hex'),'role','adaptive','manual',false);
  exploration:=jsonb_build_object('query_id',gen_random_uuid(),'query','synthetic adjacent research exploration','text_hash',encode(sha256(convert_to('synthetic adjacent research exploration','UTF8')),'hex'),'role','exploration','manual',false);
  doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(core,adaptive,exploration));
  first_plan:=private.publish_opportunity_search_plan(owner_a,search_a,anchor_a,doc,1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);
  assert private.publish_opportunity_search_plan(owner_a,search_a,anchor_a,doc,1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol)=first_plan,'Plan retry allocated another version';
  perform private.pin_opportunity_search_plan(owner_a,search_a,run_a,(first_plan->>'id')::uuid);
  wrong_plan:=private.publish_opportunity_search_plan(owner_b,search_b,anchor_b,jsonb_build_object('schema_version',2,'queries',jsonb_build_array(
    jsonb_build_object('query_id',gen_random_uuid(),'query','other synthetic research','text_hash',encode(sha256(convert_to('other synthetic research','UTF8')),'hex'),'role','core','manual',false))),1,(private.compile_opportunity_feedback_snapshot(owner_b,search_b)->>'feedback_revision')::bigint,0,protocol);
  insert into public.opportunity_reviews(user_id,opportunity_id,state) values(owner_b,opportunity_b,'interested');
  perform private.pin_opportunity_feedback_snapshot(owner_b,search_b,run_b);
  blocked:=false;
  begin perform private.pin_opportunity_search_plan(owner_b,search_b,run_b,(wrong_plan->>'id')::uuid);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'A query plan with another feedback basis was pinned to the run';
  adaptive:=jsonb_set(adaptive,'{query}','"robot audition funded research"');
  adaptive:=jsonb_set(adaptive,'{text_hash}',to_jsonb(encode(sha256(convert_to('robot audition funded research','UTF8')),'hex')));
  next_doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(core,adaptive,exploration));
  second_plan:=private.publish_opportunity_search_plan(owner_a,search_a,anchor_a,next_doc,1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);
  assert second_plan->>'plan_hash'<>first_plan->>'plan_hash' and second_plan->>'plan_revision'<>first_plan->>'plan_revision','Modified query text lost distinguishable version';
  assert private.pin_opportunity_search_plan(owner_a,search_a,run_a,(second_plan->>'id')::uuid)=first_plan,'New plan replaced an existing run pin';
  assert (select queries from public.opportunity_search_runs where id=run_a)=legacy,'V2 publication rewrote legacy run queries';
  assert (select to_jsonb(q) from public.opportunity_search_query_revisions q where id=anchor_a)=legacy_before,'V2 publication mutated original immutable query revision';
  assert (select pinned and mandatory and registry_id=registry from public.opportunity_search_sources where registry_id=registry),'Feedback plan regeneration changed pinned sources';
  blocked:=false;
  begin perform private.save_opportunity_search_queries(run_a,'[{"query":"acoustic sensing PhD","role":"core"}]');exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Legacy strict writer silently accepted V2 fields';
  blocked:=false;
  begin perform private.validate_opportunity_search_plan(owner_a,search_a,jsonb_set(next_doc,'{queries,1,role}','null'));exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'JSON null query role accepted';
  blocked:=false;
  begin perform private.publish_opportunity_search_plan(owner_a,search_a,anchor_a,jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_set(core,'{manual}','false'),adaptive)),1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Model retagged a stored manual core query';
  blocked:=false;
  begin perform private.publish_opportunity_search_plan(owner_a,search_a,anchor_b,next_doc,1,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Another owner/query anchor became active';
  blocked:=false;
  begin update public.opportunity_search_query_plans set document='{}' where id=(first_plan->>'id')::uuid;exception when check_violation then blocked:=true;end;
  assert blocked,'Published plan changed in place';

  -- Base changes permit new generated core, while stored manual identities stay.
  update public.opportunity_search_templates set revision=revision+1,criteria='{"topicsAndMethods":"Updated synthetic sensing research"}' where id=search_a;
  run_b:=gen_random_uuid();perform private.begin_opportunity_search(search_a,run_b);
  reply:=private.save_opportunity_search_queries(run_b,'[{"query":"physical sensing funded positions"}]');anchor_b:=(reply->>'id')::uuid;
  new_core:=jsonb_build_object('query_id',query_new_core,'query','physical sensing funded positions','text_hash',encode(sha256(convert_to('physical sensing funded positions','UTF8')),'hex'),'role','core','manual',false);
  blocked:=false;
  begin perform private.publish_opportunity_search_plan(owner_a,search_a,anchor_b,jsonb_build_object('schema_version',2,'queries',jsonb_build_array(new_core,adaptive)),2,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'A base change erased a stored manual core';
  next_doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(core,new_core,adaptive,exploration));
  reply:=private.publish_opportunity_search_plan(owner_a,search_a,anchor_b,next_doc,2,(private.compile_opportunity_feedback_snapshot(owner_a,search_a)->>'feedback_revision')::bigint,0,protocol);
  assert reply#>'{basis,base_revision}'='2'::jsonb,'Independent base revision not retained';

  -- Owner RLS and publication metadata remain protected.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source(search_b,other_registry,'{"listing_url":"https://other.example.invalid/Jobs","enabled":true}');
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  select count(*) into affected from public.opportunity_search_sources where user_id=owner_b;assert affected=0,'Owner A read B source registry';
  blocked:=false;
  begin perform public.save_opportunity_search_source(search_b,other_registry,'{"enabled":false}');exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Owner A disabled B source';
  update public.opportunity_search_adaptive_settings set query_plan_id=null,query_plan_revision=999,query_plan_dirty=false where user_id=owner_a and search_id=search_a;
  assert (select query_plan_id=(reply->>'id')::uuid and query_plan_revision<>999 from public.opportunity_search_adaptive_settings where user_id=owner_a and search_id=search_a),'Owner forged plan publication state';
  assert not has_function_privilege(current_user,'private.publish_opportunity_search_plan(uuid,uuid,uuid,jsonb,integer,bigint,bigint,text)','EXECUTE'),'Internal plan publication API exposed';
  assert has_function_privilege(current_user,'public.opportunity_search_source_url(text)','EXECUTE') and not has_function_privilege(current_user,'private.opportunity_feedback_safe_url(text)','EXECUTE'),'URL validation widened private projector privileges';
  execute 'reset role';
end;
$$;
rollback;
