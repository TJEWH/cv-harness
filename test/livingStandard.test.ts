import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVING_STANDARD_FACTORS, livingStandardScore, readLivingStandard } from '../src/features/opportunities/domain/livingStandard';
import { buildOpportunityGroups, opportunityContextMarkdown } from '../src/features/opportunities/domain/opportunityContext';
import { livingStandardFixture as fixture } from './fixtures/livingStandard';

test('living-standard scores use the agreed weights and one decimal, independent of imported totals', () => {
  assert.equal(LIVING_STANDARD_FACTORS.reduce((total, factor) => total + factor.weight, 0), 100);
  const assessment = readLivingStandard({ ...fixture, score: 10 })!;
  assert.equal(livingStandardScore(assessment), 7.2);
  const zero = structuredClone(fixture);
  for (const factor of Object.values(zero.factors)) factor.score = 0;
  assert.equal(livingStandardScore(zero), 0);
  for (const factor of Object.values(zero.factors)) factor.score = 10;
  assert.equal(livingStandardScore(zero), 10);
});

test('missing evidence is not silently scored as zero or inferred from salary amounts', () => {
  const assessment = structuredClone(fixture);
  assessment.factors.affordability.score = null;
  assert.equal(livingStandardScore(assessment), undefined);
  const markdown = opportunityContextMarkdown({ salary: { amount: 100000 }, data: { living_standard: assessment } }, 'en');
  assert.match(markdown, /Incomplete assessment/);
  assert.match(markdown, /Unknown: confirm pay or funding/);
  assert.doesNotMatch(markdown, /0\.0 \/ 10\.0/);
  assert.equal(buildOpportunityGroups({ metadata_schema_version: 6, salary: { amount: 100000 } }, 'en')
    .flatMap(group => group.items).some(node => node.kind === 'living-standard'), false);
});

test('invalid or unsafe assessment data cannot create a misleading score or executable source link', () => {
  for (const score of [-1, 11, NaN, Infinity, '9.0', true]) {
    assert.equal(readLivingStandard({ ...fixture, factors: { ...fixture.factors, affordability: { score, reason: 'Invalid score' } } }), null);
  }
  for (const patch of [{ version: 2 }, { sources: [] }, { assessed_at: 'invalid' }, { assessed_at: '2026-02-31' }, { confidence: 'certain' },
    { housing_baseline: 'hotel' }, { housing_baseline: ['shared_flat'] }, { factors: {} }, { sources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }]) {
    assert.equal(readLivingStandard({ ...fixture, ...patch }), null);
  }
});

test('living-standard assessments appear once under salary in both UI context and Markdown', () => {
  const context = { metadata_schema_version: 6, city: 'Example city', salary: { amount: 3204 }, data: { living_standard: fixture } };
  const groups = buildOpportunityGroups(context, 'en');
  const assessment = groups.find(group => group.id === 'salary')!.items[0];
  assert.equal(assessment.kind, 'living-standard');
  assert.equal(assessment.score, 7.2);
  assert.match(assessment.text!, /7\.2 \/ 10\.0 · Good · provisional/);
  assert.equal(groups.flatMap(group => group.items).filter(node => node.kind === 'living-standard').length, 1);
  const markdown = opportunityContextMarkdown(context, 'de');
  assert.match(markdown, /7,2 \/ 10,0/);
  assert.match(markdown, /WG-Zimmersuche \(15%\)/);
  assert.match(markdown, /eigenem Zimmer in einer WG/);
  assert.match(markdown, /https:\/\/example.org\/living-standard/);
  assert.match(markdown, /2026-10-16/);
});

test('housing assumptions belong to each assessment, so historical snapshots are not relabelled', () => {
  const { housing_baseline: _baseline, ...legacy } = fixture;
  assert.equal(readLivingStandard(legacy)!.housing_baseline, 'private_apartment');
  const previous = opportunityContextMarkdown({ data: { living_standard: legacy } }, 'en');
  assert.match(previous, /a modest private apartment/);
  assert.doesNotMatch(previous, /private room in a shared flat/);
  const current = opportunityContextMarkdown({ data: { living_standard: fixture } }, 'en');
  assert.match(current, /private room in a shared flat/);
  assert.match(current, /Room search \(15%\)/);
  assert.equal(livingStandardScore(readLivingStandard(legacy)!), livingStandardScore(fixture), 'Rendering must not invent a new score when the housing label changes');
});
