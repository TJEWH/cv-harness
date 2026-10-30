import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { ADAPTIVE_RELEASE_MIGRATIONS } from '../../scripts/adaptiveSearchRelease';
import { createSearchBreadthPolicy } from '../../src/features/meta-search/domain/adaptiveSearchPlanner';
import { file, reset, sql } from './db';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const project = 'cccccccccccccccccccc';
const cadence = { frequency: 'daily', intervalHours: 24, weekdays: [], time: '09:00', timezone: 'UTC', runImmediately: false };
const object = (output: string): any => output.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(value => value && typeof value === 'object').at(-1);
const actor = (owner: string, body: string) => `select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,false);set role authenticated;${body};reset role;`;
function fixture() {
  const owner = randomUUID(), search = randomUUID(), opportunity = randomUUID();
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(${quote(search)},${quote(owner)},'Synthetic inclusion','{"topicsAndMethods":"Acoustics; Robotics"}',${json(cadence)});
    insert into public.opportunities(id,opportunity_key,title,institution,topics,deadline) values(${quote(opportunity)},${quote('synthetic-inclusion-'+opportunity)},'Synthetic research project','Synthetic University',array['Acoustics'],'2028-01-01');`);
  return { owner, search, opportunity };
}

test('Additive feedback inclusion preserves existing text, catalogue data and all private helper grants', () => {
  reset({ searchProtocol: true });
  for (const path of ADAPTIVE_RELEASE_MIGRATIONS) if (path !== 'opportunity_feedback_inclusion.sql') sql(file(`../../supabase/${path}`));
  const { owner, search, opportunity } = fixture(), legacyRun = randomUUID();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,comment,search_feedback_summary) values(${quote(owner)},${quote(opportunity)},'Existing evaluation.','Existing distinct feedback.');`);
  sql(`update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;`);
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true);
    select public.save_opportunity_search_adaptation(${quote(search)},true,false,0);
    select public.approve_opportunity_feedback_summary(${quote(opportunity)},
      (select search_feedback_summary_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}),
      (select search_feedback_source_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}),
      (select search_feedback_revision from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}));
    select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0)`));
  const pinned = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(legacyRun)});`));
  assert.equal(pinned.compatible,true);assert.equal(pinned.planning.policy.policy_version,'adaptive-query-v2');
  const previouslyRedacted = fixture(), redactedRun = randomUUID();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,comment,search_feedback_summary)
    values(${quote(previouslyRedacted.owner)},${quote(previouslyRedacted.opportunity)},'Old evaluation.','Old approved feedback.');`);
  sql(actor(previouslyRedacted.owner, `select public.set_opportunity_feedback_consent(${quote(previouslyRedacted.search)},true);
    select public.save_opportunity_search_adaptation(${quote(previouslyRedacted.search)},true,false,0);
    select public.approve_opportunity_feedback_summary(${quote(previouslyRedacted.opportunity)},
      (select search_feedback_summary_hash from public.opportunity_reviews where user_id=${quote(previouslyRedacted.owner)}),
      (select search_feedback_source_hash from public.opportunity_reviews where user_id=${quote(previouslyRedacted.owner)}),
      (select search_feedback_revision from public.opportunity_reviews where user_id=${quote(previouslyRedacted.owner)}));
    select public.set_opportunity_search_runner_authorization(${quote(previouslyRedacted.search)},${quote(project)},true,0)`));
  sql(`select private.begin_adaptive_opportunity_search(${quote(previouslyRedacted.search)},${quote(redactedRun)});`);
  sql(actor(previouslyRedacted.owner, `select public.revoke_opportunity_feedback_summary(${quote(previouslyRedacted.opportunity)})`));
  const priorRedacted = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(previouslyRedacted.search)},${quote(redactedRun)});`));
  assert.equal(priorRedacted.feedback.examples[0].search_feedback_summary,undefined);
  assert.ok(priorRedacted.feedback.examples[0].summary_approval,'Baseline no longer reproduces its historical orphan proof');
  const before = sql(`select to_jsonb(r) from public.opportunity_reviews r where user_id=${quote(owner)};`);
  const catalogue = sql("select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,'')) from public.opportunities o;");
  const acl = sql("select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'seed_opportunity_institution_sources';");
  sql(file('../../supabase/opportunity_feedback_inclusion.sql'));
  assert.equal(sql(`select to_jsonb(r)-array['manually_archived','technical_issue_category','technical_issue_note'] from public.opportunity_reviews r where user_id=${quote(owner)};`), before);
  assert.equal(sql("select md5(coalesce(jsonb_agg(to_jsonb(o) order by id)::text,'')) from public.opportunities o;"), catalogue);
  assert.equal(sql("select md5(string_agg(p.oid::regprocedure::text||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'seed_opportunity_institution_sources';"), acl);
  assert.equal(sql("select has_function_privilege('authenticated','private.seed_opportunity_institution_sources(uuid,uuid)','execute');"),'f');
  const cleaned = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(previouslyRedacted.search)},${quote(redactedRun)});`));
  assert.equal(cleaned.compatible,true,JSON.stringify(cleaned));
  assert.equal(cleaned.feedback.examples[0].search_feedback_summary,undefined);
  assert.equal(cleaned.feedback.examples[0].summary_approval,undefined);
  assert.equal(cleaned.refresh.privacy_scope_changed,true);
  const retried = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(legacyRun)});`));
  assert.deepEqual(retried,pinned,'An installed inclusion policy rewrote a historical v2 run');
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)};`),'0','A historical retry seeded new source configuration');
  assert.equal(pinned.feedback.examples[0].search_feedback_summary,'Existing distinct feedback.');
  assert.ok(pinned.feedback.examples[0].summary_approval);
  sql(actor(owner, `select public.revoke_opportunity_feedback_summary(${quote(opportunity)})`));
  const withdrawn = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(legacyRun)});`));
  assert.equal(withdrawn.compatible,true,JSON.stringify(withdrawn));
  assert.equal(withdrawn.feedback.examples[0].search_feedback_summary,undefined,'A revoked legacy approval remained visible');
  assert.equal(withdrawn.refresh.privacy_scope_changed,true);
});

test('Default text inclusion shares safe exact excerpts without approval or data truncation', () => {
  const { owner, search, opportunity } = fixture();
  const complete = 'Experimental sensing and robotics. '.repeat(30);
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,comment) values(${quote(owner)},${quote(opportunity)},${quote(complete)});`);
  const defaultOff = object(sql(actor(owner, `select public.preview_opportunity_search_feedback(${quote(search)})`)));
  assert.deepEqual(defaultOff.examples, []);
  const packet = object(sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true);select public.save_opportunity_search_adaptation(${quote(search)},true,false,0);select public.preview_opportunity_search_feedback(${quote(search)})`)));
  assert.equal(packet.examples.length, 1);
  const row = packet.examples[0];
  assert.equal(row.search_feedback_summary, complete.slice(0,600));
  assert.deepEqual(row.summary_inclusion, { policy_version:'included-unless-excluded-v1', summary_hash:digest(complete.slice(0,600)), source_hash:digest(complete), summary_revision:1, truncated:true, source_length:complete.length });
  assert.equal(row.summary_approval, undefined);
  assert.equal(row.interest_score, null, 'feedback prose must not invent an interest score');
  assert.equal(sql(`select comment from public.opportunity_reviews where user_id=${quote(owner)};`), complete.trimEnd());
  assert.equal(sql(`select search_feedback_approved_at is null from public.opportunity_reviews where user_id=${quote(owner)};`),'t');
  assert.equal(sql(`select private.opportunity_search_adaptive_shape('example',${json(row)});`),'t');
});

test('Full-source safety and explicit exclusion protect outgoing text and whole feedback', () => {
  const { owner, search, opportunity } = fixture();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating,comment) values(${quote(owner)},${quote(opportunity)},8,${quote('Safe research interests. '.repeat(32)+' private@example.invalid')});`);
  let row = object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)));
  assert.equal(row.search_feedback_summary, undefined, 'a contact after the excerpt boundary was ignored');
  assert.equal(row.summary_inclusion, undefined);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":true}')`));
  assert.equal(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)}) is null`)).split('\n').at(-1), 't');
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true)`));
  const packet = object(sql(actor(owner, `select public.preview_opportunity_search_feedback(${quote(search)})`)));
  assert.equal(packet.examples.length,0);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":false}')`));
  row = object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)));
  assert.equal(row.interest_score,8);
});

test('Manual past and technical outcomes stay owner-scoped and never modify deadlines or interest', () => {
  const { owner, opportunity } = fixture();
  const before = sql(`select to_jsonb(o) from public.opportunities o where id=${quote(opportunity)};`);
  const row = object(sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"manually_archived":true,"technical_issue_category":"requirements","technical_issue_note":"PRIVATE_TECHNICAL_NOTE"}')`)));
  assert.equal(row.manually_archived,true); assert.equal(row.technical_issue_note,'PRIVATE_TECHNICAL_NOTE');
  const projected = object(sql(actor(owner, `select public.project_opportunity_feedback_preview(${quote(owner)},${quote(opportunity)})`)));
  assert.equal(projected.manually_archived,true); assert.equal(projected.technical_issue_category,'requirements');
  assert.equal(projected.interest_score,null); assert.equal(projected.technical_issue_note,undefined);
  assert(!JSON.stringify(projected).includes('PRIVATE_TECHNICAL_NOTE'));
  assert.equal(sql(`select to_jsonb(o) from public.opportunities o where id=${quote(opportunity)};`),before);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"technical_issue_category":"invented"}')`)),/technical issue/i);
  assert.throws(() => sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},${json({ technical_issue_note:'x'.repeat(1001) })})`)),/1000/);
  assert.throws(() => sql(actor(owner, `update public.opportunity_reviews set technical_issue_category='invented' where opportunity_id=${quote(opportunity)}`)),/check constraint/);
  const other = fixture();
  sql(actor(other.owner, `update public.opportunity_reviews set manually_archived=false where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}`));
  assert.equal(sql(`select manually_archived from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)};`),'t');
  assert.equal(object(sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"manually_archived":false}')`))).manually_archived,false);
  assert.equal(sql(`select interest_rating is null from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)};`),'t');
});

test('Current text changes redact pinned excerpts and exclusion cannot restore old snapshots', () => {
  const { owner, search, opportunity } = fixture();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating,comment) values(${quote(owner)},${quote(opportunity)},8,'Original feedback for physical prototypes.');`);
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true);select public.save_opportunity_search_adaptation(${quote(search)},true,false,0)`));
  const first = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`));
  assert.equal(first.examples[0].search_feedback_summary,'Original feedback for physical prototypes.');
  sql(actor(owner, `select public.save_opportunity_comment(${quote(opportunity)},'Updated feedback for acoustic experiments.')`));
  const redacted = JSON.parse(sql(`select packet from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)} and search_id=${quote(search)} and feedback_revision=${first.feedback_revision};`));
  assert.equal(redacted.privacy_scope_changed,true);
  assert.equal(redacted.examples[0].search_feedback_summary,undefined);
  assert.equal(redacted.examples[0].summary_inclusion,undefined);
  const next = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`));
  assert.equal(next.examples[0].search_feedback_summary,'Updated feedback for acoustic experiments.');
  assert.notEqual(next.input_fingerprint,first.input_fingerprint);
  sql(actor(owner, `select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":true}');select public.save_opportunity_feedback(${quote(opportunity)},'{"feedback_excluded":false}')`));
  const old = JSON.parse(sql(`select packet from public.opportunity_search_feedback_snapshots where user_id=${quote(owner)} and search_id=${quote(search)} and feedback_revision=${next.feedback_revision};`));
  assert.deepEqual(old.examples,[]);
});

test('Institution cohorts remain diagnostics and new policies preserve historical validation', () => {
  const { owner, search, opportunity } = fixture();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,interest_rating) values(${quote(owner)},${quote(opportunity)},9);`);
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true);select public.save_opportunity_search_adaptation(${quote(search)},true,false,0)`));
  const packet = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot(${quote(owner)},${quote(search)});`));
  packet.aggregates.groups = [{ kind:'institution', key:'synthetic university', count:12, scored:12, score_sum:108, mean_interest:9 }];
  const planning = JSON.parse(sql(`select private.opportunity_search_planning_context(${quote(owner)},${quote(search)},${json(packet)},null);`));
  assert.equal(planning.priorities[0].direction,'examples_only'); assert.equal(planning.priorities[0].reason,'source_only');
  assert.equal(planning.priorities[0].mean_interest,9);
  for (let percent=0;percent<=100;percent+=5) {
    const policy = JSON.parse(sql(`select public.opportunity_search_adaptation_policy(${percent});`));
    assert.deepEqual(policy,createSearchBreadthPolicy(percent));
    assert.equal(sql(`select private.opportunity_search_adaptive_shape('policy',${json(policy)});`),'t');
    const legacy = { ...policy, policy_version:'adaptive-query-v2' }; delete legacy.institution_policy; delete legacy.institution_guidance;
    assert.equal(sql(`select private.opportunity_search_adaptive_shape('policy',${json(legacy)});`),'t');
  }
});

test('Authorized startup retains neutral institution listings once and reports bounded omissions', () => {
  const { owner, search } = fixture(), run = randomUUID();
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)};`),'0');
  const unavailable = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.equal(unavailable.compatible,false);
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)};`),'0','An unauthorized startup seeded sources');
  sql(`update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;`);
  sql(actor(owner, `select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0)`));
  const started = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.equal(started.compatible,true,JSON.stringify(started));
  assert.deepEqual(started.source_retention,{requested:7,retained:7,omitted:0});
  assert.equal(started.due_sources.length,7);
  assert.equal(sql(`select bool_and(priority=50 and not pinned and not mandatory and provenance='explicit' and listing_verified_at is null) from public.opportunity_search_sources where user_id=${quote(owner)};`),'t');
  const source = JSON.parse(sql(`select to_jsonb(s) from public.opportunity_search_sources s where user_id=${quote(owner)} order by listing_url limit 1;`));
  sql(actor(owner, `select public.save_opportunity_search_source(${quote(search)},${quote(source.registry_id)},'{"enabled":false,"priority":17,"check_interval_hours":48}')`));
  sql(`select private.seed_opportunity_institution_sources(${quote(owner)},${quote(search)});`);
  const unchanged = JSON.parse(sql(`select to_jsonb(s) from public.opportunity_search_sources s where registry_id=${quote(source.registry_id)};`));
  assert.equal(unchanged.enabled,false);assert.equal(unchanged.priority,17);assert.equal(unchanged.check_interval_hours,48);
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(owner)};`),'7');
  assert.throws(() => sql(actor(owner, `select private.seed_opportunity_institution_sources(${quote(owner)},${quote(search)})`)),/permission denied/i);
  const full = fixture();
  sql(`insert into public.opportunity_search_sources(user_id,search_id,listing_url,enabled,provenance,status)
    select ${quote(full.owner)},${quote(full.search)},'https://example.invalid/listing/'||n,true,'explicit','ready' from generate_series(1,62)n;`);
  const retained = JSON.parse(sql(`select private.seed_opportunity_institution_sources(${quote(full.owner)},${quote(full.search)});`));
  assert.deepEqual(retained,{requested:7,retained:2,omitted:5});
  assert.equal(sql(`select count(*) from public.opportunity_search_sources where user_id=${quote(full.owner)};`),'64');
  const dashboard = object(sql(actor(full.owner, `select public.read_opportunity_search_dashboard(${quote(full.search)},${quote(project)})`)));
  assert.equal(dashboard.settings.institution_sources_omitted,5);
});

test('Legacy approval APIs cannot revoke or pause a current default-inclusion run', () => {
  const { owner, search, opportunity } = fixture(), run=randomUUID();
  sql(`insert into public.opportunity_reviews(user_id,opportunity_id,comment,search_feedback_summary)
    values(${quote(owner)},${quote(opportunity)},'Current shared research feedback.','Current shared research feedback.');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref=${quote(project)} where singleton;`);
  const approve = `select public.approve_opportunity_feedback_summary(${quote(opportunity)},
    (select search_feedback_summary_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}),
    (select search_feedback_source_hash from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}),
    (select search_feedback_revision from public.opportunity_reviews where user_id=${quote(owner)} and opportunity_id=${quote(opportunity)}))`;
  sql(actor(owner, `select public.set_opportunity_feedback_consent(${quote(search)},true);select public.save_opportunity_search_adaptation(${quote(search)},true,false,0);
    ${approve};select public.set_opportunity_search_runner_authorization(${quote(search)},${quote(project)},true,0)`));
  const started = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.equal(started.compatible,true,JSON.stringify(started));
  assert.ok(started.feedback.examples[0].summary_inclusion);
  assert.equal(started.planning.enabled,true);
  sql(actor(owner, `select public.revoke_opportunity_feedback_summary(${quote(opportunity)})`));
  const revoked = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.deepEqual(revoked,started,'A deprecated approval withdrawal changed current default sharing');
  sql(actor(owner, approve));
  const approved = JSON.parse(sql(`select private.begin_adaptive_opportunity_search(${quote(search)},${quote(run)});`));
  assert.deepEqual(approved,started,'A deprecated approval action changed current default sharing');
});
