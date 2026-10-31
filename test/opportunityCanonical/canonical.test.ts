import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { file, reset, sql, sqlAsync } from '../opportunityFeedback/db';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const literal = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const json = <T = any>(statement: string): T => JSON.parse(sql(statement));
const owner = randomUUID(), search = randomUUID(), run = randomUUID();
const source = (time = '2000-01-02T09:00:00Z') => ({ url: 'https://example.invalid/Jobs/Canonical', kind: 'official', checked_at: time,
  precision: 'instant', supports: ['title', 'city', 'country', 'contacts', 'requirements', 'personal_fit'] });
const payload = (fields: Record<string, unknown> = {}, key = randomUUID(), time = '2000-01-02T09:00:00Z') => ({
  opportunity_key: key, title: 'Synthetic canonical research', city: 'Espoo', last_checked_at: time, sources: [source(time)], ...fields,
});
const seedRun = (id: string) => sql(`select private.begin_opportunity_search('${search}','${id}');
  select private.save_opportunity_search_queries('${id}','[{"query":"synthetic protected canonical research"}]');`);
const submit = (value: unknown, item = randomUUID(), id = run) => json(`select private.submit_opportunity_search_result('${id}','${item}',${literal(value)});`);

before(() => {
  reset();
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}',
      'Synthetic canonical intake','{"topicsAndMethods":"Robotics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');`);
  seedRun(run);
});

test('fresh installation exposes the reviewed current schema and no historical schema rollback machinery', () => {
  assert.deepEqual(json('select private.opportunity_storage_schema();'), JSON.parse(file('../../supabase/contracts/opportunity.schema.json')));
  assert.equal(json('select private.opportunity_search_result_schema();')['x-canonical-version'], 6);
  assert.equal(sql("select to_regclass('private.opportunity_payload_archive') is null and to_regprocedure('private.rollback_opportunity_payload_v5(boolean)') is null;"), 't');
  sql(file('../../supabase/tests/opportunity_canonical_installation.sql'));
});

test('canonical-only intake rejects retired aliases and shapes atomically', () => {
  const invalids = [{ contact: [] }, { documents: [] }, { university: 'University' }, { contacts: ['Person'] },
    { contacts: [{ name: 'Person', role: 'Supervisor' }] }, { requirements: ['MSc'] }, { requirements: { required: ['MSc'] } },
    { required_documents: [{ document: 'CV' }] }, { salary: { salary_amount: 3000 } }, { data: { methods: ['DSP'] } }];
  const count = sql('select count(*) from public.opportunities;');
  for (const change of invalids) assert.throws(() => submit(payload(change)), /canonical|schema|Unknown\/protected/i, JSON.stringify(change));
  assert.equal(sql('select count(*) from public.opportunities;'), count);
});

test('canonical writes assign stable IDs and retry the exact immutable item receipt', () => {
  const value = payload({ contacts: [{ name: 'Person', email: 'person@example.invalid', roles: ['Scientific contact'] }],
    requirements: [{ text: 'MSc', status: 'required', stage: 'recruitment' }], personal_fit: { score: 8.4, scale_min: 0, scale_max: 10, summary: 'Research fit' } });
  const item = randomUUID(), receipt = submit(value, item);
  assert.equal(receipt.snapshot.metadata_schema_version, 6);
  assert.ok(receipt.snapshot.contacts[0].entity_id); assert.ok(receipt.snapshot.sources[0].source_id);
  assert.deepEqual(submit(value, item), receipt);
  assert.throws(() => submit({ ...value, city: 'Helsinki' }, item), /cannot be reused/);
  const next = submit({ ...value, last_checked_at: '2000-01-03T09:00:00Z', sources: [source('2000-01-03T09:00:00Z')],
    contacts: [{ name: 'Person', email: 'person@example.invalid', phone: '123' }] });
  assert.equal(next.snapshot.contacts.length, 1); assert.equal(next.snapshot.contacts[0].phone, '123');
  assert.deepEqual(next.snapshot.contacts[0].roles, ['Scientific contact']);
  const verified = json(`select private.verify_opportunity_search_result('${run}','${item}');`);
  assert.equal(verified.verified, true); assert.equal(verified.changed_since_save, true);
  assert.deepEqual(verified.current_snapshot, next.snapshot, 'verification reads current research while retaining the original saved receipt');
});

test('evidence replacement requires newer observations or an exact compare-and-set correction', () => {
  const value = payload(), first = submit(value);
  const same = submit({ ...value, city: 'Helsinki' }); assert.equal(same.snapshot.city, 'Espoo');
  const corrected = submit({ ...value, city: 'Helsinki', merge_control: { corrections: [{ path: '/city', expected: 'Espoo', reason: 'Corrected official notice interpretation.' }] } });
  assert.equal(corrected.snapshot.city, 'Helsinki');
  assert.equal(submit({ ...value, city: 'Turku', merge_control: { corrections: [{ path: '/city', expected: first.snapshot.city, reason: 'Stale correction.' }] } }).snapshot.city, 'Helsinki');
});

test('URL identities normalize hosts while retaining case-sensitive paths', () => {
  const urls = json<string[]>(`select private.opportunity_canonical_set('/source_urls','["https://EXAMPLE.invalid/Job","https://example.invalid/Job","https://example.invalid/job"]');`);
  assert.equal(urls.length, 2); assert.deepEqual(urls.map(url => new URL(url).pathname).sort(), ['/Job', '/job']);
});

test('concurrent canonical submissions preserve one identity and independent enrichments', async () => {
  const otherRun = randomUUID(); seedRun(otherRun);
  const key = randomUUID(), values = [payload({ city: 'Espoo' }, key), payload({ country: 'Finland' }, key)];
  await Promise.all(values.map((value, index) => sqlAsync(`select private.submit_opportunity_search_result('${index ? otherRun : run}','${randomUUID()}',${literal(value)});`)));
  const rows = json<any[]>(`select jsonb_agg(to_jsonb(o)) from public.opportunities o where opportunity_key='${key}';`);
  assert.equal(rows.length, 1); assert.equal(rows[0].city, 'Espoo'); assert.equal(rows[0].country, 'Finland');
});

test('strict storage and authenticated readiness use the current canonical contract', () => {
  const receipt = submit(payload());
  assert.throws(() => sql(`update public.opportunities set contacts='["Person"]' where id='${receipt.opportunity_id}';`), /opportunities_payload_v6_check/);
  const readiness = json(`begin;set local role authenticated;set local request.jwt.claim.sub='${owner}';select public.opportunity_search_readiness();rollback;`);
  assert.equal(readiness.ready, true); assert.equal(readiness.protocol_version, 'opportunity-search-v1-canonical-6');
  assert.equal(sql("select has_function_privilege('authenticated','private.submit_opportunity_search_result(uuid,uuid,jsonb)','EXECUTE');"), 'f');
});

test('current run undo restores exact research while preserving private review and application snapshots', () => {
  const original = submit(payload({}, randomUUID(), '2000-01-01T09:00:00Z')).snapshot;
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,state,comment) values('${owner}','${original.id}','interested','Private review');
    begin;set local request.jwt.claim.sub='${owner}';select public.create_job_application('${randomUUID()}','${original.id}');commit;`);
  const applications = sql(`select jsonb_agg(to_jsonb(a)) from public.applications a where opportunity_id='${original.id}';`);
  const undoRun = randomUUID(); seedRun(undoRun);
  submit(payload({ city: 'Helsinki' }, original.opportunity_key), randomUUID(), undoRun);
  sql(`update public.opportunity_search_runs set status='complete' where id='${undoRun}';`);
  assert.deepEqual(json(`select private.rollback_opportunity_search_merge('${undoRun}');`).blockers, []);
  assert.equal(json(`select private.rollback_opportunity_search_merge('${undoRun}',true);`).applied, true);
  assert.deepEqual(json(`select to_jsonb(o) from public.opportunities o where id='${original.id}';`), original);
  assert.equal(sql(`select jsonb_agg(to_jsonb(a)) from public.applications a where opportunity_id='${original.id}';`), applications);
  assert.equal(sql(`select comment from public.opportunity_reviews where opportunity_id='${original.id}';`), 'Private review');
});

test('current run undo refuses later manual edits and unapproved removal of new research', () => {
  const original = submit(payload({}, randomUUID(), '2000-01-01T09:00:00Z')).snapshot;
  const undoRun = randomUUID(); seedRun(undoRun);
  submit(payload({ city: 'Helsinki' }, original.opportunity_key), randomUUID(), undoRun);
  sql(`update public.opportunity_search_runs set status='complete' where id='${undoRun}';update public.opportunities set country='Later edit' where id='${original.id}';`);
  assert.equal(json(`select private.rollback_opportunity_search_merge('${undoRun}');`).blockers[0].reason, 'changed_after_run');
  assert.throws(() => sql(`select private.rollback_opportunity_search_merge('${undoRun}',true);`), /Rollback blocked/);
  const newRun = randomUUID(); seedRun(newRun); submit(payload(), randomUUID(), newRun);
  sql(`update public.opportunity_search_runs set status='complete' where id='${newRun}';`);
  assert.equal(json(`select private.rollback_opportunity_search_merge('${newRun}');`).blockers[0].reason, 'new_record_removal_requires_separate_approval');
});
