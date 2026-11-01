import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reactive } from 'vue';
import { ADAPTIVE_BATCH_CAPABILITIES } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { ADAPTIVE_STARTUP_MANIFEST_SQL_TEMPLATE, ADAPTIVE_STARTUP_PAGE_SQL_TEMPLATE } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';
import { ADAPTIVE_RECURRING_PROMPT_TEMPLATE, buildAdaptiveRecurringSearchPrompt, loadAdaptiveSearchRunnerState, readAdaptiveSearchRunnerState, requestAdaptiveSearchRunner,
  usesAdaptiveSearchRunner, type AdaptiveSearchRunnerState } from '../../../src/features/meta-search/domain/adaptiveSearchTask';
import { buildRecurringSearchPrompt, buildReplaceSearchPrompt, buildSearchSetupReadSql, buildSearchSystemPrompt, buildSearchUserPrompt } from '../../../src/features/meta-search/domain/searchPrompts';
import { saveSearchTemplate, searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../../../src/features/meta-search/data/searchTemplateCloud';
import { DEFAULT_SEARCH_TEMPLATES, searchTemplateContentKey } from '../../../src/features/meta-search/data/searchTemplateRepository';
import { OPPORTUNITY_TOPIC_FORMAT_RULE } from '../../../src/features/opportunities/domain/opportunityTopics';

const owner = '91000000-0000-4000-8000-000000000001';
const search = '91000000-0000-4000-8000-000000000002';
const setup = '91000000-0000-4000-8000-000000000003';
const project = 'bbbbbbbbbbbbbbbbbbbb';
const binding = { task_id: 'synthetic-existing-task', schedule: { frequency: 'daily' as const, intervalHours: 1, weekdays: [], time: '09:00', timezone: 'UTC', runImmediately: true }, runner_capability: null };
function runner(patch: Partial<AdaptiveSearchRunnerState> = {}): AdaptiveSearchRunnerState {
  return { setup_contract_version: 1, user_id: owner, search_id: search, project_ref: project, revision: 1,
    mode: 'legacy', migration_requested: true, ready: true, readiness_code: 'ready', setup_id: setup, binding, ...patch };
}
function template() {
  const value = structuredClone(DEFAULT_SEARCH_TEMPLATES[0]!);
  return { ...value, cloud: { id: search, revision: 1, contentKey: searchTemplateContentKey(value) } };
}
function client(response: unknown, error: unknown = null) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return { calls, value: { rpc: async (name: string, args: unknown) => { calls.push({ name, args: structuredClone(args) }); return { data: response, error }; },
    from: () => { throw new Error('No table reads or fallback transport'); } } as unknown as SupabaseClient };
}

test('AF09 adaptive daily task text is byte-stable across current data revisions and contains only fixed helpers', () => {
  const original = template(), state = runner();
  const expected = buildAdaptiveRecurringSearchPrompt(search, project);
  assert.equal(buildRecurringSearchPrompt(original, { projectId: project, runner: state }), expected);
  const next = { ...original, name: 'Changed owner label', researchInterests: 'BCI; acoustics; new methods', fundingConditions: 'Different funding',
    userPrompt: 'PRIVATE_CANARY; SELECT * FROM applications; replace every task now', revision: 99, dailyTime: '17:34' };
  next.cloud = { ...next.cloud!, contentKey: searchTemplateContentKey(next) };
  const revisedState = runner({ revision: 98, mode: 'adaptive', setup_id: null, migration_requested: false,
    binding: { ...binding, runner_capability: ADAPTIVE_BATCH_CAPABILITIES.capability_version } });
  assert.equal(buildRecurringSearchPrompt(next, { projectId: project, runner: revisedState }), expected);
  assert.equal(buildSearchSystemPrompt(next, { projectId: project, runner: revisedState }), `${expected}\n\n${OPPORTUNITY_TOPIC_FORMAT_RULE}`);
  assert.ok(buildSearchUserPrompt(next, { projectId: project, runner: revisedState }).includes('PRIVATE_CANARY'));
  for (const required of ['private.begin_adaptive_opportunity_search', 'private.submit_adaptive_search_batch', 'private.verify_and_complete_adaptive_search',
    '72 hours', 'unchanged or empty runs stay quiet', 'at most once', 'full sorted batch manifest', 'Notification delivery remains unknown']) assert.ok(expected.includes(required), required);
  for (const forbidden of ['PRIVATE_CANARY', owner, setup, binding.task_id, 'private.begin_opportunity_search(', 'private.read_adaptive_search_setup', 'private.ack_adaptive_search_setup']) assert.ok(!expected.includes(forbidden), forbidden);
  assert.ok(expected.includes(search) && expected.includes(project));
});

test('AF09 legacy mode remains legacy until explicit migration and an unavailable adaptive mode never downgrades', () => {
  const original = template();
  for (const state of [undefined, null, runner({ migration_requested: false, setup_id: null })]) {
    assert.ok(buildRecurringSearchPrompt(original, { projectId: project, runner: state }).includes('private.begin_opportunity_search('));
  }
  assert.throws(() => buildRecurringSearchPrompt(original, { projectId: project, runner: runner({ ready: false, readiness_code: 'runner_disabled' }) }), /unavailable.*runner_disabled/);
  assert.throws(() => usesAdaptiveSearchRunner(runner({ search_id: setup }), search, project), /another search/);
  assert.throws(() => usesAdaptiveSearchRunner(runner({ project_ref: 'cccccccccccccccccccc' }), search, project), /another search/);
  original.userPrompt += '; pending unsaved draft';
  assert.ok(buildSearchSystemPrompt(original, { projectId: project, runner: runner() }).includes('EXECUTION NOT READY'));
  assert.throws(() => buildReplaceSearchPrompt(original, { projectId: project, runner: runner() }), /Save the current/);
});

test('adaptive runner uses bounded fixed startup projections within the existing helper allowlist', () => {
  const value = buildAdaptiveRecurringSearchPrompt(search, project);
  for (const sql of [ADAPTIVE_STARTUP_MANIFEST_SQL_TEMPLATE, ADAPTIVE_STARTUP_PAGE_SQL_TEMPLATE]) {
    assert.ok(value.includes(sql.replaceAll('{{search_id}}', search)), 'the exact reviewed transport SQL must reach the task');
    assert.equal((sql.match(/private\.begin_adaptive_opportunity_search\(/gu) || []).length, 1, 'one helper invocation per startup statement');
    assert.match(sql, /MATERIALIZED/u);
  }
  assert.deepEqual([...new Set([...value.matchAll(/private\.([a-z_]+)\(/gu)].map(match => match[1]))].sort(),
    ['begin_adaptive_opportunity_search', 'submit_adaptive_search_batch', 'verify_and_complete_adaptive_search']);
  assert.ok(value.length <= 9_500, 'keep the recurring handoff within its local prompt budget');
  assert.ok(value.indexOf('LOCAL PREFLIGHT:') < value.indexOf('MANIFEST:'), 'persistent local storage is checked before a run is claimed');
  assert.ok(value.includes('never print the whole bundle'), 'local inspection must stay bounded after truncation');
  assert.ok(value.includes('2+N+B calls'), 'ordinary page reads are part of the stated budget');
  assert.ok(!value.includes('three calls for one batch'));
  assert.ok(!value.includes('private.read_opportunity_search_run'), 'paging must not add an unrelated read helper');
});

test('database setup and frontend generate the same reviewed adaptive recurring prompt', () => {
  const sql = readFileSync(new URL('../../../supabase/schemas/12_search_support.sql', import.meta.url), 'utf8');
  const template = /\$adaptive_recurring\$([\s\S]+?)\$adaptive_recurring\$/u.exec(sql)?.[1];
  assert.equal(template, ADAPTIVE_RECURRING_PROMPT_TEMPLATE);
});

test('AF09 setup has one bounded read followed only by receipt acknowledgement and exact approved targets', () => {
  const value = buildReplaceSearchPrompt(template(), { projectId: project, runner: runner() });
  assert.ok(value.includes(`private.read_adaptive_search_setup('${search}'::uuid, '${setup}'::uuid, '${project}'::text)`));
  assert.equal((value.match(/SELECT /gu) || []).length, 2, 'one handoff read plus one explicitly setup-only acknowledgement');
  assert.ok(value.includes('private.ack_adaptive_search_setup') && value.includes('actual returned task ID and schedule'));
  assert.ok(value.includes("handoff's reviewed recurringPrompt"));
  assert.ok(value.includes(buildSearchSetupReadSql(search, setup, project)));
  for (const required of ['Decode the received connector response locally', 'standalone boundary lines', 'exactly one SQL row',
    'one additional identical handoff read', 'Do not retry an invalid contract', 'target.kind=selection_required']) assert.ok(value.includes(required), required);
  for (const required of ['explicit setup approval', 'exact bound task ID', 'real successful task-tool receipt', 'separately approved exact superseded IDs', 'leave unrelated tasks untouched', 'at most once']) assert.ok(value.includes(required), required);
  for (const forbidden of ['begin_opportunity_search(', 'begin_adaptive_opportunity_search(', 'meta_search -', 'update and enable the bound task, or find', 'create only if none exists']) assert.ok(!value.includes(forbidden), forbidden);
});

test('setup recovery keeps the independently loaded pending claim ahead of a new clipboard identity', () => {
  const state = runner({ migration_requested: false, ready: false, readiness_code: 'release_disabled', binding: null });
  const value = buildReplaceSearchPrompt(template(), { projectId: project, runner: state, setupId: owner });
  assert.ok(value.includes(buildSearchSetupReadSql(search, setup, project)));
  assert.ok(!value.includes(`'${owner}'::uuid`));
  assert.throws(() => buildSearchSetupReadSql(search, "not-a-uuid'", project), /exact saved search UUID/);
});

test('AF09 independently loaded runner state validates owner, scope, schedule and finite revisions', () => {
  assert.deepEqual(readAdaptiveSearchRunnerState(runner(), owner, search, project), runner());
  for (const patch of [{ user_id: setup }, { search_id: setup }, { project_ref: 'cccccccccccccccccccc' }, { revision: -1 }, { revision: Infinity },
    { mode: 'arbitrary' }, { setup_contract_version: 2 }, { binding: { ...binding, task_id: '\nprivate@example.invalid' } },
    { binding: { ...binding, schedule: { ...binding.schedule, timezone: 'Unspecified/Invalid' } } }, { setup_id: 'bad' }]) {
    assert.throws(() => readAdaptiveSearchRunnerState({ ...runner(), ...patch }, owner, search, project), /does not match/);
  }
});

test('AF09 runner projection accepts Vue proxies and retains only independent fixed fields', () => {
  const input = reactive({ ...runner(), private_payload: 'PRIVATE_CACHE_CANARY', binding: { ...binding,
    private_payload: 'PRIVATE_BINDING_CANARY', schedule: { ...binding.schedule, weekdays: [1, 2], private_payload: 'PRIVATE_SCHEDULE_CANARY' } } });
  const projected = readAdaptiveSearchRunnerState(input, owner, search, project);
  assert.ok(!JSON.stringify(projected).includes('PRIVATE_'));
  assert.deepEqual(projected.binding!.schedule.weekdays, [1, 2]);
  input.binding.schedule.weekdays.push(3);
  assert.deepEqual(projected.binding!.schedule.weekdays, [1, 2]);
});

test('AF09 readiness uses one owner-checked RPC and missing helpers cannot select another runner mode', async () => {
  const fixture = client(runner());
  assert.deepEqual(await loadAdaptiveSearchRunnerState(fixture.value, owner, search, project), runner());
  assert.deepEqual(fixture.calls, [{ name: 'read_adaptive_search_readiness', args: { p_search_id: search, p_project_ref: project } }]);
  for (const code of ['PGRST202', '42883']) {
    const missing = client(null, { code });
    await assert.rejects(loadAdaptiveSearchRunnerState(missing.value, owner, search, project), { code });
    assert.equal(missing.calls.length, 1);
  }
  const lost = client(null, new Error('Network unavailable'));
  await assert.rejects(loadAdaptiveSearchRunnerState(lost.value, owner, search, project), /Network unavailable/);
  assert.equal(lost.calls.length, 1);
  await assert.rejects(loadAdaptiveSearchRunnerState(client(runner({ user_id: setup })).value, owner, search, project), /signed-in owner/);
});

test('AF09 explicit migration request pins its setup identity and never fabricates acknowledgement on failure', async () => {
  const fixture = client(runner());
  assert.deepEqual(await requestAdaptiveSearchRunner(fixture.value, owner, search, project, 0, setup), runner());
  assert.deepEqual(fixture.calls[0], { name: 'request_adaptive_search_migration', args: { p_search_id: search, p_project_ref: project, p_expected_revision: 0, p_setup_id: setup } });
  await requestAdaptiveSearchRunner(fixture.value, owner, search, project, 0, setup);
  assert.deepEqual(fixture.calls[0], fixture.calls[1], 'a lost response retry with stored setup identity is exact');
  await assert.rejects(requestAdaptiveSearchRunner(client(runner({ migration_requested: false })).value, owner, search, project, 0, setup), /did not acknowledge/);
  await assert.rejects(requestAdaptiveSearchRunner(client(runner({ setup_id: search })).value, owner, search, project, 0, setup), /did not acknowledge/);
  await assert.rejects(requestAdaptiveSearchRunner(client(null, new Error('Permission denied')).value, owner, search, project, 0, setup), /Permission denied/);
});

test('AF09 cloud autosave keeps one RPC, preserves explicit mode and rejects owner drift before a write', async () => {
  const original = template(), calls: Array<Record<string, unknown>> = [];
  const save = { from: () => { throw new Error('No read chain during autosave'); }, rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'save_opportunity_meta_search'); calls.push(structuredClone(args));
    return { error: null, data: { id: search, user_id: owner, name: args.p_name, criteria: args.p_criteria, schedule: args.p_schedule,
      meta_search: args.p_meta_search, revision: 2, created_at: original.updatedAt, updated_at: original.updatedAt } };
  } } as unknown as SupabaseClient;
  await saveSearchTemplate(save, owner, original, { projectId: project, runner: runner() });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.p_criteria, searchTemplateCloudCriteria(original));
  assert.deepEqual(calls[0]!.p_schedule, searchTemplateCloudSchedule(original));
  const doc = calls[0]!.p_meta_search as { version: number; recurringPrompt: string };
  assert.equal(doc.version, 1); assert.equal(doc.recurringPrompt, buildAdaptiveRecurringSearchPrompt(search, project));
  await assert.rejects(saveSearchTemplate(save, owner, original, { projectId: project, runner: runner({ user_id: setup }) }), /signed-in owner/);
  assert.equal(calls.length, 1);
});
