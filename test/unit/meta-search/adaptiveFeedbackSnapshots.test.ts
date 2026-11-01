import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityFeedbackTextHash } from '../../../src/features/opportunities/domain/opportunityFeedbackPrivacy';
import {
  ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING, ADAPTIVE_FEEDBACK_MAX_BYTES, ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION,
  compileAdaptiveFeedbackSnapshot, type AdaptiveFeedbackExample, type ApprovedAdaptivePreference, type CompileAdaptiveFeedbackInput,
} from '../../../src/features/meta-search/domain/adaptiveFeedbackSnapshots';

const owner = '70000000-0000-4000-8000-000000000001';
const search = '70000000-0000-4000-8000-000000000002';
const now = '2026-10-29T12:00:00Z';
const earlier = '2026-10-28T12:00:00Z';
const id = (index: number) => `71000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
function example(index: number, patch: Partial<AdaptiveFeedbackExample> = {}): AdaptiveFeedbackExample {
  return { opportunity_id: id(index), opportunity_key: `synthetic-${index}`, title: 'Synthetic research', institution: 'Synthetic Institute',
    topics: ['Acoustic sensing'], metric_version: 'opportunity-interest-v1', interest_score: 6, interest_origin: 'explicit_rating',
    interest_gap: null, baseline_status: 'unavailable', feedback_revision: 1, feedback_updated_at: now,
    review_state: 'unreviewed', confirmed_submission: false, submission_at: null, reasons: [], ...patch };
}
function input(examples: (AdaptiveFeedbackExample | null)[] = [], patch: Partial<CompileAdaptiveFeedbackInput> = {}): CompileAdaptiveFeedbackInput {
  return { user_id: owner, search_id: search,
    feedback_revision: 1, preference_revision: 0, metric_version: 'opportunity-interest-v1', examples, approved_preferences: [], ...patch };
}
function discrepancy(index: number, score: number, prediction: number): AdaptiveFeedbackExample {
  return example(index, { interest_score: score, interest_gap: score - prediction, baseline_status: 'available',
    original_prediction: { user_id: owner, opportunity_id: id(index), score: prediction, scale_min: 0, scale_max: 10,
      predicted_at: earlier, source_kind: 'historical_snapshot', source_ref: `opportunity-search-receipt:${id(900)}:${id(index)}` } });
}
async function summaryExample(index: number, summary = 'Prefer physical sensing experiments.'): Promise<AdaptiveFeedbackExample> {
  return includedExample(index,summary);
}
async function includedExample(index: number, source = 'Prefer acoustic sensing prototypes.'): Promise<AdaptiveFeedbackExample> {
  const text = Array.from(source).slice(0, 600).join('');
  return example(index, { interest_score: null, interest_origin: 'none', feedback_updated_at: null,
    search_feedback_summary: text, summary_inclusion: { policy_version: 'included-unless-excluded-v1',
      summary_hash: await opportunityFeedbackTextHash(text), source_hash: await opportunityFeedbackTextHash(source),
      summary_revision: 1, truncated: Array.from(source).length > 600, source_length: Array.from(source).length } });
}

test('default-included text is eligible without legacy approval and never invents interest', async () => {
  const saved = await includedExample(1);
  const result = await compileAdaptiveFeedbackSnapshot(input([saved]));
  assert.equal(result.counts.eligible, 1); assert.equal(result.counts.scored, 0);
  assert.equal(result.counts.approved_summaries, 1, 'the packet count includes current derived excerpts');
  assert.equal('summary_approval' in result.examples[0]!, false);
  assert.deepEqual(result.examples[0]!.summary_inclusion, saved.summary_inclusion);
  assert.equal(result.examples[0]!.interest_score, null); assert.equal(result.aggregates.mean_interest, null);
});

test('default excerpt proofs are length/hash/version checked and their source metadata changes the fingerprint', async () => {
  const saved = await includedExample(1, '🔬'.repeat(620));
  const first = await compileAdaptiveFeedbackSnapshot(input([saved]));
  assert.equal(first.examples[0]!.search_feedback_summary, '🔬'.repeat(600));
  assert.equal(first.examples[0]!.summary_inclusion!.source_length, 620);
  assert.equal(first.examples[0]!.summary_inclusion!.truncated, true);
  for (const patch of [{ policy_version: 'unsupported' }, { summary_hash: 'b'.repeat(64) }, { source_length: 599 },
    { source_length: 0 }, { source_length: 12001 }, { truncated: false }, { extra: 'Never copied' }]) {
    const invalid = { ...saved, summary_inclusion: { ...saved.summary_inclusion, ...patch } } as AdaptiveFeedbackExample;
    const result = await compileAdaptiveFeedbackSnapshot(input([invalid]));
    assert.equal(result.examples.length, 0, JSON.stringify(patch));
  }
  for (const patch of [{ source_hash: 'b'.repeat(64) }, { summary_revision: 2 }, { source_length: 621 }]) {
    const changed = await compileAdaptiveFeedbackSnapshot(input([{ ...saved, summary_inclusion: { ...saved.summary_inclusion!, ...patch } }]));
    assert.notEqual(changed.input_fingerprint, first.input_fingerprint);
  }
});

test('technical past metadata survives without turning closure or requirements into dislike', async () => {
  const archived = Object.assign(example(1, { interest_score: null, interest_origin: 'none', manually_archived: true,
    technical_issue_category: 'requirements' }), { technical_issue_note: 'Private Person private@example.invalid', notes: 'Private note' });
  const result = await compileAdaptiveFeedbackSnapshot(input([archived]));
  assert.equal(result.counts.eligible, 1); assert.equal(result.counts.scored, 0);
  assert.equal(result.aggregates.mean_interest, null);
  assert.equal(result.examples[0]!.manually_archived, true);
  assert.equal(result.examples[0]!.technical_issue_category, 'requirements');
  assert.equal(result.examples[0]!.interest_score, null); assert.deepEqual(result.examples[0]!.reasons, []);
  assert.doesNotMatch(JSON.stringify(result), /technical_issue_note|private@example|Private Person|"notes"/u);
  const closed = await compileAdaptiveFeedbackSnapshot(input([{ ...archived, technical_issue_category: 'closed' }]));
  assert.notEqual(closed.input_fingerprint, result.input_fingerprint);
});

test('AF-03 cold start is bounded and feedback examples are included by default without a sharing toggle', async () => {
  const cold = await compileAdaptiveFeedbackSnapshot(input());
  assert.equal(cold.metric_version, 'opportunity-interest-v1');
  assert.equal(cold.selection_policy_version, ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION);
  assert.equal(cold.fingerprint_encoding, ADAPTIVE_FEEDBACK_FINGERPRINT_ENCODING);
  assert.deepEqual(cold.examples, []);
  assert.equal(cold.counts.eligible, 0);
  assert.equal(cold.aggregates.mean_interest, null);
  assert.equal(cold.aggregates.score_sum, 0);
  const populated = await compileAdaptiveFeedbackSnapshot(input([example(1)]));
  assert.equal(populated.counts.eligible, 1);
  assert.equal(populated.examples.length, 1);
  assert.equal(Object.hasOwn(populated, 'consent_revision'), false);
  assert.equal(Object.hasOwn(populated, 'structured_feedback_enabled'), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(cold)).length <= ADAPTIVE_FEEDBACK_MAX_BYTES);
});

test('AF-03 aggregates include the entire distinct eligible set before selecting at most 16 examples', async () => {
  const samples = Array.from({ length: 60 }, (_, index) => example(index + 1, { interest_score: index % 10, institution: `Institute ${index % 5}` }));
  const snapshot = await compileAdaptiveFeedbackSnapshot(input(samples));
  assert.equal(snapshot.examples.length, 16);
  assert.equal(snapshot.counts.eligible, 60);
  assert.equal(snapshot.counts.scored, 60);
  assert.equal(snapshot.aggregates.score_sum, 270);
  assert.equal(snapshot.aggregates.mean_interest, 4.5);
  assert.equal(snapshot.counts.omitted_limit, 44);
  const topic = snapshot.aggregates.groups.find(group => group.kind === 'topic' && group.key === 'acoustic sensing');
  assert.equal(topic?.count, 60, 'sampling cannot bias the topic denominator');
  assert.equal(topic?.mean_interest, 4.5);
  assert.equal(new Set(snapshot.examples.map(item => item.opportunity_id)).size, 16);
});

test('AF-03 balanced selection covers submissions, explicit high interest and both discrepancy directions once', async () => {
  const submission = example(1, { interest_score: 9, interest_origin: 'confirmed_submission', confirmed_submission: true, submission_at: null });
  const high = example(2, { interest_score: 8 });
  const negative = discrepancy(3, 2, 8), positive = discrepancy(4, 8, 2);
  const remaining = Array.from({ length: 24 }, (_, index) => example(index + 10));
  const snapshot = await compileAdaptiveFeedbackSnapshot(input([...remaining, positive, negative, high, submission]));
  assert.deepEqual(snapshot.examples.slice(0, 4).map(item => item.opportunity_id), [1, 2, 3, 4].map(id));
  assert.equal(new Set(snapshot.examples.map(item => item.opportunity_id)).size, snapshot.examples.length, 'positive high interest occupies one slot');
  assert.equal(snapshot.examples[0]!.submission_at, null, 'unknown historical submission time stays unknown');
  assert.equal(snapshot.examples.find(item => item.opportunity_id === id(3))?.original_prediction?.score, 8);
});

test('AF-03 selection prefers explicit evidence and then unseen institutions/topics with stable-ID ties', async () => {
  const samples = [example(1, { institution: 'A', topics: ['One'] }), example(2, { institution: 'A', topics: ['One'] }),
    example(3, { institution: 'B', topics: ['One'] }), example(4, { institution: 'A', topics: ['Two'] })];
  const snapshot = await compileAdaptiveFeedbackSnapshot(input(samples.reverse()));
  assert.deepEqual(snapshot.examples.map(item => item.opportunity_id), [1, 3, 4, 2].map(id));
  const submitted = await compileAdaptiveFeedbackSnapshot(input([
    example(1, { interest_origin: 'confirmed_submission', interest_score: 9, confirmed_submission: true }),
    example(9, { interest_score: 2, confirmed_submission: true }),
  ]));
  assert.equal(submitted.examples[0]!.opportunity_id, id(9), 'explicit low interest outranks a weak submission preference proxy');
});

test('current feedback omits institution cohorts without changing project examples, diversity or topic statistics', async () => {
  const samples = Array.from({ length: 20 }, (_, index) => example(index + 1, {
    metric_version: 'opportunity-interest-v2', interest_origin: 'categorical_review', review_state: 'strong_interest', interest_score: 8,
    institution: `Institute ${index % 5}`, topics: [index % 2 ? 'Acoustics' : 'Robotics'],
  }));
  const current = await compileAdaptiveFeedbackSnapshot(input(samples, { metric_version: 'opportunity-interest-v2' }));
  const historical = await compileAdaptiveFeedbackSnapshot(input(samples.map(item => ({ ...item, metric_version: 'opportunity-interest-v1' }))));
  assert.equal(current.aggregates.groups.some(group => group.kind === 'institution'), false);
  assert.ok(historical.aggregates.groups.some(group => group.kind === 'institution'), 'historical compiler retains its original cohorts');
  assert.deepEqual(current.examples.map(item => item.opportunity_id), historical.examples.map(item => item.opportunity_id));
  assert.equal(current.examples.length, 16);
  assert.equal(new Set(current.examples.map(item => item.institution)).size, 5);
  assert.ok(current.examples.every(item => item.institution));
  assert.deepEqual(current.aggregates.groups, historical.aggregates.groups.filter(group => group.kind !== 'institution'));
  assert.equal(current.counts.eligible, 20); assert.equal(current.aggregates.score_sum, 160);
});

test('AF-03 summary-only and reason-only observations preserve unknown interest and use only scored denominators', async () => {
  const summary = await summaryExample(3);
  const reason = example(4, { interest_score: null, interest_origin: 'none', feedback_updated_at: null, reasons: [{ category: 'funding', polarity: 'negative' }] });
  const viewOnly = example(5, { interest_score: null, interest_origin: 'none', feedback_updated_at: null });
  const snapshot = await compileAdaptiveFeedbackSnapshot(input([example(1, { interest_score: 0.1 }), example(2, { interest_score: 0.2 }), summary, reason, viewOnly]));
  assert.equal(snapshot.counts.eligible, 4);
  assert.equal(snapshot.counts.scored, 2);
  assert.equal(snapshot.counts.approved_summaries, 1);
  assert.equal(snapshot.aggregates.score_sum, 0.3, 'decimal accumulation mirrors PostgreSQL numeric');
  assert.equal(snapshot.aggregates.mean_interest, 0.15);
  const selectedSummary = snapshot.examples.find(item => item.opportunity_id === id(3))!;
  assert.equal(selectedSummary.interest_score, null);
  assert.equal(selectedSummary.feedback_updated_at, null);
  assert.equal(selectedSummary.original_prediction, undefined);
  const funding = snapshot.aggregates.groups.find(group => group.kind === 'funding');
  assert.equal(funding?.count, 1); assert.equal(funding?.scored, 0); assert.equal(funding?.mean_interest, null);
});

test('AF-03 group identity uses normalized keys and counts one opportunity only once per group', async () => {
  const sample = example(1, { topics: ['BCI', ' bci ', 'BCI'], institution: ' INSTITUTE ',
    reasons: [{ category: 'topic', polarity: 'positive', target: 'BCI' }, { category: 'topic', polarity: 'positive', target: ' bci ' }] });
  const snapshot = await compileAdaptiveFeedbackSnapshot(input([sample]));
  assert.deepEqual(snapshot.aggregates.groups.map(group => [group.kind, group.key, group.polarity ?? null, group.count]),
    [['institution', 'institute', null, 1], ['topic', 'bci', null, 1], ['topic', 'bci', 'positive', 1]]);
});

test('AF-03 exact duplicate joins contribute once, while conflicting current outcomes cannot be silently chosen', async () => {
  const current = example(1);
  const duplicate = Object.assign(example(1), { comment: 'Never exported', context_json: { secret: 'Never exported' } });
  const snapshot = await compileAdaptiveFeedbackSnapshot(input([current, duplicate]));
  assert.equal(snapshot.counts.eligible, 1);
  await assert.rejects(compileAdaptiveFeedbackSnapshot(input([current, example(1, { interest_score: 0 })])), /Conflicting current/);
  const corrected = await compileAdaptiveFeedbackSnapshot(input([current, example(1, { interest_score: 0, feedback_revision: 2 })]));
  assert.equal(corrected.examples[0]!.interest_score, 0);
  assert.equal(corrected.counts.eligible, 1);
});

test('AF-03 fingerprints are deterministic semantic inputs independent of assigned revision and view/private metadata', async () => {
  const samples = [example(2), example(1)];
  const first = await compileAdaptiveFeedbackSnapshot(input(samples));
  const reordered = await compileAdaptiveFeedbackSnapshot(input(samples.toReversed(), { feedback_revision: 20 }));
  assert.equal(first.input_fingerprint, reordered.input_fingerprint);
  assert.equal(reordered.feedback_revision, 20);
  const noisy = samples.map(item => Object.assign({ ...item }, { updated_at: '2099-01-01T00:00:00Z', reviewed_updated_at: '2099-01-01T00:00:00Z',
    personal_fit: { score: 10 }, comment: 'Private Person person@example.invalid', contacts: [{ email: 'person@example.invalid' }], notes: 'Never exported' }));
  const viewed = await compileAdaptiveFeedbackSnapshot(input(noisy));
  assert.equal(first.input_fingerprint, viewed.input_fingerprint);
  assert.doesNotMatch(JSON.stringify(viewed), /person@example|Private Person|contacts|"comment"|"notes"|personal_fit/u);
  const changed = await compileAdaptiveFeedbackSnapshot(input([example(2), example(1, { interest_score: 0 })]));
  assert.notEqual(first.input_fingerprint, changed.input_fingerprint);
  const preferences = await compileAdaptiveFeedbackSnapshot(input(samples, { preference_revision: 2 }));
  assert.notEqual(first.input_fingerprint, preferences.input_fingerprint);
});

test('current inclusion revision participates in the semantic fingerprint and missing or stale proofs omit text', async () => {
  const summary = await summaryExample(1);
  const original = await compileAdaptiveFeedbackSnapshot(input([summary]));
  const revised = await compileAdaptiveFeedbackSnapshot(input([{ ...summary, summary_inclusion: { ...summary.summary_inclusion!, summary_revision: 2 } }]));
  assert.notEqual(original.input_fingerprint, revised.input_fingerprint);
  const removed = await compileAdaptiveFeedbackSnapshot(input([{ ...summary, summary_inclusion: undefined }]));
  assert.equal(removed.examples.length, 0); assert.equal(removed.counts.approved_summaries, 0);
  const edited = await compileAdaptiveFeedbackSnapshot(input([{ ...summary, search_feedback_summary: 'Changed with stale proof.' }]));
  assert.equal(edited.examples.length, 0);
  const retired = await compileAdaptiveFeedbackSnapshot(input([Object.assign({ ...summary,summary_inclusion:undefined },
    { summary_approval:{summary_hash:await opportunityFeedbackTextHash(summary.search_feedback_summary!),source_hash:'a'.repeat(64),summary_revision:1,approved_at:now} })]));
  assert.equal(retired.examples.length, 0, 'retired proof formats never authorize current text');
});

test('AF-03 only valid, timely owner-matched original predictions survive; current fit never establishes a baseline', async () => {
  const known = discrepancy(1, 2, 8);
  const unknown = Object.assign(example(2), { personal_fit: { score: 8, scale_min: 0, scale_max: 10 } });
  const wrongOwner = discrepancy(3, 2, 8); wrongOwner.original_prediction!.user_id = id(999);
  const future = discrepancy(4, 2, 8); future.original_prediction!.predicted_at = '2026-10-29T12:00:00.000001Z';
  const malformed = discrepancy(5, 2, 8); malformed.feedback_updated_at = '2026-10-29T24:00:00Z';
  const result = await compileAdaptiveFeedbackSnapshot(input([known, unknown, wrongOwner, future, malformed]));
  assert.equal(result.counts.baseline_available, 1);
  for (const row of result.examples.filter(item => item.opportunity_id !== id(1))) {
    assert.equal(row.original_prediction, undefined); assert.equal(row.interest_gap, null);
  }
  assert.equal(result.examples.find(item => item.opportunity_id === id(5))!.feedback_updated_at, null);
  assert.equal(result.examples.find(item => item.opportunity_id === id(2))!.baseline_status, 'unavailable');
});

test('AF-05 feedback packets preserve valid discovery assessment provenance and reject mismatched reference kinds', async () => {
  const valid = discrepancy(1, 2, 8);
  valid.original_prediction!.source_kind = 'discovery_assessment';
  valid.original_prediction!.source_ref = `opportunity-discovery-assessment:${id(990)}`;
  const wrongPrefix = discrepancy(2, 2, 8); wrongPrefix.original_prediction!.source_kind = 'discovery_assessment';
  const wrongKind = discrepancy(3, 2, 8); wrongKind.original_prediction!.source_ref = `opportunity-discovery-assessment:${id(991)}`;
  const result = await compileAdaptiveFeedbackSnapshot(input([valid, wrongPrefix, wrongKind]));
  assert.equal(result.counts.baseline_available, 1);
  assert.deepEqual(result.examples.find(item => item.opportunity_id === id(1))!.original_prediction, valid.original_prediction);
  for (const item of result.examples.filter(item => item.opportunity_id !== id(1))) {
    assert.equal(item.baseline_status, 'unavailable');
    assert.equal(item.interest_gap, null);
    assert.equal(item.original_prediction, undefined);
  }
});

test('AF-03 byte bounds omit complete examples without truncating text or biasing whole-set statistics', async () => {
  const research = '🔬'.repeat(1000);
  const topics = Array.from({ length: 16 }, (_, index) => `${'🔬'.repeat(119)}${String.fromCharCode(65 + index)}`);
  const samples = Array.from({ length: 32 }, (_, index) => example(index + 1, { research_summary: research, topics }));
  const result = await compileAdaptiveFeedbackSnapshot(input(samples));
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= ADAPTIVE_FEEDBACK_MAX_BYTES);
  assert.ok(result.counts.omitted_bytes > 0);
  assert.equal(result.counts.eligible, 32); assert.equal(result.counts.scored, 32);
  assert.equal(result.counts.omitted_limit, 16);
  assert.equal(result.counts.selected + result.counts.omitted_limit + result.counts.omitted_bytes, 32);
  assert.equal(result.aggregates.mean_interest, 6);
  for (const row of result.examples) { assert.equal(row.research_summary, research); assert.deepEqual(row.topics.toSorted(), topics.toSorted()); }
});

test('AF-03 bounded group output reports complete omitted groups and preserves approved structured inputs', async () => {
  const approved: ApprovedAdaptivePreference[] = Array.from({ length: 32 }, (_, index) => ({ preference_id: `preference-${index}`, category: 'topic', polarity: 'positive', target: '🔬'.repeat(120) }));
  const samples = Array.from({ length: 100 }, (_, index) => example(index + 1, { institution: `${'🔬'.repeat(195)}${index}`, topics: [] }));
  const result = await compileAdaptiveFeedbackSnapshot(input(samples, { approved_preferences: approved, preference_revision: 3 }));
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= ADAPTIVE_FEEDBACK_MAX_BYTES);
  assert.ok(result.counts.omitted_groups >= 36);
  assert.equal(result.aggregates.groups.length + result.counts.omitted_groups, 100);
  assert.equal(result.aggregates.score_sum, 600);
  assert.equal(result.approved_preferences.length, 32);
  assert.equal(result.preference_revision, 3);
  assert.ok(result.approved_preferences.every(item => item.target === '🔬'.repeat(120)));
});

test('AF-03 strict preference/scope contracts reject malformed values without leaking private input', async () => {
  for (const patch of [{ user_id: 'person@example.invalid' }, { feedback_revision: -1 }, { preference_revision: NaN }]) {
    await assert.rejects(compileAdaptiveFeedbackSnapshot(input([], patch)), /Invalid feedback snapshot scope or revision/);
  }
  await assert.rejects(compileAdaptiveFeedbackSnapshot(input([], { approved_preferences: [{ preference_id: 'safe', category: 'topic', polarity: 'positive', target: 'person@example.invalid' }] })), /Invalid approved/);
  const foreign = Object.assign(example(1), { user_id: id(999) });
  const result = await compileAdaptiveFeedbackSnapshot(input([foreign]));
  assert.equal(result.counts.eligible, 0);
  assert.doesNotMatch(JSON.stringify(result), /person@example/u);
});

test('AF-03 asynchronous hashing captures scalar proof values and never aliases or mutates input objects', async () => {
  const summary = await summaryExample(1);
  const before = structuredClone(summary);
  const pending = compileAdaptiveFeedbackSnapshot(input([summary]));
  summary.summary_inclusion!.source_hash = 'person@example.invalid';
  summary.topics.push('Changed after compilation began');
  const result = await pending;
  assert.equal(result.examples[0]!.summary_inclusion!.source_hash, before.summary_inclusion!.source_hash);
  assert.deepEqual(result.examples[0]!.topics, before.topics);
  result.examples[0]!.reasons.push({ category: 'other', polarity: 'negative' });
  assert.deepEqual(summary.reasons, []);
  assert.doesNotMatch(JSON.stringify(result), /person@example/u);
});

test('current feedback packets use categorical choices and application scores while v1 evidence stays historical', async () => {
  const current = [
    example(1, { metric_version: 'opportunity-interest-v2', review_state: 'very_high_interest', interest_origin: 'categorical_review', interest_score: 9 }),
    example(2, { metric_version: 'opportunity-interest-v2', review_state: 'not_interested', interest_origin: 'application', interest_score: 9 }),
    example(3, { metric_version: 'opportunity-interest-v2', review_state: 'not_interested', interest_origin: 'confirmed_submission', interest_score: 9.5, confirmed_submission: true }),
  ];
  const packet = await compileAdaptiveFeedbackSnapshot(input([...current, example(4)], { metric_version: 'opportunity-interest-v2' }));
  assert.equal(packet.metric_version, 'opportunity-interest-v2');
  assert.equal(packet.counts.eligible, 3);
  assert.equal(packet.counts.application, 1);
  assert.equal(packet.counts.submission_fallback, 1);
  assert.equal(packet.counts.categorical_review, 1);
  assert.equal(packet.counts.explicit_rating, 0);
  assert.equal(packet.aggregates.mean_interest, 9.166667);
  assert.equal(packet.examples.find(row => row.opportunity_id === id(2))?.review_state, 'not_interested');
  const historical = await compileAdaptiveFeedbackSnapshot(input([example(4, { interest_score: 0 })]));
  assert.equal(historical.metric_version, 'opportunity-interest-v1');
  assert.equal(historical.examples[0]?.interest_score, 0);
});

test('current packet validation rejects retired overrides and inconsistent application evidence', async () => {
  const candidates = [
    example(1, { metric_version: 'opportunity-interest-v2' }),
    example(2, { metric_version: 'opportunity-interest-v2', interest_origin: 'confirmed_submission', interest_score: 9, confirmed_submission: true }),
    example(3, { metric_version: 'opportunity-interest-v2', interest_origin: 'application', interest_score: 9, confirmed_submission: true }),
    example(4, { metric_version: 'opportunity-interest-v2', interest_origin: 'categorical_review', review_state: 'very_high_interest', interest_score: 8 }),
  ];
  const result = await compileAdaptiveFeedbackSnapshot(input(candidates, { metric_version: 'opportunity-interest-v2' }));
  assert.equal(result.counts.eligible, 0);
  const cold = await compileAdaptiveFeedbackSnapshot({ user_id: owner, search_id: search, feedback_revision: 1, examples: [] });
  assert.equal(cold.metric_version, 'opportunity-interest-v2');
  assert.equal(cold.counts.application, 0);
});

test('approved packet preferences reject positive requirements and availability', async () => {
  for (const category of ['requirements', 'availability'] as const) {
    const preference = { preference_id: 'avoid-condition', category, polarity: 'negative' as const, target: 'Recorded condition' };
    const packet = await compileAdaptiveFeedbackSnapshot(input([], { metric_version: 'opportunity-interest-v2', approved_preferences: [preference] }));
    assert.equal(packet.approved_preferences[0]?.category, category);
    await assert.rejects(compileAdaptiveFeedbackSnapshot(input([], { approved_preferences: [{ ...preference, polarity: 'positive' }] })), /Invalid approved/u);
  }
});
