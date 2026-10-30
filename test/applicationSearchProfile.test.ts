import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LetterTemplate } from '../src/documents/letter/letterTypes';
import { createSearchTemplate, createSearchTemplateRepository } from '../src/features/meta-search/data/useSearchTemplates';
import { searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../src/features/meta-search/data/searchTemplateCloud';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import { idle, mount, prepare, type Workspace } from './refinementWorkflowHarness';

type SharedWorkspace = Workspace & {
  refreshSharedResearchInterests(): Promise<void>;
  reloadSearchTemplates(): void;
  reloadTemplates(): void;
  effectiveLetterTemplate: LetterTemplate;
};
function seedSearch(fixture: ReturnType<typeof mount>, active = true) {
  const repository = createSearchTemplateRepository(fixture.storage, fixture.props.userId);
  const template = createSearchTemplate('Shared research');
  template.active = active;
  template.researchInterests = 'Acoustic sensing; robot perception; prefer hands-on prototypes; avoid routine administration';
  const saved = repository.saveTemplate(template);
  (fixture.setup as SharedWorkspace).reloadSearchTemplates();
  return { repository, saved };
}

function cloudSearch(fixture: ReturnType<typeof mount>, active = true) {
  const editor = createSearchTemplate('Saved on another device');
  editor.researchInterests = 'Saved BCI interests; acoustic interfaces'; editor.active = active;
  const row = { id: '40000000-0000-4000-8000-000000000001', user_id: fixture.props.userId, name: editor.name, revision: 7,
    criteria: searchTemplateCloudCriteria(editor), schedule: searchTemplateCloudSchedule(editor), created_at: editor.updatedAt, updated_at: editor.updatedAt,
    meta_search: { version: 1, active, editor, systemPrompt: 'System', userPrompt: 'User', recurringPrompt: 'Recurring' } };
  fixture.database.opportunity_search_templates = [row];
  return row;
}

test('new template selections use the single shared interests even when scheduled research is paused', async t => {
  const fixture = mount(t); const setup = fixture.setup as SharedWorkspace; await idle(setup);
  const { saved } = seedSearch(fixture, false);
  const beforeCloud = JSON.stringify(fixture.database);
  setup.updateLetter('My existing manual letter.');
  await setup.selectLetterTemplate('research');
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.templateSnapshot!.useMetaSearchInterests, true);
  assert.equal(setup.letter!.searchProfile?.researchInterests, saved.researchInterests);
  assert.equal(setup.effectiveLetterTemplate.researchInterests, saved.researchInterests);
  assert.equal(setup.letter!.working.body, 'My existing manual letter.');
  assert.equal(JSON.stringify(fixture.database), beforeCloud, 'Selection never publishes source data or uploads a CV');
});

test('shared interests stay frozen across source edits and reopening until explicitly refreshed', async t => {
  const fixture = mount(t); const setup = fixture.setup as SharedWorkspace; await idle(setup);
  const { repository, saved } = seedSearch(fixture);
  await setup.selectLetterTemplate('research');
  setup.updateLetter('My existing manual letter.');
  repository.saveTemplate({ ...saved, researchInterests: 'Changed shared research interests.' });
  setup.reloadSearchTemplates();
  assert.equal(setup.letter!.searchProfile!.researchInterests, saved.researchInterests);
  const reopened = fixture.reopen() as SharedWorkspace; await idle(reopened);
  assert.equal(reopened.letter!.searchProfile!.researchInterests, saved.researchInterests);
  await reopened.refreshSharedResearchInterests();
  assert.equal(reopened.letter!.searchProfile!.researchInterests, 'Changed shared research interests.');
  assert.equal(reopened.letter!.working.body, 'My existing manual letter.');
});

test('newly discovered proposals prevent refreshing the saved shared interests', async t => {
  const fixture = mount(t); const setup = await prepare(fixture, 'base', { scope: 'letter' }) as SharedWorkspace;
  const before = JSON.stringify(setup.letter!.searchProfile);
  seedSearch(fixture); fixture.cloud.seedProposal(setup.requests[0]!.id);
  await setup.refreshSharedResearchInterests();
  assert.equal(setup.error, ''); assert.equal(JSON.stringify(setup.letter!.searchProfile), before);
  assert.equal(setup.proposals.length, 1, 'Refresh checks remote history before replacing context');
});

test('publication and clearing refinement retain the exact captured interests without duplicating them', async t => {
  const fixture = mount(t); const setup = fixture.setup as SharedWorkspace; await idle(setup);
  const { saved } = seedSearch(fixture);
  await setup.selectLetterTemplate('research');
  await prepare(fixture, 'base', { scope: 'letter' });
  const captured = JSON.parse(JSON.stringify(setup.letter!.searchProfile));
  assert.equal(setup.requests[0]!.request_json.letter.template.researchInterests, saved.researchInterests);
  assert.equal('useMetaSearchInterests' in setup.requests[0]!.request_json.letter.template, false);
  fixture.cloud.seedProposal(setup.requests[0]!.id); await setup.syncRefinement(); await setup.clearRefinementHistory();
  assert.equal(setup.error, ''); assert.deepEqual(setup.letter!.searchProfile, captured);
  assert.equal(setup.letter!.working.body, '');
  assert.equal(setup.effectiveLetterTemplate.researchInterests, saved.researchInterests);
});

test('a new device reads saved owner-scoped interests instead of the generated default', async t => {
  const fixture = mount(t); const row = cloudSearch(fixture);
  const setup = fixture.setup as SharedWorkspace;
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.searchProfile!.researchInterests, row.meta_search.editor.researchInterests);
  assert.equal(setup.letter!.searchProfile!.revision, row.revision);
  assert.equal(setup.effectiveLetterTemplate.researchInterests, row.meta_search.editor.researchInterests);
  assert.equal(fixture.storage.getItem(`cv.search-templates.v1:${fixture.props.userId}`), null, 'Cloud hydration does not overwrite local search storage');
});

test('a new device retains interests from a previously paused search using its converted local revision', async t => {
  const fixture = mount(t); const row = cloudSearch(fixture, false);
  const beforeCloud = JSON.stringify(fixture.database);
  const setup = fixture.setup as SharedWorkspace;
  await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.letter!.searchProfile!.researchInterests, row.meta_search.editor.researchInterests);
  assert.equal(setup.letter!.searchProfile!.revision, row.meta_search.editor.revision, 'Converted content has not been acknowledged at the cloud revision');
  assert.equal(setup.effectiveLetterTemplate.researchInterests, row.meta_search.editor.researchInterests);
  assert.equal(JSON.stringify(fixture.database), beforeCloud, 'Importing a paused search does not publish its converted content');
  assert.equal(fixture.storage.getItem(`cv.search-templates.v1:${fixture.props.userId}`), null);
});

test('opting out preserves custom interests and does not depend on an unrelated cloud search read', async t => {
  const fixture = mount(t); let setup = fixture.setup as SharedWorkspace; await idle(setup);
  const letters = createLetterRepository(fixture.storage, fixture.props.userId);
  letters.saveTemplate({ ...DEFAULT_LETTER_TEMPLATES[0]!, useMetaSearchInterests: false, researchInterests: 'Custom sensing interests.' });
  setup.reloadTemplates(); await setup.selectLetterTemplate('research');
  let reads = 0;
  const original = fixture.props.client;
  fixture.props.client = { ...original, from(table: string) {
    if (table !== 'opportunity_search_templates') return original.from(table);
    reads++;
    const builder = { select: () => builder, eq: () => builder, order: () => Promise.resolve({ data: null, error: new Error('Search unavailable') }) };
    return builder;
  } } as unknown as SupabaseClient;
  setup = fixture.reopen() as SharedWorkspace; await idle(setup);
  await setup.selectCv('base'); setup.feedbackScope = 'letter'; await setup.publishSources(); await idle(setup);
  assert.equal(setup.error, ''); assert.equal(reads, 0);
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(setup.requests.at(-1)!.request_json.letter.template.researchInterests, 'Custom sensing interests.');
});

test('legacy frozen application copies are not silently linked to a newly default-on library', async t => {
  const fixture = mount(t); let setup = fixture.setup as SharedWorkspace; await idle(setup);
  const letters = createLetterRepository(fixture.storage, fixture.props.userId);
  const old = JSON.parse(JSON.stringify(setup.letter!)); delete old.templateSnapshot!.useMetaSearchInterests;
  old.templateSnapshot!.researchInterests = 'Original frozen interests.';
  old.working.body = 'My saved manual letter.'; letters.save(old);
  seedSearch(fixture);
  setup = fixture.reopen() as SharedWorkspace; await idle(setup);
  assert.equal(setup.letter!.templateSnapshot!.useMetaSearchInterests, undefined);
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(setup.effectiveLetterTemplate.researchInterests, 'Original frozen interests.');
  assert.equal(setup.letter!.working.body, 'My saved manual letter.');
});

test('template selection waits for cloud interests before any refinement source can publish', async t => {
  const fixture = mount(t); const setup = fixture.setup as SharedWorkspace & { loadingSharedInterests: boolean }; await idle(setup);
  await setup.selectCv('base');
  const row = cloudSearch(fixture);
  let resolve!: (value: unknown) => void;
  const pending = new Promise(finish => { resolve = finish; });
  const original = fixture.props.client;
  fixture.props.client = { ...original, from(table: string) {
    if (table !== 'opportunity_search_templates') return original.from(table);
    const builder = { select: () => builder, eq: () => builder, order: () => pending };
    return builder;
  } } as unknown as SupabaseClient;
  const selection = setup.selectLetterTemplate('research');
  for (let i = 0; i < 10 && !setup.loadingSharedInterests; i++) await new Promise<void>(finish => setImmediate(finish));
  assert.equal(setup.loadingSharedInterests, true);
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(setup.requests.length, 0);
  resolve({ data: [row], error: null });
  await selection; await idle(setup);
  setup.feedbackScope = 'letter'; await setup.publishSources();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.at(-1)!.request_json.letter.template.researchInterests, row.meta_search.editor.researchInterests);
});

test('approved letter copies keep their shared interests when the search changes', async t => {
  const fixture = mount(t); const setup = fixture.setup as SharedWorkspace; await idle(setup);
  const { repository, saved } = seedSearch(fixture);
  await prepare(fixture, 'base', { scope: 'letter', letterText: 'A complete manual motivation letter.' });
  await setup.approve('letter');
  assert.equal(setup.error, ''); assert.equal(setup.letterApproved, true);
  const frozen = JSON.stringify(setup.letter);
  repository.saveTemplate({ ...saved, researchInterests: 'A different research direction.' });
  setup.reloadSearchTemplates(); await setup.refreshSharedResearchInterests();
  assert.equal(JSON.stringify(setup.letter), frozen);
  assert.equal(setup.letterApproved, true);
});

test('an untouched application keeps its opt-out when the live library switches to the shared source', async t => {
  const fixture = mount(t); let setup = fixture.setup as SharedWorkspace; await idle(setup);
  const letters = createLetterRepository(fixture.storage, fixture.props.userId);
  const custom = letters.saveTemplate({ ...DEFAULT_LETTER_TEMPLATES[0]!, useMetaSearchInterests: false, researchInterests: 'Custom frozen interests' });
  setup.reloadTemplates(); await setup.selectLetterTemplate('research');
  letters.saveTemplate({ ...custom, useMetaSearchInterests: true }); seedSearch(fixture);
  setup = fixture.reopen() as SharedWorkspace; await idle(setup);
  assert.equal(setup.letter!.templateSnapshot!.useMetaSearchInterests, false);
  assert.equal(setup.effectiveLetterTemplate.researchInterests, 'Custom frozen interests');
  await setup.selectLetterTemplate('research');
  assert.equal(setup.letter!.templateSnapshot!.useMetaSearchInterests, true);
  assert.match(setup.effectiveLetterTemplate.researchInterests!, /Acoustic sensing/);
});

test('a pending background metadata read does not prevent choosing an opt-out template', async t => {
  const fixture = mount(t); await idle(fixture.setup);
  fixture.storage.clear();
  const letters = createLetterRepository(fixture.storage, fixture.props.userId);
  letters.saveTemplate({ ...DEFAULT_LETTER_TEMPLATES[0]!, id: 'custom', useMetaSearchInterests: false, researchInterests: 'Independent custom interests' });
  const row = cloudSearch(fixture); let resolve!: (value: unknown) => void;
  const pending = new Promise(finish => { resolve = finish; }); const original = fixture.props.client;
  fixture.props.client = { ...original, from(table: string) {
    if (table !== 'opportunity_search_templates') return original.from(table);
    const builder = { select: () => builder, eq: () => builder, order: () => pending }; return builder;
  } } as unknown as SupabaseClient;
  const setup = fixture.reopen() as SharedWorkspace & { loadingSharedInterests: boolean; preparationBusy: boolean };
  await idle(setup);
  assert.equal(setup.loadingSharedInterests, true); assert.equal(setup.preparationBusy, false);
  await setup.selectLetterTemplate('custom');
  assert.equal(setup.letter!.templateId, 'custom'); assert.equal(setup.letter!.templateSnapshot!.useMetaSearchInterests, false);
  resolve({ data: [row], error: null });
  for (let i = 0; i < 8; i++) await new Promise<void>(finish => setImmediate(finish));
  assert.equal(setup.effectiveLetterTemplate.researchInterests, 'Independent custom interests');
  assert.equal(setup.letter!.searchProfile, undefined);
});

test('pending native letter typing prevents background source adoption or approval-context changes', async t => {
  const fixture = mount(t); await idle(fixture.setup); fixture.storage.clear();
  const row = cloudSearch(fixture); let resolve!: (value: unknown) => void;
  const pending = new Promise(finish => { resolve = finish; }); const original = fixture.props.client;
  fixture.props.client = { ...original, from(table: string) {
    if (table !== 'opportunity_search_templates') return original.from(table);
    const builder = { select: () => builder, eq: () => builder, order: () => pending }; return builder;
  } } as unknown as SupabaseClient;
  const setup = fixture.reopen() as SharedWorkspace & { markInitialLetterDraftInput(): void };
  await idle(setup);
  const version = JSON.stringify(setup.letter!.workingContext);
  setup.markInitialLetterDraftInput(); // Native input has not committed its lazy model yet.
  resolve({ data: [row], error: null });
  for (let i = 0; i < 8; i++) await new Promise<void>(finish => setImmediate(finish));
  assert.equal(setup.letter!.searchProfile, undefined);
  assert.equal(JSON.stringify(setup.letter!.workingContext), version);
  setup.updateLetter('My manually committed motivation draft.');
  await setup.selectCv('base');
  assert.equal(setup.letter!.searchProfile!.researchInterests, row.meta_search.editor.researchInterests);
  assert.equal(JSON.stringify(setup.letter!.workingContext), version, 'Explicit source preparation does not bless a draft under newly loaded guidance');
  assert.equal(setup.letter!.working.body, 'My manually committed motivation draft.');
});
