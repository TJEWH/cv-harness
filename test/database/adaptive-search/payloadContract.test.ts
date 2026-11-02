import { resetHistoricalAdaptiveBatchFixture } from '../../support/database/historicalAdaptiveBatch';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from '../../support/database/postgres';

before(() => resetHistoricalAdaptiveBatchFixture());
import { ADAPTIVE_BATCH_PROTOCOL_TEXT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `E'${JSON.stringify(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'::jsonb`;
const project = 'pppppppppppppppppppp';

function fixture(active = false, breadth = 20) {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), evidence = randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(${quote(search)},${quote(owner)},'Synthetic payload contract',
      '{"topicsAndMethods":"Acoustics; sensing","fundingAndConditions":"Funded research"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    insert into public.opportunities(id,opportunity_key,title,topics) values(${quote(evidence)},${quote('payload-evidence-'+evidence)},'Synthetic reviewed acoustics',array['Acoustics']);
    insert into public.opportunity_reviews(user_id,opportunity_id,state) values(${quote(owner)},${quote(evidence)},'very_high_interest');
    insert into public.opportunity_search_adaptive_settings(user_id,search_id,adaptation_enabled,successful_source_reuse_enabled,search_breadth_percent)
      values(${quote(owner)},${quote(search)},${active},${active},${breadth});
    update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;
    select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner,is_anonymous:false}))},false);
    set role authenticated; select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0); reset role;`);
  const calls: string[] = [];
  const call = (helper: string, values: (string | object)[]) => {
    const args = values.map(value => typeof value === 'string' ? `${quote(value)}::uuid` : json(value)).join(',');
    const statement = `SELECT private.${helper}(${args});`; calls.push(statement);
    return JSON.parse(sql(statement));
  };
  return { owner, search, run, evidence, calls, call, start: () => call('begin_adaptive_opportunity_search',[search,run]),
    batch: (id: string, body: object) => call('submit_adaptive_search_batch',[run,id,body]),
    complete: (body: object) => call('verify_and_complete_adaptive_search',[run,body]) };
}

// Payloads below come only from the exact protocol delivered to the runner.
// No AdaptiveBatchPayload type, transport builder, validator or SQL fixture
// payload generator supplies undisclosed fields to the synthetic execution.
function deliveredExamples(startup: any, cold = true): Record<string, any> {
  assert.equal(startup.protocol_text, ADAPTIVE_BATCH_PROTOCOL_TEXT);
  const encoded = /ADAPTIVE PAYLOAD EXAMPLES \(JSON templates\)\n```json\n([\s\S]+?)\n```/u.exec(startup.protocol_text)?.[1];
  assert(encoded, 'the allowed startup response alone contains the complete JSON templates');
  if (cold) {
    assert.equal(startup.query_plan, null, 'this fixture must exercise genuine cold start');
    assert.equal(startup.legacy_core_queries, null);
  }
  return JSON.parse(encoded);
}
function fill(template: unknown, values: Record<string, string>): any {
  const encoded = JSON.stringify(template).replace(/<[^>]+>/gu, key => {
    assert(Object.hasOwn(values,key), `the delivered template placeholder ${key} must be replaced explicitly`);
    return JSON.stringify(values[key]).slice(1,-1);
  });
  return JSON.parse(encoded);
}
function payload(startup: any, examples: Record<string, any>, includeOpportunity = false) {
  const query = randomUUID(), queryCheck = randomUUID(), item = randomUUID(), now = new Date().toISOString();
  const values = { '<query_uuid>':query, '<query_check_uuid>':queryCheck, '<actual_core_query>':'synthetic funded acoustic sensing research',
    '<actual_check_iso>':now, '<actual_evidence_iso>':now, '<actual_discovery_iso>':now, '<actual_encounter_iso>':now,
    '<item_uuid>':item, '<stable_vacancy_key>':`payload-${item}`, '<verified_public_title>':'Synthetic verified acoustic research',
    '<official_vacancy_url>':`https://example.invalid/Research/${item}` };
  const body = fill(examples.first_batch,values);
  if (startup.planning.enabled) {
    // Follow the delivered allocation rule: retain the core and add the required
    // noncore slot, with its role set by the delivered zero/full breadth rule.
    const extra = fill(examples.first_batch.query_plan.queries[0], { '<query_uuid>':randomUUID(), '<actual_core_query>':'synthetic exploratory acoustic field research' });
    extra.role = startup.planning.policy.exploration_ratio === 0 ? 'adaptive' : 'exploration'; body.query_plan.queries.push(extra);
    body.execution.checks.push(fill(examples.first_batch.execution.checks[0], { '<query_uuid>':extra.query_id,
      '<query_check_uuid>':randomUUID(),'<actual_check_iso>':now }));
  }
  for (const source of startup.due_sources) body.execution.checks.push(fill(examples.source_check, {
    '<source_check_uuid>':randomUUID(),'<due_source_registry_uuid>':source.registry_id,'<actual_check_iso>':now,
  }));
  if (includeOpportunity) { body.opportunities.push(fill(examples.opportunity_item,values)); body.execution.checks[0].results_count=1; }
  return { body, item, query, queryCheck, now };
}

test('cold zero-result research constructs a complete first batch and completion solely from startup instructions', () => {
  const run = fixture(), startup = run.start(); assert.equal(startup.compatible,true,JSON.stringify(startup));
  const examples = deliveredExamples(startup), {body} = payload(startup,examples), batch = randomUUID();
  const receipt = run.batch(batch,body); assert.equal(receipt.error,undefined,JSON.stringify(receipt));
  assert.equal(receipt.verification_required,true);
  const completion = fill(examples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':batch});
  const result = run.complete(completion);
  assert.equal(result.compatible,true,JSON.stringify(result)); assert.equal(result.persisted_summary_read,true);
  assert.equal(result.historical_summary.status,'complete'); assert.equal(result.historical_summary.coverage.complete,true);
  assert.equal(result.current_verification.saved_items,0);
  assert.equal(run.calls.length,3,'startup + actual zero-result batch + separate completion');
});

for (const breadth of [0,100]) test(`the delivered active cold-start allocation works at ${breadth}% breadth without an invalid core-only plan`, () => {
  const run=fixture(true,breadth),startup=run.start(); assert.equal(startup.compatible,true,JSON.stringify(startup));
  const examples=deliveredExamples(startup),{body}=payload(startup,examples),batch=randomUUID();
  assert.equal(body.query_plan.queries.length,2);
  assert.equal(body.query_plan.queries[1].role,breadth===0?'adaptive':'exploration');
  const receipt=run.batch(batch,body); assert.equal(receipt.error,undefined,JSON.stringify(receipt));
  const completion=fill(examples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':batch});
  const result=run.complete(completion); assert.equal(result.compatible,true,JSON.stringify(result));
  assert.equal(result.historical_summary.status,'complete');
});

test('a stale historical plan hash triggers the instructed first-batch refresh while protected core remains exact', () => {
  const run=fixture(true),firstStartup=run.start(),examples=deliveredExamples(firstStartup),first=payload(firstStartup,examples),firstBatch=randomUUID();
  const receipt=run.batch(firstBatch,first.body); assert.equal(receipt.error,undefined,JSON.stringify(receipt));
  const completed=run.complete(fill(examples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':firstBatch}));
  assert.equal(completed.historical_summary.status,'complete');
  sql(`update public.opportunity_search_adaptive_settings set search_breadth_percent=0 where user_id=${quote(run.owner)} and search_id=${quote(run.search)};`);
  const nextRun=randomUUID(),nextStartup=run.call('begin_adaptive_opportunity_search',[run.search,nextRun]);
  assert.equal(nextStartup.compatible,true,JSON.stringify(nextStartup)); assert(nextStartup.query_plan?.plan_hash);
  assert.equal(nextStartup.planning.refresh_required,true); assert.equal(nextStartup.refresh.adaptive_slice,true);
  const nextExamples=deliveredExamples(nextStartup,false),refreshed=payload(nextStartup,nextExamples),batch=randomUUID();
  const protectedCore=nextStartup.query_plan.document.queries.filter((query:any)=>query.role==='core');
  assert.equal(protectedCore.length,1);
  refreshed.body.query_plan.queries[0]=structuredClone(protectedCore[0]);
  refreshed.body.execution.checks[0].query_id=protectedCore[0].query_id;
  assert.equal(refreshed.body.query_plan.queries[1].role,'adaptive');
  const saved=run.call('submit_adaptive_search_batch',[nextRun,batch,refreshed.body]); assert.equal(saved.error,undefined,JSON.stringify(saved));
  assert.notEqual(saved.plan_hash,nextStartup.query_plan.plan_hash,'new breadth requires an actual refreshed plan');
  const completion=fill(nextExamples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':batch});
  const result=run.call('verify_and_complete_adaptive_search',[nextRun,completion]);
  assert.equal(result.compatible,true,JSON.stringify(result)); assert.equal(result.historical_summary.status,'complete');
});

test('delivered item, listing, suggestion and later-batch examples preserve verification and explicit approval', () => {
  const run = fixture(true), startup = run.start(); assert.equal(startup.compatible,true,JSON.stringify(startup));
  const examples = deliveredExamples(startup), {body,item,now} = payload(startup,examples,true), first = randomUUID(), second = randomUUID();
  const listing = `https://example.invalid/Jobs/${item}`;
  body.opportunities[0].reusable_source = fill(examples.reusable_source,{'<verified_listing_url>':listing});
  body.opportunities[0].opportunity.sources.push(fill(examples.listing_evidence,{'<verified_listing_url>':listing,'<actual_evidence_iso>':now}));
  assert(startup.feedback.examples.some((entry:any)=>entry.opportunity_id===run.evidence),'proposal references come from the actual authorized bundle');
  body.preference_suggestions=[fill(examples.preference_suggestion,{'<suggestion_uuid>':randomUUID(),'<rule_uuid>':randomUUID(),
    '<supported_public_target>':'Acoustics','<authorized_reviewed_opportunity_uuid>':run.evidence})];
  body.source_suggestions=[fill(examples.source_suggestion,{'<suggestion_uuid>':randomUUID(),'<public_vacancy_url>':'https://example.invalid/Vacancy/Future','<authorized_verified_opportunity_uuid>':run.evidence})];
  body.query_suggestions=[fill(examples.query_suggestion,{'<suggestion_uuid>':randomUUID(),'<supported_future_query>':'synthetic future acoustic research','<authorized_verified_opportunity_uuid>':run.evidence})];
  const receipt=run.batch(first,body); assert.equal(receipt.error,undefined,JSON.stringify(receipt));
  assert.equal(receipt.items[0].outcome,'saved'); assert.equal(receipt.suggestions.length,3);
  const saved=receipt.items[0].opportunity_id;
  // Synthetic owner review arrives after intake and before completion, exactly
  // as a separate UI action; the runner never manufactures owner interest.
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,state) values(${quote(run.owner)},${quote(saved)},'very_high_interest');`);
  const later=fill(examples.later_batch,{'<returned_plan_hash>':receipt.plan_hash});
  const last=run.batch(second,later); assert.equal(last.error,undefined,JSON.stringify(last));
  const completion=fill(examples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':first});
  completion.batch_ids=[first,second].sort(); completion.manifest_hash=last.manifest_hash;
  const result=run.complete(completion); assert.equal(result.compatible,true,JSON.stringify(result));
  assert.equal(result.historical_summary.status,'complete'); assert.equal(result.current_verification.verified_items,1);
  assert.equal(run.calls.length,4,'startup + two batches + separate completion');
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(run.owner)} and search_id=${quote(run.search)} and listing_url=${quote(listing)};`),'1');
  assert.equal(sql(`select jsonb_array_length(public.opportunity_search_preference_document(${quote(run.owner)},${quote(run.search)})->'approved_rules');`),'0','a proposed rule must never approve itself');
  assert.equal(sql(`select count(*) from public.opportunity_search_preference_suggestions where user_id=${quote(run.owner)} and search_id=${quote(run.search)};`),'1');
  const repeated=run.complete(completion); assert.equal(repeated.compatible,true); assert.deepEqual(repeated.historical_summary,result.historical_summary);
});

test('delivered partial coverage and backlog shapes complete honestly as failed, never successful empty research', () => {
  const run=fixture(),startup=run.start(),examples=deliveredExamples(startup),{body}=payload(startup,examples),batch=randomUUID();
  body.execution.checks[0].status='blocked'; body.execution.checks[0].results_count=null; body.execution.checks[0].failure_reason='access_denied';
  body.execution.complete=false; body.execution.backlog=[fill(examples.backlog_candidate,{'<candidate_uuid>':randomUUID(),'<public_candidate_url>':'https://example.invalid/Vacancy/Unresolved'})];
  const receipt=run.batch(batch,body); assert.equal(receipt.error,undefined,JSON.stringify(receipt));
  const completion=fill(examples.completion,{'<completion_uuid>':randomUUID(),'<batch_uuid>':batch}); completion.status='failed';
  const result=run.complete(completion); assert.equal(result.compatible,true,JSON.stringify(result));
  assert.equal(result.historical_summary.status,'failed'); assert.equal(result.historical_summary.incomplete,true);
  assert.equal(result.historical_summary.coverage.backlog_count,1);
});
