import assert from 'node:assert/strict';
import test from 'node:test';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES, readLetterTemplate } from '../../../src/documents/letter/motivationLetters';
import { createSearchTemplateRepository, DEFAULT_SEARCH_TEMPLATES, readSearchTemplate, searchTemplateStorageKey } from '../../../src/features/meta-search/data/searchTemplateRepository';

const owner = 'merge-owner';
const initialDate = '2026-10-01T10:00:00.000Z';
const saveDate = '2026-10-30T12:00:00.000Z';
const cloudId = '22222222-2222-4222-8222-222222222222';
const letterConflict = 'This template has conflicting changes in another tab. Your edits are still here. Copy them before reloading to review the latest saved version.';
const searchConflict = 'This meta search changed in another tab. Your edits remain here; copy them before reloading.';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function countedStorage(key: string, initial: unknown) {
  // Seed the modern normalized shape directly: setup and baseline reads must
  // not hide a compatibility migration among the writes under assertion.
  const values = new Map([[key, JSON.stringify([initial])]]);
  const writes: { key: string; value: string }[] = [];
  return {
    values, writes,
    getItem: (itemKey: string) => values.get(itemKey) ?? null,
    setItem(itemKey: string, value: string) { writes.push({ key: itemKey, value }); values.set(itemKey, value); },
  };
}
function letterFixture() {
  const key = 'cv.letters.v1:' + encodeURIComponent(owner) + ':templates';
  const initial = readLetterTemplate({
    ...DEFAULT_LETTER_TEMPLATES[0]!, id: 'merge-letter', revision: 7, updatedAt: initialDate,
    name: 'My letter', tone: 'My original tone', useMetaSearchInterests: true,
    researchInterests: 'My original interests', questionGuidance: 'My original questions',
    formatting: { marginMm: 20, fontSizePt: 11, lineHeight: 1.2 },
  });
  const storage = countedStorage(key, initial);
  const first = createLetterRepository(storage, owner), second = createLetterRepository(storage, owner);
  const baseline = first.listTemplates()[0]!, otherBaseline = second.listTemplates()[0]!;
  assert.deepEqual(baseline, initial);
  assert.equal(storage.writes.length, 0, 'reading normalized letter baselines must not write storage');
  return { key, initial, storage, first, second, baseline, otherBaseline };
}
function searchFixture() {
  const key = searchTemplateStorageKey(owner);
  const initial = readSearchTemplate({
    ...DEFAULT_SEARCH_TEMPLATES[0]!, id: 'merge-search', revision: 11, updatedAt: initialDate,
    name: 'My search', userPrompt: 'My original strategy',
    cloud: { id: cloudId, revision: 4, contentKey: 'previously acknowledged content' },
    legacySearchArchive: '{"privateRecovery":"retained"}',
  });
  const storage = countedStorage(key, initial);
  const first = createSearchTemplateRepository(storage, owner), second = createSearchTemplateRepository(storage, owner);
  const baseline = first.listTemplates()[0]!, otherBaseline = second.listTemplates()[0]!;
  assert.deepEqual(baseline, initial);
  assert.equal(storage.writes.length, 0, 'reading normalized search baselines must not write storage');
  return { key, initial, storage, first, second, baseline, otherBaseline };
}

test('letter repositories merge disjoint stale edits while retaining current fields and owning revision metadata', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(saveDate) });
  const f = letterFixture();
  const latest = f.second.saveTemplate({ ...f.otherBaseline, tone: 'Tone committed in another tab' }, f.otherBaseline);
  const incoming = { ...f.baseline, name: 'My changed title', revision: 999, updatedAt: '2099-01-01T00:00:00.000Z' };
  const originalInput = clone(incoming), originalBaseline = clone(f.baseline);
  const saved = f.first.saveTemplate(incoming, f.baseline);
  assert.equal(saved.name, incoming.name); assert.equal(saved.tone, latest.tone);
  assert.equal(saved.researchInterests, f.baseline.researchInterests);
  assert.deepEqual(saved.formatting, latest.formatting);
  assert.equal(saved.id, f.baseline.id); assert.equal(saved.revision, latest.revision + 1); assert.equal(saved.updatedAt, saveDate);
  assert.deepEqual(incoming, originalInput); assert.deepEqual(f.baseline, originalBaseline);
  assert.equal(f.storage.writes.length, 2); assert(f.storage.writes.every(write => write.key === f.key));
  assert.deepEqual(f.first.listTemplates(), [saved]);
  saved.formatting!.marginMm = 25;
  assert.equal(f.first.listTemplates()[0]!.formatting!.marginMm, 20, 'returned values cannot mutate saved state');
});

test('a letter conflict reports the existing recovery message without any partial storage write or draft mutation', () => {
  const f = letterFixture();
  f.second.saveTemplate({ ...f.otherBaseline, tone: 'The saved concurrent tone' }, f.otherBaseline);
  const incoming = { ...f.baseline, name: 'Unsaved local title', tone: 'My conflicting local tone' };
  const originalInput = clone(incoming), originalBaseline = clone(f.baseline);
  const savedStorage = [...f.storage.values.entries()];
  f.storage.writes.length = 0;
  assert.throws(() => f.first.saveTemplate(incoming, f.baseline), { message: letterConflict });
  assert.equal(f.storage.writes.length, 0, 'a later field conflict must not save an earlier nonconflicting field');
  assert.deepEqual([...f.storage.values.entries()], savedStorage);
  assert.deepEqual(incoming, originalInput); assert.deepEqual(f.baseline, originalBaseline);
});

test('matching letter edits are not conflicts, and optional removals preserve independent concurrent fields', () => {
  const f = letterFixture();
  const latest = f.second.saveTemplate({ ...f.otherBaseline, tone: 'The same new tone', questionGuidance: 'Questions from another tab' }, f.otherBaseline);
  const incoming = { ...f.baseline, tone: latest.tone, researchInterests: undefined };
  delete incoming.formatting;
  const saved = f.first.saveTemplate(incoming, f.baseline);
  assert.equal(saved.tone, latest.tone); assert.equal(saved.questionGuidance, latest.questionGuidance);
  assert.equal(saved.researchInterests, undefined); assert.equal(saved.formatting, undefined);
  assert.equal(saved.revision, latest.revision + 1);
  const persisted = JSON.parse(f.storage.values.get(f.key)!)[0];
  assert.equal(Object.hasOwn(persisted, 'researchInterests'), false); assert.equal(Object.hasOwn(persisted, 'formatting'), false);
});

test('search repositories merge stale content edits without overwriting a newer cloud acknowledgement or recovery metadata', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(saveDate) });
  const f = searchFixture();
  const latest = f.second.saveTemplate({
    ...f.otherBaseline, researchInterests: 'Research committed in another tab',
    cloud: { id: cloudId, revision: 5, contentKey: 'new acknowledged content' },
    legacySearchArchive: '{"privateRecovery":"newer"}',
  }, f.otherBaseline);
  const incoming = { ...f.baseline, userPrompt: 'My changed strategy', revision: 999, updatedAt: '2099-01-01T00:00:00.000Z' };
  const originalInput = clone(incoming), originalBaseline = clone(f.baseline);
  const saved = f.first.saveTemplate(incoming, f.baseline);
  assert.equal(saved.userPrompt, incoming.userPrompt); assert.equal(saved.researchInterests, latest.researchInterests);
  assert.deepEqual(saved.cloud, latest.cloud); assert.equal(saved.legacySearchArchive, latest.legacySearchArchive);
  assert.equal(saved.id, f.baseline.id); assert.equal(saved.revision, latest.revision + 1); assert.equal(saved.updatedAt, saveDate);
  assert.deepEqual(incoming, originalInput); assert.deepEqual(f.baseline, originalBaseline);
  assert.equal(f.storage.writes.length, 2); assert(f.storage.writes.every(write => write.key === f.key));
  assert.deepEqual(f.first.listTemplates(), [saved]);
  saved.cloud!.revision = 100;
  assert.equal(f.first.listTemplates()[0]!.cloud!.revision, 5, 'returned cloud metadata is isolated from storage');
});

test('search content and cloud binding conflicts retain the exact error and perform zero storage writes', () => {
  for (const field of ['userPrompt', 'cloud'] as const) {
    const f = searchFixture();
    const latest = f.second.saveTemplate({
      ...f.otherBaseline, userPrompt: 'Saved concurrent strategy',
      cloud: { id: cloudId, revision: 5, contentKey: 'saved concurrent acknowledgement' },
    }, f.otherBaseline);
    const incoming = field === 'userPrompt'
      ? { ...f.baseline, name: 'Unsaved local title', userPrompt: 'My conflicting strategy' }
      : { ...f.baseline, name: 'Unsaved local title', cloud: { id: cloudId, revision: 6, contentKey: 'my conflicting acknowledgement' } };
    const originalInput = clone(incoming), originalBaseline = clone(f.baseline);
    const savedStorage = [...f.storage.values.entries()];
    f.storage.writes.length = 0;
    assert.throws(() => f.first.saveTemplate(incoming, f.baseline), { message: searchConflict });
    assert.equal(f.storage.writes.length, 0, field + ' conflict must not write a partial template or compatibility archive');
    assert.deepEqual([...f.storage.values.entries()], savedStorage);
    assert.deepEqual(f.first.listTemplates(), [latest]);
    assert.deepEqual(incoming, originalInput); assert.deepEqual(f.baseline, originalBaseline);
  }
});

test('matching search edits merge and removing optional metadata does not erase another tab’s content', () => {
  const f = searchFixture();
  const latest = f.second.saveTemplate({ ...f.otherBaseline, userPrompt: 'The same new strategy', fundingConditions: 'New saved funding' }, f.otherBaseline);
  const incoming = { ...f.baseline, userPrompt: latest.userPrompt, cloud: undefined };
  delete incoming.legacySearchArchive;
  const saved = f.first.saveTemplate(incoming, f.baseline);
  assert.equal(saved.userPrompt, latest.userPrompt); assert.equal(saved.fundingConditions, latest.fundingConditions);
  assert.equal(saved.cloud, undefined); assert.equal(saved.legacySearchArchive, undefined);
  assert.equal(saved.revision, latest.revision + 1);
  const persisted = JSON.parse(f.storage.values.get(f.key)!)[0];
  assert.equal(Object.hasOwn(persisted, 'cloud'), false); assert.equal(Object.hasOwn(persisted, 'legacySearchArchive'), false);
});

test('letter no-ops still write a new revision while normalized search no-ops preserve revision and storage', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(saveDate) });
  const letters = letterFixture();
  const savedLetter = letters.first.saveTemplate({ ...letters.baseline, revision: 999, updatedAt: saveDate }, letters.baseline);
  assert.deepEqual(savedLetter, { ...letters.baseline, revision: letters.baseline.revision + 1, updatedAt: saveDate });
  assert.equal(letters.storage.writes.length, 1);

  const searches = searchFixture();
  const originalStorage = [...searches.storage.values.entries()];
  const savedSearch = searches.first.saveTemplate({
    ...searches.baseline, name: '  ' + searches.baseline.name + '  ', active: false, revision: 999, updatedAt: saveDate,
  }, searches.baseline);
  assert.deepEqual(savedSearch, searches.baseline);
  assert.equal(searches.storage.writes.length, 0);
  assert.deepEqual([...searches.storage.values.entries()], originalStorage);
});

test('mismatched and deleted baselines keep each repository’s existing error without creating a replacement', () => {
  const letters = letterFixture();
  assert.throws(() => letters.first.saveTemplate({ ...letters.baseline, id: 'another-letter' }, letters.baseline), {
    message: 'The template does not match the editor’s saved version.',
  });
  letters.storage.values.set(letters.key, '[]');
  assert.throws(() => letters.first.saveTemplate(letters.baseline, letters.baseline), {
    message: 'This template is no longer saved. Your edits are still in the editor.',
  });
  assert.equal(letters.storage.writes.length, 0); assert.equal(letters.storage.values.get(letters.key), '[]');

  const searches = searchFixture();
  const message = 'This meta search is no longer saved. Your edits remain in the editor.';
  assert.throws(() => searches.first.saveTemplate({ ...searches.baseline, id: 'another-search' }, searches.baseline), { message });
  searches.storage.values.set(searches.key, '[]');
  assert.throws(() => searches.first.saveTemplate(searches.baseline, searches.baseline), { message });
  assert.equal(searches.storage.writes.length, 0); assert.equal(searches.storage.values.get(searches.key), '[]');
});
