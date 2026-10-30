import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpportunityGroups, checklistKeys, opportunityContextMarkdown, opportunityFieldLabel, personalFitScore, requirementTableRows } from '../src/features/opportunities/domain/opportunityContext';
import type { OpportunityContextNode } from '../src/features/opportunities/domain/opportunityContext';

function flatten(nodes: OpportunityContextNode[]): OpportunityContextNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
}

test('checklist identities survive reordering, object property order and language changes but not changed content', () => {
  const context = { requirements: ['MSc', { requirement: 'Programming', details: ['Python', 'C++'] }], required_documents: ['CV', 'Letter'] };
  const keys = (value: Record<string, unknown>, lang = 'en') => checklistKeys(buildOpportunityGroups(value, lang).flatMap(({ items }) => items)).sort();
  const original = keys(context);
  assert.equal(original.length, 4);
  assert.deepEqual(keys({ ...context, requirements: [{ details: ['Python', 'C++'], requirement: 'Programming' }, 'MSc'], required_documents: ['Letter', 'CV'] }, 'de'), original);
  const changed = keys({ ...context, required_documents: ['CV', 'Letter, maximum one page'] });
  assert.equal(changed.filter((key) => original.includes(key)).length, 3);
  assert.deepEqual(keys({ requirements: [], required_documents: null }), []);
  const nested = keys({ requirements: { mandatory: ['MSc', 'English'], preferred: ['Python'] }, application_documents: ['CV'] });
  assert.equal(nested.length, 4);
  assert.ok(nested.includes(original.find((key) => key.startsWith('documents:required_documents:') && key.endsWith('"CV"'))!));
  const markdown = opportunityContextMarkdown(context, 'en', [original.find((key) => key.endsWith('"CV"'))!]);
  assert.match(markdown, /- \[x\] CV/);
  assert.match(markdown, /- \[ \] Letter/);
});
const fixture = {
  id: 'hidden-id', user_id: 'hidden-account', title: 'Robotics PhD', institution: 'Example University',
  official_url: 'https://example.org/position', application_url: 'https://example.org/apply',
  contacts: [{ name: 'Dr. Example', role: 'scientific_contact', email: 'science@example.org' }],
  supervisors: [{ name: 'Prof. Example', role: 'main_supervisor' }],
  supervisor_research_focus: { 'Prof. Example': { focus_summary: 'Human–robot interaction', keywords: ['Robotics', 'Learning'],
    evidence: ['https://example.org/lab'], checked_at: '2026-09-20T10:00:00Z', limitations: 'Profile may be incomplete.' } },
  supervisor_top_papers: [{ title: 'Robots that learn', year: 2025, venue: 'Example Conference', doi: '10.1234/learning.2025',
    selection_basis: 'Listed on the lab page', why_relevant: 'Matches the advertised project', evidence: ['https://example.org/papers'] }],
  salary: { model: 'TV-L E13', amount: 55000, currency: 'EUR', period: 'annually', details: 'Full-time position' },
  topics: ['Robotics', 'Machine learning'], requirements: ['Relevant MSc', { requirement: 'Programming', details: ['Python', 'C++'] }],
  required_documents: ['CV', { name: 'Motivation letter', details: 'Up to two pages' }],
  personal_fit: { assessment: 'High', reason: 'Experience aligns well' },
  deadline: '2026-10-30', deadline_timezone: 'Europe/Berlin', vacancy_id: 'REF-26',
  data: { additional_research_note: { method: 'Field study', participant_count: 40 } },
};

test('live opportunity shapes are assigned to useful groups and rendered as recursive values', () => {
  const groups = buildOpportunityGroups(fixture, 'en');
  assert.deepEqual(groups.map(({ id }) => id), ['overview', 'requirements', 'documents', 'salary', 'advisor', 'links', 'metadata']);
  const research = groups.find(({ id }) => id === 'advisor')!;
  assert.deepEqual(research.items.slice(0, 2).map(({ label }) => label), ['Advisor research focus', 'Representative papers']);
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.ok(nodes.some(({ label, text }) => label === 'Focus summary' && text === 'Human–robot interaction'));
  assert.ok(nodes.some(({ label, text }) => label === 'Year' && text === '2025'), 'years must not get a thousands separator');
  assert.ok(nodes.some(({ label, text }) => label === 'Amount' && text === '55,000'));
  assert.ok(nodes.some(({ label }) => label === 'Programming'));
  assert.ok(nodes.some(({ label }) => label === 'Motivation letter'));
  assert.ok(nodes.some(({ label, text }) => label === 'Participant count' && text === '40'));
  assert.ok(nodes.some(({ text }) => text === 'Scientific contact'));
  assert.equal(nodes.some(({ text }) => text?.includes('hidden-id') || text?.includes('hidden-account')), false);
  assert.equal(nodes.some(({ text }) => text?.startsWith('{') || text?.startsWith('[')), false, 'objects and arrays must never become JSON text');
});

test('unrecorded advisor research is explicitly identified without inventing facts', () => {
  assert.equal(buildOpportunityGroups({ supervisor_research_focus: {}, supervisor_top_papers: [] }, 'en').some(group => group.id === 'advisor'), false);
  const groups = buildOpportunityGroups({ supervisors: [{ name: 'Named researcher' }], supervisor_research_focus: {}, supervisor_top_papers: [] }, 'en');
  const research = groups.find(({ id }) => id === 'advisor')!;
  assert.deepEqual(research.items.slice(0, 2).map(({ text, missing }) => [text, missing]), [
    ['Advisor research focus not recorded.', true], ['Representative papers not recorded.', true],
  ]);
  const nested = buildOpportunityGroups({ supervisor_research_focus: {}, data: { supervisor_research_focus: { summary: 'Recorded in research dataset' } } }, 'en');
  const nodes = flatten(nested.flatMap(({ items }) => items));
  assert.equal(nodes.some(({ text }) => text === 'Advisor research focus not recorded.'), false);
  assert.equal(nodes.filter(({ text }) => text === 'Recorded in research dataset').length, 1);
});

test('canonical research reads named fields once without storage wrappers or machine metadata', async () => {
  const { canonicalOpportunityFixture } = await import('./fixtures/canonicalOpportunity');
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
  const { canonicalOpportunityFixture } = await import('./fixtures/canonicalOpportunity');
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
  const context = { metadata_schema_version: 5, salary: { min: 3000, max: 3500, currency: 'EUR', period: 'month', gross: true,
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
  const context = { metadata_schema_version: 5,
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
  const groups = buildOpportunityGroups({ contacts: [
    { email: 'alice@example.org' }, { email: 'alice@example.org?bcc=other@example.org' },
  ], source_url: 'javascript:alert(1)', application_url: 'https://user:secret@example.org',
  sources: [{ title: '<img src=x onerror=alert(1)>', url: 'https://example.org/?q=test' }],
  supervisor_top_papers: [{ title: 'Paper', doi: '10.1234/example-paper' }],
  data: { broken_url: 'java\nscript:alert(1)' } }, 'en');
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.deepEqual(nodes.flatMap(node => [...(node.href ? [node.href] : []), ...(node.evidence ?? []).map(reference => reference.href)]).sort(), [
    'https://doi.org/10.1234/example-paper', 'https://example.org/?q=test', 'mailto:alice@example.org',
  ].sort());
  assert.ok(nodes.some(node => node.evidence?.some(reference => reference.text === '<img src=x onerror=alert(1)>')), 'UI must receive source labels as text for Vue escaping');
});

test('duplicate research wrappers do not repeat fields, while extra details and false/zero remain visible', () => {
  const groups = buildOpportunityGroups({ institution: 'Example', data: { university: 'Example',
    salary: { amount: 0 }, personal_fit: { matches: false }, extra: null, empty: [] },
  salary: { details: 'Grant pending' } }, 'en');
  const nodes = flatten(groups.flatMap(({ items }) => items));
  assert.equal(nodes.filter(({ text }) => text === 'Example').length, 1);
  assert.ok(nodes.some(({ text }) => text === '0'));
  assert.ok(nodes.some(({ text }) => text === 'No'));
  assert.ok(nodes.some(({ text }) => text === 'Grant pending'));
  assert.equal(nodes.some(({ label }) => label === 'Empty'), false);
});

test('Markdown export is readable grouped context with safe links and no executable HTML', () => {
  const text = opportunityContextMarkdown({ ...fixture, title: '<script>bad()</script> **Robotics**',
    requirements: ['[click](javascript:alert(1))', 'Line one\n# Unexpected heading'] }, 'en');
  assert.match(text, /## Advisor & lab context/);
  assert.match(text, /\*\*Relevance to the opportunity:\*\* Matches the advertised project/);
  assert.match(text, /\*\*Amount:\*\* 55,000/);
  assert.match(text, /\[10\.1234\/learning\.2025\]\(<https:\/\/doi.org\/10\.1234\/learning\.2025>\)/);
  assert.match(text, /&lt;script&gt;/);
  assert.equal(text.includes('<script>'), false);
  assert.equal(text.includes('[click](javascript:'), false);
  assert.equal(text.includes('\n# Unexpected heading'), false);
  assert.equal(text.includes('hidden-id'), false);
  assert.equal(text.includes('"focus_summary"'), false);
});

test('German labels translate nested known fields and preserve unknown human-readable labels', () => {
  const groups = buildOpportunityGroups(fixture, 'de');
  assert.ok(groups.some(({ label }) => label === 'Bewerbungsunterlagen'));
  assert.ok(flatten(groups.flatMap(({ items }) => items)).some(({ label, text }) => label === 'Betrag' && text === '55.000'));
  assert.equal(opportunityFieldLabel('selection_basis', 'de'), 'Auswahlgrundlage');
  assert.equal(opportunityFieldLabel('labWebsiteUrl', 'en'), 'Lab Website URL');
});

test('unexpected cyclic values and unsupported values cannot break context rendering', () => {
  const data: Record<string, unknown> = { notes: 'Retained note', irrelevant: undefined, count: NaN };
  data.data = data;
  data.references = { self: data };
  const groups = buildOpportunityGroups({ data }, 'en');
  assert.ok(flatten(groups.flatMap(({ items }) => items)).some(({ text }) => text === 'Retained note'));
});

test('duration and research assessments move to their respective groups, including nested data', () => {
  const groups = buildOpportunityGroups({ duration_months: 48, duration_details: 'Renewable contract',
    personal_fit: { gaps: ['Training needed'] }, research_career_potential: 'Academic route', rd_career_potential: 'Industry route',
    data: { start_date: '2027-01-01', lab_context: 'Robotics group', hardware_software_balance: 'Mostly software' } }, 'en');
  const texts = (id: string) => flatten(groups.find((group) => group.id === id)?.items || []).map((node) => node.text);
  assert.ok(texts('salary').includes('48'));
  assert.ok(texts('salary').includes('Renewable contract'));
  assert.ok(texts('salary').includes('1 Jan 2027'));
  assert.ok(texts('overview').includes('Training needed'));
  assert.equal(texts('overview').includes('Mostly software'), true);
  assert.ok(texts('overview').includes('Academic route'));
  assert.ok(texts('overview').includes('Industry route'));
  assert.ok(texts('advisor').includes('Robotics group'));
  assert.equal(texts('metadata').includes('48'), false);
});

test('requirement rows retain content and checklist identities while separating explicit required/optional flags', () => {
  const requirements = { required: ['Relevant MSc'], optional: [
    { requirement: 'Programming', required: true, details: ['Python', 'C++'], url: 'https://example.org/requirements' },
    { requirement: 'German', required: false },
    { requirement: 'Portfolio', optional: true },
  ], other: ['Unclassified item'] };
  for (const lang of ['en', 'de']) {
    const node = buildOpportunityGroups({ requirements }, lang).find(group => group.id === 'requirements')!.items[0];
    const snapshot = structuredClone(node);
    const rows = requirementTableRows(node);
    assert.deepEqual(rows.map(row => row.requirementStatus), ['required', 'required', 'optional', 'optional', undefined]);
    assert.deepEqual(rows.map(row => row.checklistKey), checklistKeys([node]));
    assert.equal(rows[1].label, 'Programming');
    assert.ok(flatten(rows[1].children || []).some(child => child.text === 'C++'));
    assert.ok(rows[1].children?.some(child => child.href === 'https://example.org/requirements'));
    assert.equal(rows[1].children?.some(child => child.id.endsWith('.required')), false);
    assert.equal(rows[2].children?.length, 0);
    assert.deepEqual(node, snapshot, 'the table projection must not alter the source or export');
  }
  const node = buildOpportunityGroups({ requirements: [{ requirement: 'Conflicting flags', required: true, optional: true }] }, 'en')
    .find(group => group.id === 'requirements')!.items[0];
  const [row] = requirementTableRows(node);
  assert.equal(row.requirementStatus, undefined);
  assert.equal(row.children?.length, 2, 'conflicting source flags remain visible');
});

test('item/category records and document statuses produce item rows with their original checklist keys', () => {
  const context = {
    requirements: [{ item: 'Degree', category: 'required' }, { item: 'Robotics', category: 'beneficial' }, { item: 'German', required: false, beneficial: true }],
    required_documents: ['CV', { item: 'Portfolio', status: 'optional' }],
    desired_skills: { preferred: ['Python'], recommended: ['C++'] },
  };
  const groups = buildOpportunityGroups(context, 'en');
  const requirementGroup = groups.find(group => group.id === 'requirements')!;
  const rows = requirementGroup.items.flatMap(requirementTableRows);
  assert.deepEqual(rows.map(row => row.requirementStatus), ['required', 'beneficial', 'beneficial', 'preferred', 'recommended']);
  assert.deepEqual(rows.slice(0, 3).map(row => row.label), ['Degree', 'Robotics', 'German']);
  assert.ok(rows.slice(0, 3).every(row => !row.children?.length));
  assert.equal(rows[1].checklistKey, 'requirements:requirements:{"category":"beneficial","item":"Robotics"}');
  const documents = groups.find(group => group.id === 'documents')!;
  assert.deepEqual(documents.items.flatMap(requirementTableRows).map(row => row.requirementStatus), ['required', 'optional']);
  assert.deepEqual(checklistKeys(documents.items), documents.items.flatMap(requirementTableRows).map(row => row.checklistKey));
  const unspecified = buildOpportunityGroups({ application_documents: ['CV'] }, 'en').find(group => group.id === 'documents')!;
  assert.equal(requirementTableRows(unspecified.items[0])[0].requirementStatus, undefined, 'generic document fields do not imply a required status');
});

test('repeated historical source URLs become flat references while substantive source and contact facts remain', () => {
  const context = {
    official_url: 'https://example.org/job', application_url: 'https://example.org/job',
    sources: [
      { url: 'https://example.org/job', supports: ['Salary'], checked_at: '2026-09-20' },
      { url: 'https://example.org/job', supports: ['Requirements', 'Salary'], notes: 'Official source' },
      { url: 'https://example.org/job?language=de', supports: ['German wording'] },
      { description: 'Archived source without URL' },
    ],
    contacts: [{ name: 'Dr. Example', email: 'science@example.org', role: 'scientific_contact', website: 'https://example.org/job' }],
    contact_email: 'science@example.org',
    data: { sources: [{ url: 'https://example.org/job', supports: ['Duration'], verified: false, fee: 0 }] },
  };
  const original = structuredClone(context);
  const groups = buildOpportunityGroups(context, 'en');
  const links = groups.find(({ id }) => id === 'links')!;
  const overview = groups.find(({ id }) => id === 'overview')!;
  const nodes = flatten([...overview.items, ...links.items]);
  assert.deepEqual(nodes.flatMap(node => [...(node.href ? [node.href] : []), ...(node.evidence ?? []).map(reference => reference.href)]).sort(), [
    'https://example.org/job', 'https://example.org/job?language=de', 'mailto:science@example.org',
  ]);
  const sourceText = nodes.map(node => node.text);
  for (const value of ['Official source', 'No', '0']) assert.ok(sourceText.includes(value), value);
  for (const value of ['Salary', 'Requirements', 'Duration', '20 Sept 2026']) {
    assert.equal(sourceText.includes(value), false, value);
  }
  const references = nodes.filter(node => node.id === 'root.sources');
  assert.equal(references.length, 1);
  assert.equal(references[0]!.children, undefined);
  assert.ok(nodes.some((node) => node.text === 'Archived source without URL'));
  const email = links.items.find((node) => node.href === 'mailto:science@example.org')!;
  assert.ok(email.label?.includes('Dr. Example'));
  assert.ok(flatten(email.children || []).some((node) => node.text === 'Scientific contact'));
  assert.deepEqual(context, original, 'rendering must not mutate stored research');
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.equal(markdown.split('](<https://example.org/job>)').length - 1, 1);
  assert.ok(markdown.includes('https://example.org/job?language=de'));
  assert.ok(markdown.includes('Official source') && markdown.includes('0') && markdown.includes('No'));
});

test('historical primary source metadata does not create nested trees and source notes stay visible in both languages', () => {
  const context = {
    research_summary: 'Research into safe collaboration', official_url: 'https://example.org/job',
    sources: [{ url: 'https://example.org/job', type: 'Official vacancy', supports: ['Project'], supported_fields: ['Deadline', 'Requirements'], checked_at: '2026-09-20', notes: 'Keep this note' }],
    data: { sources: [{ url: 'https://example.org/job', supports: ['Project', 'Funding'] }] },
  };
  const original = structuredClone(context);
  for (const lang of ['en', 'de']) {
    const groups = buildOpportunityGroups(context, lang);
    const overview = groups.find(({ id }) => id === 'overview')!;
    const source = overview.items.find(({ kind }) => kind === 'main-link')!;
    assert.equal(source.href, context.official_url);
    const nodes = flatten(groups.flatMap(group => group.items));
    assert.ok(nodes.some(({ text }) => text === 'Keep this note'));
    assert.equal(nodes.some(node => node.id.endsWith('.metadata') || node.id.endsWith('.checked_at') || node.id.endsWith('.supports')), false);
    for (const value of ['Official vacancy', 'Project', 'Funding', 'Deadline', 'Requirements']) {
      assert.equal(nodes.some(({ text }) => text === value), false);
    }
    assert.equal(nodes.filter(({ href }) => href === context.official_url).length, 1);
    const markdown = opportunityContextMarkdown(context, lang);
    assert.ok(markdown.includes('Keep this note'));
    assert.equal(markdown.split('](<https://example.org/job>)').length - 1, 1);
  }
  assert.deepEqual(context, original);
});

test('frozen snapshot source wrappers become evidence without changing checklist identities or input', () => {
  const requirement = { requirement: 'Relevant MSc', source_urls: ['https://example.org/admission'] };
  const context = { metadata_schema_version: 3, salary: { details: 'Doctoral contract', source_urls: ['https://example.org/pay', 'https://example.org/pay'] },
    supervisor_research_focus: { 'Dr. Example': { summary: 'Acoustic research', evidence: ['https://example.org/lab'] } },
    requirements: [requirement], sources: [{ url: 'https://example.org/unassigned', checked_at: '2026-10-28' }],
    contacts: [{ name: 'Dr. Example', email: 'person@example.org', source_urls: ['https://example.org/team'] }],
  };
  const original = structuredClone(context);
  for (const lang of ['en', 'de']) {
    const groups = buildOpportunityGroups(context, lang), nodes = flatten(groups.flatMap(group => group.items));
    assert.deepEqual(nodes.find(node => node.id === 'root.salary')!.evidence?.map(reference => reference.href), ['https://example.org/pay']);
    assert.deepEqual(nodes.find(node => node.label === 'Dr. Example' && node.id.startsWith('root.supervisor_research_focus'))!.evidence?.map(reference => reference.href), ['https://example.org/lab']);
    const checklist = groups.find(group => group.id === 'requirements')!.items.flatMap(requirementTableRows);
    assert.deepEqual(checklist[0]!.evidence?.map(reference => reference.href), ['https://example.org/admission']);
    assert.equal(checklist[0]!.checklistKey, `requirements:requirements:${JSON.stringify(requirement)}`);
    assert.deepEqual(nodes.find(node => node.href === 'mailto:person@example.org')!.evidence?.map(reference => reference.href), ['https://example.org/team']);
    assert.equal(nodes.some(node => node.id.endsWith('.source_urls') || node.id.endsWith('.checked_at')), false);
    const fallback = nodes.find(node => node.id === 'root.sources')!;
    assert.equal(fallback.children, undefined);
    assert.deepEqual(fallback.evidence?.map(reference => reference.href), ['https://example.org/unassigned']);
    const markdown = opportunityContextMarkdown(context, lang);
    for (const path of ['pay', 'lab', 'admission', 'unassigned', 'team']) assert.equal(markdown.split(`https://example.org/${path}`).length - 1, 1, path);
  }
  assert.deepEqual(context, original);
});

test('overview puts research, the main link and normalized fit scores first; topics live in metadata', () => {
  const context = { topics: ['Robotics'], rd_career_potential: { score: 7, summary: 'Industry opportunities' },
    research_career_potential: { score: '9.5', summary: 'Academic opportunities' }, personal_fit: { score: 8.8, gaps: ['Learn C++'] },
    research_summary: 'Research into safe collaboration', official_url: 'https://example.org/job',
    source_url: 'https://example.org/job', sources: [{ url: 'https://example.org/job', supports: ['Project'] }] };
  const groups = buildOpportunityGroups(context, 'en');
  const overview = groups[0];
  assert.equal(overview.id, 'overview');
  assert.deepEqual(overview.items.map((node) => node.kind), ['summary', 'main-link', 'fit', 'fit', 'fit']);
  assert.deepEqual(overview.items.filter((node) => node.kind === 'fit').map((node) => [node.label, node.score, node.text]), [
    ['Personal fit', 8.8, '8.8 / 10'], ['Academic career potential', 9.5, '9.5 / 10'], ['R&D career potential', 7, '7 / 10'],
  ]);
  assert.ok(flatten(overview.items).some((node) => node.text === 'Learn C++'));
  assert.equal(flatten(groups.flatMap((group) => group.items)).filter((node) => node.href === 'https://example.org/job').length, 1);
  assert.ok(flatten(groups.find((group) => group.id === 'metadata')!.items).some((node) => node.text === 'Robotics'));
  const markdown = opportunityContextMarkdown(context, 'en');
  assert.match(markdown, /\*\*Personal fit:\*\* 8\.8 \/ 10/);
  assert.equal(markdown.includes('## Topics'), false);
});

test('fit visualization accepts zero and ten, but never invents or clamps missing and invalid scores', () => {
  for (const value of [0, 10, 0.5, '8.25']) {
    const fit = buildOpportunityGroups({ personal_fit: { score: value, summary: 'Rationale' } }, 'en')[0].items[0];
    assert.equal(fit.score, Number(value));
    assert.equal(fit.children?.some((node) => node.label === 'Score'), false);
  }
  for (const value of [null, undefined, '', ' ', true, false, -1, 11, 88, NaN, Infinity, 'high', '8/10']) {
    const fit = buildOpportunityGroups({ personal_fit: { score: value, summary: 'Rationale' } }, 'en')[0].items[0];
    assert.equal(fit.kind, 'fit');
    assert.equal(fit.score, undefined, String(value));
    assert.ok(flatten([fit]).some((node) => node.text === 'Rationale'));
  }
  const nested = buildOpportunityGroups({ data: { personal_fit: { score: 8.8 } } }, 'de')[0].items[0];
  assert.equal(nested.text, '8,8 / 10');
});

test('personal fit sorting and badges read the same explicit scores as the detail view', () => {
  for (const [value, expected] of [
    [0, 0], [10, 10], [9.1, 9.1], [9.5, 9.5], [9.6, 9.6],
    [' 9.6 ', 9.6], ['0.00', 0], ['10.0', 10], ['8.25', 8.25],
  ] as const) {
    assert.equal(personalFitScore(value), expected);
    const structured = { score: value, summary: 'An assessment with 2 gaps' };
    assert.equal(personalFitScore(structured), expected);
    const fit = buildOpportunityGroups({ personal_fit: structured }, 'en')[0].items[0];
    assert.equal(fit.score, expected);
    assert.deepEqual(structured, { score: value, summary: 'An assessment with 2 gaps' });
  }
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
  const { canonicalOpportunityFixture, canonicalChecklistStatuses } = await import('./fixtures/canonicalOpportunity');
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
