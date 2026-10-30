import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before } from 'node:test';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { projectAdaptiveSearchStartup } from '../../src/features/meta-search/domain/adaptiveSearchStartup';
import { file, reset, sql, upgradeCurrentFeedbackContract } from './db';

const owner = randomUUID(), otherOwner = randomUUID();
const disabledSearch = randomUUID(), pausedSearch = randomUUID(), freshSearch = randomUUID(), otherSearch = randomUUID();
const included = randomUUID(), excluded = randomUUID(), submitted = randomUUID(), otherOpportunity = randomUUID(), oldRun = randomUUID();
const project = 'abcdefghijklmnopqrst';
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const actor = (account: string, body: string, anonymous = false) => `DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',${json({ sub: account, is_anonymous: anonymous })}::text,false); END $$;
  SET ROLE authenticated; ${body}; RESET ROLE;`;
const object = (output: string): any => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).at(-1) ?? null;
const query = (body: string) => object(sql(body));
const packet = (search: string, account = owner) => query(actor(account, `SELECT public.build_opportunity_search_feedback('${account}','${search}')`));
const reviews = () => sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;');
const applications = () => sql('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;');
const settings = () => query(`SELECT jsonb_agg(to_jsonb(s)-ARRAY['structured_feedback_enabled','consent_revision','consent_updated_at','feedback_dirty','query_plan_dirty'] ORDER BY user_id,search_id) FROM public.opportunity_search_adaptive_settings s;`);
async function assertCurrentProjection(bundle: any) {
  const projected = await projectAdaptiveSearchStartup(bundle, {
    expected_run_id: bundle.scope.run_id,
    binding: { ...bundle.scope, ...bundle.release, enabled: true, authorized: true },
    privacy: { adaptation_enabled: bundle.planning.enabled, adaptation_paused: bundle.planning.paused,
      successful_source_reuse_enabled: false, privacy_scope_changed: bundle.refresh.privacy_scope_changed,
      excluded_opportunity_ids: [excluded], authorized_source_ids: bundle.source_context.map((row: any) => row.registry_id),
      included_summaries: bundle.feedback.examples.flatMap((row: any) => row.summary_inclusion ? [{ opportunity_id: row.opportunity_id, ...row.summary_inclusion }] : []) },
  });
  assert.equal(projected.compatible, true, JSON.stringify(projected));
  assert.deepEqual(projected, bundle, 'Current runtime accepts the complete migrated SQL bundle without changing its content');
}
let beforeReviews: string, beforeApplications: string, beforeSettings: unknown, beforeTaskState: string;
let beforeSnapshots: any[], beforeContexts: any[];

before(() => {
  reset({ searchProtocol: true });
  for (const name of ADAPTIVE_RELEASE_MIGRATIONS) sql(file(`../../supabase/${name}`));
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${otherOwner}');`);
  for (const [id, account] of [[disabledSearch, owner], [pausedSearch, owner], [freshSearch, owner], [otherSearch, otherOwner]]) {
    sql(`INSERT INTO public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      VALUES('${id}','${account}','Synthetic default feedback','{"topicsAndMethods":"Acoustics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');`);
  }
  for (const id of [included, excluded, submitted, otherOpportunity]) {
    sql(`INSERT INTO public.opportunities(id,opportunity_key,title,institution,topics,deadline)
      VALUES('${id}','synthetic-default-${id}','Acoustic research','Synthetic institute',ARRAY['Acoustics'],'2028-01-01');`);
  }
  sql(`INSERT INTO public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,interest_reasons,comment,feedback_excluded)
    VALUES('${owner}','${included}','not_interested',0,'[{"category":"topic","polarity":"negative","target":"Acoustics"}]','Complete saved evaluation.',false),
      ('${owner}','${excluded}','strong_interest',10,'[]','Excluded private evaluation.',true),
      ('${otherOwner}','${otherOpportunity}','interested',7,'[]','Other owner evaluation.',false);
    INSERT INTO public.applications(user_id,opportunity_id,status,submitted_at,notes)
    VALUES('${owner}','${submitted}','submitted','2026-01-01','PRIVATE APPLICATION CANARY'),
      ('${owner}','${excluded}','submitted','2026-01-02','EXCLUDED APPLICATION CANARY');`);
  sql(actor(owner, `SELECT public.set_opportunity_feedback_consent('${disabledSearch}',true);
    SELECT public.save_opportunity_search_adaptation('${disabledSearch}',true,false,0);
    SELECT public.set_opportunity_feedback_consent('${pausedSearch}',true);
    SELECT public.save_opportunity_search_adaptation('${pausedSearch}',true,true,0)`));
  sql(actor(otherOwner, `SELECT public.set_opportunity_feedback_consent('${otherSearch}',false)`));
  upgradeCurrentFeedbackContract(() => {
    // An actual old startup bundle exercises frozen snapshot/cache migration.
    sql(`UPDATE public.opportunity_search_adaptive_release SET enabled=true,project_ref='${project}' WHERE singleton;`);
    sql(actor(owner, `SELECT public.set_opportunity_search_runner_authorization('${disabledSearch}','${project}',true,0)`));
    const started = query(`SELECT private.begin_adaptive_opportunity_search('${disabledSearch}','${oldRun}');`);
    assert.equal(started.compatible, true, JSON.stringify(started));
    assert.ok(started.feedback.examples.length);
    const unchanged = reviews();
    assert.throws(() => sql(file('../../supabase/opportunity_feedback_defaults.sql')), /Finish active opportunity searches/);
    assert.equal(reviews(), unchanged);
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_search_adaptive_settings' AND column_name='structured_feedback_enabled';"), '1');
    sql(`UPDATE public.opportunity_search_runs SET status='complete',completed_at=clock_timestamp() WHERE id='${oldRun}';`);
    sql(actor(owner, `SELECT public.set_opportunity_feedback_consent('${disabledSearch}',false);
      SELECT public.set_opportunity_search_runner_authorization('${disabledSearch}','${project}',false,1)`));
    sql(`UPDATE public.opportunity_search_adaptive_release SET enabled=false WHERE singleton;`);
    assert.equal(query(`SELECT to_jsonb(s) FROM public.opportunity_search_adaptive_settings s WHERE search_id='${disabledSearch}'`).structured_feedback_enabled, false);
    beforeReviews = reviews(); beforeApplications = applications(); beforeSettings = settings();
    beforeTaskState = sql(`SELECT jsonb_build_object('runners',(SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id,search_id) FROM public.opportunity_search_runner_authorizations a),
      'release',(SELECT to_jsonb(r) FROM public.opportunity_search_adaptive_release r WHERE singleton),
      'bindings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY search_id) FROM public.opportunity_search_schedule_bindings b),
      'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.opportunity_search_runs r));`);
    beforeSnapshots = query('SELECT jsonb_agg(to_jsonb(s) ORDER BY user_id,search_id,feedback_revision) FROM public.opportunity_search_feedback_snapshots s;');
    beforeContexts = query('SELECT jsonb_agg(to_jsonb(c) ORDER BY run_id) FROM private.opportunity_search_adaptive_contexts c;');
    // A late failure must roll back even the final column drops and cache updates.
    const failure = file('../../supabase/opportunity_feedback_defaults.sql').replace("notify pgrst,'reload schema';", () => "DO $$ BEGIN RAISE EXCEPTION 'Intentional late defaults failure'; END $$;");
    assert.throws(() => sql(failure), /Intentional late defaults failure/);
    assert.equal(reviews(), beforeReviews);
    assert.deepEqual(settings(), beforeSettings);
    assert.equal(sql("SELECT to_regprocedure('public.set_opportunity_feedback_consent(uuid,boolean)') IS NOT NULL;"), 't');
  });
});

test('one-time defaults cutover preserves personal data and independent disabled/paused/task controls', () => {
  assert.equal(reviews(), beforeReviews); assert.equal(applications(), beforeApplications);
  assert.deepEqual(settings(), beforeSettings);
  const current = sql(`SELECT jsonb_build_object('runners',(SELECT jsonb_agg(to_jsonb(a) ORDER BY user_id,search_id) FROM public.opportunity_search_runner_authorizations a),
    'release',(SELECT to_jsonb(r) FROM public.opportunity_search_adaptive_release r WHERE singleton),
    'bindings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY search_id) FROM public.opportunity_search_schedule_bindings b),
    'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.opportunity_search_runs r));`);
  assert.equal(current, beforeTaskState);
  assert.equal(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prosrc~'structured_feedback_enabled|consent_revision|consent_updated_at|consent_enabled|opportunity-feedback-selection-v1';"), '0');
  assert.throws(() => sql(file('../../supabase/opportunity_feedback_defaults.sql')), /must run once/);
});

test('old disabled, paused and new searches include feedback by default without a sharing setting', () => {
  for (const search of [disabledSearch, pausedSearch, freshSearch]) {
    const feedback = packet(search);
    assert.equal(feedback.selection_policy_version, 'opportunity-feedback-selection-v2');
    assert.equal(feedback.consent_revision, undefined);
    assert.deepEqual(feedback.examples.map((row: any) => row.opportunity_id).sort(), [included, submitted].sort());
    const evaluation = feedback.examples.find((row: any) => row.opportunity_id === included);
    assert.equal(evaluation.interest_score, 0); assert.equal(evaluation.search_feedback_summary, 'Complete saved evaluation.');
    assert.equal(evaluation.reasons[0].polarity, 'negative');
    assert.equal(feedback.examples.find((row: any) => row.opportunity_id === submitted).confirmed_submission, true);
    assert.equal(feedback.approved_preferences.length, 0);
  }
});

test('frozen snapshot and startup cache migrate once without changing their audit identity', async () => {
  const snapshots = query('SELECT jsonb_agg(to_jsonb(s) ORDER BY user_id,search_id,feedback_revision) FROM public.opportunity_search_feedback_snapshots s;');
  const contexts = query('SELECT jsonb_agg(to_jsonb(c) ORDER BY run_id) FROM private.opportunity_search_adaptive_contexts c;');
  const without = (row: any, fields: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  for (const [index, row] of snapshots.entries()) {
    assert.deepEqual(without(row, ['packet']), without(beforeSnapshots[index], ['packet']));
    assert.equal(row.packet.selection_policy_version, 'opportunity-feedback-selection-v2');
    assert.equal(row.packet.consent_revision, undefined);
  }
  for (const [index, row] of contexts.entries()) {
    assert.deepEqual(without(row, ['bundle', 'bundle_hash']), without(beforeContexts[index], ['bundle', 'bundle_hash']));
    assert.equal(row.bundle.planning.consent_enabled, undefined);
    assert.equal(row.bundle.feedback.consent_revision, undefined);
    await assertCurrentProjection(row.bundle);
  }
});

test('retired sharing APIs, columns and dashboard setting patches are unavailable', () => {
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_search_adaptive_settings' AND column_name IN('structured_feedback_enabled','consent_revision','consent_updated_at');"), '0');
  assert.equal(sql("SELECT to_regprocedure('public.read_opportunity_feedback_settings(uuid)') IS NULL AND to_regprocedure('public.set_opportunity_feedback_consent(uuid,boolean)') IS NULL;"), 't');
  const action = randomUUID();
  assert.throws(() => sql(actor(owner, `SELECT public.patch_opportunity_search_settings('${disabledSearch}','${action}','{"structured_feedback_enabled":false}','{"consent_revision":0}')`)), /Invalid settings patch/);
  const current = query(actor(owner, `SELECT public.opportunity_search_dashboard_settings('${owner}','${disabledSearch}')`));
  assert.equal(current.structured_feedback_enabled, undefined); assert.equal(current.consent_revision, undefined);
});

test('default feedback remains owner-scoped and excludes contacts, notes and other owners', () => {
  const own = packet(disabledSearch), other = packet(otherSearch, otherOwner);
  assert.deepEqual(other.examples.map((row: any) => row.opportunity_id), [otherOpportunity]);
  for (const canary of ['PRIVATE APPLICATION CANARY', 'EXCLUDED APPLICATION CANARY', 'Other owner evaluation.', 'Excluded private evaluation.']) assert.equal(JSON.stringify(own).includes(canary), false);
  assert.throws(() => packet(disabledSearch, otherOwner), /Search unavailable/);
  assert.throws(() => query(actor(owner, `SELECT public.project_opportunity_feedback_preview('${otherOwner}','${otherOpportunity}')`)), /Feedback unavailable/);
  assert.throws(() => query(actor(owner, `SELECT public.build_opportunity_search_feedback('${owner}','${disabledSearch}')`, true)), /signed-in|Feedback unavailable/);
});

test('per-opportunity exclusion removes all feedback across searches and redacts old pinned packets', () => {
  for (const search of [disabledSearch, pausedSearch]) sql(`SELECT private.compile_opportunity_feedback_snapshot('${owner}','${search}');`);
  const previous = query(`SELECT to_jsonb(r) FROM public.opportunity_reviews r WHERE user_id='${owner}' AND opportunity_id='${included}';`);
  query(actor(owner, `SELECT public.save_opportunity_feedback('${included}','{"feedback_excluded":true}')`));
  for (const search of [disabledSearch, pausedSearch, freshSearch]) assert.deepEqual(packet(search).examples.map((row: any) => row.opportunity_id), [submitted]);
  const current = query(`SELECT to_jsonb(r) FROM public.opportunity_reviews r WHERE user_id='${owner}' AND opportunity_id='${included}';`);
  assert.equal(current.comment, previous.comment); assert.equal(current.interest_rating, 0); assert.deepEqual(current.interest_reasons, previous.interest_reasons);
  assert.equal(current.evaluation_revision, previous.evaluation_revision);
  const pinned = query(`SELECT jsonb_agg(packet) FROM public.opportunity_search_feedback_snapshots WHERE user_id='${owner}';`);
  for (const snapshot of pinned) assert.equal(snapshot.examples.some((row: any) => row.opportunity_id === included), false);
  query(actor(owner, `SELECT public.save_opportunity_feedback('${included}','{"feedback_excluded":false}')`));
  assert.equal(packet(disabledSearch).examples.some((row: any) => row.opportunity_id === included), true);
});

test('adaptation enable and pause choices never change raw feedback or its input fingerprint', () => {
  const suggestion = randomUUID();
  query(actor(owner, `SELECT public.propose_opportunity_search_preference('${freshSearch}','${suggestion}',
    '${JSON.stringify({ rule_id: randomUUID(), kind: 'emphasis', category: 'topic', polarity: 'positive', target: 'Acoustics', evidence_refs: [] })}');
    SELECT public.decide_opportunity_search_preference('${freshSearch}','${suggestion}','approve',0,'${randomUUID()}')`));
  const original = query(`SELECT private.compile_opportunity_feedback_snapshot('${owner}','${freshSearch}');`);
  assert.equal(original.approved_preferences.length, 1, 'Approved owner context is raw feedback, independently of adaptation');
  query(actor(owner, `SELECT public.save_opportunity_search_adaptation('${freshSearch}',true,false,0)`));
  const enabled = packet(freshSearch);
  query(actor(owner, `SELECT public.save_opportunity_search_adaptation('${freshSearch}',true,true,1)`));
  const paused = packet(freshSearch);
  query(actor(owner, `SELECT public.save_opportunity_search_adaptation('${freshSearch}',false,false,2)`));
  const disabled = packet(freshSearch);
  for (const current of [enabled, paused, disabled]) {
    assert.equal(current.input_fingerprint, original.input_fingerprint);
    assert.deepEqual(current.examples, original.examples); assert.deepEqual(current.aggregates, original.aggregates);
    assert.deepEqual(current.approved_preferences, original.approved_preferences);
  }
});

test('adaptation controls planning without suppressing feedback in a real startup bundle', async () => {
  sql(`UPDATE public.opportunity_search_adaptive_release SET enabled=true WHERE singleton;`);
  for (const [search, revision] of [[disabledSearch, 2], [pausedSearch, 0]] as const) {
    sql(actor(owner, `SELECT public.set_opportunity_search_runner_authorization('${search}','${project}',true,${revision})`));
    const run = randomUUID(), started = query(`SELECT private.begin_adaptive_opportunity_search('${search}','${run}');`);
    assert.equal(started.compatible, true, JSON.stringify(started));
    assert.equal(started.planning.enabled, false);
    assert.equal(started.planning.allocation.adaptive, 0); assert.equal(started.planning.allocation.exploration, 0);
    assert.ok(started.feedback.examples.some((row: any) => row.opportunity_id === included));
    assert.equal(started.feedback.consent_revision, undefined); assert.equal(started.planning.consent_enabled, undefined);
    await assertCurrentProjection(started);
    const retry = query(`SELECT private.begin_adaptive_opportunity_search('${search}','${run}');`);
    assert.deepEqual(retry, started, 'Positive default feedback must not spuriously redact an inactive-adaptation retry');
    query(`SELECT private.refresh_adaptive_execution_scope('${run}');`);
    assert.equal(sql(`SELECT privacy_redacted FROM private.opportunity_search_adaptive_contexts WHERE run_id='${run}';`), 'f');
    assert.equal(retry.refresh.privacy_scope_changed, false);
    sql(`UPDATE public.opportunity_search_runs SET status='complete',completed_at=clock_timestamp() WHERE id='${run}';`);
  }
});
