import assert from 'node:assert/strict';
import test from 'node:test';
import { conciseLetterSummary, refinementSummaryCounts } from '../../../src/features/refinement/domain/refinementSummary';
import { buildRefinementPrompt, prepareRefinement, refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES } from '../../../src/documents/letter/motivationLetters';
import type { RefinementProposalV2 } from '../../../src/features/refinement/refinementTypes';
import { createTestState } from '../../support/fixtures/cvState';

function proposal(): RefinementProposalV2 {
  return {
    schemaVersion: 2, requestId: crypto.randomUUID(), summary: 'A focused draft.', letterText: 'Proposed letter.',
    cvOperations: [
      { id: 'change-1', type: 'reorder_sections', targetId: 'body', order: ['section-2', 'section-1'], explanation: 'Prioritize relevant experience.' },
      { id: 'change-2', type: 'omit_bullet', targetId: 'bullet-1', explanation: 'Remove an unrelated detail.' },
    ],
    cvComments: [{ id: 'comment-1', fieldId: 'field-1', explanation: 'A structural adapter limitation.' }],
    annotations: [
      { id: 'annotation-1', document: 'cv', type: 'todo', location: null, text: 'Check the date.' },
      { id: 'annotation-2', document: 'cv', type: 'question', location: null, text: 'Which methods were used?' },
      { id: 'annotation-3', document: 'cv', type: 'comment', location: null, text: 'Existing evidence is retained.' },
      { id: 'annotation-4', document: 'letter', type: 'question', location: null, text: 'Which research direction is most relevant?' },
      { id: 'annotation-5', document: 'letter', type: 'question', location: null, text: 'Can you confirm this motivation?' },
      { id: 'annotation-6', document: 'letter', type: 'todo', location: null, text: 'Confirm the recipient.' },
    ],
  };
}

test('proposal counts keep CV automatic changes and each document’s ToDos and questions separate', () => {
  const source = proposal(), before = structuredClone(source);
  assert.deepEqual(refinementSummaryCounts(source, 'cv'), { automaticChanges: 2, todos: 1, questions: 1 });
  assert.deepEqual(refinementSummaryCounts(source, 'letter'), { automaticChanges: 0, todos: 1, questions: 2 });
  assert.deepEqual(source, before, 'displaying counts cannot mutate the proposal');
});

test('summaries and comments do not fabricate structured questions or ToDos', () => {
  const modern = proposal(); delete modern.annotations;
  modern.summary = 'Three questions and two ToDos were considered.';
  assert.deepEqual(refinementSummaryCounts(modern, 'cv'), { automaticChanges: 2, todos: 0, questions: 0 });
  assert.deepEqual(refinementSummaryCounts(modern, 'letter'), { automaticChanges: 0, todos: 0, questions: 0 });
});

test('letter summaries retain at most two complete source sentences without invented wording', () => {
  assert.equal(conciseLetterSummary('  The draft connects robotics experience to the project.\n\nIt emphasizes reproducible experiments. A third sentence contains review detail.  '),
    'The draft connects robotics experience to the project. It emphasizes reproducible experiments.');
  assert.equal(conciseLetterSummary('A concise single-sentence legacy summary.'), 'A concise single-sentence legacy summary.');
  assert.equal(conciseLetterSummary('The draft covers research. It uses documented experience. 1 question remains.'), 'The draft covers research. It uses documented experience.');
  assert.equal(conciseLetterSummary('Legacy text without final punctuation'), 'Legacy text without final punctuation');
  assert.equal(conciseLetterSummary(' \n\t '), '');
  assert.equal(conciseLetterSummary('Der Entwurf erläutert das Forschungsinteresse. Er nennt vorhandene Erfahrung. Weitere Details folgen.', 'de'),
    'Der Entwurf erläutert das Forschungsinteresse. Er nennt vorhandene Erfahrung.');
});

test('long legacy letter summaries are bounded at a word boundary without breaking Unicode', () => {
  const source = 'Documented research experience '.repeat(100) + 'supports the application.';
  const summary = conciseLetterSummary(source);
  assert.ok(summary.length <= 400);
  assert.match(summary, /…$/);
  assert.ok(source.startsWith(summary.slice(0, -1)));
  assert.equal(source.charAt(summary.length - 1), ' ', 'truncation must stop after a complete word');
  const unicode = conciseLetterSummary('🌿'.repeat(500));
  assert.ok(unicode.length <= 400);
  assert.equal(unicode.slice(0, -1), '🌿'.repeat((unicode.length - 1) / 2));
});

test('prompts request concise scoped summaries without changing the proposal contract', () => {
  const state = createTestState();
  for (const scope of ['cv', 'letter'] as const) {
    const local = prepareRefinement({ scope, applicationId: crypto.randomUUID(), state, variantId: 'base',
      setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 }, letterText: 'Existing letter.', opportunity: {},
      feedback: [], parentProposalId: null, baselineSignature: refinementSignature(state) });
    const prompt = buildRefinementPrompt(local.request, 'test-project');
    if (scope === 'cv') {
      assert.match(prompt, /summary to concise counts only/);
      assert.match(prompt, /returned cvOperations/);
      assert.doesNotMatch(prompt, /summary to exactly two concise sentences/);
    } else {
      assert.match(prompt, /summary to exactly two concise sentences summarizing the actual returned letter draft/);
      assert.match(prompt, /at most 60 words/);
      assert.match(prompt, /Do not invent claims or imply that unanswered questions are evidence/);
    }
    assert.match(prompt, /summary/);
    assert.match(prompt, /no additional properties/);
    assert.match(prompt, /latest feedback entry beginning "Workflow reset:" whose scope includes that document starts a fresh iteration/);
    assert.match(prompt, /inactive unless explicitly reconfirmed in later feedback/);
    assert.match(prompt, /Each request contains only feedback for its selected document/);
  }
});
