import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { file, reset, sql } from '../../support/database/postgres';

before(() => reset());
import { adaptiveDiscoveryLeadTime, type AdaptiveDeadlineEvidence } from '../../../src/features/meta-search/domain/adaptiveSearchQuality';
import { opportunityFeedbackTimestamp } from '../../../src/features/opportunities/domain/opportunityFeedback';

test('AF-05 records real execution, preserves immutable attribution and exposes owner-scoped metrics', () => {
  sql(file('supabase/tests/opportunity_search_attribution.sql'));
});

test('AF-05 future assessments are genuine, frozen, timely baselines without retroactive preference changes', () => {
  sql(file('supabase/tests/opportunity_search_prediction_baselines.sql'));
});

test('AF-05 current quality metrics deduplicate outcomes, preserve uncertainty and enforce owner isolation', () => {
  sql(file('supabase/tests/opportunity_search_quality_metrics.sql'));
});

test('AF-05 SQL and browser deadline evidence agree at timezone, DST and microsecond boundaries', () => {
  const first = '2026-10-20T12:00:00Z';
  const cases: { evidence: AdaptiveDeadlineEvidence; first?: string | null; checked?: string }[] = [
    { evidence: { deadline: '2026-10-23T12:00:00Z', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-10-23T11:59:59.999999Z', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-10-23', deadline_time_local: '14:00', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-10-23', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'date' } },
    { evidence: { deadline: '2026-03-29', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'date' } },
    { evidence: { deadline: '2026-10-25', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'date' } },
    { evidence: { deadline: '2026-10-25', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-03-29', deadline_time_local: '02:30', deadline_timezone: 'Europe/Berlin', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-10-23', deadline_time_local: '14:00', official_verified: true, precision: 'instant' } },
    { evidence: { deadline: '2026-10-23', deadline_timezone: 'Invalid/Zone', official_verified: true, precision: 'date' } },
    { evidence: { deadline: null, rolling_confirmed: true, official_verified: true, precision: 'unknown' } },
    { evidence: { deadline: '2026-10-23T12:00:00Z', official_verified: true, precision: 'instant' }, first: null },
    { evidence: { deadline: '2026-10-23T12:00:00Z', official_verified: true, precision: 'instant' }, checked: '2026-10-20T12:00:00.000001Z' },
    { evidence: { deadline: '2026-10-23T12:00:00Z', official_verified: false, precision: 'instant' } },
  ];
  const literal = (value: string | null | undefined) => value == null ? 'null' : `'${value.replaceAll("'", "''")}'`;
  for (const fixture of cases) {
    const { evidence } = fixture, discovered = fixture.first === undefined ? first : fixture.first, checked = fixture.checked ?? first;
    const browser = adaptiveDiscoveryLeadTime(discovered, evidence, checked);
    const date = evidence.deadline?.slice(0, 10), time = evidence.deadline_time_local;
    const saved = JSON.parse(sql(`select private.opportunity_search_deadline_quality(${literal(date)}::date,
      ${literal(time)}::time,${literal(evidence.deadline_timezone)},${literal(evidence.deadline)},
      ${literal(evidence.rolling_confirmed ? 'rolling' : null)},${evidence.official_verified},
      ${literal(discovered)}::timestamptz,${literal(checked)}::timestamptz);`));
    const label = JSON.stringify(fixture);
    for (const key of ['precision', 'provisional', 'recommendation_eligible', 'late_discovery', 'late_discovery_status'] as const) {
      assert.equal(saved[key], browser[key], `${key}: ${label}`);
    }
    assert.equal(opportunityFeedbackTimestamp(saved.official_deadline_at), opportunityFeedbackTimestamp(browser.official_deadline_at), label);
    assert.equal(opportunityFeedbackTimestamp(saved.deadline_lower_at), opportunityFeedbackTimestamp(browser.deadline_lower_bound_at), label);
    const upper = opportunityFeedbackTimestamp(browser.deadline_upper_bound_at);
    assert.equal(Boolean(saved.deadline_upper_exclusive), browser.upper_bound_exclusive, label);
    assert.equal(opportunityFeedbackTimestamp(saved.deadline_upper_at), upper, label);
    assert.equal(saved.lead_time_hours === null, browser.lead_time_hours === null, label);
    if (saved.lead_time_hours !== null) assert.ok(Math.abs(saved.lead_time_hours - browser.lead_time_hours!) < 1e-9, label);
  }
});
