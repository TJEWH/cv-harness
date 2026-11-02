import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { historicalFunctionDefinitions } from '../../support/database/historicalAdaptiveBatch';
import { adaptiveJsonSqlLiteral as json, ADAPTIVE_HOSTED_PROTOCOL_TEXT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { buildAdaptiveRecurringSearchPrompt } from '../../../src/features/meta-search/domain/adaptiveSearchTask';

before(() => reset());
const query = (statement: string) => JSON.parse(sql(statement));
const project = 'cccccccccccccccccccc';
const changed = [
  'private.adaptive_search_recurring_prompt(uuid,text)', 'private.begin_adaptive_search_brief(uuid,uuid)',
  'private.begin_adaptive_opportunity_search(uuid,uuid)', 'private.read_adaptive_search_rollback(uuid,uuid,text)',
  'private.read_adaptive_search_setup(uuid,uuid,text)', 'private.adaptive_item_receipt(uuid,uuid)',
  'private.submit_adaptive_search_batch(uuid,uuid,jsonb)', 'private.verify_and_complete_adaptive_search(uuid,jsonb)',
  'public.adaptive_search_setup_capable()',
];
const added = ['private.adaptive_search_hosted_protocol_text()', 'private.record_adaptive_search_coverage(uuid,uuid,jsonb)', 'private.finish_adaptive_search(uuid,jsonb)'];

function predecessor() {
  const sources = [
    ['supabase/releases/adaptive-search-inline-codec-v1.sql', ['private.adaptive_search_recurring_prompt']],
    ['supabase/releases/adaptive-search-brief-limit-v1.sql', ['private.begin_adaptive_search_brief']],
    ['supabase/releases/adaptive-search-startup-logging-v1.sql', ['private.begin_adaptive_opportunity_search']],
    ['supabase/releases/adaptive-search-standalone-saves-v1.sql', ['private.adaptive_item_receipt', 'private.submit_adaptive_search_batch', 'private.verify_and_complete_adaptive_search']],
    ['supabase/releases/adaptive-search-brief-v1.sql', ['public.adaptive_search_setup_capable']],
    ['test/support/database/currentSavesPredecessor.sql', ['private.read_adaptive_search_rollback', 'private.read_adaptive_search_setup']],
  ] as const;
  for (const [path, names] of sources) {
    const definitions = historicalFunctionDefinitions(path);
    for (const name of names) {
      const definition = definitions.get(name); assert.ok(definition, `${path}: ${name}`);
      sql(definition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
    }
  }
  for (const signature of added) sql(`drop function ${signature};`);
}

test('current-save upgrade preserves historical saves and pinned research, retires old writes and installs only reviewed functions', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), batch = randomUUID(), oldItem = randomUUID();
  const queryId = randomUUID(), oldSetup = randomUUID(), nextSetup = randomUUID();
  const functionSources = () => query(`select jsonb_object_agg(signature,md5(prosrc)) from jsonb_array_elements_text(${json([...changed, ...added])}) s(signature)
    join pg_proc p on p.oid=to_regprocedure(signature);`);
  const properties = () => query(`select jsonb_object_agg(signature,jsonb_build_object('owner',proowner,'security_definer',prosecdef,
    'configuration',proconfig,'acl',proacl,'language',prolang,'volatility',provolatile)) from jsonb_array_elements_text(${json([...changed, ...added])}) s(signature)
    join pg_proc p on p.oid=to_regprocedure(signature);`);
  const expected = functionSources(), expectedProperties = properties();
  const others = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid not in(select to_regprocedure(signature) from jsonb_array_elements_text(${json([...changed, ...added])}) s(signature) where to_regprocedure(signature) is not null);`);
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${search}'),
    'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${search}'),
    'config',(select to_jsonb(c) from public.opportunity_search_runner_config c where search_id='${search}'),
    'feedback',(select jsonb_agg(to_jsonb(f) order by feedback_revision) from public.opportunity_search_feedback_snapshots f where search_id='${search}'),
    'batches',(select jsonb_agg(to_jsonb(b) order by batch_id) from private.opportunity_search_adaptive_batches b where run_id='${run}'),
    'items',(select jsonb_agg(to_jsonb(i) order by item_id) from private.opportunity_search_adaptive_items i where run_id='${run}'),
    'receipts',(select jsonb_agg(to_jsonb(r) order by item_id) from public.opportunity_search_receipts r where run_id='${run}'),
    'old_setup',(select to_jsonb(s) from private.opportunity_search_setup_operations s where setup_id='${oldSetup}'));`);
  const startup = () => query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
  try {
    predecessor();
    const upgrade = file('supabase/releases/adaptive-search-current-saves-v1.sql');
    for (const hash of Object.values(functionSources())) assert.ok(upgrade.includes(String(hash)), `Missing predecessor guard ${hash}`);
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}','Synthetic current saves upgrade',
        '{"topicsAndMethods":"Synthetic acoustic sensing"}','{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);reset role;commit;
      insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
        values('${owner}','${search}','${project}','adaptive',false,'${randomUUID()}');
      insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
        select id,user_id,'synthetic-current-saves-task',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1' from public.opportunity_search_templates where id='${search}';`);
    const pinned = startup(); assert.equal(pinned.compatible, true);
    const handoff = query(`select private.read_adaptive_search_setup('${search}','${oldSetup}','${project}');`);
    assert.equal(handoff.compatible, true, JSON.stringify(handoff));
    const now = new Date().toISOString();
    const opportunity = (index: number) => { const url = `https://example.invalid/CurrentUpgrade/${run}/${index}`;
      return { opportunity_key: `current-upgrade-${run}-${index}`, title: 'Synthetic acoustic sensing', official_url: url, last_checked_at: now,
        sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['title', 'official_url'] }] }; };
    const report = { query_plan: { schema_version: 2, queries: [{ query_id: queryId, query: 'synthetic acoustic sensing', role: 'core', manual: false }] },
      execution: { checks: [{ check_id: randomUUID(), kind: 'query', query_id: queryId, attempted_at: now, status: 'complete', results_count: 1 },
        ...pinned.due_sources.map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source', source_registry_id: source.registry_id, attempted_at: now, status: 'complete', results_count: 0 }))], backlog: [], complete: true } };
    const receipt = query(`select private.submit_adaptive_search_batch('${run}','${batch}',${json({ schema_version: 1, ...report, opportunities: [{ item_id: oldItem, opportunity: opportunity(0) }] })});`);
    assert.equal(receipt.items?.[0]?.outcome, 'saved', JSON.stringify(receipt));
    const pinnedBeforeUpgrade = startup();
    const saved = snapshot(), untouched = others();
    const signature = 'private.adaptive_item_receipt(uuid,uuid)';
    const originalReceipt = sql(`select pg_get_functiondef('${signature}'::regprocedure);`);
    const alteredReceipt = originalReceipt.replace('AS $function$', 'AS $function$\n-- Synthetic unreviewed predecessor');
    assert.notEqual(alteredReceipt, originalReceipt);
    sql(alteredReceipt);
    const rejectedSources = functionSources();
    assert.throws(() => sql(upgrade), /Expected the reviewed current-saves predecessor/iu);
    assert.deepEqual(functionSources(), rejectedSources, 'A guard failure partially installed the upgrade');
    assert.equal(snapshot(), saved, 'A guard failure changed historical evidence');
    sql(originalReceipt);
    sql(upgrade);
    assert.deepEqual(functionSources(), expected, 'Upgrade differs from the reviewed declarative schema');
    assert.deepEqual(properties(), expectedProperties, 'Upgrade changed reviewed ownership, execution properties or privileges');
    assert.equal(others(), untouched, 'Upgrade changed an unrelated function or ACL');
    assert.equal(snapshot(), saved, 'Installation changed run, schedule, research or historical evidence');
    const current = startup(); assert.equal(current.compatible, true);
    for (const key of ['base', 'query_plan', 'legacy_core_queries', 'feedback', 'planning', 'preferences', 'source_context', 'due_sources', 'refresh', 'lease', 'result_schema']) {
      assert.deepEqual(current[key], pinnedBeforeUpgrade[key], `Upgrade changed pinned ${key}`);
    }
    assert.ok(current.protocol_text.startsWith(ADAPTIVE_HOSTED_PROTOCOL_TEXT));
    assert.equal(snapshot(), saved, 'Reading current instructions changed historical evidence');
    assert.equal(query(`select private.read_adaptive_search_setup('${search}','${oldSetup}','${project}');`).error.code, 'setup_stale');
    const fresh = query(`select private.read_adaptive_search_setup('${search}','${nextSetup}','${project}');`);
    assert.equal(fresh.recurringPrompt, buildAdaptiveRecurringSearchPrompt(search, project));
    assert.equal(fresh.recurring_prompt_hash, createHash('sha256').update(fresh.recurringPrompt).digest('hex'));
    assert.deepEqual(fresh.schedule, handoff.schedule); assert.deepEqual(fresh.target, handoff.target);
    assert.equal(snapshot(), saved);
    for (const signature of added) for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute');`), 'f');
    }
    assert.equal(query(`select private.submit_adaptive_search_batch('${run}','${batch}',NULL::jsonb);`).error.code, 'retired_contract');
    assert.equal(query(`select private.verify_and_complete_adaptive_search('${run}',${json({ schema_version: 2, action: 'finish', completion_id: randomUUID(), status: 'failed' })});`).error.code, 'retired_contract');
    assert.equal(snapshot(), saved, 'Retired entrypoints changed historical state');
    assert.throws(() => sql(upgrade), /already exists|predecessor/iu);
    assert.equal(snapshot(), saved);
    assert.equal(query(`select private.verify_adaptive_search_item('${run}','${oldItem}');`).verified, true);
    const newItem = randomUUID();
    assert.equal(query(`select private.save_adaptive_search_item('${run}','${newItem}',${json(opportunity(1))});`).accepted, true);
    assert.equal(query(`select private.verify_adaptive_search_item('${run}','${newItem}');`).verified, true);
    const finished = query(`select private.finish_adaptive_search('${run}',${json({ completion_id: randomUUID(), status: 'complete', plan_hash: receipt.plan_hash, execution: { checks: [], backlog: [], complete: true } })});`);
    assert.equal(finished.historical_summary?.status, 'complete', JSON.stringify(finished));
    assert.equal(finished.current_verification.verified_items, 2);
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${run}' and cardinality(item_ids)>0;`), '1', 'Only the historical batch may contain items');
  } finally { reset(); }
});
