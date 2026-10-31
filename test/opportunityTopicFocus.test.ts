import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityTopicFocus } from '../src/features/opportunities/domain/opportunityTopicFocus';

const sorted = (value: Set<string> | null) => value ? [...value].sort() : null;

test('selection keeps direct observed and wording neighbors while muting unrelated topics', () => {
  const nodes = ['topic:acoustics', 'topic:sensing', 'topic:audio', 'topic:materials'];
  const links = [
    { source: 'topic:acoustics', target: 'topic:sensing', kind: 'cooccurrence' },
    { source: 'topic:audio', target: 'topic:acoustics', kind: 'semantic' },
  ];
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, ['topic:acoustics'])),
    ['topic:acoustics', 'topic:audio', 'topic:sensing']);
});

test('focus does not spread transitively through a connected field', () => {
  const nodes = ['a', 'b', 'c', 'd'];
  const links = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }];
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, ['a'])), ['a', 'b']);
});

test('multiple selections union their direct neighborhoods and retain isolated selections', () => {
  const nodes = new Set(['a', 'b', 'c', 'd', 'isolated', 'unrelated']);
  const links = [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }];
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, new Set(['a', 'd', 'isolated']))),
    ['a', 'b', 'c', 'd', 'isolated']);
});

test('clearing selection or selecting only hidden topics restores the full unmuted view', () => {
  const nodes = ['a', 'b'];
  const links = [{ source: 'a', target: 'b' }];
  assert.equal(opportunityTopicFocus(nodes, links, []), null);
  assert.equal(opportunityTopicFocus(nodes, links, ['hidden']), null);
  assert.equal(opportunityTopicFocus([], links, ['a']), null);
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, ['hidden', 'a'])), ['a', 'b']);
});

test('invalid endpoints, self links and repeated selections cannot introduce invisible nodes', () => {
  const nodes = ['a', 'a', 'b', 'c'];
  const links = [{ source: 'a', target: 'missing' }, { source: 'missing', target: 'b' },
    { source: 'a', target: 'a' }, { source: 'a', target: 'b' }, { source: 'a', target: 'b' }];
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, ['a', 'a', 'missing'])), ['a', 'b']);
});

test('deriving focus does not mutate input evidence or selection collections', () => {
  const nodes = Object.freeze(['a', 'b', 'c']);
  const links = Object.freeze([Object.freeze({ source: 'a', target: 'b' })]);
  const selected = Object.freeze(['a']);
  const focus = opportunityTopicFocus(nodes, links, selected)!;
  focus.add('c');
  assert.deepEqual(nodes, ['a', 'b', 'c']);
  assert.deepEqual(links, [{ source: 'a', target: 'b' }]);
  assert.deepEqual(selected, ['a']);
  assert.deepEqual(sorted(opportunityTopicFocus(nodes, links, selected)), ['a', 'b']);
});
