import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTIVE_SOURCE_KINDS, DEFAULT_SOURCE_CHECK_INTERVAL_HOURS, DEFAULT_SUCCESSFUL_SOURCE_REUSE_POLICY,
  MAX_SOURCE_CHECK_INTERVAL_HOURS, MIN_SOURCE_CHECK_INTERVAL_HOURS, SUCCESSFUL_SOURCE_REUSE_VERSION,
  adaptiveSourceIsDue, applyAdaptiveSourceCoverage, canonicalAdaptiveListingUrl, createAdaptiveSourceCandidate,
  dueAdaptiveSearchSources, normalizeAdaptiveSearchSource, retainSuccessfulAdaptiveSource,
  prepareRetainedInstitutionSources,
  type AdaptiveSearchSource, type AdaptiveSourceScope, type VerifiedReusableSourceSignal,
} from '../src/features/meta-search/domain/adaptiveSearchSources';

const owner = '30000000-0000-4000-8000-000000000001';
const search = '30000000-0000-4000-8000-000000000002';
const registry = '30000000-0000-4000-8000-000000000003';
const other = '30000000-0000-4000-8000-000000000004';
const scope: AdaptiveSourceScope = { user_id: owner, search_id: search };
const listing = 'https://example.invalid/Jobs?topic=BCI&location=Berlin';
const now = '2026-10-29T12:00:00Z';
const policy = { adaptation_enabled: true, adaptation_paused: false,
  successful_source_reuse_enabled: true, reuse_check_interval_hours: 168 };

function source(patch: Partial<AdaptiveSearchSource> = {}): AdaptiveSearchSource {
  return { ...createAdaptiveSourceCandidate(scope, registry, { role: 'explicit_listing', url: listing,
    kind: 'university', institution: 'Example University', topics: ['BCI', 'Robotics'] }), ...patch };
}
function signal(patch: Partial<VerifiedReusableSourceSignal> = {}): VerifiedReusableSourceSignal {
  return { role: 'verified_listing', listing_url: listing, verified_at: now, interest_origin: 'explicit_rating',
    interest_score: 9, confirmed_submission: false, ...patch };
}

test('owner-selected institution listings create only neutral missing paths without rewriting existing settings', () => {
  const existing = source({ enabled: false, owner_disabled: true, pinned: true, priority: 82, check_interval_hours: 24, status: 'checked' });
  const before = JSON.stringify(existing);
  const foreign = { ...source({ listing_url: 'https://new.example.invalid/Jobs' }), user_id: other };
  const prepared = prepareRetainedInstitutionSources(scope, [
    { institution: 'Existing institution', listing_url: listing },
    { institution: 'New institution', listing_url: 'https://NEW.example.invalid/Jobs' },
    { institution: 'New institution alias', listing_url: 'https://new.example.invalid/Jobs' },
  ], [existing, foreign], () => other);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0]!.registry_id, other);
  assert.equal(prepared[0]!.user_id, owner); assert.equal(prepared[0]!.search_id, search);
  assert.equal(prepared[0]!.listing_url, 'https://new.example.invalid/Jobs');
  assert.equal(prepared[0]!.institution, 'New institution');
  assert.equal(prepared[0]!.priority, 50); assert.equal(prepared[0]!.enabled, true);
  assert.equal(prepared[0]!.pinned, false); assert.equal(prepared[0]!.mandatory, false);
  assert.equal(prepared[0]!.check_interval_hours, 168); assert.equal(prepared[0]!.provenance, 'explicit');
  assert.equal(prepared[0]!.listing_verified_at, null, 'explicit owner selection does not manufacture a verification timestamp');
  assert.equal(JSON.stringify(existing), before);
  assert.deepEqual(prepareRetainedInstitutionSources(scope, [
    { institution: 'Existing institution', listing_url: listing },
    { institution: 'New institution', listing_url: 'https://new.example.invalid/Jobs' },
  ], [existing, ...prepared], () => { throw new Error('No new identity is needed'); }), []);
});

test('institution source preparation rejects unsafe inputs, duplicate identities and execution overflow', () => {
  const valid = { institution: 'Synthetic institution', listing_url: 'https://new.example.invalid/Jobs' };
  assert.throws(() => prepareRetainedInstitutionSources(scope, [{ ...valid, listing_url: 'http://localhost/private' }], [], () => other));
  assert.throws(() => prepareRetainedInstitutionSources(scope, [{ ...valid, institution: 'private@example.invalid' }], [], () => other));
  assert.throws(() => prepareRetainedInstitutionSources(scope, [{ ...valid, actual_fit: 10 } as typeof valid], [], () => other));
  assert.throws(() => prepareRetainedInstitutionSources(scope, [valid], [source()], () => registry), /distinct/u);
  assert.throws(() => prepareRetainedInstitutionSources(scope, [valid, { ...valid, listing_url: 'https://another.example.invalid/Jobs' }], [], () => other), /distinct/u);
  assert.throws(() => prepareRetainedInstitutionSources(scope, Array.from({ length: 65 }, () => valid), [], () => other), /bounded/u);
  const full = Array.from({ length: 64 }, (_, index) => source({ registry_id: `30000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, '0')}`,
    listing_url: `https://existing.example.invalid/Jobs?source=${index}` }));
  assert.throws(() => prepareRetainedInstitutionSources(scope, [valid], full, () => other), /64-source/u);
});

test('source DTO matches owner/search scope and never carries people, private records or evidence source_id', () => {
  for (const kind of ADAPTIVE_SOURCE_KINDS) {
    const row = Object.assign(source({ kind }), { source_id: 'canonical-evidence-id', contacts: [{ email: 'person@example.invalid' }],
      data: { private: 'Keep private' }, notes: 'Private application notes', source_role: 'legacy profile' });
    const dto = normalizeAdaptiveSearchSource(row, scope);
    assert.equal(dto.registry_id, registry);
    assert.equal(dto.kind, kind);
    assert.equal(Object.hasOwn(dto, 'source_id'), false);
    assert.doesNotMatch(JSON.stringify(dto), /person@|contacts|Keep private|notes|legacy profile/u);
    assert.notEqual(dto.topics, row.topics);
  }
  assert.throws(() => normalizeAdaptiveSearchSource(source(), { user_id: other, search_id: search }), /scope/u);
  assert.throws(() => normalizeAdaptiveSearchSource(source(), { user_id: owner, search_id: other }), /scope/u);
});

test('public listing normalization preserves case-sensitive paths, filters, repeated query order and job identifiers', () => {
  assert.equal(canonicalAdaptiveListingUrl('HTTPS://EXAMPLE.invalid:443/Jobs?jobId=123456789&topic=BCI&topic=Audio'),
    'https://example.invalid/Jobs?jobId=123456789&topic=BCI&topic=Audio');
  assert.notEqual(canonicalAdaptiveListingUrl('https://example.invalid/Jobs/ABC'), canonicalAdaptiveListingUrl('https://example.invalid/jobs/ABC'));
  assert.notEqual(canonicalAdaptiveListingUrl('https://example.invalid/Jobs?jobId=A'), canonicalAdaptiveListingUrl('https://example.invalid/Jobs?jobId=B'));
  assert.equal(canonicalAdaptiveListingUrl('https://example.invalid/#/Jobs/ABC'), 'https://example.invalid/#/Jobs/ABC');
  for (const url of ['mailto:person@example.invalid', 'https://person:password@example.invalid/Jobs',
    'https://example.invalid/Jobs?email=person@example.invalid', 'https://example.invalid/Jobs#first+name=Synthetic',
    'https://example.invalid/Jobs?access_token=secret', 'https://127.0.0.1/Jobs']) assert.equal(canonicalAdaptiveListingUrl(url), null);
});

test('vacancy pages, verification pages and legacy candidates never become inferred reusable listings', () => {
  for (const role of ['vacancy_page', 'verification_page', 'legacy_candidate'] as const) {
    const candidate = createAdaptiveSourceCandidate(scope, registry, { role, url: 'https://example.invalid/Vacancy/ABC', institution: 'Example University' });
    assert.equal(candidate.listing_url, null);
    assert.equal(candidate.status, 'pending_identification');
    assert.equal(candidate.enabled, false);
    assert.equal(candidate.mandatory, false);
    assert.equal(candidate.provenance, 'candidate');
    assert.equal(candidate.listing_verified_at, null);
    assert.equal(adaptiveSourceIsDue(candidate, now), false);
    assert.equal(candidate.vacancy_url, role === 'verification_page' ? null : 'https://example.invalid/Vacancy/ABC');
  }
  const unknown = createAdaptiveSourceCandidate(scope, registry, { role: 'legacy_candidate', institution: 'Example University' });
  assert.equal(unknown.listing_url, null, 'an institution name does not invent a homepage or jobs path');
  assert.equal(unknown.vacancy_url, null);
});

test('an explicitly supplied listing is usable while verified candidates retain only actual verification time', () => {
  const explicit = createAdaptiveSourceCandidate(scope, registry, { role: 'explicit_listing', url: listing });
  assert.equal(explicit.enabled, true);
  assert.equal(explicit.status, 'ready');
  assert.equal(explicit.listing_verified_at, null);
  const verified = createAdaptiveSourceCandidate(scope, registry, { role: 'verified_listing', url: listing, verified_at: now });
  assert.equal(verified.enabled, false, 'a discovery does not silently enable the retention policy');
  assert.equal(verified.listing_verified_at, now);
  assert.equal(verified.last_attempted_at, null, 'listing identification does not invent complete coverage');
  assert.equal(verified.last_successful_at, null);
  assert.throws(() => createAdaptiveSourceCandidate(scope, registry, { role: 'verified_listing', url: listing }), /actual verification/u);
  assert.throws(() => createAdaptiveSourceCandidate(scope, registry, { role: 'explicit_listing', institution: 'Example University' }), /URL/u);
});

test('registry settings reject malformed numbers, booleans, labels, dates and inconsistent pending states', () => {
  for (const patch of [{ priority: -1 }, { priority: 101 }, { priority: NaN }, { priority: '50' }, { check_interval_hours: 23 },
    { check_interval_hours: 721 }, { check_interval_hours: 24.5 }, { enabled: 'true' }, { owner_disabled: true }, { registry_id: 'not-a-uuid' },
    { kind: 'vacancy' }, { status: 'deleted' }, { institution: 'person@example.invalid' }, { topics: ['phone +49 123 456789'] },
    { topics: Array(17).fill('BCI') }, { listing_url: null }, { listing_url: 'https://example.invalid/Jobs?token=secret' },
    { listing_verified_at: '2026-02-30T12:00:00Z' }, { last_attempted_at: '0000-01-01T00:00:00Z' },
    { last_successful_at: '2026-01-01' }, { last_attempted_at: '2026-10-29T24:00:00Z' }]) {
    assert.throws(() => normalizeAdaptiveSearchSource({ ...source(), ...patch }, scope));
  }
  assert.equal(MIN_SOURCE_CHECK_INTERVAL_HOURS, 24);
  assert.equal(MAX_SOURCE_CHECK_INTERVAL_HOURS, 720);
  assert.equal(DEFAULT_SOURCE_CHECK_INTERVAL_HOURS, 168);
});

test('SRC-01: all due mandatory and pinned sources are returned independently of web-search results', () => {
  const ordinary = source({ registry_id: '30000000-0000-4000-8000-000000000010', priority: 100 });
  const pinned = source({ registry_id: '30000000-0000-4000-8000-000000000011', pinned: true, priority: 1 });
  const mandatory = source({ registry_id: '30000000-0000-4000-8000-000000000012', mandatory: true, priority: 0 });
  const due = dueAdaptiveSearchSources([ordinary, pinned, mandatory], scope, now);
  assert.deepEqual(due.map(item => item.registry_id), [mandatory.registry_id, pinned.registry_id, ordinary.registry_id]);
  assert.ok(due.every(item => item.listing_url === listing));
  assert.equal(new Set(due.map(item => item.registry_id)).size, 3, 'sharing a listing URL never merges registry identities here');
});

test('due-source ordering is deterministic and ignores other owners/searches, disabled and not-yet-due sources', () => {
  const a = source({ registry_id: '30000000-0000-4000-8000-000000000010' });
  const b = source({ registry_id: '30000000-0000-4000-8000-000000000011' });
  const excluded = source({ enabled: false, owner_disabled: true });
  const recent = source({ last_attempted_at: now });
  const wrongOwner = source({ user_id: other });
  Object.defineProperty(wrongOwner, 'listing_url', { get() { throw new Error('Do not inspect another owner source'); } });
  const rows = [b, wrongOwner, source({ search_id: other }), excluded, recent, a];
  assert.deepEqual(dueAdaptiveSearchSources(rows, scope, now).map(item => item.registry_id), [a.registry_id, b.registry_id]);
  assert.deepEqual(dueAdaptiveSearchSources(rows.toReversed(), scope, now).map(item => item.registry_id), [a.registry_id, b.registry_id]);
});

test('source cadence uses actual known attempts/successes and preserves exact microsecond boundaries', () => {
  const checked = source({ check_interval_hours: 24, last_attempted_at: '2026-10-28T12:00:00.000001Z' });
  assert.equal(adaptiveSourceIsDue(checked, now), false);
  assert.equal(adaptiveSourceIsDue(checked, '2026-10-29T12:00:00.000001Z'), true);
  assert.equal(adaptiveSourceIsDue(source({ check_interval_hours: 24, last_successful_at: '2026-10-28T14:00:00+02:00' }), now), true);
  assert.equal(adaptiveSourceIsDue(source({ last_successful_at: '2026-10-28T12:00:00Z' }), now), false);
  assert.equal(adaptiveSourceIsDue(source(), now), true, 'unknown checks are due without fabricating historical times');
  assert.throws(() => adaptiveSourceIsDue(source(), '2026-10-29'));
});

test('SRC-02: zero, blocked, paginated, dynamic and failed coverage retain the source and distinguish incomplete checks', () => {
  const initial = source({ pinned: true, mandatory: true });
  const checked = applyAdaptiveSourceCoverage(initial, { registry_id: registry, attempted_at: now, outcome: 'complete' });
  assert.equal(checked.status, 'checked');
  assert.equal(checked.last_successful_at, now);
  assert.equal(checked.registry_id, registry);
  for (const outcome of ['blocked', 'paginated', 'dynamic', 'failed'] as const) {
    const next = applyAdaptiveSourceCoverage(checked, { registry_id: registry, attempted_at: '2026-10-30T12:00:00Z', outcome });
    assert.equal(next.status, outcome === 'blocked' ? 'blocked' : 'incomplete');
    assert.equal(next.enabled, true);
    assert.equal(next.mandatory, true);
    assert.equal(next.pinned, true);
    assert.equal(next.registry_id, registry);
    assert.equal(next.last_successful_at, now);
    assert.equal(next.last_attempted_at, '2026-10-30T12:00:00Z');
    assert.equal(Object.hasOwn(next, 'result_count'), false, 'an incomplete attempt never invents a successful zero');
  }
  assert.equal(initial.last_attempted_at, null);
});

test('late check replies cannot regress known coverage timestamps or reactivate a source disabled during the check', () => {
  const before = source({ enabled: false, owner_disabled: true, status: 'blocked', last_attempted_at: now });
  assert.deepEqual(applyAdaptiveSourceCoverage(before, { registry_id: registry, attempted_at: '2026-10-28T12:00:00Z', outcome: 'complete' }), before);
  const finished = applyAdaptiveSourceCoverage(before, { registry_id: registry, attempted_at: now, outcome: 'complete' });
  assert.equal(finished.owner_disabled, true);
  assert.equal(finished.enabled, false);
  assert.equal(adaptiveSourceIsDue(finished, '2026-12-01T12:00:00Z'), false);
  const knownSuccess = source({ last_attempted_at: null, last_successful_at: now });
  assert.deepEqual(applyAdaptiveSourceCoverage(knownSuccess, { registry_id: registry, attempted_at: '2026-10-28T12:00:00Z', outcome: 'complete' }), knownSuccess);
  assert.throws(() => applyAdaptiveSourceCoverage(before, { registry_id: other, attempted_at: now, outcome: 'complete' }), /scope/u);
});

test('SRC-05: reuse defaults off and a single verified high-interest listing becomes active nonmandatory after opt-in', () => {
  const candidate = createAdaptiveSourceCandidate(scope, registry, { role: 'verified_listing', url: listing, verified_at: now });
  assert.equal(DEFAULT_SUCCESSFUL_SOURCE_REUSE_POLICY.successful_source_reuse_enabled, false);
  assert.equal(retainSuccessfulAdaptiveSource(candidate, signal()).reason, 'policy_disabled');
  const retained = retainSuccessfulAdaptiveSource(candidate, signal(), policy);
  assert.equal(retained.retained, true);
  assert.equal(retained.policy_version, SUCCESSFUL_SOURCE_REUSE_VERSION);
  assert.equal(retained.source.registry_id, registry);
  assert.equal(retained.source.enabled, true);
  assert.equal(retained.source.mandatory, false);
  assert.equal(retained.source.check_interval_hours, 168);
  assert.equal(retained.source.last_successful_at, null, 'retention does not claim full coverage');
  assert.equal(retained.source.last_attempted_at, null);
  assert.equal(candidate.enabled, false, 'input records remain immutable');
});

test('retaining an institutional listing never rewards its priority or manufactures project fit', () => {
  const candidate = source({ institution: 'Synthetic retained university', priority: 50 });
  const retained = retainSuccessfulAdaptiveSource(candidate, signal({ interest_score: 10 }), policy);
  assert.equal(retained.retained, true);
  assert.equal(retained.source.priority, 50);
  assert.equal(retained.source.institution, candidate.institution);
  assert.equal(retained.source.pinned, false); assert.equal(retained.source.mandatory, false);
  assert.equal(Object.hasOwn(retained.source, 'actual_fit'), false);
  assert.equal(Object.hasOwn(retained.source, 'interest_score'), false);
  assert.equal(Object.hasOwn(retained.source, 'personal_fit'), false);
  const repeated = retainSuccessfulAdaptiveSource(retained.source, signal({ interest_score: 10 }), policy);
  assert.equal(repeated.source.priority, 50, 'repeat positive outcomes retain the path without accumulating a university bonus');
  const weak = retainSuccessfulAdaptiveSource(repeated.source, signal({ interest_score: 1 }), policy);
  assert.equal(weak.retained, false); assert.deepEqual(weak.source, repeated.source, 'a weak individual project does not delete or penalize a retained institution');
});

test('AF-06 automatic retention requires active adaptation without deleting manual coverage', () => {
  for (const [patch, reason] of [
    [{ adaptation_enabled: false }, 'adaptation_disabled'],
    [{ adaptation_paused: true }, 'adaptation_paused'],
  ] as const) {
    const before = source({ pinned: true, mandatory: true, provenance: 'explicit' });
    const result = retainSuccessfulAdaptiveSource(before, signal(), { ...policy, ...patch });
    assert.equal(result.reason, reason); assert.equal(result.retained, false);
    assert.deepEqual(result.source, before, 'pausing learning must preserve explicit source intent and coverage history');
  }
});

test('reuse needs explicit high interest or genuine submission, while exclusions and weak proxies are not useful evidence', () => {
  for (const observation of [signal({ interest_origin: 'categorical_review', interest_score: 8 }),
    signal({ interest_origin: 'confirmed_submission', interest_score: 9, confirmed_submission: true }),
    signal({ interest_origin: 'categorical_review', interest_score: 2, confirmed_submission: true })]) {
    assert.equal(retainSuccessfulAdaptiveSource(source(), observation, policy).retained, true);
  }
  for (const observation of [signal({ interest_score: 7.9 }), signal({ interest_origin: 'categorical_review', interest_score: 6 }),
    signal({ interest_origin: 'none', interest_score: null }), signal({ interest_origin: 'none', interest_score: 9 }),
    signal({ interest_origin: 'excluded', interest_score: null, confirmed_submission: true })]) {
    assert.equal(retainSuccessfulAdaptiveSource(source(), observation, policy).reason, 'not_useful');
  }
});

test('retention never identifies a listing from an unverified vacancy, rewrites a different listing, or reactivates owner-disabled sources', () => {
  const pending = createAdaptiveSourceCandidate(scope, registry, { role: 'vacancy_page', url: 'https://example.invalid/Vacancy/ABC' });
  const unverified = { ...signal(), role: 'vacancy_page' } as unknown as VerifiedReusableSourceSignal;
  assert.equal(retainSuccessfulAdaptiveSource(pending, unverified, policy).reason, 'unverified_listing');
  assert.equal(pending.listing_url, null);
  const disabled = source({ enabled: false, owner_disabled: true, pinned: true, mandatory: true });
  const refused = retainSuccessfulAdaptiveSource(disabled, signal(), policy);
  assert.equal(refused.reason, 'owner_disabled');
  assert.deepEqual(refused.source, disabled);
  assert.equal(retainSuccessfulAdaptiveSource(source(), signal({ listing_url: 'https://other.invalid/Jobs' }), policy).reason, 'listing_mismatch');
});

test('actual listing identification preserves registry identity and uses bounded cadence without inventing coverage', () => {
  const pending = createAdaptiveSourceCandidate(scope, registry, { role: 'vacancy_page', url: 'https://example.invalid/Vacancy/ABC' });
  const result = retainSuccessfulAdaptiveSource(pending, signal({ vacancy_url: pending.vacancy_url, vacancy_url_role: 'vacancy' }),
    { ...policy, reuse_check_interval_hours: 48 });
  assert.equal(result.source.registry_id, registry);
  assert.equal(result.source.vacancy_url, pending.vacancy_url);
  assert.equal(result.source.listing_url, listing);
  assert.equal(result.source.status, 'ready');
  assert.equal(result.source.provenance, 'evidenced_listing');
  assert.equal(result.source.check_interval_hours, 48);
  assert.equal(result.source.last_attempted_at, null);
  assert.equal(result.source.last_successful_at, null);
});

test('pending vacancy identification requires its exact vacancy-specific reference rather than an unrelated page or shared portal', () => {
  const pending = createAdaptiveSourceCandidate(scope, registry, { role: 'vacancy_page', url: 'https://example.invalid/Vacancy/ABC' });
  for (const evidence of [signal(), signal({ vacancy_url: pending.vacancy_url }),
    signal({ vacancy_url: pending.vacancy_url, vacancy_url_role: 'application_portal' }),
    signal({ vacancy_url: pending.vacancy_url, vacancy_url_role: 'unknown' }),
    signal({ vacancy_url: pending.vacancy_url, vacancy_url_role: 'listing' }),
    signal({ vacancy_url: 'https://example.invalid/Vacancy/OTHER', vacancy_url_role: 'vacancy' }),
    signal({ vacancy_url: 'https://example.invalid/Vacancy/ABC?email=person@example.invalid', vacancy_url_role: 'vacancy' })]) {
    const result = retainSuccessfulAdaptiveSource(pending, evidence, policy);
    assert.equal(result.reason, 'listing_mismatch');
    assert.equal(result.retained, false);
    assert.deepEqual(result.source, pending, 'unrelated evidence leaves the pending identity and unknown times intact');
  }
  const known = source();
  assert.equal(retainSuccessfulAdaptiveSource(known, signal(), policy).retained, true, 'known listing retention requires no fabricated vacancy association');
});

test('feedback refresh and repeated successful retention preserve owner pins, mandatory state, cadence and stable source IDs', () => {
  const previous = source({ pinned: true, mandatory: true, priority: 90, check_interval_hours: 24, status: 'blocked',
    listing_verified_at: now, last_attempted_at: now, last_successful_at: '2026-10-28T12:00:00Z' });
  const before = JSON.stringify(previous);
  const first = retainSuccessfulAdaptiveSource(previous, signal({ verified_at: '2026-10-28T12:00:00Z' }), policy);
  assert.deepEqual(first.source, previous, 'older listing proof cannot regress verification or rewrite owner configuration');
  const second = retainSuccessfulAdaptiveSource(first.source, signal(), policy);
  assert.deepEqual(second.source, first.source);
  assert.equal(JSON.stringify(previous), before);
});

test('a shared application portal associates two vacancies with one discovery path without merging their identities', () => {
  const path = source({ listing_url: 'https://example.invalid/Portal/Jobs' });
  const discoveries = [{ opportunity_id: '40000000-0000-4000-8000-000000000001', vacancy_id: 'A', registry_id: path.registry_id },
    { opportunity_id: '40000000-0000-4000-8000-000000000002', vacancy_id: 'B', registry_id: path.registry_id }];
  const retained = retainSuccessfulAdaptiveSource(path, signal({ listing_url: path.listing_url! }), policy);
  assert.equal(retained.source.registry_id, path.registry_id);
  assert.equal(new Set(discoveries.map(item => item.opportunity_id)).size, 2);
  assert.deepEqual(discoveries.map(item => item.vacancy_id), ['A', 'B']);
  assert.equal(Object.hasOwn(retained.source, 'opportunity_id'), false, 'source registry operations do not deduplicate opportunities');
});

test('retention validates settings and feedback rather than coercing numeric strings or inventing timestamps', () => {
  for (const invalid of [{ ...policy, successful_source_reuse_enabled: 'true' }, { ...policy, reuse_check_interval_hours: 1 },
    { ...policy, adaptation_enabled: 'true' }, { ...policy, adaptation_paused: 'false' },
    { ...policy, reuse_check_interval_hours: 721 }, { ...policy, reuse_check_interval_hours: '168' }]) {
    assert.throws(() => retainSuccessfulAdaptiveSource(source(), signal(), invalid as unknown as typeof policy));
  }
  for (const value of [NaN, Infinity, -1, 11, '9']) {
    assert.throws(() => retainSuccessfulAdaptiveSource(source(), signal({ interest_score: value as number }), policy));
  }
  assert.throws(() => retainSuccessfulAdaptiveSource(source(), signal({ verified_at: '' }), policy));
  assert.throws(() => retainSuccessfulAdaptiveSource(source(), signal({ confirmed_submission: 'true' as unknown as boolean }), policy));
});
