import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCvAdjustmentResponse, prepareCvAdjustment, reconstructCvAdjustment } from '../src/features/refinement/domain/cvAdjustments';
import type { LocalCvAdjustmentRequest } from '../src/features/refinement/cvAdjustmentTypes';
import { createTestState } from './helpers';

function fixture() {
  return createTestState({ contact: { name: 'Taylor [Q]', role: 'Researcher', location: 'Neustadt', email: 'taylor@example.org', phone: '+44 12345', website: 'https://taylor.example.org', linkedin: '', github: '' },
    about: { text: 'Taylor [Q] researches !!secret robotics!!. Contact taylor@example.org.' },
    education: [{ id: 'private-degree-id', title: 'Physics', institution: 'Public university', start: '2019', end: '2023', state: 'complete' }],
    experience: { jobs: [{ id: 'private-job-id', title: 'Research assistant', bullets: 'Built prototypes.' }, { id: 'hidden-id', title: 'Hidden employer', hidden: true }, { id: 'excluded-id', title: 'Excluded employer' }] },
    anonymization: { excludedSections: ['private-section'], excludedItems: ['excluded-id'] },
    customSections: [{ id: 'private-section', name: 'Secret section', text: 'Excluded body', entryMode: 'textarea', entries: [] }, { id: 'public-section', name: 'Research', entryMode: 'textarea', text: 'Public prose !!private fragment!!', entries: [{ id: 'inactive-entry', desc: 'Inactive form content' }] }],
    sidebarSections: [{ id: 'private-sidebar-id', name: 'Skills', levelType: 'years', items: [{ id: 'skill-id', name: 'Python', levelValue: 5 }] }],
    design: { ink: '#203040', customFonts: [{ name: 'Private font', source: 'google' }] },
  });
}
function response(request: LocalCvAdjustmentRequest, edits: { fieldId: string; text: string }[] = []) {
  return { schemaVersion: 1, requestId: request.publicRequest.requestId, edits };
}
function field(request: LocalCvAdjustmentRequest, label: string) {
  const result = request.publicRequest.fields.find((entry) => entry.label === label);
  assert.ok(result, label); return result;
}

test('adjustment projection omits identity, local metadata, hidden/excluded and inactive content', () => {
  const state = fixture(); const before = structuredClone(state);
  const request = prepareCvAdjustment({ state, variantId: 'Private local variant', instructions: 'Tailor Taylor [Q] for !!secret target!!.', opportunity: { title: 'Robotics', requirement: 'Contact taylor@example.org. !!hidden note!!' } });
  const wire = JSON.stringify(request.publicRequest);
  for (const secret of ['Taylor [Q]', 'taylor@example.org', 'private-', 'Hidden employer', 'Excluded employer', 'Secret section', 'Excluded body', 'Inactive form content', 'Private font', 'Private local variant']) assert.equal(wire.includes(secret), false, secret);
  assert.ok(wire.includes('Public university')); assert.ok(wire.includes('Research assistant'));
  assert.equal(field(request, 'Professional headline').text, 'Researcher');
  assert.equal(request.publicRequest.instructions, 'Tailor {{APPLICANT_NAME}} for !!secret target!!.');
  assert.deepEqual(state, before);
});

test('accepted wording reconstructs private fragments exactly and preserves CV IDs, structures and layout', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  const profile = field(request, 'Profile'); const title = field(request, 'Experience 1: title');
  const result = reconstructCvAdjustment(request, response(request, [
    { fieldId: profile.id, text: profile.text.replace('researches', 'specializes in') },
    { fieldId: title.id, text: 'Robotics research assistant' },
  ]), state);
  const expected = structuredClone(state); expected.about.text = expected.about.text.replace('researches', 'specializes in'); expected.experience.jobs[0].title = 'Robotics research assistant';
  assert.deepEqual(result.state, expected); assert.equal(result.changed, true); assert.equal(result.changedFieldCount, 2);
  assert.deepEqual(state, fixture()); assert.equal(result.state.education[0].id, 'private-degree-id');
});

test('selected field types use restorable tokens everywhere in adjustment sources', () => {
  const state = fixture();
  state.anonymization.proxyFields = ['company', 'institution', 'place', 'dates'];
  state.education[0].institution = '  Private university  ';
  state.education[0].place = 'Secret City';
  state.experience.jobs[0].company = 'Taylor [Q] Works';
  state.experience.jobs[1].company = 'Hidden Research Firm';
  state.experience.jobs[0].bullets = 'Built prototypes at Taylor [Q] Works in Secret City from 2019 to 2023.';
  state.about.text = 'Work at Hidden Research Firm. [Private university](https://research.example.test).';
  state.customSections[1].text = 'Research in Secret City.';
  const request = prepareCvAdjustment({ state, variantId: 'base', instructions: 'Focus on Private university and Taylor [Q] Works.',
    opportunity: { employer: 'Taylor [Q] Works', 'Secret City': ['2019', '2023', 'Hidden Research Firm'] } });
  const wire = JSON.stringify(request.publicRequest);
  for (const secret of ['Private university', 'Taylor [Q] Works', 'Secret City', 'Hidden Research Firm', '2019', '2023', 'research.example.test']) {
    assert.equal(wire.includes(secret), false, secret);
  }
  const institution = field(request, 'Education 1: institution');
  const company = field(request, 'Experience 1: company');
  for (const projected of [institution, company, field(request, 'Education 1: place')]) assert.match(projected.text, /^\{\{PRIVATE_[1-9][0-9]*\}\}$/);
  assert.equal(request.bindings.find(binding => binding.fieldId === institution.id)!.tokens[institution.text], '  Private university  ');
  assert.equal(request.bindings.find(binding => binding.fieldId === company.id)!.tokens[company.text], 'Taylor [Q] Works');
  const bullets = field(request, 'Experience 1: bullets');
  const restored = reconstructCvAdjustment(request, response(request, [{ fieldId: bullets.id, text: bullets.text.replace('Built prototypes', 'Developed prototypes') }]), state);
  const expected = structuredClone(state); expected.experience.jobs[0].bullets = expected.experience.jobs[0].bullets!.replace('Built prototypes', 'Developed prototypes');
  assert.deepEqual(restored.state, expected);
  assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: company.id, text: 'Invented company' }]), state), /Private placeholders/);
  assert.throws(() => reconstructCvAdjustment(request, response(request), { ...state, anonymization: { ...state.anonymization, proxyFields: [] } }), /CV changed/);
});

test('field switches protect institutions while titles, item names and levels remain editable', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['institution'] },
    customSections: [{ id: 'custom', name: 'Public heading', entries: [{ id: 'custom-item', title: 'Private title', sub: 'Private subtitle' }] }],
    sidebarSections: [{ id: 'skills', name: 'Public sidebar heading', levelType: null, items: [{ id: 'skill', name: 'Private skill', level: 'Private proficiency' }, { id: 'empty-skill', name: '' }] }],
  });
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  for (const label of ['Body section 1 1: sub']) {
    assert.match(field(request, label).text, /^\{\{PRIVATE_[1-9][0-9]*\}\}$/);
  }
  assert.equal(field(request, 'Body section 1 1: title').text, 'Private title');
  assert.equal(field(request, 'Sidebar section 1 1: name').text, 'Private skill');
  assert.equal(field(request, 'Sidebar section 1 1: level').text, 'Private proficiency');
  assert.equal(field(request, 'Body section 1: heading').text, 'Public heading');
  assert.equal(field(request, 'Sidebar section 1: heading').text, 'Public sidebar heading');
  assert.equal(field(request, 'Sidebar section 1 2: name').text, '');
  assert.deepEqual(reconstructCvAdjustment(request, response(request), state).state, state);
});

test('selected field proxies preserve unrelated words and capture complete composite values as a whole', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company', 'institution'] },
    education: [{ id: 'degree', institution: 'Public !!Private!! University' }],
    experience: { jobs: [{ id: 'job', company: 'A' }] },
    about: { text: 'Annual evidence at A. Public !!Private!! University. [A](https://company.example.test).' },
  });
  const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  assert.match(profile.text, /^Annual evidence at \{\{PRIVATE_\d+\}\}\. \{\{PRIVATE_\d+\}\}\. \{\{PRIVATE_\d+\}\}\.$/);
  const restored = reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: `Strong ${profile.text}` }]), state);
  assert.equal(restored.state.about.text, `Strong ${state.about.text}`);
});

test('private Markdown links, existing token literals and repeated identities restore without token collisions', () => {
  const state = fixture();
  state.about.text = '[{{PRIVATE_LABEL}}](https://secret.example) {{PRIVATE_1}} {{OTHER}} TAYLOR [Q] Taylor [Q] and [Portfolio](https://taylor.example.org)';
  const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  assert.equal(profile.text.includes('secret.example'), false); assert.equal(profile.text.includes('taylor.example'), false);
  const result = reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: `Evidence: ${profile.text}` }]), state);
  assert.equal(result.state.about.text, `Evidence: ${state.about.text}`);
});

test('manual field privacy text is shared on top of automatic masks and never replaces local originals', () => {
  const state = fixture();
  state.about.text = 'Worked under supervision of John Doe.';
  state.experience.jobs[0].company = 'Private University';
  state.anonymization.proxyFields = ['company'];
  state.anonymization.fieldOverrides = {
    '["about","text"]': 'Worked under supervision of a qualified person.',
    '["item","private-job-id","company"]': 'Publicly approved Private University',
    '["item","private-job-id","desc"]': 'Additional public description',
    '["heading","jobs"]': 'Relevant roles',
  };
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  const profile = field(request, 'Profile [privacy replacement; comments only]');
  const company = field(request, 'Experience 1: company [privacy replacement; comments only]');
  assert.equal(profile.text, 'Worked under supervision of a qualified person.');
  assert.equal(field(request, 'Section heading [privacy replacement; comments only]').text, 'Relevant roles');
  assert.equal(company.text, 'Publicly approved Private University', 'explicit text takes precedence over automatic company masking');
  assert.equal(field(request, 'Experience 1: desc [privacy replacement; comments only]').text, 'Additional public description');
  assert.equal(JSON.stringify(request.publicRequest).includes('John Doe'), false);
  const title = field(request, 'Experience 1: title');
  const result = reconstructCvAdjustment(request, response(request, [{ fieldId: title.id, text: 'Robotics assistant' }]), state);
  assert.equal(result.state.about.text, state.about.text);
  assert.deepEqual(result.state.anonymization.fieldOverrides, state.anonymization.fieldOverrides);
  assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: 'Short public text' }]), state), /comments only/);
  state.anonymization.fieldOverrides['["about","text"]'] = '';
  const empty = prepareCvAdjustment({ state, variantId: 'base' });
  assert.equal(field(empty, 'Profile [privacy replacement; comments only]').text, '');
  assert.deepEqual(reconstructCvAdjustment(empty, response(empty), state).state, state);
});

test('disabled sections and excluded header are neither uploaded nor adjustable', () => {
  const state = fixture(); state.disabled = ['header', 'about', 'education', 'private-sidebar-id'];
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.ok(request.publicRequest.fields.every(({ label }) => !/headline|Profile|Education|Sidebar/.test(label)));
  assert.equal(JSON.stringify(request.publicRequest).includes('Public university'), false);
});

test('empty and equivalent responses are no-ops and return an isolated unchanged CV', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  for (const edits of [[], request.publicRequest.fields.map(({ id, text }) => ({ fieldId: id, text }))]) {
    const result = reconstructCvAdjustment(request, JSON.stringify(response(request, edits)), state);
    assert.equal(result.changed, false); assert.equal(result.changedFieldCount, 0); assert.deepEqual(result.state, state); assert.notEqual(result.state, state);
  }
});

test('optional undefined fields and reordered object keys do not create false stale-baseline conflicts', () => {
  const state = fixture(); state.education[0].thesis = undefined;
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  const reordered = Object.fromEntries(Object.entries(state).reverse()) as typeof state;
  assert.equal(reconstructCvAdjustment(request, response(request), reordered).changed, false);
});

test('stale content or layout and responses for other requests are rejected', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.throws(() => reconstructCvAdjustment(request, response(request), { ...state, about: { text: 'Changed' } }), /CV changed/);
  assert.throws(() => reconstructCvAdjustment(request, response(request), { ...state, design: { ink: '#000' } }), /CV changed/);
  assert.throws(() => reconstructCvAdjustment(request, { ...response(request), requestId: crypto.randomUUID() }, state), /another CV/);
});

test('private tokens cannot be removed, duplicated, reordered, invented or moved across fields', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  const tokens = profile.text.match(/\{\{PRIVATE_\d+\}\}/g)!;
  const unsafe = [profile.text.replace(tokens[0], ''), `${profile.text} ${tokens[0]}`, profile.text.replace(tokens[0], '{{PRIVATE_999}}'),
    profile.text.replace(tokens[0], 'SWAP').replace(tokens[1], tokens[0]).replace('SWAP', tokens[1]), `${profile.text} {{APPLICANT_NAME}}`];
  for (const text of unsafe) assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text }]), state), /Private placeholders/);
  const headline = field(request, 'Professional headline');
  assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: headline.id, text: `Engineer ${tokens[0]}` }]), state), /Private placeholders/);
});

test('responses cannot target local paths, add fields, duplicate fields, or carry prototype payloads', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  for (const edits of [[{ fieldId: 'contact.name', text: 'Injected' }], [{ fieldId: 'field-99999', text: 'Injected' }], [{ fieldId: profile.id, text: profile.text }, { fieldId: profile.id, text: profile.text }]]) {
    assert.throws(() => reconstructCvAdjustment(request, response(request, edits), state), /Invalid|unavailable/);
  }
  assert.throws(() => parseCvAdjustmentResponse({ ...response(request), extra: 'secret' }), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse(JSON.stringify(response(request)).replace('"edits":[]', '"edits":[],"__proto__":{"polluted":true}')), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse({ ...response(request), edits: [{ fieldId: profile.id, text: profile.text, path: ['contact', 'name'] }] }), /Invalid/);
  assert.equal(Object.hasOwn({}, 'polluted'), false);
});

test('malicious new URLs, images and HTML or private tokens in link destinations are rejected', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  for (const text of [`${profile.text} https://evil.example`, `${profile.text} ![image](image.png)`, `${profile.text} <img src=x>`, profile.text.replace(/(\{\{PRIVATE_\d+\}\})/, '[send]($1)')]) {
    assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text }]), state), /cannot add links/);
  }
});

test('persisted local bindings cannot redirect edits into identity or alter secret reconstruction', () => {
  const state = fixture(); const request = prepareCvAdjustment({ state, variantId: 'base' }); const profile = field(request, 'Profile');
  const before = structuredClone(state);
  request.bindings.forEach((binding) => { binding.path = ['contact', 'name']; for (const key of Object.keys(binding.tokens)) binding.tokens[key] = 'tampered'; });
  assert.throws(() => reconstructCvAdjustment(request, response(request, [{ fieldId: profile.id, text: `Public ${profile.text}` }]), state), /reconstruction mappings.*inconsistent/);
  assert.deepEqual(state, before);
  request.publicRequest.fields[0].text = 'tampered';
  assert.throws(() => reconstructCvAdjustment(request, response(request), state), /inconsistent/);
});

test('JSON bounds, controls, literal punctuation and short identity boundaries are safe', () => {
  const state = createTestState({ contact: { ...fixture().contact, name: 'Ann' }, about: { text: 'Ann writes an annual report. !!unclosed secret' } });
  const request = prepareCvAdjustment({ state, variantId: 'base' });
  assert.ok(field(request, 'Profile').text.includes('annual report')); assert.equal(JSON.stringify(request.publicRequest).includes('unclosed secret'), true);
  assert.throws(() => prepareCvAdjustment({ state, variantId: 'base', instructions: 'x'.repeat(20001) }), /too long/);
  assert.throws(() => parseCvAdjustmentResponse(response(request, [{ fieldId: 'field-1', text: 'a\u0000b' }])), /Invalid/);
  assert.throws(() => parseCvAdjustmentResponse('x'.repeat(1048577)), /too large/);
  assert.throws(() => parseCvAdjustmentResponse('```json\n{}\n```'), /Markdown/);
});
