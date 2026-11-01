import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { runConcurrentRollbackAckRegression } from '../../support/database/rollbackConcurrency';
import { ADAPTIVE_RELEASE_MANIFEST, buildAdaptiveSearchReleaseManifest, checkAdaptiveSearchReleaseManifest } from '../../../scripts/adaptiveSearchRelease';
import { buildAdaptiveSearchSqlCall, type AdaptiveBatchPayload } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

before(() => reset());

test('current release manifest matches atomic schema artifacts and safe installation defaults', () => {
  checkAdaptiveSearchReleaseManifest();
  const installed = JSON.parse(file(`${ADAPTIVE_RELEASE_MANIFEST}`));
  assert.deepEqual(installed, buildAdaptiveSearchReleaseManifest());
  assert.equal(installed.manifest_version, 2);
  assert.equal(sql('select enabled or project_ref is not null from public.opportunity_search_adaptive_release where singleton;'), 'f');
  assert.equal(sql('select count(*) from public.opportunity_search_adaptive_settings;'), '0');
  assert.equal(sql("select to_regclass('public.opportunity_feedback_summary_approvals') is null;"), 't');
});

test('AF-11 current relations retain owner RLS, narrow grants and cleanup contracts; normal research caller remains usable', () => {
  sql(file('supabase/tests/opportunity_search_adaptive_release.sql'));
});

test('AF-11 explicit feature rollback requires a real task receipt and preserves research', () => {
  sql(file('supabase/tests/opportunity_search_adaptive_rollback.sql'));
});

for (const batchCount of [1,2]) test(`AF-11 fully installed runner preserves ${2+batchCount}-call budget, actual exploration and unapproved submission-based suggestions`, () => {
  const owner=randomUUID(),search=randomUUID(),run=randomUUID(),core=randomUUID(),adaptive=randomUUID(),exploration=randomUUID();
  const batchIds=Array.from({length:batchCount},()=>randomUUID()),item=randomUUID(),completion=randomUUID();
  const checks=[randomUUID(),randomUUID(),randomUUID()],project='rrrrrrrrrrrrrrrrrrrr',scope={project_ref:project,search_id:search,run_id:run};
  const evidence=randomUUID(),application=randomUUID(),suggestion=randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunities(id,opportunity_key,title) values(${quote(evidence)},${quote('af11-submission-'+run)},'Synthetic submission evidence');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(${quote(search)},${quote(owner)},'AF11 integrated runner',
      '{"topicsAndMethods":"Acoustics; BCI; Robotics"}','{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;
    select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner,is_anonymous:false}))},false);set role authenticated;
    select public.create_job_application(${quote(application)},${quote(evidence)});
    update public.applications set status='submitted',notes='APPLICATION_PRIVATE_CANARY' where id=${quote(application)};
    select public.save_opportunity_search_adaptation(${quote(search)},true,false,0);
    select public.set_opportunity_source_reuse(${quote(search)},true,168);
    select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0);reset role;`);
  const calls:string[]=[];let saved=false;
  const api=(call:ReturnType<typeof buildAdaptiveSearchSqlCall>)=>{assert.equal(call.project_ref,project);calls.push(call.sql);return JSON.parse(sql(call.sql));};
  try {
    const startup=api(buildAdaptiveSearchSqlCall({action:'startup',scope}));
    assert.equal(startup.compatible,true,JSON.stringify(startup));
    assert.equal(startup.feedback.counts.submission_fallback,1);
    assert.deepEqual(startup.source_retention,{requested:7,retained:7,omitted:0});
    assert.equal(startup.capabilities.capability_version,'adaptive-batch-v1');
    assert.deepEqual(startup.execution_contract,buildAdaptiveSearchReleaseManifest().execution_contract);
    const now=new Date().toISOString(),url=`https://example.invalid/Research/${run}`,listing=`https://example.invalid/Jobs?fixture=${run}`;
    // Synthetic listing fixtures are empty: record one actual check input for
    // every due source, rather than claiming complete coverage from queries alone.
    const sourceChecks=startup.due_sources.map((source: {registry_id:string})=>({check_id:randomUUID(),kind:'source' as const,
      source_registry_id:source.registry_id,attempted_at:now,status:'complete' as const,results_count:0}));
    const payload:AdaptiveBatchPayload={schema_version:1,query_plan:{schema_version:2,queries:[
      {query_id:core,query:'synthetic core acoustic research',role:'core',manual:false},
      {query_id:adaptive,query:'synthetic adaptive sensor research',role:'adaptive',manual:false},
      {query_id:exploration,query:'synthetic exploration physical systems',role:'exploration',manual:false}]},
      opportunities:[{item_id:item,opportunity:{opportunity_key:'af11-result-'+run,title:'Synthetic integrated sensing research',institution:'Example Institute',topics:['Acoustics'],
        official_url:url,last_checked_at:now,personal_fit:{score:8,scale_min:0,scale_max:10,summary:'Synthetic alignment.'},
        sources:[{url,kind:'official',checked_at:now,precision:'instant',supports:['title','institution','topics','official_url','personal_fit']},
          {url:listing,kind:'official_listing',checked_at:now,precision:'instant',supports:['title']}]},
        attribution:{execution_refs:[checks[0]!],primary_check_id:checks[0]!,discovered_at:now,encountered_at:now},reusable_source:{listing_url:listing}}],
      execution:{checks:[...[core,adaptive,exploration].map((query,index)=>({check_id:checks[index]!,kind:'query' as const,query_id:query,attempted_at:now,status:'complete' as const,results_count:index===0?1:0})),...sourceChecks],backlog:[],complete:true},
      preference_suggestions:[{suggestion_id:suggestion,rule:{rule_id:randomUUID(),kind:'emphasis',category:'topic',polarity:'positive',target:'Acoustics',evidence_refs:[evidence]}}]};
    let receipt=api(buildAdaptiveSearchSqlCall({action:'batch',scope,batch_id:batchIds[0]!,payload}));
    assert.equal(receipt.batch_schema_version,1,JSON.stringify(receipt));assert.equal(receipt.error,undefined);assert.equal(receipt.items[0].outcome,'saved',JSON.stringify(receipt));saved=true;
    assert.equal(receipt.verification_required,true);
    // Harness-only persistence probes below are not runner connector calls.
    assert.equal(sql(`select verified_at is null from public.opportunity_search_receipts where run_id=${quote(run)} and item_id=${quote(item)};`),'t');
    assert.equal(sql(`select status||':'||coalesce(reason,'') from public.opportunity_search_adaptive_proposals where user_id=${quote(owner)} and suggestion_id=${quote(suggestion)};`),'pending:');
    assert.equal(sql(`select count(*) from public.opportunity_search_preference_suggestions where user_id=${quote(owner)} and suggestion_id=${quote(suggestion)};`),'1');
    assert.equal(sql(`select jsonb_array_length(public.opportunity_search_preference_document(${quote(owner)},${quote(search)})->'approved_rules');`),'0','Submission evidence must not approve its suggestion.');
    assert.equal(Number(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)} and search_id=${quote(search)};`)),sourceChecks.length,'A write receipt prematurely retained a discovered source.');
    // An explicit synthetic owner review is a UI action, outside runner calls.
    // It changes next-run feedback without rebasing this run's pinned plan.
    sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner,is_anonymous:false}))},false);set role authenticated;
      select public.review_job_opportunity(${quote(receipt.items[0].opportunity_id)},null,'very_high_interest');reset role;`);
    for(const batch of batchIds.slice(1)) receipt=api(buildAdaptiveSearchSqlCall({action:'batch',scope,batch_id:batch,payload:{schema_version:1,plan_hash:receipt.plan_hash,opportunities:[],execution:{checks:[],backlog:[],complete:true}}}));
    const finished=api(buildAdaptiveSearchSqlCall({action:'complete',scope,payload:{schema_version:1,completion_id:completion,batch_ids:[...batchIds].sort(),manifest_hash:receipt.manifest_hash,status:'complete'}}));
    assert.equal(finished.compatible,true,JSON.stringify(finished));assert.equal(finished.persisted_summary_read,true);
    assert.equal(finished.historical_summary.status,'complete',JSON.stringify(finished));assert.equal(finished.current_verification.verified_items,1);
    assert.equal(calls.length,2+batchCount);assert(calls.every(call=>/^SELECT private\.(begin_adaptive_opportunity_search|submit_adaptive_search_batch|verify_and_complete_adaptive_search)\(/u.test(call)));
    assert.equal(Number(sql(`select count(*) from public.opportunity_search_executions where run_id=${quote(run)} and status='complete';`)),3+sourceChecks.length);
    assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)} and search_id=${quote(search)}
      and listing_url=${quote(listing)} and provenance='evidenced_listing' and enabled and listing_verified_at is not null and last_successful_at is null;`),'1',
      'Verified useful listing was not retained, or a direct source check was invented.');
    const metrics=JSON.parse(sql(`begin;do $$begin perform set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner,is_anonymous:false}))},true);end$$;
      set local role authenticated;select public.read_opportunity_search_metrics(${quote(search)});commit;`));
    assert.equal(metrics.overall.unique_discoveries,1);assert.equal(metrics.overall.mean_interest,9);
    assert.doesNotMatch(JSON.stringify({startup,receipt,finished}),/APPLICATION_PRIVATE_CANARY|effective_fields|context_json|private_comment|after_snapshot/u);
  } finally {
    sql(`delete from auth.users where id=${quote(owner)};update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
    for(const relation of ['public.opportunity_search_adaptive_settings','public.opportunity_search_feedback_snapshots','public.opportunity_search_discoveries',
      'public.opportunity_search_adaptive_proposals','public.opportunity_feedback_prediction_proofs','private.opportunity_search_adaptive_contexts',
      'private.opportunity_search_adaptive_batches','private.opportunity_search_adaptive_completions']) {
      assert.equal(sql(`select count(*) from ${relation} where user_id=${quote(owner)};`),'0',`Account deletion retained ${relation}`);
    }
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_items where run_id=${quote(run)};`),'0');
    if(saved) assert.equal(sql(`select count(*) from public.opportunities where opportunity_key=${quote('af11-result-'+run)};`),'1','Account deletion removed canonical result.');
  }
});

test('AF-11 concurrent identical rollback receipts publish one technical revision', runConcurrentRollbackAckRegression);
