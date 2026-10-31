import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleDocument } from '../src/features/cv-studio/domain/builtinConfigurations';
import { createTestState } from './helpers';
import { CV_STATE_VERSION } from '../src/documents/cv/types';
import { readCvState } from '../src/documents/cv/domain/cvStateValidation';
import { createNormalizedContentState } from '../src/documents/layout/contentLayout';
import {
  CV_CONTENT_JSON_FORMAT, CV_CONFIG_JSON_FORMAT, CV_JSON_FORMAT_VERSION,
  createCvContentJson, createCvConfigJson, parseCvContentJson, parseCvConfigJson,
  cvContent, cvConfig, applyCvContent, applyCvConfig, parseStoredCvState,
} from '../src/features/cv-studio/domain/cvJsonBackup';

const sampleCv = createSampleDocument();
sampleCv.contact.name = 'Ada Lovelace';
sampleCv.education[0].hidden = true;
sampleCv.design.customFonts = [{ name: 'Literata', source: 'google' }];

test('content and configuration exports round trip independently without leaking the other half', () => {
  const date = new Date('2026-09-19T12:00:00.000Z');
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true }, date);
  const config = createCvConfigJson(sampleCv, date);
  assert.equal(content.format, CV_CONTENT_JSON_FORMAT);
  assert.equal(config.format, CV_CONFIG_JSON_FORMAT);
  assert.equal(content.formatVersion, CV_JSON_FORMAT_VERSION);
  assert.equal(content.cvVersion, CV_STATE_VERSION);
  assert.equal(content.exportedAt, date.toISOString());
  assert.deepEqual(parseCvContentJson(JSON.stringify(content)), cvContent(sampleCv));
  assert.deepEqual(parseCvConfigJson(JSON.stringify(config)), cvConfig(sampleCv));
  for (const key of ['design', 'lang', 'anonymization', 'bodyOrder', 'sectionHeaderSizes', 'disabled', 'completedSections']) {
    assert.equal(Object.hasOwn(content.data, key), false, key);
  }
  assert.equal(Object.hasOwn(content.data.education[0], 'hidden'), false);
  assert.ok(config.data.hiddenItems.includes(sampleCv.education[0].id));
  assert.equal(JSON.stringify(config).includes('Ada Lovelace'), false);
  assert.equal(JSON.stringify(content).includes('Literata'), false);
  assert.deepEqual(config.data.design.customFonts, [{ name: 'Literata', source: 'google' }]);
});

test('new exports use CV Harness names while existing split backups remain importable', () => {
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true });
  const config = createCvConfigJson(sampleCv);
  assert.equal(content.format, 'cv-harness/content');
  assert.equal(config.format, 'cv-harness/config');
  assert.deepEqual(parseCvContentJson(JSON.stringify({ ...content, format: 'cv-builder/content' })), content.data);
  assert.deepEqual(parseCvConfigJson(JSON.stringify({ ...config, format: 'cv-builder/config' })), config.data);
  assert.throws(() => parseCvContentJson(JSON.stringify({ ...config, format: 'cv-builder/config' })), /unsupported CV export format/);
  assert.throws(() => parseCvConfigJson(JSON.stringify({ ...content, format: 'cv-builder/content' })), /unsupported CV export format/);
});

test('content replacement removes old entries and preserves configuration for unchanged IDs', () => {
  const state = createNormalizedContentState(sampleCv);
  const before = structuredClone(state);
  const content = cvContent(state);
  content.contact.name = 'Edited elsewhere';
  content.about.text = 'New text';
  content.education[0].title = 'Updated degree';
  content.experience.jobs = [];
  content.customSections = [];
  content.sectionNames = {};
  const applied = applyCvContent(state, parseCvContentJson(JSON.stringify({ ...createCvContentJson(state), data: content })), { bypassPrivacy: true });
  assert.deepEqual(cvContent(applied), content);
  assert.deepEqual(cvConfig(applied), cvConfig(before));
  assert.equal(applied.education[0].hidden, true);
  assert.deepEqual(state, before, 'application must not mutate the source while preparing the import');
  content.contact.name = 'After application';
  assert.equal(applied.contact.name, 'Edited elsewhere');
});

test('configuration replacement preserves all content and replaces rather than merges old design', () => {
  const before = structuredClone(sampleCv);
  const config = cvConfig(createTestState({ design: { ink: '#123456' }, lang: 'en' }));
  const applied = applyCvConfig(sampleCv, parseCvConfigJson(JSON.stringify({ ...createCvConfigJson(sampleCv), data: config })));
  assert.deepEqual(cvContent(applied), cvContent(sampleCv));
  assert.deepEqual(cvConfig(applied), config);
  assert.equal(applied.design.fontBody, undefined);
  assert.equal(applied.education[0].hidden, undefined);
  assert.deepEqual(sampleCv, before);
});

test('only the two split formats are supported, with no combined, raw, or browser-wrapper imports', () => {
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true });
  const config = createCvConfigJson(sampleCv);
  const old = { ...content, format: 'cv-builder/cv', data: sampleCv };
  for (const parse of [parseCvContentJson, parseCvConfigJson]) {
    assert.throws(() => parse('{'), /not valid JSON/);
    for (const payload of [old, sampleCv, { __meta: { id: 'saved' }, data: sampleCv },
      { ...content, formatVersion: 2 }, { ...config, formatVersion: 2 }]) {
      assert.throws(() => parse(JSON.stringify(payload)), /unsupported CV export format/);
    }
  }
  assert.throws(() => parseCvContentJson(JSON.stringify(config)), /unsupported CV export format/);
  assert.throws(() => parseCvConfigJson(JSON.stringify(content)), /unsupported CV export format/);
  for (const version of [undefined, '7', 1, 6, 8]) {
    assert.throws(() => readCvState({ ...sampleCv, version }), /Unsupported CV data version/);
    assert.throws(() => parseCvContentJson(JSON.stringify({ ...content, cvVersion: version })), /Unsupported CV data version/);
    assert.throws(() => parseCvConfigJson(JSON.stringify({ ...config, cvVersion: version })), /Unsupported CV data version/);
  }
});

test('strict schemas reject missing, mixed, unknown, and invalid nested fields before applying', () => {
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true });
  const config = createCvConfigJson(sampleCv);
  for (const fields of [
    { contact: { ...content.data.contact, name: 42 } }, { about: undefined }, { experience: 'invalid' },
    { education: [null] }, { education: [{ title: 'Missing ID' }] }, { education: [{ id: 'item', title: {} }] },
    { education: [{ id: 'item', hidden: true }] }, { contact: { ...content.data.contact, design: {} } },
    { experience: { jobs: [{ id: 'job', bullets: ['Old bullet list'] }] } },
    { customSections: [{ id: 'section', name: 'Section', fields: ['tools'], entries: [] }] },
    { sidebarSections: [{ id: 'skills', name: 'Skills', levelType: null, items: [{ id: 'skill', levelValue: '4' }] }] },
    { design: {} }, { bodyOrder: [] }, { unknown: 'private metadata' },
  ]) {
    assert.throws(() => parseCvContentJson(JSON.stringify({ ...content, data: { ...content.data, ...fields } })), /Invalid CV content/);
  }
  for (const fields of [
    { contact: sampleCv.contact }, { design: { graphicOpacity: 'opaque' } }, { design: { unknown: 'value' } },
    { anonymization: { excludedItems: [false], excludedSections: [] } }, { bodyOrder: undefined },
    { hiddenItems: [2] }, { lang: 'fr' }, { sectionHeaderSizes: { jobs: 42 } },
  ]) {
    assert.throws(() => parseCvConfigJson(JSON.stringify({ ...config, data: { ...config.data, ...fields } })), /Invalid CV configuration/);
  }
});

test('content requires unambiguous IDs for preserving layout and privacy settings', () => {
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true });
  content.data.education.push({ ...content.data.education[0] });
  assert.throws(() => parseCvContentJson(JSON.stringify(content)), /Invalid item IDs/);
  const section = createCvContentJson(sampleCv, { bypassPrivacy: true });
  section.data.customSections.push({ id: 'jobs', name: 'Reserved', entries: [] });
  assert.throws(() => parseCvContentJson(JSON.stringify(section)), /Invalid section IDs/);
});

test('export projections omit unknown metadata and imports discard prototype-changing properties', () => {
  const state = structuredClone(sampleCv);
  Object.assign(state, { privateUnknown: 'not exported' });
  Object.assign(state.contact, { privateUnknown: 'not exported' });
  Object.assign(state.education[0], { privateUnknown: 'not exported' });
  Object.assign(state.design, { privateUnknown: 'not exported' });
  for (const backup of [createCvContentJson(state), createCvConfigJson(state)]) assert.equal(JSON.stringify(backup).includes('not exported'), false);
  const content = createCvContentJson(sampleCv, { bypassPrivacy: true });
  const unsafe = JSON.parse('{"__proto__":{"polluted":true},"constructor":"discard","prototype":{}}');
  Object.assign(unsafe, content.data);
  const imported = parseCvContentJson(JSON.stringify({ ...content, data: unsafe }));
  for (const key of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(imported, key), false);
});

test('internal named versions retain their current storage wrapper independently of JSON files', () => {
  const stored = JSON.stringify({ __meta: { id: 'saved-cv', name: 'Ada', updatedAt: 42 }, data: sampleCv });
  assert.deepEqual(parseStoredCvState(stored), sampleCv);
  assert.throws(() => parseStoredCvState(JSON.stringify(sampleCv)), /Invalid saved configuration/);
  assert.throws(() => parseStoredCvState(JSON.stringify({ __meta: {}, data: { ...sampleCv, version: 6 } })), /Unsupported CV data version/);
});

test('minimal optional content fields round trip without requiring design data', () => {
  const state = createTestState({ education: [{ id: 'minimal' }], customSections: [{ id: 'custom', name: 'Custom', entries: [] }] });
  assert.deepEqual(parseCvContentJson(JSON.stringify(createCvContentJson(state))), cvContent(state));
  assert.deepEqual(parseCvConfigJson(JSON.stringify(createCvConfigJson(state))), cvConfig(state));
});
