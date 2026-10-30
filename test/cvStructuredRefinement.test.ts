import assert from 'node:assert/strict';
import test from 'node:test';
import type { CvOperation, CvStructure } from '../src/features/refinement/cvStructuredTypes';
import { applyCvOperations, describeCvOperation, prepareCvStructure, validateCvOperations, validateCvStructure } from '../src/features/refinement/domain/cvStructuredRefinement';
import { prepareCvAdjustment } from '../src/features/refinement/domain/cvAdjustments';
import { createTestState } from './helpers';

function fixture() {
  const state = createTestState({
    contact: { name: 'Ada Example', role: 'Research engineer', email: 'ada@example.test', location: 'Berlin', phone: '+49 1234', website: '', linkedin: '', github: '' },
    about: { text: 'I develop highly reliable robot sensing systems.' },
    education: [{ id: 'local-degree', title: 'Physics', institution: 'Public university', start: '2019', end: '2023', desc: 'Studied experimental measurement and practical analysis.' }],
    experience: { jobs: [
      { id: 'local-job-a', title: 'Engineer A', company: 'Public laboratory', bullets: '- Built highly reliable robots.  \r\n- Led {{private lab}} experiments.\r\n- Shared public results.\r\n' },
      { id: 'local-hidden-job', title: 'Hidden job', bullets: 'Never disclose this work.', hidden: true },
      { id: 'local-job-b', title: 'Engineer B', bullets: 'Tested many robust sensors.\nPublished reproducible results.' },
      { id: 'local-excluded-job', title: 'Excluded job', bullets: 'Never disclose this either.' },
      { id: 'local-job-c', title: 'Engineer C', desc: 'Led careful instrument calibration.' },
    ] },
    customSections: [
      { id: 'local-hidden-section', name: 'Private section', entryMode: 'textarea', text: 'Private research agenda.', entries: [] },
      { id: 'local-prose', name: 'Research', entryMode: 'textarea', text: 'I create careful practical experiments.', entries: [] },
      { id: 'local-complex', name: 'Complex notes', entryMode: 'textarea', text: '## Heading\n- Nested material\n  - Subordinate item', entries: [] },
    ],
    languages: [{ id: 'local-language-en', name: 'English' }, { id: 'local-hidden-language', name: 'Hidden language', hidden: true }, { id: 'local-language-de', name: 'German' }],
    sidebarSections: [
      { id: 'local-hidden-skills', name: 'Private skills', levelType: null, items: [{ id: 'private-skill', name: 'Private technology' }] },
      { id: 'local-skills', name: 'Skills', levelType: null, items: [{ id: 'local-python', name: 'Python' }, { id: 'local-rust', name: 'Rust' }] },
    ],
    hobbies: [{ id: 'local-hobby', name: 'Hiking' }],
    anonymization: { excludedSections: ['local-hidden-section', 'local-hidden-skills'], excludedItems: ['local-excluded-job'] },
    bodyOrder: ['jobs', 'local-hidden-section', 'about', 'education', 'local-prose', 'local-complex'],
    sidebarOrder: ['languages', 'local-hidden-skills', 'local-skills', 'hobbies'],
  });
  const local = prepareCvAdjustment({ state, variantId: 'local-private-template' });
  const prepared = prepareCvStructure(local);
  return { state, local, ...prepared };
}
function operation(index: number, operation: Omit<CvOperation, 'id' | 'explanation'> & { order?: string[]; text?: string }): CvOperation {
  return { id: `change-${index}`, explanation: 'Prioritize the most relevant evidence.', ...operation } as CvOperation;
}
function entry(structure: CvStructure, label: string) {
  const result = structure.entries.find(item => item.label === label); assert.ok(result, label); return result;
}
function section(structure: CvStructure, label: string) {
  const result = structure.sections.find(item => item.label === label); assert.ok(result, label); return result;
}

test('structure is deterministic, follows existing areas and exposes no local paths, identities or hidden content', () => {
  const { local, structure, bindings } = fixture();
  const again = prepareCvStructure(prepareCvAdjustment({ state: local.baselineState, variantId: local.sourceVariantId }));
  assert.deepEqual(again.structure, structure); assert.deepEqual(again.bindings, bindings);
  assert.deepEqual(structure.areas[0].sectionIds.map(id => structure.sections.find(item => item.id === id)!.label), ['Experience', 'Profile', 'Education', 'Research', 'Complex notes']);
  assert.deepEqual(structure.areas[1].sectionIds.map(id => structure.sections.find(item => item.id === id)!.label), ['Languages', 'Skills', 'Interests']);
  const wire = JSON.stringify(structure);
  for (const privateText of ['local-', 'Ada Example', 'ada@example', 'private lab', 'Hidden job', 'Excluded job', 'Hidden language', 'Private research', 'Private technology', 'entriesPath', 'baselineState', 'bindings']) assert.equal(wire.includes(privateText), false, privateText);
  assert.match(wire, /PRIVATE_1/);
  assert.ok(bindings.sections.some(item => item.sourceId === 'local-prose'), 'private source references remain in local bindings only');
  const protectedField = local.publicRequest.fields.find(item => item.label === 'Experience 1: company')!;
  assert.ok(structure.unsupported.some(item => item.fieldId === protectedField.id));
  assert.ok(structure.ranges.filter(range => !range.typoOnly).every(range => !['title', 'company', 'institution', 'name', 'dates'].includes(String(bindings.ranges.find(item => item.id === range.id)!.path.at(-1)))));
});

test('bounded labels preserve whole Unicode characters without generating invalid JSON surrogates', () => {
  for (const prefixLength of [198, 199]) {
    const title = `${'A'.repeat(prefixLength)}😀 trailing title`;
    const expected = 'A'.repeat(prefixLength) + (prefixLength === 198 ? '😀' : '');
    const state = createTestState({
      about: { text: 'Useful public profile content.' }, sectionNames: { about: title },
      experience: { jobs: [{ id: 'job', title, bullets: 'Useful public evidence.' }] },
      customSections: [{ id: 'custom', name: title, entryMode: 'textarea', text: 'Useful custom content.', entries: [] }],
      bodyOrder: ['about', 'jobs', 'custom'],
    });
    const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
    assert.equal(structure.entries[0].label, expected);
    assert.equal(structure.sections[0].label, expected);
    assert.equal(structure.sections[2].label, expected);
    assert.equal(structure.ranges[0].label, expected);
    for (const node of [...structure.sections, ...structure.entries, ...structure.ranges]) {
      assert.ok(node.label.length <= 200);
      assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(node.label), false);
    }
    assert.equal(local.baselineState.experience.jobs[0].title, title, 'display truncation does not alter source wording');
  }
});

test('all operation types compose deterministically while hidden entries and sections keep their exact slots', () => {
  const { state, local, structure } = fixture(); const engineer = entry(structure, 'Engineer A'); const jobs = section(structure, 'Experience');
  const firstRange = structure.ranges.find(item => item.bulletId === engineer.bulletIds[0])!;
  const profile = structure.ranges.find(item => item.label === 'Profile')!;
  const operations: CvOperation[] = [
    operation(1, { type: 'reorder_sections', targetId: 'body', order: [...structure.areas[0].sectionIds].reverse() }),
    operation(2, { type: 'reorder_entries', targetId: jobs.id, order: [...jobs.entryIds].reverse() }),
    operation(3, { type: 'reorder_bullets', targetId: engineer.id, order: [...engineer.bulletIds].reverse() }),
    operation(4, { type: 'omit_bullet', targetId: engineer.bulletIds[1] }),
    operation(5, { type: 'shorten_text', targetId: firstRange.id, text: 'Built robots.' }),
    operation(6, { type: 'shorten_text', targetId: profile.id, text: 'I develop robot sensing systems.' }),
    operation(7, { type: 'reorder_sections', targetId: 'sidebar', order: [...structure.areas[1].sectionIds].reverse() }),
  ];
  const before = structuredClone(state);
  const result = applyCvOperations(local, structure, operations, state);
  assert.deepEqual(result, applyCvOperations(local, structure, [...operations].reverse(), state), 'operation order cannot change the composed result');
  assert.deepEqual(result.bodyOrder, ['local-complex', 'local-hidden-section', 'local-prose', 'education', 'about', 'jobs']);
  assert.deepEqual(result.sidebarOrder, ['hobbies', 'local-hidden-skills', 'local-skills', 'languages']);
  assert.deepEqual(result.experience.jobs.map(item => item.id), ['local-job-c', 'local-hidden-job', 'local-job-b', 'local-excluded-job', 'local-job-a']);
  assert.deepEqual(result.experience.jobs[1], state.experience.jobs[1]);
  assert.deepEqual(result.experience.jobs[3], state.experience.jobs[3]);
  assert.equal(result.experience.jobs[4].bullets, '- Shared public results.\r\n- Built robots.  \r\n');
  assert.equal(result.about.text, 'I develop robot sensing systems.');
  assert.deepEqual(result.contact, state.contact); assert.deepEqual(result.design, state.design); assert.deepEqual(state, before);
});

test('reordering preserves line prefixes, trailing spaces, line endings and final-newline presence byte for byte', () => {
  for (const bullets of ['- Alpha evidence.  \r\n-  Beta evidence.\t\r\n- Gamma evidence.\r\n', 'Alpha evidence.  \nBeta evidence.\t\nGamma evidence.']) {
    const state = createTestState({ experience: { jobs: [{ id: 'job', title: 'Job', bullets }] } });
    const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
    const job = entry(structure, 'Job');
    const result = applyCvOperations(local, structure, [operation(1, { type: 'reorder_bullets', targetId: job.id, order: [...job.bulletIds].reverse() })], state);
    assert.equal(result.experience.jobs[0].bullets, bullets.startsWith('-') ? '- Gamma evidence.\r\n-  Beta evidence.\t\r\n- Alpha evidence.  \r\n' : 'Gamma evidence.\nBeta evidence.\t\nAlpha evidence.  ');
  }
});

test('shortenings preserve exact private fragments and tampered reconstruction paths block all application', () => {
  const { state, local, structure } = fixture(); const engineer = entry(structure, 'Engineer A');
  const privateRange = structure.ranges.find(item => item.bulletId === engineer.bulletIds[1])!;
  const shortened = privateRange.text.replace('Led ', '');
  const result = applyCvOperations(local, structure, [operation(1, { type: 'shorten_text', targetId: privateRange.id, text: shortened })], state);
  assert.equal(result.experience.jobs[0].bullets, '- Built highly reliable robots.  \r\n- {{private lab}} experiments.\r\n- Shared public results.\r\n');
  assert.equal(result.contact.name, 'Ada Example');
  local.bindings.forEach(binding => { binding.path = ['contact', 'name']; Object.keys(binding.tokens).forEach(key => { binding.tokens[key] = 'tampered'; }); });
  assert.throws(() => applyCvOperations(local, structure, [operation(1, { type: 'shorten_text', targetId: privateRange.id, text: shortened })], state), /reconstruction mappings.*inconsistent/);
  assert.throws(() => applyCvOperations(local, structure, [], state, []), /reconstruction mappings.*inconsistent/);
});

test('structured changes carry field proxies with their original entries and restore exact repeated values', () => {
  const state = createTestState({
    anonymization: { excludedSections: [], excludedItems: [], proxyFields: ['company', 'place', 'dates'] },
    experience: { jobs: [
      { id: 'first', title: 'Secret role', company: 'Private Company', place: 'Private City', start: '2012', end: '2018', bullets: '- Built reliable sensors at Private Company.\n- Shared results in Private City.' },
      { id: 'second', title: 'Other secret role', company: 'Other Private Company', bullets: '- Measured reliable systems.' },
    ] },
  });
  const local = prepareCvAdjustment({ state, variantId: 'base' }); const { structure } = prepareCvStructure(local);
  for (const secret of ['Private Company', 'Private City']) assert.equal(JSON.stringify(structure).includes(secret), false);
  const jobs = section(structure, 'Experience'); const first = structure.entries[0];
  const firstRange = structure.ranges.find(range => range.bulletId === first.bulletIds[0])!;
  const result = applyCvOperations(local, structure, [
    operation(1, { type: 'reorder_entries', targetId: jobs.id, order: [...jobs.entryIds].reverse() }),
    operation(2, { type: 'shorten_text', targetId: firstRange.id, text: firstRange.text.replace('reliable ', '') }),
  ], state);
  assert.deepEqual(result.experience.jobs[0], state.experience.jobs[1]);
  assert.deepEqual(result.experience.jobs[1], { ...state.experience.jobs[0], bullets: state.experience.jobs[0].bullets!.replace('reliable ', '') });
  const corrupted = structuredClone(local); const binding = corrupted.bindings.find(binding => Object.values(binding.tokens).includes('Private Company'))!;
  delete binding.tokens[Object.keys(binding.tokens).find(token => binding.tokens[token] === 'Private Company')!];
  assert.throws(() => applyCvOperations(corrupted, structure, [], state), /reconstruction mappings/);
});

test('omitting a private bullet only changes the candidate and retains originals and token maps in the local source', () => {
  const { state, local, structure } = fixture(); const job = entry(structure, 'Engineer A');
  const before = structuredClone({ state, local, structure });
  const result = applyCvOperations(local, structure, [operation(1, { type: 'omit_bullet', targetId: job.bulletIds[1] })], state);
  assert.equal(result.experience.jobs[0].bullets?.includes('private lab'), false);
  assert.deepEqual({ state, local, structure }, before);
  assert.ok(local.baselineState.experience.jobs[0].bullets?.includes('{{private lab}}'));
  assert.ok(local.bindings.some(binding => Object.values(binding.tokens).includes('{{private lab}}')));
  const missing = structuredClone(local);
  const binding = missing.bindings.find(item => Object.values(item.tokens).includes('{{private lab}}'))!;
  delete binding.tokens[Object.keys(binding.tokens).find(key => binding.tokens[key] === '{{private lab}}')!];
  assert.throws(() => applyCvOperations(missing, structure, [operation(1, { type: 'omit_bullet', targetId: job.bulletIds[1] })], state), /reconstruction mappings/);
});

test('operation selection is independent and rejects unknown or duplicate selection identifiers', () => {
  const { state, local, structure } = fixture(); const job = entry(structure, 'Engineer B');
  const operations = [operation(1, { type: 'reorder_bullets', targetId: job.id, order: [...job.bulletIds].reverse() }), operation(2, { type: 'omit_bullet', targetId: job.bulletIds[0] })];
  const none = applyCvOperations(local, structure, operations, state, []);
  assert.deepEqual(none, state); assert.notEqual(none, state);
  assert.equal(applyCvOperations(local, structure, operations, state, ['change-1']).experience.jobs[2].bullets, 'Published reproducible results.\nTested many robust sensors.');
  assert.equal(applyCvOperations(local, structure, operations, state, ['change-2']).experience.jobs[2].bullets, 'Published reproducible results.');
  assert.equal(applyCvOperations(local, structure, operations, state).experience.jobs[2].bullets, 'Published reproducible results.');
  assert.throws(() => applyCvOperations(local, structure, operations, state, ['change-9']), /unknown or duplicate/);
  assert.throws(() => applyCvOperations(local, structure, operations, state, ['change-1', 'change-1']), /unknown or duplicate/);
});

test('hidden and excluded entries stay fixed when reordering sidebar and custom-section entries', () => {
  const { state, local, structure } = fixture(); const languages = section(structure, 'Languages'); const skills = section(structure, 'Skills');
  const result = applyCvOperations(local, structure, [operation(1, { type: 'reorder_entries', targetId: languages.id, order: [...languages.entryIds].reverse() }), operation(2, { type: 'reorder_entries', targetId: skills.id, order: [...skills.entryIds].reverse() })], state);
  assert.deepEqual(result.languages.map(item => item.id), ['local-language-de', 'local-hidden-language', 'local-language-en']);
  assert.deepEqual(result.sidebarSections[1].items.map(item => item.id), ['local-rust', 'local-python']);
  assert.deepEqual(result.sidebarSections[0], state.sidebarSections[0]);
});

test('ambiguous bullet formatting is comments-only and never guessed into editable list structure', () => {
  const unsupported = ['- First\n  - Nested', '- First\ncontinuation line', '- First\n\n- Second', '- First\n* Mixed marker', '1. First\n2. Second', '- **Rich** text\n- Second', '  Indented content\nMore text', '- First\r\n- Second\n- Third', '- First {{private\n- nested}} content\n- Second'];
  for (const bullets of unsupported) {
    const state = createTestState({ experience: { jobs: [{ id: 'job', title: 'Job', bullets }] } });
    const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
    const field = local.publicRequest.fields.find(item => item.label === 'Experience 1: bullets')!;
    assert.equal(structure.bullets.length, 0, bullets);
    assert.ok(structure.unsupported.some(item => item.fieldId === field.id), bullets);
    const comment = { id: 'comment-1', fieldId: field.id, explanation: 'Simplify this formatting manually before structural refinement.' };
    assert.deepEqual(validateCvOperations([], [comment], structure, local.publicRequest.fields).comments, [comment]);
    assert.throws(() => validateCvOperations([operation(1, { type: 'omit_bullet', targetId: 'bullet-1' })], [], structure, local.publicRequest.fields), /unavailable/);
  }
});

test('dormant entry fields and custom fields excluded from the rendered layout remain comments-only', () => {
  const state = createTestState({
    experience: { jobs: [{ id: 'job', title: 'Job', desc: 'Dormant job description.', bullets: 'Visible useful work.' }] },
    education: [{ id: 'degree', title: 'Degree', desc: 'Dormant degree description.', bullets: 'Dormant degree bullets.' }],
    customSections: [
      { id: 'hidden-desc', name: 'Hidden description', fields: ['title'], entries: [{ id: 'entry-a', title: 'Visible title', desc: 'Hidden custom description.', bullets: 'Dormant custom bullets.' }] },
      { id: 'visible-desc', name: 'Visible description', fields: ['desc'], entries: [{ id: 'entry-b', desc: 'Visible useful custom description.', bullets: 'Dormant custom bullets.' }] },
      { id: 'textarea', name: 'Text area', entryMode: 'textarea', text: 'Visible useful text.', entries: [{ id: 'dormant-entry', desc: 'Dormant alternate mode.' }] },
    ],
    languages: [{ id: 'en', name: 'English', desc: 'Dormant language description.', bullets: 'Dormant language bullets.' }],
    bodyOrder: ['jobs', 'education', 'hidden-desc', 'visible-desc', 'textarea'],
  });
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
  const prose = structure.ranges.filter(range => !range.typoOnly);
  assert.deepEqual(prose.map(range => range.text), ['Visible useful work.', 'Visible useful custom description.', 'Visible useful text.']);
  const operations = prose.map((range, index) => operation(index + 1, { type: 'shorten_text', targetId: range.id, text: range.text.replace('useful ', '') }));
  const result = applyCvOperations(local, structure, operations, state);
  assert.equal(result.experience.jobs[0].desc, state.experience.jobs[0].desc);
  assert.deepEqual(result.education, state.education);
  assert.deepEqual(result.customSections[0], state.customSections[0]);
  assert.deepEqual(result.customSections[2].entries, state.customSections[2].entries);
  assert.deepEqual(result.languages, state.languages);
});

test('shortening is extractive, strictly shorter and limited to published prose ranges', () => {
  const { local, structure } = fixture(); const profile = structure.ranges.find(item => item.label === 'Profile')!;
  for (const text of [profile.text, '', 'I develop advanced robot sensing systems.', 'I DEVELOP robot sensing systems.', 'I develop robot sensing system.', 'systems. I develop robot sensing', `${profile.text} Extra`]) {
    assert.throws(() => validateCvOperations([operation(1, { type: 'shorten_text', targetId: profile.id, text })], [], structure, local.publicRequest.fields), /shorter|selection|rewrites/);
  }
  const title = local.publicRequest.fields.find(item => item.label === 'Experience 1: title')!;
  assert.throws(() => validateCvOperations([operation(1, { type: 'shorten_text', targetId: title.id, text: 'Engineer' })], [], structure, local.publicRequest.fields), /unavailable|comments only/);
  const good = operation(1, { type: 'shorten_text', targetId: profile.id, text: 'I develop robot sensing systems.' });
  assert.deepEqual(validateCvOperations([good], [], structure, local.publicRequest.fields).operations, [good]);
});

test('typo fixes support small spelling corrections without requiring shorter text', () => {
  for (const [before, after] of [
    ['Built reserach tools.', 'Built research tools.'],
    ['Studied teh results.', 'Studied the results.'],
    ['Gained experiance.', 'Gained experience.'],
    ['Ran succesfull experiments.', 'Ran successful experiments.'],
    ['Used succesfully tested tools.', 'Used successfully tested tools.'],
    ['Documented Reserach.', 'Documented Research.'],
    ['Präzise Messugnen.', 'Präzise Messungen.'],
    ['😀 Studied reserach.\n\tBuilt tools.', '😀 Studied research.\n\tBuilt tools.'],
  ]) {
    const state = createTestState({ about: { text: before } });
    const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
    const range = structure.ranges.find(item => item.label === 'Profile')!;
    const fix = operation(1, { type: 'fix_typos', targetId: range.id, text: after });
    assert.equal(applyCvOperations(local, structure, [fix], state).about.text, after);
    assert.equal(applyCvOperations(local, structure, [fix], state, []).about.text, before);
    assert.deepEqual(describeCvOperation(fix, structure), { target: range.label, before, after });
    assert.equal(state.about.text, before);
  }
});

test('ChatGPT can correct individual words in visible titles without changing the initial CV or allowing title shortening', () => {
  const state = createTestState({
    contact: { ...createTestState().contact, role: 'Reserach engineer' },
    sectionNames: { jobs: 'Reserach experience' },
    education: [{ id: 'degree', title: 'Experimantal physics' }],
    experience: { jobs: [{ id: 'job', title: 'Reserach assistant', bullets: 'Built reserach tools.' }] },
    customSections: [{ id: 'research', name: 'Reserach projects', entries: [{ id: 'project', title: 'Reserach methods' }] }],
    bodyOrder: ['jobs', 'education', 'research'],
  });
  const original = structuredClone(state);
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
  assert.deepEqual(state, original, 'preparation does not run spelling detection or modify content');
  assert.deepEqual(local.baselineState, original);
  const titles = structure.ranges.filter(range => range.typoOnly);
  assert.equal(titles.length, 6);
  const fixes = titles.map((range, index) => operation(index + 1, { type: 'fix_typos', targetId: range.id,
    text: range.text.replace('Reserach', 'Research').replace('Experimantal', 'Experimental') }));
  const result = applyCvOperations(local, structure, fixes, state);
  assert.equal(result.contact.role, 'Research engineer');
  assert.equal(result.sectionNames.jobs, 'Research experience');
  assert.equal(result.education[0].title, 'Experimental physics');
  assert.equal(result.experience.jobs[0].title, 'Research assistant');
  assert.equal(result.customSections[0].name, 'Research projects');
  assert.equal(result.customSections[0].entries[0].title, 'Research methods');
  assert.equal(result.experience.jobs[0].bullets, original.experience.jobs[0].bullets, 'only returned corrections apply');
  for (const range of titles) assert.throws(() => validateCvOperations([
    operation(1, { type: 'shorten_text', targetId: range.id, text: range.text.split(' ')[0] }),
  ], [], structure, local.publicRequest.fields), /Titles allow only/);
  assert.deepEqual(state, original);
});

test('title spelling capabilities exclude hidden headings, dormant titles, names and privacy replacements', () => {
  const state = createTestState({
    contact: { ...createTestState().contact, role: 'Reserach engineer' }, disabled: ['header'],
    anonymization: { excludedSections: [], excludedItems: [], fieldOverrides: { '["item","masked","title"]': 'Reserach position' } },
    sectionNames: { jobs: 'Hidden headding' }, sectionHeaderSizes: { jobs: 'null' },
    experience: { jobs: [
      { id: 'job', title: 'Public title', company: 'Reserach Institute' },
      { id: 'hidden', title: 'Hidden Reserach', hidden: true },
      { id: 'masked', title: 'Private original' },
    ] },
    customSections: [{ id: 'custom', name: 'Visible heading', fields: ['desc'], entries: [{ id: 'custom-item', title: 'Dormant Reserach', desc: 'Visible prose.' }] }],
    bodyOrder: ['jobs', 'custom'],
  });
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
  assert.deepEqual(structure.ranges.filter(range => range.typoOnly).map(range => range.text), ['Public title', 'Visible heading']);
  const marker = structuredClone(structure); Object.assign(marker.ranges.find(range => range.typoOnly)!, { typoOnly: false });
  assert.throws(() => validateCvStructure(marker, local.publicRequest.fields), /Invalid/);
  const expanded = structuredClone(structure); delete expanded.ranges.find(range => range.typoOnly)!.typoOnly;
  assert.throws(() => applyCvOperations(local, expanded, [], state), /does not match/);
});

test('previously published requests without title capabilities still reconstruct and apply their original ranges', () => {
  const { state, local } = fixture();
  const legacy = prepareCvStructure(local, { titleTypos: false });
  assert.ok(legacy.structure.ranges.every(range => !Object.hasOwn(range, 'typoOnly')));
  const profile = legacy.structure.ranges.find(range => range.label === 'Profile')!;
  const result = applyCvOperations(local, legacy.structure, [operation(1, { type: 'shorten_text', targetId: profile.id, text: 'I develop robot sensing systems.' })], state);
  assert.equal(result.about.text, 'I develop robot sensing systems.');
  assert.deepEqual(result.experience, state.experience);
});

test('typo fixes reject rewrites, factual numbers, changed formatting, links and private placeholders', () => {
  const state = createTestState({ about: { text: 'Built reserach tools in 2023 with {{private lab}}. See https://example.org/report.' } });
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
  const range = structure.ranges.find(item => item.label === 'Profile')!;
  const corrected = range.text.replace('reserach', 'research');
  const good = operation(1, { type: 'fix_typos', targetId: range.id, text: corrected });
  assert.equal(applyCvOperations(local, structure, [good], state).about.text, state.about.text.replace('reserach', 'research'));
  for (const text of [
    range.text, '', corrected.replace('tools', 'advanced tools'), corrected.replace('tools ', ''),
    corrected.replace('Built', 'Designed'), corrected.replace('research tools', 'tools research'),
    corrected.replace('2023', '2024'), corrected.replace(' ', '  '), corrected.replace('tools', 'tools\n'),
    corrected.replace('tools', '**tools**'), corrected.replace('report.', 'report!'),
    corrected.replace('https://example.org/report', 'https://example.org/reports'),
    corrected.replace('{{PRIVATE_1}}', '{{PRIVATE_2}}'), corrected.replace('{{PRIVATE_1}}', 'a laboratory'),
    corrected.replace('research', 'a'.repeat(65)),
  ]) assert.throws(() => validateCvOperations([{ ...good, text }], [], structure, local.publicRequest.fields), /typo|spelling|placeholders|links/i, text);
  const title = local.publicRequest.fields.find(item => item.label.includes('role'));
  assert.throws(() => validateCvOperations([{ ...good, targetId: title?.id || 'field-999' }], [], structure, local.publicRequest.fields), /unavailable|comments only/);
});

test('typo fixes compose with reordering and omissions while preserving private text and bullet formatting', () => {
  const state = createTestState({ experience: { jobs: [{ id: 'job', title: 'Researcher', bullets: '- Built reserach tools with {{private lab}}.  \r\n- Shared results.\r\n- Organized an event.\r\n' }] } });
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local);
  const job = structure.entries.find(item => item.label === 'Researcher')!;
  const range = structure.ranges.find(item => item.bulletId === job.bulletIds[0])!;
  const fix = operation(1, { type: 'fix_typos', targetId: range.id, text: range.text.replace('reserach', 'research') });
  const reorder = operation(2, { type: 'reorder_bullets', targetId: job.id, order: [...job.bulletIds].reverse() });
  const omit = operation(3, { type: 'omit_bullet', targetId: job.bulletIds[2] });
  const result = applyCvOperations(local, structure, [fix, reorder, omit], state);
  assert.equal(result.experience.jobs[0].bullets, '- Shared results.\r\n- Built research tools with {{private lab}}.  \r\n');
  assert.deepEqual(applyCvOperations(local, structure, [omit, reorder, fix], state), result);
  assert.equal(applyCvOperations(local, structure, [fix, reorder, omit], state, [fix.id]).experience.jobs[0].bullets, state.experience.jobs[0].bullets!.replace('reserach', 'research'));
  const shorten = operation(4, { type: 'shorten_text', targetId: range.id, text: range.text.replace('reserach ', '') });
  for (const conflict of [shorten, { ...omit, targetId: job.bulletIds[0] }, { ...fix, id: 'change-4' }]) {
    for (const operations of [[fix, conflict], [conflict, fix]]) {
      assert.throws(() => applyCvOperations(local, structure, operations, state, []), /Conflicting|omitted/);
    }
  }
});

test('shortening cannot remove, duplicate, rewrite or reorder private placeholders or links', () => {
  const state = createTestState({ about: { text: 'Worked with {{first secret}} and {{second secret}} on public [research](https://example.org).' } });
  const local = prepareCvAdjustment({ state, variantId: 'template' }); const { structure } = prepareCvStructure(local); const range = structure.ranges[0];
  const bad = [range.text.replace(/\{\{PRIVATE_1\}\}/, ''), range.text.replace('and {{PRIVATE_2}}', '{{PRIVATE_1}}'), range.text.replace('{{PRIVATE_1}}', '{{PRIVATE_3}}'),
    range.text.replace('{{PRIVATE_1}}', 'SWAP').replace('{{PRIVATE_2}}', '{{PRIVATE_1}}').replace('SWAP', '{{PRIVATE_2}}').replace('Worked ', ''),
    range.text.replace(' on public [research](https://example.org)', '')];
  for (const text of bad) assert.throws(() => validateCvOperations([operation(1, { type: 'shorten_text', targetId: range.id, text })], [], structure, local.publicRequest.fields), /placeholders|links|shorter/);
  const good = range.text.replace('Worked with ', '').replace(' on public', '');
  const result = applyCvOperations(local, structure, [operation(1, { type: 'shorten_text', targetId: range.id, text: good })], state);
  assert.equal(result.about.text, '{{first secret}} and {{second secret}} [research](https://example.org).');
});

test('complete permutations forbid adding, duplicating, dropping and moving items across containers', () => {
  const { local, structure } = fixture(); const body = structure.areas[0]; const sidebar = structure.areas[1]; const job = entry(structure, 'Engineer A'); const other = entry(structure, 'Engineer B');
  for (const order of [body.sectionIds.slice(1), [...body.sectionIds, 'section-999'], [...body.sectionIds.slice(1), body.sectionIds[1]], [sidebar.sectionIds[0], ...body.sectionIds.slice(1)]]) {
    assert.throws(() => validateCvOperations([operation(1, { type: 'reorder_sections', targetId: 'body', order })], [], structure, local.publicRequest.fields), /complete permutation/);
  }
  assert.throws(() => validateCvOperations([operation(1, { type: 'reorder_bullets', targetId: job.id, order: [other.bulletIds[0], ...job.bulletIds.slice(1)] })], [], structure, local.publicRequest.fields), /complete permutation/);
});

test('duplicate or conflicting operations are rejected even when a smaller subset was selected', () => {
  const { state, local, structure } = fixture(); const job = entry(structure, 'Engineer A'); const range = structure.ranges.find(item => item.bulletId === job.bulletIds[0])!;
  const omit = operation(1, { type: 'omit_bullet', targetId: job.bulletIds[0] });
  const shorten = operation(2, { type: 'shorten_text', targetId: range.id, text: 'Built robots.' });
  assert.throws(() => validateCvOperations([omit, { ...omit, id: 'change-2' }], [], structure, local.publicRequest.fields), /Conflicting/);
  assert.throws(() => validateCvOperations([omit, shorten], [], structure, local.publicRequest.fields), /shortened and omitted/);
  assert.throws(() => applyCvOperations(local, structure, [omit, shorten], state, ['change-1']), /shortened and omitted/);
  assert.throws(() => validateCvOperations([omit, { ...shorten, id: omit.id }], [], structure, local.publicRequest.fields), /duplicate/);
});

test('unknown keys, targets, operation types and malformed comments cannot alter structural capabilities', () => {
  const { local, structure } = fixture(); const field = local.publicRequest.fields[0];
  const operations: unknown[] = [
    { id: 'change-1', type: 'reorder_sections', targetId: 'body', order: structure.areas[0].sectionIds, explanation: 'Allowed.', path: ['contact'] },
    { id: 'change-1', type: 'replace_company', targetId: 'field-1', text: 'New company', explanation: 'Disallowed.' },
    operation(1, { type: 'reorder_entries', targetId: 'section-999', order: [] }),
    { id: 'change-1', type: 'omit_bullet', targetId: 'bullet-1', explanation: ' ' },
  ];
  for (const value of operations) assert.throws(() => validateCvOperations([value], [], structure, local.publicRequest.fields), /Invalid|Unknown|permutation/);
  for (const comment of [{ id: 'comment-1', fieldId: 'field-999', explanation: 'Unknown.' }, { id: 'comment-1', fieldId: field.id, explanation: 'x'.repeat(1001) }, { id: 'comment-1', fieldId: field.id, explanation: 'Fine.', text: 'Undeclared edit' }]) {
    assert.throws(() => validateCvOperations([], [comment], structure, local.publicRequest.fields), /comment/);
  }
});

test('public topology validates exact cross references and cannot inject local reconstruction paths', () => {
  const { local, structure } = fixture();
  const mutations: ((copy: CvStructure) => void)[] = [
    copy => { copy.areas[0].sectionIds[0] = 'section-999'; },
    copy => { copy.sections[0].area = 'sidebar'; },
    copy => { copy.entries[0].sectionId = 'section-999'; },
    copy => { copy.bullets[0].entryId = 'entry-999'; },
    copy => { copy.ranges[0].text = 'Substring only'; },
    copy => { copy.ranges.push({ ...copy.ranges[0], id: 'range-999' }); },
    copy => { copy.unsupported.push({ fieldId: copy.ranges[0].fieldId, reason: 'Conflicting capability' }); },
    copy => { Object.assign(copy.ranges[0], { path: ['contact', 'name'] }); },
    copy => { copy.ranges.find(range => range.bulletId)!.typoOnly = true; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(structure); mutate(copy); assert.throws(() => validateCvStructure(copy, local.publicRequest.fields), /Invalid|inconsistent/); }
});

test('stale local CVs and tampered public graphs are rejected before applying even an empty selection', () => {
  const { state, local, structure } = fixture();
  const changed = structuredClone(state); changed.contact.email = 'new@example.test';
  assert.throws(() => applyCvOperations(local, structure, [], changed, []), /CV changed/);
  const changedLayout = structuredClone(state); changedLayout.bodyOrder.reverse();
  assert.throws(() => applyCvOperations(local, structure, [], changedLayout, []), /CV changed/);
  const changedStructure = structuredClone(structure); changedStructure.sections[0].label = 'Invented display';
  assert.throws(() => applyCvOperations(local, changedStructure, [], state, []), /does not match/);
  const corrupt = structuredClone(local); corrupt.publicRequest.fields[0].text = 'Rewritten source field';
  assert.throws(() => prepareCvStructure(corrupt), /inconsistent/);
});

test('review descriptions expose actual old and proposed text or order for each selectable operation', () => {
  const { structure } = fixture(); const job = entry(structure, 'Engineer B'); const bullet = structure.bullets.find(item => item.id === job.bulletIds[0])!;
  assert.deepEqual(describeCvOperation(operation(1, { type: 'omit_bullet', targetId: bullet.id }), structure), { target: 'Engineer B', before: 'Tested many robust sensors.', after: '' });
  assert.deepEqual(describeCvOperation(operation(2, { type: 'reorder_bullets', targetId: job.id, order: [...job.bulletIds].reverse() }), structure), { target: 'Engineer B', before: 'Tested many robust sensors.\nPublished reproducible results.', after: 'Published reproducible results.\nTested many robust sensors.' });
  const range = structure.ranges.find(item => item.bulletId === bullet.id)!;
  assert.deepEqual(describeCvOperation(operation(3, { type: 'shorten_text', targetId: range.id, text: 'Tested sensors.' }), structure), { target: range.label, before: bullet.text, after: 'Tested sensors.' });
});
