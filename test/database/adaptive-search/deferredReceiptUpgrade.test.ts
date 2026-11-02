import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { historicalFunctionDefinitions } from '../../support/database/historicalAdaptiveBatch';
import { adaptiveJsonSqlLiteral as json, ADAPTIVE_HOSTED_PROTOCOL_TEXT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());
const query = (statement: string) => JSON.parse(sql(statement));
const changed = ['private.adaptive_search_hosted_protocol_text()', 'private.save_adaptive_search_item(uuid,uuid,jsonb)'];
const project = 'dddddddddddddddddddd';

test('deferred-receipt upgrade preserves existing unresolved items and research without changing the recurring prompt', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), item = randomUUID();
  const sources = () => query(`select jsonb_object_agg(signature,md5(prosrc)) from jsonb_array_elements_text(${json(changed)}) s(signature)
    join pg_proc p on p.oid=signature::regprocedure;`);
  const properties = () => sql(`select jsonb_object_agg(signature,to_jsonb(p)-'prosrc') from jsonb_array_elements_text(${json(changed)}) s(signature)
    join pg_proc p on p.oid=signature::regprocedure;`);
  const others = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid not in(select signature::regprocedure from jsonb_array_elements_text(${json(changed)}) s(signature));`);
  const expected = sources(), expectedProperties = properties();
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${search}'),
    'items',(select jsonb_agg(to_jsonb(i) order by item_id) from private.opportunity_search_adaptive_items i where run_id='${run}'),
    'receipts',(select jsonb_agg(to_jsonb(r) order by item_id) from public.opportunity_search_receipts r where run_id='${run}'),
    'feedback',(select jsonb_agg(to_jsonb(f) order by feedback_revision) from public.opportunity_search_feedback_snapshots f where search_id='${search}'));`);
  const startup = () => query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
  const recurring = () => sql(`select private.adaptive_search_recurring_prompt('${search}','${project}');`);
  try {
    for (const [path, name] of [
      ['supabase/releases/adaptive-search-current-saves-v1.sql', 'private.adaptive_search_hosted_protocol_text'],
      ['supabase/releases/adaptive-search-standalone-saves-v1.sql', 'private.save_adaptive_search_item'],
    ]) {
      const definition = historicalFunctionDefinitions(path!).get(name!); assert.ok(definition);
      sql(definition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
    }
    const upgrade = file('supabase/releases/adaptive-search-deferred-receipts-v1.sql');
    for (const hash of Object.values(sources())) assert.ok(upgrade.includes(String(hash)), `Missing predecessor guard ${hash}`);
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}','Synthetic deferred receipt upgrade',
        '{"topicsAndMethods":"Synthetic acoustic sensing"}','{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);reset role;commit;`);
    const pinned = startup(); assert.equal(pinned.compatible, true, JSON.stringify(pinned));
    const now = new Date().toISOString(), url = `https://example.invalid/DeferredUpgrade/${run}`;
    const opportunity = { opportunity_key: `deferred-upgrade-${run}`, title: 'Synthetic missing title evidence', official_url: url, last_checked_at: now,
      sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['official_url'] }] };
    const saveSql = `select private.save_adaptive_search_item('${run}','${item}',${json(opportunity)});`;
    const receipt = query(saveSql);
    assert.equal(receipt.outcome, 'unresolved', JSON.stringify(receipt));
    assert.equal(receipt.conflict_code, 'insufficient_evidence');
    assert.equal(receipt.opportunity_id, null);
    const before = snapshot(), untouched = others(), savedPrompt = recurring();
    const originalSave = sql("select pg_get_functiondef('private.save_adaptive_search_item(uuid,uuid,jsonb)'::regprocedure);");
    const alteredSave = originalSave.replace('AS $function$', 'AS $function$\n-- Synthetic unreviewed predecessor');
    assert.notEqual(alteredSave, originalSave); sql(alteredSave);
    const rejected = sources();
    assert.throws(() => sql(upgrade), /Expected the reviewed deferred-receipts predecessor/iu);
    assert.deepEqual(sources(), rejected, 'A guard rejection partially installed the upgrade');
    assert.equal(snapshot(), before);
    sql(originalSave);
    sql(upgrade);
    assert.deepEqual(sources(), expected, 'The guarded upgrade must match the current reviewed function bodies');
    assert.equal(properties(), expectedProperties, 'The upgrade changed ownership, execution properties or ACLs');
    assert.equal(others(), untouched, 'The upgrade changed an unrelated function');
    assert.equal(snapshot(), before, 'Installation changed an existing run, receipt, schedule or pinned context');
    assert.equal(recurring(), savedPrompt, 'The recurring task instructions must not need another setup revision');
    const refreshed = startup();
    assert.ok(refreshed.protocol_text.startsWith(ADAPTIVE_HOSTED_PROTOCOL_TEXT));
    for (const key of ['scope', 'base', 'query_plan', 'legacy_core_queries', 'feedback', 'planning', 'preferences', 'result_schema',
      'source_context', 'due_sources', 'refresh', 'lease', 'capabilities', 'execution_contract']) {
      assert.deepEqual(refreshed[key], pinned[key], `Upgrade changed pinned ${key}`);
    }
    assert.equal(snapshot(), before, 'Reading current guidance rewrote historical research');
    assert.deepEqual(query(saveSql), receipt, 'An existing accepted unresolved item must retain its exact receipt');
    const proof = query(`select private.verify_adaptive_search_item('${run}','${item}');`);
    assert.equal(proof.status, 'deferred'); assert.equal(proof.verified, false); assert.equal(proof.opportunity_id, null);
    assert.equal(snapshot(), before);
    assert.throws(() => sql(upgrade), /Expected the reviewed deferred-receipts predecessor/iu);
    assert.equal(snapshot(), before);
  } finally { reset(); }
});
