import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, type Component } from 'vue';
import type { CvState } from '../../../src/documents/cv/types';
import type { ApplicationStage } from '../../../src/app/cloudTypes';
import type { ApplicationLetter } from '../../../src/documents/letter/letterTypes';
import type { LocalRefinementRequest, RefinementApprovals, RefinementFeedback, RefinementProposalRow, RefinementRequestRow, RefinementReviewRow, RefinementState } from '../../../src/features/refinement/refinementTypes';
import { type ApplicationCvRecord } from '../../../src/features/applications/applicationCv';
import { createSyntheticRefinementWorkspace } from '../fixtures/refinement';

export const account = '90000000-0000-4000-8000-000000000001';
export const applicationId = '10000000-0000-4000-8000-000000000001';
export const refinementKey = `CV_REFINEMENT:1:${account}:${applicationId}`;
export interface Workspace {
  record: ApplicationCvRecord | null; letter: ApplicationLetter | null;
  busy: boolean; refreshing: boolean; syncing: boolean; error: string; saveError: string;
  selectedCvId: string; selectedTemplateId: string; selectedProposalId: string;
  variantName: string; savedVariantId: string; currentVariantSaved: boolean;
  saveCurrentVariant(): Promise<void>;
  reviews: RefinementReviewRow[];
  cloudState: RefinementState | null; approvals: RefinementApprovals;
  parentProposalId: string | null; resetRequestIds: string[];
  canClearHistory: boolean; cvApproved: boolean; letterApproved: boolean; showInitialRefinement: boolean;
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; localRequests: Record<string, LocalRefinementRequest>;
  selectedChangeIds: string[]; includeProposedLetter: boolean; reviewActive: boolean;
  previewCvState: CvState | null; previewLetterContent: ApplicationLetter['working'] | undefined;
  cvEditorState: CvState | null; currentCvState: CvState | null;
  selectComparison(value: 'original' | 'proposed'): Promise<void>;
  previewLetterCvState: CvState | null; reviewComparison: 'original' | 'proposed';
  temporaryReview: { error: string }; proposalAlreadyApplied: boolean; baselineSignature: string;
  preview: { getPdfBlob(): Promise<Blob> } | null; letterPreview: { getPdfBlob(): Promise<Blob> } | null;
  getCvPdf(): Promise<Blob>; getLetterPdf(): Promise<Blob>;
  saveAnnotation(id: string, status: 'open' | 'resolved' | 'ignored', response: string, previousReviewId: string | null, proposalId?: string): Promise<boolean>;
  includeAnnotationFeedback(id: string, proposalId?: string): Promise<void>; feedbackHistory(): RefinementFeedback[];
  proposalAnnotations: (import('../../../src/features/refinement/domain/refinementAnnotations').AnnotationView & { included: boolean; referenceChanged: boolean })[];
  reviewAcceptanceError: string; letterText: string;
  selectCv(id: string): Promise<void>; selectLetterTemplate(id: string): Promise<void>; publishSources(): Promise<void>; syncRefinement(): Promise<void>; copyTask(): Promise<void>; copyIterationTask(): Promise<void>; clearRefinementHistory(): Promise<void>; checkProposals(): Promise<void>;
  openProposal(): void; discardReview(): void; acceptSelectedChanges(): Promise<void>;
  persist(): void;
  feedbackScope: 'cv' | 'letter'; pane: 'cv' | 'letter'; tab: string; historyOpen: boolean;
  selectStage(stage: ApplicationStage): Promise<void>;
  selectReviewProposal(id: string): Promise<void>;
  approve(kind: 'cv' | 'letter', reopen?: boolean): Promise<void>;
  updateLetter(value: string): void; toggleProposedChange(id: string, included: boolean): void;
  setCvChangeActive(id: string, included: boolean): Promise<void>;
  cvChangeReviewError: string;
  iterationNotes: Record<'cv' | 'letter', { tone: string; structure: string; content: string }>;
  cvIterationNote: string;
  reviewTab: 'changes' | 'question';
  reviewCounts: Record<'changes' | 'question', number>;
  selectReviewTab(tab: 'changes' | 'question'): Promise<boolean>;
  currentAnnotations: (import('../../../src/features/refinement/domain/refinementAnnotations').AnnotationView & { included: boolean; referenceChanged: boolean })[];
}

const filename = new URL('../../../src/features/applications/components/ApplicationWorkspace.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'refinement-workflow' });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: {} }
  : path === '../../../platform/supabase/supabase' ? { supabaseConfiguration: { status: 'ready', url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_only' } }
    : requireComponent(path), componentExports);
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });

export async function idle(workspace: Workspace) {
  for (let index = 0; index < 40; index++) {
    await nextTick(); await new Promise<void>(resolve => setImmediate(resolve));
    if (!workspace.busy && !workspace.refreshing && !workspace.syncing) return;
  }
  assert.fail('Refinement workspace did not become idle.');
}

export function mount(t: TestContext, source?: CvState) {
  let unmount = () => {};
  t.after(() => unmount());
  const fixture = createSyntheticRefinementWorkspace(source);
  const { storage, props } = fixture;
  for (const [key, value] of Object.entries({ localStorage: storage, sessionStorage: storage,
    window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard: { writeText: async () => {} } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const component = { ...componentExports.default, render: () => null };
  function open() {
    let mounted: unknown;
    const app = renderer.createApp({ render: () => h(component, { ...props, ref: (value: unknown) => { mounted = value; } }) });
    app.mount({}); unmount = () => app.unmount();
    return (mounted as { $: { setupState: Workspace } }).$.setupState;
  }
  const setup = open();
  return { ...fixture, setup, close() { unmount(); }, reopen() { unmount(); return open(); } };
}

export async function prepare(fixture: ReturnType<typeof mount>, sourceId = 'base', options: { letterText?: string; scope?: 'cv' | 'letter' } = {}) {
  const { setup } = fixture;
  await idle(setup);
  await setup.selectCv(sourceId); await idle(setup); await setup.selectLetterTemplate('research');
  setup.updateLetter(options.letterText ?? 'Original private working letter.');
  setup.feedbackScope = options.scope ?? 'cv'; await setup.publishSources();
  setup.tab = 'refinement'; await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  return setup;
}
export const documents = (setup: Workspace) => JSON.stringify({ record: setup.record, letter: setup.letter });

/** Install a historical combined source as if it predated the document-pointer migration. */
export function seedLegacyRound(fixture: ReturnType<typeof mount>) {
  const setup = fixture.setup, id = setup.requests[0].id;
  const row = fixture.database.application_refinement_requests.find(row => row.id === id)!;
  (row.request_json as { scope: string }).scope = 'both';
  setup.localRequests[id].request.scope = 'both';
  delete setup.localRequests[id].baselineScope;
  fixture.database.application_refinement_state[0].current_cv_request_id = null;
  fixture.database.application_refinement_state[0].current_letter_request_id = null;
  setup.persist();
  return fixture.cloud.seedProposal(id);
}
