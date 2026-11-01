import assert from 'node:assert/strict';
import test from 'node:test';
import type { LetterContent, LetterTemplate } from '../../../src/documents/letter/letterTypes';
import type { LocalRefinementRequest, RefinementFeedback } from '../../../src/features/refinement/refinementTypes';
import { prepareRefinement, refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES, readLetterTemplate } from '../../../src/documents/letter/motivationLetters';
import { refinementInputsSignature, resolveRefinementSettings, sameRefinementInputs, serializeRefinementDraft } from '../../../src/features/refinement/domain/refinementSources';
import { createTestState } from '../../support/fixtures/cvState';

const applicationId = '83000000-0000-4000-8000-000000000001';
const template: LetterTemplate = { ...DEFAULT_LETTER_TEMPLATES[0], language: 'de', maxWords: 450, exampleText: 'A style example.' };
const empty: LetterContent = { subject: '', salutation: '', body: '', closing: '' };
function prepare(overrides: Partial<Parameters<typeof prepareRefinement>[0]> = {}) {
  const state = createTestState({ about: { text: 'Public research with {{private partner}}.' } });
  return prepareRefinement({ applicationId, state, variantId: 'local-cv-template', setup: resolveRefinementSettings(template).setup,
    letterText: 'Dear committee,\n\nCurrent draft.\n\nKind regards', opportunity: { title: 'PhD opportunity' },
    scope: 'letter', feedback: [], parentProposalId: null, baselineSignature: refinementSignature([state, 'working letter baseline']), ...overrides });
}

test('effective document settings come from application overrides or the frozen template with accurate provenance', () => {
  const before = structuredClone(template);
  assert.deepEqual(resolveRefinementSettings(template), { setup: { template, language: 'de', maxWords: 450 }, provenance: { language: 'template', maxWords: 'template' } });
  assert.deepEqual(resolveRefinementSettings(template, { language: 'en', maxWords: 400 }), {
    setup: { template, language: 'en', maxWords: 400 }, provenance: { language: 'application', maxWords: 'application' },
  });
  assert.deepEqual(resolveRefinementSettings(template, { language: '   ', maxWords: 400 }), {
    setup: { template, language: 'de', maxWords: 400 }, provenance: { language: 'template', maxWords: 'application' },
  });
  assert.deepEqual(resolveRefinementSettings(template, { language: 'en', maxWords: null }), {
    setup: { template, language: 'en', maxWords: 450 }, provenance: { language: 'application', maxWords: 'template' },
  });
  assert.deepEqual(resolveRefinementSettings(template, null), resolveRefinementSettings(template));
  assert.deepEqual(template, before);
});

test('an invalid present word target is not disguised as a template fallback', () => {
  const resolved = resolveRefinementSettings(template, { maxWords: 0 });
  assert.equal(resolved.setup.maxWords, 0);
  assert.equal(resolved.provenance.maxWords, 'application');
  assert.throws(() => prepare({ setup: resolved.setup }), /letter settings/);
});

test('draft serialization keeps subject, greeting, body and closing and distinguishes an empty draft', () => {
  const working: LetterContent = { subject: 'Application for PhD', salutation: 'Dear committee,', body: 'First paragraph.\n\nSecond paragraph.', closing: 'Kind regards,\nApplicant' };
  const before = structuredClone(working);
  assert.deepEqual(serializeRefinementDraft(working), { text: '# Application for PhD\n\nDear committee,\n\nFirst paragraph.\n\nSecond paragraph.\n\nKind regards,\nApplicant', empty: false });
  assert.deepEqual(working, before);
  for (const draft of [null, undefined, empty, { subject: '  ', salutation: '\n', body: '\t ', closing: '  ' }]) assert.deepEqual(serializeRefinementDraft(draft), { text: '', empty: true });
  for (const key of ['subject', 'salutation', 'body', 'closing'] as const) assert.equal(serializeRefinementDraft({ ...empty, [key]: 'Only this part is drafted.' }).empty, false, key);
});

test('the complete serialized draft passes through the existing privacy boundary before shared preview or publication', () => {
  const state = createTestState();
  state.contact.name = 'Taylor Example'; state.contact.email = 'private@example.org';
  const working: LetterContent = { subject: 'Taylor Example — PhD application', salutation: 'Dear committee,', body: 'Evidence from !!private experiment!!. Contact private@example.org.', closing: 'Kind regards,\nTaylor Example' };
  const draft = serializeRefinementDraft(working);
  const local = prepare({ state, letterText: draft.text });
  assert.equal(draft.empty, false);
  assert.equal(local.request.letter.text, '# {{APPLICANT_NAME}} — PhD application\n\nDear committee,\n\nEvidence from !!private experiment!!. Contact {{APPLICANT_EMAIL}}.\n\nKind regards,\n{{APPLICANT_NAME}}');
  assert.equal(working.closing, 'Kind regards,\nTaylor Example', 'the local original is unchanged');
});

test('freshness ignores generated request identifiers and JSON key order while retaining the private baseline', () => {
  const first = prepare(); const second = prepare();
  assert.notEqual(first.request.requestId, second.request.requestId);
  assert.notEqual(first.request.cv.requestId, second.request.cv.requestId);
  assert.equal(refinementInputsSignature(first), refinementInputsSignature(second));
  assert.equal(sameRefinementInputs(first, second), true);
  second.request.cv.opportunity = { extra: { a: 1, b: 2 }, title: 'PhD opportunity' };
  first.request.cv.opportunity = { title: 'PhD opportunity', extra: { b: 2, a: 1 } };
  assert.equal(sameRefinementInputs(first, second), true);
  assert.equal(sameRefinementInputs(first, null), false);
  assert.equal(sameRefinementInputs(undefined, first), false);
  assert.equal(sameRefinementInputs(null, undefined), false);
});

test('changes to every source, effective setting, selected scope, feedback or lineage make the saved request outdated', () => {
  const first = prepare();
  const feedback: RefinementFeedback = { id: crypto.randomUUID(), scope: 'letter', text: 'Retain my correction.', createdAt: '2026-10-01T10:00:00Z' };
  const changes: [string, (next: LocalRefinementRequest) => void][] = [
    ['application', next => { next.request.applicationId = crypto.randomUUID(); }],
    ['opportunity', next => { next.request.cv.opportunity.title = 'Updated tender'; }],
    ['CV public wording', next => { next.request.cv.fields[0].text += ' revised'; }],
    ['application instructions', next => { next.request.cv.instructions = 'Use a concise opening.'; }],
    ['current letter', next => { next.request.letter.text += '\nManual correction'; }],
    ['frozen template revision', next => { next.request.letter.template.revision++; }],
    ['template example', next => { next.request.letter.template.exampleText = 'Updated style'; }],
    ['research interests', next => { next.request.letter.template.researchInterests = 'New interest in robust perception.'; }],
    ['question context', next => { next.request.letter.template.questionGuidance = 'Ask about field deployment evidence when relevant.'; }],
    ['refinement system prompt', next => { next.request.letter.template.refinementSystemPrompt = 'Keep only details that support the central narrative.'; }],
    ['language', next => { next.request.letter.language = 'en'; }],
    ['word target', next => { next.request.letter.maxWords = 400; }],
    ['scope', next => { next.request.scope = 'cv'; }],
    ['feedback', next => { next.request.feedback = [feedback]; }],
    ['parent proposal', next => { next.request.parentProposalId = crypto.randomUUID(); }],
    ['local document baseline', next => { next.baselineSignature = refinementSignature('new local letter'); }],
    ['private reconstruction baseline', next => { next.cv.baselineState.about.text = 'Public research with {{different private partner}}.'; }],
    ['selected CV template', next => { next.cv.sourceVariantId = 'another-local-template'; }],
    ['local public projection', next => { next.cv.publicRequest.fields[0].text = 'Inconsistent local projection'; }],
    ['missing privacy mappings', next => { next.cv.bindings = []; }],
    ['private token original', next => { const binding = next.cv.bindings.find(item => Object.keys(item.tokens).length)!; binding.tokens[Object.keys(binding.tokens)[0]] = 'Lost original'; }],
    ['missing structural mappings', next => { delete next.structureBindings; }],
    ['missing original letter', next => { delete next.letterBaseline; }],
    ['original private letter', next => { next.letterBaseline!.text = 'Different private original'; }],
    ['missing source integrity', next => { delete next.sourceSignatures; }],
    ['mismatched public CV reference', next => { next.request.cv.requestId = crypto.randomUUID(); }],
    ['mismatched local CV reference', next => { next.cv.publicRequest.requestId = crypto.randomUUID(); }],
  ];
  for (const [name, change] of changes) {
    const next = structuredClone(first); change(next);
    assert.equal(sameRefinementInputs(first, next), false, name);
  }
});

test('preparing revised interests or question guidance requires a fresh request while reading legacy templates preserves reuse', () => {
  const { researchInterests: _interests, questionGuidance: _questions, refinementSystemPrompt: _refinement, ...legacyTemplate } = template;
  const legacy = prepare({ setup: resolveRefinementSettings(legacyTemplate).setup });
  const reread = prepare({ setup: resolveRefinementSettings(readLetterTemplate(legacyTemplate)).setup });
  assert.equal(sameRefinementInputs(legacy, reread), true, 'legacy frozen guidance must not acquire new defaults on read');
  assert.equal(Object.hasOwn(reread.request.letter.template, 'researchInterests'), false);
  assert.equal(Object.hasOwn(reread.request.letter.template, 'questionGuidance'), false);
  assert.equal(Object.hasOwn(reread.request.letter.template, 'refinementSystemPrompt'), false);
  for (const change of [{ researchInterests: 'Robust perception.' }, { questionGuidance: 'Ask about relevant field testing.' }, { refinementSystemPrompt: 'Ask a focused follow-up for vague answers.' }]) {
    const updated = prepare({ setup: resolveRefinementSettings({ ...legacyTemplate, ...change }).setup });
    assert.equal(sameRefinementInputs(legacy, updated), false);
    assert.notEqual(updated.sourceSignatures?.letter, legacy.sourceSignatures?.letter, 'the frozen local letter source must track the changed context');
  }
});

test('reconstruction fields distinguish incomplete pending caches while publication and acceptance receipts do not change source identity', () => {
  const current = prepare(); const oldPending = structuredClone(current);
  delete oldPending.letterBaseline; delete oldPending.sourceSignatures;
  assert.equal(sameRefinementInputs(oldPending, current), false, 'a fresh preparation must not reuse an incomplete old local request');
  const published = structuredClone(current);
  published.publishedAt = '2026-10-02T10:00:00Z';
  published.acceptances = [{ key: refinementSignature('accepted selection'), proposalId: crypto.randomUUID(), variantId: 'saved-subvariant', acceptedAt: published.publishedAt, reviewId: crypto.randomUUID() }];
  assert.equal(sameRefinementInputs(current, published), true);
});

test('ordered feedback remains part of freshness and no feedback entry is silently ignored', () => {
  const feedback: RefinementFeedback[] = [
    { id: crypto.randomUUID(), scope: 'letter', text: 'Use a formal opening.', createdAt: '2026-10-01T10:00:00Z' },
    { id: crypto.randomUUID(), scope: 'letter', text: 'Prefer a warmer opening instead.', createdAt: '2026-10-01T10:01:00Z' },
  ];
  const first = prepare({ feedback }); const second = prepare({ feedback: [...feedback].reverse() });
  assert.equal(sameRefinementInputs(first, second), false, 'later corrections have different precedence');
  const missing = prepare({ feedback: feedback.slice(1) });
  assert.equal(sameRefinementInputs(first, missing), false);
});
