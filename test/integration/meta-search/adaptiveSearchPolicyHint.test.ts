import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, type Component } from 'vue';
import { DEFAULT_ADAPTIVE_SEARCH_POLICY } from '../../../src/features/meta-search/domain/adaptiveSearchPlanner';

const filename = new URL('../../../src/features/meta-search/components/AdaptiveSearchPolicyHint.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(filename, 'utf8')).descriptor, { id: 'adaptive-search-policy-hint', inlineTemplate: true });
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentExports: { default?: Component } = {};
const requireComponent = createRequire(filename);
const InfoHint = defineComponent({ props: ['label', 'text', 'lang'], setup: props => () => h('button', {
  type: 'button', 'aria-label': `${props.lang === 'de' ? 'Informationen' : 'Information'}: ${props.label}`, 'data-help': props.text,
}) });
new Function('require', 'exports', code)((path: string) => path.endsWith('.vue') ? { default: InfoHint } : requireComponent(path), componentExports);
type HostNode = { tag?: string; text?: string; props: Record<string, unknown>; children: HostNode[]; parent?: HostNode };
const node = (tag?: string, text?: string): HostNode => ({ tag, text, props: {}, children: [] });
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node(undefined, text), createComment: () => node(),
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
  setText(node, value) { node.text = value; }, setElementText(node, value) { node.text = value; },
  patchProp(node, key, _previous, value) { node.props[key] = value; }, parentNode: node => node.parent ?? null, nextSibling: () => null,
});
const descendants = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(descendants)];
function mount(t: TestContext) {
  const props = reactive({ lang: 'en', policy: undefined as undefined | { minimum_observations: number; exploration_ratio: number; maximum_queries: number; minimum_exploration_queries: number; positive_interest_threshold?: number } });
  const root = node('root');
  const app = renderer.createApp({ render: () => h(componentExports.default!, props) });
  app.mount(root); t.after(() => app.unmount());
  return { props, help: () => String(descendants(root).find(value => value.tag === 'button')!.props['data-help']),
    label: () => descendants(root).find(value => value.tag === 'button')!.props['aria-label'], root };
}

test('policy help keeps the rating thresholds and query limits concise', t => {
  const view = mount(t), policy = DEFAULT_ADAPTIVE_SEARCH_POLICY, help = view.help();
  assert.equal(view.label(), 'Information: Adaptive search policy');
  assert.match(help, new RegExp(`at least ${policy.minimum_observations} distinct reviewed opportunities`));
  assert.ok(help.includes(new Intl.NumberFormat('en', { style: 'percent' }).format(policy.exploration_ratio)));
  assert.ok(help.includes(`at least ${policy.minimum_exploration_queries} when space allows`));
  assert.ok(help.includes(`${policy.maximum_queries} queries per run`));
  assert.ok(help.includes(`average ${policy.positive_interest_threshold}/10`));
  assert.match(help, /smaller or conflicting samples remain provisional/);
  assert.ok(help.length < 400, 'keep the policy hint short enough to scan');
  assert.deepEqual(descendants(view.root).filter(value => ['textarea', 'input', 'select'].includes(value.tag ?? '')), [], 'policy help does not add editor or workflow controls');
});

test('German policy help updates in place and reflects supplied policy values instead of duplicating defaults', async t => {
  const view = mount(t); view.props.lang = 'de';
  view.props.policy = { minimum_observations: 5, exploration_ratio: 0.25, maximum_queries: 18, minimum_exploration_queries: 2, positive_interest_threshold: 7.5 };
  await nextTick();
  assert.equal(view.label(), 'Informationen: Adaptive Suchstrategie');
  assert.match(view.help(), /mindestens 5 unterschiedliche Stellen/);
  assert.match(view.help(), /25\s*%/);
  assert.match(view.help(), /mindestens 2 bei freier Kapazität/);
  assert.match(view.help(), /höchstens 18 Abfragen/);
  assert.match(view.help(), /im Mittel 7,5\/10/);
  assert.match(view.help(), /vorläufig/);
  assert.doesNotMatch(view.help(), /automatic priority|30-query|20%/);
  assert.match(view.help(), /^Deine Bewertungen/);
});

test('zero breadth explicitly turns exploration off without inventing a minimum query', async t => {
  const view = mount(t);
  view.props.policy = { ...DEFAULT_ADAPTIVE_SEARCH_POLICY, exploration_ratio: 0, minimum_exploration_queries: 0 };
  await nextTick();
  assert.match(view.help(), /Exploration is off;/);
  assert.doesNotMatch(view.help(), /at least 0 when capacity|reserve 0%/);
  view.props.lang = 'de'; await nextTick();
  assert.match(view.help(), /Neue Suchrichtungen sind ausgeschaltet/);
  assert.doesNotMatch(view.help(), /mindestens 0/);
});

test('a supplied policy without the newer threshold retains the shared positive-interest convention', async t => {
  const view = mount(t);
  view.props.policy = { minimum_observations: 4, exploration_ratio: 0.1, maximum_queries: 20, minimum_exploration_queries: 1 };
  await nextTick();
  assert.ok(view.help().includes(`average ${DEFAULT_ADAPTIVE_SEARCH_POLICY.positive_interest_threshold}/10`));
  assert.doesNotMatch(view.help(), /undefined|NaN/);
});
