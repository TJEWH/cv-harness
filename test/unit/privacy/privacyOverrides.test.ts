import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestState } from '../../support/fixtures/cvState';
import { createAnonymizedState, normalizeAnonymizationState } from '../../../src/documents/privacy/domain/anonymization';
import { createCloudCvSnapshot } from '../../../src/documents/privacy/domain/cloudCvPrivacy';
import { applyCvContent, createCvConfigJson, createCvContentJson, parseCvConfigJson, cvContent } from '../../../src/features/cv-studio/domain/cvJsonBackup';
import { readCvState } from '../../../src/documents/cv/domain/cvStateValidation';
import { applyPrivacyEditorChanges, createPrivacyEditorState, getFieldPrivacyOverride, privacyFieldEntries, privacyFieldKey } from '../../../src/documents/privacy/domain/privacyOverrides';

function source() {
  return createTestState({
    contact: { ...createTestState().contact, name: 'John Doe', email: 'john@example.org' },
    about: { text: 'Worked under supervision of John Doe.' },
    education: [{ id: 'degree', sub: 'Real institution', desc: 'A research course.' }],
    experience: { jobs: [{ id: 'job', company: 'Real company', title: 'Engineer', bullets: 'Worked under supervision of John Doe.' }] },
    customSections: [{ id: 'custom', name: 'Research', entryMode: 'textarea', text: 'Private research', entries: [] }],
    sidebarSections: [{ id: 'sidebar', name: 'Skills', levelType: 'years', items: [{ id: 'skill', name: 'TypeScript', levelValue: 5 }] }],
  });
}

test('the privacy editor starts with original content and stores only changed fields, including blanks', () => {
  const state = source();
  const originalContent = cvContent(state);
  const draft = createPrivacyEditorState(state);
  assert.deepEqual(cvContent(draft), originalContent);
  assert.ok(privacyFieldEntries(draft).some(entry => entry.owner === draft.education[0] && entry.field === 'thesis' && entry.value === ''));
  draft.experience.jobs[0].bullets = 'Worked under supervision of a qualified person.';
  draft.about.text = '';
  draft.education[0].thesis = 'Public thesis';
  applyPrivacyEditorChanges(state, draft);
  assert.deepEqual(state.anonymization.fieldOverrides, {
    [privacyFieldKey('about', 'text')]: '',
    [privacyFieldKey('item', 'degree', 'thesis')]: 'Public thesis',
    [privacyFieldKey('item', 'job', 'bullets')]: 'Worked under supervision of a qualified person.',
  });
  assert.deepEqual(cvContent(state), originalContent);
  assert.equal(createPrivacyEditorState(state).experience.jobs[0].bullets, draft.experience.jobs[0].bullets);
  assert.equal(getFieldPrivacyOverride(state, ['about', 'text']), '');
  assert.equal(getFieldPrivacyOverride(state, ['experience', 'jobs', 0, 'title']), undefined);
  applyPrivacyEditorChanges(state, source());
  assert.equal(Object.hasOwn(state.anonymization, 'fieldOverrides'), false);
});

test('manual privacy wording takes precedence over automatic field and contact proxies in every output', () => {
  const state = source();
  state.anonymization.proxyFields = ['company', 'institution'];
  const draft = createPrivacyEditorState(state);
  assert.equal(draft.experience.jobs[0].company, 'Real company');
  draft.experience.jobs[0].company = 'A regional company';
  draft.about.text = 'John Doe is the approved public name.';
  draft.contact.name = 'Public applicant';
  draft.contact.email = '';
  applyPrivacyEditorChanges(state, draft);
  const before = structuredClone(state);
  const preview = createAnonymizedState(state);
  const exported = createCvContentJson(state).data;
  const cloud = createCloudCvSnapshot(state);
  for (const result of [preview, exported, cloud.content_json]) {
    assert.equal(result.experience.jobs[0].company, 'A regional company');
    assert.equal(result.education[0].sub, 'Institution 1');
    assert.equal(result.contact.name, 'Public applicant');
    assert.equal(result.contact.email, '');
    assert.equal(result.about.text, 'John Doe is the approved public name.');
  }
  assert.deepEqual(createCvContentJson(state, { bypassPrivacy: true }).data, cvContent(state));
  assert.deepEqual(cloud.config_json.anonymization, { excludedSections: [], excludedItems: [] });
  assert.deepEqual(state, before);
});

test('overrides follow stable IDs across reorder and moves and are removed when original content matches or disappears', () => {
  const state = source();
  const draft = createPrivacyEditorState(state);
  draft.education[0].desc = 'Public research';
  draft.customSections[0].name = 'Projects';
  applyPrivacyEditorChanges(state, draft);
  state.customSections[0].entries.push(state.education.shift()!);
  assert.equal(createPrivacyEditorState(state).customSections[0].entries[0].desc, 'Public research');
  assert.equal(getFieldPrivacyOverride(state, ['customSections', 0, 'entries', 0, 'desc']), 'Public research');
  const otherLanguage = structuredClone(state);
  otherLanguage.lang = 'de';
  const translated = createPrivacyEditorState(otherLanguage);
  translated.customSections[0].entries[0].desc = 'Öffentliche Forschung';
  applyPrivacyEditorChanges(otherLanguage, translated);
  assert.equal(createPrivacyEditorState(state).customSections[0].entries[0].desc, 'Public research');
  state.customSections[0].name = 'Projects';
  state.customSections[0].entries = [];
  normalizeAnonymizationState(state);
  assert.equal(Object.hasOwn(state.anonymization, 'fieldOverrides'), false);
});

test('privacy visibility is separate from originals and cannot make content-hidden entries visible', () => {
  const state = source();
  state.disabled = ['education'];
  state.experience.jobs.push({ id: 'original-hidden', title: 'Hidden', hidden: true });
  const draft = createPrivacyEditorState(state);
  draft.disabled = ['jobs'];
  draft.sidebarSections[0].items[0].hidden = true;
  draft.experience.jobs[1].hidden = false;
  draft.customSections.push({ id: 'injected', name: 'Ignored structural edit', entries: [] });
  applyPrivacyEditorChanges(state, draft);
  assert.deepEqual(state.disabled, ['education']);
  assert.equal(state.experience.jobs[1].hidden, true);
  assert.equal(state.customSections.length, 1);
  assert.deepEqual(state.anonymization.excludedSections, ['jobs']);
  assert.deepEqual(state.anonymization.excludedItems, ['skill']);
  assert.equal(createPrivacyEditorState(state).sidebarSections[0].items[0].hidden, true);
  assert.deepEqual(createCvContentJson(state).data.experience.jobs, []);
});

test('public imports revise overrides and retain private originals, including item moves and clearing text', () => {
  const state = source();
  const draft = createPrivacyEditorState(state);
  draft.education[0].desc = 'Public course';
  draft.about.text = 'Public profile';
  applyPrivacyEditorChanges(state, draft);
  const before = structuredClone(state);
  const content = createCvContentJson(state).data;
  const moved = content.education.shift()!;
  moved.desc = 'Revised public course';
  content.customSections[0].entries.push(moved);
  content.about.text = '';
  const imported = applyCvContent(state, content);
  assert.equal(imported.customSections[0].entries[0].desc, 'A research course.');
  assert.equal(imported.about.text, state.about.text);
  assert.equal(createPrivacyEditorState(imported).customSections[0].entries[0].desc, 'Revised public course');
  assert.equal(createPrivacyEditorState(imported).about.text, '');
  assert.deepEqual(state, before);
  assert.equal(applyCvContent(state, content, { bypassPrivacy: true }).about.text, '');
});

test('empty optional fields, numeric levels and status overrides round-trip without invalid item data', () => {
  const state = source();
  state.education[0].state = 'complete';
  const draft = createPrivacyEditorState(state);
  delete draft.education[0].state;
  draft.sidebarSections[0].items[0].levelValue = 2;
  applyPrivacyEditorChanges(state, draft);
  const result = createAnonymizedState(state);
  assert.equal(result.education[0].state, undefined);
  assert.equal(result.sidebarSections[0].items[0].levelValue, 2);
  readCvState(result);
  assert.deepEqual(parseCvConfigJson(JSON.stringify(createCvConfigJson(state))).anonymization, state.anonymization);
});

test('an omitted or excluded public field cannot clear its saved privacy wording on import', () => {
  const state = source();
  const draft = createPrivacyEditorState(state);
  draft.about.text = 'Public profile';
  draft.experience.jobs[0].bullets = 'Public description';
  draft.disabled.push('about');
  draft.experience.jobs[0].hidden = true;
  applyPrivacyEditorChanges(state, draft);
  const imported = applyCvContent(state, createCvContentJson(state).data);
  assert.deepEqual(imported.anonymization, state.anonymization);
  assert.equal(createPrivacyEditorState(imported).about.text, 'Public profile');
  assert.equal(createPrivacyEditorState(imported).experience.jobs[0].bullets, 'Public description');
});

test('hiding sidebar contact protects its stored privacy wording on public round-trip', () => {
  const state = source();
  state.design.contactLayout = 'sidebar';
  const draft = createPrivacyEditorState(state);
  draft.contact.email = 'public@example.org';
  draft.contact.name = 'Public applicant';
  draft.disabled.push('sidebar-contact');
  applyPrivacyEditorChanges(state, draft);
  const exported = createCvContentJson(state).data;
  assert.equal(exported.contact.email, '');
  assert.equal(exported.contact.name, 'Public applicant');
  const imported = applyCvContent(state, exported);
  assert.deepEqual(imported.anonymization, state.anonymization);
  assert.deepEqual(imported.contact, state.contact);
});

test('override validation rejects arbitrary paths, nested objects, invalid enum values and nonfinite numbers', () => {
  for (const entry of [
    { ['["design","ink"]']: '#fff' }, { ['["item","job","id"]']: 'changed' },
    { ['["contact","__proto__"]']: 'unsafe' }, { ['["item","job","state"]']: 'invented' },
    { ['["item","job","levelValue"]']: Infinity }, { ['["about","text"]']: { private: true } },
  ]) {
    const state = source();
    Object.assign(state.anonymization, { fieldOverrides: entry });
    assert.throws(() => readCvState(state), /invalid or missing fields/);
  }
});

test('exclamation punctuation has no privacy meaning and unmodified fields retain their content', () => {
  const state = source();
  state.about.text = 'Worked under !!John Doe!! supervision.';
  assert.equal(createCvContentJson(state).data.about.text, state.about.text);
  assert.equal(createAnonymizedState(state).about.text, state.about.text);
  const draft = createPrivacyEditorState(state);
  draft.about.text = 'Worked under a qualified person’s supervision.';
  applyPrivacyEditorChanges(state, draft);
  assert.equal(createCvContentJson(state).data.about.text, draft.about.text);
  assert.equal(state.about.text, 'Worked under !!John Doe!! supervision.');
});
