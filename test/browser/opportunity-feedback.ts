import { opportunityFixture } from '../fixtures/opportunity';
/** Synthetic, memory-only AF-02 browser fixture. No Auth, database or external network calls. */
import { createApp, defineComponent, h, ref } from 'vue';
import OpportunityFeedbackControls from '../../src/features/opportunities/components/OpportunityFeedbackControls.vue';
import OpportunityDispositionControls from '../../src/features/opportunities/components/OpportunityDispositionControls.vue';
import type { OpportunityDispositionPatch, OpportunityFeedbackPatch, OpportunityReview } from '../../src/app/cloudTypes';
import { normalizeOpportunity } from '../../src/app/composables/useCloudWorkspace';
import { normalizeOpportunityInterestReasons, parseOpportunityInterestRating } from '../../src/features/opportunities/domain/opportunityFeedback';
import { MAX_OPPORTUNITY_EVALUATION_LENGTH } from '../../src/features/opportunities/domain/opportunityEvaluation';
import { useApplicationNotesAutosave } from '../../src/shared/editing/useApplicationNotesAutosave';
import { normalizeOpportunityDispositionPatch } from '../../src/features/opportunities/domain/opportunityDisposition';
import '../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('Synthetic feedback is available only on the development server.');

const owner = '90000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000001';
const now = '2026-10-29T12:00:00Z';
const oversizedLegacy = new URLSearchParams(location.search).has('oversizedLegacy');
const initialEvaluation = oversizedLegacy ? `${'E'.repeat(5000)}\n\n${'F'.repeat(600)}` : 'Prefer hands-on acoustic prototypes.\n\nConsider adjacent research involving robotics.';

createApp(defineComponent({
  setup() {
    const review = ref<OpportunityReview>({ user_id: owner, opportunity_id: id, state: 'interested', comment: initialEvaluation,
      interest_rating: null, interest_reasons: [], feedback_excluded: false, feedback_revision: 1, feedback_updated_at: now,
      manually_archived: false, technical_issue_category: null, technical_issue_note: null,
      reviewed_updated_at: null, created_at: now, updated_at: now, evaluation_revision: 1 });
    const language = ref('en');
    const evaluationSaves = ref(0), structuredChanges = ref(0), dispositionChanges = ref(0);
    let failEvaluationSave = false;
    const opportunity = normalizeOpportunity(opportunityFixture({ id, opportunity_key: 'synthetic-sensing-phd', title: 'PhD in physical sensing', institution: 'Synthetic Research Institute', topics: ['Physical sensing', 'Signal processing'] }));
    const saveFeedback = async (_id: string, patch: OpportunityFeedbackPatch) => {
      const next: OpportunityFeedbackPatch = { ...patch };
      if ('interest_rating' in next) next.interest_rating = parseOpportunityInterestRating(next.interest_rating);
      if ('interest_reasons' in next) next.interest_reasons = normalizeOpportunityInterestReasons(next.interest_reasons);
      structuredChanges.value++;
      review.value = { ...review.value, ...next, feedback_revision: (review.value.feedback_revision ?? 0) + 1 };
      return review.value;
    };
    const saveDisposition = async (_id: string, patch: OpportunityDispositionPatch) => {
      dispositionChanges.value++;
      review.value = { ...review.value, ...normalizeOpportunityDispositionPatch(patch), feedback_revision: (review.value.feedback_revision ?? 0) + 1 };
      return review.value;
    };
    const { notes: evaluationText, status: evaluationStatus, error: evaluationError, flush: flushPrivateComment } = useApplicationNotesAutosave({
      application: () => ({ id, notes: review.value.comment }),
      owner: () => owner, storage: null, maxLength: MAX_OPPORTUNITY_EVALUATION_LENGTH * 2,
      save: async (_id, snapshot) => {
        if (failEvaluationSave) { failEvaluationSave = false; return false; }
        if (Array.from(snapshot).length > MAX_OPPORTUNITY_EVALUATION_LENGTH) return false;
        evaluationSaves.value++;
        if (review.value.comment !== snapshot) review.value = { ...review.value, comment: snapshot, evaluation_revision: (review.value.evaluation_revision ?? 0) + 1 };
        return true;
      },
      errorMessage: () => 'Evaluation was not saved. Your draft is kept.',
    });
    Object.assign(window, { opportunityFeedbackFixture: {
      snapshot: () => ({ review: JSON.parse(JSON.stringify(review.value)), evaluationText: evaluationText.value,
        evaluationStatus: evaluationStatus.value,
        evaluationSaves: evaluationSaves.value,
        structuredChanges: structuredChanges.value, dispositionChanges: dispositionChanges.value }),
      failNextEvaluationSave: () => { failEvaluationSave = true; },
    } });
    return () => h('main', { class: 'feedback-fixture jobs-workspace builder-shell' }, [
      h('h1', 'Synthetic opportunity feedback'),
      h('p', 'PhD in physical sensing · Synthetic Research Institute. Development fixture; all values stay in memory.'),
      h('button', { type: 'button', class: 'btn fixture-language', onClick: () => { language.value = language.value === 'en' ? 'de' : 'en'; } }, 'English / Deutsch'),
      h('details', { class: 'fixture-evaluation personal-evaluation disclosure-row', open: true }, [
        h('summary', language.value === 'de' ? 'Persönliche Einschätzung' : 'Personal Evaluation'),
        h(OpportunityFeedbackControls, { ownerId: owner, opportunity, review: review.value, application: null,
          evaluationText: evaluationText.value, 'onUpdate:evaluationText': (value: string) => { evaluationText.value = value; }, evaluationStatus: evaluationStatus.value, evaluationError: evaluationError.value,
          busy: false, lang: language.value,
          saveFeedback, flushPrivateComment }),
        h(OpportunityDispositionControls, { ownerId: owner, opportunityId: id, review: review.value,
          saveDisposition, saveFeedback, busy: false, lang: language.value }),
      ]),
      h('output', { class: 'fixture-events', 'data-testid': 'fixture-events' },
        `Evaluation saves: ${evaluationSaves.value}; structured changes: ${structuredChanges.value}; disposition changes: ${dispositionChanges.value}`),
    ]);
  },
})).mount('#app');
