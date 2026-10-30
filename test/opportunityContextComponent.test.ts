import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import { livingStandardFixture } from './fixtures/livingStandard';

const filename = new URL('../src/features/opportunities/components/OpportunityContext.vue', import.meta.url);
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
  const context = { requirements: ['Relevant MSc', { requirement: 'Programming', details: ['Python', 'C++'], url: 'https://example.org/requirements' }], required_documents: ['CV', 'https://example.org/transcript-template'] };
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
  assert.ok(labels.length > inputs.length, 'nested requirement details also label the parent checkbox');
  for (const label of labels) assert.equal(inputs.filter((node) => node.props.id === label.props.for).length, 1);
  for (const input of inputs) assert.ok(labels.some((node) => node.props.for === input.props.id), 'every checkbox has an associated visible label, including link-only entries');
  const mscLabel = labels.find((node) => node.text === 'Relevant MSc')!;
  const mscInput = inputs.find((node) => node.props.id === mscLabel.props.for)!;
  const programmingLabel = labels.find((node) => node.text === 'Programming')!;
  assert.equal(labels.find((node) => node.text === 'Python')?.props.for, programmingLabel.props.for);
  assert.equal(labels.find((node) => node.text === 'C++')?.props.for, programmingLabel.props.for);

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

test('requirements render as accessible tables without redundant field subheaders in either language', async t => {
  for (const lang of ['en', 'de']) {
    const view = mountContext(undefined, { lang, checklist: false, context: {
      requirements: [{ item: 'MSc', category: 'required' }, { item: 'Python', category: 'beneficial' }, { requirement: 'German', required: false }, 'Experience'],
      required_documents: ['CV', { document: 'Portfolio', type: 'optional' }], eligibility: ['Enrolled student'],
    } });
    t.after(view.unmount);
    const tables = view.nodes.filter(node => node.tag === 'table');
    assert.equal(tables.length, 4, 'requirements and application documents each have one table per rendered instance');
    for (const table of tables) {
      const header = table.children.find(node => node.tag === 'thead')!.children.find(node => node.tag === 'tr')!;
      assert.deepEqual(header.children.filter(node => node.tag === 'th').map(node => node.text), [lang === 'de' ? 'Eintrag' : 'Item', 'Status']);
      for (const row of table.children.find(node => node.tag === 'tbody')!.children) {
        assert.equal(row.children.filter(node => node.tag === 'td').length, 2, 'every item has a status cell');
      }
    }
    const cells = view.nodes.filter(node => node.tag === 'td');
    for (const status of [lang === 'de' ? 'Erforderlich' : 'Required', lang === 'de' ? 'Von Vorteil' : 'Beneficial', 'Optional', lang === 'de' ? 'Nicht angegeben' : 'Not specified']) {
      assert.ok(cells.some(node => node.children.some(child => child.text === status)));
    }
    assert.ok(view.nodes.some(node => node.tag === 'span' && node.text?.startsWith('MSc')));
    const fieldLabels = view.nodes.filter(node => node.tag === 'dt').map(node => node.text);
    assert.ok(view.nodes.some(node => node.tag === 'span' && node.text === (lang === 'de' ? 'Zulassungsvoraussetzungen' : 'Eligibility')));
    assert.ok(!fieldLabels.includes(lang === 'de' ? 'Anforderungen' : 'Requirements'));
    assert.ok(!fieldLabels.includes(lang === 'de' ? 'Erforderliche Unterlagen' : 'Required documents'));
    assert.equal(view.nodes.filter(node => node.tag === 'input').length, 0);
    assert.equal(view.nodes.filter(node => node.tag === 'ul').length, 0, 'item/status pairs must not fall back to nested bullet lists');
  }
});

test('nested source values appear only in the status cell and retain their exact wording', t => {
  const view = mountContext(undefined, { checklist: false, context: {
    requirements: {
      degree: 'Required; equivalent experience also considered',
      programming: ['Beneficial for this project'],
    },
    application_documents: [{ item: 'Portfolio', value: 'Optional — links to previous projects are welcome' }],
  } });
  t.after(view.unmount);
  const content = (node: HostNode): string => [node.text || '', ...node.children.map(content)].join('');
  const rows = view.nodes.filter(node => node.tag === 'tr' && node.children.some(child => child.tag === 'td'));
  for (const [item, value] of [
    ['Degree', 'Required; equivalent experience also considered'],
    ['Programming', 'Beneficial for this project'],
    ['Portfolio', 'Optional — links to previous projects are welcome'],
  ]) {
    const row = rows.find(row => content(row.children[0]) === item)!;
    assert.ok(row, `${item} must be the only content in its item cell`);
    assert.equal(content(row.children[1]), value, `${value} belongs verbatim in the status cell`);
    assert.ok(!content(row.children[1]).includes('Not specified'));
  }
  assert.equal(view.nodes.filter(node => node.tag === 'ul').length, 0);
});

test('the supplied Importance: plus example is rendered as an item and a bare status value', t => {
  const item = 'Background in wireless communications, robotics, optimization and ML/AI';
  const view = mountContext(undefined, { checklist: false, context: {
    requirements: [{ requirement: item, importance: 'plus' }],
    required_documents: [{ document: 'Portfolio', importance: 'plus' }],
  } });
  t.after(view.unmount);
  const content = (node: HostNode): string => [node.text || '', ...node.children.map(content)].join('');
  const rows = view.nodes.filter(node => node.tag === 'tr' && node.children.some(child => child.tag === 'td'));
  assert.deepEqual(rows.map(row => row.children.map(content)), [[item, 'plus'], ['Portfolio', 'plus'], [item, 'plus'], ['Portfolio', 'plus']]);
  assert.equal(view.nodes.filter(node => node.tag === 'ul').length, 0);
});

test('required/optional table rows keep their saved checkboxes when completion is acknowledged', async t => {
  const view = mountContext(undefined, { context: { requirements: { required: ['MSc'], optional: [{ requirement: 'Python', required: false }] } } });
  t.after(view.unmount);
  const inputs = view.nodes.filter(node => node.tag === 'input');
  assert.equal(inputs.length, 4);
  const input = inputs[1];
  const target = { checked: true };
  (input.props.onChange as (event: unknown) => void)({ target });
  assert.equal(target.checked, false);
  assert.equal(view.changes[0].key, 'requirements:requirements.optional:{"required":false,"requirement":"Python"}');
  view.props.completedKeys = [view.changes[0].key];
  view.props.saving = true;
  await nextTick();
  assert.equal(inputs.filter(node => node.props.checked).length, 2);
  assert.ok(inputs.every(node => node.props.disabled));
});

test('canonical opportunity renders each person once, all checklist statuses, and no storage identities', async t => {
  const { canonicalOpportunityFixture, canonicalChecklistStatuses } = await import('./fixtures/canonicalOpportunity');
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
  const { canonicalOpportunityFixture } = await import('./fixtures/canonicalOpportunity');
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
