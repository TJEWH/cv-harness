import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { randomUUID } from 'node:crypto';
import { deriveOpportunityFeedback } from '../../src/features/opportunities/domain/opportunityFeedback';
import { compileAdaptiveFeedbackSnapshot } from '../../src/features/meta-search/domain/adaptiveFeedbackSnapshots';
import { ADAPTIVE_BATCH_PROTOCOL_TEXT } from '../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { reset, sql } from './db';

before(() => reset());

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const object = (value: string): any => value.split('\n').flatMap(line => {
  try { const parsed = JSON.parse(line); return parsed && typeof parsed === 'object' ? [parsed] : []; } catch { return []; }
}).at(-1);
const actor = (owner: string, body: string) => `select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,false);
  set role authenticated;${body};reset role;`;

test('current interest choices preserve saved evidence, derives application interest, restores saved choices and validates the new reasons', async () => {
  reset();
  const owner = randomUUID(), other = randomUUID(), search = randomUUID();
  const ids = Array.from({ length: 7 }, () => randomUUID());
  sql(`insert into auth.users(id) values(${quote(owner)}),(${quote(other)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(${quote(search)},${quote(owner)},
      'Synthetic interest choices','{"topicsAndMethods":"Acoustics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');`);
  for (const id of ids) sql(`insert into public.opportunities(id,opportunity_key,title,institution,topics,deadline)
    values(${quote(id)},${quote(`synthetic-interest-${id}`)},'Synthetic research','Synthetic institute',array['Acoustics'],'2028-01-01');`);
  for (const [index, state] of ['not_interested', 'interested', 'strong_interest', 'unreviewed'].entries()) {
    sql(`insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,comment)
      values(${quote(owner)},${quote(ids[index]!)},${quote(state)},1.25,'Saved evaluation');`);
  }
  assert.equal(sql('select private.opportunity_search_adaptive_protocol_text();'), ADAPTIVE_BATCH_PROTOCOL_TEXT);
  const metric = (id: string, account = owner) => object(sql(actor(account,
    `select public.opportunity_feedback_preview_metric(${quote(account)},${quote(id)})`)));
  for (const [index, score] of [2, 6, 8, null].entries()) {
    assert.equal(metric(ids[index]!).interest_score, score, 'legacy numeric overrides do not affect current choices');
  }
  sql(actor(owner, `select public.review_job_opportunity(${quote(ids[4]!)},null,'very_high_interest')`));
  assert.equal(metric(ids[4]!).interest_score, 9);
  assert.equal(metric(ids[4]!).interest_origin, 'categorical_review');

  const applicationId = randomUUID();
  const savedChoice = sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(ids[0]!)};`);
  sql(actor(owner, `select public.create_job_application(${quote(applicationId)},${quote(ids[0]!)})`));
  assert.equal(metric(ids[0]!).interest_score, 9);
  assert.equal(metric(ids[0]!).interest_origin, 'application');
  assert.equal(metric(ids[0]!).interest_gap, null, 'application creation has no invented feedback timestamp');
  assert.equal(metric(ids[0]!).baseline_status, 'unavailable');
  assert.equal(sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(ids[0]!)};`), savedChoice);
  const review = object(sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(ids[0]!)};`));
  const applications = object(sql(`select jsonb_agg(to_jsonb(a)) from public.applications a where user_id=${quote(owner)};`));
  assert.equal(deriveOpportunityFeedback({ user_id: owner, opportunity_id: ids[0]!, review, applications }).interest_score, 9);
  sql(actor(owner, `update public.applications set status='submitted',submitted_at='2026-10-31T08:00:00Z' where id=${quote(applicationId)}`));
  assert.equal(metric(ids[0]!).interest_score, 9.5);
  assert.equal(metric(ids[0]!).interest_origin, 'confirmed_submission');
  sql(actor(other, `select public.remove_job_application(${quote(applicationId)})`));
  assert.equal(metric(ids[0]!).interest_score, 9.5, 'another account cannot remove this application');
  sql(actor(owner, `select public.remove_job_application(${quote(applicationId)});select public.remove_job_application(${quote(applicationId)})`));
  assert.equal(metric(ids[0]!).interest_score, 2);
  assert.equal(sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)} and opportunity_id=${quote(ids[0]!)};`), savedChoice);

  // A preparation application without any review is still included in search feedback.
  sql(actor(owner, `select public.create_job_application(${quote(randomUUID())},${quote(ids[5]!)})`));
  assert.equal(metric(ids[5]!).interest_score, 9);
  assert.equal(metric(ids[5]!, other).interest_score, null);
  const rule = { rule_id: randomUUID(), kind: 'emphasis', category: 'background_fit', polarity: 'positive',
    target: 'Research background', evidence_refs: [ids[5]!] };
  assert.equal(object(sql(actor(owner, `select public.opportunity_search_validate_preference_rule(${quote(owner)},${quote(search)},${json(rule)},true)`))).category, 'background_fit');
  assert.throws(() => sql(actor(owner, `select public.opportunity_search_validate_preference_rule(${quote(owner)},${quote(search)},
    ${json({ ...rule, category: 'requirements' })},true)`)), /structured emphasis/);
  const submittedApplication = randomUUID();
  sql(actor(owner, `select public.create_job_application(${quote(submittedApplication)},${quote(ids[6]!)});
    update public.applications set status='submitted',submitted_at='2026-10-31T08:00:00Z' where id=${quote(submittedApplication)}`));
  const reasons = ['topic', 'method', 'hardware', 'location', 'funding', 'timing', 'background_fit', 'project_context', 'other']
    .flatMap(category => ['positive', 'negative'].map(polarity => ({ category, polarity })))
    .concat(['requirements', 'availability'].map(category => ({ category, polarity: 'negative' })));
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(ids[4]!)},${json({ interest_reasons: reasons })})`));
  assert.equal(object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(ids[4]!)})`))).reasons.length, 20);
  for (const category of ['requirements', 'availability']) assert.throws(() => sql(actor(owner,
    `select public.save_opportunity_feedback(${quote(ids[4]!)},${json({ interest_reasons: [{ category, polarity: 'positive' }] })})`)), /Invalid structured interest reason/);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_feedback(${quote(ids[4]!)},${json({ interest_reasons: Array.from({ length: 25 }, () => ({ category: 'topic', polarity: 'positive' })) })})`)), /at most 24/);
  const currentPacket = object(sql(actor(owner, `select public.build_opportunity_search_feedback(${quote(owner)},${quote(search)})`)));
  assert.equal(currentPacket.metric_version, 'opportunity-interest-v2');
  assert.equal(currentPacket.counts.application, 1);
  assert.equal(currentPacket.counts.submission_fallback, 1);
  assert.equal(currentPacket.examples.find((row: any) => row.opportunity_id === ids[5]).interest_score, 9);
  const reference = await compileAdaptiveFeedbackSnapshot({ user_id: owner, search_id: search,
    feedback_revision: currentPacket.feedback_revision, preference_revision: currentPacket.preference_revision,
    examples: currentPacket.examples, approved_preferences: currentPacket.approved_preferences });
  assert.deepEqual(currentPacket.counts, reference.counts);
  assert.deepEqual(currentPacket.aggregates, reference.aggregates);
  assert.deepEqual(currentPacket.examples, reference.examples, 'SQL and TypeScript choose and project identical current examples');
  assert.match(currentPacket.input_fingerprint, /^[a-f0-9]{64}$/u);
  assert.match(reference.input_fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(currentPacket.fingerprint_encoding, 'sha256-pg-jsonb-v1');
  assert.equal(reference.fingerprint_encoding, 'sha256-canonical-json-v1');
  assert.deepEqual(object(sql(actor(owner, `select public.build_opportunity_search_feedback(${quote(owner)},${quote(search)})`))), currentPacket,
    'the versioned SQL fingerprint remains stable without a semantic change');
  assert.equal(sql(`select private.opportunity_search_adaptive_shape('feedback',${json(currentPacket)});`), 't');


  const run = randomUUID(), check = randomUUID(), query = randomUUID();
  sql(`select private.begin_opportunity_search(${quote(search)},${quote(run)});
    update public.opportunity_search_runs set status='complete',execution_report_status='complete' where id=${quote(run)};
    insert into public.opportunity_search_executions(run_id,check_id,user_id,search_id,kind,query_id,text_hash,attempted_at,status,results_count,payload_hash)
      values(${quote(run)},${quote(check)},${quote(owner)},${quote(search)},'query',${quote(query)},repeat('a',64),'2026-10-20T10:00:00Z','complete',7,repeat('a',64));`);
  for (const id of ids) {
    const item = randomUUID();
    sql(`insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result,verified_at)
      values(${quote(run)},${quote(item)},${quote(owner)},${quote(id)},'{}','{}','2026-10-20T11:00:00Z');
      insert into public.opportunity_search_discoveries(user_id,search_id,run_id,item_id,opportunity_id,base_revision,feedback_revision,preference_revision,
        protocol_version,primary_discovery,execution_refs,primary_check_id,discovered_at,encountered_at,verified_at,institution,topics,deadline_quality,payload_hash)
      select ${quote(owner)},${quote(search)},${quote(run)},${quote(item)},${quote(id)},1,0,0,active_protocol_version,true,
        array[${quote(check)}::uuid],${quote(check)},'2026-10-20T10:10:00Z','2026-10-20T10:10:00Z','2026-10-20T11:00:00Z',
        'Synthetic institute',array['Acoustics'],'{}',repeat('a',64) from private.opportunity_search_settings where singleton;`);
  }
  const quality = object(sql(actor(owner, `select public.read_opportunity_search_metrics(${quote(search)})`)));
  assert.equal(quality.overall.with_interest, 6);
  assert.equal(quality.overall.reviewed, 6);
  assert.equal(quality.overall.mean_interest, 7.25);
  assert.equal(quality.overall.explicit_high_interest, 4);
  assert.equal(quality.overall.application, 1);
  assert.equal(quality.overall.explicit_rating, 0);
  const outcomes = object(sql(actor(owner, `select public.opportunity_search_dashboard_outcomes(${quote(search)},null,${quote(query)},repeat('a',64))`)));
  assert.equal(outcomes.with_interest, quality.overall.with_interest);
  assert.equal(outcomes.mean_interest, quality.overall.mean_interest);
  assert.equal(outcomes.explicit_high_interest, quality.overall.explicit_high_interest);
  const persisted = object(sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`));
  assert.equal(persisted.metric_version, 'opportunity-interest-v2');
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(ids[4]!)},'{"feedback_excluded":true}')`));
  const redacted = object(sql(`select packet from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)}
    and search_id=${quote(search)} and feedback_revision=${persisted.feedback_revision};`));
  assert.equal(redacted.counts.application, 0, 'privacy redaction retains the current count contract');
  assert.equal(sql(`select private.opportunity_search_adaptive_shape('feedback',${json(redacted)});`), 't');
});
