-- AF-06 synthetic owner intent, revisions and deterministic planning checks.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();conflict_search uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();
  run_id_value uuid:=gen_random_uuid();summary_run uuid:=gen_random_uuid();anchor uuid;plan_id uuid;legacy_plan uuid:=gen_random_uuid();query_id_value uuid:=gen_random_uuid();exploration_id uuid:=gen_random_uuid();opportunity uuid;target uuid;summary_target uuid;
  pending_id uuid:=gen_random_uuid();positive_id uuid:=gen_random_uuid();hard_id uuid:=gen_random_uuid();negative_id uuid:=gen_random_uuid();source_id uuid:=gen_random_uuid();
  positive_rule uuid:=gen_random_uuid();hard_rule uuid:=gen_random_uuid();negative_rule uuid:=gen_random_uuid();source_rule uuid:=gen_random_uuid();
  approve_op uuid:=gen_random_uuid();reject_op uuid:=gen_random_uuid();undo_op uuid:=gen_random_uuid();n integer;blocked boolean;protocol text;doc jsonb;rule jsonb;result jsonb;repeat_result jsonb;
  packet jsonb;before_packet jsonb;context jsonb;again jsonb;original_criteria jsonb;original_revision integer;snapshot_revision_value bigint;application_id uuid:=gen_random_uuid();application_context jsonb;proof public.opportunity_reviews;
  schedule jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_a),(owner_b);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
    (search_a,owner_a,'Synthetic adaptive preferences','{"topicsAndMethods":"BCI; Acoustics; Robotics"}',schedule),
    (search_b,owner_b,'Synthetic other owner','{"topicsAndMethods":"Synthetic research"}',schedule);
  select criteria,revision into original_criteria,original_revision from public.opportunity_search_templates where id=search_a;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  result:=public.read_opportunity_search_preferences(search_a);
  assert result->'preference_revision'='0'::jsonb and result->'adaptation_enabled'='false'::jsonb,'Adaptation did not default off';
  assert result#>'{policy,minimum_observations}'='3'::jsonb and result#>'{policy,positive_interest_threshold}'='6'::jsonb and result#>'{policy,exploration_ratio}'='0.2'::jsonb,'Visible policy constants missing';
  perform public.save_opportunity_search_adaptation(search_a,true,false,0);
  perform public.save_opportunity_search_source(search_a,registry,'{"listing_url":"https://example.invalid/ResearchJobs","enabled":true,"pinned":true,"mandatory":true}');
  execute 'reset role';
  for n in 1..9 loop
    opportunity:=gen_random_uuid();if n=1 then target:=opportunity;elsif n=4 then summary_target:=opportunity;end if;
    insert into public.opportunities(id,opportunity_key,title,institution,topics)
      values(opportunity,'af06-'||opportunity,'Synthetic research '||n,'Synthetic Institute',case when n<=3 then array['Robotics'] when n<=6 then array['Acoustics'] else array['BCI'] end);
    insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,interest_reasons,comment) values(owner_a,opportunity,case when n<=3 or n=7 then 'not_interested' when n<=6 then 'strong_interest' else 'interested' end,case when n<=3 or n=7 then 2 when n<=6 then 8 else 4 end,
      case when n=1 then '[{"category":"topic","polarity":"negative","target":"Robotics"},{"category":"hardware","polarity":"negative"}]'::jsonb
        when n=2 then '[{"category":"timing","polarity":"negative"},{"category":"hardware","polarity":"negative"}]'::jsonb
        when n=3 then '[{"category":"location","polarity":"negative"},{"category":"hardware","polarity":"negative"}]'::jsonb
        when n<=6 then '[{"category":"method","polarity":"positive","target":"Prototyping"}]'::jsonb
        when n=7 then '[{"category":"topic","polarity":"negative","target":"BCI"}]'::jsonb
        else '[{"category":"method","polarity":"positive","target":"Fusion"},{"category":"method","polarity":"negative","target":"Fusion"}]'::jsonb end,'Private person@example.invalid');
  end loop;
  execute 'set local role authenticated';perform public.create_job_application(application_id,summary_target);execute 'reset role';
  select context_json into application_context from public.applications where id=application_id;
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  select active_protocol_version into protocol from private.opportunity_search_settings where singleton;
  perform private.begin_opportunity_search(search_a,run_id_value);
  result:=private.save_opportunity_search_queries(run_id_value,'[{"query":"synthetic physical sensing"}]');anchor:=(result->>'id')::uuid;
  doc:=jsonb_build_object('schema_version',2,'queries',jsonb_build_array(jsonb_build_object('query_id',query_id_value,'query','synthetic physical sensing',
    'text_hash',encode(sha256(convert_to('synthetic physical sensing','UTF8')),'hex'),'role','core','manual',true,'source_registry_id',registry),jsonb_build_object('query_id',exploration_id,'query','synthetic adjacent research exploration','text_hash',encode(sha256(convert_to('synthetic adjacent research exploration','UTF8')),'hex'),'role','exploration','manual',false)));
  result:=private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,original_revision,(packet->>'feedback_revision')::bigint,0,protocol);plan_id:=(result->>'id')::uuid;
  assert result->'planning_policy'=public.opportunity_search_adaptation_policy(20)
    and private.read_opportunity_search_plan(owner_a,search_a,plan_id)->'planning_policy'=result->'planning_policy','Exact planning policy was not pinned in the immutable plan DTO';
  insert into public.opportunity_search_query_plans(id,user_id,search_id,query_revision_id,plan_revision,base_revision,feedback_revision,preference_revision,protocol_version,document,plan_hash)
    select legacy_plan,user_id,search_id,query_revision_id,plan_revision+1000,base_revision,feedback_revision,preference_revision,protocol_version,document,
      encode(sha256(convert_to(legacy_plan::text,'UTF8')),'hex') from public.opportunity_search_query_plans where id=plan_id;
  assert private.opportunity_search_planning_context(owner_a,search_a,packet,legacy_plan)->'refresh_required'='true'::jsonb,'Unversioned legacy planning policy was silently considered current';
  context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  again:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert context=again,'Same planning inputs produced different priorities/allocation';
  assert context#>'{allocation,core_queries}'='1'::jsonb and context#>'{allocation,source_obligations}'='1'::jsonb
    and context#>'{allocation,discretionary}'='29'::jsonb and context#>'{allocation,exploration}'='6'::jsonb,'Direct source checks consumed query entries or exploration was not reserved';
  assert exists(select 1 from jsonb_array_elements(context->'priorities') p where p->>'category'='hardware' and p->>'direction'='decrease' and p->'observations'='3'::jsonb),'Hardware-only evidence did not affect hardware emphasis';
  assert exists(select 1 from jsonb_array_elements(context->'priorities') p where p->>'category'='topic' and p->>'target'='robotics' and p->>'direction'='examples_only' and p->'observations'='1'::jsonb),
    'Timing/location cohort lent observations to one targeted negative reason';
  assert exists(select 1 from jsonb_array_elements(context->'priorities') p where p->>'target'='acoustics' and p->>'direction'='increase'),'Supported positive topic evidence was ignored';
  assert exists(select 1 from jsonb_array_elements(context->'priorities') p where p->>'target'='fusion' and p->>'reason'='contradictory' and p->'provisional'='true'::jsonb),'Contradictory evidence became a strong shift';
  assert not context::text~'person@example.invalid|comment|context_json','Planning context exposed private content';
  -- Current planning also omits institution cohorts from retained older packets.
  before_packet:=jsonb_set(packet,'{aggregates,groups}',(packet#>'{aggregates,groups}')||jsonb_build_array(
    jsonb_build_object('kind','institution','key','synthetic institute','count',9,'scored',9,'score_sum',63,'mean_interest',7)));
  again:=private.opportunity_search_planning_context(owner_a,search_a,before_packet,plan_id);
  assert not exists(select 1 from jsonb_array_elements(again->'priorities') p where p->>'category'='institution'),
    'Historical institution cohort became redundant current planning output';
  assert again->'priorities'=context->'priorities','Omitting institution cohorts changed project-level preferences';
  snapshot_revision_value:=(packet->>'feedback_revision')::bigint;
  assert (select s.packet from public.opportunity_search_feedback_snapshots s where s.user_id=owner_a and s.search_id=search_a
    and s.feedback_revision=snapshot_revision_value)=packet,'Planning rewrote an immutable feedback snapshot';

  rule:=jsonb_build_object('rule_id',gen_random_uuid(),'kind','hard_exclusion','category','topic','target','Robotics','evidence_refs',jsonb_build_array(target));
  before_packet:=packet;
  result:=private.propose_opportunity_search_preference(owner_a,search_a,pending_id,rule);
  assert result->'executable'='false'::jsonb,'Runner proposal became executable';
  assert private.compile_opportunity_feedback_snapshot(owner_a,search_a)=before_packet,'Pending suggestion advanced approved feedback revision';
  blocked:=false;begin perform private.propose_opportunity_search_preference(owner_a,search_a,gen_random_uuid(),jsonb_set(rule,'{evidence_refs}','[]'));exception when invalid_parameter_value then blocked:=true;end;
  assert blocked,'Runner invented an unsupported suggestion';
  blocked:=false;begin perform public.decide_opportunity_search_preference(search_a,pending_id,'approve',0,gen_random_uuid());exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Management research approved its own proposal';
  execute 'set local role authenticated';
  result:=public.decide_opportunity_search_preference(search_a,pending_id,'reject',0,reject_op);
  assert result->'preference_revision'='0'::jsonb,'Reject changed executable rules';
  assert result=public.decide_opportunity_search_preference(search_a,pending_id,'reject',0,reject_op),'Reject retry was not idempotent';
  result:=public.decide_opportunity_search_preference(search_a,pending_id,'approve',0,approve_op);
  assert result->'preference_revision'='1'::jsonb,'Explicit approval did not publish independent revision';
  assert result=public.decide_opportunity_search_preference(search_a,pending_id,'approve',0,approve_op),'Lost approval response did not replay';
  blocked:=false;begin perform public.decide_opportunity_search_preference(search_a,pending_id,'undo',1,approve_op);exception when serialization_failure then blocked:=true;end;
  assert blocked,'Decision ID accepted changed content';
  blocked:=false;begin perform public.decide_opportunity_search_preference(search_a,pending_id,'undo',0,gen_random_uuid());exception when serialization_failure then blocked:=true;end;
  assert blocked,'Stale approval revision silently overwrote owner intent';
  execute 'reset role';
  blocked:=false;begin perform private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,original_revision,(packet->>'feedback_revision')::bigint,0,protocol);exception when serialization_failure then blocked:=true;end;
  assert blocked,'Old preference basis published after approval';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert packet->'preference_revision'='1'::jsonb and packet->>'input_fingerprint'<>before_packet->>'input_fingerprint','Approved rules were absent from fingerprint/version';
  result:=private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,original_revision,(packet->>'feedback_revision')::bigint,1,protocol);plan_id:=(result->>'id')::uuid;
  assert result->'document'=doc,'Preference refresh rewrote manual core queries';
  execute 'set local role authenticated';
  result:=public.decide_opportunity_search_preference(search_a,pending_id,'undo',1,undo_op);
  assert result->'preference_revision'='2'::jsonb and result->'approved_rules'='[]'::jsonb,'Undo did not explicitly restore approved state';
  assert result=public.decide_opportunity_search_preference(search_a,pending_id,'undo',1,undo_op),'Undo retry changed state again';

  -- Explicit intent wins; a hard exclusion is never downgraded to soft emphasis.
  perform public.propose_opportunity_search_preference(search_a,positive_id,jsonb_build_object('rule_id',positive_rule,'kind','emphasis','category','topic','polarity','positive','target',' BCI ','evidence_refs','[]'::jsonb));
  perform public.decide_opportunity_search_preference(search_a,positive_id,'approve',2,gen_random_uuid());
  perform public.propose_opportunity_search_preference(search_a,hard_id,jsonb_build_object('rule_id',hard_rule,'kind','hard_exclusion','category','topic','target','bci','evidence_refs','[]'::jsonb));
  result:=public.decide_opportunity_search_preference(search_a,hard_id,'approve',3,gen_random_uuid());
  assert jsonb_array_length(result->'approved_rules')=2,'Hard/soft audit distinctions were lost';
  result:=public.read_opportunity_search_preferences(search_a);
  assert result->'approved_preferences'='[]'::jsonb,'Hard exclusion leaked as a conflicting positive preference';
  perform public.propose_opportunity_search_preference(search_a,negative_id,jsonb_build_object('rule_id',negative_rule,'kind','emphasis','category','topic','polarity','negative','target','bci','evidence_refs','[]'::jsonb));
  result:=public.decide_opportunity_search_preference(search_a,negative_id,'approve',4,gen_random_uuid());
  assert jsonb_array_length(result->'approved_rules')=2 and not exists(select 1 from jsonb_array_elements(result->'approved_rules') r where r->>'rule_id'=positive_rule::text),'New explicit emphasis did not supersede contradictory old emphasis';
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert not exists(select 1 from jsonb_array_elements(context->'priorities') p where p->>'category'='topic' and lower(p->>'target')='bci'),'Hard-excluded target still received adaptive emphasis';
  execute 'set local role authenticated';
  perform public.decide_opportunity_search_preference(search_a,hard_id,'undo',5,gen_random_uuid());
  result:=public.decide_opportunity_search_preference(search_a,negative_id,'undo',6,gen_random_uuid());
  assert result->'preference_revision'='7'::jsonb and exists(select 1 from jsonb_array_elements(result->'approved_rules') r where r->>'rule_id'=positive_rule::text),'Undo lost the superseded owner rule';
  perform public.propose_opportunity_search_preference(search_a,source_id,jsonb_build_object('rule_id',source_rule,'kind','source_exclusion','source_registry_id',registry,'evidence_refs','[]'::jsonb));
  perform public.decide_opportunity_search_preference(search_a,source_id,'approve',7,gen_random_uuid());
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert context->'blocked_core_queries'=jsonb_build_array(jsonb_build_object('query_id',query_id_value,'rule_id',source_rule)) and context#>'{allocation,source_obligations}'='0'::jsonb,
    'Approved source exclusion did not authorize a clear skip of saved core/source obligations';
  assert (select document from public.opportunity_search_query_plans where id=plan_id)=doc,'Source exclusion edited immutable query text';

  -- Thirty preserved core queries leave no invented exploration slot.
  select doc||jsonb_build_object('queries',jsonb_build_array(doc#>'{queries,0}')||jsonb_agg(jsonb_build_object('query_id',gen_random_uuid(),'query','synthetic core query '||i,
    'text_hash',encode(sha256(convert_to('synthetic core query '||i,'UTF8')),'hex'),'role','core','manual',true))) into doc from generate_series(1,29) i;
  result:=private.publish_opportunity_search_plan(owner_a,search_a,anchor,doc,original_revision,(packet->>'feedback_revision')::bigint,8,protocol);plan_id:=(result->>'id')::uuid;
  context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert context#>'{allocation,discretionary}'='0'::jsonb and context#>'{allocation,exploration}'='0'::jsonb and context#>'{allocation,capacity_limited}'='true'::jsonb,'Full core budget invented exploration';

  execute 'set local role authenticated';
  perform public.save_opportunity_comment(summary_target,'Prefer acoustic prototype research.');
  execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);before_packet:=packet;
  perform private.begin_opportunity_search(search_a,summary_run);perform private.pin_opportunity_feedback_snapshot(owner_a,search_a,summary_run);
  execute 'set local role authenticated';perform public.save_opportunity_search_adaptation(search_a,true,true,1);execute 'reset role';
  packet:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,summary_run);
  assert packet=before_packet,'Pausing learning changed pinned default feedback';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert context->'priorities'='[]'::jsonb and context#>'{allocation,adaptive}'='0'::jsonb,'Paused context kept adaptive emphasis';
  execute 'set local role authenticated';perform public.save_opportunity_search_adaptation(search_a,true,false,2);execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
  assert exists(select 1 from jsonb_array_elements(packet->'examples') e where e?'search_feedback_summary'),'Learning toggle lost current evaluation';
  execute 'set local role authenticated';perform public.save_opportunity_search_adaptation(search_a,false,false,3);execute 'reset role';
  packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);context:=private.opportunity_search_planning_context(owner_a,search_a,packet,plan_id);
  assert jsonb_array_length(packet->'examples')>0 and context->'priorities'='[]'::jsonb,'Disabled learning changed default feedback or kept adaptive priorities';
  assert (select criteria=original_criteria and revision=original_revision from public.opportunity_search_templates where id=search_a),'Learning rewrote authoritative base interests/revision';
  assert (select context_json=application_context from public.applications where id=application_id),'Learning rewrote captured application context';
  -- Restoring a superseded rule may not collide with a newer owner decision
  -- which has reused its stable identity for another target.
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(conflict_search,owner_a,'Synthetic undo conflict','{"topicsAndMethods":"Synthetic conflict"}',schedule);
  execute 'set local role authenticated';
  perform public.propose_opportunity_search_preference(conflict_search,positive_id,jsonb_build_object('rule_id',positive_rule,'kind','emphasis','category','topic','polarity','positive','target','BCI','evidence_refs','[]'::jsonb));
  perform public.decide_opportunity_search_preference(conflict_search,positive_id,'approve',0,gen_random_uuid());
  perform public.propose_opportunity_search_preference(conflict_search,source_id,jsonb_build_object('rule_id',positive_rule,'kind','emphasis','category','topic','polarity','positive','target','BCI','evidence_refs','[]'::jsonb));
  result:=public.decide_opportunity_search_preference(conflict_search,source_id,'approve',1,gen_random_uuid());
  assert result->'preference_revision'='1'::jsonb,'Identical approved contents advanced semantic preference revision';
  blocked:=false;begin perform public.decide_opportunity_search_preference(conflict_search,source_id,'undo',1,gen_random_uuid());exception when serialization_failure then blocked:=true;end;
  assert blocked,'A no-op suggestion undid another effective approval';
  perform public.propose_opportunity_search_preference(conflict_search,negative_id,jsonb_build_object('rule_id',negative_rule,'kind','emphasis','category','topic','polarity','negative','target','BCI','evidence_refs','[]'::jsonb));
  perform public.decide_opportunity_search_preference(conflict_search,negative_id,'approve',1,gen_random_uuid());
  perform public.propose_opportunity_search_preference(conflict_search,hard_id,jsonb_build_object('rule_id',positive_rule,'kind','emphasis','category','topic','polarity','positive','target','Robotics','evidence_refs','[]'::jsonb));
  perform public.decide_opportunity_search_preference(conflict_search,hard_id,'approve',2,gen_random_uuid());
  blocked:=false;begin perform public.decide_opportunity_search_preference(conflict_search,negative_id,'undo',3,gen_random_uuid());exception when serialization_failure then blocked:=true;end;
  assert blocked and public.read_opportunity_search_preferences(conflict_search)->'preference_revision'='3'::jsonb,'Undo overwrote a newer owner rule or duplicated its stable ID';
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'is_anonymous',false)::text,true);execute 'set local role authenticated';
  blocked:=false;begin perform public.read_opportunity_search_preferences(search_a);exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Other owner read approved private preferences';
  assert not exists(select 1 from public.opportunity_search_preference_actions where user_id=owner_a),'Other owner read action audit';
  blocked:=false;begin perform public.propose_opportunity_search_preference(search_b,gen_random_uuid(),jsonb_build_object('rule_id',gen_random_uuid(),'kind','emphasis','category','topic','polarity','positive','target','BCI','evidence_refs',jsonb_build_array(target)));exception when insufficient_privilege then blocked:=true;end;
  assert blocked,'Other owner supplied valid private evidence IDs';
  assert not has_function_privilege(current_user,'private.opportunity_search_planning_context(uuid,uuid,jsonb,uuid)','EXECUTE'),'Management planner exposed to browser';
  assert not has_table_privilege(current_user,'public.opportunity_search_preference_actions','UPDATE'),'Owner could rewrite immutable approval history';
  execute 'reset role';
end;
$$;
rollback;
