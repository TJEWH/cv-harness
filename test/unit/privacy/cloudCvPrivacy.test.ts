import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudCvSnapshot } from '../../../src/documents/privacy/domain/cloudCvPrivacy';
import { readCvConfig, readCvContent } from '../../../src/documents/cv/domain/cvStateValidation';
import { createDefaultDesign, SAMPLE_CONTACT } from '../../../src/documents/cv/defaults';
import { createTestState } from '../../support/fixtures/cvState';
import { applyPrivacyEditorChanges, createPrivacyEditorState } from '../../../src/documents/privacy/domain/privacyOverrides';

const options = { id: '1ba99b9b-a230-4492-9c80-dd16a1d1560a', now: new Date('2026-09-19T16:00:00.000Z') };

test('cloud CVs use contact placeholders and explicit privacy wording without mutating local state', () => {
  const state = createTestState({
    contact: Object.fromEntries(Object.keys(SAMPLE_CONTACT).map((key) => [key, `Private contact ${key}`])) as typeof SAMPLE_CONTACT,
    about: { text: 'Public !!Private about!!' },
    education: [{ id: 'Private education ID', title: 'Public !!Private degree!!', desc: '[!!Private label!!](https://private-link.example)' }],
    customSections: [{ id: 'Private section ID', name: 'Research !!Private section!!', entries: [{ id: 'Private entry ID', desc: '!!Private desc!!' }] }],
    sidebarSections: [{ id: 'Private sidebar ID', name: 'Skills !!Private skills!!', levelType: null, items: [{ id: 'Private skill ID', name: '!!Private skill name!!' }] }],
    sectionNames: { education: 'Education !!Private heading!!', 'Private section ID': 'Public title' },
    bodyOrder: ['education', 'Private section ID'], sidebarOrder: ['Private sidebar ID'],
  });
  const draft = createPrivacyEditorState(state);
  draft.about.text = 'Public profile';
  draft.education[0].title = 'Public degree';
  draft.education[0].desc = 'Public description';
  draft.customSections[0].name = 'Research';
  draft.customSections[0].entries[0].desc = 'Public research';
  draft.sidebarSections[0].name = 'Skills';
  draft.sidebarSections[0].items[0].name = 'Public skill';
  draft.sectionNames.education = 'Education';
  applyPrivacyEditorChanges(state, draft);
  const before = structuredClone(state);
  const snapshot = createCloudCvSnapshot(state, options);
  assert.deepEqual(snapshot.content_json.contact, SAMPLE_CONTACT);
  assert.equal(snapshot.content_json.about.text, 'Public profile');
  assert.equal(snapshot.content_json.education[0].desc, 'Public description');
  assert.equal(JSON.stringify(snapshot).includes('Private'), false);
  assert.equal(JSON.stringify(snapshot).includes('private-link.example'), false);
  assert.deepEqual(state, before);
  snapshot.content_json.education[0].title = 'Edited snapshot';
  assert.deepEqual(state, before);
  assert.equal(snapshot.name, 'Privacy CV 2026-09-19T16:00:00.000Z 1ba99b9b');
  assert.equal(snapshot.cv_version, 7);
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.is_base_variant, false);
  assert.equal(Object.hasOwn(snapshot.content_json, 'format'), false);
});

test('excluded and hidden content and every associated local reference are absent from uploads', () => {
  const state = createTestState({
    disabled: ['education', 'private-disabled'],
    anonymization: { excludedSections: ['private-section'], excludedItems: ['private-excluded-item'] },
    education: [{ id: 'private-education', title: 'private degree' }],
    experience: { jobs: [{ id: 'public-job', company: 'Public company' }, { id: 'private-hidden', company: 'private employer', hidden: true }, { id: 'private-excluded-item', title: 'private title' }] },
    customSections: [{ id: 'private-section', name: 'private title', entries: [] }, { id: 'public-section', name: 'Research', entries: [] }],
    sidebarSections: [{ id: 'private-disabled', name: 'private sidebar', levelType: null, items: [] }],
    sectionNames: { 'private-section': 'private name', 'private-disabled': 'private other name', 'public-section': 'Research', unknown: 'private unknown name' },
    sectionHeaderSizes: { 'private-section': 'private size', 'public-section': 'h3' },
    bodyOrder: ['education', 'jobs', 'private-section', 'public-section'], sidebarOrder: ['private-disabled'],
    completedSections: ['private-section', 'public-section'], keepTogetherSections: ['private-section', 'public-section'],
  });
  const snapshot = createCloudCvSnapshot(state, options);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.deepEqual(snapshot.content_json.education, []);
  assert.deepEqual(snapshot.content_json.experience.jobs, [{ id: 'item-1', company: 'Public company' }]);
  assert.deepEqual(snapshot.config_json.disabled, ['education']);
  assert.deepEqual(snapshot.config_json.bodyOrder, ['jobs', 'section-1']);
  assert.deepEqual(snapshot.config_json.sectionHeaderSizes, { 'section-1': 'h3' });
  assert.deepEqual(snapshot.config_json.completedSections, ['section-1']);
  assert.deepEqual(snapshot.config_json.keepTogetherSections, ['section-1']);
  assert.deepEqual(snapshot.config_json.anonymization, { excludedSections: [], excludedItems: [] });
  assert.deepEqual(snapshot.config_json.hiddenItems, []);
  assert.deepEqual(snapshot.content_json.sectionNames, { 'section-1': 'Research' });
  readCvContent(snapshot.content_json); readCvConfig(snapshot.config_json);
});

test('unknown fields and arbitrary config strings cannot escape via the cloud projection', () => {
  const state = createTestState({ education: [{ id: 'private-id', title: 'Public' }], design: {
    fontBody: 'private font name', fontHead: 'Inter', ink: 'private color', h1: '24pt', h2: '12pt private size',
    customFonts: [{ name: 'private custom font', source: 'google' }], favoriteControls: ['private favorite'],
  }, sectionHeaderSizes: { education: 'private header style' } });
  for (const object of [state, state.contact, state.about, state.education[0], state.design]) Object.assign(object, { unknown: 'private unknown' });
  const snapshot = createCloudCvSnapshot(state, options);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.deepEqual(snapshot.config_json.design, { fontHead: 'Inter', h1: '24pt' });
  assert.deepEqual(snapshot.config_json.sectionHeaderSizes, {});
});

test('supported presentation settings survive cloud projection while editor-only fonts and favorites stay local', () => {
  const design = createDefaultDesign();
  const { favoriteControls: _favorites, customFonts: _fonts, ...expected } = design;
  const snapshot = createCloudCvSnapshot(createTestState({ design }), options);
  assert.deepEqual(snapshot.config_json.design, expected);
  assert.deepEqual(snapshot.content_json.contact, createTestState().contact);
});

test('snapshot identity must be generated independently of local CV metadata', () => {
  assert.throws(() => createCloudCvSnapshot(createTestState(), { id: 'private name' }), /Invalid snapshot ID/);
  const first = createCloudCvSnapshot(createTestState());
  const second = createCloudCvSnapshot(createTestState());
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.name, second.name);
});

test('known applicant identity repeated in CV prose is removed at the cloud upload boundary', () => {
  const contact = { name: 'Taylor [Q]', email: 'taylor+cv@example.org', phone: '+44 123 456', website: 'https://taylor.example.org',
    linkedin: 'https://linkedin.com/in/taylor', github: 'https://github.com/taylor', role: 'Software Engineer', location: 'Neustadt' };
  const state = createTestState({ contact, about: { text: 'TAYLOR [Q] is a Software Engineer in Neustadt. Email taylor+cv@example.org.' },
    education: [{ id: 'private-id', desc: 'Call +44 123 456. [Work](https://taylor.example.org) and https://linkedin.com/in/taylor.' }],
    customSections: [{ id: 'custom', name: 'Taylor [Q] research', entries: [{ id: 'entry', desc: 'Code at https://github.com/taylor.' }] }],
    sidebarSections: [{ id: 'sidebar', name: 'Links', levelType: null, items: [{ id: 'link', name: 'taylor+cv@example.org' }] }],
    sectionNames: { education: 'Taylor [Q] education' },
  });
  const before = structuredClone(state);
  const result = createCloudCvSnapshot(state, options);
  assert.deepEqual(result.content_json.contact, SAMPLE_CONTACT);
  assert.equal(result.content_json.about.text, '{{APPLICANT_NAME}} is a Software Engineer in Neustadt. Email {{APPLICANT_EMAIL}}.');
  assert.equal(result.content_json.education[0].desc, 'Call {{APPLICANT_PHONE}}. [Work]({{APPLICANT_WEBSITE}}) and {{APPLICANT_LINKEDIN}}.');
  assert.equal(result.content_json.customSections[0].name, '{{APPLICANT_NAME}} research');
  assert.equal(result.content_json.customSections[0].entries[0].desc, 'Code at {{APPLICANT_GITHUB}}.');
  assert.equal(result.content_json.sidebarSections[0].items[0].name, '{{APPLICANT_EMAIL}}');
  assert.equal(result.content_json.sectionNames.education, '{{APPLICANT_NAME}} education');
  for (const key of ['name','email','phone','website','linkedin','github'] as const) assert.equal(JSON.stringify(result).toLowerCase().includes(contact[key].toLowerCase()), false);
  assert.deepEqual(state, before);
});

test('short names use whole-name boundaries and identity placeholders remain intact', () => {
  const state = createTestState({ contact: { ...SAMPLE_CONTACT, name: 'Ann' }, about: { text: 'Ann presents an annual review. {{APPLICANT_NAME}}' } });
  assert.equal(createCloudCvSnapshot(state, options).content_json.about.text, '{{APPLICANT_NAME}} presents an annual review. {{APPLICANT_NAME}}');
});

test('redacting a name that resembles a structural value preserves valid CV item state', () => {
  const state = createTestState({ contact: { ...SAMPLE_CONTACT, name: 'Complete' }, education: [{ id: 'degree', state: 'complete', desc: 'Complete finished this course.' }] });
  const result = createCloudCvSnapshot(state, options);
  assert.equal(result.content_json.education[0].state, 'complete');
  assert.equal(result.content_json.education[0].desc, '{{APPLICANT_NAME}} finished this course.');
});

test('hidden sidebar contact remains hidden in cloud layout and cannot restore edited contact values', () => {
  const state = createTestState({
    contact: { ...SAMPLE_CONTACT, name: 'Original name', email: 'original@example.org' },
    design: { contactLayout: 'sidebar' },
    about: { text: 'Original profile' },
  });
  const draft = createPrivacyEditorState(state);
  draft.contact.name = 'Public applicant';
  draft.contact.email = 'public@example.org';
  draft.about.text = 'Public profile';
  draft.disabled.push('sidebar-contact', 'about');
  applyPrivacyEditorChanges(state, draft);
  const snapshot = createCloudCvSnapshot(state, options);
  assert.equal(snapshot.content_json.contact.name, 'Public applicant');
  for (const key of ['email', 'phone', 'website', 'location', 'linkedin', 'github'] as const) assert.equal(snapshot.content_json.contact[key], '');
  assert.equal(snapshot.content_json.about.text, '');
  assert.deepEqual(snapshot.config_json.disabled, ['sidebar-contact', 'about']);
});
