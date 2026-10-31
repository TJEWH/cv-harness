import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchCloudTemplate } from '../src/features/meta-search/searchTypes';
import { createSearchTemplate, createSearchTemplateRepository, DEFAULT_SEARCH_TEMPLATES, readSearchTemplate, searchTemplateContentKey } from '../src/features/meta-search/data/searchTemplateRepository';
import { buildRecurringSearchPrompt, buildReplaceSearchPrompt, buildSearchSystemPrompt, buildSearchUserPrompt, isSearchTemplateSaved, splitSearchEntries } from '../src/features/meta-search/domain/searchPrompts';
import { importCloudSearchTemplate, saveSearchTemplate, searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/features/meta-search/data/searchTemplateCloud';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
function template() { return clone(DEFAULT_SEARCH_TEMPLATES[0]!); }
function legacyTemplate() {
  return { id: 'legacy-search', name: 'Older meta search', revision: 3, updatedAt: '2026-10-28T09:00:00Z',
    professionalContext: 'PRIVATE RETIRED BACKGROUND', researchInterests: 'Shared acoustic research', locationPreferences: 'Prioritize Europe',
    userPrompt: 'Find funded PhDs from official university job pages.',
    profiles: [{ id: 'enabled', name: 'Acoustics', enabled: true, professionalContext: 'PRIVATE RETIRED PROJECTS', researchInterests: 'Robot audition', userPrompt: 'Prefer physical prototypes.' },
      { id: 'disabled', name: 'Disabled private direction', enabled: false, professionalContext: 'PRIVATE DISABLED CONTEXT', researchInterests: 'PRIVATE DISABLED INTERESTS', userPrompt: 'PRIVATE DISABLED STRATEGY' }],
    dailyTime: '09:00', timezone: 'Europe/Tirane' };
}
const owner = '11111111-1111-4111-8111-111111111111';
const cloudId = '22222222-2222-4222-8222-222222222222';

test('the single shared search isolates account storage, clones values and resets without an empty library', () => {
  const storage = memory(); const first = createSearchTemplateRepository(storage, owner); const second = createSearchTemplateRepository(storage, 'another-owner');
  const initial = first.listTemplates()[0]!; initial.userPrompt = 'My own search'; first.saveTemplate(initial);
  assert.notEqual(second.listTemplates()[0]!.userPrompt, initial.userPrompt);
  initial.userPrompt = 'Changed after save'; assert.notEqual(first.listTemplates()[0]!.userPrompt, initial.userPrompt);
  first.deleteTemplate(initial.id); assert.deepEqual(first.listTemplates(), DEFAULT_SEARCH_TEMPLATES);
});

test('search commits merge nonconflicting edits across tabs without advancing identical revisions', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner);
  const baseline = repository.listTemplates()[0]!;
  const latest = repository.saveTemplate({ ...baseline, userPrompt: 'Another tab’s strategy' }, baseline);
  const saved = repository.saveTemplate({ ...baseline, opportunityDescription: 'Industrial PhDs; official research institute portals' }, baseline);
  assert.equal(saved.userPrompt, latest.userPrompt); assert.equal(saved.opportunityDescription, 'Industrial PhDs; official research institute portals');
  assert.equal(saved.revision, latest.revision + 1);
  assert.deepEqual(repository.saveTemplate(saved, saved), saved);
  assert.throws(() => repository.saveTemplate({ ...baseline, userPrompt: 'Conflicting strategy' }, baseline), /another tab/);
});

test('failed storage writes preserve both the persisted snapshot and caller draft', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner); const baseline = repository.saveTemplate(template());
  const draft = { ...baseline, fundingConditions: 'Keep my unsaved funding conditions.' };
  storage.setItem = () => { throw new Error('Storage full'); };
  assert.throws(() => repository.saveTemplate(draft, baseline), /Storage full/);
  assert.equal(draft.fundingConditions, 'Keep my unsaved funding conditions.'); assert.equal(repository.listTemplates()[0]!.fundingConditions, baseline.fundingConditions);
});

test('import preserves only this account’s existing search binding and never creates another instance', () => {
  const storage = memory(); const repository = createSearchTemplateRepository(storage, owner);
  const original = template(); original.cloud = { id: cloudId, revision: 4, contentKey: searchTemplateContentKey(original) };
  repository.saveTemplate(original);
  const backup = JSON.parse(repository.exportTemplates());
  backup.templates[0].name = 'Restored research'; backup.templates[0].cloud.id = '33333333-3333-4333-8333-333333333333';
  const restored = repository.importTemplates(JSON.stringify(backup));
  assert.equal(restored.length, 1); assert.equal(restored[0]!.id, original.id); assert.deepEqual(restored[0]!.cloud, original.cloud);
  assert.equal(restored[0]!.name, 'Restored research'); assert.equal(isSearchTemplateSaved(restored[0]!), false);
  assert.equal(repository.listTemplates().length, 1);
});

test('old profile libraries merge enabled interests while archiving removed background and disabled profiles', () => {
  const storage = memory(); const old = legacyTemplate();
  const alternative = createSearchTemplate('BCI direction', 'Europe/Tirane'); alternative.researchInterests = 'Brain–computer interfaces'; alternative.locationPreferences = 'Prioritize Japan';
  const raw = JSON.stringify([old, alternative]); const key = `cv.search-templates.v1:${encodeURIComponent(owner)}`; storage.setItem(key, raw);
  const repository = createSearchTemplateRepository(storage, owner); const shared = repository.listTemplates()[0]!;
  assert.equal(shared.id, old.id); assert.equal(repository.listTemplates().length, 1);
  assert.ok(shared.researchInterests.includes('Robot audition') && shared.researchInterests.includes('Brain–computer interfaces'));
  assert.ok(shared.locationPreferences.includes('Prioritize Japan'));
  assert.ok(shared.opportunityDescription.includes(old.userPrompt)); assert.ok(shared.userPrompt.includes('Prefer physical prototypes.'));
  assert.equal('profiles' in shared, false); assert.equal('professionalContext' in shared, false);
  assert.ok(shared.legacySearchArchive?.includes('PRIVATE DISABLED CONTEXT'));
  for (const prompt of [buildSearchSystemPrompt(shared), buildSearchUserPrompt(shared), buildRecurringSearchPrompt(shared), JSON.stringify(searchTemplateCloudCriteria(shared))]) {
    assert.ok(!prompt.includes('PRIVATE RETIRED') && !prompt.includes('PRIVATE DISABLED'));
  }
  assert.equal(storage.getItem(key), raw, 'reading never changes saved private data');
  repository.saveTemplate({ ...shared, name: 'Shared search' }, shared);
  assert.equal(storage.getItem(`${key}:legacy-library`), raw); assert.equal(JSON.parse(storage.getItem(key)!).length, 1);
  assert.equal(repository.listTemplates()[0]!.legacySearchArchive, shared.legacySearchArchive);
});

test('a single old profile record is backed up before the first changed save', () => {
  const storage = memory(); const old = legacyTemplate(); const key = `cv.search-templates.v1:${encodeURIComponent(owner)}`;
  const raw = JSON.stringify([old]); storage.setItem(key, raw);
  const repository = createSearchTemplateRepository(storage, owner); const shared = repository.listTemplates()[0]!;
  repository.saveTemplate({ ...shared, fundingConditions: 'Fully funded; employee contract' }, shared);
  assert.equal(storage.getItem(`${key}:legacy-library`), raw);
  assert.ok(repository.listTemplates()[0]!.legacySearchArchive?.includes('PRIVATE RETIRED BACKGROUND'));
});

test('an inactive first search never contributes executable intent when a later search is active', () => {
  const storage = memory(); const first = { ...template(), active: false, researchInterests: 'DISABLED BCI', userPrompt: 'DISABLED STRATEGY', locationPreferences: 'DISABLED LOCATION' };
  const second = { ...createSearchTemplate(), researchInterests: 'ACTIVE acoustics', userPrompt: 'ACTIVE STRATEGY', locationPreferences: 'ACTIVE LOCATION' };
  storage.setItem(`cv.search-templates.v1:${encodeURIComponent(owner)}`, JSON.stringify([first, second]));
  const merged = createSearchTemplateRepository(storage, owner).listTemplates()[0]!;
  assert.equal(merged.id, first.id); assert.equal(merged.active, true);
  assert.equal(merged.researchInterests, second.researchInterests); assert.equal(merged.userPrompt, second.userPrompt); assert.equal(merged.locationPreferences, second.locationPreferences);
  assert.ok(merged.legacySearchArchive?.includes('DISABLED BCI'));
  assert.ok(!buildSearchUserPrompt(merged).includes('DISABLED'));
});

test('validation rejects malformed schedules and overlong or unsafe shared fields without truncating them', () => {
  const original = template();
  for (const invalid of [{ ...original, dailyTime: '24:00' }, { ...original, timezone: 'Somewhere/Invalid' }, { ...original, active: 'true' },
    { ...original, opportunityDescription: 'x'.repeat(12001) }, { ...original, researchInterests: 'x'.repeat(12001) }, { ...original, fundingConditions: 'x'.repeat(12001) }, { ...original, userPrompt: 'unsafe\0text' }]) assert.throws(() => readSearchTemplate(invalid));
  const duplicate = legacyTemplate(); duplicate.profiles.push(duplicate.profiles[0]!); assert.throws(() => readSearchTemplate(duplicate), /unique/);
  const created = createSearchTemplate('Shared search', 'Europe/Tirane');
  assert.equal(readSearchTemplate(created).dailyTime, '09:00'); assert.equal(created.userPrompt, '');
  const { locationPreferences: _locations, ...older } = created; assert.equal(readSearchTemplate(older).locationPreferences, '');
});

test('structured defaults preserve job types, research alternatives, funding and regional priorities', () => {
  const original = template();
  assert.equal(original.active, true); assert.equal(original.userPrompt, '');
  assert.ok(original.opportunityDescription.includes('Industrial PhDs') && original.opportunityDescription.includes('official vacancy'));
  for (const topic of ['physical sensing', 'machine listening', 'robot audition', 'multisensor fusion', 'embodied AI', 'edge AI', 'brain–computer', 'audio interfaces', 'vocal biomarkers', 'preferred tasks and methods']) assert.ok(original.researchInterests.includes(topic), topic);
  for (const place of ['Scandinavia', 'Germany', 'United Kingdom', 'Japan', 'Australia', 'New Zealand', 'Southeast Asia', 'English or German']) assert.ok(original.locationPreferences.includes(place), place);
  assert.ok(original.fundingConditions.includes('early 2027'));
  assert.equal(searchTemplateCloudCriteria(original).fundingAndConditions, original.fundingConditions);
});

test('semicolon entries remain flexible alternatives with preferences distinguished from explicit hard exclusions', () => {
  const original = { ...template(), opportunityDescription: 'PhD; industrial R&D; official portals', researchInterests: 'BCI; acoustic sensing; preferred: experiments; avoid: routine administration', fundingConditions: 'Full funding; employee contract' };
  const user = buildSearchUserPrompt(original);
  assert.deepEqual(splitSearchEntries(' BCI; ; acoustic sensing ;'), ['BCI', 'acoustic sensing']);
  for (const entry of ['BCI', 'acoustic sensing', 'preferred: experiments', 'avoid: routine administration', 'Full funding', 'employee contract']) assert.ok(user.includes(entry));
  assert.ok(user.includes('do not require every listed direction'));
  assert.ok(user.includes('ranking preferences unless the user explicitly calls a condition a hard exclusion'));
  assert.ok(!user.includes('enabledProfessionalProfiles') && !user.includes('sharedProfessionalContext'));
});

test('system prompts preserve dynamic protocol, evidence verification, numeric scores and deadline rules', () => {
  const system = buildSearchSystemPrompt(template());
  for (const required of ['bootstrap_version=1', 'compatible=true', 'protocol_text', 'result_schema', 'private.begin_opportunity_search', 'separate call', '72 hours', '00:00', 'rolling', 'scale_min=0', 'scale_max=10', 'user reviews', 'permission', 'Stay quiet']) assert.ok(system.includes(required), required);
  assert.ok(system.includes('without inventing a stored deadline time'));
  assert.ok(!system.includes('private.submit_opportunity_search_result('));
});

test('execution prompts bind the exact acknowledged search and block an unsaved replacement', () => {
  const original = template();
  for (const prompt of [buildSearchSystemPrompt(original), buildSearchUserPrompt(original)]) assert.ok(prompt.includes('EXECUTION NOT READY'));
  original.cloud = { id: cloudId, revision: 1, contentKey: searchTemplateContentKey(original) };
  for (const prompt of [buildSearchSystemPrompt(original), buildSearchUserPrompt(original)]) {
    assert.ok(prompt.includes(`private.begin_opportunity_search('${cloudId}'::uuid`)); assert.ok(prompt.includes('current run.definition.criteria'));
  }
  original.researchInterests += '; unsaved direction'; assert.ok(buildSearchUserPrompt(original).includes('EXECUTION NOT READY'));
});

test('shared criteria preserve the installed seven-string contract without leaking recovery archives', () => {
  const original = { ...template(), legacySearchArchive: 'PRIVATE RECOVERY ONLY' }; const criteria = searchTemplateCloudCriteria(original);
  assert.deepEqual(Object.keys(criteria).sort(), ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'].sort());
  assert.equal(criteria.opportunityTypes, original.opportunityDescription); assert.equal(criteria.topicsAndMethods, original.researchInterests);
  assert.equal(criteria.researchAndReporting, ''); assert.ok(criteria.fitAndExclusions.includes('72 hours'));
  assert.ok(!JSON.stringify(criteria).includes(original.legacySearchArchive));
});

test('legacy replacement reads a minimal handoff and requires exact task selection', () => {
  const original = template(); assert.throws(() => buildReplaceSearchPrompt(original), /Save the current/);
  original.cloud = { id: cloudId, revision: 1, contentKey: searchTemplateContentKey(original) }; const prompt = buildReplaceSearchPrompt(original);
  assert.ok(prompt.length < 2100); assert.equal((prompt.match(/SELECT /g) || []).length, 1);
  for (const expected of [cloudId, 'ehkfzvjgesomteqpwrwa', "jsonb_build_object('version'", 'recurringPrompt', 'exact bound task ID only', 'explicit approval', 'separately approved exact superseded IDs']) assert.ok(prompt.includes(expected));
  assert.ok(!prompt.includes("meta_search - 'editor'") && !prompt.includes('find my existing meta-research task by purpose'));
  assert.ok(prompt.includes('octet_length') && prompt.includes('<=65536') && prompt.includes('ELSE NULL') && prompt.includes('legacySearchArchive|'));
  assert.ok(prompt.includes('Do not create an unbound task in this legacy fallback') && prompt.includes('stop before any task change'));
  assert.ok(!prompt.includes('or a create proposal'));
  for (const forbidden of ['begin_opportunity_search', 'claim_opportunity_search_schedule', 'confirm_opportunity_search_schedule', 'ONE-TIME SETUP']) assert.ok(!prompt.includes(forbidden));
});

function saveClient(options: { loseFirstResponse?: boolean; wrongOwner?: boolean; conflict?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = []; let saved: SearchCloudTemplate | null = null;
  const client = { from: () => { throw new Error('Autosave must not issue a read or a verification chain'); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'save_opportunity_meta_search'); calls.push(structuredClone(args));
      if (options.conflict) return { data: null, error: new Error('Search changed elsewhere. Reload before saving.') };
      saved = { id: String(args.p_id), user_id: options.wrongOwner ? 'another-owner' : owner, name: String(args.p_name),
        criteria: args.p_criteria as SearchCloudTemplate['criteria'], schedule: args.p_schedule as SearchCloudTemplate['schedule'],
        meta_search: args.p_meta_search as SearchCloudTemplate['meta_search'], revision: Number(args.p_expected_revision) + 1,
        created_at: template().updatedAt, updated_at: template().updatedAt };
      if (options.loseFirstResponse && calls.length === 1) return { data: null, error: new Error('Response lost after commit') };
      return { data: saved, error: null };
    } } as unknown as SupabaseClient;
  return { client, calls, row: () => saved! };
}

test('one RPC saves the shared editor and English prompts, retaining recovery data only inside the editor', async () => {
  const original = { ...template(), legacySearchArchive: 'PRIVATE RECOVERY ONLY' }; const fixture = saveClient(); const saved = await saveSearchTemplate(fixture.client, owner, original);
  assert.equal(fixture.calls.length, 1); assert.equal(isSearchTemplateSaved(saved), true);
  const document = fixture.row().meta_search!; assert.equal(document.version, 1); assert.equal(document.active, true);
  assert.ok(document.systemPrompt.includes('72 hours')); assert.ok(document.recurringPrompt.includes('begin_opportunity_search'));
  assert.equal(document.editor.legacySearchArchive, original.legacySearchArchive);
  assert.ok(!document.userPrompt.includes('PRIVATE RECOVERY') && !document.recurringPrompt.includes('PRIVATE RECOVERY'));
  const restored = importCloudSearchTemplate(fixture.row()); assert.equal(restored.legacySearchArchive, original.legacySearchArchive); assert.equal(isSearchTemplateSaved(restored), true);
});

test('cloud imports convert old profile editors and invalidate their obsolete full prompts until saved', () => {
  const old = legacyTemplate();
  const row: SearchCloudTemplate = { id: cloudId, user_id: owner, name: old.name, revision: 8, created_at: old.updatedAt, updated_at: old.updatedAt,
    criteria: searchTemplateCloudCriteria(template()), schedule: searchTemplateCloudSchedule(template()),
    meta_search: { version: 1, active: true, editor: old as any, systemPrompt: 'Old prompt', userPrompt: 'Old prompt', recurringPrompt: 'Old prompt' } };
  const imported = importCloudSearchTemplate(row);
  assert.ok(imported.researchInterests.includes('Robot audition')); assert.equal('profiles' in imported, false); assert.equal(isSearchTemplateSaved(imported), false);
  const noDocument = importCloudSearchTemplate({ ...row, meta_search: undefined });
  assert.equal(noDocument.fundingConditions, row.criteria.fundingAndConditions); assert.equal(isSearchTemplateSaved(noDocument), false);
  const marker = 'CV Harness meta-search context v1\n';
  const legacyCriteria = importCloudSearchTemplate({ ...row, meta_search: undefined, criteria: { ...row.criteria, researchAndReporting: old.userPrompt,
    fitAndExclusions: marker + JSON.stringify({ version: 1, professionalContext: old.professionalContext, researchInterests: old.researchInterests, profiles: old.profiles }) } });
  assert.ok(legacyCriteria.researchInterests.includes('Robot audition')); assert.ok(legacyCriteria.legacySearchArchive?.includes('PRIVATE DISABLED CONTEXT'));
});

test('criteria-only imports validate legacy activation metadata while enabling daily searching', () => {
  const original = { ...template(), opportunityDescription: 'Funded PhD; skip inactive vacancy listings' };
  const row: SearchCloudTemplate = { id: cloudId, user_id: owner, name: original.name, revision: 2, created_at: original.updatedAt, updated_at: original.updatedAt,
    criteria: searchTemplateCloudCriteria(original), schedule: searchTemplateCloudSchedule(original), meta_search: null };
  assert.equal(importCloudSearchTemplate(row).active, true);
  assert.equal(importCloudSearchTemplate({ ...row, criteria: searchTemplateCloudCriteria({ ...original, active: false }) }).active, true);
  assert.equal(importCloudSearchTemplate({ ...row, criteria: { ...row.criteria, fitAndExclusions: 'Legacy criteria', opportunityTypes: 'No professional profiles are enabled. Do not run this search or recommend opportunities.' } }).active, true);
  const oldInactive = importCloudSearchTemplate({ ...row, criteria: { ...row.criteria, fitAndExclusions: 'CV Harness shared-search intent v2\n{"version":2,"active":false}' } });
  assert.equal(oldInactive.active, true); assert.ok(!oldInactive.userPrompt.includes(JSON.stringify({ version: 2, active: false })));
  assert.throws(() => importCloudSearchTemplate({ ...row, criteria: { ...row.criteria, fitAndExclusions: 'CV Harness shared-search intent v2\n{"version":2,"active":"true"}' } }), /unsupported/);
});

test('lost-response retries send the same identity, expected revision and exact snapshot in one RPC each', async () => {
  const fixture = saveClient({ loseFirstResponse: true }); const original = template();
  await assert.rejects(saveSearchTemplate(fixture.client, owner, original), /Response lost/);
  const saved = await saveSearchTemplate(fixture.client, owner, original); assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.calls[0], fixture.calls[1]); assert.equal(saved.cloud!.revision, 1);
});

test('owner conflicts and oversize recovery archives fail without extra reads or a partial write', async () => {
  const original = template(); const wrong = saveClient({ wrongOwner: true });
  await assert.rejects(saveSearchTemplate(wrong.client, owner, original), /signed-in owner/);
  const conflict = saveClient({ conflict: true }); await assert.rejects(saveSearchTemplate(conflict.client, owner, original), /changed elsewhere/);
  const oversized = saveClient(); await assert.rejects(saveSearchTemplate(oversized.client, owner, { ...original, legacySearchArchive: 'x'.repeat(512 * 1024) }), /512 KiB/);
  assert.equal(oversized.calls.length, 0); assert.equal(original.cloud, undefined);
});

test('previously paused shared searches save as active daily searches without losing intent', async () => {
  const original = { ...template(), active: false }; const fixture = saveClient(); const saved = await saveSearchTemplate(fixture.client, owner, original);
  assert.equal(saved.active, true); assert.equal(fixture.row().meta_search!.active, true); assert.equal(fixture.row().meta_search!.editor.active, true); assert.ok(buildRecurringSearchPrompt(saved).includes('Run the saved CV Harness meta search now'));
  const imported = importCloudSearchTemplate({ ...fixture.row(), meta_search: { ...fixture.row().meta_search!, active: false, editor: { ...original, active: false } } });
  assert.equal(imported.active, true); assert.equal(isSearchTemplateSaved(imported), false, 'Old disabled task prompts must be saved again before replacement');
  assert.equal(fixture.row().meta_search!.editor.researchInterests, original.researchInterests); assert.ok(buildReplaceSearchPrompt(saved).includes('exact bound task ID only')); assert.ok(!buildReplaceSearchPrompt(saved).includes('disable the task instead'));
});
