import assert from 'node:assert/strict';
import test from 'node:test';
import { addIncomingDraft, contextChanges, createApplicationLetter, createLetterRepository, DEFAULT_LETTER_TEMPLATES, DEFAULT_QUESTION_GUIDANCE, DEFAULT_REFINEMENT_SYSTEM_PROMPT, DEFAULT_TEMPLATE_GUIDANCE,
  editLetter, finalizedLetterRevision, finalizeLetter, letterContextVersion, letterFromEditableText, letterToEditableText, openLetterRevision, parseIncomingLetter, readLetterTemplate, resolveLetterContent,
  sameLetterContextInput, saveWorkingRevision, selectApplicationLetterTemplate, unresolvedLetterPlaceholders } from '../src/documents/letter/motivationLetters';
import { createTestState } from './helpers';

const template = DEFAULT_LETTER_TEMPLATES[0];
const version = { content: 'content-1', theme: 'theme-1' };
const contact = { ...createTestState().contact, name: 'Private Applicant' };
const content = { subject: 'Research application', salutation: 'Dear committee,', body: 'My research experience fits this role.', closing: 'Kind regards,\n{{APPLICANT_NAME}}' };
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

test('letter storage isolates accounts and applications and stores independent copies', () => {
  const storage = memory();
  const first = createLetterRepository(storage, 'user-one');
  const second = createLetterRepository(storage, 'user-two');
  const record = editLetter(createApplicationLetter('user-one', 'application-one', template, version), content);
  first.save(record);
  assert.equal(second.load('application-one'), null);
  assert.equal(first.load('application-two'), null);
  record.working.body = 'Changed after save';
  assert.equal(first.load('application-one')?.working.body, content.body);
  const loaded = first.load('application-one')!;
  loaded.working.body = 'Changed after load';
  assert.equal(first.load('application-one')?.working.body, content.body);
  assert.throws(() => second.save(record), /Stored letter could not be read/);
});

test('incoming cloud drafts append idempotently and never overwrite edits or a final revision', () => {
  const original = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const incoming = { ...content, body: 'A newly generated alternative.' };
  const updated = addIncomingDraft(original, incoming, version, { cloudDraftId: 'draft-1', cloudContextId: 'context-1' });
  assert.deepEqual(updated.working, original.working);
  assert.equal(updated.finalRevisionId, original.finalRevisionId);
  assert.equal(updated.revisions.length, 2);
  assert.equal(original.revisions.length, 1);
  assert.equal(addIncomingDraft(updated, incoming, version, { cloudDraftId: 'draft-1' }).revisions.length, 2);
});

test('opening an incoming draft archives current edits while preserving all final snapshots', () => {
  const final = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const finalId = final.finalRevisionId;
  const edited = editLetter(final, { ...content, body: 'My later edit' });
  assert.equal(edited.finalRevisionId, null);
  const incoming = addIncomingDraft(edited, { ...content, body: 'An alternative' }, version);
  const opened = openLetterRevision(incoming, incoming.revisions.at(-1)!.id);
  assert.equal(opened.working.body, 'An alternative');
  assert.equal(opened.revisions.at(-1)?.content.body, 'My later edit');
  assert.equal(opened.revisions.find((item) => item.id === finalId)?.content.body, content.body);
  const restored = openLetterRevision(opened, finalId!);
  assert.equal(restored.finalRevisionId, finalId);
  assert.equal(restored.working.body, content.body);
});

test('context fingerprints detect CV facts, opportunity and template changes separately from visual changes', () => {
  const state = createTestState();
  const application = { context_json: { title: 'Researcher', requirements: ['Robotics'] }, cv_variant_id: 'snapshot-1' };
  const initial = letterContextVersion(application, state, template, 'en', '', 450);
  const record = createApplicationLetter('owner', 'app', template, initial);
  assert.deepEqual(contextChanges(record, letterContextVersion({ ...application, cv_variant_id: 'republished-same-cv' }, state, template, 'en', '', 450)), { content: false, theme: false });
  const changedStyle = createTestState({ design: { ...state.design, ink: '#123456' } });
  assert.deepEqual(contextChanges(record, letterContextVersion(application, changedStyle, template, 'en', '', 450)), { content: false, theme: true });
  const changedFacts = createTestState({ ...state, about: { text: 'New research interest.' } });
  assert.deepEqual(contextChanges(record, letterContextVersion(application, changedFacts, template, 'en', '', 450)), { content: true, theme: false });
  for (const changed of [
    letterContextVersion({ ...application, context_json: { title: 'New role' } }, state, template, 'en', '', 450),
    letterContextVersion(application, state, { ...template, revision: 2, tone: 'More concise' }, 'en', '', 450),
    letterContextVersion(application, state, { ...template, salutationInstructions: 'Use the named project supervisor.' }, 'en', '', 450),
    letterContextVersion(application, state, template, 'de', '', 450),
    letterContextVersion(application, state, template, 'en', 'Focus on control theory', 450),
  ]) assert.equal(contextChanges(record, changed).content, true);
});

test('editor-only checklist changes do not invalidate letter context', () => {
  const state = createTestState();
  const application = { context_json: {}, cv_variant_id: null };
  assert.deepEqual(
    letterContextVersion(application, state, template, 'en', '', 450),
    letterContextVersion(application, { ...state, completedSections: ['about'] }, template, 'en', '', 450),
  );
});

test('published context comparison ignores JSONB key ordering but preserves fact and array differences', () => {
  assert.equal(sameLetterContextInput({ title: 'Role', requirements: { b: 2, a: 1 } }, { requirements: { a: 1, b: 2 }, title: 'Role' }), true);
  assert.equal(sameLetterContextInput({ requirements: ['A', 'B'] }, { requirements: ['B', 'A'] }), false);
  assert.equal(sameLetterContextInput({ title: 'Role' }, { title: 'Different role' }), false);
});

test('identity placeholders resolve only in the local rendered copy and missing values remain visible', () => {
  const contact = { ...createTestState().contact, name: 'Private Person', email: 'private@example.test', phone: '' };
  const input = { ...content, body: 'Contact {{APPLICANT_EMAIL}} or [APPLICANT_PHONE]. {{UNKNOWN_VALUE}}', closing: 'Regards, {{APPLICANT_NAME}}' };
  const resolved = resolveLetterContent(input, contact);
  assert.equal(resolved.closing, 'Regards, Private Person');
  assert.ok(resolved.body.includes('private@example.test'));
  assert.equal(input.closing, 'Regards, {{APPLICANT_NAME}}');
  assert.deepEqual(unresolvedLetterPlaceholders(input, contact), ['[APPLICANT_PHONE]', '{{UNKNOWN_VALUE}}']);
  assert.ok(unresolvedLetterPlaceholders(input, null).includes('{{APPLICANT_NAME}}'));
});

test('finalization rejects empty and unresolved letters and preserves immutable final snapshots', () => {
  const empty = createApplicationLetter('owner', 'app', template, version);
  assert.throws(() => finalizeLetter(empty, version, null), /Write or import/);
  assert.throws(() => finalizeLetter(editLetter(empty, content), version, null), /Resolve all placeholders/);
  const final = finalizeLetter(editLetter(empty, content), version, contact);
  final.working.body = 'Mutable working text';
  assert.equal(final.revisions[0].content.body, content.body);
  const savedRevision = saveWorkingRevision(final);
  savedRevision.working.body = 'Yet another change';
  assert.equal(savedRevision.revisions.at(-1)?.content.body, 'Mutable working text');
});

test('export readiness requires a matching immutable final revision, not just a stored final ID', () => {
  const final = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  assert.equal(finalizedLetterRevision(final)?.id, final.finalRevisionId);
  assert.equal(finalizedLetterRevision({ ...final, finalRevisionId: 'missing-final' }), null);
  assert.equal(finalizedLetterRevision({ ...final, workingContext: { ...version, content: 'unreviewed-context' } }), null);
  assert.equal(finalizedLetterRevision({ ...final, working: { ...content, body: 'Unfinalized changes' } }), null);
});

test('templates have monotonic revisions and importing copies never changes an assigned template', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const defaults = repository.listTemplates();
  defaults[0].name = 'Edited name';
  assert.notEqual(repository.listTemplates()[0].name, 'Edited name');
  const saved = repository.saveTemplate({ ...template, tone: 'New tone' });
  assert.equal(saved.revision, template.revision + 1);
  const exported = repository.exportTemplates();
  const copies = repository.importTemplates(exported);
  assert.ok(copies.every((copy) => !DEFAULT_LETTER_TEMPLATES.some((item) => item.id === copy.id)));
  assert.equal(repository.listTemplates().find((item) => item.id === template.id)?.revision, template.revision + 1);
  assert.equal(repository.listTemplates().length, 4);
});

const legacyResearchTemplate = {
  ...template, revision: 2, updatedAt: '2026-10-03T00:00:00.000Z',
  structure: 'Opening: identify the opportunity and research interest.\nEvidence: connect two relevant experiences from the CV to the requirements.\nResearch fit: explain a specific connection to the project.\nClosing: state the contribution and interest in a discussion.',
  tone: 'Specific, thoughtful and professional. Use only facts present in the context; do not invent experience.',
  closingInstructions: DEFAULT_TEMPLATE_GUIDANCE.closingInstructions,
};

test('saved built-in templates upgrade their original guidance once and retain personal settings', () => {
  const storage = memory();
  const key = 'cv.letters.v1:owner:templates';
  const original = { ...legacyResearchTemplate, revision: 8, name: 'My research template', language: 'de', maxWords: 600,
    researchInterests: 'Reliable measurements.', exampleText: 'My own example.', questionGuidance: 'Ask about my thesis.',
    refinementSystemPrompt: 'Preserve my manual corrections.' };
  const industry = { ...DEFAULT_LETTER_TEMPLATES[1], revision: 2,
    structure: 'Opening: role and motivation.\nRelevant evidence: two examples of skills and outcomes from the CV.\nContribution: connect experience to the organization and role.\nClosing: concise invitation to discuss.' };
  storage.setItem(key, JSON.stringify([original, industry]));
  const repository = createLetterRepository(storage, 'owner');
  repository.setDefaultTemplate(original.id);
  const upgraded = repository.listTemplates();
  assert.deepEqual(upgraded[0], { ...original, structure: template.structure, tone: template.tone,
    closingInstructions: template.closingInstructions, revision: 9, updatedAt: upgraded[0].updatedAt });
  assert.notEqual(upgraded[0].updatedAt, original.updatedAt);
  assert.equal(upgraded[1].structure, DEFAULT_LETTER_TEMPLATES[1].structure);
  assert.equal(upgraded[1].revision, DEFAULT_LETTER_TEMPLATES[1]!.revision);
  assert.deepEqual(JSON.parse(storage.getItem(key)!), upgraded);
  const persisted = storage.getItem(key);
  assert.deepEqual(repository.listTemplates(), upgraded);
  assert.equal(storage.getItem(key), persisted, 'repeated reads must not change revisions or timestamps');
  assert.deepEqual(repository.defaultTemplate(), upgraded[0]);
  const letter = createApplicationLetter('owner', 'new-app', repository.defaultTemplate()!, version);
  assert.deepEqual(letter.templateSnapshot, upgraded[0]);
});

test('built-in upgrades preserve edited guidance and never rewrite custom or imported structures', () => {
  const storage = memory();
  const repository = createLetterRepository(storage, 'owner');
  const customGuidance = { ...legacyResearchTemplate, tone: 'Use my own voice.', closingInstructions: 'End with my research question.' };
  const customStructure = { ...DEFAULT_LETTER_TEMPLATES[1], structure: 'My own narrative structure.' };
  const customCopy = { ...legacyResearchTemplate, id: 'personal-template' };
  storage.setItem('cv.letters.v1:owner:templates', JSON.stringify([customGuidance, customStructure, customCopy]));
  const upgraded = repository.listTemplates();
  assert.equal(upgraded[0].structure, template.structure);
  assert.equal(upgraded[0].tone, customGuidance.tone);
  assert.equal(upgraded[0].closingInstructions, customGuidance.closingInstructions);
  assert.deepEqual(upgraded.slice(1), [customStructure, customCopy]);
  const [imported] = repository.importTemplates(JSON.stringify({ format: 'cv-letter-templates', version: 1, templates: [legacyResearchTemplate] }));
  assert.equal(imported.structure, legacyResearchTemplate.structure);
  assert.deepEqual(repository.listTemplates().find(item => item.id === imported.id), imported);
});

test('research tone defaults upgrade independently of structure without changing custom tones or snapshots', () => {
  const previousTone = 'Thoughtful, precise and personal, with natural transitions and varied sentence lengths. Make motivation credible through concrete questions and reflection on evidence. Avoid stock enthusiasm, inflated claims and repetitive summaries. Use only supplied facts and confirmed answers; distinguish research interests and possible directions from established experience.';
  for (const tone of [legacyResearchTemplate.tone, previousTone, 'Use my own voice.', template.tone]) {
    for (const structure of [template.structure, 'My own research narrative.']) {
      const storage = memory();
      const repository = createLetterRepository(storage, 'owner');
      const original = { ...template, revision: 6, tone, structure, closingInstructions: 'My own closing.', updatedAt: '2026-10-14T00:00:00.000Z' };
      storage.setItem('cv.letters.v1:owner:templates', JSON.stringify([original]));
      const letter = createApplicationLetter('owner', 'app', original, version);
      repository.save(letter);
      const upgraded = repository.listTemplates()[0];
      if (tone === legacyResearchTemplate.tone || tone === previousTone) {
        assert.deepEqual(upgraded, { ...original, tone: template.tone, revision: 7, updatedAt: upgraded.updatedAt });
        assert.notEqual(upgraded.updatedAt, original.updatedAt);
      } else {
        assert.deepEqual(upgraded, original);
      }
      assert.deepEqual(repository.listTemplates()[0], upgraded, 'tone upgrades must run only once');
      assert.deepEqual(repository.load('app'), letter, 'assigned letter guidance remains frozen');
    }
  }
});

test('library guidance upgrades preserve existing letter snapshots, context and final revisions', () => {
  const storage = memory();
  const repository = createLetterRepository(storage, 'owner');
  storage.setItem('cv.letters.v1:owner:templates', JSON.stringify([legacyResearchTemplate]));
  const original = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', legacyResearchTemplate, version), content), version, contact);
  repository.save(original);
  const exported = repository.exportLetter('app');
  assert.equal(repository.listTemplates()[0].structure, template.structure);
  assert.deepEqual(repository.load('app'), original);
  assert.equal(repository.exportLetter('app'), exported);
  assert.deepEqual(readLetterTemplate(legacyResearchTemplate), legacyResearchTemplate);
});

test('application template snapshots survive library changes and explicit replacement preserves letter history', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const source = { ...template, exampleText: 'An example of concise research motivation.', researchInterests: 'Interpretable robot learning.', questionGuidance: 'Ask about relevant field experiments.', refinementSystemPrompt: 'Include concrete details only when they support the research narrative.' };
  const initial = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', source, version), content), version, contact);
  repository.save(initial);
  source.exampleText = 'Changed after assignment';
  repository.saveTemplate({ ...source, structure: 'A new structure', maxWords: 400, researchInterests: 'Robust sensing.', questionGuidance: 'Ask about relevant sensor projects.', refinementSystemPrompt: 'Ask for clarification when an answer is too vague.' });
  const loaded = repository.load('app')!;
  assert.equal(loaded.templateSnapshot?.revision, template.revision);
  assert.equal(loaded.templateSnapshot?.exampleText, 'An example of concise research motivation.');
  assert.equal(loaded.templateSnapshot?.structure, template.structure);
  assert.equal(loaded.templateSnapshot?.researchInterests, 'Interpretable robot learning.');
  assert.equal(loaded.templateSnapshot?.questionGuidance, 'Ask about relevant field experiments.');
  assert.equal(loaded.templateSnapshot?.refinementSystemPrompt, source.refinementSystemPrompt);
  const replacement = repository.listTemplates().find((item) => item.id === template.id)!;
  const selected = selectApplicationLetterTemplate(loaded, replacement);
  assert.equal(selected.templateSnapshot?.revision, template.revision + 1);
  assert.equal(selected.maxWords, 400);
  assert.equal(selected.templateSnapshot?.researchInterests, 'Robust sensing.');
  assert.equal(selected.templateSnapshot?.questionGuidance, 'Ask about relevant sensor projects.');
  assert.equal(selected.templateSnapshot?.refinementSystemPrompt, 'Ask for clarification when an answer is too vague.');
  assert.equal(selected.finalRevisionId, null);
  assert.deepEqual(selected.working, loaded.working);
  assert.deepEqual(selected.revisions, loaded.revisions);
  assert.deepEqual(selected.workingContext, loaded.workingContext);
  replacement.structure = 'Later mutation';
  assert.equal(selected.templateSnapshot?.structure, 'A new structure');
});

test('legacy letters pin the matching current template once without changing text, settings or review history', () => {
  const storage = memory();
  const repository = createLetterRepository(storage, 'owner');
  const legacy = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  delete legacy.templateSnapshot;
  legacy.maxWords = 400;
  const current = repository.saveTemplate({ ...template, tone: 'Current tone', exampleText: 'Example wording.' });
  repository.save(legacy);
  const loaded = repository.load('app')!;
  const pinned = { ...current }; delete pinned.useMetaSearchInterests;
  assert.deepEqual(loaded.templateSnapshot, pinned);
  const { templateSnapshot: _snapshot, ...rest } = loaded;
  assert.deepEqual(rest, legacy);
  repository.saveTemplate({ ...current, tone: 'A later tone' });
  assert.deepEqual(repository.load('app')?.templateSnapshot, pinned);
  assert.equal(JSON.parse(repository.exportLetter('app')).templateSnapshot.tone, 'Current tone');

  const unknown = { ...legacy, applicationId: 'missing-template', templateId: 'removed-template' };
  repository.save(unknown);
  assert.deepEqual(repository.load(unknown.applicationId), unknown, 'a missing template must not be silently replaced');
});

test('example letter bounds, template backups and application backups preserve frozen reference wording', () => {
  assert.equal(readLetterTemplate(template).exampleText, '');
  assert.equal(readLetterTemplate({ ...template, exampleText: 'a'.repeat(20000) }).exampleText?.length, 20000);
  for (const exampleText of [42, 'a'.repeat(20001)]) assert.throws(() => readLetterTemplate({ ...template, exampleText }), /example letter/);
  const repository = createLetterRepository(memory(), 'owner');
  const saved = repository.saveTemplate({ ...template, exampleText: 'Reference introduction and closing.' });
  const imported = repository.importTemplates(repository.exportTemplates()).find((item) => item.name === saved.name)!;
  assert.equal(imported.exampleText, saved.exampleText);
  const letter = createApplicationLetter('owner', 'app', saved, version);
  repository.save(letter);
  assert.deepEqual(repository.importLetter(repository.exportLetter('app'), 'app').templateSnapshot, saved);
  assert.throws(() => repository.save({ ...letter, templateSnapshot: { ...saved, id: 'wrong-template' } }), /does not match/);
});

test('empty optional examples preserve legacy context fingerprints and nonempty examples change context', () => {
  const { exampleText: _example, ...legacyTemplate } = template;
  const application = { context_json: {}, cv_variant_id: null };
  const before = letterContextVersion(application, null, legacyTemplate, 'en', '', 450);
  assert.deepEqual(letterContextVersion(application, null, { ...legacyTemplate, exampleText: '' }, 'en', '', 450), before);
  assert.notEqual(letterContextVersion(application, null, { ...legacyTemplate, exampleText: 'New style example' }, 'en', '', 450).content, before.content);
});

test('research interests and question guidance retain explicit context in template and letter backups', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const saved = repository.saveTemplate({ ...template, researchInterests: 'Interpretable robotics and sensor fusion.', questionGuidance: 'If field deployment is useful and absent from the CV, ask for one relevant example.', refinementSystemPrompt: 'Keep only answers that support my research narrative.' });
  const imported = repository.importTemplates(repository.exportTemplates()).find((item) => item.name === saved.name)!;
  assert.equal(imported.researchInterests, saved.researchInterests);
  assert.equal(imported.questionGuidance, saved.questionGuidance);
  assert.equal(imported.refinementSystemPrompt, saved.refinementSystemPrompt);
  const letter = createApplicationLetter('owner', 'app', saved, version);
  repository.save(letter);
  assert.deepEqual(repository.importLetter(repository.exportLetter('app'), 'app').templateSnapshot, saved);
  for (const key of ['researchInterests', 'questionGuidance', 'refinementSystemPrompt'] as const) {
    assert.equal(readLetterTemplate({ ...template, [key]: 'a'.repeat(4000) })[key]?.length, 4000);
    for (const invalid of [null, 42, [], 'a'.repeat(4001)]) {
      assert.throws(() => readLetterTemplate({ ...template, [key]: invalid }), /Research interests, question guidance and the refinement system prompt/);
    }
  }
});

test('legacy template imports and frozen snapshots do not acquire new interests or question guidance', () => {
  const { researchInterests: _interests, questionGuidance: _questions, refinementSystemPrompt: _refinement, ...legacyTemplate } = template;
  assert.deepEqual(readLetterTemplate(legacyTemplate), legacyTemplate);
  const repository = createLetterRepository(memory(), 'owner');
  const [imported] = repository.importTemplates(JSON.stringify({ format: 'cv-letter-templates', version: 1, templates: [legacyTemplate] }));
  assert.equal('researchInterests' in imported, false);
  assert.equal('questionGuidance' in imported, false);
  assert.equal('refinementSystemPrompt' in imported, false);
  const record = createApplicationLetter('owner', 'app', legacyTemplate, version);
  repository.save(record);
  assert.deepEqual(repository.load('app')?.templateSnapshot, legacyTemplate);
  assert.equal(DEFAULT_LETTER_TEMPLATES.every((item) => item.researchInterests === ''), true);
  assert.equal(DEFAULT_LETTER_TEMPLATES.every((item) => item.questionGuidance === DEFAULT_QUESTION_GUIDANCE), true);
  assert.equal(DEFAULT_LETTER_TEMPLATES.every((item) => item.refinementSystemPrompt === DEFAULT_REFINEMENT_SYSTEM_PROMPT), true);
});

test('empty new template fields preserve legacy fingerprints while explicit interests and questions require review', () => {
  const { researchInterests: _interests, questionGuidance: _questions, refinementSystemPrompt: _refinement, ...legacyTemplate } = template;
  const application = { context_json: {}, cv_variant_id: null };
  const before = letterContextVersion(application, null, legacyTemplate, 'en', '', 450);
  const explicitEmpty = { ...legacyTemplate, researchInterests: '', questionGuidance: '', refinementSystemPrompt: '' };
  assert.deepEqual(letterContextVersion(application, null, explicitEmpty, 'en', '', 450), before);
  for (const change of [{ researchInterests: 'Robotics.' }, { questionGuidance: 'Ask about missing qualification evidence.' }, { refinementSystemPrompt: 'Evaluate relevance before including answers.' }]) {
    const changed = letterContextVersion(application, null, { ...explicitEmpty, ...change }, 'en', '', 450);
    assert.notEqual(changed.content, before.content);
    assert.equal(changed.theme, before.theme);
  }
});

test('legacy template libraries receive editable defaults and retain explicit guidance in backups', () => {
  const { subjectInstructions, salutationInstructions, closingInstructions, ...legacy } = template;
  const read = readLetterTemplate(legacy);
  assert.equal(read.subjectInstructions, DEFAULT_TEMPLATE_GUIDANCE.subjectInstructions);
  assert.equal(read.salutationInstructions, DEFAULT_TEMPLATE_GUIDANCE.salutationInstructions);
  assert.equal(read.closingInstructions, DEFAULT_TEMPLATE_GUIDANCE.closingInstructions);
  const repository = createLetterRepository(memory(), 'owner');
  const saved = repository.saveTemplate({ ...read, subjectInstructions: 'Include the tender reference.', salutationInstructions: 'Address the named supervisor.', closingInstructions: 'Close with a short invitation.' });
  const imported = repository.importTemplates(repository.exportTemplates()).find((item) => item.name === saved.name)!;
  assert.equal(imported.subjectInstructions, saved.subjectInstructions);
  assert.equal(imported.salutationInstructions, saved.salutationInstructions);
  assert.equal(imported.closingInstructions, saved.closingInstructions);
  assert.throws(() => readLetterTemplate({ ...legacy, subjectInstructions: 42 }), /instructions/);
  assert.throws(() => readLetterTemplate({ ...legacy, closingInstructions: 'a'.repeat(1001) }), /instructions/);
});

test('complete-letter editing preserves every legacy block and old revisions while making all wording editable', () => {
  const original = finalizeLetter(editLetter(createApplicationLetter('owner', 'app', template, version), content), version, contact);
  const fullText = letterToEditableText(original.working);
  for (const part of Object.values(content)) assert.ok(fullText.includes(part));
  const changed = fullText.replace('Dear committee,', 'Dear Dr. Example,').replace('Kind regards,', 'Yours sincerely,');
  const updated = editLetter(original, letterFromEditableText(changed));
  assert.equal(updated.working.subject, content.subject);
  assert.equal(updated.working.salutation, '');
  assert.equal(updated.working.closing, '');
  assert.ok(updated.working.body.includes('Dear Dr. Example,'));
  assert.ok(updated.working.body.includes('Yours sincerely,'));
  assert.equal(letterToEditableText(updated.working), changed);
  assert.equal(updated.finalRevisionId, null);
  assert.deepEqual(updated.revisions[0].content, content);
  assert.deepEqual(original.working, content);
  const repository = createLetterRepository(memory(), 'owner');
  repository.save(updated);
  assert.deepEqual(repository.importLetter(repository.exportLetter('app'), 'app').working, updated.working);
});

test('complete-letter editor supports plain text, empty text and body whitespace without hidden extra blocks', () => {
  for (const body of ['', 'A complete letter without a subject', '\nOpening\n\n\nBody\n\nClosing\n']) {
    assert.equal(letterToEditableText(letterFromEditableText(body)), body);
  }
  assert.deepEqual(letterFromEditableText('# Subject only'), { subject: 'Subject only', salutation: '', body: '', closing: '' });
});

test('incoming subjects map to the header across plain text and common ChatGPT heading styles', () => {
  const subject = 'Application for a PhD in Robotics (REF-42)';
  const body = 'Dear Selection Committee,\n\nMy research fits this position.\n\nYours sincerely,\n{{APPLICANT_NAME}}';
  for (const heading of [subject, `Subject: ${subject}`, `Re: ${subject}`, `# ${subject}`, `## ${subject}`, `**${subject}**`, `**Subject:** ${subject}`, `**Subject**: ${subject}`, `Subject: **${subject}**`, `**Subject: ${subject}**`]) {
    for (const separator of ['\n', '\n\n', '\r\n\r\n']) {
      const incoming = `\n  ${heading}${separator}${body}`;
      const parsed = letterFromEditableText(incoming);
      assert.deepEqual(parsed, { subject, salutation: '', body, closing: '' }, heading);
      assert.equal(letterToEditableText(parsed), `# ${subject}\n\n${body}`);
      assert.deepEqual(parseIncomingLetter(incoming), parsed);
    }
  }
  const germanBody = 'Sehr geehrte Frau Prof. Beispiel,\n\nHiermit bewerbe ich mich.\n\nMit freundlichen Grüßen\n{{APPLICANT_NAME}}';
  for (const heading of ['Bewerbung um eine Promotionsstelle', 'Betreff: Bewerbung um eine Promotionsstelle', '**Betreff:** Bewerbung um eine Promotionsstelle']) {
    assert.deepEqual(letterFromEditableText(`${heading}\n\n${germanBody}`), { subject: 'Bewerbung um eine Promotionsstelle', salutation: '', body: germanBody, closing: '' });
  }
  assert.equal(letterFromEditableText('Subject: Research application\n\nOpening paragraph without a salutation.').subject, 'Research application');
});

test('subject mapping leaves unmarked prose and body whitespace intact', () => {
  for (const body of [
    'Dear Selection Committee,\n\nI am applying for this position.',
    'Sehr geehrte Damen und Herren,\n\nHiermit bewerbe ich mich.',
    'My research interests\n\nI study human-computer interaction.',
    'Dear Committee,\n\nSubject: this is an example in the body.',
    'Subject:\n\nI have not entered a subject yet.',
    '\nOpening\n\n\nBody\n\nClosing\n',
  ]) assert.deepEqual(letterFromEditableText(body), { subject: '', salutation: '', body, closing: '' });
  const body = '\n  Dear Committee,\r\n\r\nBody with  deliberate  spacing.\n\nClosing\n';
  assert.equal(letterFromEditableText(`Subject: Research application\n\n${body}`).body, body);
});

test('backup restore rejects a different application or account and retains published context tracking', () => {
  const repository = createLetterRepository(memory(), 'owner');
  const record = createApplicationLetter('owner', 'app', template, version);
  record.publishedContexts['cloud-context-1'] = version;
  repository.save(record);
  const json = repository.exportLetter('app');
  const other = createLetterRepository(memory(), 'someone-else');
  assert.throws(() => other.importLetter(json, 'app'), /Stored letter could not be read/);
  assert.throws(() => repository.importLetter(json, 'different-app'), /Stored letter could not be read/);
  assert.deepEqual(repository.importLetter(json, 'app').publishedContexts, record.publishedContexts);
});

test('damaged storage and quota errors surface instead of silently replacing user work', () => {
  const storage = memory();
  const repository = createLetterRepository(storage, 'owner');
  repository.save(createApplicationLetter('owner', 'app', template, version));
  const key = [...storage.values.keys()][0];
  storage.values.set(key, '{invalid');
  assert.throws(() => repository.load('app'));
  assert.equal(storage.values.get(key), '{invalid');
  const failing = createLetterRepository({ getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } }, 'owner');
  assert.throws(() => failing.save(createApplicationLetter('owner', 'app', template, version)), /Quota exceeded/);
});

test('plain text and structured generated drafts import as inert content', () => {
  assert.equal(parseIncomingLetter('<script>alert(1)</script>').body, '<script>alert(1)</script>');
  assert.deepEqual(parseIncomingLetter('```json\n{"subject":"Subject","body":"Body"}\n```'), { subject: 'Subject', salutation: '', body: 'Body', closing: '' });
  assert.throws(() => parseIncomingLetter('{"subject":"Missing body"}'), /needs a body/);
  assert.throws(() => parseIncomingLetter('{"body":2}'), /needs a body/);
});

test('default letter preferences persist per account and resolve the latest saved revision', () => {
  const storage = memory();
  const first = createLetterRepository(storage, 'owner');
  const second = createLetterRepository(storage, 'other');
  assert.equal(first.defaultTemplate()?.id, 'research');
  first.setDefaultTemplate('industry');
  assert.equal(createLetterRepository(storage, 'owner').defaultTemplate()?.id, 'industry');
  assert.equal(second.defaultTemplate()?.id, 'research');
  const updated = first.saveTemplate({ ...first.defaultTemplate()!, maxWords: 600 });
  assert.deepEqual(first.defaultTemplate(), updated);
  assert.throws(() => first.setDefaultTemplate('unsaved'), /Save the letter template/);
  assert.equal(first.defaultTemplate()?.id, 'industry');
  storage.setItem('cv.letters.v1:owner:templates', JSON.stringify([DEFAULT_LETTER_TEMPLATES[0]]));
  assert.equal(first.defaultTemplate()?.id, 'research', 'removed defaults fall back to an available template');
});

test('the shared-interest checkbox validates and migrates only the live library, not frozen snapshots', () => {
  const current = DEFAULT_LETTER_TEMPLATES[0]!;
  const legacy = { ...current }; delete legacy.useMetaSearchInterests;
  assert.equal(readLetterTemplate(legacy).useMetaSearchInterests, undefined);
  assert.throws(() => readLetterTemplate({ ...legacy, useMetaSearchInterests: 'true' }), /checkbox value/);
  const values = new Map<string, string>([['cv.letters.v1:owner:templates', JSON.stringify([legacy])]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const repository = createLetterRepository(storage, 'owner');
  const letter = createApplicationLetter('owner', 'app', legacy, { content: 'frozen', theme: 'theme' });
  repository.save(letter);
  assert.equal(repository.listTemplates()[0]!.useMetaSearchInterests, true);
  assert.equal(repository.load('app')!.templateSnapshot!.useMetaSearchInterests, undefined);
});
