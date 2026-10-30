import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLegacySearchBreadthPolicy as createSearchBreadthPolicy } from '../../src/features/meta-search/domain/adaptiveSearchPlanner';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { file, reset, sql, sqlAsync } from './db';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const project = 'bbbbbbbbbbbbbbbbbbbb';
const schedule = { frequency: 'daily', intervalHours: 24, weekdays: [], time: '08:00', timezone: 'UTC', runImmediately: false };
let legacyOwner: string, legacySearch: string, legacyRun: string;
let legacyBundle: Record<string, unknown>;

function createSearch(owner: string, search: string, active = true) {
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values(${quote(search)},${quote(owner)},'Synthetic breadth integration','{"topicsAndMethods":"Acoustics; BCI"}',${json(schedule)});
    update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;
    select set_config('request.jwt.claims',${json({sub:owner,is_anonymous:false})}::text,false);set role authenticated;
    ${active ? `select public.set_opportunity_feedback_consent(${quote(search)},true);
      select public.save_opportunity_search_adaptation(${quote(search)},true,false,0);` : ''}
    select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0);reset role;`);
}
function patch(owner: string, search: string, percent: number, revision: number, action = randomUUID()) {
  return `select set_config('request.jwt.claims',${json({sub:owner,is_anonymous:false})}::text,false);set role authenticated;
    select public.patch_opportunity_search_settings(${quote(search)},${quote(action)},${json({search_breadth_percent:percent})},${json({breadth_revision:revision})});reset role;`;
}
function finalObject(output: string): any {
  return output.split('\n').map(line => JSON.parse(line)).at(-1);
}

test('Search breadth additive upgrade preserves existing settings, pinned v1 runs, private grants and opportunity data', () => {
  reset({searchProtocol:true});
  for (const path of ADAPTIVE_RELEASE_MIGRATIONS) if (path !== 'opportunity_search_breadth.sql' && path !== 'opportunity_feedback_inclusion.sql') sql(file(`../../supabase/${path}`));
  legacyOwner=randomUUID();legacySearch=randomUUID();legacyRun=randomUUID();
  createSearch(legacyOwner,legacySearch);
  legacyBundle=JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(legacySearch)},${quote(legacyRun)});`));
  assert.equal(legacyBundle.compatible,true);
  assert.equal((legacyBundle.planning as any).policy.policy_version,'adaptive-query-v1');
  const beforeSettings=JSON.parse(sql(`select to_jsonb(s) from public.opportunity_search_adaptive_settings s where search_id=${quote(legacySearch)};`));
  const opportunities=sql('select count(*) from public.opportunities;');
  const schedules=sql('select count(*) from public.opportunity_search_schedule_bindings;');
  const privateAcl=sql("select nspacl::text from pg_namespace where nspname='private';");
  const privateExecute=sql("select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private';");
  sql(file('../../supabase/opportunity_search_breadth.sql'));
  const afterSettings=JSON.parse(sql(`select to_jsonb(s)-array['search_breadth_percent','breadth_revision'] from public.opportunity_search_adaptive_settings s where search_id=${quote(legacySearch)};`));
  assert.deepEqual(afterSettings,beforeSettings);
  assert.equal(sql('select count(*) from public.opportunities;'),opportunities);
  assert.equal(sql('select count(*) from public.opportunity_search_schedule_bindings;'),schedules);
  assert.equal(sql("select nspacl::text from pg_namespace where nspname='private';"),privateAcl);
  assert.equal(sql("select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private';"),privateExecute);
  const retried=JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(legacySearch)},${quote(legacyRun)});`));
  assert.deepEqual(retried,legacyBundle,'Installing breadth rewrote a pinned v1 run');
  sql(`delete from auth.users where id=${quote(legacyOwner)};update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
});

test('Search breadth owner patches, direct writes, exact retries, independent revisions and capacity obey the SQL contract', () => {
  sql(file('../../supabase/tests/opportunity_search_breadth.sql'));
});

test('Search breadth SQL and TypeScript emit identical policies for every slider position', () => {
  for (let percent=0;percent<=100;percent+=5) {
    const policy=JSON.parse(sql(`select public.opportunity_search_adaptation_policy(${percent});`));
    assert.deepEqual(policy,createSearchBreadthPolicy(percent));
    assert(Buffer.byteLength(JSON.stringify(policy))<1024,'Policy does not fit its historical storage bound');
  }
});

test('Search breadth verifies quota boundaries against actual noncore queries, including zero, rounding and full core capacity', () => {
  type Role='core'|'adaptive'|'exploration';
  const checks: {percent:number;roles:Role[];active:boolean;expected:boolean;label:string}[]=[];
  const check=(percent:number,roles:Role[],expected:boolean,label:string,active=true)=>checks.push({percent,roles,active,expected,label});
  for (let percent=0;percent<=100;percent+=5) for (const count of [1,2,3,9,29]) {
    const minimum=Math.ceil(count*percent/100);
    const roles:Role[]=['core',...Array(minimum).fill('exploration'),...Array(count-minimum).fill('adaptive')];
    check(percent,roles,true,`percent=${percent}; noncore=${count}`);
    if (minimum>0) {const insufficient=[...roles];insufficient[1]='adaptive';check(percent,insufficient,false,'Below quota accepted');}
    if (percent===0) check(percent,['core','exploration'],false,'Zero percent accepted exploration');
  }
  for (const percent of [0,20,100]) {
    check(percent,Array(30).fill('core'),true,'Full core capacity was displaced');
    check(percent,['core'],false,'Available discretionary slice was omitted');
    check(percent,['core','adaptive'],false,'Inactive adaptation executed noncore',false);
    check(percent,['core'],true,'Inactive adaptation rejected protected core',false);
  }
  const actual=JSON.parse(sql(`select jsonb_agg(private.adaptive_plan_policy_valid(
    jsonb_build_object('queries',(select jsonb_agg(jsonb_build_object('role',role)) from jsonb_array_elements_text(c.value->'roles') role)),
    public.opportunity_search_adaptation_policy((c.value->>'percent')::integer),(c.value->>'active')::boolean) order by c.ordinality)
    from jsonb_array_elements(${json(checks)}) with ordinality c(value,ordinality);`));
  actual.forEach((valid:boolean,index:number)=>assert.equal(valid,checks[index]!.expected,checks[index]!.label));
  for (const malformed of [null,{}, {policy_version:'unknown'}, {policy_version:'adaptive-query-v2'},
    {...createSearchBreadthPolicy(),exploration_ratio:null}]) {
    assert.equal(sql(`select private.adaptive_plan_policy_valid('{"queries":[{"role":"core"},{"role":"adaptive"}]}',${json(malformed)},true);`),'f','Malformed policy did not fail closed');
  }
});

test('Search breadth updates apply to the next run while current-run retry and actual plan use the captured policy', () => {
  const owner=randomUUID(),search=randomUUID(),run=randomUUID(),batch=randomUUID(),completion=randomUUID();
  createSearch(owner,search);
  try {
    const bundle=JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
    assert.equal(bundle.compatible,true,JSON.stringify(bundle));
    assert.equal(bundle.planning.policy.policy_version,'adaptive-query-v2');
    assert.equal(bundle.planning.policy.exploration_ratio,0.2);
    const fingerprint=sql(`select feedback_input_fingerprint from public.opportunity_search_adaptive_settings where search_id=${quote(search)};`);
    const sourceBefore=sql(`select private.adaptive_source_basis(${quote(owner)},${quote(search)});`);
    finalObject(sql(patch(owner,search,100,0)));
    assert.notEqual(sql(`select private.adaptive_source_basis(${quote(owner)},${quote(search)});`),sourceBefore,'Breadth CAS was not part of the shared plan basis');
    assert.equal(sql(`select feedback_input_fingerprint from public.opportunity_search_adaptive_settings where search_id=${quote(search)};`),fingerprint,'Breadth changed feedback evidence');
    const retry=JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
    assert.deepEqual(retry,bundle,'Midrun breadth change rewrote captured policy');
    finalObject(sql(patch(owner,search,20,1))); // ABA: equal policy still has a newer owner revision.
    const queries=[{query_id:randomUUID(),query:'synthetic protected acoustic breadth core',role:'core',manual:false},
      {query_id:randomUUID(),query:'synthetic adaptive acoustic research',role:'adaptive',manual:false},
      {query_id:randomUUID(),query:'synthetic adjacent BCI robotic listening',role:'exploration',manual:false}];
    const payload={schema_version:1,query_plan:{schema_version:2,queries},opportunities:[],execution:{checks:queries.map(query=>({
      check_id:randomUUID(),kind:'query',query_id:query.query_id,attempted_at:new Date().toISOString(),status:'complete',results_count:0})),backlog:[],complete:true}};
    const receipt=JSON.parse(sql(`select private.submit_adaptive_search_batch(${quote(run)},${quote(batch)},${json(payload)});`));
    assert.equal(receipt.run_id,run,JSON.stringify(receipt));
    assert.equal(sql(`select query_plan_id is null and query_plan_dirty from public.opportunity_search_adaptive_settings where search_id=${quote(search)};`),'t','Old run published a stale shared plan');
    assert.equal(JSON.parse(sql(`select planning_policy from public.opportunity_search_query_plans where id=${quote(receipt.plan_id)};`)).exploration_ratio,0.2,'Actual plan lost captured policy');
    const result=JSON.parse(sql(`select private.verify_and_complete_adaptive_search(${quote(run)},${json({schema_version:1,completion_id:completion,batch_ids:[batch],status:'complete'})});`));
    assert.equal(result.run_id,run,JSON.stringify(result));
    finalObject(sql(patch(owner,search,100,2)));
    const next=JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(randomUUID())});`));
    assert.equal(next.compatible,true,JSON.stringify(next));
    assert.equal(next.planning.policy.exploration_ratio,1);
    assert.equal(next.planning.allocation.exploration,next.planning.allocation.discretionary);
  } finally { sql(`delete from auth.users where id=${quote(owner)};update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`); }
});

test('Concurrent breadth writes serialize on their own axis and reject a stale value without overwriting consent', async () => {
  const owner=randomUUID(),search=randomUUID();createSearch(owner,search,false);
  try {
    const result=await Promise.allSettled([40,80].map(percent=>sqlAsync(patch(owner,search,percent,0))));
    assert.equal(result.filter(row=>row.status==='fulfilled').length,1);
    const failure=result.find(row=>row.status==='rejected');assert(failure && failure.status==='rejected');
    assert.match(String(failure.reason),/Settings changed/iu);
    const saved=JSON.parse(sql(`select to_jsonb(s) from public.opportunity_search_adaptive_settings s where search_id=${quote(search)};`));
    assert.equal(saved.breadth_revision,1);assert([40,80].includes(saved.search_breadth_percent));
    assert.equal(saved.structured_feedback_enabled,false);assert.equal(saved.adaptation_enabled,false);assert.equal(saved.consent_revision,0);
  } finally { sql(`delete from auth.users where id=${quote(owner)};update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`); }
});
