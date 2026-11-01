import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinConfigurations, createEmptyDocument, createSampleDocument, EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID } from '../../../src/features/cv-studio/domain/builtinConfigurations';
import { createNormalizedContentState } from '../../../src/documents/layout/contentLayout';
import { ANONYMIZED_CONTACT, createAnonymizedContact } from '../../../src/documents/privacy/domain/anonymization';
import { readCvState } from '../../../src/documents/cv/domain/cvStateValidation';

test('empty document contains no sample content and uses the default design', () => {
  const empty = readCvState(createEmptyDocument());
  assert.ok(Object.values(empty.contact).every((value) => value === ''));
  assert.equal(empty.about.text, '');
  for (const items of [empty.education, empty.experience.jobs, empty.languages, empty.hobbies, empty.customSections, empty.sidebarSections]) {
    assert.deepEqual(items, []);
  }
  assert.deepEqual(empty.design, createSampleDocument().design);
  assert.deepEqual(empty.disabled, []);
});

test('built-in versions are available without browser storage and have stable localized identities', () => {
  assert.deepEqual(builtinConfigurations('en').map(({ id }) => id), [EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID]);
  assert.deepEqual(builtinConfigurations('de').map(({ id }) => id), [EMPTY_DOCUMENT_ID, SAMPLE_DOCUMENT_ID]);
  assert.notEqual(builtinConfigurations('en')[0].name, builtinConfigurations('de')[0].name);
  const sample = readCvState(createSampleDocument());
  assert.equal(sample.experience.jobs.length, 3);
  assert.ok(sample.customSections.length > 0);
});

test('editing a document never changes the bundled source or another new document', () => {
  const original = createNormalizedContentState(createSampleDocument());
  const edited = createSampleDocument();
  edited.contact.name = 'Changed';
  edited.design.fontBody = 'Other';
  edited.experience.jobs[0].bullets = 'Changed';
  assert.deepEqual(createNormalizedContentState(createSampleDocument()), original);
  const empty = createEmptyDocument();
  empty.hobbies.push({ id: 'new', name: 'Reading' });
  assert.deepEqual(createEmptyDocument().hobbies, []);
});

test('sample header shares anonymized defaults without sharing mutable document data', () => {
  const sample = createSampleDocument();
  assert.deepEqual(sample.contact, ANONYMIZED_CONTACT);
  assert.deepEqual(createAnonymizedContact(sample.contact), sample.contact);
  sample.contact.email = 'edited@example.com';
  assert.notEqual(createSampleDocument().contact.email, sample.contact.email);
  assert.equal(createEmptyDocument().contact.email, '');
});
