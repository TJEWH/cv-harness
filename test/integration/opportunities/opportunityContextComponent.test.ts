import assert from 'node:assert/strict';

import test from 'node:test';

import { readFileSync } from 'node:fs';

import { createRequire } from 'node:module';

import { compileScript, parse } from '@vue/compiler-sfc';

import ts from 'typescript';

import { createRenderer, h, nextTick, reactive } from 'vue';

import type { Component } from 'vue';

import { livingStandardFixture } from '../../support/fixtures/livingStandard';

const filename = new URL('../../../src/features/opportunities/components/OpportunityContext.vue', import.meta.url);

const { descriptor } = parse(readFileSync(filename, 'utf8'));

const compiled = compileScript(descriptor, { id: 'opportunity-context-labels', inlineTemplate: true });

const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const exports: { default?: Component } = {};

new Function('require', 'exports', code)(createRequire(filename), exports);

test('living-standard verdicts and source icons are visible while assumptions use one disclosure', t => {
  const view = mountContext(undefined, { checklist: true, context: { salary: { amount: 3204 }, data: { living_standard: livingStandardFixture } } });
  t.after(view.unmount);
  const content = (node: HostNode): string => [node.text || '', ...node.children.map(content)].join('');
  const scores = view.nodes.filter(node => node.props.class === 'opportunity-context__living-standard');
  assert.equal(scores.length, 2);
  for (const score of scores) {
    assert.match(content(score.children[0]), /7\.2 \/ 10\.0 · Good · provisional/);
    assert.match(content(score.children.find(node => node.tag === 'p')!), /Salary verdict: 7\.5 \/ 10\.0 · Good/);
    const detail = score.children.find(node => node.tag === 'details')!;
    assert.equal(detail.children[0].tag, 'summary');
    assert.match(content(detail), /Baseline: /);
    assert.doesNotMatch(content(detail), /Salary verdict:/);
  }
  assert.equal(view.nodes.filter(node => node.tag === 'input').length, 0);
  const source = view.nodes.find(node => node.tag === 'a' && node.props.href === livingStandardFixture.sources[0].url)!;
  assert.equal(source.props.rel, 'noopener noreferrer');
  assert.equal(source.props.class, 'opportunity-context__source-link');
  assert.match(String(source.props['aria-label']), /Open source/);
  for (let parent = source.parent; parent; parent = parent.parent) {
    if (parent.tag === 'details') assert.ok(String(parent.props.class).includes('opportunity-context__group'), 'source is outside the assessment breakdown');
  }
});

type HostNode = { tag?: string; text?: string; props: Record<string, unknown>; parent?: HostNode; children: HostNode[] };

function mountContext(onlyGroups?: ['documents'], overrides: Record<string, unknown> = {}) {
  const nodes: HostNode[] = [];
  const createNode = (tag?: string, text?: string): HostNode => {
    const node: HostNode = { tag, text, props: {}, children: [] };
    nodes.push(node);
    return node;
  };
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: (tag) => createNode(tag), createText: (text) => createNode(undefined, text), createComment: () => createNode(),
    insert(node, parent) { node.parent = parent; parent.children.push(node); },
    remove(node) { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); },
    setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
    patchProp(node, key, _previous, value) { node.props[key] = value; },
    parentNode: (node) => node.parent || null, nextSibling: () => null,
  });
  const context = { metadata_schema_version: 6,
    requirements: [
      { entity_id: 'degree', text: 'Relevant MSc', status: 'required', stage: 'recruitment' },
      { entity_id: 'programming', text: 'Programming', status: 'preferred', stage: 'recruitment', conditions: ['Python', 'C++'], source_urls: ['https://example.org/requirements'] },
    ],
    required_documents: [
      { entity_id: 'cv', text: 'CV', status: 'required', stage: 'recruitment' },
      { entity_id: 'transcript', text: 'Transcript', status: 'required', stage: 'recruitment', source_urls: ['https://example.org/transcript-template'] },
    ],
  };
  const changes: { key: string; completed: boolean }[] = [];
  const props = reactive({ context, lang: 'en', checklist: true, completedKeys: [] as string[], saving: false, onlyGroups, ...overrides });
  const app = renderer.createApp({ render: () => h('main', [
    h(exports.default!, { ...props, onToggleChecklist: (key: string, completed: boolean) => changes.push({ key, completed }) }),
    h(exports.default!, { ...props }),
  ]) });
  app.mount(createNode('root'));
  return { nodes, changes, props, unmount: () => app.unmount() };
}

test('checklist labels identify their own inputs across repeated contexts and preserve external links', async (t) => {
  const context = mountContext();
  t.after(context.unmount);
  const inputs = context.nodes.filter((node) => node.tag === 'input' && node.props.type === 'checkbox');
  const labels = context.nodes.filter((node) => node.tag === 'label');
  assert.equal(inputs.length, 8);
  assert.equal(new Set(inputs.map((node) => node.props.id)).size, inputs.length, 'duplicate displayed contexts must not share control IDs');
  assert.ok(labels.length >= inputs.length, 'every canonical checklist input has its own label');
  for (const label of labels) assert.equal(inputs.filter((node) => node.props.id === label.props.for).length, 1);
  for (const input of inputs) assert.ok(labels.some((node) => node.props.for === input.props.id), 'every checkbox has an associated visible label, including link-only entries');
  const mscLabel = labels.find((node) => node.text === 'Relevant MSc')!;
  const mscInput = inputs.find((node) => node.props.id === mscLabel.props.for)!;
  assert.ok(context.nodes.some(node => node.text === 'Python'));
  assert.ok(context.nodes.some(node => node.text === 'C++'));

  for (const link of context.nodes.filter((node) => node.tag === 'a')) {
    assert.ok(['https://example.org/requirements', 'https://example.org/transcript-template'].includes(String(link.props.href)));
    assert.equal(link.props.target, '_blank');
    for (let ancestor: HostNode | undefined = link; ancestor; ancestor = ancestor.parent) {
      assert.notEqual(ancestor.tag, 'label', 'links are independent interactive elements');
      assert.equal(ancestor.props.onClick, undefined, 'checklist row does not intercept external-link clicks');
    }
  }
  const target = { checked: true };
  (mscInput.props.onChange as (event: unknown) => void)({ target });
  assert.equal(context.changes.length, 1);
  assert.equal(context.changes[0].completed, true);
  assert.equal(target.checked, false, 'checkbox keeps saved state until the parent acknowledges the change');
  context.props.completedKeys = [context.changes[0].key];
  context.props.saving = true;
  await nextTick();
  assert.equal(mscInput.props.checked, true);
  assert.equal(mscInput.props.disabled, true);
});

test('PDF review shows only application documents and shares their saved checklist identities', async t => {
  const context = mountContext(['documents']); t.after(context.unmount);
  const inputs = context.nodes.filter(node => node.tag === 'input');
  assert.equal(inputs.length, 4, 'Two document entries appear in each displayed context');
  assert.ok(!context.nodes.some(node => node.tag === 'label' && node.text === 'Relevant MSc'));
  const label = context.nodes.find(node => node.tag === 'label' && node.text === 'CV')!;
  const input = inputs.find(node => node.props.id === label.props.for)!;
  (input.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  const key = context.changes[0].key;
  assert.match(key, /required_documents/);
  context.props.completedKeys = [key]; await nextTick();
  assert.equal(inputs.filter(node => node.props.checked).length, 2, 'Both views reflect the same saved document confirmation');
});

test('canonical opportunity renders each person once, all checklist statuses, and no storage identities', async t => {
  const { canonicalOpportunityFixture, canonicalChecklistStatuses } = await import('../../support/fixtures/canonicalOpportunity');
  const fixture = canonicalOpportunityFixture();
  for (const lang of ['en', 'de']) {
    const view = mountContext(undefined, { context: fixture, lang, checklist: true });
    t.after(view.unmount);
    const text = (node: HostNode): string => [node.text || '', ...node.children.map(text)].join(' ');
    const tables = view.nodes.filter(node => node.tag === 'table');
    const rows = tables.flatMap(node => node.children.filter(child => child.tag === 'tbody').flatMap(body => body.children));
    for (const field of ['Qualification', 'Document']) for (const status of canonicalChecklistStatuses) {
      assert.equal(rows.filter(row => text(row).includes(`${field} ${status}`)).length, 2, `${field} ${status} appears once per view`);
    }
    const unspecified = rows.filter(row => text(row).includes('Document unspecified'));
    assert.ok(unspecified.every(row => text(row.children[1]).includes(lang === 'de' ? 'Nicht angegeben' : 'Not specified')));
    const inputs = view.nodes.filter(node => node.tag === 'input');
    assert.equal(inputs.length, 32, 'Only the 8 requirements and 8 documents become tasks in each of two views');
    assert.ok(!inputs.some(node => String(node.props['aria-label']).includes('Portal submission')));
    const names = view.nodes.filter(node => node.tag === 'dt' && text(node).trim() === 'Dr. Alex Example');
    assert.equal(names.length, 2, 'The contact is not repeated for their email and source URL');
    assert.equal(view.nodes.filter(node => node.tag === 'a' && node.props.href === 'mailto:alex@example.invalid').length, 2);
    const sourceIcons = view.nodes.filter(node => node.tag === 'a' && node.props.class === 'opportunity-context__source-link');
    assert.ok(sourceIcons.length > 0);
    assert.ok(sourceIcons.every(node => String(node.props['aria-label']).includes(lang === 'de' ? 'Quelle öffnen' : 'Open source')));
    const rendered = JSON.stringify(view.nodes.map(node => ({ text: node.text, props: node.props })));
    for (const hidden of ['INTERNAL-', fixture.id, 'Entity ID', 'Source ID', 'Researcher ID', 'Record format version']) assert.ok(!rendered.includes(hidden), hidden);
    assert.ok(rendered.includes('PUBLIC-VACANCY-2027'));
  }
});

test('canonical requirement status and stage have their own cells while limits and evidence stay with the item', async t => {
  const { canonicalOpportunityFixture } = await import('../../support/fixtures/canonicalOpportunity');
  const fixture = canonicalOpportunityFixture();
  const view = mountContext(undefined, { context: fixture, checklist: true }); t.after(view.unmount);
  const content = (node: HostNode): string => [node.text || '', ...node.children.map(content)].join(' ');
  const tables = view.nodes.filter(node => node.tag === 'table');
  assert.equal(tables.length, 4);
  for (const table of tables) {
    const header = table.children.find(child => child.tag === 'thead')!.children.find(child => child.tag === 'tr')!;
    assert.deepEqual(header.children.map(child => child.text), ['Item', 'Status', 'Stage']);
  }
  const row = view.nodes.find(node => node.tag === 'tr' && node.children[0] && content(node.children[0]).includes('Document required'))!;
  assert.equal(content(row.children[1]).trim(), 'Required');
  assert.equal(content(row.children[2]).trim(), 'Recruitment');
  assert.match(content(row.children[0]), /400 words maximum/);
  assert.doesNotMatch(content(row.children[1]), /source|400|Recruitment/);
  assert.ok(!view.nodes.some(node => node.tag === 'details' && node.props.class === 'opportunity-context__evidence'));
  const iconSources = view.nodes.filter(node => node.tag === 'a' && node.props.class === 'opportunity-context__source-link');
  assert.ok(iconSources.length > 0);
  for (const source of iconSources) {
    assert.match(String(source.props['aria-label']), /Open source/);
    assert.ok(source.children.some(child => child.tag === 'svg'), 'source links use the shared icon library');
    for (let parent = source.parent; parent; parent = parent.parent) assert.notEqual(parent.tag, 'label', 'opening a source cannot toggle a checklist input');
  }
  const sources = view.nodes.filter(node => node.tag === 'a' && node.props.href === fixture.official_url);
  assert.ok(sources.length > 0);
  assert.ok(sources.every(node => node.props.rel === 'noopener noreferrer'));
  const rendered = JSON.stringify(view.nodes.map(node => ({ text: node.text, props: node.props })));
  for (const storageLabel of ['Source urls', 'Supports', 'Identity verified', 'Role verified', 'Profiles']) assert.ok(!rendered.includes(storageLabel), storageLabel);
});

test('canonical optional rows keep the same saved checkbox key after acknowledgement', async t => {
  const view = mountContext(undefined, { context: { metadata_schema_version: 6, requirements: [
    { entity_id: 'degree', text: 'MSc', status: 'required', stage: 'recruitment' },
    { entity_id: 'python', text: 'Python', status: 'optional', stage: 'recruitment' },
  ] } });
  t.after(view.unmount);
  const inputs = view.nodes.filter(node => node.tag === 'input');
  assert.equal(inputs.length, 4);
  const input = inputs[1], target = { checked: true };
  (input.props.onChange as (event: unknown) => void)({ target });
  assert.equal(target.checked, false);
  assert.equal(view.changes[0].key, 'requirements:requirements:{"stage":"recruitment","status":"optional","text":"Python"}');
  view.props.completedKeys = [view.changes[0].key];
  view.props.saving = true;
  await nextTick();
  assert.equal(input.props.checked, true);
  assert.equal(input.props.disabled, true);
});

test('preserved tender wording stays visible as a canonical note without inventing a checklist status', t => {
  const view = mountContext(undefined, { checklist: false, context: { metadata_schema_version: 6,
    requirements: [{ entity_id: 'background', text: 'Background in robotics and ML/AI', status: 'unspecified', stage: 'recruitment', notes: [{ label: 'Importance', text: 'plus' }] }],
    required_documents: [{ entity_id: 'portfolio', text: 'Portfolio', status: 'unspecified', stage: 'recruitment', notes: [{ label: 'Importance', text: 'plus' }] }],
  } });
  t.after(view.unmount);
  const content = (node: HostNode): string => [node.text || '', ...node.children.map(content)].join(' ');
  const rows = view.nodes.filter(node => node.tag === 'tr' && node.children.some(child => child.tag === 'td'));
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.match(content(row.children[0]), /plus/);
    assert.match(content(row.children[1]), /Not specified/);
  }
  assert.equal(view.nodes.filter(node => node.tag === 'input').length, 0);
});
