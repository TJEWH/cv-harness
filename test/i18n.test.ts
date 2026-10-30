import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { ref } from 'vue';
import { dict, makeT } from '../src/i18n/dict';
import { SUPPORTED_LANGUAGES } from '../src/documents/cv/defaults';
import { builtinConfigurations, createEmptyDocument } from '../src/features/cv-studio/domain/builtinConfigurations';
import { readCvState } from '../src/documents/cv/domain/cvStateValidation';

test('every dictionary entry has a translation in every supported language', () => {
  for (const [key, translations] of Object.entries(dict)) {
    for (const language of SUPPORTED_LANGUAGES) assert.ok(translations[language]?.trim(), `${key}: missing ${language}`);
  }
});

test('literal translation keys used by components exist in the shared dictionary', () => {
  const source = new URL('../src/', import.meta.url);
  for (const path of readdirSync(source, { recursive: true })) {
    if (typeof path !== 'string' || !/\.(vue|ts)$/.test(path)) continue;
    const text = readFileSync(new URL(path, source), 'utf8');
    for (const match of text.matchAll(/\bt\('([^']+)'\)/g)) assert.ok(dict[match[1]], `${path}: ${match[1]}`);
  }
});

test('translations follow the current language without falling back to another dictionary or the key', () => {
  const language = ref('en');
  const t = makeT(language);
  assert.equal(t('designSidebarLayout'), dict.designSidebarLayout.en);
  language.value = 'de';
  assert.equal(t('designSidebarLayout'), dict.designSidebarLayout.de);
  assert.equal(builtinConfigurations(language.value)[0].name, t('emptyDocument'));
  Object.defineProperty(dict, 'testGermanOnly', { value: { de: 'Nur Deutsch' }, configurable: true });
  try {
    assert.equal(t('testGermanOnly'), 'Nur Deutsch');
    language.value = 'en';
    assert.equal(t('testGermanOnly'), '');
    assert.equal(t('missingTranslation'), '');
    language.value = 'unsupported';
    assert.equal(t('designSidebarLayout'), '');
  } finally {
    delete dict.testGermanOnly;
  }
});

test('unsupported document languages are rejected at the import boundary', () => {
  assert.throws(() => readCvState({ ...createEmptyDocument(), lang: 'fr' }), /invalid or missing fields/);
});
