import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELD_PRIVACY_TYPES } from '../../../src/documents/cv/types';
import { createAnonymizedState, normalizeAnonymizationState } from '../../../src/documents/privacy/domain/anonymization';
import { createCloudCvSnapshot } from '../../../src/documents/privacy/domain/cloudCvPrivacy';
import { applyCvConfig, applyCvContent, createCvConfigJson, createCvContentJson, cvContent, parseCvConfigJson } from '../../../src/features/cv-studio/domain/cvJsonBackup';
import { createFieldPrivacy, isProxyFieldEnabled, selectedProxyFieldValues } from '../../../src/documents/privacy/domain/fieldPrivacy';
import { readCvState } from '../../../src/documents/cv/domain/cvStateValidation';
import { createTestState } from '../../support/fixtures/cvState';

function privateFieldsState() {
  return createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: [...FIELD_PRIVACY_TYPES] },
    education: [{ id: 'degree', title: 'Public degree', sub: 'Secret university', place: 'Secret city', start: '2008', end: '2012', state: 'complete' }],
    experience: { jobs: [
      { id: 'job-one', company: 'Secret employer', title: 'Public role', place: 'Secret city', start: '2012', end: '2020', bullets: 'Worked for Secret employer in Secret city.' },
      { id: 'job-two', company: 'Secret employer', title: 'Another role', start: '', end: ' ', hidden: true },
    ] },
    languages: [{ id: 'language', name: 'Public language', level: 'Public level', levelValue: 4 }],
    hobbies: [{ id: 'hobby', name: 'Public hobby' }],
    customSections: [{ id: 'custom', name: 'Work at Secret employer', entries: [
      { id: 'project', title: 'Public project', institution: 'Secret university', desc: 'Secret university project in 2008.' },
    ] }, { id: 'text', name: 'Notes', entryMode: 'textarea', text: 'Secret city from 2008 to 2012.', entries: [] }],
    sidebarSections: [{ id: 'sidebar', name: 'More', levelType: null, items: [{ id: 'skill', name: 'Public skill', level: 'Public level' }] }],
    about: { text: 'Public role at Secret employer since 2012. Studied at Secret university.' },
    sectionNames: { jobs: 'Secret employer experience' },
    bodyOrder: ['about', 'education', 'jobs', 'custom', 'text'], sidebarOrder: ['languages', 'hobbies', 'sidebar'],
  });
}

test('Unicode case-fold equivalents use proxies in prose and links without crashing', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company'] },
    experience: { jobs: [{ id: 'one', company: 'S' }, { id: 'two', company: 'σ' }] },
    about: { text: 'Worked at ſ and [ς](https://private.example).' },
  });
  assert.equal(createCvContentJson(state).data.about.text, 'Worked at Company 1 and Company 2.');
  assert.equal(createAnonymizedState(state).about.text, 'Worked at Company 1 and Company 2.');
});

test('anonymous previews proxy every selected field type and repeated originals without changing local content', () => {
  const state = privateFieldsState();
  const before = structuredClone(state);
  const result = createAnonymizedState(state);
  assert.equal(JSON.stringify(cvContent(result)).includes('Secret'), false);
  assert.deepEqual(result.education[0], { id: 'degree', title: 'Public degree', sub: 'Institution 1', place: 'Place 1', start: 'Date 1', end: 'Date 2', state: 'complete', hidden: false });
  assert.equal(result.experience.jobs[0].company, 'Company 1');
  assert.equal(result.experience.jobs[1].company, 'Company 1');
  assert.equal(result.experience.jobs[1].hidden, true);
  assert.equal(result.experience.jobs[1].start, '');
  assert.equal(result.experience.jobs[1].end, ' ');
  assert.equal(result.customSections[0].entries[0].institution, 'Institution 1');
  assert.equal(result.languages[0].level, 'Public level');
  assert.equal(result.languages[0].levelValue, 4);
  assert.equal(Object.hasOwn(result.hobbies[0], 'company'), false);
  assert.equal(result.experience.jobs[0].bullets, 'Worked for Company 1 in Place 1.');
  assert.equal(result.sectionNames.jobs, 'Company 1 experience');
  assert.deepEqual(result.bodyOrder, state.bodyOrder);
  assert.deepEqual(state, before);
  assert.deepEqual(createAnonymizedState(state), result);
  readCvState(result);
});

test('only selected types change and Institution protects both stored field names', () => {
  const state = privateFieldsState();
  state.anonymization.proxyFields = ['institution'];
  const result = createAnonymizedState(state);
  assert.equal(result.education[0].sub, 'Institution 1');
  assert.equal(result.customSections[0].entries[0].institution, 'Institution 1');
  assert.equal(result.experience.jobs[0].company, 'Secret employer');
  assert.equal(result.education[0].start, '2008');
  assert.equal(isProxyFieldEnabled(state, 'sub'), true);
  assert.equal(isProxyFieldEnabled(state, 'institution'), true);
  assert.equal(isProxyFieldEnabled(state, 'state'), false);
  delete state.anonymization.proxyFields;
  assert.equal(createAnonymizedState(state).education[0].sub, 'Secret university');
});

test('one date option protects both dates and preserves shared values across start and end', () => {
  const state = privateFieldsState();
  state.anonymization.proxyFields = ['dates'];
  const result = createAnonymizedState(state);
  assert.equal(result.education[0].start, 'Date 1');
  assert.equal(result.education[0].end, 'Date 2');
  assert.equal(result.experience.jobs[0].start, 'Date 2');
  assert.equal(result.experience.jobs[0].end, 'Date 3');
  assert.equal(result.education[0].title, state.education[0].title);
  assert.equal(result.languages[0].name, state.languages[0].name);
  assert.equal(result.languages[0].level, state.languages[0].level);
  assert.equal(isProxyFieldEnabled(state, 'start'), true);
  assert.equal(isProxyFieldEnabled(state, 'end'), true);
  state.anonymization.proxyFields = [];
  assert.deepEqual(createAnonymizedState(state).education[0], { ...state.education[0], hidden: false });
});

test('saved earlier proxy settings upgrade without retaining removed fields or mutating the source', () => {
  for (const date of ['start', 'end']) {
    const state = privateFieldsState();
    const config = createCvConfigJson(state);
    const previousFields = ['company', date, 'title', 'name', 'level'];
    Object.assign(state.anonymization, { proxyFields: previousFields });
    Object.assign(config.data.anonymization, { proxyFields: previousFields });
    const restored = readCvState(state);
    assert.deepEqual(restored.anonymization.proxyFields, ['company', 'dates']);
    assert.deepEqual(parseCvConfigJson(JSON.stringify(config)).anonymization.proxyFields, ['company', 'dates']);
    assert.deepEqual(state.anonymization.proxyFields, previousFields);
    const preview = createAnonymizedState(restored);
    assert.equal(preview.education[0].title, state.education[0].title);
    assert.equal(preview.languages[0].name, state.languages[0].name);
    assert.equal(preview.languages[0].level, state.languages[0].level);
    assert.equal(preview.education[0].start, 'Date 1');
    assert.equal(preview.education[0].end, 'Date 2');
    Object.assign(state.anonymization, { proxyFields: ['title', 'unexpected'] });
    assert.throws(() => readCvState(state), /invalid or missing fields/);
  }
});

test('content and cloud exports share field privacy while explicit bypass keeps original data', () => {
  const state = privateFieldsState();
  const content = createCvContentJson(state).data;
  const cloud = createCloudCvSnapshot(state);
  assert.equal(JSON.stringify(content).includes('Secret'), false);
  assert.equal(JSON.stringify(cloud).includes('Secret'), false);
  assert.equal(content.education[0].sub, 'Institution 1');
  assert.equal(cloud.content_json.education[0].sub, 'Institution 1');
  assert.equal(cloud.content_json.experience.jobs[0].company, 'Company 1');
  assert.deepEqual(cloud.config_json.anonymization, { excludedSections: [], excludedItems: [] });
  assert.deepEqual(createCvContentJson(state, { bypassPrivacy: true }).data, cvContent(state));
});

test('default imports keep original protected fields by item ID across moves, including missing and empty values', () => {
  const state = privateFieldsState();
  const before = structuredClone(state);
  const content = createCvContentJson(state).data;
  const movedDegree = content.education.shift()!;
  movedDegree.sub = 'Incoming overwrite';
  movedDegree.company = 'Incoming invented field';
  movedDegree.desc = 'Edited public description';
  content.customSections[0].entries.push(movedDegree);
  content.experience.jobs[0].bullets = 'Edited public bullets';
  const result = applyCvContent(state, content);
  const degree = result.customSections[0].entries.find(item => item.id === 'degree')!;
  assert.equal(degree.sub, 'Secret university');
  assert.equal(degree.title, 'Public degree');
  assert.equal(degree.start, '2008');
  assert.equal(degree.end, '2012');
  assert.equal(Object.hasOwn(degree, 'company'), false);
  assert.equal(degree.desc, 'Edited public description');
  assert.equal(result.experience.jobs[0].company, 'Secret employer');
  assert.equal(result.experience.jobs[0].bullets, 'Edited public bullets');
  assert.equal(result.experience.jobs[1].start, '');
  assert.equal(result.experience.jobs[1].end, ' ');
  assert.deepEqual(state, before);
  const bypassed = applyCvContent(state, content, { bypassPrivacy: true });
  assert.equal(bypassed.customSections[0].entries.find(item => item.id === 'degree')?.sub, 'Incoming overwrite');
});

test('privacy field settings survive config round-trips and normalize unknown or duplicate types', () => {
  const state = privateFieldsState();
  const config = parseCvConfigJson(JSON.stringify(createCvConfigJson(state)));
  assert.deepEqual(config.anonymization.proxyFields, FIELD_PRIVACY_TYPES);
  assert.deepEqual(applyCvConfig(createTestState(), config).anonymization.proxyFields, FIELD_PRIVACY_TYPES);
  Object.assign(state.anonymization, { proxyFields: ['place', 'institution', 'place', 'state', 5] });
  assert.throws(() => readCvState(state), /invalid or missing fields/);
  normalizeAnonymizationState(state);
  assert.deepEqual(state.anonymization.proxyFields, ['institution', 'place']);
  readCvState(state);
  const legacy = createTestState();
  normalizeAnonymizationState(legacy);
  assert.equal(Object.hasOwn(legacy.anonymization, 'proxyFields'), false);
  assert.deepEqual(parseCvConfigJson(JSON.stringify(createCvConfigJson(legacy))).anonymization, legacy.anonymization);
});

test('untouched proxy-only prose round-trips locally while edited text imports literally', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company'] },
    experience: { jobs: [{ id: 'job', company: 'Acme', bullets: 'Work at Acme', desc: 'Work at Acme with !!private client!!' }] },
    about: { text: 'Worked at Acme' },
    customSections: [{ id: 'custom', name: 'Acme projects', entryMode: 'textarea', text: 'Acme research', entries: [] }],
    sidebarSections: [{ id: 'sidebar', name: 'Acme skills', levelType: null, items: [] }],
    sectionNames: { jobs: 'Acme experience' },
  });
  const content = createCvContentJson(state).data;
  const roundTrip = applyCvContent(state, content);
  assert.equal(roundTrip.about.text, state.about.text);
  assert.equal(roundTrip.experience.jobs[0].bullets, state.experience.jobs[0].bullets);
  assert.equal(roundTrip.experience.jobs[0].desc, state.experience.jobs[0].desc);
  assert.equal(roundTrip.customSections[0].name, state.customSections[0].name);
  assert.equal(roundTrip.customSections[0].text, state.customSections[0].text);
  assert.equal(roundTrip.sidebarSections[0].name, state.sidebarSections[0].name);
  assert.deepEqual(roundTrip.sectionNames, state.sectionNames);
  content.about.text += ', newly revised';
  assert.equal(applyCvContent(state, content).about.text, content.about.text);
});

test('selected Markdown values protect labels, destinations and repeated text without reprocessing generated proxies', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company', 'institution'] },
    experience: { jobs: [{ id: 'job', company: 'Company' }] },
    education: [{ id: 'degree', sub: '[Hidden school](https://hidden.example)' }],
    hobbies: [{ id: 'hobby', name: 'Ann' }],
    about: { text: '[Company](https://destination.example) hired Ann for an annual review. Hidden school: https://hidden.example. {{PRIVATE_1}}' },
  });
  const result = createCvContentJson(state).data;
  assert.equal(result.experience.jobs[0].company, 'Company 1');
  assert.equal(result.education[0].sub, 'Institution 1');
  assert.equal(result.about.text, 'Company 1 hired Ann for an annual review. Institution 1: Institution 1. {{PRIVATE_1}}');
  assert.equal(JSON.stringify(result).includes('https://destination.example'), false);
  for (const secret of ['Hidden school', 'https://hidden.example']) {
    assert.ok(selectedProxyFieldValues(state).includes(secret));
  }
  assert.equal(createFieldPrivacy(state).redactText('Company + Company'), 'Company 1 + Company 1');
});
