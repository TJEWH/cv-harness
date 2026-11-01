import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTIVE_QUALITY_MAX_BACKLOG, ADAPTIVE_QUALITY_MAX_CHECKS, ADAPTIVE_QUALITY_MAX_REPORT_BYTES,
  adaptiveDiscoveryLeadTime, calculateAdaptiveSearchQuality,
  type AdaptiveDeadlineEvidence, type AdaptiveQualityDiscovery, type AdaptiveQualityExecution, type AdaptiveQualityFeedback, type AdaptiveQualityInput,
} from '../../../src/features/meta-search/domain/adaptiveSearchQuality';

const owner = '75000000-0000-4000-8000-000000000001', search = '75000000-0000-4000-8000-000000000002';
const id = (index: number) => `76000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const scope = { user_id: owner, search_id: search }, now = '2026-10-20T12:00:00Z';
const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
function execution(index = 1, patch: Partial<AdaptiveQualityExecution> = {}): AdaptiveQualityExecution {
  return { ...scope, run_id: id(1000), check_id: id(index), kind: 'query', query_id: id(2000), text_hash: hash,
    source_registry_id: id(3000), attempted_at: '2026-10-20T10:00:00Z', status: 'complete', results_count: 1, ...patch };
}
function discovery(index = 1, patch: Partial<AdaptiveQualityDiscovery> = {}): AdaptiveQualityDiscovery {
  return { ...scope, discovery_id: id(4000 + index), run_id: id(1000), item_id: id(5000 + index), opportunity_id: id(6000 + index),
    primary_discovery: true, discovered_at: '2026-10-20T10:10:00Z', encountered_at: '2026-10-20T10:10:00Z', execution_refs: [id(1)], primary_check_id: id(1),
    topics: ['BCI', 'Robotics'], institution: 'Synthetic Institute', recommendation_eligible: true, recommendation_generated: false,
    updated_only: false, verified_at: now, ...patch };
}
function feedback(index = 1, patch: Partial<AdaptiveQualityFeedback> = {}): AdaptiveQualityFeedback {
  return { user_id: owner, opportunity_id: id(6000 + index), metric_version: 'opportunity-interest-v1', interest_score: 8,
    interest_origin: 'explicit_rating', confirmed_submission: false, submission_at: null, feedback_revision: 1,
    feedback_updated_at: now, baseline_status: 'unavailable', interest_gap: null, review_state: 'unreviewed', ...patch };
}
function input(patch: Partial<AdaptiveQualityInput> = {}): AdaptiveQualityInput {
  return { ...scope, executions: [execution()], discoveries: [discovery()], feedback: [feedback()], report_complete: true, ...patch };
}
function deadline(patch: Partial<AdaptiveDeadlineEvidence> = {}): AdaptiveDeadlineEvidence {
  return { deadline: '2026-10-23T12:00:00Z', official_verified: true, precision: 'instant', ...patch };
}

test('LOG-02: ten actual rediscoveries yield one unique owner outcome, not ten successes', () => {
  const checks = Array.from({ length: 10 }, (_, index) => execution(index + 1, { run_id: id(1000 + index) }));
  const encounters = checks.map((check, index) => discovery(1, { discovery_id: id(4000 + index), run_id: check.run_id,
    item_id: id(5000 + index), execution_refs: [check.check_id], primary_check_id: check.check_id, primary_discovery: index === 0 }));
  const result = calculateAdaptiveSearchQuality(input({ executions: checks, discoveries: encounters }));
  assert.equal(result.overall.unique_discoveries, 1); assert.equal(result.overall.unique_encounters, 1);
  assert.equal(result.overall.reviewed, 1); assert.equal(result.overall.explicit_high_interest, 1);
  assert.equal(result.sources[0]!.unique_discoveries, 1); assert.equal(result.sources[0]!.executions, 10);
  assert.equal(result.queries[0]!.unique_discoveries, 1); assert.equal(result.queries[0]!.executions, 10);
  assert.equal(result.coverage.executed_checks, 10);
});

test('LOG-01: saved, unexecuted queries have zero execution and no empty-success credit', () => {
  const result = calculateAdaptiveSearchQuality(input({ executions: [], discoveries: [], feedback: [],
    planned_queries: [{ ...scope, run_id: id(1000), query_id: id(2000), text_hash: hash }] }));
  assert.equal(result.queries[0]!.executions, 0); assert.equal(result.queries[0]!.unique_discoveries, 0);
  assert.equal(result.coverage.executed_checks, 0); assert.equal(result.coverage.empty_successes, 0);
  assert.equal(result.coverage.missing_checks, 1); assert.equal(result.coverage.status, 'unreported');
  assert.equal(result.coverage.incomplete, true);
});

test('planned query hashes reject arrays and coercible objects before constructing the closed metrics DTO', () => {
  for (const value of [[hash], { toString: () => hash }, null, 123]) {
    const planned = { ...scope, run_id: id(1000), query_id: id(2000), text_hash: value };
    assert.throws(() => calculateAdaptiveSearchQuality(input({ executions: [], discoveries: [], feedback: [],
      planned_queries: [planned as unknown as NonNullable<AdaptiveQualityInput['planned_queries']>[number]] })), /Invalid pinned query text hash/u);
  }
});

test('LOG-03: complete empty checks, failed zero and partial runs retaining verified results remain distinct', () => {
  const empty = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { results_count: 0 })], discoveries: [], feedback: [] }));
  assert.equal(empty.coverage.status, 'complete_empty'); assert.equal(empty.coverage.empty_successes, 1);
  const failed = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { status: 'failed', results_count: 0 })], discoveries: [], feedback: [] }));
  assert.equal(failed.coverage.status, 'incomplete'); assert.equal(failed.coverage.failed_checks, 1); assert.equal(failed.coverage.empty_successes, 0);
  const partial = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { status: 'partial' })] }));
  assert.equal(partial.coverage.incomplete, true); assert.equal(partial.overall.unique_discoveries, 1);
  assert.equal(partial.overall.mean_interest, 8);
});

test('successful retries resolve logical coverage while retaining failed attempt counts', () => {
  const result = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { status: 'failed', results_count: 0 }), execution(2, { results_count: 0 })],
    discoveries: [], feedback: [], planned_queries: [{ ...scope, run_id: id(1000), query_id: id(2000), text_hash: hash }] }));
  assert.equal(result.coverage.executed_checks, 2); assert.equal(result.coverage.failed_checks, 1);
  assert.equal(result.coverage.empty_successes, 1); assert.equal(result.coverage.missing_checks, 0);
  assert.equal(result.coverage.unresolved_checks, 0); assert.equal(result.coverage.incomplete, false);
  assert.equal(result.coverage.status, 'complete_empty');
});

test('a later failed attempt invalidates earlier success until a later success regardless of input order', () => {
  const complete = execution(1, { attempted_at: '2026-10-20T09:00:00Z', results_count: 0 });
  const failed = execution(2, { attempted_at: '2026-10-20T10:00:00Z', status: 'blocked', results_count: 0 });
  const later = execution(3, { attempted_at: '2026-10-20T11:00:00Z', results_count: 0 });
  const stale = calculateAdaptiveSearchQuality(input({ executions: [failed, complete], discoveries: [], feedback: [] }));
  assert.equal(stale.coverage.unresolved_checks, 1); assert.equal(stale.coverage.incomplete, true);
  const resolved = calculateAdaptiveSearchQuality(input({ executions: [later, complete, failed], discoveries: [], feedback: [] }));
  assert.equal(resolved.coverage.unresolved_checks, 0); assert.equal(resolved.coverage.status, 'complete_empty');
});

test('long-lived multi-run history and exact duplicates do not invent report overflow', () => {
  const history = Array.from({ length: ADAPTIVE_QUALITY_MAX_CHECKS + 1 }, (_, index) =>
    execution(index + 1, { run_id: id(1000 + index), results_count: 0 }));
  const quality = calculateAdaptiveSearchQuality(input({ executions: [...history, ...history], discoveries: [], feedback: [] }));
  assert.equal(quality.coverage.executed_checks, history.length);
  assert.equal(quality.coverage.report_overflow, false); assert.equal(quality.coverage.status, 'complete_empty');
  assert.equal(calculateAdaptiveSearchQuality(input({ report_overflow: true })).coverage.report_overflow, true);
});

test('blocked, paginated and dynamic checks are incomplete, and pending result verification grants no outcome credit', () => {
  const statuses: AdaptiveQualityExecution['status'][] = ['complete', 'blocked', 'failed', 'partial', 'paginated', 'dynamic'];
  const result = calculateAdaptiveSearchQuality(input({ executions: statuses.map((status, index) => execution(index + 1, { query_id: id(2000 + index), status, results_count: status === 'complete' ? 0 : null })),
    discoveries: [discovery(1, { verified_at: null })] }));
  assert.equal(result.coverage.executed_checks, 6); assert.equal(result.coverage.complete_checks, 1);
  assert.equal(result.coverage.blocked_checks, 1); assert.equal(result.coverage.failed_checks, 1);
  assert.equal(result.coverage.partial_checks, 1); assert.equal(result.coverage.paginated_checks, 1); assert.equal(result.coverage.dynamic_checks, 1);
  assert.equal(result.coverage.incomplete, true); assert.equal(result.overall.unique_encounters, 0);
});

test('explicit review denominators preserve zero and exclude unreviewed submission fallbacks', () => {
  const result = calculateAdaptiveSearchQuality(input({ discoveries: [1, 2, 3, 4].map(index => discovery(index)), feedback: [
    feedback(1, { interest_score: 0 }), feedback(2, { review_state: 'strong_interest', interest_origin: 'categorical_review', interest_score: 8 }),
    feedback(3, { interest_origin: 'confirmed_submission', interest_score: 9, confirmed_submission: true }),
    feedback(4, { interest_origin: 'none', interest_score: null }),
  ] }));
  assert.equal(result.overall.reviewed, 2); assert.equal(result.overall.with_interest, 3);
  assert.equal(result.overall.explicit_high_interest, 1); assert.equal(result.overall.high_interest_rate, 0.5);
  assert.equal(result.overall.mean_interest, 5.666667); assert.equal(result.overall.confirmed_submissions, 1);
  assert.equal(result.overall.submission_fallback, 1); assert.equal(result.overall.explicit_rating, 1); assert.equal(result.overall.categorical_review, 1);
});

test('excluded opportunities retain discovery facts but provide no adaptive preference denominator or submission reward', () => {
  const result = calculateAdaptiveSearchQuality(input({ feedback: [feedback(1, { interest_origin: 'excluded', interest_score: null, review_state: 'not_interested', confirmed_submission: true })] }));
  assert.equal(result.overall.unique_discoveries, 1); assert.equal(result.overall.reviewed, 0);
  assert.equal(result.overall.with_interest, 0); assert.equal(result.overall.confirmed_submissions, 0);
  assert.equal(result.overall.high_interest_rate, null); assert.equal(result.overall.mean_interest, null);
});

test('source/topic/query figures overlap while query text versions remain distinct', () => {
  const newer = execution(2, { run_id: id(1001), text_hash: otherHash });
  const result = calculateAdaptiveSearchQuality(input({ executions: [execution(), newer],
    discoveries: [discovery(), discovery(1, { discovery_id: id(4002), run_id: id(1001), execution_refs: [newer.check_id], primary_discovery: false })] }));
  assert.equal(result.overall.unique_discoveries, 1); assert.equal(result.overall.unique_encounters, 1);
  assert.equal(result.queries.length, 2); assert.deepEqual(result.queries.map(row => row.unique_discoveries), [1, 0]);
  assert.equal(result.topics.reduce((sum, row) => sum + row.unique_discoveries, 0), 2);
  assert.equal(result.groups_overlap, true, 'dimension totals cannot be summed into an overall success total');
});

test('historical attribution remains unknown; created_at, contacts and application-looking blobs cannot invent discoveries', () => {
  const historical = Object.assign(discovery(1, { discovered_at: null, execution_refs: [] }), { created_at: '2020-01-01T00:00:00Z',
    query_id: id(999), contacts: [{ name: 'Synthetic Person', email: 'private@example.invalid' }], context_json: { notes: 'Never export' } });
  const result = calculateAdaptiveSearchQuality(input({ discoveries: [historical], executions: [] }));
  assert.equal(result.overall.unique_discoveries, 0); assert.equal(result.overall.unique_encounters, 1);
  assert.deepEqual(result.attribution, { primary: 0, secondary_only: 0, unknown: 1 });
  assert.equal(result.queries.length, 0); assert.equal(result.sources.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /2020-01-01|private@example|Synthetic Person|context_json|contacts/u);
});

test('current feedback updates metrics without rewriting immutable historical run assessments', () => {
  const event = discovery(1, { original_assessment: { score: 8.5, scale_min: 0, scale_max: 10 }, assessment_recorded_at: now, assessment_verified_at: now, assessment_version: 'original-v1' });
  const before = JSON.stringify(event);
  const old = calculateAdaptiveSearchQuality(input({ discoveries: [event] }));
  const current = calculateAdaptiveSearchQuality(input({ discoveries: [event], feedback: [feedback(1, { interest_score: 2, feedback_revision: 2 })] }));
  assert.equal(old.overall.mean_interest, 8); assert.equal(current.overall.mean_interest, 2);
  assert.equal(current.overall.unique_discoveries, 1); assert.equal(JSON.stringify(event), before);
  assert.equal(event.original_assessment!.score, 8.5);
});

test('LOG-05: recommendation generation and updates never claim notification delivery', () => {
  const event = Object.assign(discovery(1, { recommendation_generated: true }), { delivery_status: 'delivered', notification_sent: true });
  const result = calculateAdaptiveSearchQuality(input({ discoveries: [event] }));
  assert.deepEqual(result.recommendations, { eligible: 1, generated: 1, updated_only: 0, delivery_status: 'unknown' });
});

test('PRIV-07: foreign owner/search execution, discovery and feedback records do not affect private metrics', () => {
  const foreign = { user_id: id(999), search_id: search };
  const result = calculateAdaptiveSearchQuality(input({ executions: [execution(), execution(2, { ...foreign, source_registry_id: id(3999) })],
    discoveries: [discovery(), discovery(2, { ...foreign, opportunity_id: id(6999), institution: 'Foreign Institute' })],
    feedback: [feedback(), feedback(1, { user_id: foreign.user_id, interest_score: 0 })] }));
  assert.equal(result.overall.unique_encounters, 1); assert.equal(result.overall.mean_interest, 8);
  assert.doesNotMatch(JSON.stringify(result), /Foreign Institute|000000000f9f/u);
  const other = calculateAdaptiveSearchQuality(input({ user_id: foreign.user_id }));
  assert.equal(other.overall.unique_encounters, 0); assert.equal(other.coverage.executed_checks, 0);
});

test('bounded reports expose backlog, check/group overflow and incomplete coverage without biased overall totals', () => {
  const checks = Array.from({ length: ADAPTIVE_QUALITY_MAX_CHECKS + 1 }, (_, index) => execution(index + 1));
  const backlog = Array.from({ length: ADAPTIVE_QUALITY_MAX_BACKLOG + 2 }, (_, index) => ({ candidate_key: `candidate-${index}`, reason: 'verification_required' }));
  const result = calculateAdaptiveSearchQuality(input({ executions: checks, unresolved_candidates: backlog,
    report_bytes: ADAPTIVE_QUALITY_MAX_REPORT_BYTES + 1 }));
  assert.equal(result.coverage.executed_checks, ADAPTIVE_QUALITY_MAX_CHECKS + 1);
  assert.equal(result.coverage.report_overflow, true); assert.equal(result.coverage.incomplete, true);
  assert.deepEqual(result.backlog, { retained: ADAPTIVE_QUALITY_MAX_BACKLOG, omitted: 2, incomplete: true });
  const many = calculateAdaptiveSearchQuality(input({ discoveries: Array.from({ length: 65 }, (_, index) => discovery(index + 1, { topics: [`Topic ${index}`] })),
    feedback: Array.from({ length: 65 }, (_, index) => feedback(index + 1)) }));
  assert.equal(many.overall.unique_discoveries, 65); assert.equal(many.topics.length, 64);
  assert.equal(many.omitted_groups.topics, 1); assert.equal(many.coverage.incomplete, true);
});

test('execution retries deduplicate exact check IDs and conflicting receipts fail without inventing an execution', () => {
  const result = calculateAdaptiveSearchQuality(input({ executions: [execution(), execution()] }));
  assert.equal(result.coverage.executed_checks, 1);
  assert.throws(() => calculateAdaptiveSearchQuality(input({ executions: [execution(), execution(1, { status: 'failed' })] })), /Conflicting execution/);
});

test('a source-targeted web query does not satisfy an independently required direct source check', () => {
  const required = [{ ...scope, run_id: id(1000), registry_id: id(3000) }];
  const missing = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { results_count: 0 })], discoveries: [], feedback: [], required_sources: required }));
  assert.equal(missing.coverage.missing_checks, 1); assert.equal(missing.coverage.incomplete, true);
  const complete = calculateAdaptiveSearchQuality(input({ executions: [execution(1, { results_count: 0 }), execution(2, { kind: 'source', query_id: null, text_hash: null, results_count: 0 })],
    discoveries: [], feedback: [], required_sources: required }));
  assert.equal(complete.coverage.missing_checks, 0); assert.equal(complete.coverage.status, 'complete_empty');
});

test('a primary flag without valid attempted discovery evidence never earns discovery success', () => {
  const older = calculateAdaptiveSearchQuality(input({ discoveries: [discovery(1, { discovered_at: '2020-01-01T00:00:00Z' })] }));
  assert.equal(older.overall.unique_encounters, 1); assert.equal(older.overall.unique_discoveries, 0);
  const unknown = calculateAdaptiveSearchQuality(input({ discoveries: [discovery(1, { execution_refs: [id(999)] })] }));
  assert.equal(unknown.overall.unique_discoveries, 0); assert.equal(unknown.queries[0]!.unique_encounters, 0);
});

test('one primary check earns discovery credit while other referenced execution paths remain secondary encounters', () => {
  const other = execution(2, { query_id: id(2001), source_registry_id: id(3001) });
  const result = calculateAdaptiveSearchQuality(input({ executions: [execution(), other], discoveries: [discovery(1, { execution_refs: [id(1), id(2)] })] }));
  assert.equal(result.overall.unique_discoveries, 1);
  assert.deepEqual(result.queries.map(row => [row.unique_discoveries, row.unique_encounters]), [[1, 1], [0, 1]]);
  assert.deepEqual(result.sources.map(row => [row.unique_discoveries, row.unique_encounters]), [[1, 1], [0, 1]]);
});

test('LOG-04: first evidenced discovery lead time is separate from the current 72-hour recommendation check', () => {
  const lead = adaptiveDiscoveryLeadTime('2026-10-19T12:00:00Z', deadline(), '2026-10-22T12:00:00Z');
  assert.equal(lead.precision, 'exact_offset'); assert.equal(lead.lead_time_hours, 96);
  assert.equal(lead.recommendation_eligible, false); assert.equal(lead.recommendation_status, 'insufficient_lead');
  assert.equal(lead.late_discovery_status, 'not_late'); assert.equal(lead.late_discovery, false);
  const late = adaptiveDiscoveryLeadTime('2026-10-22T12:00:00Z', deadline(), '2026-10-22T12:00:00Z');
  assert.equal(late.lead_time_hours, 24); assert.equal(late.late_discovery_status, 'confirmed'); assert.equal(late.late_discovery, true);
});

test('exact 72-hour eligibility preserves microseconds and unknown discovery times are never fabricated', () => {
  assert.equal(adaptiveDiscoveryLeadTime(now, deadline(), now).recommendation_eligible, true);
  const justLate = adaptiveDiscoveryLeadTime('2026-10-20T12:00:00.000001Z', deadline(), '2026-10-20T12:00:00.000001Z');
  assert.equal(justLate.recommendation_eligible, false); assert.ok(justLate.lead_time_hours! < 72);
  const unknown = adaptiveDiscoveryLeadTime({ created_at: now }, deadline(), now);
  assert.equal(unknown.first_evidenced_discovery_at, null); assert.equal(unknown.lead_time_hours, null);
  assert.equal(unknown.recommendation_eligible, true, 'a current deadline check is independent of unknown historical discovery');
});

test('date-only deadlines use local midnight conservative bounds across real 23/25-hour days', () => {
  const spring = adaptiveDiscoveryLeadTime('2026-03-25T23:00:00Z', deadline({ deadline: '2026-03-29', deadline_timezone: 'Europe/Berlin', precision: 'date' }), '2026-03-25T23:00:00Z');
  assert.equal(spring.precision, 'date_only_conservative'); assert.equal(spring.assumption, 'date_only_00_local');
  assert.equal(spring.official_deadline_at, null); assert.equal(spring.lead_time_hours, null);
  assert.equal(spring.provisional, true); assert.equal(spring.deadline_at, spring.deadline_lower_bound_at);
  assert.equal(spring.deadline_lower_bound_at, '2026-03-28T23:00:00.000Z'); assert.equal(spring.deadline_upper_bound_at, '2026-03-29T22:00:00.000Z');
  assert.equal(spring.lead_time_lower_hours, 72); assert.equal(spring.lead_time_upper_hours, 95);
  assert.equal(spring.upper_bound_exclusive, true); assert.equal(spring.recommendation_eligible, true);
  const autumn = adaptiveDiscoveryLeadTime(null, deadline({ deadline: '2026-10-25', deadline_timezone: 'Europe/Berlin', precision: 'date' }));
  assert.equal(Date.parse(autumn.deadline_upper_bound_at!) - Date.parse(autumn.deadline_lower_bound_at!), 25 * 3_600_000);
});

test('ambiguous official local hours remain provisional bounds and use the earliest occurrence conservatively', () => {
  const result = adaptiveDiscoveryLeadTime('2026-10-22T01:00:00Z', deadline({ deadline: '2026-10-25', deadline_time_local: '02:30:00', deadline_timezone: 'Europe/Berlin' }), '2026-10-22T01:00:00Z');
  assert.equal(result.precision, 'ambiguous_bound'); assert.equal(result.assumption, 'ambiguous_local_time');
  assert.equal(result.provisional, true);
  assert.equal(result.official_deadline_at, null); assert.equal(result.lead_time_hours, null);
  assert.equal(result.deadline_lower_bound_at, '2026-10-25T00:30:00.000Z'); assert.equal(result.deadline_upper_bound_at, '2026-10-25T01:30:00.000Z');
  assert.equal(result.lead_time_lower_hours, 71.5); assert.equal(result.lead_time_upper_hours, 72.5);
  assert.equal(result.recommendation_eligible, false); assert.equal(result.late_discovery_status, 'possible'); assert.equal(result.late_discovery, null);
});

test('a conservative date bound distinguishes possible lateness from a verified late discovery', () => {
  const evidence = deadline({ deadline: '2026-10-30', deadline_timezone: 'UTC', precision: 'date' });
  const possible = adaptiveDiscoveryLeadTime('2026-10-27T12:00:00Z', evidence, '2026-10-27T12:00:00Z');
  assert.equal(possible.lead_time_lower_hours, 60); assert.equal(possible.lead_time_upper_hours, 84);
  assert.equal(possible.late_discovery_status, 'possible'); assert.equal(possible.recommendation_eligible, false);
  const confirmed = adaptiveDiscoveryLeadTime('2026-10-28T12:00:00Z', evidence, '2026-10-28T12:00:00Z');
  assert.equal(confirmed.lead_time_upper_hours, 60); assert.equal(confirmed.late_discovery_status, 'confirmed');
});

test('missing zones, impossible local clocks and unverified dates cannot become official precise deadlines', () => {
  for (const evidence of [deadline({ deadline: '2026-10-30', precision: 'date' }),
    deadline({ deadline: '2026-10-30', deadline_time_local: '17:00' }),
    deadline({ deadline: '2026-03-29', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin' }),
    deadline({ deadline: '2026-10-30', deadline_time_local: '24:00', deadline_timezone: 'Europe/Berlin' }),
    deadline({ deadline: '2026-02-30', precision: 'date', deadline_timezone: 'UTC' })]) {
    const result = adaptiveDiscoveryLeadTime(now, evidence, now);
    assert.equal(result.precision, 'unknown'); assert.equal(result.recommendation_eligible, null); assert.equal(result.lead_time_hours, null);
  }
  const provisional = adaptiveDiscoveryLeadTime(now, deadline({ official_verified: false }), now);
  assert.equal(provisional.precision, 'provisional'); assert.equal(provisional.assumption, 'unverified_deadline');
  assert.equal(provisional.official_deadline_at, null); assert.equal(provisional.recommendation_eligible, null); assert.equal(provisional.late_discovery_status, 'unknown');
});

test('verified local times and timestamp-owned offsets remain authoritative without host timezone guesses', () => {
  const local = adaptiveDiscoveryLeadTime(now, deadline({ deadline: '2026-10-30', deadline_time_local: '17:00:00', deadline_timezone: 'Europe/Berlin' }), now);
  assert.equal(local.precision, 'official_local'); assert.equal(local.official_deadline_at, '2026-10-30T16:00:00.000Z');
  assert.equal(local.provisional, false);
  const offset = adaptiveDiscoveryLeadTime(now, deadline({ deadline: '2026-10-23T14:00+02', deadline_timezone: 'Invalid/Zone' }), now);
  assert.equal(offset.precision, 'exact_offset'); assert.equal(offset.official_deadline_at, '2026-10-23T12:00:00.000Z');
});

test('confirmed official rolling opportunities have eligibility but no fabricated deadline or lead time', () => {
  const rolling = adaptiveDiscoveryLeadTime(null, deadline({ deadline: null, precision: 'unknown', rolling_confirmed: true }));
  assert.equal(rolling.precision, 'rolling'); assert.equal(rolling.recommendation_eligible, true);
  assert.equal(rolling.official_deadline_at, null); assert.equal(rolling.lead_time_hours, null);
  const uncertain = adaptiveDiscoveryLeadTime(now, deadline({ deadline: null, precision: 'unknown', rolling_confirmed: true, official_verified: false }), now);
  assert.equal(uncertain.precision, 'unknown'); assert.equal(uncertain.recommendation_eligible, null);
});

test('current quality metrics count applications and confirmed submissions as high-interest decisions', () => {
  const result = calculateAdaptiveSearchQuality(input({ discoveries: [1, 2, 3].map(index => discovery(index)), feedback: [
    feedback(1, { metric_version: 'opportunity-interest-v2', review_state: 'not_interested', interest_origin: 'application', interest_score: 9 }),
    feedback(2, { metric_version: 'opportunity-interest-v2', review_state: 'not_interested', interest_origin: 'confirmed_submission', interest_score: 9.5, confirmed_submission: true }),
    feedback(3, { metric_version: 'opportunity-interest-v2', review_state: 'very_high_interest', interest_origin: 'categorical_review', interest_score: 9 }),
  ] }));
  assert.equal(result.overall.reviewed, 3);
  assert.equal(result.overall.explicit_high_interest, 3);
  assert.equal(result.overall.mean_interest, 9.166667);
  assert.equal(result.overall.application, 1);
  assert.equal(result.overall.confirmed_submissions, 1);
  assert.equal(result.overall.high_interest_rate, 1);
});
