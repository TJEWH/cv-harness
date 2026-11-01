import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before } from 'node:test';
import { reset, sql } from '../../support/database/postgres';

const owner = randomUUID(), otherOwner = randomUUID();
const searches = [randomUUID(), randomUUID(), randomUUID()], otherSearch = randomUUID();
const included = randomUUID(), excluded = randomUUID(), submitted = randomUUID(), otherOpportunity = randomUUID();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const object = (output: string): any => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).at(-1) ?? null;
const actor = (account: string, body: string, anonymous = false) => `do $$ begin perform set_config('request.jwt.claims',${json({ sub: account, is_anonymous: anonymous })}::text,false);end $$;set role authenticated;${body};reset role;`;
const query = (body: string) => object(sql(body));
const packet = (search: string, account = owner) => query(actor(account, `select public.build_opportunity_search_feedback(${quote(account)},${quote(search)})`));
before(() => {
  reset();
  sql(`insert into auth.users(id) values(${quote(owner)}),(${quote(otherOwner)});`);
  for (const [id, account] of [...searches.map(id => [id, owner]), [otherSearch, otherOwner]]) {
    sql(`insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values(${quote(id!)},${quote(account!)},'Synthetic current feedback','{"topicsAndMethods":"Acoustics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');`);
  }
  for (const id of [included, excluded, submitted, otherOpportunity]) {
    sql(`insert into public.opportunities(id,opportunity_key,title,institution,topics) values(${quote(id)},${quote('synthetic-default-'+id)},'Acoustic research','Synthetic institute',array['Acoustics']);`);
  }
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,state,comment,feedback_excluded) values
    (${quote(owner)},${quote(included)},'interested','Complete saved evaluation.',false),
    (${quote(owner)},${quote(excluded)},'very_high_interest','EXCLUDED EVALUATION CANARY',true),
    (${quote(otherOwner)},${quote(otherOpportunity)},'strong_interest','OTHER OWNER CANARY',false);
    insert into public.applications(user_id,opportunity_id,status,submitted_at,notes) values
    (${quote(owner)},${quote(submitted)},'submitted','2026-01-01','PRIVATE APPLICATION CANARY'),
    (${quote(owner)},${quote(excluded)},'submitted','2026-01-02','EXCLUDED APPLICATION CANARY');`);
});

test('fresh, disabled and paused searches include current owner feedback by default', () => {
  sql(actor(owner, `select public.save_opportunity_search_adaptation(${quote(searches[0]!)},false,false,0);
    select public.save_opportunity_search_adaptation(${quote(searches[1]!)},true,true,0)`));
  for (const search of searches) {
    const feedback = packet(search);
    assert.equal(feedback.metric_version, 'opportunity-interest-v2');
    assert.equal(feedback.selection_policy_version, 'opportunity-feedback-selection-v2');
    assert.deepEqual(feedback.examples.map((row: any) => row.opportunity_id).sort(), [included, submitted].sort());
    assert.equal(feedback.examples.find((row: any) => row.opportunity_id === included).interest_score, 6);
    assert.equal(feedback.examples.find((row: any) => row.opportunity_id === included).search_feedback_summary, 'Complete saved evaluation.');
    assert.equal(feedback.examples.find((row: any) => row.opportunity_id === submitted).interest_score, 9.5);
    assert.equal(feedback.approved_preferences.length, 0);
  }
});

test('feedback never contains another owner or private application fields', () => {
  const own = packet(searches[0]!), other = packet(otherSearch, otherOwner);
  assert.deepEqual(other.examples.map((row: any) => row.opportunity_id), [otherOpportunity]);
  for (const canary of ['PRIVATE APPLICATION CANARY', 'EXCLUDED APPLICATION CANARY', 'OTHER OWNER CANARY', 'EXCLUDED EVALUATION CANARY']) {
    assert.equal(JSON.stringify(own).includes(canary), false);
  }
  assert.throws(() => packet(searches[0]!, otherOwner), /Search unavailable/);
  assert.throws(() => query(actor(owner, `select public.build_opportunity_search_feedback(${quote(owner)},${quote(searches[0]!)})`, true)), /signed-in|Feedback unavailable/);
});

test('adaptation enable and pause affect planning without changing raw feedback or its semantic fingerprint', () => {
  const search = searches[2]!, original = packet(search);
  for (const [enabled, paused, revision] of [[true, false, 0], [true, true, 1], [false, false, 2]] as const) {
    const settings = query(actor(owner, `select public.save_opportunity_search_adaptation(${quote(search)},${enabled},${paused},${revision})`));
    assert.equal(settings.adaptation_revision, revision + 1);
    assert.equal(settings.adaptation_enabled, enabled);
    assert.equal(settings.adaptation_paused, paused);
    const current = packet(search);
    assert.equal(current.input_fingerprint, original.input_fingerprint);
    assert.deepEqual(current.examples, original.examples);
    assert.deepEqual(current.aggregates, original.aggregates);
    assert.deepEqual(current.approved_preferences, original.approved_preferences);
  }
});

test('per-opportunity exclusion applies across searches and permanently removes old pinned examples', () => {
  for (const search of searches) sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`);
  const pinned = query(`select jsonb_agg(jsonb_build_object('search_id',search_id,'revision',feedback_revision)) from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)};`);
  const before = query(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(included)};`);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(included)},'{"feedback_excluded":true}')`));
  for (const search of searches) assert.deepEqual(packet(search).examples.map((row: any) => row.opportunity_id), [submitted]);
  const after = query(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(included)};`);
  assert.equal(after.comment, before.comment);
  assert.equal(after.evaluation_revision, before.evaluation_revision);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(included)},'{"feedback_excluded":false}')`));
  assert.equal(packet(searches[0]!).examples.some((row: any) => row.opportunity_id === included), true);
  for (const snapshot of pinned) {
    const saved = query(`select packet from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)} and search_id=${quote(snapshot.search_id)} and feedback_revision=${snapshot.revision};`);
    assert.equal(saved.examples.some((row: any) => row.opportunity_id === included), false);
    assert.equal(saved.privacy_scope_changed, true);
  }
});
