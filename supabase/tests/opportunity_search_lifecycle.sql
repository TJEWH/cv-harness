-- Lifecycle contract 1. Entirely synthetic owners, runs and provider bindings.
-- No production scope, external provider call, or research is used by this fixture.
begin;
create function pg_temp.lifecycle_fixture(p_label text, p_active boolean default true) returns jsonb language plpgsql as $$
declare owner_id uuid:=gen_random_uuid();search_id uuid:=gen_random_uuid();run_id uuid:=gen_random_uuid();
  query_id uuid:=gen_random_uuid();check_id uuid:=gen_random_uuid();batch_id uuid:=gen_random_uuid();result jsonb;payload jsonb;
  project text:='llllllllllllllllllll';task_id text:='synthetic-lifecycle-'||gen_random_uuid();
  schedule jsonb:='{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}';
begin
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_id,owner_id,'Synthetic lifecycle '||p_label,'{"topicsAndMethods":"LIFECYCLE_RESEARCH_PRIVATE_CANARY"}',schedule);
  update public.opportunity_search_adaptive_release set enabled=true,project_ref=project where singleton;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.set_opportunity_search_runner_authorization(search_id,project,true,0);
  execute 'reset role';
  insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
    values(owner_id,search_id,project,'adaptive',false,gen_random_uuid());
  insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
    values(search_id,owner_id,task_id,schedule,1,'opportunity-search-v1-canonical-6','adaptive-batch-v1');
  if p_active then
    result:=private.begin_adaptive_opportunity_search(search_id,run_id);
    assert result->'compatible'='true'::jsonb,'Synthetic lifecycle startup unavailable';
  end if;
  payload:=jsonb_build_object('schema_version',1,'query_plan',jsonb_build_object('schema_version',2,'queries',jsonb_build_array(
    jsonb_build_object('query_id',query_id,'query','synthetic lifecycle research query','role','core','manual',false))),
    'opportunities','[]'::jsonb,'execution',jsonb_build_object('checks',jsonb_build_array(jsonb_build_object('check_id',check_id,
      'kind','query','query_id',query_id,'attempted_at',clock_timestamp(),'status','complete','results_count',0)),'complete',true));
  return jsonb_build_object('user_id',owner_id,'search_id',search_id,'run_id',run_id,'project_ref',project,'task_id',task_id,
    'body',payload,'batch_id',batch_id,'check_id',check_id);
end;
$$;
create function pg_temp.lifecycle_prepare(p_fixture jsonb,p_mode text,p_operation_id uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_fixture->>'user_id','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  result:=public.prepare_adaptive_search_lifecycle((p_fixture->>'search_id')::uuid,p_fixture->>'project_ref',p_mode,p_operation_id);
  execute 'reset role';return result;
exception when others then execute 'reset role';raise;
end;
$$;
-- The assertion accepts either a closed error receipt or a SQL rejection. It
-- never infers a cause from error prose or treats a returned failure as success.
create function pg_temp.lifecycle_rejects(p_statement text) returns boolean language plpgsql as $$
declare result jsonb;
begin
  execute p_statement into result;
  return result->'compatible'='false'::jsonb or result?'error';
exception when undefined_function or undefined_column or undefined_table or syntax_error then raise;
  when others then return true;
end;
$$;
create function pg_temp.lifecycle_opportunity(p_key text) returns jsonb language sql as $$
  select jsonb_build_object('opportunity_key',p_key,'title','Synthetic preserved opportunity','official_url','https://example.invalid/Lifecycle/'||p_key,
    'last_checked_at',clock_timestamp(),'personal_fit',jsonb_build_object('score',8,'scale_min',0,'scale_max',10,'summary','Synthetic prior work'),
    'sources',jsonb_build_array(jsonb_build_object('url','https://example.invalid/Lifecycle/'||p_key,'kind','official','checked_at',clock_timestamp(),
      'precision','instant','supports',jsonb_build_array('title','official_url','personal_fit'))))
$$;

do $$
declare f jsonb;other jsonb;prepared jsonb;receipt jsonb;verified jsonb;again jsonb;body jsonb;batch_receipt jsonb;before_run jsonb;
  before_binding jsonb;before_template jsonb;before_opportunity jsonb;before_review jsonb;before_application jsonb;
  operation_id uuid;run_uuid uuid;new_run uuid;item_uuid uuid;opportunity_uuid uuid;application_id uuid;reserved uuid;
  statement text;prior_batch_count bigint;prior_receipt_count bigint;prior_check_count bigint;
begin
  -- Abort no-batch work without asking for a fabricated completion manifest.
  f:=pg_temp.lifecycle_fixture('empty');run_uuid:=(f->>'run_id')::uuid;operation_id:=gen_random_uuid();
  select to_jsonb(b) into before_binding from public.opportunity_search_schedule_bindings b where search_id=(f->>'search_id')::uuid;
  select to_jsonb(t) into before_template from public.opportunity_search_templates t where id=(f->>'search_id')::uuid;
  prepared:=pg_temp.lifecycle_prepare(f,'abort',operation_id);
  assert prepared->'compatible'='true'::jsonb and prepared->>'outcome'='prepared','Owner preparation failed';
  assert prepared#>>'{target,run_id}'=run_uuid::text and prepared#>>'{scope,task_id}'=f->>'task_id','Exact target/binding was not pinned';
  assert prepared::text!~'LIFECYCLE_RESEARCH_PRIVATE_CANARY|criteria|feedback|data_base64|protocol_text|snapshot','Lifecycle leaked research inputs';
  again:=pg_temp.lifecycle_prepare(f,'abort',operation_id);assert again=prepared,'Identical preparation retargeted or changed';
  receipt:=private.apply_adaptive_search_lifecycle(operation_id);
  assert receipt->>'outcome'='aborted' and receipt#>>'{abort,status}'='aborted','Abort not persisted';
  assert private.apply_adaptive_search_lifecycle(operation_id)=receipt,'Lost abort receipt replay changed operation';
  verified:=private.read_adaptive_search_lifecycle(operation_id);
  assert verified#>'{abort,verified}'='false'::jsonb and verified#>'{abort,lease_released}'='true'::jsonb,'Same-transaction read fabricated independent verification';
  assert verified#>>'{abort,reason}'='owner_cancelled' and verified->>'worker_termination'='unknown','Abort fabricated worker termination';
  assert(select status from public.opportunity_search_runs where id=run_uuid)='failed','Cancellation did not terminalize target';
  assert not exists(select 1 from private.opportunity_search_adaptive_completions c where c.run_id=run_uuid),'Abort fabricated research completion';
  new_run:=gen_random_uuid();again:=private.begin_adaptive_opportunity_search((f->>'search_id')::uuid,new_run);
  assert again->'compatible'='true'::jsonb,'Genuinely new execution remained blocked after abort';
  again:=pg_temp.lifecycle_prepare(f,'abort',operation_id);
  assert again#>>'{target,run_id}'=run_uuid::text,'Repeated abort-current selected the newer run';
  perform private.apply_adaptive_search_lifecycle(operation_id);
  assert(select status from public.opportunity_search_runs where id=new_run)='running','Exact retry cancelled a newer execution';
  assert(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id=(f->>'search_id')::uuid)=before_binding,'Abort changed schedule/binding';
  assert(select to_jsonb(t) from public.opportunity_search_templates t where id=(f->>'search_id')::uuid)=before_template,'Abort changed saved search';

  -- Preserve committed partial work and do not verify it merely because it was cancelled.
  f:=pg_temp.lifecycle_fixture('partial');run_uuid:=(f->>'run_id')::uuid;operation_id:=gen_random_uuid();item_uuid:=gen_random_uuid();
  body:=jsonb_set(f->'body','{opportunities}',jsonb_build_array(jsonb_build_object('item_id',item_uuid,
    'opportunity',pg_temp.lifecycle_opportunity('lifecycle-'||item_uuid),'attribution',jsonb_build_object('execution_refs',jsonb_build_array(f->'check_id'),'discovered_at',clock_timestamp()))));
  body:=jsonb_set(body,'{execution,checks,0,results_count}','1');
  batch_receipt:=private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body);
  assert not(batch_receipt?'error'),'Synthetic committed partial batch failed';
  select r.opportunity_id into opportunity_uuid from public.opportunity_search_receipts r where r.run_id=run_uuid and r.item_id=item_uuid;
  insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values((f->>'user_id')::uuid,opportunity_uuid,'strong_interest','LIFECYCLE_REVIEW_CANARY');
  application_id:=gen_random_uuid();
  insert into public.applications(id,user_id,opportunity_id,status,workflow_stage,notes)
    values(application_id,(f->>'user_id')::uuid,opportunity_uuid,'preparation','tracking','LIFECYCLE_APPLICATION_CANARY');
  select to_jsonb(o) into before_opportunity from public.opportunities o where id=opportunity_uuid;
  select to_jsonb(r) into before_review from public.opportunity_reviews r where r.user_id=(f->>'user_id')::uuid and r.opportunity_id=opportunity_uuid;
  select to_jsonb(a) into before_application from public.applications a where id=application_id;
  select count(*) into prior_batch_count from private.opportunity_search_adaptive_batches b where b.run_id=run_uuid;
  select count(*) into prior_receipt_count from public.opportunity_search_receipts r where r.run_id=run_uuid;
  select count(*) into prior_check_count from public.opportunity_search_executions e where e.run_id=run_uuid;
  prepared:=pg_temp.lifecycle_prepare(f,'abort',operation_id);assert prepared#>>'{writes,accepted_batches}'='1','Preparation omitted actual prior batch';
  perform private.apply_adaptive_search_lifecycle(operation_id);verified:=private.read_adaptive_search_lifecycle(operation_id);
  assert verified#>'{abort,verified}'='false'::jsonb,'Partial abort was verified before its transaction committed';
  assert(select to_jsonb(o) from public.opportunities o where id=opportunity_uuid)=before_opportunity,'Cancellation changed canonical opportunity';
  assert(select to_jsonb(r) from public.opportunity_reviews r where r.user_id=(f->>'user_id')::uuid and r.opportunity_id=opportunity_uuid)=before_review,'Cancellation changed private review';
  assert(select to_jsonb(a) from public.applications a where id=application_id)=before_application,'Cancellation changed application context';
  assert not exists(select 1 from public.opportunity_search_receipts r where r.run_id=run_uuid and r.verified_at is not null),'Cancellation invented separate verification';
  assert private.submit_adaptive_search_batch(run_uuid,(f->>'batch_id')::uuid,body)=batch_receipt,'Committed exact batch receipt stopped being readable';
  select to_jsonb(r) into before_run from public.opportunity_search_runs r where id=run_uuid;
  -- Every direct run-dependent mutation path remains fenced after cancellation.
  foreach statement in array array[
    format('select private.begin_adaptive_opportunity_search(%L::uuid,%L::uuid)',f->>'search_id',run_uuid),
    format('select private.begin_opportunity_search(%L::uuid,%L::uuid)',f->>'search_id',run_uuid),
    format('select private.submit_adaptive_search_batch(%L::uuid,%L::uuid,%L::jsonb)',run_uuid,gen_random_uuid(),body),
    format('select private.verify_and_complete_adaptive_search(%L::uuid,%L::jsonb)',run_uuid,jsonb_build_object('schema_version',1,'completion_id',gen_random_uuid(),'batch_ids',jsonb_build_array(f->'batch_id'),'status','failed')),
    format('select private.submit_opportunity_search_result(%L::uuid,%L::uuid,%L::jsonb)',run_uuid,gen_random_uuid(),pg_temp.lifecycle_opportunity('blocked-'||run_uuid)),
    format('select private.save_opportunity_search_queries(%L::uuid,''[]''::jsonb)',run_uuid),
    format('select private.refresh_opportunity_search_protocol(%L::uuid)',run_uuid),
    format('select private.refresh_adaptive_execution_scope(%L::uuid)',run_uuid),
    format('select private.prepare_opportunity_search_execution(%L::uuid)',run_uuid),
    format('select private.pin_opportunity_feedback_snapshot(%L::uuid,%L::uuid,%L::uuid)',f->>'user_id',f->>'search_id',run_uuid),
    format('select private.pin_opportunity_search_plan(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',f->>'user_id',f->>'search_id',run_uuid,gen_random_uuid()),
    format('select private.verify_opportunity_search_result(%L::uuid,%L::uuid)',run_uuid,item_uuid),
    format('select private.verify_opportunity_search_discovery(%L::uuid,%L::uuid)',run_uuid,item_uuid),
    format('select private.record_opportunity_search_execution(%L::uuid,%L::uuid,%L::jsonb)',run_uuid,gen_random_uuid(),'{"checks":[],"complete":true}'),
    format('select private.record_opportunity_search_discovery(%L::uuid,%L::uuid,''{}''::jsonb)',run_uuid,gen_random_uuid()),
    format('select private.rollback_opportunity_search_merge(%L::uuid,true)',run_uuid)
  ] loop assert pg_temp.lifecycle_rejects(statement),'Cancelled mutation was accepted: '||split_part(statement,'(',1);end loop;
  assert(select to_jsonb(r) from public.opportunity_search_runs r where id=run_uuid)=before_run,'Stale worker mutated cancelled run';
  assert(select to_jsonb(o) from public.opportunities o where id=opportunity_uuid)=before_opportunity,'Stale worker mutated canonical data';
  assert(select count(*) from private.opportunity_search_adaptive_batches b where b.run_id=run_uuid)=prior_batch_count
    and(select count(*) from public.opportunity_search_receipts r where r.run_id=run_uuid)=prior_receipt_count
    and(select count(*) from public.opportunity_search_executions e where e.run_id=run_uuid)=prior_check_count,'Cancelled worker appended prior work';

  -- A chained same-transaction read cannot authorize a reserved restart.
  -- Independent committed readback/current-definition cases use separate TS actions.
  f:=pg_temp.lifecycle_fixture('uncommitted-restart');operation_id:=gen_random_uuid();
  prepared:=pg_temp.lifecycle_prepare(f,'abort_and_restart',operation_id);reserved:=(prepared#>>'{restart,run_id}')::uuid;
  assert reserved is not null and reserved<>(f->>'run_id')::uuid,'Combined operation did not reserve a distinct run ID';
  receipt:=private.apply_adaptive_search_lifecycle(operation_id);
  assert receipt#>>'{restart,status}'='reserved_not_dispatched' and receipt#>'{restart,dispatch_receipt}'='null'::jsonb,'Cancellation fabricated dispatch';
  verified:=private.read_adaptive_search_lifecycle(operation_id);
  assert verified#>'{abort,verified}'='false'::jsonb,'Chained read verified an uncommitted abort';
  assert pg_temp.lifecycle_rejects(format('select private.begin_adaptive_opportunity_search(%L::uuid,%L::uuid)',f->>'search_id',reserved)),
    'Restart began before independently committed abort readback';

  -- Absence and ambiguous active state are persisted outcomes, never a request
  -- to select a historical/latest run or start anyway.
  foreach statement in array array['abort','abort_and_restart'] loop
    f:=pg_temp.lifecycle_fixture('no-active-'||statement,false);operation_id:=gen_random_uuid();
    prepared:=pg_temp.lifecycle_prepare(f,statement,operation_id);
    assert prepared->>'outcome'='no_active_run' and prepared->'target'='null'::jsonb and prepared#>'{restart,run_id}'='null'::jsonb,'No-active command silently became start';
    perform private.apply_adaptive_search_lifecycle(operation_id);perform private.read_adaptive_search_lifecycle(operation_id);
    assert not exists(select 1 from public.opportunity_search_runs where search_id=(f->>'search_id')::uuid),'No-active lifecycle created a run';
  end loop;
  f:=pg_temp.lifecycle_fixture('ambiguous');new_run:=gen_random_uuid();
  insert into public.opportunity_search_runs(id,search_id,user_id,template_revision,protocol_version,definition)
    select new_run,search_id,user_id,template_revision,protocol_version,definition from public.opportunity_search_runs where id=(f->>'run_id')::uuid;
  prepared:=pg_temp.lifecycle_prepare(f,'abort',gen_random_uuid());assert prepared->>'outcome'='ambiguous_active_run','Ambiguous active runs picked arbitrary target';
  assert prepared->'target'='null'::jsonb,'Ambiguous preparation exposed a guessed target';

  -- Prepared target and binding snapshots cannot silently follow a later run.
  f:=pg_temp.lifecycle_fixture('stale');operation_id:=gen_random_uuid();prepared:=pg_temp.lifecycle_prepare(f,'abort',operation_id);
  perform private.complete_opportunity_search((f->>'run_id')::uuid,'{"status":"failed","notes":"Synthetic competing terminal transition"}');
  new_run:=gen_random_uuid();perform private.begin_adaptive_opportunity_search((f->>'search_id')::uuid,new_run);
  receipt:=private.apply_adaptive_search_lifecycle(operation_id);assert receipt->>'outcome'='target_changed','Stale target was accepted';
  assert(select status from public.opportunity_search_runs where id=new_run)='running','Stale abort cancelled newer run';
  f:=pg_temp.lifecycle_fixture('binding');operation_id:=gen_random_uuid();perform pg_temp.lifecycle_prepare(f,'abort',operation_id);
  update public.opportunity_search_schedule_bindings set task_id='changed-synthetic-task-'||operation_id where search_id=(f->>'search_id')::uuid;
  receipt:=private.apply_adaptive_search_lifecycle(operation_id);assert receipt->>'outcome'='binding_changed','Changed binding was not rejected';
  assert(select status from public.opportunity_search_runs where id=(f->>'run_id')::uuid)='running','Binding conflict cancelled target';

  -- Owner identity comes from trusted authenticated scope, never a supplied UUID.
  f:=pg_temp.lifecycle_fixture('authorization');other:=pg_temp.lifecycle_fixture('other');operation_id:=gen_random_uuid();
  prepared:=pg_temp.lifecycle_prepare(f,'abort',operation_id);
  assert pg_temp.lifecycle_rejects(format('select pg_temp.lifecycle_prepare(%L::jsonb,%L,%L::uuid)',
    f||'{"project_ref":"wrongprojectwrongproj"}'::jsonb,'abort',gen_random_uuid())),'Wrong project was accepted';
  assert pg_temp.lifecycle_rejects(format('select pg_temp.lifecycle_prepare(%L::jsonb,%L,%L::uuid)',
    f,'abort_and_restart',operation_id)),'Conflicting operation reuse accepted';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other->>'user_id','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  assert pg_temp.lifecycle_rejects(format('select public.read_adaptive_search_lifecycle(%L::uuid)',operation_id)),'Other owner read lifecycle operation';
  assert pg_temp.lifecycle_rejects(format('select public.apply_adaptive_search_lifecycle(%L::uuid)',operation_id)),'Other owner applied lifecycle operation';
  assert pg_temp.lifecycle_rejects(format('select public.prepare_adaptive_search_lifecycle(%L::uuid,%L,%L,%L::uuid)',
    f->>'search_id',f->>'project_ref','abort',gen_random_uuid())),'Other owner prepared cancellation';
  execute 'reset role';

  f:=pg_temp.lifecycle_fixture('missing-binding');
  delete from public.opportunity_search_schedule_bindings where search_id=(f->>'search_id')::uuid;
  receipt:=pg_temp.lifecycle_prepare(f,'abort',gen_random_uuid());
  assert receipt->'compatible'='false'::jsonb,'Missing task binding was guessed';
  f:=pg_temp.lifecycle_fixture('unsupported-binding');
  update public.opportunity_search_schedule_bindings set runner_capability='legacy-v1' where search_id=(f->>'search_id')::uuid;
  receipt:=pg_temp.lifecycle_prepare(f,'abort',gen_random_uuid());
  assert receipt->'compatible'='false'::jsonb,'Unsupported runner capability was accepted';
  f:=pg_temp.lifecycle_fixture('incompatible-contract');
  update public.opportunity_search_adaptive_release set adaptive_contract_version=2 where singleton;
  receipt:=pg_temp.lifecycle_prepare(f,'abort',gen_random_uuid());
  assert receipt->'compatible'='false'::jsonb,'Unsupported research contract was accepted';
end;
$$;
rollback;
