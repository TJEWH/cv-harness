import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { historicalFunctionDefinitions } from '../../support/database/historicalAdaptiveBatch';
import { adaptiveJsonSqlLiteral as json, ADAPTIVE_HOSTED_PROTOCOL_TEXT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { buildAdaptiveRecurringSearchPrompt } from '../../../src/features/meta-search/domain/adaptiveSearchTask';
import { buildSearchSetupReadSql } from '../../../src/features/meta-search/domain/searchPrompts';

before(() => reset());
const project = 'tttttttttttttttttttt';
const query = (statement: string) => JSON.parse(sql(statement));
const changed = ['private.adaptive_search_hosted_protocol_text()', 'private.adaptive_search_recurring_prompt(uuid,text)', 'private.adaptive_setup_handoff(uuid)'];

function fixture(runImmediately: boolean) {
  const owner = randomUUID(), search = randomUUID(), setup = randomUUID(), task = 'synthetic-report-task-' + search;
  const schedule = { frequency: 'hourly', intervalHours: 12, weekdays: [], time: '09:00', timezone: 'Europe/Berlin', runImmediately };
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic setup test report','{"topicsAndMethods":"Synthetic acoustic research"}',${json(schedule)});
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version)
      select id,user_id,'${task}',schedule,revision,'opportunity-search-v1-canonical-6' from public.opportunity_search_templates where id='${search}';
    begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);set local role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    select public.request_adaptive_search_migration('${search}','${project}',0,'${setup}');reset role;commit;`);
  const read = () => query(`select to_jsonb(handoff) from (${buildSearchSetupReadSql(search,setup,project).slice(0,-1)}) handoff;`);
  const handoff = read();assert.equal(handoff.compatible,true,JSON.stringify(handoff));
  const payload = { ...handoff.acknowledgement.payload_template,
    task_tool_receipt: { success: true, task_id: task, schedule, operation: 'update' } };
  const ack = (value = payload) => query(`select private.ack_adaptive_search_setup('${search}','${setup}',${json(value)});`);
  const startup = (run = setup) => query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
  const runs = () => Number(sql(`select count(*) from public.opportunity_search_runs where search_id='${search}';`));
  const storedSchedule = () => query(`select schedule from public.opportunity_search_schedule_bindings where search_id='${search}';`);
  const cleanup = () => sql(`delete from auth.users where id='${owner}';update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  return {owner,search,setup,task,schedule,handoff,read,payload,ack,startup,runs,storedSchedule,cleanup};
}

for (const immediate of [true,false]) test(`setup test preserves its 12-hour cadence with runImmediately=${immediate}`, () => {
  const f = fixture(immediate);
  try {
    assert.equal(f.runs(),0,'Reading setup executed research');
    assert.deepEqual(f.handoff.lifecycle.research_after_ack,{action:'run_once_in_current_chat',run_id:f.setup,requires_acknowledged:true,once:true,preserve_schedule:true});
    assert.equal(f.handoff.lifecycle.phase,'setup');assert.equal(f.handoff.lifecycle.setup_only,undefined);
    assert.equal(f.handoff.recurringPrompt,buildAdaptiveRecurringSearchPrompt(f.search,project));
    assert.deepEqual(f.read(),f.handoff);assert.equal(f.runs(),0);
    const notConfirmed=structuredClone(f.payload);notConfirmed.task_tool_receipt.success=false;
    assert.equal(f.ack(notConfirmed).error.code,'task_tool_not_confirmed');assert.equal(f.runs(),0);
    const acknowledged=f.ack();assert.equal(acknowledged.acknowledged,true);
    assert.equal(acknowledged.setup_id,f.setup);assert.deepEqual(acknowledged.schedule,f.schedule);
    assert.equal(f.runs(),0,'Acknowledgement must not start a hidden run');
    assert.deepEqual(f.ack(),acknowledged);assert.equal(f.runs(),0);
    const startup=f.startup();assert.equal(startup.compatible,true,JSON.stringify(startup));
    assert.equal(startup.scope.run_id,f.setup);assert.equal(f.runs(),1);
    assert.ok(startup.protocol_text.startsWith(ADAPTIVE_HOSTED_PROTOCOL_TEXT));assert.ok(startup.protocol_text.includes('FINAL REPORT — ALL EXECUTIONS'));
    const now=new Date().toISOString(), queryId=randomUUID();
    const report={completion_id:randomUUID(),status:'complete',query_plan:{schema_version:2,queries:[
      {query_id:queryId,query:'synthetic acoustic research vacancy',role:'core',manual:false}]},execution:{checks:[
      {check_id:randomUUID(),kind:'query',query_id:queryId,attempted_at:now,status:'complete',results_count:0},
      ...startup.due_sources.map((source:{registry_id:string})=>({check_id:randomUUID(),kind:'source',source_registry_id:source.registry_id,
        attempted_at:now,status:'complete',results_count:0}))],backlog:[],complete:true}};
    const finished=query(`select private.finish_adaptive_search('${f.setup}',${json(report)});`);
    assert.equal(finished.compatible,true,JSON.stringify(finished));assert.equal(finished.historical_summary.status,'complete');
    assert.equal(finished.current_verification.verified_items,0);assert.deepEqual(f.storedSchedule(),f.schedule);
    assert.deepEqual(f.ack(),acknowledged);assert.equal(f.runs(),1,'Setup recovery dispatched another execution');
    const repeated=f.startup();assert.equal(repeated.scope.run_id,f.setup);assert.equal(repeated.lease.status,'complete');assert.equal(f.runs(),1);
    assert.equal(f.startup(randomUUID()).compatible,true);assert.equal(f.runs(),2);assert.deepEqual(f.storedSchedule(),f.schedule);
  } finally {f.cleanup();}
});

test('rollback-only handoffs do not inherit the setup test policy',()=>{
  const f=fixture(true),rollback=randomUUID();
  try {
    sql(`insert into private.opportunity_search_setup_operations(setup_id,user_id,search_id,project_ref,mode,config_revision,release_revision,
      authorization_epoch,authorization_revision,binding_hash,target_task_id,runner_capability,template_revision,schedule,recurring_prompt,recurring_prompt_hash,handoff,purpose,rollback_prompt_origin)
      select '${rollback}',user_id,search_id,project_ref,'legacy',config_revision,release_revision,authorization_epoch,authorization_revision,binding_hash,
        target_task_id,'legacy-v1',template_revision,schedule,recurring_prompt,recurring_prompt_hash,handoff,'rollback','reviewed_legacy_fallback'
      from private.opportunity_search_setup_operations where setup_id='${f.setup}';`);
    const handoff=query(`select private.adaptive_search_rollback_handoff('${rollback}');`);
    assert.equal(handoff.lifecycle.phase,'rollback');assert.equal(handoff.lifecycle.setup_only,true);
    assert.equal(handoff.lifecycle.research_allowed,false);assert.equal(handoff.lifecycle.research_after_ack,undefined);
    assert.equal(f.runs(),0);assert.deepEqual(f.storedSchedule(),f.schedule);
  } finally {f.cleanup();}
});

test('reporting upgrade replaces only three reviewed definitions without research or schedule mutations',()=>{
  const sources=()=>query(`select jsonb_object_agg(signature,md5(prosrc)) from jsonb_array_elements_text(${json(changed)}) s(signature) join pg_proc p on p.oid=signature::regprocedure;`);
  const expected=sources();
  const properties=()=>sql(`select jsonb_object_agg(signature,to_jsonb(p)-'prosrc') from jsonb_array_elements_text(${json(changed)}) s(signature) join pg_proc p on p.oid=signature::regprocedure;`);
  const access=properties();
  try {
    for(const [path,name] of [
      ['supabase/releases/adaptive-search-independent-saves-v1.sql','private.adaptive_search_hosted_protocol_text'],
      ['supabase/releases/adaptive-search-current-saves-v1.sql','private.adaptive_search_recurring_prompt']]) {
      const definition=historicalFunctionDefinitions(path!).get(name!);assert.ok(definition);sql(definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
    }
    sql(file('test/support/database/setupReportsPredecessor.sql'));
    const f=fixture(false);
    try {
      const snapshot=()=>sql(`select jsonb_build_object('template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${f.search}'),
        'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${f.search}'),
        'setup',(select to_jsonb(o) from private.opportunity_search_setup_operations o where setup_id='${f.setup}'),
        'runs',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.opportunity_search_runs r where search_id='${f.search}'));`);
      const before=snapshot(),upgrade=file('supabase/releases/adaptive-search-setup-test-reports-v1.sql');
      for(const hash of Object.values(sources())) assert.ok(upgrade.includes(String(hash)));
      const original=sql("select pg_get_functiondef('private.adaptive_search_recurring_prompt(uuid,text)'::regprocedure);");
      sql(original.replace('AS $function$','AS $function$\n-- Synthetic unreviewed predecessor'));
      const rejected=sources();assert.throws(()=>sql(upgrade),/reviewed setup-test reporting predecessor/iu);
      assert.deepEqual(sources(),rejected);assert.equal(snapshot(),before);
      sql(original);sql(upgrade);assert.deepEqual(sources(),expected);assert.equal(properties(),access);
      assert.equal(snapshot(),before,'Installing instructions executed research or changed schedule');assert.equal(f.runs(),0);
      assert.throws(()=>sql(upgrade),/reviewed setup-test reporting predecessor/iu);
    } finally {f.cleanup();}
  } finally {reset();}
});
