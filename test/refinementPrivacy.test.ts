import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRefinementPrompt, parseRefinementProposal, prepareRefinement, reconstructRefinementProposal, refinementSignature, sanitizeRefinementText } from '../src/features/refinement/applicationRefinement';
import { privacyContextTargets, privacySegments, redactFieldOriginals, validatePrivacyLegend } from '../src/features/refinement/domain/refinementPrivacy';
import { validatePrivateTokenLines } from '../src/features/refinement/domain/cvAdjustments';
import { DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import type { ApprovedPrivacyContexts, RefinementProposalV2 } from '../src/features/refinement/refinementTypes';
import { createTestState } from './helpers';

const APP = 'a0000000-0000-4000-8000-000000000001';
const state = () => createTestState({
  contact: { name: 'Taylor Secret', email: 'private@example.invalid', role: 'Engineer', location: 'Berlin', phone: '', website: '', linkedin: '', github: '' },
  about: { text: 'Public employer in Berlin. [Public report](https://public.example.invalid).' },
  experience: { jobs: [{ id: 'local-job', title: 'Engineer', bullets: '- Built precise sensors at {{Secret Works}}.\n- Evaluated existing results with {{Secret Lab}}.' }, { id: 'hidden-job', title: 'Unshared job', hidden: true }] },
});
function prepare(overrides: Partial<Parameters<typeof prepareRefinement>[0]> = {}) {
  return prepareRefinement({ applicationId: APP, state: state(), variantId: 'local-variant', setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 },
    letterText: 'Existing letter.', opportunity: {}, scope: 'cv', feedback: [], parentProposalId: null, baselineSignature: refinementSignature('baseline'), ...overrides });
}
const proposal = (local: ReturnType<typeof prepare>, changes: RefinementProposalV2['cvOperations'] = []): RefinementProposalV2 => ({ schemaVersion: 2, requestId: local.request.requestId, summary: 'Concise evidence.', cvOperations: changes, cvComments: [], letterText: local.request.letter.text });

test('descriptions require explicit local approval and publish only the exact public legend', () => {
  const local = prepare();
  assert.equal(local.request.privacyLegend, undefined);
  const targets = privacyContextTargets(local.cv, refinementSignature);
  assert.equal(targets.length, 2);
  const approved: ApprovedPrivacyContexts = { [targets[0].sourceKey]: { type: 'organization', description: 'Engineering company specializing in sensor technology' } };
  const prepared = prepare({ privacyContexts: approved });
  assert.deepEqual(prepared.request.privacyLegend, [{ fieldId: targets[0].fieldId, token: targets[0].token, type: 'organization', description: approved[targets[0].sourceKey].description }]);
  const wire = JSON.stringify(prepared.request);
  for (const secret of ['Secret Works', 'Secret Lab', 'Taylor Secret', 'private@example.invalid', 'Unshared job', 'local-job', 'local-variant', targets[0].sourceKey, 'bindings', 'baselineState']) assert.equal(wire.includes(secret), false, secret);
  assert.deepEqual(reconstructRefinementProposal(prepared, proposal(prepared), [], APP).state, reconstructRefinementProposal(local, proposal(local), [], APP).state);
  assert.match(buildRefinementPrompt(prepared.request, 'test-project'), /context only, never substitutes for tokens/);
});

test('approvals follow the exact private source rather than reused public token numbers', () => {
  const source = state(), local = prepare({ state: source });
  const target = privacyContextTargets(local.cv, refinementSignature)[0];
  const privacyContexts: ApprovedPrivacyContexts = { [target.sourceKey]: { type: 'organization', description: 'Sensor company' } };
  source.about.text = 'Research with {{New first secret}}.';
  const renumbered = prepare({ state: source, privacyContexts });
  assert.equal(renumbered.request.privacyLegend?.[0].token, '{{PRIVATE_2}}');
  assert.equal(renumbered.request.privacyLegend?.length, 1);
  source.experience.jobs[0].bullets = source.experience.jobs[0].bullets!.replace('Secret Works', 'Different Works');
  assert.equal(prepare({ state: source, privacyContexts }).request.privacyLegend, undefined);
  assert.equal(prepare({ privacyContexts, variantId: 'other-variant' }).request.privacyLegend, undefined);
});

test('exclamation marks are ordinary text in feedback, instructions, templates and descriptions', () => {
  const source = state();
  const text = 'Taylor Secret worked with !!John Doe!!. private@example.invalid';
  const local = prepare({ state: source, instructions: text, letterText: text, opportunity: { notes: text },
    setup: { template: { ...DEFAULT_LETTER_TEMPLATES[0], exampleText: text }, language: 'en', maxWords: 400 },
    feedback: [{ id: crypto.randomUUID(), text, scope: 'cv', createdAt: '2026-10-02T00:00:00Z' }] });
  assert.ok(local.request.cv.instructions.includes('!!John Doe!!'));
  assert.ok(local.request.letter.text.includes('!!John Doe!!'));
  assert.ok(local.request.letter.template.exampleText!.includes('!!John Doe!!'));
  assert.ok(local.request.feedback[0].text.includes('!!John Doe!!'));
  assert.equal(sanitizeRefinementText(text, source), '{{APPLICANT_NAME}} worked with !!John Doe!!. {{APPLICANT_EMAIL}}');
  const target = privacyContextTargets(local.cv, refinementSignature)[0];
  assert.doesNotThrow(() => prepare({ privacyContexts: { [target.sourceKey]: { type: 'organization', description: 'Literal !!punctuation!!' } } }));
  assert.equal(redactFieldOriginals('!!John Doe!!', source), '!!John Doe!!');
});

test('field-type protection reaches refinement instructions, opportunities, letters, feedback and approved descriptions', () => {
  const source = state();
  source.anonymization.proxyFields = ['company', 'institution', 'place', 'dates'];
  source.experience.jobs[0].company = 'Confidential Engineering';
  source.experience.jobs[0].place = 'Confidential Town';
  source.education = [{ id: 'degree', institution: 'Confidential Institute', start: '2011', end: '2015' }];
  const text = 'Confidential Engineering in Confidential Town; Confidential Institute from 2011 to 2015.';
  source.about.text = text;
  const local = prepare({ state: source, instructions: text, letterText: text, opportunity: { notes: text },
    setup: { template: { ...DEFAULT_LETTER_TEMPLATES[0], exampleText: text, tone: text }, language: 'en', maxWords: 400 },
    feedback: [{ id: crypto.randomUUID(), text, scope: 'cv', createdAt: '2026-10-02T00:00:00Z' }] });
  for (const original of ['Confidential Engineering', 'Confidential Town', 'Confidential Institute', '2011', '2015']) {
    assert.equal(JSON.stringify(local.request).includes(original), false, original);
    assert.equal(sanitizeRefinementText(original, source), '{{CONFIDENTIAL}}');
  }
  assert.deepEqual(reconstructRefinementProposal(local, proposal(local), [], APP).state, source);
  const target = privacyContextTargets(local.cv, refinementSignature).find(target => target.label === 'Experience 1: company')!;
  assert.ok(target);
  assert.throws(() => prepare({ state: source, privacyContexts: { [target.sourceKey]: { type: 'organization', description: 'Worked at Confidential Engineering' } } }), /protected text/);
  source.experience.jobs[0].company = 'A';
  assert.equal(sanitizeRefinementText('Annual evidence [A](https://company.example.test) A', source), 'Annual evidence {{CONFIDENTIAL}} {{CONFIDENTIAL}}');
});

test('legend validation rejects invented references, hidden mappings, invalid types and unsafe descriptions', () => {
  const local = prepare(), field = local.request.cv.fields.find(field => field.text.includes('{{PRIVATE_1}}'))!;
  const entry = { fieldId: field.id, token: '{{PRIVATE_1}}', type: 'organization', description: 'Sensor company' };
  for (const value of [null, {}, [entry, entry], [{ ...entry, original: 'Private original' }], [{ ...entry, fieldId: 'field-999' }], [{ ...entry, token: '{{PRIVATE_999}}' }], [{ ...entry, type: 'inferred' }], ...['', ' '.repeat(3), 'a'.repeat(501), '😀'.repeat(251), '{{PRIVATE_1}}', '<b>HTML</b>', 'two\nlines'].map(description => [{ ...entry, description }])]) {
    assert.throws(() => validatePrivacyLegend(value, local.request.cv.fields));
    assert.throws(() => parseRefinementProposal(proposal(local), { ...local.request, privacyLegend: value } as typeof local.request));
  }
  validatePrivacyLegend([{ ...entry, description: '😀'.repeat(250) }], local.request.cv.fields);
  validatePrivacyLegend([], local.request.cv.fields);
});

test('visible employers, locations and links remain classified visible beside pseudonyms', () => {
  const parts = privacySegments('Public employer, Berlin, https://public.example.invalid {{PRIVATE_1}} {{APPLICANT_NAME}} {{CONFIDENTIAL}}');
  assert.deepEqual(parts.filter(part => part.status === 'pseudonymized').map(part => part.text), ['{{PRIVATE_1}}', '{{APPLICANT_NAME}}', '{{CONFIDENTIAL}}']);
  assert.match(parts[0].text, /Public employer, Berlin, https:/);
  assert.equal(parts[0].status, 'visible');
});

test('whole bullets carry their private tokens; omission never deletes local originals or mappings', () => {
  const local = prepare(); assert.equal(local.request.schemaVersion, 2); if (local.request.schemaVersion !== 2) return;
  const before = structuredClone(local), entry = local.request.cvStructure.entries.find(entry => entry.bulletIds.length === 2)!;
  const reordered = reconstructRefinementProposal(local, proposal(local, [{ id: 'change-1', type: 'reorder_bullets', targetId: entry.id, order: [...entry.bulletIds].reverse(), explanation: 'Prioritize evaluation.' }]), undefined, APP);
  assert.match(reordered.state.experience.jobs[0].bullets!, /^- Evaluated existing results with {{Secret Lab}}\./);
  const omitted = reconstructRefinementProposal(local, proposal(local, [{ id: 'change-1', type: 'omit_bullet', targetId: entry.bulletIds[0], explanation: 'Omit unrelated work.' }]), undefined, APP);
  assert.equal(omitted.state.experience.jobs[0].bullets!.includes('Secret Works'), false);
  assert.deepEqual(local, before);
  const range = local.request.cvStructure.ranges.find(range => range.bulletId === entry.bulletIds[0])!;
  assert.throws(() => parseRefinementProposal(proposal(local, [{ id: 'change-1', type: 'shorten_text', targetId: range.id, text: range.text.replace('{{PRIVATE_1}}', '{{PRIVATE_2}}'), explanation: 'Invalid token transfer.' }]), local.request), /token|shorten|extractive/i);
  assert.throws(() => validatePrivateTokenLines('Work {{PRIVATE_1}}.\nUnrelated work.', 'Work.\nUnrelated work {{PRIVATE_1}}.'), /attached/);
  validatePrivateTokenLines('Work {{PRIVATE_1}}.\r\nOther.', 'Relevant work {{PRIVATE_1}}.\nOther.');
});


test('manual privacy prose is useful public context but only original sections and entries can be reordered', () => {
  const source = state();
  source.about.text = 'Worked under supervision of John Doe.';
  source.anonymization.fieldOverrides = {
    '["about","text"]': 'Worked under supervision of a qualified person.',
    '["item","local-job","bullets"]': '- Built precise sensors with a qualified person.\n- Evaluated existing results.',
  };
  const local = prepare({ state: source });
  assert.equal(local.request.schemaVersion, 2); if (local.request.schemaVersion !== 2) return;
  const profile = local.request.cv.fields.find(field => field.label.startsWith('Profile'))!;
  const bullets = local.request.cv.fields.find(field => field.label.startsWith('Experience 1: bullets'))!;
  assert.equal(profile.text, 'Worked under supervision of a qualified person.');
  assert.match(bullets.text, /qualified person/);
  for (const field of [profile, bullets]) {
    assert.ok(local.request.cvStructure.unsupported.some(item => item.fieldId === field.id && item.reason.includes('Privacy replacement')));
    assert.ok(!local.request.cvStructure.ranges.some(item => item.fieldId === field.id));
    assert.ok(!local.request.cvStructure.bullets.some(item => item.fieldId === field.id));
  }
  assert.equal(JSON.stringify(local.request).includes('John Doe'), false);
  const area = local.request.cvStructure.areas.find(area => area.id === 'body')!;
  const reordered = reconstructRefinementProposal(local, proposal(local, [{ id: 'change-1', type: 'reorder_sections', targetId: 'body', order: [...area.sectionIds].reverse(), explanation: 'Prioritize experience.' }]), undefined, APP);
  assert.equal(reordered.state.about.text, source.about.text);
  assert.equal(reordered.state.experience.jobs[0].bullets, source.experience.jobs[0].bullets);
  assert.deepEqual(reordered.state.anonymization.fieldOverrides, source.anonymization.fieldOverrides);
});


test('protected privacy fields remain comments-only and exclamation marks remain valid proposal text', () => {
  const source = state();
  source.anonymization.fieldOverrides = { '["about","text"]': 'Worked with a qualified person.' };
  const local = prepare({ state: source });
  const profile = local.request.cv.fields.find(field => field.label.startsWith('Profile'))!;
  const incoming = { ...proposal(local), summary: 'Literal !!punctuation!!', letterText: local.request.letter.text,
    cvComments: [{ id: 'comment-1', fieldId: profile.id, explanation: 'Review the public wording.' }] };
  assert.doesNotThrow(() => parseRefinementProposal(incoming, local.request));
  assert.equal(local.request.cvStructure.ranges.some(range => range.fieldId === profile.id), false);
  assert.deepEqual(reconstructRefinementProposal(local, incoming, [], APP).state, source);
});
