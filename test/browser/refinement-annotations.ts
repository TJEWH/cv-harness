/** Isolated development fixture: real annotation controls; in-memory writes only. */
import { computed, createApp, h, nextTick, ref } from 'vue';
import RefinementAnnotations from '../../src/features/refinement/components/RefinementAnnotations.vue';
import AppToaster from '../../src/shared/ui/AppToaster.vue';
import type { AnnotationStatus } from '../../src/features/refinement/refinementTypes';
import type { AnnotationView } from '../../src/features/refinement/domain/refinementAnnotations';
import { commitPendingTextareas } from '../../src/shared/editing/textareaCommit';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Development fixture only.');

type Item = AnnotationView & { target: string; referenceChanged: boolean; included: boolean };
type Outcome = 'saved' | 'save_failed' | 'feedback_failed';
type Attempt = { number: number; annotationId: string; status: AnnotationStatus; response: string; previousReviewId: string | null; outcome: Outcome | 'pending' };
type ReviewWrite = { reviewId: string; annotationId: string; status: AnnotationStatus; response: string | null; previousReviewId: string | null };
type FeedbackWrite = { reviewId: string; annotationId: string; action: 'include' | 'cancel'; response: string | null };
const preview = (value: string) => value.replaceAll('Private Institute', '[redacted institution]');
function initialItems(): Item[] {
  return [
    { id: 'annotation-1', status: 'open', response: null, reviewId: null, included: false,
      text: '[experience] Fresh question: which experimental methods have you used?' },
    { id: 'annotation-2', status: 'ignored', response: 'Retained answer: I measured sensor drift in a laboratory project.', reviewId: 'seed-review-2', included: false,
      text: '[experience] Ignored question: describe an optional sensor experiment.' },
    { id: 'annotation-3', status: 'open', response: 'A legacy saved answer that has never been resolved.', reviewId: 'seed-review-3', included: false,
      text: '[follow_up] Legacy open question: confirm the earlier method description.' },
    { id: 'annotation-4', status: 'resolved', response: 'An included answer that can be cancelled by choosing Ignored.', reviewId: 'seed-review-4', included: true,
      text: '[application_requirements] Resolved question: have you completed the required research project?' },
  ].map(row => ({
    annotation: { id: row.id, type: 'question', document: 'cv', location: null, text: row.text },
    proposalId: 'fixture-proposal', requestId: 'fixture-request', status: row.status as AnnotationStatus,
    response: row.response, reviewId: row.reviewId, target: row.id,
    referenceChanged: false, included: row.included,
  }));
}

createApp({
  setup() {
    const items = ref(initialItems());
    const lang = ref('en'), narrow = ref(false), readOnly = ref(false), manualBusy = ref(false);
    const annotations = ref<{ flush(): Promise<boolean> } | null>(null);
    const attempts = ref<Attempt[]>([]), reviews = ref<ReviewWrite[]>([]), feedback = ref<FeedbackWrite[]>([]);
    const pending = ref<Attempt | null>(null), flushResult = ref('Not requested.');
    const busy = computed(() => manualBusy.value || pending.value !== null);
    const previouslyIncluded = new Set(['annotation-4']);
    const feedbackReceipts = new Set(['seed-review-4']);
    let resolvePending: ((outcome: Outcome) => void) | null = null;
    let reviewSequence = 0;

    async function save(annotationId: string, status: AnnotationStatus, response: string, previousReviewId: string | null): Promise<boolean> {
      if (pending.value) throw new Error('Fixture received overlapping saves.');
      const attempt: Attempt = { number: attempts.value.length + 1, annotationId, status, response, previousReviewId, outcome: 'pending' };
      attempts.value.push(attempt);
      pending.value = attempt;
      const outcome = await new Promise<Outcome>(resolve => { resolvePending = resolve; });
      resolvePending = null;
      const current = items.value.find(item => item.annotation.id === annotationId)!;
      let saved = false;
      if (outcome !== 'save_failed' && current.reviewId === previousReviewId) {
        const safeResponse = preview(response).trim() || null;
        if (current.status !== status || current.response !== safeResponse) {
          const reviewId = `fixture-review-${++reviewSequence}`;
          reviews.value.push({ reviewId, annotationId, status, response: safeResponse, previousReviewId });
          items.value = items.value.map(item => item.annotation.id === annotationId
            ? { ...item, status, response: safeResponse, reviewId, included: false } : item);
        }
        const updated = items.value.find(item => item.annotation.id === annotationId)!;
        if (outcome === 'saved') {
          const include = status === 'resolved' && !!safeResponse;
          if (updated.reviewId && !feedbackReceipts.has(updated.reviewId) && (include || previouslyIncluded.has(annotationId))) {
            feedback.value.push({ reviewId: updated.reviewId, annotationId, action: include ? 'include' : 'cancel', response: include ? safeResponse : null });
            feedbackReceipts.add(updated.reviewId);
            if (include) previouslyIncluded.add(annotationId);
          }
          items.value = items.value.map(item => item.annotation.id === annotationId
            ? { ...item, included: include && !!item.reviewId && feedbackReceipts.has(item.reviewId) } : item);
          saved = true;
        }
      }
      attempts.value = attempts.value.map(row => row.number === attempt.number ? { ...row, outcome: saved ? 'saved' : outcome === 'saved' ? 'save_failed' : outcome } : row);
      pending.value = null;
      await nextTick();
      return saved;
    }
    function complete(outcome: Outcome) { resolvePending?.(outcome); }
    async function flush() {
      commitPendingTextareas();
      flushResult.value = 'Waiting for pending saves…';
      flushResult.value = await annotations.value?.flush() ? 'Flush succeeded.' : 'Flush blocked; draft or failed save remains.';
    }
    const control = (label: string, value: boolean, change: (checked: boolean) => void) => h('label', { class: 'fixture-checkbox' }, [
      h('input', { type: 'checkbox', checked: value, onChange: (event: Event) => change((event.target as HTMLInputElement).checked) }), label,
    ]);
    const button = (label: string, action: () => void, disabled = false) => h('button', { type: 'button', disabled, onClick: action }, label);
    return () => h('main', { class: 'annotation-fixture', style: { maxWidth: narrow.value ? '390px' : '1000px' } }, [
      h(AppToaster),
      h('style', `.annotation-fixture{margin:0 auto;padding:24px;box-sizing:border-box;color:var(--ui-text);font:14px/1.5 var(--font-ui)}.annotation-fixture h1{font-size:24px}.fixture-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0}.fixture-controls button,.fixture-controls select{font:inherit;padding:8px 12px;color:var(--ui-text);background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:6px}.fixture-controls button:disabled{opacity:.45}.fixture-checkbox{display:flex;align-items:center;gap:6px}.fixture-log{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;border:1px solid var(--ui-border);padding:12px}.fixture-summary{border-block:1px solid var(--ui-border);padding:12px 0;margin:20px 0}.fixture-readme{color:var(--ui-muted)}@media(max-width:480px){.annotation-fixture{padding:16px}}`),
      h('h1', 'Question status · browser fixture'),
      h('p', { class: 'fixture-readme' }, 'Synthetic data only. Saves wait for a visible completion control. Enter or blur commits; Shift+Enter adds a newline. Reload this page to reset the fixture.'),
      h('div', { class: 'fixture-controls' }, [
        h('label', ['Language ', h('select', { value: lang.value, 'aria-label': 'Language', onChange: (event: Event) => { lang.value = (event.target as HTMLSelectElement).value; } }, [h('option', { value: 'en' }, 'English'), h('option', { value: 'de' }, 'Deutsch')])]),
        control('390 px mobile width', narrow.value, value => { narrow.value = value; }),
        control('Read-only', readOnly.value, value => { readOnly.value = value; }),
        control('External busy', manualBusy.value, value => { manualBusy.value = value; }),
      ]),
      h('div', { class: 'fixture-controls', 'aria-label': 'Controlled save outcomes' }, [
        button('Finish save', () => complete('saved'), !pending.value),
        button('Fail save', () => complete('save_failed'), !pending.value),
        button('Fail feedback', () => complete('feedback_failed'), !pending.value),
        button('Flush drafts', () => { void flush(); }),
      ]),
      h('div', { class: 'fixture-summary', 'aria-live': 'polite' }, [
        h('p', `Pending: ${pending.value ? `${pending.value.annotationId} → ${pending.value.status}` : 'none'} · Busy: ${busy.value} · Read-only: ${readOnly.value}`),
        h('p', `Save attempts: ${attempts.value.length} · Review writes: ${reviews.value.length} · Feedback writes: ${feedback.value.length}`),
        h('p', flushResult.value),
      ]),
      h(RefinementAnnotations, { ref: annotations, items: items.value, lang: lang.value, disabled: readOnly.value, busy: busy.value, save, privacyPreview: preview }),
      h('h2', 'Persisted question state'),
      h('pre', { class: 'fixture-log', 'data-testid': 'persisted-state' }, JSON.stringify(items.value.map(({ annotation, status, response, reviewId, included }) => ({ id: annotation.id, status, response, reviewId, included })), null, 2)),
      h('h2', 'Write log'),
      h('pre', { class: 'fixture-log', 'data-testid': 'write-log' }, JSON.stringify({ attempts: attempts.value, reviews: reviews.value, feedback: feedback.value }, null, 2)),
    ]);
  },
}).mount('#app');
