import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DESIGN, createDefaultDesign, designNumber, resolveDesign } from '../src/documents/cv/defaults';
import { createEmptyDocument, createSampleDocument } from '../src/features/cv-studio/domain/builtinConfigurations';

test('new documents, sample documents, and partial designs share the same defaults', () => {
  for (const design of [createEmptyDocument().design, createSampleDocument().design, resolveDesign(), createDefaultDesign()]) {
    assert.deepEqual(design, DEFAULT_DESIGN);
  }
});

test('saved values take precedence, including zero, false, and an inherited heading font', () => {
  const saved = { h1: '28pt', graphicOpacity: 0, headerPaddingBottom: '0mm', pageMarginVerticalLinked: false, fontHead: '' };
  const resolved = resolveDesign(saved);
  for (const [key, value] of Object.entries(saved)) assert.equal(resolved[key as keyof typeof resolved], value);
  assert.equal(designNumber(saved, 'graphicOpacity'), 0);
  assert.equal(designNumber({ h1: 'invalid' }, 'h1'), Number.parseFloat(DEFAULT_DESIGN.h1));
  assert.equal(resolveDesign({ h1: undefined }).h1, DEFAULT_DESIGN.h1);
  assert.deepEqual(saved, { h1: '28pt', graphicOpacity: 0, headerPaddingBottom: '0mm', pageMarginVerticalLinked: false, fontHead: '' });
});

test('mutable default collections cannot leak edits into another document', () => {
  for (const design of [createDefaultDesign(), resolveDesign()]) {
    design.favoriteControls.push('h1');
    design.customFonts.push({ name: 'Example', source: 'google' });
    design.letterContactFields.push('github');
  }
  assert.deepEqual(DEFAULT_DESIGN.favoriteControls, []);
  assert.deepEqual(DEFAULT_DESIGN.customFonts, []);
  assert.deepEqual(DEFAULT_DESIGN.letterContactFields, ['name', 'location', 'email', 'phone']);
  assert.deepEqual(createDefaultDesign(), DEFAULT_DESIGN);
});
