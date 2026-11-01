import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());

const json = adaptiveJsonSqlLiteral;
const query = (statement: string) => JSON.parse(sql(statement));
const project = 'jjjjjjjjjjjjjjjjjjjj';
const changed = [
  'private.adaptive_search_recurring_prompt(uuid,text)',
  'private.opportunity_search_adaptive_current_verification(uuid,uuid)',
  'private.opportunity_search_adaptive_manifest(uuid)',
  'private.submit_adaptive_search_batch(uuid,uuid,jsonb)',
  'private.submit_opportunity_search_result(uuid,uuid,jsonb)',
  'private.verify_and_complete_adaptive_search(uuid,jsonb)',
];
const added = [
  'private.adaptive_item_receipt(uuid,uuid)',
  'private.save_adaptive_search_item(uuid,uuid,jsonb)',
  'private.verify_adaptive_search_item(uuid,uuid)',
];
const properties = () => query(`select jsonb_object_agg(signature,to_jsonb(p)-'prosrc')
  from jsonb_array_elements_text(${json(changed)}) s(signature) join pg_proc p on p.oid=signature::regprocedure;`);
const sources = (signatures: string[]) => query(`select jsonb_object_agg(signature,md5(prosrc))
  from jsonb_array_elements_text(${json(signatures)}) s(signature) join pg_proc p on p.oid=signature::regprocedure;`);
const otherFunctions = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('private','public') and p.oid not in(
    select to_regprocedure(signature) from jsonb_array_elements_text(${json([...changed, ...added])}) s(signature)
    where to_regprocedure(signature) is not null);`);

function definitions(text: string) {
  return [...text.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\2;/gmu)];
}

test('targeted standalone-save upgrade preserves a pinned run, its old batch and all research functions', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), batch = randomUUID(), oldItem = randomUUID();
  const queryId = randomUUID(), checkId = randomUUID();
  const expectedSources = sources([...changed, ...added]);
  const expectedProperties = properties();
  const upgrade = file('supabase/releases/adaptive-search-standalone-saves-v1.sql');
  // This historical save upgrade still advertises the original brief bound.
  // The later brief-limit upgrade independently checks the 96-KiB requirement.
  const historicalPrompt = definitions(upgrade).find(match => match[1]!.startsWith('private.adaptive_search_recurring_prompt('))!;
  expectedSources['private.adaptive_search_recurring_prompt(uuid,text)'] = createHash('md5').update(historicalPrompt[3]!).digest('hex');
  const predecessor = file('test/fixtures/meta-search/standalone-saves-predecessor.sql');
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${search}'),
    'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${search}'),
    'config',(select to_jsonb(c) from public.opportunity_search_runner_config c where search_id='${search}'),
    'batches',(select jsonb_agg(to_jsonb(b) order by batch_id) from private.opportunity_search_adaptive_batches b where run_id='${run}'),
    'items',(select jsonb_agg(to_jsonb(i) order by item_id) from private.opportunity_search_adaptive_items i where run_id='${run}'),
    'receipts',(select jsonb_agg(to_jsonb(r) order by item_id) from public.opportunity_search_receipts r where run_id='${run}'),
    'feedback',(select jsonb_agg(to_jsonb(f) order by feedback_revision) from public.opportunity_search_feedback_snapshots f where search_id='${search}')
  );`);
  try {
    sql(predecessor + '\n' + added.map(signature => `drop function ${signature};`).join('\n') + `
      alter table private.opportunity_search_adaptive_items drop constraint opportunity_search_adaptive_items_run_id_fkey;
      alter table private.opportunity_search_adaptive_items alter column batch_id set not null;`);
    const predecessorHashes = definitions(predecessor).map(match => createHash('md5').update(match[3]!).digest('hex'));
    for (const hash of predecessorHashes) assert.ok(upgrade.includes(hash), `Missing predecessor deployment guard ${hash}`);
    assert.deepEqual(Object.values(sources(changed)).sort(), predecessorHashes.sort(), 'The fixture must reproduce the reviewed predecessor');
    const priorProperties = properties(), untouchedFunctions = otherFunctions();
    assert.deepEqual(priorProperties, expectedProperties, 'Replacing function bodies must preserve their execution properties');
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
        values('${search}','${owner}','Synthetic standalone upgrade','{"topicsAndMethods":"Synthetic acoustic sensing"}',
          '{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
      set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
      reset role;commit;
      insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
        values('${owner}','${search}','${project}','adaptive',false,'${randomUUID()}');
      insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
        select id,user_id,'synthetic-standalone-upgrade',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1'
        from public.opportunity_search_templates where id='${search}';`);
    const startup = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
    assert.equal(startup.compatible, true, JSON.stringify(startup));
    const now = new Date().toISOString();
    const opportunity = (index: number) => {
      const url = `https://example.invalid/StandaloneUpgrade/${run}/${index}`;
      return { opportunity_key: `standalone-upgrade-${run}-${index}`, title: 'Synthetic acoustic sensing research', official_url: url,
        last_checked_at: now, sources: [{ url, kind: 'official', checked_at: now, precision: 'instant', supports: ['title', 'official_url'] }] };
    };
    const oldPayload = { schema_version: 1, query_plan: { schema_version: 2, queries: [
      { query_id: queryId, query: 'synthetic acoustic sensing researcher', role: 'core', manual: false },
    ] }, opportunities: [{ item_id: oldItem, opportunity: opportunity(0), attribution: { execution_refs: [checkId], primary_check_id: checkId,
      discovered_at: now, encountered_at: now } }], execution: { checks: [
      { check_id: checkId, kind: 'query', query_id: queryId, attempted_at: now, status: 'complete', results_count: 1 },
      ...startup.due_sources.map((source: { registry_id: string }) => ({ check_id: randomUUID(), kind: 'source',
        source_registry_id: source.registry_id, attempted_at: now, status: 'complete', results_count: 0 })),
    ], backlog: [], complete: true } };
    const receipt = query(`select private.submit_adaptive_search_batch('${run}','${batch}',${json(oldPayload)});`);
    assert.equal(receipt.items[0].outcome, 'saved', JSON.stringify(receipt));
    const pinned = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
    const manifest = query(`select private.opportunity_search_adaptive_manifest('${run}');`);
    const before = snapshot();

    sql(upgrade);
    assert.deepEqual(sources([...changed, ...added]), expectedSources, 'Upgrade definitions must match the current declarative schema');
    assert.deepEqual(properties(), priorProperties, 'Existing helper ACLs, security and execution properties changed');
    assert.equal(otherFunctions(), untouchedFunctions, 'The upgrade changed a research or unrelated function');
    assert.equal(snapshot(), before, 'Deployment changed the pre-existing run, results, feedback or automation');
    assert.deepEqual(query(`select private.begin_adaptive_search_brief('${search}','${run}');`), pinned, 'The same pinned research bundle changed across deployment');
    assert.deepEqual(query(`select private.opportunity_search_adaptive_manifest('${run}');`), manifest, 'Historical batch-only manifest identity changed');
    assert.deepEqual(query(`select private.submit_adaptive_search_batch('${run}','${batch}',NULL::jsonb);`), receipt);
    assert.equal(snapshot(), before, 'Recovery reads mutated historical research');
    for (const signature of added) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute');`), 'f', `${role} may execute ${signature}`);
      }
      assert.equal(sql(`select prosecdef from pg_proc where oid='${signature}'::regprocedure;`), 'f');
      assert.deepEqual(query(`select to_jsonb(proconfig) from pg_proc where oid='${signature}'::regprocedure;`), ['search_path=""']);
    }
    assert.equal(sql(`select attnotnull from pg_attribute where attrelid='private.opportunity_search_adaptive_items'::regclass and attname='batch_id';`), 'f');
    assert.equal(sql(`select confdeltype from pg_constraint where conrelid='private.opportunity_search_adaptive_items'::regclass
      and conname='opportunity_search_adaptive_items_run_id_fkey';`), 'c');
    assert.throws(() => sql(upgrade), /Expected the reviewed|already exists|partial/iu);
    assert.equal(snapshot(), before, 'A rejected duplicate upgrade changed business state');

    const directItem = randomUUID();
    const saved = query(`select private.submit_adaptive_search_batch('${run}','${directItem}',${json(opportunity(1))});`);
    assert.equal(saved.accepted, true, JSON.stringify(saved));
    const proof = query(`select private.verify_and_complete_adaptive_search('${run}',${json({ schema_version: 2, action: 'verify_item', item_id: directItem })});`);
    assert.equal(proof.verified, true, JSON.stringify(proof));
    const finished = query(`select private.verify_and_complete_adaptive_search('${run}',${json({ schema_version: 2, action: 'finish', completion_id: randomUUID(), status: 'complete' })});`);
    assert.equal(finished.historical_summary.status, 'complete', JSON.stringify(finished));
    assert.equal(finished.current_verification.verified_items, 2);
    assert.equal(finished.persisted_summary_read, true);
  } finally { reset(); }
});
