import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestState } from './helpers';
import { createContentId, createNormalizedContentState, moveSectionInOrder, normalizeContentState, CUSTOM_BODY_FIELDS } from '../src/documents/layout/contentLayout';

test('moves section cards without mutating the previous order or dropping hidden/custom sections', () => {
  const order = ['about', 'education', 'jobs', 'research'];
  assert.deepEqual(moveSectionInOrder(order, 'education', 1), ['about', 'jobs', 'education', 'research']);
  assert.deepEqual(moveSectionInOrder(order, 'research', -1), ['about', 'education', 'research', 'jobs']);
  assert.deepEqual(order, ['about', 'education', 'jobs', 'research']);
});

test('section keyboard moves stop at the boundaries and ignore invalid directions', () => {
  const order = ['languages', 'hobbies'];
  for (const [key, direction] of [['languages', -1], ['hobbies', 1], ['missing', 1], ['languages', 2]]) {
    assert.equal(moveSectionInOrder(order, String(key), Number(direction)), order);
  }
});

test('new content receives distinct stable IDs', () => {
  const first = createContentId('entry');
  assert.ok(first.startsWith('entry_'));
  assert.notEqual(createContentId('entry'), first);
});

test('keeps only existing body references and repairs duplicate or incomplete section order', () => {
  const state = createTestState({
    customSections: [{ id: 'body_current', name: 'Projects', entries: [] }],
    sidebarSections: [{ id: 'sidebar_current', name: 'Skills', levelType: null, items: [] }],
    keepTogetherSections: ['education', 'body_current', 'jobs', 'education', 'deleted', 'sidebar_current', 'languages'],
    bodyOrder: ['jobs', 'body_current', 'jobs', 'deleted'],
  });
  normalizeContentState(state);
  assert.deepEqual(state.keepTogetherSections, ['education', 'body_current', 'jobs']);
  assert.deepEqual(state.bodyOrder, ['jobs', 'body_current', 'about', 'education']);
  assert.deepEqual(state.sidebarOrder, ['languages', 'hobbies', 'sidebar_current']);
  state.customSections = [];
  normalizeContentState(state);
  assert.deepEqual(state.keepTogetherSections, ['education', 'jobs']);
  assert.ok(!state.bodyOrder.includes('body_current'));
});

test('defaults optional custom controls while preserving existing values and hidden items', () => {
  const state = createTestState({
    education: [{ id: 'degree', title: 'Degree', hidden: true, thesis: '**Thesis**', coursesText: '- Course' }],
    experience: { jobs: [{ id: 'job', state: 'ongoing', bullets: '- Work' }] },
    customSections: [
      { id: 'fields', name: 'Fields', entries: [{ id: 'entry', title: 'Talk' }] },
      { id: 'notes', name: 'Notes', entryMode: 'textarea', text: '**Notes**', fields: ['title', 'title', 'desc'], entries: [] },
    ],
    sidebarSections: [{ id: 'skills', name: 'Skills', levelType: 'years', items: [{ id: 'skill', name: 'Vue', levelValue: 4 }] }],
  });
  const normalized = createNormalizedContentState(state);
  assert.deepEqual(normalized.customSections[0].fields, CUSTOM_BODY_FIELDS);
  assert.equal(normalized.customSections[0].entries[0].state, undefined);
  assert.equal(normalized.customSections[0].entries[0].institution, '');
  assert.deepEqual(normalized.customSections[1].fields, ['title', 'desc']);
  assert.equal(normalized.customSections[1].text, '**Notes**');
  assert.equal(normalized.customSections[1].entryMode, 'textarea');
  assert.deepEqual(normalized.education, state.education);
  assert.equal(normalized.experience.jobs[0].state, 'ongoing');
  assert.equal(normalized.sidebarSections[0].items[0].levelValue, 4);
  assert.equal(state.customSections[0].fields, undefined);
});

test('leaves an omitted item state unset so it does not render as a status', () => {
  const state = createTestState({
    experience: { jobs: [{ id: 'job', title: 'Engineer' }] },
    customSections: [{ id: 'projects', name: 'Projects', entries: [{ id: 'project', title: 'Tool' }] }],
  });
  const normalized = createNormalizedContentState(state);
  assert.equal(normalized.experience.jobs[0].state, undefined);
  assert.equal(normalized.customSections[0].entries[0].state, undefined);
});
