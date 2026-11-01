import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { before } from 'node:test';
import { reset, sql } from '../../support/database/postgres';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (output: string): any => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).at(-1) ?? null;
const actor = (owner: string, body: string) => `do $$ begin perform set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,false);end $$;set role authenticated;${body};reset role;`;
const query = (body: string) => object(sql(body));
function fixture() {
  const owner = randomUUID(), search = randomUUID(), opportunity = randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(${quote(search)},${quote(owner)},'Synthetic inclusion','{"topicsAndMethods":"Acoustics"}',
    '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');
    insert into public.opportunities(id,opportunity_key,title,institution,topics) values(${quote(opportunity)},${quote('synthetic-inclusion-'+opportunity)},'Synthetic research','Synthetic Institute',array['Acoustics']);`);
  return { owner, search, opportunity };
}
before(reset);

test('safe text is included by default with exact hashes and no fabricated interest', () => {
  const { owner, opportunity } = fixture(), complete = 'Evidence from acoustic experiments. '.repeat(24);
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(complete)})`));
  const projected = query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`));
  const excerpt = Array.from(complete).slice(0, 600).join('');
  assert.equal(projected.search_feedback_summary, excerpt);
  assert.deepEqual(projected.summary_inclusion, { policy_version: 'included-unless-excluded-v1', summary_hash: digest(excerpt),
    source_hash: digest(complete), summary_revision: 1, truncated: true, source_length: Array.from(complete).length });
  assert.equal(projected.interest_score, null);
  assert.equal(sql(`select comment=${quote(complete)} from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)};`), 't');
  const example = Object.fromEntries(Object.entries(projected).filter(([key]) => key !== 'withheld_counts'));
  assert.equal(sql(`select private.opportunity_search_adaptive_shape('example',${json(example)});`), 't');
});

test('full-source privacy and exclusion withhold outgoing data while preserving the private evaluation', () => {
  const { owner, search, opportunity } = fixture(), unsafe = 'Safe research interests. '.repeat(32)+' private@example.invalid';
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},${quote(unsafe)});
    select public.review_job_opportunity(${quote(opportunity)},(select updated_at from public.opportunities where id=${quote(opportunity)}),'strong_interest')`));
  let projected = query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`));
  assert.equal(projected.interest_score, 8);
  assert.equal(projected.search_feedback_summary, undefined);
  assert.equal(projected.summary_inclusion, undefined);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":true}')`));
  assert.equal(query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)), null);
  assert.equal(query(actor(owner, `select public.preview_opportunity_search_feedback(${quote(search)})`)).examples.length, 0);
  assert.equal(sql(`select comment=${quote(unsafe)} from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)};`), 't');
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":false}')`));
  projected = query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`));
  assert.equal(projected.interest_score, 8);
  assert.equal(projected.search_feedback_summary, undefined);
});

test('editing a current evaluation redacts pinned excerpts without changing the snapshot identity', () => {
  const { owner, search, opportunity } = fixture();
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},'Original research evaluation.')`));
  const first = query(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`);
  assert.equal(first.examples[0].search_feedback_summary, 'Original research evaluation.');
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},'Updated evaluation for acoustic experiments.')`));
  const saved = query(`select to_jsonb(s) from public.opportunity_search_feedback_snapshots s where user_id=${quote(owner)} and search_id=${quote(search)} and feedback_revision=${first.feedback_revision};`);
  assert.equal(saved.feedback_revision, first.feedback_revision);
  assert.equal(saved.input_fingerprint, first.input_fingerprint);
  assert.equal(saved.packet.privacy_scope_changed, true);
  assert.equal(saved.packet.examples[0].search_feedback_summary, undefined);
  assert.equal(saved.packet.examples[0].summary_inclusion, undefined);
  const next = query(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`);
  assert.equal(next.examples[0].search_feedback_summary, 'Updated evaluation for acoustic experiments.');
  assert.notEqual(next.input_fingerprint, first.input_fingerprint);
});

test('owner-only disposition notes never become shared evidence or alter the catalogue or interest', () => {
  const { owner, opportunity } = fixture(), other = fixture();
  sql(actor(owner, `select public.review_job_opportunity(${quote(opportunity)},(select updated_at from public.opportunities where id=${quote(opportunity)}),'interested')`));
  const before = sql(`select to_jsonb(o) from public.opportunities o where id=${quote(opportunity)};`);
  const saved = query(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"manually_archived":true,"technical_issue_category":"requirements","technical_issue_note":"PRIVATE TECHNICAL NOTE"}')`));
  assert.equal(saved.manually_archived, true);
  assert.equal(saved.technical_issue_note, 'PRIVATE TECHNICAL NOTE');
  const projected = query(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`));
  assert.equal(projected.manually_archived, true);
  assert.equal(projected.technical_issue_category, 'requirements');
  assert.equal(projected.technical_issue_note, undefined);
  assert.equal(projected.interest_score, 6);
  assert.equal(JSON.stringify(projected).includes('PRIVATE TECHNICAL NOTE'), false);
  sql(actor(other.owner, `update public.opportunity_reviews set manually_archived=false where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}`));
  assert.equal(sql(`select manually_archived from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)};`), 't');
  assert.equal(sql(`select to_jsonb(o) from public.opportunities o where id=${quote(opportunity)};`), before);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"technical_issue_category":"invented"}')`)), /technical issue/i);
});
