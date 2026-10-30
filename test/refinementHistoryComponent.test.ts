import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import type { LocalRefinementRequest, RefinementProposalRow, RefinementRequestRow, RefinementScope } from '../src/features/refinement/refinementTypes';
import { prepareRefinement, refinementSignature } from '../src/features/refinement/applicationRefinement';
import { DEFAULT_LETTER_TEMPLATES } from '../src/documents/letter/motivationLetters';
import { createTestState } from './helpers';

interface Setup {
  confirmingClear: boolean;
  requestClear(): void;
  cancelClear(): void;
  confirmClear(): void;
  runs: { row: RefinementRequestRow; proposals: RefinementProposalRow[] }[];
  clearTitle: string;
  clearMessage: string;
  emptyMessage: string;
}
const filename = new URL('../src/features/refinement/components/RefinementHistory.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'refinement-history-test' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} } : requireComponent(path), componentExports);
const component = { ...componentExports.default, render: () => null };
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {},
  setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});

function mount(t: TestContext) {
  const props = reactive({ requests: [] as RefinementRequestRow[], proposals: [] as RefinementProposalRow[], localRequests: {} as Record<string, LocalRefinementRequest>, currentRequestId: null,
    scope: 'cv' as RefinementScope,
    activeId: '', reviewActive: false, accepted: false, canClear: true,
    publicationStatus: 'current' as const, lang: 'en', busy: false, open: true });
  let cleared = 0;
  let mounted: unknown;
  const app = renderer.createApp({ render: () => h(component, {
    ...props, onClear: () => { cleared++; }, ref: (value: unknown) => { mounted = value; },
  }) });
  app.mount({}); t.after(() => app.unmount());
  const setup = (mounted as { $: { setupState: Setup } }).$.setupState;
  return { props, setup, cleared: () => cleared };
}

function request(scope: RefinementScope | 'both'): RefinementRequestRow {
  const local = prepareRefinement({ applicationId: crypto.randomUUID(), variantId: 'original', state: createTestState(), setup: { template: DEFAULT_LETTER_TEMPLATES[0], language: 'en', maxWords: 400 }, letterText: 'Frozen letter.', instructions: '', scope: scope === 'both' ? 'cv' : scope, feedback: [], parentProposalId: null, opportunity: {}, baselineSignature: refinementSignature('original') });
  local.request.scope = scope;
  return { id: local.request.requestId, application_id: local.request.applicationId, user_id: crypto.randomUUID(), created_at: '2026-10-02T00:00:00Z', request_json: local.request };
}

test('clearing history requires confirmation and cancellation preserves history', t => {
  const { setup, cleared } = mount(t);
  setup.confirmClear();
  assert.equal(cleared(), 0);
  setup.requestClear();
  assert.equal(setup.confirmingClear, true);
  assert.equal(cleared(), 0);
  setup.cancelClear();
  assert.equal(setup.confirmingClear, false);
  assert.equal(cleared(), 0);
  setup.requestClear();
  setup.confirmClear();
  assert.equal(setup.confirmingClear, false);
  assert.equal(cleared(), 1);
  setup.confirmClear();
  assert.equal(cleared(), 1);
});

test('busy history cannot be cleared, including after opening confirmation', async t => {
  const { props, setup, cleared } = mount(t);
  setup.requestClear();
  props.busy = true;
  await nextTick();
  assert.equal(setup.confirmingClear, false);
  setup.requestClear();
  assert.equal(setup.confirmingClear, false);
  setup.confirmClear();
  assert.equal(cleared(), 0);
});

test('unavailable history cannot be cleared, including after opening confirmation', async t => {
  const { props, setup, cleared } = mount(t);
  setup.requestClear();
  props.canClear = false;
  await nextTick();
  assert.equal(setup.confirmingClear, false);
  setup.requestClear();
  assert.equal(setup.confirmingClear, false);
  setup.confirmClear();
  assert.equal(cleared(), 0);
});

test('history changes with scope and counts only proposals belonging to visible rounds', async t => {
  const { props, setup } = mount(t);
  const cv = request('cv'), letter = request('letter'), both = request('both');
  props.requests = [cv, letter, both];
  props.proposals = [cv, letter, both, both].map((row, index) => ({ id: `proposal-${index}`, request_id: row.id }) as RefinementProposalRow);
  await nextTick();
  assert.deepEqual(setup.runs.map(run => [run.row.id, run.proposals.length]), [[cv.id, 1], [both.id, 2]]);
  props.scope = 'letter';
  await nextTick();
  assert.deepEqual(setup.runs.map(run => [run.row.id, run.proposals.length]), [[letter.id, 1], [both.id, 2]]);
  props.requests[2].cleared_scopes = ['letter'];
  await nextTick();
  assert.deepEqual(setup.runs.map(run => run.row.id), [letter.id]);
  props.scope = 'cv';
  await nextTick();
  assert.deepEqual(setup.runs.map(run => run.row.id), [cv.id, both.id]);
});

test('changing scope cancels an open clear confirmation and scopes its wording', async t => {
  const { props, setup, cleared } = mount(t);
  assert.equal(setup.clearTitle, 'Clear CV refinement history?');
  assert.match(setup.clearMessage, /Restore the CV to its original state and remove its approval/);
  assert.equal(setup.emptyMessage, 'No CV refinement history yet.');
  assert.match(setup.clearMessage, /Your letter and its history are kept/);
  setup.requestClear();
  props.scope = 'letter';
  await nextTick();
  assert.equal(setup.confirmingClear, false);
  setup.confirmClear();
  assert.equal(cleared(), 0);
  assert.equal(setup.clearTitle, 'Clear letter refinement history?');
  assert.match(setup.clearMessage, /empty draft using the selected template/);
  assert.equal(setup.emptyMessage, 'No motivation letter refinement history yet.');
  assert.match(setup.clearMessage, /Your CV and its history are kept/);
});
