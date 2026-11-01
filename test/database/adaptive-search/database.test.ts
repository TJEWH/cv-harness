import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { before, test } from 'node:test';
import { file, reset, sql, sqlAsync } from '../../support/database/postgres';

before(() => reset());

const owner = '10000000-0000-4000-8000-000000000001';
const opportunity = '10000000-0000-4000-8000-000000000002';
const actor = `set local role authenticated;set local request.jwt.claim.sub='${owner}';`;

test('atomic current installation has owner RLS and no retired feedback approval or conversion tables', () => {
  assert.equal(sql(`select count(*) from pg_tables where schemaname in('public','private');`), '44');
  assert.equal(sql(`select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','private') and c.relkind='r';`), 't');
  assert.equal(sql("select to_regclass('public.opportunity_feedback_summary_approvals') is null and to_regclass('private.opportunity_payload_archive') is null;"), 't');
  assert.equal(sql("select to_regprocedure('public.set_opportunity_feedback_consent(uuid,boolean)') is null;"), 't');
});

test('current feedback signals validate category/application precedence, exclusions and ownership', () => {
  sql(file('supabase/tests/opportunity_feedback_signals.sql'));
});

test('concurrent owner changes serialize meaningful revisions while view receipts remain neutral', async () => {
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunities(id,opportunity_key,title) values('${opportunity}','current-concurrency','Synthetic research');
    insert into public.opportunity_reviews(user_id,opportunity_id,state) values('${owner}','${opportunity}','unreviewed');`);
  const revision = Number(sql(`select feedback_revision from public.opportunity_reviews where user_id='${owner}' and opportunity_id='${opportunity}';`));
  const results = await Promise.allSettled([
    sqlAsync(`begin;${actor}update public.opportunity_reviews set state='not_interested' where opportunity_id='${opportunity}';select pg_sleep(0.15);commit;`),
    sqlAsync(`begin;${actor}update public.opportunity_reviews set state='strong_interest' where opportunity_id='${opportunity}';commit;`),
    sqlAsync(`begin;${actor}select public.review_job_opportunity('${opportunity}',now(),null);commit;`),
  ]);
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
  const metric = JSON.parse(sql(`select private.opportunity_interest_metric('${owner}','${opportunity}');`));
  assert.equal(metric.feedback_revision, revision + 2); assert.ok([2, 8].includes(metric.interest_score));
  assert.equal(metric.interest_origin, 'categorical_review');
  assert.equal(sql(`select count(*) from public.opportunity_reviews where user_id='${owner}' and opportunity_id='${opportunity}';`), '1');
});

// These contracts are independent transactions. Running them here gives every
// current application/refinement/security SQL assertion the same fresh baseline.
const assertionFiles = readdirSync(new URL('../../../supabase/tests/', import.meta.url)).filter(name => name.endsWith('.sql')
  && !name.startsWith('opportunity_search_') && !['opportunity_feedback_signals.sql', 'opportunity_feedback_snapshots.sql',
    'opportunity_canonical_installation.sql'].includes(name));
for (const name of assertionFiles.sort()) test(`current SQL contract: ${name}`, () => {
  sql(file(`supabase/tests/${name}`));
});
