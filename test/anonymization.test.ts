import type { CvState } from '../src/documents/cv/types';
import { stub } from './helpers';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANONYMIZED_CONTACT,
  createAnonymizedContact,
  createAnonymizedState,
  normalizeAnonymizationState,
} from '../src/documents/privacy/domain/anonymization.ts';

function sampleState(): CvState {
  return stub<CvState>({
    contact: { name: 'Real Name', email: 'real@example.com', github: 'https://github.com/real' },
    disabled: ['languages'],
    keepTogetherSections: ['education', 'custom_body'],
    anonymization: {
      excludedSections: ['jobs', 'custom_body', 'missing_section'],
      excludedItems: ['education_1', 'custom_item', 'missing_item'],
    },
    education: [{ id: 'education_1', title: 'Private degree', hidden: false }],
    experience: { jobs: [{ id: 'job_1', title: 'Visible job', hidden: false }] },
    languages: [{ id: 'language_1', name: 'English', hidden: false }],
    hobbies: [{ id: 'hobby_1', name: 'Music', hidden: true }],
    customSections: [{ id: 'custom_body', entries: [{ id: 'custom_item', title: 'Private talk', hidden: false }] }],
    sidebarSections: [{ id: 'custom_sidebar', items: [{ id: 'sidebar_item', name: 'Private skill', hidden: false }] }],
  });
}

test('normalizes persisted anonymization exclusions against current content IDs', () => {
  const state = sampleState();

  normalizeAnonymizationState(state);

  assert.deepEqual(state.anonymization, {
    excludedSections: ['jobs', 'custom_body'],
    excludedItems: ['education_1', 'custom_item'],
  });
});

test('builds an anonymous copy without mutating normal CV data', () => {
  const state = sampleState();
  normalizeAnonymizationState(state);
  const before = JSON.parse(JSON.stringify(state));

  const anonymized = createAnonymizedState(state);

  assert.deepEqual(state, before);
  assert.deepEqual(anonymized.keepTogetherSections, ['education', 'custom_body']);
  assert.deepEqual(anonymized.contact, createAnonymizedContact(state.contact));
  assert.deepEqual(new Set(anonymized.disabled), new Set(['languages', 'jobs', 'custom_body']));
  assert.equal(anonymized.education[0].hidden, true);
  assert.equal(anonymized.customSections[0].entries[0].hidden, true);
  assert.equal(anonymized.experience.jobs[0].hidden, false);
  assert.equal(anonymized.languages[0].hidden, false);
  assert.equal(anonymized.hobbies[0].hidden, true);
});

test('keeps the anonymous header field-for-field aligned with the real CV', () => {
  assert.deepEqual(
    createAnonymizedContact({ name: 'Real Name', email: 'real@example.com', github: 'https://github.com/real' }),
    {
      name: ANONYMIZED_CONTACT.name,
      location: '',
      role: '',
      email: ANONYMIZED_CONTACT.email,
      phone: '',
      website: '',
      linkedin: '',
      github: ANONYMIZED_CONTACT.github,
    },
  );
});
