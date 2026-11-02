import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { historicalFunctionDefinitions } from '../../support/database/historicalAdaptiveBatch';
import { adaptiveJsonSqlLiteral as json, ADAPTIVE_HOSTED_PROTOCOL_TEXT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());
const query = (statement: string) => JSON.parse(sql(statement));
const project = 'ssssssssssssssssssss';
const changed = ['private.adaptive_search_hosted_protocol_text()', 'private.adaptive_item_receipt(uuid,uuid)',
  'private.save_adaptive_search_item(uuid,uuid,jsonb)', 'private.verify_adaptive_search_item(uuid,uuid)',
  'private.opportunity_search_adaptive_current_verification(uuid,uuid)', 'private.opportunity_search_adaptive_manifest(uuid)',
  'private.record_opportunity_search_discovery(uuid,uuid,jsonb)', 'private.finish_adaptive_search(uuid,jsonb)'];
const added = ['private.adaptive_search_save_receipt_schema()', 'private.record_adaptive_item_bookkeeping(uuid,uuid,text,text[])'];
const signatures = [...changed, ...added];

test('guarded independent-save upgrade preserves saved research, task prompts and privileges without an installation data write', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), item = randomUUID();
  const functions = () => query(`select jsonb_object_agg(signature,md5(prosrc)) from jsonb_array_elements_text(${json(signatures)}) s(signature)
    join pg_proc p on p.oid=to_regprocedure(signature);`);
  const properties = () => sql(`select jsonb_object_agg(signature,jsonb_build_object('owner',proowner,'security_definer',prosecdef,
    'config',proconfig,'acl',proacl,'volatility',provolatile)) from jsonb_array_elements_text(${json(signatures)}) s(signature)
    join pg_proc p on p.oid=to_regprocedure(signature);`);
  const others = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid not in(select to_regprocedure(signature) from jsonb_array_elements_text(${json(signatures)}) s(signature)
      where to_regprocedure(signature) is not null);`);
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${search}'),
    'items',(select jsonb_agg(to_jsonb(i) order by item_id) from private.opportunity_search_adaptive_items i where run_id='${run}'),
    'receipts',(select jsonb_agg(to_jsonb(r) order by item_id) from public.opportunity_search_receipts r where run_id='${run}'),
    'discoveries',(select jsonb_agg(to_jsonb(d) order by item_id) from public.opportunity_search_discoveries d where run_id='${run}'),
    'feedback',(select jsonb_agg(to_jsonb(f) order by feedback_revision) from public.opportunity_search_feedback_snapshots f where search_id='${search}'));`);
  const expected = functions(), expectedProperties = properties();
  try {
    const predecessors = [
      ['supabase/releases/adaptive-search-deferred-receipts-v1.sql', ['private.adaptive_search_hosted_protocol_text', 'private.save_adaptive_search_item']],
      ['supabase/releases/adaptive-search-current-saves-v1.sql', ['private.adaptive_item_receipt', 'private.finish_adaptive_search']],
      ['supabase/releases/adaptive-search-standalone-saves-v1.sql', ['private.verify_adaptive_search_item',
        'private.opportunity_search_adaptive_current_verification', 'private.opportunity_search_adaptive_manifest']],
      ['test/support/database/independentSavesPredecessor.sql', ['private.record_opportunity_search_discovery']],
    ] as const;
    for (const [path, names] of predecessors) {
      const definitions = historicalFunctionDefinitions(path);
      for (const name of names) {
        const definition = definitions.get(name); assert.ok(definition, name);
        sql(definition.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
      }
    }
    for (const signature of added) sql(`drop function ${signature};`);
    const upgrade = file('supabase/releases/adaptive-search-independent-saves-v1.sql');
    for (const hash of Object.values(functions())) assert.ok(upgrade.includes(String(hash)), `Missing predecessor guard ${hash}`);
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}','Synthetic independent-save upgrade',
        '{"topicsAndMethods":"Synthetic acoustic sensing"}','{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);reset role;commit;`);
    const pinned = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
    assert.equal(pinned.compatible, true);
    const now = new Date().toISOString(), url = `https://example.invalid/IndependentUpgrade/${run}`;
    const payload = { opportunity_key: `independent-upgrade-${run}`, title: 'Synthetic acoustic sensing', official_url: url, last_checked_at: now,
      sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['title', 'official_url'] }] };
    const saved = query(`select private.save_adaptive_search_item('${run}','${item}',${json(payload)});`);
    assert.equal(saved.outcome, 'saved');
    assert.equal(query(`select private.verify_adaptive_search_item('${run}','${item}');`).verified, true);
    const before = snapshot(), untouched = others();
    const recurring = () => sql(`select private.adaptive_search_recurring_prompt('${search}','${project}');`);
    const prompt = recurring(), original = sql("select pg_get_functiondef('private.save_adaptive_search_item(uuid,uuid,jsonb)'::regprocedure);");
    const altered = original.replace('AS $function$', 'AS $function$\n-- Synthetic unreviewed predecessor');
    assert.notEqual(altered, original);sql(altered);
    const rejected = functions();
    assert.throws(() => sql(upgrade), /Expected the reviewed independent-saves predecessor/iu);
    assert.deepEqual(functions(), rejected);
    assert.equal(snapshot(), before);
    assert.equal(sql("select to_regprocedure('private.adaptive_search_save_receipt_schema()') is null;"), 't');
    sql(original);sql(upgrade);
    assert.deepEqual(functions(), expected);
    assert.equal(properties(), expectedProperties, 'Function ownership or privileges changed');
    assert.equal(others(), untouched, 'An unrelated research-building function changed');
    assert.equal(snapshot(), before, 'The installer changed existing research, saved results or feedback');
    assert.equal(recurring(), prompt, 'The existing task must not need another paste');
    const current = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
    assert.ok(current.protocol_text.startsWith(ADAPTIVE_HOSTED_PROTOCOL_TEXT));
    for (const key of ['scope','base','query_plan','legacy_core_queries','planning','preferences','feedback','result_schema','due_sources','source_context','lease']) {
      assert.deepEqual(current[key], pinned[key], `Startup research field changed: ${key}`);
    }
    assert.equal(query(`select private.adaptive_item_receipt('${run}','${item}');`).saved, true);
    assert.equal(query(`select private.verify_adaptive_search_item('${run}','${item}');`).verified, true);
    assert.throws(() => sql(upgrade), /Expected the reviewed independent-saves predecessor/iu);
  } finally { reset(); }
});
