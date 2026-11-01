import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';

interface HostNode {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
}
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [], parent: null });
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  setText(child, text) { child.text = text; },
  setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _previous, value) { child.props[key] = value; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const filename = new URL('../../../src/features/refinement/components/RefinementChangeReview.vue', import.meta.url);
const { descriptor } = parse(readFileSync(filename, 'utf8'));
const compiled = compileScript(descriptor, { id: 'refinement-change-review-test', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
new Function('require', 'exports', code)(createRequire(filename), componentExports);

interface Change {
  id: string; type: string; target: string; explanation: string; before: string; after: string;
  status: 'proposed' | 'accepted' | 'rejected';
}
const changes: Change[] = [
  { id: 'change-1', type: 'shorten_text', target: 'Research experience · bullet 1', explanation: 'Keep the relevant measurement work concise.', before: 'Developed and carefully tested measurement instruments.', after: 'Developed measurement instruments.', status: 'proposed' },
  { id: 'change-2', type: 'reorder_sections', target: 'Main CV sections', explanation: 'Put the existing research experience first.', before: 'Education\nResearch experience', after: 'Research experience\nEducation', status: 'accepted' },
  { id: 'change-3', type: 'omit_bullet', target: 'Other experience · bullet 2', explanation: 'Remove an unrelated activity from this application.', before: 'Organized a social event.', after: '', status: 'rejected' },
];
function findAll(root: HostNode, predicate: (child: HostNode) => boolean): HostNode[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => findAll(child, predicate))];
}
function required(root: HostNode, predicate: (child: HostNode) => boolean) {
  const result = findAll(root, predicate)[0]; assert.ok(result, 'Expected rendered element to exist.'); return result;
}
function content(child: HostNode): string { return child.tag === '#comment' ? '' : child.text + child.children.map(content).join(''); }
function hasClass(child: HostNode, value: string) { return String(child.props.class || '').split(/\s+/).includes(value); }
function mount(t: TestContext) {
  const props = reactive({ changes: structuredClone(changes), selected: ['change-1', 'change-2'], comments: [] as { id: string; target: string; explanation: string }[], lang: 'en', disabled: false, locked: false });
  const toggles: [string, boolean][] = [];
  let accepted = 0;
  const root = node('root');
  const app = renderer.createApp({ render: () => h(componentExports.default!, { ...props, onToggle: (id: string, included: boolean) => { toggles.push([id, included]); }, onAccept: () => { accepted++; } }) });
  app.mount(root); t.after(() => app.unmount());
  const change = (id: string) => required(root, item => item.props['data-change-id'] === id);
  return { props, root, toggles, change, accepted: () => accepted };
}

test('each rendered operation has its target, type, explanation, labelled checkbox and changelog status', (t) => {
  const { root, change } = mount(t);
  assert.equal(required(root, item => item.tag === 'section').props['aria-label'], 'CV change review');
  const expectedStatuses = ['Active', 'Active', 'Inactive'];
  changes.forEach((value, index) => {
    const row = change(value.id);
    const label = required(row, item => item.tag === 'label');
    const checkbox = required(label, item => item.tag === 'input');
    assert.equal(checkbox.props.type, 'checkbox');
    assert.ok(content(label).includes(`Activate ${value.id} · ${value.target}`), 'the wrapping label gives the checkbox a descriptive accessible name');
    assert.equal(content(required(row, item => item.tag === 'code')), value.type);
    assert.ok(content(row).includes(value.explanation));
    assert.equal(content(required(row, item => hasClass(item, 'badge'))), expectedStatuses[index]);
  });
});

test('shortening shows complete before and after text, and omissions have an explicit visible result', (t) => {
  const { change } = mount(t);
  const row = change('change-1');
  assert.equal(required(row, item => hasClass(item, 'comparison')).props['aria-label'], 'Before and after comparison');
  assert.equal(content(required(row, item => hasClass(item, 'before'))), changes[0].before);
  assert.equal(content(required(row, item => hasClass(item, 'after'))), changes[0].after);
  assert.equal(content(required(change('change-3'), item => hasClass(item, 'after'))), '(Omitted from this application)');
});

test('typo corrections show their original spelling, replacement and activation control', async (t) => {
  const { props, change, toggles } = mount(t);
  props.changes = [{ ...changes[0], type: 'fix_typos', before: 'Built reserach tools.', after: 'Built research tools.', explanation: 'Correct the spelling of research.' }];
  await nextTick();
  const row = change('change-1');
  assert.equal(content(required(row, item => hasClass(item, 'before'))), 'Built reserach tools.');
  assert.equal(content(required(row, item => hasClass(item, 'after'))), 'Built research tools.');
  const checkbox = required(row, item => item.tag === 'input');
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  assert.deepEqual(toggles, [['change-1', false]]);
});

test('checkbox toggles emit preview selection only and never accept or mutate a change', async (t) => {
  const { props, root, toggles, change, accepted } = mount(t);
  const before = structuredClone({ changes: changes, selected: [...props.selected] });
  const checkbox = required(change('change-1'), item => item.tag === 'input');
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  await nextTick();
  assert.deepEqual(toggles, [['change-1', false]]);
  assert.equal(accepted(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(props.changes)), before.changes);
  assert.deepEqual([...props.selected], before.selected, 'selection state is controlled by the parent');
  assert.doesNotMatch(content(root), /Accept selection/, 'change details must not describe a removed acceptance action');
  assert.equal(content(required(change('change-1'), item => hasClass(item, 'badge'))), 'Active');
  props.selected = ['change-2'];
  await nextTick();
  assert.equal(required(change('change-1'), item => item.tag === 'input').props.checked, false);
  assert.equal(required(change('change-2'), item => item.tag === 'input').props.checked, true);
});

test('busy and locked review controls disable every checkbox without changing selection or status', async (t) => {
  const { props, root } = mount(t);
  props.disabled = true; await nextTick();
  assert.ok(findAll(root, item => item.tag === 'input').every(item => item.props.disabled === true));
  props.disabled = false; props.locked = true; await nextTick();
  assert.ok(findAll(root, item => item.tag === 'input').every(item => item.props.disabled === true));
  assert.deepEqual([...props.selected], ['change-1', 'change-2']);
  props.locked = false; await nextTick();
  assert.ok(findAll(root, item => item.tag === 'input').every(item => item.props.disabled === false));
});

test('unsupported content remains a manual-review comment without an acceptance checkbox', async (t) => {
  const { props, root } = mount(t);
  props.changes = [];
  props.comments = [{ id: 'comment-1', target: 'Research profile', explanation: 'Confirm evidence for this claim before editing it manually.' }];
  await nextTick();
  const comment = required(root, item => hasClass(item, 'comment'));
  assert.ok(content(comment).includes('Comment — manual review · Research profile'));
  assert.ok(content(comment).includes(props.comments[0].explanation));
  assert.equal(findAll(comment, item => item.tag === 'input' || item.tag === 'button').length, 0);
  assert.equal(findAll(root, item => item.tag === 'input').length, 0);
  assert.ok(content(root).includes('No CV changes proposed.'));
});

test('German review labels remain accessible', async (t) => {
  const { props, root, change } = mount(t);
  props.lang = 'de'; await nextTick();
  assert.equal(required(root, item => item.tag === 'section').props['aria-label'], 'Prüfung der CV-Änderungen');
  assert.ok(content(required(change('change-1'), item => item.tag === 'label')).includes('Aktivieren change-1'));
  assert.equal(content(required(change('change-1'), item => hasClass(item, 'badge'))), 'Aktiv');
});
