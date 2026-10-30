import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestState } from './helpers';
import { automaticMaskForField } from '../src/documents/privacy/domain/privacyEditorMasking';
import { privacyFieldEntries, privacyFieldKey } from '../src/documents/privacy/domain/privacyOverrides';

function fixture() {
  return createTestState({
    contact: { ...createTestState().contact, name: 'Original name', role: 'Engineer' },
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company', 'institution', 'place', 'dates'] },
    about: { text: 'Works at Original company.' },
    education: [{ id: 'degree', sub: 'Original school', start: '2020', end: '2022' }],
    experience: { jobs: [{ id: 'job', company: 'Original company', place: 'Original city', title: 'Engineer', bullets: 'Works at Original company.' }] },
    customSections: [{ id: 'custom', name: 'Projects at Original company', text: 'Original city project', entries: [{ id: 'project', institution: 'Original school' }] }],
    sidebarSections: [{ id: 'skills', name: 'Skills', levelType: 'years', items: [{ id: 'skill', name: 'TypeScript', levelValue: 3 }] }],
    sectionNames: { jobs: 'Original company experience' },
  });
}

test('every header field is always automatically masked, including role and empty fields', () => {
  const state = fixture();
  delete state.anonymization.proxyFields;
  const fields = privacyFieldEntries(state).filter(entry => entry.path[0] === 'contact');
  assert.equal(fields.length, 8);
  for (const field of fields) assert.equal(automaticMaskForField(state, field), 'header', field.field);
});

test('selected direct fields identify their automatic group, including aliases and both dates', () => {
  const state = fixture();
  const fields = new Map(privacyFieldEntries(state).map(entry => [entry.key, entry]));
  const expected = [
    ['job', 'company', 'company'], ['job', 'place', 'place'], ['degree', 'sub', 'institution'],
    ['project', 'institution', 'institution'], ['degree', 'start', 'dates'], ['degree', 'end', 'dates'],
  ];
  for (const [id, field, group] of expected) {
    assert.equal(automaticMaskForField(state, fields.get(privacyFieldKey('item', id, field))!), group);
  }
  // Empty eligible fields are also controlled by the selected automatic option.
  assert.equal(automaticMaskForField(state, fields.get(privacyFieldKey('item', 'job', 'start'))!), 'dates');
  state.anonymization.proxyFields = ['company'];
  assert.equal(automaticMaskForField(state, fields.get(privacyFieldKey('item', 'degree', 'sub'))!), undefined);
  assert.equal(automaticMaskForField(state, fields.get(privacyFieldKey('item', 'degree', 'end'))!), undefined);
});

test('prose, headings, item names, titles and levels stay editable even when their text contains masked values', () => {
  const state = fixture();
  const fields = new Map(privacyFieldEntries(state).map(entry => [entry.key, entry]));
  for (const parts of [
    ['about', 'text'], ['item', 'job', 'title'], ['item', 'job', 'bullets'],
    ['section', 'custom', 'name'], ['section', 'custom', 'text'], ['heading', 'jobs'],
    ['item', 'skill', 'name'], ['item', 'skill', 'levelValue'], ['item', 'skill', 'state'],
  ]) assert.equal(automaticMaskForField(state, fields.get(privacyFieldKey(...parts))!), undefined, parts.join('/'));
});

test('mask detection and toggle changes never remove saved manual overrides or modify original content', () => {
  const state = fixture();
  const key = privacyFieldKey('item', 'job', 'company');
  state.anonymization.fieldOverrides = { [key]: 'Public company description' };
  const field = privacyFieldEntries(state).find(entry => entry.key === key)!;
  const before = structuredClone(state);
  assert.equal(automaticMaskForField(state, field), 'company');
  assert.deepEqual(state, before);
  state.anonymization.proxyFields = [];
  assert.equal(automaticMaskForField(state, field), undefined);
  assert.deepEqual(state.anonymization.fieldOverrides, before.anonymization.fieldOverrides);
  assert.equal(state.experience.jobs[0].company, 'Original company');
});
