-- AF-08 batch acceptance: synthetic owners, evidence and private canaries only.
begin;
create function pg_temp.af08_batch_fixture(p_label text,p_source boolean default false) returns jsonb language plpgsql as $$
declare actor uuid:=gen_random_uuid();search_uuid uuid:=gen_random_uuid();run_uuid uuid:=gen_random_uuid();batch_uuid uuid:=gen_random_uuid();
  query_uuid uuid:=gen_random_uuid();check_uuid uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();query_text text:='synthetic batch research '||p_label;result jsonb;payload jsonb;
begin
  insert into auth.users(id) values(actor);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(search_uuid,actor,'Synthetic batch '||p_label,
    '{"topicsAndMethods":"Acoustics; BCI"}','{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  update public.opportunity_search_adaptive_release set project_ref='bbbbbbbbbbbbbbbbbbbb',enabled=true,
    capability_version=private.opportunity_search_adaptive_capabilities()->>'capability_version' where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization(search_uuid,'bbbbbbbbbbbbbbbbbbbb',true,0);
  if p_source then perform public.save_opportunity_search_source(search_uuid,registry,'{"listing_url":"https://example.invalid/BatchJobs","enabled":true}');end if;
  execute 'reset role';
  result:=private.begin_adaptive_opportunity_search(search_uuid,run_uuid);assert result->'compatible'='true'::jsonb,'Synthetic startup failed';
  payload:=jsonb_build_object('schema_version',1,'query_plan',jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object(
    'query_id',query_uuid,'query',query_text,'role','core','manual',false))), 'opportunities','[]'::jsonb,
    'execution',jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('check_id',check_uuid,'kind','query','query_id',query_uuid,
      'text_hash',encode(sha256(convert_to(query_text,'UTF8')),'hex'),'attempted_at',clock_timestamp(),'status','complete','results_count',0)),'complete',true));
  if p_source then payload:=jsonb_set(payload,'{query_plan,queries,0,source_registry_id}',to_jsonb(registry));end if;
  return jsonb_build_object('user_id',actor,'search_id',search_uuid,'run_id',run_uuid,'batch_id',batch_uuid,'query_id',query_uuid,'check_id',check_uuid,'source_registry_id',registry,'body',payload);
end;
$$;
create function pg_temp.af08_batch_opportunity(p_key text,p_title text default 'Synthetic evidenced researcher') returns jsonb language sql as $$
  select jsonb_build_object('opportunity_key',p_key,'title',p_title,'official_url','https://example.invalid/Vacancy/'||p_key,
    'last_checked_at',clock_timestamp(),'personal_fit',jsonb_build_object('score',8.4,'scale_min',0,'scale_max',10,'summary','Synthetic structured original assessment'),
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Vacancy/'||p_key,'kind','official','checked_at',clock_timestamp(),
      'precision','instant','supports',jsonb_build_array('title','official_url','personal_fit','requirements','required_documents'))))
$$;
create function pg_temp.af08_seed_canonical(p_fixture jsonb,p_payload jsonb) returns uuid language plpgsql as $$
declare seed_search uuid:=gen_random_uuid();seed_run uuid:=gen_random_uuid();seed_item uuid:=gen_random_uuid();saved jsonb;
begin
  -- Canonical prehistory belongs to an independent synthetic search owned by
  -- the same actor. Do not start another execution of the active test search.
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    select seed_search,user_id,'Synthetic canonical prehistory',criteria,schedule
      from public.opportunity_search_templates where id=(p_fixture->>'search_id')::uuid;
  perform private.begin_opportunity_search(seed_search,seed_run);
  perform private.save_opportunity_search_queries(seed_run,jsonb_build_array(jsonb_build_object('query',p_fixture#>>'{body,query_plan,queries,0,query}')));
  saved:=private.submit_opportunity_search_result(seed_run,seed_item,p_payload);
  perform private.verify_opportunity_search_result(seed_run,seed_item);
  perform private.complete_opportunity_search(seed_run,'{"status":"failed","notes":"Synthetic canonical fixture seed only; no research execution","unresolvedCount":0}');
  return(saved->>'opportunity_id')::uuid;
end;
$$;

do $$
declare f jsonb;other jsonb;body jsonb;bad jsonb;result jsonb;again jsonb;opportunity jsonb;prior_context jsonb;prior_contacts jsonb;original_plan jsonb;
  run_uuid uuid;batch_uuid uuid;item_a uuid;item_b uuid;target uuid;application_uuid uuid;plan_uuid uuid;shared_uuid uuid;new_batch uuid;proposal_uuid uuid;
  root record;before_rows integer;before_plans integer;before_checks integer;before_prefs bigint;n integer;changed boolean;
  prior_row jsonb;prior_state jsonb;historical_document jsonb;historical_id uuid;historical_query uuid;
begin
  -- Validate the whole batch before saving even its first valid opportunity or
  -- publishing its first query plan/execution record.
  f:=pg_temp.af08_batch_fixture('prevalidation');run_uuid:=(f->>'run_id')::uuid;batch_uuid:=(f->>'batch_id')::uuid;item_a:=gen_random_uuid();item_b:=gen_random_uuid();
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(
    jsonb_build_object('item_id',item_a,'opportunity',pg_temp.af08_batch_opportunity('af08-valid-'||run_uuid)),
    jsonb_build_object('item_id',item_b,'opportunity',pg_temp.af08_batch_opportunity('af08-invalid-'||run_uuid)||'{"data":{"private_extension":"BATCH_PRIVATE_CANARY"}}')));
  body:=jsonb_set(body,'{execution,checks,0,results_count}','2');
  select count(*) into before_rows from public.opportunities;select count(*) into before_plans from public.opportunity_search_query_plans;
  result:=private.submit_adaptive_search_batch(run_uuid,batch_uuid,body);
  assert result?'error' and result::text!~'BATCH_PRIVATE_CANARY','Schema-invalid second item was accepted or echoed';
  assert(select count(*) from public.opportunities)=before_rows and(select count(*) from public.opportunity_search_query_plans)=before_plans
    and not exists(select 1 from public.opportunity_search_executions where run_id=run_uuid)
    and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Invalid second item left first writes/plan/checks';

  -- The write receipt remains pending separate verification. Exact retry keeps
  -- stable identities and does not recapture the original assessment.
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,
    'opportunity',pg_temp.af08_batch_opportunity('af08-saved-'||run_uuid),'attribution',jsonb_build_object('execution_refs',jsonb_build_array(f->'check_id'),'discovered_at',clock_timestamp()))));
  body:=jsonb_set(body,'{execution,checks,0,results_count}','1');
  result:=private.submit_adaptive_search_batch(run_uuid,batch_uuid,body);
  assert result->'batch_schema_version'='1'::jsonb and result->'verification_required'='true'::jsonb and not(result?'error'),'Valid bounded batch failed';
  assert exists(select 1 from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_a and verified_at is null)
    and exists(select 1 from public.opportunity_search_discoveries where run_id=run_uuid and item_id=item_a and assessment_score=8.4 and verified_at is null and assessment_verified_at is null),
    'Intake fabricated separate verification or lost original structured assessment';
  select opportunity_id into target from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_a;
  select count(*) into before_rows from public.opportunities;select count(*) into before_checks from public.opportunity_search_executions where run_id=run_uuid;
  again:=private.submit_adaptive_search_batch(run_uuid,batch_uuid,body);assert again=result,'Lost batch response was not replayed exactly';
  assert(select count(*) from public.opportunities)=before_rows and(select count(*) from public.opportunity_search_executions where run_id=run_uuid)=before_checks,'Batch replay duplicated canonical/check rows';
  bad:=jsonb_set(body,'{opportunities,0,opportunity,title}','"Changed stable item body"');
  again:=private.submit_adaptive_search_batch(run_uuid,batch_uuid,bad);assert again?'error','Changed batch body reused a saved batch ID';
  again:=private.submit_adaptive_search_batch(run_uuid,gen_random_uuid(),body);assert again?'error','A stable item ID was reused in a different batch';
  assert(select count(*) from private.opportunity_search_adaptive_batches where run_id=run_uuid)=1,'Rejected replay left another manifest batch';
  assert result::text!~'snapshot|effective_fields|field_decisions|original_assessment|"score": 8.4','Broad canonical receipt escaped';

  -- A later batch must copy the actual plan hash. It does not rewrite core or
  -- invent another legacy query revision.
  original_plan:=(select document from public.opportunity_search_query_plans where id=(result->>'plan_id')::uuid);
  new_batch:=gen_random_uuid();bad:=jsonb_build_object('schema_version',1,'plan_hash',repeat('0',64),'opportunities','[]'::jsonb,'execution','{"checks":[],"complete":true}'::jsonb);
  again:=private.submit_adaptive_search_batch(run_uuid,new_batch,bad);assert again?'error','Later batch accepted a mismatched plan hash';
  again:=private.submit_adaptive_search_batch(run_uuid,gen_random_uuid(),f->'body');
  assert again?'error' and(select count(*) from private.opportunity_search_adaptive_batches where run_id=run_uuid)=1,'A repeated query_plan bypassed the later-batch plan_hash requirement';
  bad:=jsonb_set(bad,'{plan_hash}',result->'plan_hash');again:=private.submit_adaptive_search_batch(run_uuid,new_batch,bad);
  assert again->'batch_schema_version'='1'::jsonb and again->>'plan_id'=result->>'plan_id','Later bounded batch failed to reuse pinned plan';
  assert(select document from public.opportunity_search_query_plans where id=(result->>'plan_id')::uuid)=original_plan,'Later batch changed protected core';
  assert jsonb_array_length(private.opportunity_search_adaptive_manifest(run_uuid)->'batch_ids')=2,'Zero-opportunity later batch disappeared from manifest';

  -- Automatic research must preserve people, private reviews and captured
  -- application context. Proposed people are deferred, never whole-object unioned.
  f:=pg_temp.af08_batch_fixture('people');run_uuid:=(f->>'run_id')::uuid;item_a:=gen_random_uuid();target:=gen_random_uuid();application_uuid:=gen_random_uuid();
  opportunity:=pg_temp.af08_batch_opportunity('af08-people-'||run_uuid,'Synthetic existing richer title')||jsonb_build_object(
    'contacts','[{"name":"PRIVATE_CONTACT_CANARY","email":"private.person@example.invalid","roles":["contact"],"entity_id":"private-contact-canary"}]'::jsonb,
    'requirements','[{"text":"Existing conditional requirement","status":"conditional","stage":"doctoral_admission","conditions":["After selection"],"entity_id":"existing-conditional-requirement"}]'::jsonb);
  opportunity:=jsonb_set(opportunity,'{sources,0,supports}',opportunity#>'{sources,0,supports}'||'["contacts"]'::jsonb);
  target:=pg_temp.af08_seed_canonical(f,opportunity);
  select contacts into prior_contacts from public.opportunities where id=target;
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values((f->>'user_id')::uuid,target,'strong_interest','PRIVATE_REVIEW_CANARY');
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage,notes) values(application_uuid,(f->>'user_id')::uuid,target,'preparation','tracking','PRIVATE_APPLICATION_CANARY');
  select context_json into prior_context from public.applications where id=application_uuid;
  opportunity:=pg_temp.af08_batch_opportunity('af08-people-'||run_uuid)||jsonb_build_object('contacts',jsonb_build_array(jsonb_build_object('name','PRIVATE_PROPOSED_CANARY','email','proposed.person@example.invalid')),'requirements','[]'::jsonb);
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,'opportunity',opportunity,
    'attribution',jsonb_build_object('execution_refs',jsonb_build_array(f->'check_id'),'discovered_at',clock_timestamp()))));
  body:=jsonb_set(body,'{execution,checks,0,results_count}','1');
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert not(result?'error') and result::text!~'CANARY|person@example|snapshot|effective_fields','People proposal failed safely or exposed private values';
  assert(select contacts from public.opportunities where id=target)=prior_contacts and(select jsonb_array_length(requirements) from public.opportunities where id=target)=1,'People/requirements were lost or duplicated';
  assert(select comment from public.opportunity_reviews where user_id=(f->>'user_id')::uuid and opportunity_id=target)='PRIVATE_REVIEW_CANARY'
    and(select context_json from public.applications where id=application_uuid)=prior_context,'Automatic intake changed private review/application context';
  assert exists(select 1 from private.opportunity_search_adaptive_items where run_id=run_uuid and item_id=item_a and 'contacts'=any(deferred_fields)),'People enrichment was not explicitly deferred';

  -- Suggestions remain inert, even when the owner has enough real reviewed
  -- evidence. Unknown/cross-owner references deny the whole transaction.
  f:=pg_temp.af08_batch_fixture('suggestions');run_uuid:=(f->>'run_id')::uuid;target:=gen_random_uuid();proposal_uuid:=gen_random_uuid();
  insert into public.opportunities(id,opportunity_key,title) values(target,'af08-suggestion-'||target,'Synthetic reviewed BCI');
  insert into public.opportunity_reviews(user_id,opportunity_id,state) values((f->>'user_id')::uuid,target,'strong_interest');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f->>'user_id','is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_adaptation((f->>'search_id')::uuid,true,false,0);execute 'reset role';
  before_prefs:=(public.opportunity_search_preference_document((f->>'user_id')::uuid,(f->>'search_id')::uuid)->>'preference_revision')::bigint;
  body:=(f->'body')||jsonb_build_object('preference_suggestions',jsonb_build_array(jsonb_build_object('suggestion_id',proposal_uuid,'rule',jsonb_build_object(
      'rule_id',gen_random_uuid(),'kind','hard_exclusion','category','topic','target','Routine administration','evidence_refs',jsonb_build_array(target)))),
    'source_suggestions',jsonb_build_array(jsonb_build_object('suggestion_id',gen_random_uuid(),'kind','candidate','vacancy_url','https://example.invalid/Vacancy/Future','evidence_refs',jsonb_build_array(target))),
    'query_suggestions',jsonb_build_array(jsonb_build_object('suggestion_id',gen_random_uuid(),'query','synthetic future BCI direction','evidence_refs',jsonb_build_array(target))));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert not(result?'error') and(select count(*) from public.opportunity_search_adaptive_proposals where run_id=run_uuid)=3,
    'Typed bounded proposals were not staged; safe receipt: '||result::text;
  assert(public.opportunity_search_preference_document((f->>'user_id')::uuid,(f->>'search_id')::uuid)->>'preference_revision')::bigint=before_prefs
    and jsonb_array_length(public.opportunity_search_preference_document((f->>'user_id')::uuid,(f->>'search_id')::uuid)->'approved_rules')=0,
    'A pending hard exclusion became an executable rule';
  assert not exists(select 1 from public.opportunity_search_sources where user_id=(f->>'user_id')::uuid and search_id=(f->>'search_id')::uuid and vacancy_url='https://example.invalid/Vacancy/Future'),'Candidate source proposal activated a registry source';
  assert not exists(select 1 from jsonb_array_elements((select document->'queries' from public.opportunity_search_query_plans where id=(result->>'plan_id')::uuid)) q where q->>'query'='synthetic future BCI direction'),'Pending query proposal changed the current plan';

  f:=pg_temp.af08_batch_fixture('security');other:=pg_temp.af08_batch_fixture('other-owner');run_uuid:=(f->>'run_id')::uuid;item_a:=gen_random_uuid();target:=gen_random_uuid();
  insert into public.opportunities(id,opportunity_key,title) values(target,'af08-other-'||target,'Synthetic other owner reviewed record');
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values((other->>'user_id')::uuid,target,'strong_interest','CROSS_OWNER_CANARY');
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,'opportunity',pg_temp.af08_batch_opportunity('af08-security-'||run_uuid))))
    ||jsonb_build_object('query_suggestions',jsonb_build_array(jsonb_build_object('suggestion_id',gen_random_uuid(),'query','synthetic BCI','evidence_refs',jsonb_build_array(target))));
  select count(*) into before_rows from public.opportunities;result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert result?'error' and result::text!~'CANARY' and(select count(*) from public.opportunities)=before_rows
    and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Cross-owner denial did not abort the whole batch';

  -- Unsafe expected values never become a correction or an echoed conflict.
  f:=pg_temp.af08_batch_fixture('correction');run_uuid:=(f->>'run_id')::uuid;item_a:=gen_random_uuid();target:=gen_random_uuid();
  target:=pg_temp.af08_seed_canonical(f,pg_temp.af08_batch_opportunity('af08-correction-'||run_uuid,'Preserve original correction target'));
  opportunity:=pg_temp.af08_batch_opportunity('af08-correction-'||run_uuid,'Unsafe proposed replacement')||jsonb_build_object('merge_control',jsonb_build_object('corrections',
    jsonb_build_array(jsonb_build_object('path','/title','expected','PRIVATE_EXPECTED_CANARY private.person@example.invalid','reason','Synthetic correction'))));
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,'opportunity',opportunity)));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert result::text!~'CANARY|private.person' and(select title from public.opportunities where id=target)='Preserve original correction target','Unseen/unsafe expected correction was invented, applied or echoed';

  f:=pg_temp.af08_batch_fixture('missing-expected');run_uuid:=(f->>'run_id')::uuid;item_a:=gen_random_uuid();target:=gen_random_uuid();
  insert into public.opportunities(id,opportunity_key,title) values(target,'af08-missing-expected-'||run_uuid,'Keep exact original value');
  select to_jsonb(o) into prior_row from public.opportunities o where id=target;
  select fields into prior_state from private.opportunity_search_merge_state where opportunity_id=target;
  opportunity:=pg_temp.af08_batch_opportunity('af08-missing-expected-'||run_uuid,'Unapproved correction')||jsonb_build_object('merge_control',jsonb_build_object('corrections',
    jsonb_build_array(jsonb_build_object('path','/title','reason','Synthetic missing expected value'))));
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,'opportunity',opportunity)));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert result?'error' and not exists(select 1 from private.opportunity_search_adaptive_items where run_id=run_uuid and item_id=item_a)
    and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),
    'Missing required expected value was accepted or manufactured as NULL';
  assert(select to_jsonb(o) from public.opportunities o where id=target)=prior_row
    and(select fields from private.opportunity_search_merge_state where opportunity_id=target) is not distinct from prior_state,'Missing expected correction advanced value/evidence';
  f:=pg_temp.af08_batch_fixture('safe-expected');run_uuid:=(f->>'run_id')::uuid;item_a:=gen_random_uuid();target:=gen_random_uuid();
  opportunity:=pg_temp.af08_batch_opportunity('af08-safe-expected-'||run_uuid,'Exact known prior title');
  target:=pg_temp.af08_seed_canonical(f,opportunity);
  opportunity:=opportunity||jsonb_build_object('title','Verified corrected title','merge_control',jsonb_build_object('corrections',
    jsonb_build_array(jsonb_build_object('path','/title','expected','Exact known prior title','reason','Official evidence corrects the title'))));
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_a,'opportunity',opportunity)));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert not(result?'error') and(select title from public.opportunities where id=target)='Verified corrected title'
    and exists(select 1 from public.opportunity_search_receipts where run_id=run_uuid and item_id=item_a),'Exact safe supplied correction did not reach canonical v5';

  f:=pg_temp.af08_batch_fixture('source-revocation',true);run_uuid:=(f->>'run_id')::uuid;
  select count(*) into before_plans from public.opportunity_search_query_plans;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',f->>'user_id','is_anonymous',false)::text,true);execute 'set local role authenticated';
  perform public.save_opportunity_search_source((f->>'search_id')::uuid,(f->>'source_registry_id')::uuid,'{"enabled":false}');execute 'reset role';
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,f->'body');
  assert result?'error' and(select count(*) from public.opportunity_search_query_plans)=before_plans
    and(select query_plan_id is null from public.opportunity_search_runs where id=run_uuid)
    and(select query_plan_id is null from public.opportunity_search_adaptive_settings where user_id=(f->>'user_id')::uuid and search_id=(f->>'search_id')::uuid)
    and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Protected source revocation left a new plan/pin/publication/batch';

  -- A plan published after startup must not be overwritten, including the
  -- important case where the captured shared pointer was genuinely NULL.
  f:=pg_temp.af08_batch_fixture('captured-null-cas');run_uuid:=(f->>'run_id')::uuid;
  assert(select expected_shared_plan_id is null from private.opportunity_search_adaptive_contexts where run_id=run_uuid),'Synthetic cold-start pointer was not NULL';
  result:=private.save_opportunity_search_queries(run_uuid,jsonb_build_array(jsonb_build_object('query',f#>>'{body,query_plan,queries,0,query}')));
  plan_uuid:=(result->>'id')::uuid;
  bad:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object('query_id',gen_random_uuid(),
    'query',f#>>'{body,query_plan,queries,0,query}','role','core','manual',true,
    'text_hash',encode(sha256(convert_to(f#>>'{body,query_plan,queries,0,query}','UTF8')),'hex'))));
  result:=private.publish_opportunity_search_plan((f->>'user_id')::uuid,(f->>'search_id')::uuid,plan_uuid,bad,1,
    (select feedback_snapshot_revision from public.opportunity_search_runs where id=run_uuid),0,'opportunity-search-v1-canonical-6');
  shared_uuid:=(result->>'id')::uuid;
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,f->'body');
  assert not(result?'error') and(select query_plan_id from public.opportunity_search_adaptive_settings where user_id=(f->>'user_id')::uuid and search_id=(f->>'search_id')::uuid)=shared_uuid,
    'An initially NULL startup pointer overwrote a newer shared plan';
  assert(select query_plan_id from public.opportunity_search_runs where id=run_uuid)=(result->>'plan_id')::uuid,
    'Stale shared publication lost the actual per-run executed plan';

  -- A historical context without an explicit captured-pointer flag must not
  -- treat a document fallback as permission to overwrite a newer base revision.
  f:=pg_temp.af08_batch_fixture('historical-pointer');run_uuid:=(f->>'run_id')::uuid;historical_query:=gen_random_uuid();
  result:=private.save_opportunity_search_queries(run_uuid,jsonb_build_array(jsonb_build_object('query',f#>>'{body,query_plan,queries,0,query}')));plan_uuid:=(result->>'id')::uuid;
  historical_document:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object('query_id',historical_query,
    'query',f#>>'{body,query_plan,queries,0,query}','role','core','manual',false,'text_hash',encode(sha256(convert_to(f#>>'{body,query_plan,queries,0,query}','UTF8')),'hex'))));
  result:=private.publish_opportunity_search_plan((f->>'user_id')::uuid,(f->>'search_id')::uuid,plan_uuid,historical_document,1,
    (select feedback_snapshot_revision from public.opportunity_search_runs where id=run_uuid),0,'opportunity-search-v1-canonical-6');historical_id:=(result->>'id')::uuid;
  bad:=private.read_opportunity_search_plan((f->>'user_id')::uuid,(f->>'search_id')::uuid,historical_id);
  bad:=jsonb_build_object('id',bad->'id','revision',bad->'plan_revision','plan_hash',bad->'plan_hash','planning_policy',bad->'planning_policy','document',bad->'document','basis',bad->'basis');
  update private.opportunity_search_adaptive_contexts set bundle=jsonb_set(bundle,'{query_plan}',bad),plan_pointer_captured=false,expected_shared_plan_id=null where run_id=run_uuid;
  update private.opportunity_search_adaptive_contexts set bundle_hash=encode(sha256(convert_to(bundle::text,'UTF8')),'hex') where run_id=run_uuid;
  update public.opportunity_search_templates set revision=revision+1,criteria='{"topicsAndMethods":"New explicit owner base"}' where id=(f->>'search_id')::uuid;
  -- This is future owner-planning metadata, not permission for a second active
  -- research run. Seed its immutable revision without bypassing run fencing.
  insert into public.opportunity_search_query_revisions(search_id,user_id,template_revision,protocol_version,queries)
    values((f->>'search_id')::uuid,(f->>'user_id')::uuid,2,'opportunity-search-v1-canonical-6',
      '[{"query":"new explicit owner base query"}]') returning id into plan_uuid;
  bad:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object('query_id',gen_random_uuid(),'query','new explicit owner base query','role','core','manual',false,
    'text_hash',encode(sha256(convert_to('new explicit owner base query','UTF8')),'hex'))));
  result:=private.publish_opportunity_search_plan((f->>'user_id')::uuid,(f->>'search_id')::uuid,plan_uuid,bad,2,
    (select feedback_snapshot_revision from public.opportunity_search_runs where id=run_uuid),0,'opportunity-search-v1-canonical-6');shared_uuid:=(result->>'id')::uuid;
  body:=jsonb_set(f->'body','{query_plan}',historical_document);
  body:=jsonb_set(body,'{execution,checks,0,query_id}',to_jsonb(historical_query));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert not(result?'error') and(select query_plan_id from public.opportunity_search_adaptive_settings where user_id=(f->>'user_id')::uuid and search_id=(f->>'search_id')::uuid)=shared_uuid,
    'Historical document fallback overwrote a newer global base plan';

  -- Closed bounds fail atomically. A zero-opportunity batch still records the
  -- actual core execution and maps it to the real legacy writer anchor.
  f:=pg_temp.af08_batch_fixture('bounds');run_uuid:=(f->>'run_id')::uuid;
  select jsonb_agg(jsonb_build_object('item_id',gen_random_uuid(),'opportunity',pg_temp.af08_batch_opportunity('af08-over-'||gen_random_uuid()))) into bad from generate_series(1,11);
  body:=jsonb_set(f->'body','{opportunities}',bad);result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert result?'error' and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Oversized opportunity count partly saved';
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',gen_random_uuid(),
    'opportunity',pg_temp.af08_batch_opportunity('af08-byte-'||run_uuid)||jsonb_build_object('research_summary',repeat('s',262145)))));
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert result?'error' and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Per-opportunity byte bound partly saved';
  select jsonb_agg(jsonb_build_object('item_id',gen_random_uuid(),'opportunity',pg_temp.af08_batch_opportunity('af08-batch-byte-'||gen_random_uuid())
    ||jsonb_build_object('research_summary',repeat('s',180000)))) into bad from generate_series(1,3);
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,jsonb_set(f->'body','{opportunities}',bad));
  assert result?'error' and not exists(select 1 from private.opportunity_search_adaptive_batches where run_id=run_uuid),'Total batch byte bound partly saved';
  result:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,f->'body');
  assert result->'batch_schema_version'='1'::jsonb and exists(select 1 from public.opportunity_search_runs where id=run_uuid and queries is not null and query_plan_id is not null)
    and(select count(*) from public.opportunity_search_executions where run_id=run_uuid)=1,'Zero-opportunity batch lost plan/actual coverage';
  assert jsonb_array_length(private.opportunity_search_adaptive_manifest(run_uuid)->'batch_ids')=1
    and jsonb_array_length(private.opportunity_search_adaptive_manifest(run_uuid)->'item_ids')=0,'Zero-result manifest was fabricated or omitted';
  body:=jsonb_build_object('schema_version',1,'plan_hash',result->'plan_hash','opportunities','[]'::jsonb,'execution','{"checks":[],"complete":true}'::jsonb);
  for n in 2..32 loop again:=private.submit_adaptive_search_batch(run_uuid,gen_random_uuid(),body);assert not(again?'error'),'Valid bounded batch capacity failed';end loop;
  again:=private.submit_adaptive_search_batch(run_uuid,gen_random_uuid(),body);
  assert again?'error' and jsonb_array_length(private.opportunity_search_adaptive_manifest(run_uuid)->'batch_ids')=32,'The run exceeded its 32-batch envelope';
end;
$$;
rollback;
