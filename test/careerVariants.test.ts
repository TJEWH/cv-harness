import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationRefinementParents, isMainCvVariant, normalizeVariantIndex } from '../src/features/cv-studio/domain/careerVariants';

test('legacy refinements retain provenance even when their parent is missing or invalid', () => {
  const input = [
    { id: 'root', name: 'Root' }, { id: 'child', name: 'Child', mtime: 123, parentId: 'root' },
    { id: 'nested', name: 'Third level', parentId: 'child' }, { id: 'orphan', name: 'Orphan', parentId: 'gone' },
    { id: 'loop', name: 'Cycle', parentId: 'loop' }, { id: 'root', name: 'Duplicate' },
  ];
  const result = normalizeVariantIndex(input);
  assert.deepEqual(result, [
    { id: 'root', name: 'Root' }, { id: 'child', name: 'Child', mtime: 123, parentId: 'root' },
    { id: 'nested', name: 'Third level', parentId: 'child' }, { id: 'orphan', name: 'Orphan', parentId: 'gone' },
    { id: 'loop', name: 'Cycle', parentId: 'loop' },
  ]);
  assert.deepEqual(result.filter(isMainCvVariant).map(item => item.id), ['root']);
  assert.equal(input[1]?.parentId, 'root', 'normalization does not rewrite stored documents or its input');
});

test('main variant classification uses provenance instead of naming conventions', () => {
  const result = normalizeVariantIndex([
    { id: 'refinement-wording', name: 'Research · refinement 123' },
    { id: 'ordinary-name', name: 'Research', parentId: 'original' },
    { id: 'explicit-copy', name: 'Research copy', parentId: '' },
  ]);
  assert.deepEqual(result.filter(isMainCvVariant).map(item => item.id), ['refinement-wording', 'explicit-copy']);
});

test('flat libraries remain readable and malformed index entries are ignored', () => {
  assert.deepEqual(normalizeVariantIndex([{ id: 'old', name: 'Existing CV' }]), [{ id: 'old', name: 'Existing CV' }]);
  assert.deepEqual(normalizeVariantIndex([null, false, {}, { id: '', name: 'Empty' }, { id: 'missing-name' }]), []);
  assert.deepEqual(normalizeVariantIndex({ id: 'wrong-shape' }), []);
});

test('only matching application acceptance receipts recover internal refinement identities', () => {
  const backup = (applicationId: string, variantId: string | null) => JSON.stringify({
    version: 1, savedVariant: { id: 'explicit-main' },
    requests: { request: { request: { applicationId, requestId: 'request' }, cv: { sourceVariantId: 'base' }, acceptances: [{ variantId }] } },
  });
  const records = new Map([
    ['CV_REFINEMENT:1:owner:app', backup('app', 'internal')],
    ['CV_REFINEMENT:1:owner:modern', backup('modern', null)],
    ['CV_REFINEMENT:1:owner:wrong', backup('another-app', 'mismatch')],
    ['CV_REFINEMENT:1:owner:broken', '{not-json'],
    ['CV_REFINEMENT:2:owner:future', backup('future', 'future')],
    ['OTHER:1:owner:app', backup('app', 'unrelated')],
  ]);
  const reads: string[] = [];
  const parents = applicationRefinementParents({
    length: records.size, key: index => [...records.keys()][index] || null,
    getItem: key => { reads.push(key); return records.get(key) || null; },
  });
  assert.deepEqual([...parents], [['internal', 'base']]);
  assert.ok(reads.every(key => key.startsWith('CV_REFINEMENT:1:')));
  assert.equal(parents.has('explicit-main'), false, 'explicit saved variants are not acceptance receipts');
});
