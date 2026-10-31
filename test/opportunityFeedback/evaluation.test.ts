import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { before } from 'node:test';
import { reset, sql } from './db';

const owner = randomUUID(), otherOwner = randomUUID();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (output: string): any => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).at(-1) ?? null;
const actor = (account: string, body: string, anonymous = false) => `do $$ begin perform set_config('request.jwt.claims',${json({ sub: account, is_anonymous: anonymous })}::text,false);end $$;set role authenticated;${body};reset role;`;
const query = (body: string) => object(sql(body));
const review = (opportunity: string, account = owner) => query(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(account)} and opportunity_id=${quote(opportunity)};`);
function opportunity() {
  const id = randomUUID();
  sql(`insert into public.opportunities(id,opportunity_key,title,topics) values(${quote(id)},${quote('synthetic-evaluation-'+id)},'Synthetic acoustic research',array['Acoustics']);`);
  return id;
}
before(() => {
  reset();
  sql(`insert into auth.users(id) values(${quote(owner)}),(${quote(otherOwner)});`);
});

test('a complete evaluation saves exactly once while server revisions remain independent of interest', () => {
  const id = opportunity(), complete = `  ${'🧪'.repeat(700)} Acoustic research.\n `;
  const saved = query(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(complete)})`));
  assert.equal(saved.comment, complete);
  assert.equal(saved.evaluation_revision, 1);
  assert.equal(saved.feedback_revision, 0);
  assert.equal(query(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(complete)})`)).evaluation_revision, 1);
  const next = query(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(complete+'Next sentence.')})`));
  assert.equal(next.evaluation_revision, 2);
  assert.equal(next.feedback_revision, 0);
  sql(actor(owner, `update public.opportunity_reviews set evaluation_revision=9999 where opportunity_id=${quote(id)}`));
  assert.equal(review(id).evaluation_revision, 2);
  sql(actor(owner, `update public.opportunity_reviews set comment='A direct owner edit.',evaluation_revision=9999 where opportunity_id=${quote(id)}`));
  assert.equal(review(id).evaluation_revision, 3);
  assert.equal(review(id).comment, 'A direct owner edit.');
  const cleared = query(actor(owner, `select public.save_opportunity_comment(${quote(id)},'')`));
  assert.equal(cleared.comment, null);
  assert.equal(cleared.evaluation_revision, 4);
});

test('projection hashes the full saved source and bounds its excerpt to 600 Unicode code points', () => {
  const id = opportunity(), complete = '🧪'.repeat(1000)+' Acoustic research.';
  sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(complete)})`));
  const projected = query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(id)})`));
  assert.equal(projected.search_feedback_summary, '🧪'.repeat(600));
  assert.deepEqual(projected.summary_inclusion, { policy_version: 'included-unless-excluded-v1',
    summary_hash: digest('🧪'.repeat(600)), source_hash: digest(complete), summary_revision: 1,
    truncated: true, source_length: Array.from(complete).length });
  assert.equal(projected.interest_score, null);
  assert.equal(review(id).comment, complete);
  const unsafe = 'Acoustic research. '.repeat(50)+' private@example.invalid';
  sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(unsafe)})`));
  assert.equal(query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(id)})`)), null);
  assert.equal(review(id).comment, unsafe, 'a contact beyond the excerpt boundary withholds the complete source without rewriting it');
});

test('the 12000-codepoint bound rejects an oversized write atomically', () => {
  const id = opportunity(), maximum = '🧪'.repeat(12000);
  sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(maximum)})`));
  assert.equal(review(id).comment, maximum);
  assert.equal(review(id).evaluation_revision, 1);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},${quote(maximum+'x')})`)), /12000/);
  assert.equal(review(id).comment, maximum);
  assert.equal(review(id).evaluation_revision, 1);
});

test('evaluation writes and previews are scoped to the signed-in owner', () => {
  const id = opportunity();
  sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},'Owner evaluation.')`));
  const other = query(actor(otherOwner, `select public.save_opportunity_comment(${quote(id)},'Other owner evaluation.')`));
  assert.equal(other.user_id, otherOwner);
  assert.equal(review(id).comment, 'Owner evaluation.');
  sql(actor(otherOwner, `update public.opportunity_reviews set comment='Forbidden overwrite' where user_id=${quote(owner)} and opportunity_id=${quote(id)}`));
  assert.equal(review(id).comment, 'Owner evaluation.');
  assert.throws(() => sql(actor(otherOwner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(id)})`)), /Feedback unavailable/);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_comment(${quote(id)},'Anonymous write')`, true)), /signed-in/);
  assert.equal(sql("select has_function_privilege('anon','public.save_opportunity_comment(uuid,text)','execute');"), 'f');
});
