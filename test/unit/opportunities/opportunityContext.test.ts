import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityGroups, checklistKeys, opportunityContextMarkdown, opportunityFieldLabel, personalFitScore, requirementTableRows } from '../../../src/features/opportunities/domain/opportunityContext';
import type { OpportunityContextNode } from '../../../src/features/opportunities/domain/opportunityContext';
import { canonicalOpportunityFixture } from '../../support/fixtures/canonicalOpportunity';

function flatten(nodes: OpportunityContextNode[]): OpportunityContextNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children || [])]);
}

test('canonical research reads named fields once without storage wrappers or machine metadata', async () => {
  const { canonicalOpportunityFixture } = await import('../../support/fixtures/canonicalOpportunity');
  const fixture = canonicalOpportunityFixture();
  const context = { ...fixture, metadata_schema_version: 6, arbitrary_storage: { relevance: 'Do not display unknown fields' },
    data: { ...fixture.data, personal_fit: { gaps: fixture.personal_fit.gaps, summary: fixture.personal_fit.summary, score: fixture.personal_fit.score } } };
  const nodes = flatten(buildOpportunityGroups(context, 'en').flatMap(group => group.items));
  assert.equal(nodes.filter(node => node.label === 'Personal fit').length, 1);
  assert.equal(nodes.filter(node => node.text === fixture.personal_fit.summary).length, 1);
  for (const label of ['Profiles', 'Text', 'Supports', 'Precision', 'Identity verified', 'Role verified', 'Supervision confirmed', 'Particularly suitable', 'Source urls']) {
    assert.equal(nodes.some(node => node.label === label), false, label);
  }
  assert.equal(nodes.some(node => node.text === 'Do not display unknown fields'), false);
  const funding = nodes.find(node => node.label === 'Funding')!;
  assert.equal(funding.text, 'Salary is confirmed for the doctoral contract.');
  assert.equal(funding.children, undefined);
  assert.equal(nodes.some(node => node.text === fixture.id || node.text?.includes('INTERNAL-')), false);
});

test('canonical checklist display keeps the saved identities of the same historical entries', async () => {
  const { canonicalOpportunityFixture } = await import('../../support/fixtures/canonicalOpportunity');
  const current = canonicalOpportunityFixture();
  const { metadata_schema_version: _version, ...snapshot } = current;
  const previous = checklistKeys(buildOpportunityGroups(snapshot, 'en').flatMap(group => group.items));
  for (const lang of ['en', 'de']) {
    const groups = buildOpportunityGroups(current, lang);
    assert.deepEqual(checklistKeys(groups.flatMap(group => group.items)), previous);
    const rows = groups.filter(group => ['requirements', 'documents'].includes(group.id)).flatMap(group => group.items.flatMap(requirementTableRows)).filter(row => row.kind === 'requirement');
    assert.equal(rows.length, 16);
    assert.ok(rows.every(row => row.requirementStage && !row.children?.some(child => child.label === 'Stage')));
    assert.ok(rows.every(row => row.evidence?.[0]?.href === current.official_url));
  }
});

test('canonical salary is compact, preserves zero and never manufactures an amount', () => {
  const context = { metadata_schema_version: 6, salary: { min: 3000, max: 3500, currency: 'EUR', period: 'month', gross: true,
    components: [{ entity_id: 'allowance', label: 'Allowance', amount: 0, currency: 'EUR', period: 'year', gross: false }] } };
  const salary = buildOpportunityGroups(context, 'en').find(group => group.id === 'salary')!.items.find(node => node.id === 'root.salary')!;
  assert.equal(salary.text, '3,000–3,500 EUR / month gross');
  assert.equal(salary.children?.[0]?.label, 'Allowance');
  assert.equal(salary.children?.[0]?.text, '0 EUR / year net');
  const unknown = buildOpportunityGroups({ metadata_schema_version: 6, salary: { amount: null, currency: 'EUR', period: 'month', gross: true, model: 'TV-L E13' } }, 'en');
  const unknownSalary = unknown.find(group => group.id === 'salary')!.items.find(node => node.id === 'root.salary')!;
  assert.equal(unknownSalary.text, undefined);
  assert.equal(unknownSalary.children?.[0]?.text, 'TV-L E13');
});

test('canonical people combine roles and focus and retain publication and source evidence', () => {
  const context = { metadata_schema_version: 6,
    contacts: [{ entity_id: 'contact', name: 'Dr. Example', email: 'person@example.org', roles: ['Scientific contact'], source_urls: ['https://example.org/team'] }],
    supervisors: [{ entity_id: 'supervisor', name: 'Dr. Example', email: 'person@example.org', roles: ['Supervisor'] }],
    supervisor_research_focus: { profiles: [{ entity_id: 'focus', researcher_id: 'supervisor', name: 'Dr. Example', summary: 'Acoustic experiments', topics: ['Robot audition'] }] },
    supervisor_top_papers: [{ entity_id: 'paper', title: 'Important study', supervisors: ['supervisor'], year: 2026, doi: '10.1234/paper', relevance: 'Uses acoustic prototypes.' }],
  };
  const nodes = flatten(buildOpportunityGroups(context, 'en').flatMap(group => group.items));
  const person = nodes.filter(node => node.label === 'Dr. Example');
  assert.equal(person.length, 1);
  assert.equal(person[0]!.evidence?.[0]?.href, 'https://example.org/team');
  assert.equal(nodes.filter(node => node.href === 'mailto:person@example.org').length, 1);
  assert.ok(nodes.some(node => node.text === 'Scientific contact · Supervisor'));
  assert.ok(nodes.some(node => node.text === 'Acoustic experiments'));
  assert.equal(nodes.filter(node => node.label === 'Important study').length, 1);
  assert.ok(nodes.some(node => node.href === 'https://doi.org/10.1234/paper'));
  assert.ok(nodes.some(node => node.text === 'Uses acoustic prototypes.'));
});

test('canonical missing supervision stays empty and unsafe evidence cannot become a link', () => {
  const groups = buildOpportunityGroups({ metadata_schema_version: 6, supervisor_research_focus: {}, supervisor_top_papers: [], supervisors: [],
    salary: { details: 'Sourced pay model', source_urls: ['javascript:alert(1)', 'https://user:secret@example.org'] },
    sources: [{ url: 'javascript:alert(1)' }] }, 'en');
  assert.equal(groups.some(group => group.id === 'advisor'), false);
  assert.equal(flatten(groups.flatMap(group => group.items)).some(node => node.href?.includes('javascript:') || node.href?.includes('user:secret')), false);
  assert.equal(flatten(groups.flatMap(group => group.items)).some(node => node.evidence?.length), false);
});

test('canonical source references attach to explicit facts once without source metadata rows', () => {
  const context = { metadata_schema_version: 6, research_summary: 'Build acoustic prototypes.',
    salary: { details: 'Funded doctoral contract.', source_urls: ['https://EXAMPLE.org/funding', 'https://example.org/funding'] },
    data: { funding: [{ label: 'Funding', text: 'Four funded years.', source_urls: ['https://example.org/contract'] },
      { label: 'Funding', text: 'Four funded years.', source_urls: ['https://example.org/graduate-school'] }] },
    sources: [{ url: 'https://example.org/research', supports: ['research_summary'], checked_at: '2026-10-28', notes: [{ label: 'Source', text: 'Technical observation metadata' }] },
      { url: 'https://example.org/funding', supports: ['/salary'] },
      { url: 'https://example.org/research', supports: ['/research_summary'] },
      { url: 'https://example.org/contract', supports: ['/data/funding/0'] }],
  };
  const before = structuredClone(context);
  for (const lang of ['en', 'de']) {
    const nodes = flatten(buildOpportunityGroups(context, lang).flatMap(group => group.items));
    assert.deepEqual(nodes.find(node => node.id === 'root.research_summary')!.evidence, [{ text: 'example.org/research', href: 'https://example.org/research' }]);
    assert.deepEqual(nodes.find(node => node.id === 'root.salary')!.evidence, [{ text: 'example.org/funding', href: 'https://example.org/funding' }]);
    assert.deepEqual(nodes.find(node => node.id === 'root.funding.0')!.evidence?.map(entry => entry.href), ['https://example.org/contract', 'https://example.org/graduate-school']);
    assert.equal(nodes.some(node => node.id === 'root.sources' || node.id.includes('.checked') || node.text === 'Technical observation metadata'), false);
    const markdown = opportunityContextMarkdown(context, lang);
    for (const url of ['research', 'funding', 'contract', 'graduate-school']) assert.equal(markdown.split(`https://example.org/${url}`).length - 1, 1, url);
  }
  assert.deepEqual(context, before);
});

test('canonical ambiguous and unassigned sources stay in one flat reference row while substantive links remain', () => {
  const context = { metadata_schema_version: 6, official_url: 'https://example.org/job', application_url: 'https://example.org/apply',
    source_url: 'https://example.org/listing', vacancy_id: 'VACANCY-27',
    contacts: [{ entity_id: 'contact', name: 'Dr. Example', email: 'person@example.org', roles: ['Contact'] }],
    requirements: [{ entity_id: 'degree', text: 'Relevant degree', status: 'required', stage: 'recruitment' },
      { entity_id: 'language', text: 'English proficiency', status: 'required', stage: 'recruitment' }],
    sources: [{ url: 'https://example.org/admission', supports: ['requirements'] },
      { url: 'https://example.org/unassigned', supports: ['unknown_field'], checked_at: '2026-10-28' },
      { url: 'javascript:alert(1)', supports: ['research_summary'] },
      { url: 'https://user:secret@example.org/private', supports: [] }],
  };
  const before = structuredClone(context);
  const groups = buildOpportunityGroups(context, 'en'), nodes = flatten(groups.flatMap(group => group.items));
  const fallback = nodes.filter(node => node.id === 'root.sources');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0]!.children, undefined);
  assert.deepEqual(fallback[0]!.evidence?.map(entry => entry.href), ['https://example.org/admission', 'https://example.org/unassigned', 'https://example.org/listing']);
  assert.ok(nodes.some(node => node.kind === 'main-link' && node.href === context.official_url));
  assert.ok(nodes.some(node => node.href === context.application_url));
  assert.ok(nodes.some(node => node.href === 'mailto:person@example.org'));
  assert.ok(nodes.some(node => node.text === context.vacancy_id));
  const { metadata_schema_version: _version, ...snapshot } = context;
  assert.deepEqual(checklistKeys(nodes), checklistKeys(buildOpportunityGroups(snapshot, 'en').flatMap(group => group.items)));
  const markdown = opportunityContextMarkdown(context, 'en');
  for (const url of ['job', 'apply', 'listing', 'admission', 'unassigned']) assert.equal(markdown.split(`https://example.org/${url}`).length - 1, 1, url);
  assert.equal(markdown.includes('javascript:') || markdown.includes('user:secret'), false);
  assert.deepEqual(context, before);
});

test('canonical collection evidence attaches to one known entry without guessing across entries', () => {
  const context = { metadata_schema_version: 6,
    requirements: [{ entity_id: 'degree', text: 'Relevant degree', status: 'required', stage: 'recruitment', source_urls: ['https://example.org/degree'] },
      { entity_id: 'language', text: 'English proficiency', status: 'required', stage: 'recruitment' }],
    sources: [{ url: 'https://example.org/degree', supports: ['/requirements/@degree'] },
      { url: 'https://example.org/english', supports: ['/requirements/1'] }],
  };
  const nodes = flatten(buildOpportunityGroups(context, 'en').flatMap(group => group.items));
  assert.deepEqual(nodes.find(node => node.id === 'root.requirements.0')!.evidence?.map(entry => entry.href), ['https://example.org/degree']);
  assert.deepEqual(nodes.find(node => node.id === 'root.requirements.1')!.evidence?.map(entry => entry.href), ['https://example.org/english']);
  assert.equal(nodes.some(node => node.id === 'root.sources'), false);
});

test('safe web, email and DOI links work while dangerous or injected links remain plain text', () => {
  const groups = buildOpportunityGroups({ metadata_schema_version: 6, contacts: [
    { email: 'alice@example.org' }, { email: 'alice@example.org?bcc=other@example.org' },
  ], source_url: 'javascript:alert(1)', application_url: 'https://user:secret@example.org',
  sources: [{ url: 'https://example.org/?q=test' }],
  supervisor_top_papers: [{ title: 'Paper', doi: '10.1234/example-paper' }],
  data: { provenance: [{ label: 'Source note', text: '<img src=x onerror=alert(1)>' }] } }, 'en');
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.deepEqual(nodes.flatMap(node => [...(node.href ? [node.href] : []), ...(node.evidence ?? []).map(reference => reference.href)]).sort(), [
    'https://doi.org/10.1234/example-paper', 'https://example.org/?q=test', 'mailto:alice@example.org',
  ].sort());
  assert.ok(nodes.some(node => node.text === '<img src=x onerror=alert(1)>'), 'UI must receive source notes as text for Vue escaping');
});

test('personal fit scores reject malformed values without using prose, nested fields or coercion', () => {
  const invalid = [
    undefined, null, '', ' ', true, false, -0.1, 10.01, NaN, Infinity, -Infinity,
    '9.6 / 10', 'Strong fit: 9.6', '9,6', '1e1', '0xA', '+9.6', '.5', '9.',
    [], [9.6], {}, { assessment: '9.6' }, { summary: 'Personal fit 9.6' },
    { score: { score: 9.6 } }, { value: 9.6 },
  ];
  for (const value of invalid) {
    assert.equal(personalFitScore(value), undefined, `Unexpected score for ${String(value)}`);
    assert.equal(personalFitScore({ score: value }), undefined, `Unexpected structured score for ${String(value)}`);
  }
});

test('canonical checklists preserve conditions and stages without exposing storage identities', () => {
  const context = {
    requirements: [{ entity_id: 'degree', text: 'Language certificate', status: 'conditional', stage: 'doctoral_admission', conditions: ['Only when requested'], source_urls: ['https://example.org/admission'] }],
    contacts: [{ entity_id: 'person', name: 'Dr. Example', roles: ['Supervisor'], source_urls: ['https://example.org/lab'] }],
    sources: [{ source_id: 'observation', url: 'https://example.org/job', kind: 'official', precision: 'date', checked_at: '2026-09-20', supports: ['requirements'] }],
  };
  const groups = buildOpportunityGroups(context, 'en');
  const [row] = groups.find(group => group.id === 'requirements')!.items.flatMap(requirementTableRows);
  assert.equal(row.label, 'Language certificate');
  assert.equal(row.requirementStatus, 'conditional');
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.ok(markdown.includes('Only when requested'));
  assert.ok(markdown.includes('Doctoral admission'));
  assert.ok(!markdown.includes('Entity ID') && !markdown.includes('Source ID'));
  assert.deepEqual(context.requirements[0].entity_id, 'degree');
});

test('canonical unspecified status overrides document-group defaults and process notes are not checklist tasks', async () => {
  const { canonicalOpportunityFixture, canonicalChecklistStatuses } = await import('../../support/fixtures/canonicalOpportunity');
  const fixture = canonicalOpportunityFixture();
  const before = structuredClone(fixture);
  const groups = buildOpportunityGroups(fixture, 'en');
  const documents = groups.find(group => group.id === 'documents')!;
  const rows = documents.items.flatMap(requirementTableRows).filter(row => row.checklistKey);
  assert.deepEqual(rows.map(row => row.requirementStatus), canonicalChecklistStatuses.map(status => status === 'advantageous' ? 'beneficial' : status));
  assert.equal(checklistKeys(groups.flatMap(group => group.items)).length, 16);
  const markdown = opportunityContextMarkdown(fixture, 'en');
  assert.equal(markdown.match(/Dr\. Alex Example/g)?.length, 1);
  assert.ok(markdown.includes('Programme contact') && markdown.includes('https://example.invalid/canonical/team'));
  assert.ok(markdown.includes('Only if the graduate school requests it'));
  assert.ok(!markdown.includes('INTERNAL-') && !markdown.includes(fixture.id));
  assert.deepEqual(fixture, before);
});

test('canonical checklist identities ignore internal IDs and ordering but change with substantive content', () => {
  const degree = { entity_id: 'degree', text: 'MSc', status: 'required', stage: 'recruitment' };
  const programming = { entity_id: 'programming', text: 'Programming', status: 'preferred', stage: 'recruitment', conditions: ['Python', 'C++'] };
  const cv = { entity_id: 'cv', text: 'CV', status: 'required', stage: 'recruitment' };
  const letter = { entity_id: 'letter', text: 'Letter', status: 'required', stage: 'recruitment' };
  const context = { metadata_schema_version: 6, requirements: [degree, programming], required_documents: [cv, letter] };
  const keys = (value: Record<string, unknown>, lang = 'en') => checklistKeys(buildOpportunityGroups(value, lang).flatMap(group => group.items)).sort();
  const original = keys(context);
  assert.equal(original.length, 4);
  assert.deepEqual(keys({ ...context, requirements: [{ conditions: ['Python', 'C++'], stage: 'recruitment', status: 'preferred', text: 'Programming', entity_id: 'replacement-id' }, degree], required_documents: [letter, cv] }, 'de'), original);
  const changed = keys({ ...context, required_documents: [cv, { ...letter, max_pages: 1 }] });
  assert.equal(changed.filter(key => original.includes(key)).length, 3);
  assert.deepEqual(keys({ metadata_schema_version: 6, requirements: [], required_documents: [] }), []);
  const cvKey = original.find(key => key.startsWith('documents:required_documents:') && key.includes('"text":"CV"'))!;
  const markdown = opportunityContextMarkdown(context, 'en', [cvKey]);
  assert.match(markdown, /\[x\] \*\*CV:/);
  assert.match(markdown, /\[ \] \*\*Letter:/);
});

test('canonical Markdown escapes document text and never turns source text into executable markup', () => {
  const fixture = canonicalOpportunityFixture();
  const context = { ...fixture, title: '<script>bad()</script> **Robotics**',
    required_documents: [{ entity_id: 'unsafe-label', text: '[click](javascript:alert(1))\n# Unexpected heading', status: 'required', stage: 'recruitment' }] };
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.match(markdown, /## Advisor & lab context/);
  assert.match(markdown, /https:\/\/example.invalid\/canonical\/job/);
  assert.match(markdown, /&lt;script&gt;/);
  assert.equal(markdown.includes('<script>'), false);
  assert.equal(markdown.includes('[click](javascript:'), false);
  assert.equal(markdown.includes('\n# Unexpected heading'), false);
  assert.equal(markdown.includes('INTERNAL-'), false);
});

test('canonical German groups and common field labels retain their translations', () => {
  const groups = buildOpportunityGroups(canonicalOpportunityFixture(), 'de');
  assert.ok(groups.some(group => group.label === 'Bewerbungsunterlagen'));
  assert.equal(opportunityFieldLabel('selection_basis', 'de'), 'Auswahlgrundlage');
  assert.equal(opportunityFieldLabel('labWebsiteUrl', 'en'), 'Lab Website URL');
});

test('canonical assessment scores keep numeric bounds while the shared score helper preserves explicit display parsing', () => {
  for (const score of [0, 0.5, 8.25, 9.1, 9.6, 10]) {
    const assessment = { score, summary: 'Rationale', scale_min: 0, scale_max: 10 };
    const fit = buildOpportunityGroups({ metadata_schema_version: 6, personal_fit: assessment }, 'en')[0].items[0];
    assert.equal(fit.score, score);
    assert.equal(personalFitScore(assessment), score);
    assert.equal(personalFitScore(String(score)), score);
  }
  for (const score of [null, undefined, '', ' ', true, -1, 11, NaN, Infinity, 'high', '8/10']) {
    const fit = buildOpportunityGroups({ metadata_schema_version: 6, personal_fit: { score, summary: 'Rationale' } }, 'en')[0].items[0];
    assert.equal(fit.kind, 'fit');
    assert.equal(fit.score, undefined, String(score));
    assert.ok(flatten([fit]).some(node => node.text === 'Rationale'));
  }
});
