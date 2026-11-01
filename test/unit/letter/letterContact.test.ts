import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTACT_FIELDS } from '../../../src/documents/cv/types';
import { DEFAULT_DESIGN, SAMPLE_CONTACT, resolveDesign } from '../../../src/documents/cv/defaults';
import { createSampleDocument } from '../../../src/features/cv-studio/domain/builtinConfigurations';
import { createCloudCvSnapshot } from '../../../src/documents/privacy/domain/cloudCvPrivacy';
import { applyCvConfig, createCvConfigJson, cvContent, parseCvConfigJson, parseStoredCvState } from '../../../src/features/cv-studio/domain/cvJsonBackup';
import { applyLetterHeader, captureLetterHeaderSource, readLetterHeaderSource, resolveApplicationLetterState, resolveLetterContact } from '../../../src/documents/letter/domain/letterContact';

test('older CVs use a restrained letter header while preserving all CV contact fields', () => {
  const cv = createSampleDocument();
  delete cv.design.letterContactFields;
  const before = structuredClone(cv);
  const sender = resolveLetterContact(cv.contact, cv.design.letterContactFields);
  assert.deepEqual(sender, {
    name: cv.contact.name, location: cv.contact.location, email: cv.contact.email, phone: cv.contact.phone,
    role: '', website: '', linkedin: '', github: '',
  });
  assert.deepEqual(cv, before);
});

test('letter selection supports every contact field and a deliberately empty sender header', () => {
  const all = resolveLetterContact(SAMPLE_CONTACT, CONTACT_FIELDS);
  assert.deepEqual(all, SAMPLE_CONTACT);
  assert.notEqual(all, SAMPLE_CONTACT);
  assert.ok(Object.values(resolveLetterContact(SAMPLE_CONTACT, [])).every((value) => value === ''));
  assert.deepEqual(resolveDesign({ letterContactFields: [] }).letterContactFields, []);
  assert.deepEqual(resolveLetterContact({ ...SAMPLE_CONTACT, email: '' }, ['email']).email, '');
});

test('letter contact selection round trips through settings and named CV storage without replacing content', () => {
  for (const fields of [[], ['name', 'email', 'website']] as const) {
    const source = createSampleDocument();
    source.design.letterContactFields = [...fields];
    const config = parseCvConfigJson(JSON.stringify(createCvConfigJson(source)));
    const destination = createSampleDocument();
    destination.contact.name = 'Destination applicant';
    const result = applyCvConfig(destination, config);
    assert.deepEqual(result.design.letterContactFields, fields);
    assert.deepEqual(cvContent(result), cvContent(destination));
    const restored = parseStoredCvState(JSON.stringify({ __meta: { id: 'letter-settings' }, data: result }));
    assert.deepEqual(restored.design.letterContactFields, fields);
    assert.deepEqual(restored.anonymization, destination.anonymization);
  }
});

test('invalid letter field selections are rejected at the settings import boundary', () => {
  const exported = createCvConfigJson(createSampleDocument());
  for (const selection of ['email', null, ['name', 'address'], [false], { email: true }]) {
    assert.throws(() => parseCvConfigJson(JSON.stringify({
      ...exported,
      data: { ...exported.data, design: { ...exported.data.design, letterContactFields: selection } },
    })), /Invalid CV configuration/);
  }
});

test('privacy snapshots retain letter field names without exposing contact values', () => {
  for (const selection of [DEFAULT_DESIGN.letterContactFields, [], ['email', 'github']] as const) {
    const state = createSampleDocument();
    state.contact.email = 'private-applicant@example.org';
    state.design.letterContactFields = [...selection];
    const snapshot = createCloudCvSnapshot(state);
    assert.deepEqual(snapshot.config_json.design.letterContactFields, selection);
    assert.equal(JSON.stringify(snapshot).includes(state.contact.email), false);
  }
});

test('letters inherit updated and removed sender fields without replacing tailored CV content or local contact edits', () => {
  const base = createSampleDocument(), state = structuredClone(base), source = structuredClone(base);
  state.about.text = 'Tailored application evidence.';
  state.contact.role = 'Application-specific research role';
  state.design.letterContactFields = ['name', 'email', 'phone', 'website'];
  source.contact.phone = '';
  source.contact.email = 'new@example.org';
  source.contact.role = 'General source role';
  source.design.letterContactFields = ['name'];
  source.about.text = 'Changed CV library prose.';
  const before = structuredClone({ base, state, source });
  const header = captureLetterHeaderSource('base', source);
  const rendered = resolveApplicationLetterState(state, base, header);
  assert.equal(rendered.contact.phone, '');
  assert.equal(rendered.contact.email, 'new@example.org');
  assert.equal(rendered.contact.role, state.contact.role);
  assert.deepEqual(rendered.design.letterContactFields, ['name', 'website'], 'per-field local visibility overrides remain in place');
  assert.equal(rendered.about.text, state.about.text);
  assert.deepEqual({ base, state, source }, before);
  const historical = applyLetterHeader(base, captureLetterHeaderSource('base', rendered));
  assert.equal(historical.contact.phone, '');
  assert.deepEqual(historical.design.letterContactFields, ['name', 'website']);
  assert.equal(historical.about.text, base.about.text, 'historical prose stays attached to its original source');
});

test('letter sender refresh supports clearing every field and hiding the header', () => {
  const base = createSampleDocument(), source = structuredClone(base);
  source.design.letterContactFields = [];
  source.disabled.push('header');
  const result = resolveApplicationLetterState(base, base, captureLetterHeaderSource('base', source));
  assert.deepEqual(result.design.letterContactFields, []);
  assert.ok(result.disabled.includes('header'));
  assert.equal(resolveApplicationLetterState(base, base), base);
  assert.equal(resolveApplicationLetterState(base, base, captureLetterHeaderSource('base', base)), base);
});

test('cached letter sender data validates before restoring and does not alias the stored value', () => {
  const snapshot = captureLetterHeaderSource('base', createSampleDocument());
  const restored = readLetterHeaderSource(snapshot);
  assert.deepEqual(restored, snapshot);
  restored.contact.email = 'edited@example.org';
  restored.fields.length = 0;
  assert.notEqual(snapshot.contact.email, restored.contact.email);
  assert.ok(snapshot.fields.length);
  for (const invalid of [null, {}, { ...snapshot, sourceCvId: '' }, { ...snapshot, fields: ['unknown'] }, { ...snapshot, contact: {} }, { ...snapshot, hidden: 'yes' }]) {
    assert.throws(() => readLetterHeaderSource(invalid), /header is invalid/);
  }
});
