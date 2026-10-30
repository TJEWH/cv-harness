import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApplicationLetter, LetterFormatting } from '../src/documents/letter/letterTypes';
import { DEFAULT_LETTER_FORMATTING, readLetterFormatting, resolveLetterFormatting } from '../src/documents/letter/domain/letterFormatting';
import { contextChanges, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, editLetter, finalizedLetterRevision, finalizeLetter, formatLetter, letterContextVersion, selectApplicationLetterTemplate } from '../src/documents/letter/motivationLetters';
import { createTestState } from './helpers';

const template = DEFAULT_LETTER_TEMPLATES[0]!;
const state = createTestState();
const application = { context_json: { title: 'PhD position' }, cv_variant_id: null };
const context = letterContextVersion(application, state, template, 'en', '', 450);
const custom: LetterFormatting = { marginMm: 25, fontSizePt: 12, lineHeight: 1.5 };
const createLetter = () => createApplicationLetter('owner', 'application', template, context);
function repository() {
  const data = new Map<string, string>();
  return createLetterRepository({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }, 'owner');
}

test('older letters use independent general PhD defaults without rewriting their backups', () => {
  assert.deepEqual(resolveLetterFormatting(), { marginMm: 20, fontSizePt: 11, lineHeight: 1.2, headerNameSizePt: 16 });
  assert.deepEqual(resolveLetterFormatting(custom), { ...custom, headerNameSizePt: 16 });
  const resolved = resolveLetterFormatting();
  resolved.marginMm = 15;
  assert.equal(DEFAULT_LETTER_FORMATTING.marginMm, 20);
  const store = repository();
  const original = createLetter();
  store.save(original);
  assert.deepEqual(store.load('application'), original);
  assert.equal('formatting' in store.importLetter(store.exportLetter('application'), 'application'), false);
});

test('custom letter formatting survives application saves and backup imports independently', () => {
  const store = repository();
  const first = formatLetter(createLetter(), custom);
  store.save(first);
  store.save({ ...createLetter(), applicationId: 'other-application' });
  assert.deepEqual(store.load('application')?.formatting, custom);
  assert.equal(store.load('other-application')?.formatting, undefined);
  const imported = store.importLetter(store.exportLetter('application'), 'application');
  assert.deepEqual(imported.formatting, custom);
  imported.formatting!.marginMm = 30;
  assert.deepEqual(store.load('application')?.formatting, custom);
  assert.deepEqual(selectApplicationLetterTemplate(first, DEFAULT_LETTER_TEMPLATES[1]!).formatting, custom);
});

test('formatting validation accepts boundary values and rejects malformed or out-of-range backups', () => {
  for (const value of [{ marginMm: 10, fontSizePt: 10, lineHeight: 1 }, { marginMm: 30, fontSizePt: 14, lineHeight: 2 }]) {
    assert.deepEqual(readLetterFormatting(value), value);
  }
  const store = repository();
  for (const formatting of [null, [], {}, 'default', { ...custom, marginMm: 9 }, { ...custom, marginMm: 31 },
    { ...custom, fontSizePt: 9.9 }, { ...custom, fontSizePt: 14.1 }, { ...custom, lineHeight: .9 }, { ...custom, lineHeight: 2.1 },
    { ...custom, marginMm: '25' }, { ...custom, lineHeight: Infinity }, { ...custom, fontSizePt: NaN },
    { ...custom, headerNameSizePt: 9 }, { ...custom, headerNameSizePt: 33 }, { ...custom, headerNameSizePt: '16' },
    { ...custom, headerNameSizePt: null }, { ...custom, headerNameSizePt: NaN }]) {
    assert.throws(() => readLetterFormatting(formatting), /letter formatting/i);
    assert.throws(() => store.importLetter(JSON.stringify({ ...createLetter(), formatting }), 'application'), /letter formatting/i);
  }
  assert.throws(() => store.save({ ...createLetter(), formatting: { ...custom, marginMm: NaN } } as ApplicationLetter), /letter formatting/i);
});

test('formatting changes only the layout context and explicit defaults match absent settings', () => {
  assert.deepEqual(letterContextVersion(application, state, template, 'en', '', 450, { ...DEFAULT_LETTER_FORMATTING }), context);
  const formatted = letterContextVersion(application, state, template, 'en', '', 450, custom);
  assert.deepEqual(contextChanges(createLetter(), formatted), { content: false, theme: true });
  for (const change of [{ marginMm: 25 }, { fontSizePt: 12 }, { lineHeight: 1.5 }, { headerNameSizePt: 20 }]) {
    const changed = letterContextVersion(application, state, template, 'en', '', 450, { ...DEFAULT_LETTER_FORMATTING, ...change });
    assert.equal(changed.content, context.content);
    assert.notEqual(changed.theme, context.theme);
  }
});

test('template formatting survives backups and is frozen independently for each application', () => {
  const store = repository();
  const formatting = { ...custom, headerNameSizePt: 22 };
  const saved = store.saveTemplate({ ...template, formatting });
  const letter = createApplicationLetter('owner', 'application', saved, context);
  store.save(letter);
  store.saveTemplate({ ...saved, formatting: { ...formatting, headerNameSizePt: 26 } });
  assert.deepEqual(store.load('application')?.templateSnapshot?.formatting, formatting);
  assert.deepEqual(resolveLetterFormatting(letter.formatting, letter.templateSnapshot?.formatting), formatting);
  const imported = store.importTemplates(store.exportTemplates()).find(item => item.name === saved.name)!;
  assert.equal(imported.formatting?.headerNameSizePt, 26);
  assert.deepEqual(store.importLetter(store.exportLetter('application'), 'application').templateSnapshot?.formatting, formatting);
  const revised = selectApplicationLetterTemplate(letter, imported);
  assert.equal(resolveLetterFormatting(revised.formatting, revised.templateSnapshot?.formatting).headerNameSizePt, 26);
  assert.equal(letter.templateSnapshot?.formatting?.headerNameSizePt, 22);
});

test('application overrides and reset use the frozen template defaults and invalidate only layout approval', () => {
  const formatting = { ...custom, headerNameSizePt: 22 };
  const formattedTemplate = { ...template, formatting };
  const templateContext = letterContextVersion(application, state, formattedTemplate, 'en', '', 450);
  assert.equal(templateContext.content, context.content, 'rendering defaults do not change writing instructions');
  assert.notEqual(templateContext.theme, context.theme);
  const letter = createApplicationLetter('owner', 'application', formattedTemplate, templateContext);
  const approved = finalizeLetter(editLetter(letter, { subject: '', salutation: '', body: 'Confirmed research experience.', closing: '' }), templateContext, state.contact);
  const override = { ...formatting, headerNameSizePt: 18 };
  const overridden = formatLetter(approved, override);
  assert.equal(overridden.finalRevisionId, null);
  assert.deepEqual(resolveLetterFormatting(overridden.formatting, overridden.templateSnapshot?.formatting), override);
  const reset = formatLetter(overridden);
  assert.equal(reset.formatting, undefined);
  assert.deepEqual(resolveLetterFormatting(reset.formatting, reset.templateSnapshot?.formatting), formatting);
  assert.deepEqual(reset.working, approved.working);
  assert.deepEqual(reset.revisions, approved.revisions);
  assert.equal(formatLetter(approved, formatting).finalRevisionId, approved.finalRevisionId, 'explicit template defaults preserve approval');
});

test('formatting edits and reset require fresh approval without changing wording or prior final revisions', () => {
  const written = editLetter(createLetter(), { subject: 'PhD application', salutation: 'Dear Selection Committee,', body: 'My research experience fits the project.', closing: 'Yours sincerely,' });
  const approved = finalizeLetter(written, context, state.contact);
  const formatted = formatLetter(approved, custom);
  assert.equal(formatted.finalRevisionId, null);
  assert.equal(finalizedLetterRevision(formatted), null);
  assert.deepEqual(formatted.working, approved.working);
  assert.deepEqual(formatted.revisions, approved.revisions);
  assert.deepEqual(formatted.workingContext, approved.workingContext, 'a format edit leaves layout review pending');
  assert.ok(approved.finalRevisionId, 'the source is immutable');
  assert.equal(approved.formatting, undefined);
  const customContext = letterContextVersion(application, state, template, 'en', '', 450, custom);
  const approvedCustom = finalizeLetter(formatted, customContext, state.contact);
  assert.equal(formatLetter(approvedCustom, custom).finalRevisionId, approvedCustom.finalRevisionId, 'unchanged formatting preserves approval');
  const reset = formatLetter(approvedCustom);
  assert.equal(reset.finalRevisionId, null);
  assert.equal('formatting' in reset, false);
  assert.deepEqual(resolveLetterFormatting(reset.formatting), DEFAULT_LETTER_FORMATTING);
  assert.deepEqual(reset.working, approvedCustom.working);
  assert.equal(formatLetter(approved, { ...DEFAULT_LETTER_FORMATTING }).finalRevisionId, approved.finalRevisionId);
});
