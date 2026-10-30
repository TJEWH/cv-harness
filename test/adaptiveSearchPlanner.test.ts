import assert from 'node:assert/strict';
import test from 'node:test';
import type { SearchCriteria } from '../src/features/meta-search/searchTypes';
import { compileAdaptiveFeedbackSnapshot, type AdaptiveFeedbackExample, type AdaptiveFeedbackSnapshot } from '../src/features/meta-search/domain/adaptiveFeedbackSnapshots';
import { createAdaptiveSearchPlan, type AdaptiveSearchPlanBasis, type AdaptiveSearchQueryInput } from '../src/features/meta-search/domain/adaptiveSearchPlans';
import { opportunityFeedbackTextHash } from '../src/features/opportunities/domain/opportunityFeedbackPrivacy';
import {
  ADAPTIVE_SEARCH_POLICY_VERSION, ADAPTIVE_SEED_GENERATOR_VERSION, DEFAULT_ADAPTIVE_SEARCH_POLICY,
  createSearchBreadthPolicy, createLegacySearchBreadthPolicy, validateAdaptiveSearchPolicy, LEGACY_ADAPTIVE_SEARCH_POLICY,
  buildAdaptiveSearchPlanningContext, createColdStartAdaptiveSearchPlan, recordGeneratedAdaptiveSearchPlan,
  validateApprovedAdaptiveRules, validatePendingAdaptiveRuleSuggestion, type AdaptiveSearchPlannerInput, type ApprovedAdaptiveRule,
} from '../src/features/meta-search/domain/adaptiveSearchPlanner';

const id = (index: number) => `78000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const owner = id(900), search = id(901);
const basis = (patch: Partial<AdaptiveSearchPlanBasis> = {}): AdaptiveSearchPlanBasis => ({ base_revision: 2, feedback_revision: 1,
  preference_revision: 0, protocol_version: 'opportunity-search-v1-canonical-6', ...patch });
const criteria = (patch: Partial<SearchCriteria> = {}): SearchCriteria => ({
  opportunityTypes: 'Funded PhD positions', topicsAndMethods: 'Acoustics; Robotics; BCI; avoid routine administration',
  locationsAndLanguages: 'Prioritize Scandinavia; English or German', fundingAndConditions: 'Funded; beginning around 2027',
  fitAndExclusions: 'Do not require every direction; preserve hard funding requirements', sourcesAndQueries: 'Official sources preferred',
  researchAndReporting: 'Official evidence; preserve deadline safeguards', ...patch,
});
function input(patch: Partial<AdaptiveSearchPlannerInput> = {}): AdaptiveSearchPlannerInput {
  return { user_id: owner, search_id: search, base_criteria: criteria(), basis: basis(), feedback: null, approved_rules: [],
    core_queries: [], due_sources: [], adaptation_enabled: true, adaptation_paused: false, ...patch };
}
const query = (index: number, patch: Partial<AdaptiveSearchQueryInput> = {}): AdaptiveSearchQueryInput => ({ query_id: id(index),
  query: `Funded synthetic research ${index}`, role: 'core', manual: index === 1, ...patch });
async function cores(count: number) { return (await createAdaptiveSearchPlan(basis(), Array.from({ length: count }, (_, index) => query(index + 1)))).queries; }
function example(index: number, patch: Partial<AdaptiveFeedbackExample> = {}): AdaptiveFeedbackExample {
  return { opportunity_id: id(index), opportunity_key: `synthetic-${index}`, title: 'Synthetic opportunity', institution: 'Synthetic Institute',
    topics: ['Robotics'], metric_version: 'opportunity-interest-v1', interest_score: 2, interest_origin: 'explicit_rating',
    interest_gap: null, baseline_status: 'unavailable', feedback_revision: 1, feedback_updated_at: '2026-10-29T12:00:00Z',
    review_state: 'unreviewed', confirmed_submission: false, submission_at: null, reasons: [], ...patch };
}
async function feedback(examples: AdaptiveFeedbackExample[]): Promise<AdaptiveFeedbackSnapshot> {
  return compileAdaptiveFeedbackSnapshot({ user_id: owner, search_id: search,
    feedback_revision: 1, preference_revision: 0, examples, approved_preferences: [] });
}
const emphasis = (index: number, target = 'Robotics', polarity: 'positive' | 'negative' = 'positive'): ApprovedAdaptiveRule => ({ rule_id: id(500 + index),
  kind: 'emphasis', category: 'topic', polarity, target, evidence_refs: [] });

test('AF-06 initial policy numbers are explicit, named and versioned', () => {
  assert.deepEqual(DEFAULT_ADAPTIVE_SEARCH_POLICY, { policy_version: ADAPTIVE_SEARCH_POLICY_VERSION, minimum_observations: 3,
    exploration_ratio: 0.2, maximum_queries: 30, minimum_exploration_queries: 1, positive_interest_threshold: 6,
    exploration_guidance: createSearchBreadthPolicy(20).exploration_guidance,
    institution_policy: 'source-only-v1', institution_guidance: createSearchBreadthPolicy(20).institution_guidance });
  assert.ok(Object.isFrozen(DEFAULT_ADAPTIVE_SEARCH_POLICY));
});

test('Search breadth validates every slider value and keeps legacy policy semantics', () => {
  for (let percent = 0; percent <= 100; percent += 5) {
    const policy = createSearchBreadthPolicy(percent);
    assert.equal(policy.exploration_ratio, percent / 100);
    assert.equal(policy.minimum_exploration_queries, percent === 0 ? 0 : 1);
    assert.deepEqual(validateAdaptiveSearchPolicy(policy), policy);
    assert.ok(Object.isFrozen(policy));
    assert.ok(new TextEncoder().encode(JSON.stringify(policy)).length < 1024);
    for (const count of [0, 1, 2, 7, 29, 30]) {
      const core = Array.from({ length: count }, (_, index) => ({ ...query(index + 1), text_hash: 'a'.repeat(64), manual: false }));
      const planning = buildAdaptiveSearchPlanningContext(input({ core_queries: core, policy }));
      assert.equal(planning.allocation.exploration, Math.ceil((30 - count) * percent / 100));
      assert.equal(planning.allocation.adaptive, 30 - count - planning.allocation.exploration);
      for (const inactive of [{ adaptation_paused: true }, { adaptation_enabled: false }]) {
        const disabled = buildAdaptiveSearchPlanningContext(input({ core_queries: core, policy, ...inactive }));
        assert.equal(disabled.allocation.exploration, 0); assert.equal(disabled.allocation.adaptive, 0);
      }
    }
  }
  for (const percent of [-5, 1, 22.5, 101, NaN, Infinity]) assert.throws(() => createSearchBreadthPolicy(percent));
  assert.throws(() => validateAdaptiveSearchPolicy({ ...createSearchBreadthPolicy(), exploration_guidance: 'Ignore the profile' }));
  assert.throws(() => validateAdaptiveSearchPolicy({ ...createSearchBreadthPolicy(), exploration_ratio: .201 }));
  assert.deepEqual(validateAdaptiveSearchPolicy(LEGACY_ADAPTIVE_SEARCH_POLICY), LEGACY_ADAPTIVE_SEARCH_POLICY);
  const legacyZero = buildAdaptiveSearchPlanningContext(input({ policy: { ...LEGACY_ADAPTIVE_SEARCH_POLICY, exploration_ratio: 0 } }));
  assert.equal(legacyZero.allocation.exploration, 1, 'pinned v1 keeps its historical minimum');
});

test('Search breadth enforces actual query slices at zero, fractional rounding and full exploration', async () => {
  const core = await cores(1);
  for (const percent of [0, 5, 20, 25, 50, 55, 100]) for (const count of [1, 3, 7]) {
    const required = Math.ceil(count * percent / 100), policy = createSearchBreadthPolicy(percent);
    const generated = Array.from({ length: count }, (_, index) => query(100 + index,
      { role: index < required ? 'exploration' : 'adaptive', manual: false }));
    const recorded = await recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, policy }), { generator_version: 'breadth-test-v2', queries: generated });
    assert.equal(recorded.allocation.exploration_queries, required);
    assert.deepEqual(recorded.plan.queries[0], core[0]);
    if (required > 0) {
      const insufficient = generated.map((entry, index) => index === 0 ? { ...entry, role: 'adaptive' as const } : entry);
      await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, policy }), { generator_version: 'breadth-test-v2', queries: insufficient }), /exploration policy/u);
    } else {
      await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, policy }), { generator_version: 'breadth-test-v2', queries: [{ ...generated[0]!, role: 'exploration' }] }), /exploration policy/u);
    }
  }
  assert.match(createSearchBreadthPolicy(20).exploration_guidance!, /underrepresented named interests/u);
  assert.match(createSearchBreadthPolicy(50).exploration_guidance!, /adjacent research directions/u);
  assert.match(createSearchBreadthPolicy(100).exploration_guidance!, /at least one shared research interest or method/u);
});

test('AF-06 cold start creates bounded base-only seeds with stable slot IDs and exact versioned hashes', async () => {
  const base = criteria(), before = JSON.stringify(base);
  const seeded = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, base_criteria: base, basis: basis(),
    approved_rules: [emphasis(1, 'Unrelated new approved interest')], maximum_queries: 2 });
  assert.equal(seeded.generator_version, ADAPTIVE_SEED_GENERATOR_VERSION);
  assert.deepEqual(seeded.plan.queries.map(item => item.query), ['Funded PhD positions Acoustics', 'Funded PhD positions Robotics']);
  assert.equal(seeded.omitted_directions, 1);
  assert.ok(seeded.plan.queries.every(item => item.role === 'core' && !item.manual));
  assert.equal(seeded.plan.queries[0]!.text_hash, await opportunityFeedbackTextHash(seeded.plan.queries[0]!.query));
  assert.equal(JSON.stringify(base), before);
  assert.doesNotMatch(JSON.stringify(seeded), /Unrelated|administration|executed_at|discovered_at/u);
  const changed = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search,
    base_criteria: criteria({ topicsAndMethods: 'Physical sensing' }), basis: basis({ base_revision: 3 }) });
  assert.equal(seeded.plan.queries[0]!.query_id, changed.plan.queries[0]!.query_id);
  assert.notEqual(seeded.plan.queries[0]!.text_hash, changed.plan.queries[0]!.text_hash);
});

test('AF-06 cold seeds preserve alternative directions and explicit hard exclusion without inventing profile claims', async () => {
  const result = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, basis: basis(), base_criteria: criteria(),
    approved_rules: [{ rule_id: id(500), kind: 'hard_exclusion', category: 'topic', target: 'Robotics', evidence_refs: [] }] });
  assert.deepEqual(result.plan.queries.map(item => item.query), ['Funded PhD positions Acoustics', 'Funded PhD positions BCI']);
  const empty = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, basis: basis(),
    base_criteria: criteria({ opportunityTypes: '', topicsAndMethods: '' }) });
  assert.equal(empty.plan.queries[0]!.query, 'research opportunities');
  assert.doesNotMatch(empty.plan.queries[0]!.query, /funded|PhD|Scandinavia/u);
  const partial = { topicsAndMethods: 'Acoustics; BCI' }, before = JSON.stringify(partial);
  const legacy = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, basis: basis(), base_criteria: partial });
  assert.deepEqual(legacy.plan.queries.map(item => item.query), ['research opportunities Acoustics', 'research opportunities BCI']);
  assert.equal(JSON.stringify(partial), before, 'absent legacy keys are normalized only in memory');
  const alternativeTypes = await createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, basis: basis(),
    base_criteria: criteria({ opportunityTypes: 'PhD positions; Applied research jobs', topicsAndMethods: 'Acoustics; BCI' }) });
  assert.deepEqual(alternativeTypes.plan.queries.map(item => item.query), ['PhD positions Acoustics', 'PhD positions BCI', 'Applied research jobs Acoustics', 'Applied research jobs BCI']);
});

test('AF-06 seed generation captures base bytes and independent revision axes before asynchronous hashing', async () => {
  const base = criteria(), revisions = basis();
  const pending = createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, basis: revisions, base_criteria: base });
  base.topicsAndMethods = 'Later replacement'; revisions.feedback_revision = 99;
  const result = await pending;
  assert.equal(result.plan.basis.feedback_revision, 1);
  assert.equal(result.plan.queries[0]!.query, 'Funded PhD positions Acoustics');
});

test('AF-06 timing, location and funding negatives do not penalize their research topic', async () => {
  const packet = await feedback(['timing', 'location', 'funding'].map((category, index) => example(index + 1,
    { reasons: [{ category: category as 'timing' | 'location' | 'funding', polarity: 'negative' }] })));
  const result = buildAdaptiveSearchPlanningContext(input({ feedback: packet }));
  const robotics = result.priorities.find(item => item.category === 'topic' && item.target === 'robotics')!;
  assert.equal(robotics.observations, 3); assert.equal(robotics.direction, 'unchanged');
  assert.equal(robotics.reason, 'negative_requires_reason'); assert.equal(robotics.provisional, true);
  assert.ok(!result.priorities.some(item => item.category === 'institution' && item.direction === 'decrease'));
});

test('AF-06 broad low-topic observations cannot turn one matching negative reason into three relevant observations', async () => {
  const packet = await feedback([example(1, { reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] }),
    example(2, { reasons: [{ category: 'timing', polarity: 'negative' }] }), example(3, { reasons: [{ category: 'location', polarity: 'negative' }] })]);
  const robotics = buildAdaptiveSearchPlanningContext(input({ feedback: packet })).priorities.find(item => item.target === 'robotics')!;
  assert.equal(robotics.observations, 1); assert.equal(robotics.direction, 'examples_only'); assert.equal(robotics.reason, 'sparse');
});

test('AF-06 supported targeted negative and positive cohorts alter only their own relative emphasis', async () => {
  const samples = Array.from({ length: 3 }, (_, index) => example(index + 1, { reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] }));
  samples.push(...Array.from({ length: 3 }, (_, index) => example(index + 10, { interest_score: 8, topics: ['Acoustics'] })));
  const result = buildAdaptiveSearchPlanningContext(input({ feedback: await feedback(samples) }));
  assert.equal(result.priorities.find(item => item.target === 'robotics')?.direction, 'decrease');
  assert.equal(result.priorities.find(item => item.target === 'acoustics')?.direction, 'increase');
  assert.equal(result.priorities.find(item => item.target === 'robotics')?.provisional, false);
});

test('institution cohorts are source-only for strong, weak and sparse outcomes without a university fit bonus', async () => {
  for (const scores of [[9, 9, 9], [1, 1, 1], [9]]) {
    const packet = await feedback(scores.map((interest_score, index) => example(index + 1, {
      institution: 'Synthetic retained university', interest_score,
    })));
    const before = JSON.stringify(packet);
    const institution = buildAdaptiveSearchPlanningContext(input({ feedback: packet })).priorities.find(item => item.category === 'institution')!;
    assert.equal(institution.direction, 'examples_only');
    assert.equal(institution.reason, 'source_only');
    assert.equal(institution.provisional, true);
    assert.equal(institution.observations, scores.length);
    assert.equal(institution.mean_interest, scores.reduce((sum, value) => sum + value, 0) / scores.length);
    assert.equal(JSON.stringify(packet), before, 'source-only planning cannot rewrite project evidence');
  }
});

test('historical v1/v2 institution priorities retain their pinned semantics while v3 refreshes the slice', async () => {
  const packet = await feedback(Array.from({ length: 3 }, (_, index) => example(index + 1, { institution: 'Synthetic University', interest_score: 9 })));
  const original = await createAdaptiveSearchPlan(basis(), await cores(1));
  for (const previousPolicy of [LEGACY_ADAPTIVE_SEARCH_POLICY, createLegacySearchBreadthPolicy(20)]) {
    const historical = buildAdaptiveSearchPlanningContext(input({ feedback: packet, policy: previousPolicy }));
    const institution = historical.priorities.find(item => item.category === 'institution')!;
    assert.equal(institution.direction, 'increase'); assert.equal(institution.reason, 'supported_mean');
    const current = buildAdaptiveSearchPlanningContext(input({ feedback: packet, previous_plan: original, previous_policy: previousPolicy }));
    assert.equal(current.refresh_required, true, 'old institution-weighted queries must not remain current after the policy upgrade');
    assert.equal(current.priorities.find(item => item.category === 'institution')?.direction, 'examples_only');
  }
  assert.match(DEFAULT_ADAPTIVE_SEARCH_POLICY.institution_guidance!, /Screen each project independently/u);
  assert.match(DEFAULT_ADAPTIVE_SEARCH_POLICY.institution_guidance!, /Do not add an institution-wide fit bonus/u);
  assert.throws(() => validateAdaptiveSearchPolicy({ ...DEFAULT_ADAPTIVE_SEARCH_POLICY, institution_guidance: 'Give every university project a fit bonus' }));
});

test('contrasting projects within one institution retain project-specific priorities while the institution stays neutral', async () => {
  const samples = [
    ...Array.from({ length: 3 }, (_, index) => example(index + 1, { institution: 'Synthetic University', interest_score: 9,
      topics: ['Acoustics'], reasons: [{ category: 'topic', polarity: 'positive', target: 'Acoustics' }] })),
    ...Array.from({ length: 3 }, (_, index) => example(index + 10, { institution: 'Synthetic University', interest_score: 1,
      topics: ['Simulation'], reasons: [{ category: 'topic', polarity: 'negative', target: 'Simulation' }] })),
  ];
  const result = buildAdaptiveSearchPlanningContext(input({ feedback: await feedback(samples) }));
  const institution = result.priorities.find(item => item.category === 'institution')!;
  assert.equal(institution.target, 'synthetic university');
  assert.equal(institution.observations, 6); assert.equal(institution.mean_interest, 5);
  assert.equal(institution.direction, 'examples_only'); assert.equal(institution.reason, 'source_only');
  assert.equal(result.priorities.find(item => item.category === 'topic' && item.target === 'acoustics')?.direction, 'increase');
  assert.equal(result.priorities.find(item => item.category === 'topic' && item.target === 'simulation')?.direction, 'decrease');
});

test('AF-06 hardware-specific high-fit/low-interest evidence changes hardware emphasis, not unrelated topics', async () => {
  const samples = Array.from({ length: 3 }, (_, index) => example(index + 1, { interest_gap: -7, baseline_status: 'available',
    original_prediction: { user_id: owner, opportunity_id: id(index + 1), score: 9, scale_min: 0, scale_max: 10,
      predicted_at: '2026-10-28T12:00:00Z', source_kind: 'historical_snapshot', source_ref: `opportunity-search-receipt:${id(999)}:${id(index + 1)}` },
    reasons: [{ category: 'hardware', polarity: 'negative' }] }));
  const result = buildAdaptiveSearchPlanningContext(input({ feedback: await feedback(samples) }));
  assert.equal(result.priorities.find(item => item.category === 'hardware')?.direction, 'decrease');
  assert.equal(result.priorities.find(item => item.category === 'topic')?.direction, 'unchanged');
});

test('AF-06 sparse scored cohorts and conflicting signs stay provisional with cohort-consistent means', async () => {
  const sparse = await feedback([example(1), example(2, { interest_score: null, interest_origin: 'none', reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] }),
    example(3, { interest_score: null, interest_origin: 'none', reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] })]);
  assert.equal(buildAdaptiveSearchPlanningContext(input({ feedback: sparse })).priorities.find(item => item.target === 'robotics')?.direction, 'examples_only');
  const conflicting = await feedback([example(1, { interest_score: 9, reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] }),
    example(2, { interest_score: 8, reasons: [{ category: 'topic', polarity: 'positive', target: 'Robotics' }] })]);
  const result = buildAdaptiveSearchPlanningContext(input({ feedback: conflicting })).priorities.find(item => item.target === 'robotics')!;
  assert.equal(result.direction, 'unchanged'); assert.equal(result.reason, 'contradictory'); assert.equal(result.provisional, true);
});

test('AF-06 an untargeted topic or method reason never invents a positive, negative or contradictory target', async () => {
  for (const category of ['topic', 'method'] as const) {
    const packet = await feedback(Array.from({ length: 6 }, (_, index) => example(index + 1, { interest_score: 8,
      reasons: [{ category, polarity: index < 3 ? 'positive' : 'negative' }] })));
    const result = buildAdaptiveSearchPlanningContext(input({ feedback: packet })).priorities.find(item => item.category === category && item.target === category)!;
    assert.equal(result.direction, 'examples_only'); assert.equal(result.provisional, true);
    assert.equal(result.reason, 'untargeted_reason'); assert.equal(result.observations, 3); assert.equal(result.mean_interest, 8);
  }
});

test('AF-06 explicit owner emphasis wins; explicit hard exclusions suppress contradictory positive emphasis', async () => {
  const packet = await feedback(Array.from({ length: 3 }, (_, index) => example(index + 1,
    { reasons: [{ category: 'topic', polarity: 'negative', target: 'Robotics' }] })));
  const approved = buildAdaptiveSearchPlanningContext(input({ feedback: packet, approved_rules: [emphasis(1)] }));
  assert.equal(approved.priorities.find(item => item.target === 'Robotics')?.direction, 'increase');
  const hard: ApprovedAdaptiveRule = { rule_id: id(700), kind: 'hard_exclusion', category: 'topic', target: ' robotics ', evidence_refs: [] };
  const filtered = buildAdaptiveSearchPlanningContext(input({ feedback: packet, approved_rules: [emphasis(1), hard] }));
  assert.ok(!filtered.priorities.some(item => item.category === 'topic'));
  assert.deepEqual(filtered.approved_preferences, []); assert.equal(filtered.approved_rules.length, 2);
  assert.throws(() => validateApprovedAdaptiveRules([emphasis(1), emphasis(2, ' robotics ', 'negative')]), /conflicting approved emphasis/u);
});

test('AF-06 stopped adaptation emits no priorities or discretionary slice while preserving approved hard/source rules', async () => {
  const packet = await feedback(Array.from({ length: 3 }, (_, index) => example(index + 1, { interest_score: 8 })));
  for (const setting of [{ adaptation_enabled: false }, { adaptation_paused: true }]) {
    const result = buildAdaptiveSearchPlanningContext(input({ ...setting, feedback: packet, approved_rules: [emphasis(1)],
      core_queries: await cores(1), due_sources: [{ registry_id: id(800), mandatory: true, pinned: true }] }));
    assert.equal(result.enabled, false); assert.deepEqual(result.priorities, []);
    assert.equal(result.allocation.adaptive, 0); assert.equal(result.allocation.exploration, 0);
    assert.equal(result.approved_rules.length, 1); assert.equal(result.allocation.source_obligations, 1);
  }
});

test('AF-06 source checks are independent obligations; core/manual queries survive approved source exclusions verbatim', async () => {
  const core = (await createAdaptiveSearchPlan(basis(), [query(1, { source_registry_id: id(800), sources: ['https://example.invalid/Jobs?topic=BCI'] }), query(2)])).queries;
  const before = JSON.stringify(core), sourceRule: ApprovedAdaptiveRule = { rule_id: id(700), kind: 'source_exclusion', source_registry_id: id(800), evidence_refs: [] };
  const result = buildAdaptiveSearchPlanningContext(input({ core_queries: core, approved_rules: [sourceRule], due_sources: [
    { registry_id: id(800), mandatory: true, pinned: true }, { registry_id: id(801), mandatory: false, pinned: true },
    { registry_id: id(802), mandatory: true, pinned: false }, { registry_id: id(803), mandatory: false, pinned: false },
  ] }));
  assert.deepEqual(result.blocked_core_queries, [{ query_id: id(1), rule_id: id(700) }]);
  assert.equal(JSON.stringify(core), before); assert.equal(result.allocation.core_queries, 2);
  assert.equal(result.allocation.source_obligations, 3); assert.equal(result.allocation.mandatory_source_checks, 2);
  assert.equal(result.allocation.discretionary, 28); assert.equal(result.allocation.exploration, 6); assert.equal(result.allocation.adaptive, 22);
});

test('AF-06 one discretionary slot is exploration; full core capacity is reported without dropping a mandatory source', async () => {
  const one = buildAdaptiveSearchPlanningContext(input({ core_queries: await cores(29) }));
  assert.equal(one.allocation.exploration, 1); assert.equal(one.allocation.adaptive, 0);
  const full = buildAdaptiveSearchPlanningContext(input({ core_queries: await cores(30), due_sources: [{ registry_id: id(800), mandatory: true, pinned: true }] }));
  assert.equal(full.allocation.discretionary, 0); assert.equal(full.allocation.capacity_limited, true);
  assert.equal(full.allocation.source_obligations, 1); assert.equal(full.allocation.core_queries, 30);
});

test('AF-06 deterministic priorities use the whole set, stable ties and input-order-independent grouping', async () => {
  const samples = Array.from({ length: 40 }, (_, index) => example(index + 1, { interest_score: 8,
    topics: [index % 2 ? 'BCI' : 'Acoustics'], institution: 'Same institute' }));
  const first = buildAdaptiveSearchPlanningContext(input({ feedback: await feedback(samples) }));
  const reversed = buildAdaptiveSearchPlanningContext(input({ feedback: await feedback(samples.toReversed()) }));
  assert.deepEqual(first.priorities, reversed.priorities);
  const topics = first.priorities.filter(item => item.category === 'topic');
  assert.deepEqual(topics.map(item => item.target), ['acoustics', 'bci']);
  assert.ok(topics.every(item => item.observations === 20), 'sampled packet examples do not become the denominator');
});

test('AF-06 new feedback/preference refreshes only planning axes and leaves base, shared letter interests and application bytes unchanged', async () => {
  const base = criteria(), documents = { researchInterests: base.topicsAndMethods, application: { body: 'Frozen motivation letter\nwith exact bytes.' } };
  const before = JSON.stringify({ base, documents }), original = await createAdaptiveSearchPlan(basis(), [query(1)]);
  const current = buildAdaptiveSearchPlanningContext(input({ base_criteria: base, core_queries: original.queries, previous_plan: original, previous_policy: DEFAULT_ADAPTIVE_SEARCH_POLICY }));
  assert.equal(current.refresh_required, false);
  const refreshed = buildAdaptiveSearchPlanningContext(input({ base_criteria: base, core_queries: original.queries, previous_plan: original,
    basis: basis({ feedback_revision: 2, preference_revision: 1 }) }));
  assert.equal(refreshed.refresh_required, true); assert.equal(refreshed.basis.base_revision, original.basis.base_revision);
  assert.equal(JSON.stringify({ base, documents }), before);
  assert.equal(buildAdaptiveSearchPlanningContext(input({ previous_plan: original })).refresh_required, true, 'missing historical policy is unknown rather than silently current');
  assert.equal(buildAdaptiveSearchPlanningContext(input({ previous_plan: original, previous_policy: DEFAULT_ADAPTIVE_SEARCH_POLICY,
    policy: createSearchBreadthPolicy(30) })).refresh_required, true, 'configuration changes refresh the adaptive slice independently of base bytes');
});

test('AF-06 generated prose is versioned, hashed and records actual allocation while preserving all core fields', async () => {
  const core = await cores(2), base = criteria(), before = JSON.stringify({ core, base });
  const recorded = await recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, base_criteria: base }), { generator_version: 'synthetic-runner-v1',
    queries: [query(100, { query: 'Physical sensing research', role: 'adaptive', manual: false }), query(101, { query: 'BCI interdisciplinary research', role: 'exploration', manual: false })] });
  assert.deepEqual(recorded.plan.queries.slice(0, 2), core); assert.equal(recorded.generator_version, 'synthetic-runner-v1');
  assert.deepEqual(recorded.planning_policy, DEFAULT_ADAPTIVE_SEARCH_POLICY);
  assert.deepEqual(recorded.allocation, { core_queries: 2, adaptive_queries: 1, exploration_queries: 1, source_obligations: 0 });
  assert.equal(recorded.plan.queries[2]!.text_hash, await opportunityFeedbackTextHash('Physical sensing research'));
  assert.equal(JSON.stringify({ core, base }), before);
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: core }), { generator_version: 'runner-v1',
    queries: [query(100, { role: 'adaptive', manual: false })] }), /exploration policy/u);
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, adaptation_paused: true }), { generator_version: 'runner-v1',
    queries: [query(100, { role: 'exploration', manual: false })] }), /exploration policy/u);
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: core }), { generator_version: 'runner-v1', queries: [] }), /exploration policy/u);
  const paused = await recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, adaptation_paused: true }), { generator_version: 'runner-v1', queries: [] });
  assert.deepEqual(paused.plan.queries, core);
});

test('AF-06 generated plan publication checks the actual previous plan, preserving omitted and changed protected core/manual rows', async () => {
  const previous = await createAdaptiveSearchPlan(basis(), [query(1), query(2), query(3, { role: 'adaptive' })]);
  const generated = { generator_version: 'runner-v1', queries: [query(100, { role: 'exploration', manual: false })] };
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ previous_plan: previous, core_queries: [previous.queries[0]!],
    basis: basis({ feedback_revision: 2 }) }), generated), /preserve protected core/u);
  const changed = await cores(1);
  const replacement = (await createAdaptiveSearchPlan(basis(), [query(1, { query: 'Changed owner manual core' })])).queries;
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ previous_plan: previous, core_queries: replacement,
    basis: basis({ base_revision: 3 }) }), generated), /preserve protected core/u);
  assert.deepEqual(changed[0], previous.queries[0]);
  const preserved = await recordGeneratedAdaptiveSearchPlan(input({ previous_plan: previous, core_queries: previous.queries.filter(item => item.role === 'core'),
    basis: basis({ feedback_revision: 2 }) }), generated);
  assert.deepEqual(preserved.plan.queries.slice(0, 2), previous.queries.slice(0, 2));
});

test('AF-06 recorded generated plans capture immutable text/source/basis before asynchronous hashing and reject excluded source execution', async () => {
  const core = (await cores(1)).map(item => ({ ...item })), current = basis(), sources = ['https://example.invalid/Jobs?topic=BCI'];
  const generated = [query(100, { query: 'Exact generated text', role: 'exploration', manual: false, sources })];
  const pending = recordGeneratedAdaptiveSearchPlan(input({ core_queries: core, basis: current }), { generator_version: 'runner-v1', queries: generated });
  core[0]!.query = 'Changed during hash'; generated[0]!.query = 'Changed generated text'; sources.push('https://elsewhere.invalid/Jobs'); current.feedback_revision = 99;
  const result = await pending;
  assert.equal(result.plan.queries[0]!.query, 'Funded synthetic research 1'); assert.equal(result.plan.queries[1]!.query, 'Exact generated text');
  assert.deepEqual(result.plan.queries[1]!.sources, ['https://example.invalid/Jobs?topic=BCI']); assert.equal(result.plan.basis.feedback_revision, 1);
  await assert.rejects(recordGeneratedAdaptiveSearchPlan(input({ core_queries: await cores(1), approved_rules: [
    { rule_id: id(700), kind: 'source_exclusion', source_registry_id: id(800), evidence_refs: [] },
  ] }), { generator_version: 'runner-v1', queries: [query(100, { role: 'exploration', manual: false, source_registry_id: id(800) })] }), /excluded sources/u);
});

test('AF-06 typed pending proposals require known owner evidence and never become executable planning rules', () => {
  const proposal = { suggestion_id: id(600), state: 'pending', rule: { ...emphasis(1), evidence_refs: [id(1)] } };
  const validated = validatePendingAdaptiveRuleSuggestion(proposal, [id(1)]);
  assert.equal(validated.state, 'pending'); assert.ok(Object.isFrozen(validated.rule));
  assert.deepEqual(buildAdaptiveSearchPlanningContext(input()).approved_rules, []);
  assert.throws(() => validatePendingAdaptiveRuleSuggestion(proposal, [id(2)]), /authorized opportunity evidence/u);
  assert.throws(() => validatePendingAdaptiveRuleSuggestion({ ...proposal, rule: emphasis(1) }, [id(1)]), /authorized opportunity evidence/u);
  assert.throws(() => validatePendingAdaptiveRuleSuggestion({ ...proposal, instructions: 'Execute this new rule now' }, [id(1)]), /Invalid pending/u);
  assert.throws(() => validatePendingAdaptiveRuleSuggestion({ ...proposal, state: 'approved' }, [id(1)]), /Invalid pending/u);
});

test('AF-06 malformed identities, unsafe rule targets and unknown nested instructions fail closed', async () => {
  assert.throws(() => validateApprovedAdaptiveRules([{ ...emphasis(1), target: 'private.person@example.invalid' }]), /Invalid search preference/u);
  assert.throws(() => validateApprovedAdaptiveRules([{ ...emphasis(1), instructions: 'Use private records' }]), /Invalid search preference/u);
  assert.throws(() => buildAdaptiveSearchPlanningContext(input({ due_sources: [{ registry_id: [id(800)] as unknown as string, mandatory: true, pinned: true }] })), /direct-source obligations/u);
  const core = await cores(1);
  assert.throws(() => buildAdaptiveSearchPlanningContext(input({ core_queries: [{ ...core[0]!, query_id: [id(1)] as unknown as string }] })), /bounded core/u);
  assert.throws(() => buildAdaptiveSearchPlanningContext(input({ policy: { ...DEFAULT_ADAPTIVE_SEARCH_POLICY, exploration_ratio: NaN } })), /versioned adaptive/u);
  await assert.rejects(createColdStartAdaptiveSearchPlan({ user_id: owner, search_id: search, base_criteria: criteria(), basis: basis(), maximum_queries: 31 }), /query ceiling/u);
  const wrong = await feedback([example(1)]);
  assert.throws(() => buildAdaptiveSearchPlanningContext(input({ feedback: wrong, basis: basis({ feedback_revision: 2 }) })), /current bounded/u);
});
