import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPLICATION_STATUSES, OPPORTUNITY_INTEREST_REASON_CATEGORIES, OPPORTUNITY_REVIEW_STATES,
  type OpportunityPredictionBaseline, type OpportunityReview,
} from '../../../src/app/cloudTypes';
import {
  DEFAULT_OPPORTUNITY_INTEREST_POLICY, MAX_OPPORTUNITY_INTEREST_REASONS,
  MAX_OPPORTUNITY_INTEREST_TARGET_LENGTH, OPPORTUNITY_INTEREST_METRIC_VERSION,
  confirmedOpportunitySubmission, deriveOpportunityFeedback, isOpportunityInterestRating,
  normalizeOpportunityInterestReasons, parseOpportunityInterestRating,
  type OpportunityFeedbackInput, type OpportunitySubmissionEvidence,
} from '../../../src/features/opportunities/domain/opportunityFeedback';

const owner = '00000000-0000-4000-8000-000000000001';
const opportunity = '00000000-0000-4000-8000-000000000002';
const originalTime = '2026-10-01T09:00:00Z';
const feedbackTime = '2026-10-02T09:00:00Z';

function review(patch: Partial<OpportunityReview> = {}): OpportunityReview {
  return {
    user_id: owner, opportunity_id: opportunity, state: 'unreviewed',
    reviewed_updated_at: null, created_at: originalTime, updated_at: feedbackTime,
    interest_rating: null, interest_reasons: [], feedback_excluded: false,
    feedback_revision: 0, feedback_updated_at: null, prediction_baseline: null,
    ...patch,
  };
}

function application(patch: Partial<OpportunitySubmissionEvidence> = {}): OpportunitySubmissionEvidence {
  return { user_id: owner, opportunity_id: opportunity, status: 'preparation', submitted_at: null, ...patch };
}

function input(patch: Partial<OpportunityFeedbackInput> = {}): OpportunityFeedbackInput {
  return { user_id: owner, opportunity_id: opportunity, review: review(), applications: [], ...patch };
}

function prediction(patch: Partial<OpportunityPredictionBaseline> = {}): OpportunityPredictionBaseline {
  return {
    user_id: owner, opportunity_id: opportunity, score: 7, scale_min: 0, scale_max: 10,
    predicted_at: originalTime, source_kind: 'historical_snapshot',
    source_ref: 'opportunity-search-receipt:00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000004',
    ...patch,
  };
}

test('SIG-01: empty and legacy unreviewed records are unknown, never implicit zero', () => {
  for (const sample of [input(), input({ review: undefined }), input({ review: null }), input({
    review: { user_id: owner, opportunity_id: opportunity, state: 'unreviewed', reviewed_updated_at: null,
      created_at: originalTime, updated_at: feedbackTime },
  })]) {
    assert.deepEqual(deriveOpportunityFeedback(sample), {
      user_id: owner, opportunity_id: opportunity, metric_version: OPPORTUNITY_INTEREST_METRIC_VERSION,
      interest_score: null, interest_origin: 'none', confirmed_submission: false, submission_at: null,
      feedback_revision: 0, feedback_updated_at: null, interest_gap: null, baseline_status: 'unavailable',
    });
  }
});

test('v2 categories and application evidence determine feedback while legacy numeric overrides are ignored', () => {
  const categorical = { unreviewed: null, interested: 6, strong_interest: 8, very_high_interest: 9, not_interested: 2 };
  for (const state of OPPORTUNITY_REVIEW_STATES) for (const stage of ['none', 'preparation', 'submitted'] as const) {
    for (const rating of [undefined, null, 0, 0.25, 10]) {
      const savedReview = review({ state, interest_rating: rating });
      const result = deriveOpportunityFeedback(input({ review: savedReview,
        applications: stage === 'none' ? [] : [application({ status: stage })] }));
      assert.equal(result.interest_score, stage === 'submitted' ? 9.5 : stage === 'preparation' ? 9 : categorical[state]);
      assert.equal(result.interest_origin, stage === 'submitted' ? 'confirmed_submission' : stage === 'preparation' ? 'application'
        : state === 'unreviewed' ? 'none' : 'categorical_review');
      assert.equal(result.confirmed_submission, stage === 'submitted');
      assert.equal(savedReview.state, state, 'application scoring preserves the underlying opportunity rating');
      assert.equal(deriveOpportunityFeedback(input({ review: savedReview })).interest_score, categorical[state],
        'removing an application restores the actual category');
    }
  }
});

test('ratings reject invalid numeric values and coercion while null remains optional', () => {
  for (const rating of [0, 0.1, 3.75, 10]) {
    assert.equal(isOpportunityInterestRating(rating), true);
    assert.equal(parseOpportunityInterestRating(rating), rating);
  }
  for (const rating of [NaN, Infinity, -Infinity, -0.01, 10.01, '0', '8.5', '', true, false, {}, [], new Number(5)]) {
    assert.equal(isOpportunityInterestRating(rating), false);
    assert.throws(() => parseOpportunityInterestRating(rating), /finite number from 0 to 10/u);
    assert.equal(deriveOpportunityFeedback(input({ review: review({ state: 'interested', interest_rating: rating as number }) })).interest_score, 6);
  }
  for (const rating of [null, undefined]) assert.equal(parseOpportunityInterestRating(rating), null);
});

test('excluded feedback always suppresses score and gap across every precedence combination', () => {
  for (const state of OPPORTUNITY_REVIEW_STATES) for (const rating of [undefined, null, 0, 7]) {
    const baseline = prediction();
    const result = deriveOpportunityFeedback(input({
      review: review({ state, interest_rating: rating, feedback_excluded: true, feedback_updated_at: feedbackTime,
        prediction_baseline: baseline }),
      applications: [application({ status: 'submitted', submitted_at: feedbackTime })], verified_prediction: baseline,
    }));
    assert.equal(result.interest_score, null);
    assert.equal(result.interest_origin, 'excluded');
    assert.equal(result.interest_gap, null);
    assert.equal(result.baseline_status, 'unavailable');
  }
});

test('SIG-04: application workflow and later employer statuses alone never prove submission', () => {
  for (const status of APPLICATION_STATUSES) {
    const result = deriveOpportunityFeedback(input({ applications: [application({ status })] }));
    assert.equal(result.interest_score, status === 'submitted' ? 9.5 : 9, status);
    assert.equal(result.submission_at, null, 'never infer a timestamp from a status');
  }
  for (const status of ['interview', 'offer', 'rejected', 'withdrawn'] as const) {
    assert.equal(deriveOpportunityFeedback(input({ applications: [application({ status: 'refinement',
      status_history: [{ status, changedAt: feedbackTime }] })] })).interest_score, 9);
  }
});

test('SIG-05: genuine past submission survives employer rejection, withdrawal and reopened preparation', () => {
  for (const status of ['rejected', 'withdrawn', 'interview', 'offer', 'preparation', 'refinement'] as const) {
    for (const proof of [
      { submitted_at: originalTime },
      { status_history: [{ status: 'submitted' as const, changedAt: originalTime }, { status, changedAt: feedbackTime }] },
      { status_history: [{ status: 'submitted' as const, changedAt: null }, { status, changedAt: feedbackTime }] },
    ]) {
      const result = deriveOpportunityFeedback(input({ applications: [application({ status, ...proof })] }));
      assert.equal(result.interest_score, 9.5, status);
      assert.equal(result.interest_origin, 'confirmed_submission');
      assert.equal(result.submission_at, 'submitted_at' in proof ? originalTime : proof.status_history[0]!.changedAt);
    }
  }
});

test('confirmed submission preserves unknown dates and rejects coercible or invalid dates', () => {
  for (const date of [null, '', 'invalid', '2026-10-01', '123', ' 2026-10-01T09:00:00Z ',
    '2026-02-30T09:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01T09:60:00Z', '2026-10-01T09:00:60Z',
    '2026-10-01T09:00:00.0000001Z', '2026-10-01T09:00:00+16:00', '2026-10-01T09:00:00+20:00',
    '2026-10-01T09:00:00-16:00', '2026-10-01T09:00:00+01:60', '0000-01-01T09:00:00Z', 123, true]) {
    assert.deepEqual(confirmedOpportunitySubmission(application({ submitted_at: date as string | null })), { confirmed: false, submitted_at: null });
  }
  assert.deepEqual(confirmedOpportunitySubmission(application({ status: 'submitted' })), { confirmed: true, submitted_at: null });
  assert.deepEqual(confirmedOpportunitySubmission(application({ status_history: [{ status: 'submitted', changedAt: null }] })),
    { confirmed: true, submitted_at: null });
  assert.deepEqual(confirmedOpportunitySubmission(application({ status_history: [{ status: 'submitted', changedAt: 'invalid' }] })),
    { confirmed: true, submitted_at: null });
  assert.deepEqual(confirmedOpportunitySubmission(application({ submitted_at: feedbackTime,
    status_history: [{ status: 'submitted', changedAt: originalTime }] })), { confirmed: true, submitted_at: originalTime });
  for (const date of ['2026-10-01T09:00:00+15:59', '2026-10-01T09:00:00-15:59', '0001-01-01T00:00:00Z',
    '2028-02-29T23:59:59.123456Z']) {
    assert.deepEqual(confirmedOpportunitySubmission(application({ submitted_at: date })), { confirmed: true, submitted_at: date });
  }
});

test('removing or correcting real submission evidence recomputes fallback without inventing history', () => {
  const originallySubmitted = application({ status: 'rejected', submitted_at: originalTime });
  assert.equal(deriveOpportunityFeedback(input({ applications: [originallySubmitted] })).interest_score, 9.5);
  const corrected = { ...originallySubmitted, submitted_at: null };
  assert.equal(deriveOpportunityFeedback(input({ applications: [corrected] })).interest_score, 9);
  assert.equal(corrected.status_history, undefined);
  assert.equal(deriveOpportunityFeedback(input({ applications: [application({ status: 'rejected',
    status_history: [{ status: 'submitted', changedAt: null }] })] })).interest_score, 9.5);
  assert.equal(deriveOpportunityFeedback(input({ applications: [application({ status: 'rejected', status_history: [] })] })).interest_score, 9);
});

test('SIG-06/07: one owner/opportunity outcome is stable across views, comments and repeated documents', () => {
  const originalReview = review({ state: 'not_interested', feedback_revision: 4, feedback_updated_at: feedbackTime,
    comment: 'Private email: contact@example.invalid', reviewed_updated_at: originalTime });
  const submitted = application({ status: 'submitted', submitted_at: originalTime });
  const first = deriveOpportunityFeedback(input({ review: originalReview, applications: [submitted] }));
  const viewed = deriveOpportunityFeedback(input({ review: { ...originalReview, reviewed_updated_at: feedbackTime,
    updated_at: '2026-10-03T15:00:00Z', comment: 'Changed private comment' },
  applications: Array.from({ length: 20 }, () => ({ ...submitted, documents: ['private'], context_json: { contact: 'secret' } })),
  }));
  assert.deepEqual(viewed, first);
  assert.equal(first.interest_score, 9.5);
  assert.equal(first.confirmed_submission, true);
  assert.equal(first.feedback_revision, 4);
  const json = JSON.stringify(viewed);
  for (const privateField of ['comment', 'documents', 'context_json', 'contact', 'status_history', 'reviewed_updated_at']) {
    assert.equal(json.includes(privateField), false, privateField);
  }
});

test('feedback scope rejects another owner review and ignores other owner/opportunity application evidence', () => {
  assert.throws(() => deriveOpportunityFeedback(input({ review: review({ user_id: 'other-owner' }) })), /scope mismatch/u);
  assert.throws(() => deriveOpportunityFeedback(input({ review: review({ opportunity_id: 'other-opportunity' }) })), /scope mismatch/u);
  const result = deriveOpportunityFeedback(input({ applications: [
    application({ user_id: 'other-owner', status: 'submitted' }),
    application({ opportunity_id: 'other-opportunity', status: 'submitted' }),
  ] }));
  assert.equal(result.interest_score, null);
  assert.equal(result.confirmed_submission, false);
});

test('structured reasons use only bounded categories/polarities and explicit topic/method targets', () => {
  for (const category of OPPORTUNITY_INTEREST_REASON_CATEGORIES) for (const polarity of ['positive', 'negative'] as const) {
    if (['requirements', 'availability'].includes(category) && polarity === 'positive') {
      assert.throws(() => normalizeOpportunityInterestReasons([{ category, polarity }]));
    } else assert.deepEqual(normalizeOpportunityInterestReasons([{ category, polarity }]), [{ category, polarity }]);
  }
  for (const category of ['topic', 'method'] as const) {
    assert.deepEqual(normalizeOpportunityInterestReasons([{ category, polarity: 'positive', target: '  Acoustics  ' }]),
      [{ category, polarity: 'positive', target: 'Acoustics' }]);
  }
  for (const reason of [null, {}, { category: 'neutral', polarity: 'positive' }, { category: 'topic', polarity: 'neutral' },
    { category: 'funding', polarity: 'negative', target: 'acoustics' },
    { category: 'topic', polarity: 'positive', target: '' }, { category: 'topic', polarity: 'positive', target: null },
    { category: 'topic', polarity: 'positive', target: 4 }, { category: 'topic', polarity: 'positive', target: 'x'.repeat(MAX_OPPORTUNITY_INTEREST_TARGET_LENGTH + 1) },
    { category: 'topic', polarity: 'positive', target: 'Acoustics\nRobotics' },
    { category: 'topic', polarity: 'positive', comment: 'Infer BCI from this private text' }]) {
    assert.throws(() => normalizeOpportunityInterestReasons([reason]));
  }
  assert.throws(() => normalizeOpportunityInterestReasons(null));
  assert.throws(() => normalizeOpportunityInterestReasons({ topic: 'BCI' }));
  assert.throws(() => normalizeOpportunityInterestReasons(Array.from({ length: MAX_OPPORTUNITY_INTEREST_REASONS + 1 },
    () => ({ category: 'topic', polarity: 'positive' }))));
});

test('reason canonicalization is deterministic, deduplicated and independent of arbitrary prose', () => {
  const a = { category: 'topic', polarity: 'positive', target: 'BCI' };
  const b = { category: 'location', polarity: 'negative' };
  assert.deepEqual(normalizeOpportunityInterestReasons([a, b, a]), normalizeOpportunityInterestReasons([b, a]));
  assert.deepEqual(normalizeOpportunityInterestReasons(undefined), []);
  assert.deepEqual(normalizeOpportunityInterestReasons([]), []);
  const record = review({ comment: 'I dislike the location, deadline and lack of robotics hardware' });
  assert.deepEqual(record.interest_reasons, []);
  assert.equal(deriveOpportunityFeedback(input({ review: record })).interest_score, null);
});

test('reason limits and ordering match PostgreSQL code points, ASCII trimming and C collation', () => {
  const tag = (target: string) => ({ category: 'topic', polarity: 'positive', target });
  const nonBmp = '\u{10000}';
  const highBmp = '\ue000';
  assert.deepEqual(normalizeOpportunityInterestReasons([tag(nonBmp), tag(highBmp), tag('BCI')]),
    [tag('BCI'), tag(highBmp), tag(nonBmp)]);
  assert.deepEqual(normalizeOpportunityInterestReasons([tag('😀'.repeat(120))]), [tag('😀'.repeat(120))]);
  assert.throws(() => normalizeOpportunityInterestReasons([tag('😀'.repeat(121))]));
  assert.deepEqual(normalizeOpportunityInterestReasons([tag(' \u00a0BCI\u00a0 ')]), [tag('\u00a0BCI\u00a0')]);
  assert.deepEqual(normalizeOpportunityInterestReasons([tag(' BCI '), tag('BCI')]), [tag('BCI')]);
  for (const control of ['\u0000', '\u001f', '\u007f', '\t', '\n', '\r']) {
    assert.throws(() => normalizeOpportunityInterestReasons([tag(`BCI${control}`)]));
  }
});

test('SIG-08: unknown original prediction and self-asserted baseline never become a gap', () => {
  const withCurrentCatalogue = { ...input({ review: review({ state: 'interested', feedback_updated_at: feedbackTime }) }),
    opportunity: { personal_fit: '9.0/10 — excellent', details: { personal_fit: { score: 9, scale_min: 0, scale_max: 10 } } } };
  assert.equal(deriveOpportunityFeedback(withCurrentCatalogue).interest_gap, null);
  const result = deriveOpportunityFeedback(input({ review: review({ state: 'interested', feedback_updated_at: feedbackTime,
    prediction_baseline: prediction() }) }));
  assert.equal(result.interest_gap, null);
  assert.equal(result.baseline_status, 'unavailable');
});

test('only exact independently verified, scale-valid, timely historical evidence supplies the frozen gap', () => {
  const baseline = prediction();
  const sample = input({ review: review({ state: 'strong_interest', interest_rating: 8.5, feedback_revision: 3,
    feedback_updated_at: feedbackTime, prediction_baseline: baseline }), verified_prediction: { ...baseline } });
  const result = deriveOpportunityFeedback(sample);
  assert.equal(result.interest_gap, 1);
  assert.equal(result.baseline_status, 'available');
  assert.equal(result.feedback_revision, 3);
  assert.deepEqual(deriveOpportunityFeedback({ ...sample, opportunity: { personal_fit: '2/10', updated_at: '2030-01-01' } } as OpportunityFeedbackInput), result);
  assert.deepEqual(sample.review?.prediction_baseline, baseline, 'the original baseline remains untouched');
  for (const bad of [
    prediction({ user_id: 'other-owner' }), prediction({ opportunity_id: 'other-opportunity' }),
    prediction({ score: 6 }), prediction({ score: '7' as unknown as number }), prediction({ score: NaN }),
    prediction({ scale_max: 100 as 10 }), prediction({ scale_min: 1 as 0 }),
    prediction({ predicted_at: '2026-10-03T09:00:00Z' }), prediction({ predicted_at: 'invalid' }),
    prediction({ source_ref: 'today-catalogue' }), prediction({ source_kind: 'catalogue' as 'historical_snapshot' }),
    { ...prediction(), approved: true },
  ]) {
    assert.equal(deriveOpportunityFeedback({ ...sample, verified_prediction: bad }).interest_gap, null);
    assert.equal(deriveOpportunityFeedback({ ...sample, review: { ...sample.review!, prediction_baseline: bad } }).interest_gap, null);
  }
});

test('baseline timing uses known meaningful feedback/submission time, never an unrelated updated_at', () => {
  const baseline = prediction();
  const shared = { review: review({ state: 'interested', updated_at: feedbackTime, prediction_baseline: baseline }),
    verified_prediction: baseline };
  assert.equal(deriveOpportunityFeedback(input(shared)).interest_gap, null);
  assert.equal(deriveOpportunityFeedback(input({ ...shared, review: review({ state: 'interested',
    feedback_updated_at: originalTime, prediction_baseline: baseline }) })).interest_gap, -1, 'same known timestamp is valid');
  assert.equal(deriveOpportunityFeedback(input({ ...shared, review: review({ prediction_baseline: baseline }),
    applications: [application({ status: 'submitted' })] })).interest_gap, null);
  assert.equal(deriveOpportunityFeedback(input({ ...shared, review: review({ prediction_baseline: baseline }),
    applications: [application({ status: 'rejected', submitted_at: feedbackTime })] })).interest_gap, 2.5);
  assert.equal(deriveOpportunityFeedback(input({ ...shared, review: review({ prediction_baseline: prediction({ predicted_at: feedbackTime }) }),
    verified_prediction: prediction({ predicted_at: feedbackTime }), applications: [application({ submitted_at: originalTime })] })).interest_gap, null);
});

test('application presence has no prediction gap from an unrelated saved review event', () => {
  const baseline = prediction();
  const result = deriveOpportunityFeedback(input({
    review: review({ state: 'not_interested', feedback_updated_at: feedbackTime, prediction_baseline: baseline }),
    applications: [application()], verified_prediction: baseline,
  }));
  assert.equal(result.interest_score, 9);
  assert.equal(result.interest_origin, 'application');
  assert.equal(result.baseline_status, 'unavailable');
  assert.equal(result.interest_gap, null);
});

test('historical prediction timing and submission ordering preserve PostgreSQL microseconds', () => {
  const baseline = prediction({ predicted_at: '2026-10-01T09:00:00.000999Z' });
  const sample = input({ review: review({ state: 'interested', prediction_baseline: baseline,
    feedback_updated_at: '2026-10-01T09:00:00.000001Z' }), verified_prediction: baseline });
  assert.equal(deriveOpportunityFeedback(sample).interest_gap, null, 'a later same-millisecond prediction is unavailable');
  assert.equal(deriveOpportunityFeedback({ ...sample, review: { ...sample.review!,
    feedback_updated_at: '2026-10-01T09:00:00.000999Z' } }).interest_gap, -1);
  assert.deepEqual(confirmedOpportunitySubmission(application({ submitted_at: '2026-10-01T09:00:00.000999Z',
    status_history: [{ status: 'submitted', changedAt: '2026-10-01T09:00:00.000001Z' }] })),
  { confirmed: true, submitted_at: '2026-10-01T09:00:00.000001Z' });
  assert.equal(deriveOpportunityFeedback({ ...sample, review: { ...sample.review!, feedback_updated_at: feedbackTime },
    verified_prediction: { ...baseline, predicted_at: '2026-10-01T11:00:00.000999+02:00' } }).interest_gap, -1,
  'an independently verified prediction may use another representation of the exact microsecond instant');
});

test('independently verified discovery assessments provide a frozen categorical baseline under v2', () => {
  const baseline = prediction({ source_kind: 'discovery_assessment', source_ref: 'opportunity-discovery-assessment:00000000-0000-4000-8000-000000000005' });
  const sample = input({ review: review({ state: 'not_interested', interest_rating: 0, feedback_updated_at: feedbackTime, prediction_baseline: baseline }),
    verified_prediction: baseline });
  const result = deriveOpportunityFeedback(sample);
  assert.equal(result.interest_score, 2);
  assert.equal(result.interest_origin, 'categorical_review');
  assert.equal(result.interest_gap, -5);
  assert.equal(result.baseline_status, 'available');
  assert.equal(result.metric_version, OPPORTUNITY_INTEREST_METRIC_VERSION);
  assert.equal(deriveOpportunityFeedback({ ...sample, verified_prediction: null }).interest_gap, null, 'a structured assertion is still not provenance');
  assert.deepEqual(sample.review!.prediction_baseline, baseline);
  for (const bad of [
    prediction({ source_kind: 'discovery_assessment' }),
    prediction({ source_ref: baseline.source_ref }),
    { ...baseline, user_id: 'another-owner' },
    { ...baseline, opportunity_id: 'another-opportunity' },
    { ...baseline, predicted_at: '2026-10-02T09:00:00.000001Z' },
    { ...baseline, scale_max: 100 as 10 },
  ]) {
    assert.equal(deriveOpportunityFeedback({ ...sample, review: { ...sample.review!, prediction_baseline: bad }, verified_prediction: bad }).interest_gap, null);
  }
});

test('AF-05 a known submission can match a genuine ex-ante assessment without rebasing unchanged explicit feedback', () => {
  const baseline = prediction({ source_kind: 'discovery_assessment', source_ref: 'opportunity-discovery-assessment:00000000-0000-4000-8000-000000000005' });
  const sample = input({ review: review(), applications: [application({ status: 'rejected', submitted_at: feedbackTime })],
    verified_prediction: baseline });
  const result = deriveOpportunityFeedback(sample);
  assert.equal(result.interest_origin, 'confirmed_submission');
  assert.equal(result.interest_score, 9.5);
  assert.equal(result.interest_gap, 2.5);
  assert.equal(sample.review!.prediction_baseline, null, 'fallback derivation does not write an invented review event');
  assert.equal(deriveOpportunityFeedback({ ...sample, review: review({ state: 'interested', feedback_updated_at: feedbackTime }) }).interest_gap, 2.5,
    'submission uses its verified event independently of a previous categorical review');
  assert.equal(deriveOpportunityFeedback({ ...sample, applications: [application({ status: 'submitted', submitted_at: null })] }).interest_gap, null,
    'unknown submission time cannot establish ex-ante ordering');
  assert.equal(deriveOpportunityFeedback({ ...sample, verified_prediction: { ...baseline, predicted_at: '2026-10-02T09:00:00.000001Z' } }).interest_gap, null);
});

test('metric conventions are versioned and configurable only under an explicit different version', () => {
  assert.equal(Object.isFrozen(DEFAULT_OPPORTUNITY_INTEREST_POLICY), true);
  assert.equal(Object.isFrozen(DEFAULT_OPPORTUNITY_INTEREST_POLICY.review_scores), true);
  const custom = { version: 'opportunity-interest-v2-test', review_scores: { very_high_interest: 9.5, strong_interest: 9, interested: 7, not_interested: 1 }, application_score: 8, submitted_score: 8.5 };
  const result = deriveOpportunityFeedback(input({ review: review({ state: 'interested' }) }), custom);
  assert.equal(result.interest_score, 7);
  assert.equal(result.metric_version, custom.version);
  assert.throws(() => deriveOpportunityFeedback(input(), { ...custom, version: OPPORTUNITY_INTEREST_METRIC_VERSION }), /new metric version/u);
  assert.throws(() => deriveOpportunityFeedback(input(), { ...custom, submitted_score: 11 }), /Invalid versioned/u);
  assert.throws(() => deriveOpportunityFeedback(input(), { ...custom, version: '' }), /Invalid versioned/u);
});

test('malformed enum, exclusion and revision inputs fail explicitly without coercion', () => {
  for (const patch of [{ state: 'neutral' }, { feedback_excluded: 'false' }, { feedback_revision: -1 },
    { feedback_revision: 1.5 }, { feedback_revision: '1' }, { feedback_revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => deriveOpportunityFeedback(input({ review: review(patch as Partial<OpportunityReview>) })));
  }
  assert.throws(() => deriveOpportunityFeedback(input({ user_id: '' })), /requires an owner/u);
});
