import test from 'node:test';
import assert from 'node:assert/strict';
import { designControlRows, type DesignControl, type FavoriteLink } from '../src/features/cv-studio/domain/designControls';

const link: FavoriteLink = { linkKey: 'pageMarginVerticalLinked', primaryKey: 'pageMarginTop', secondaryKey: 'pageMarginBottom' };
const top: DesignControl = { key: 'pageMarginTop', section: 'layout', label: 'Top', type: 'range', min: 0, max: 30, step: 1, unit: 'mm', link };
const bottom: DesignControl = { ...top, key: 'pageMarginBottom', label: 'Bottom' };
const timeline: DesignControl = { key: 'showTimeline', section: 'graphics', label: 'Timeline', type: 'toggle' };

test('ordinary controls, including toggles, need no special favorites registration', () => {
  const color: DesignControl = { key: 'ink', section: 'colors', label: 'Color', type: 'color' };
  const rows = designControlRows([timeline, color], () => 'Margins');
  assert.deepEqual(rows, [{ type: 'single', option: timeline }, { type: 'single', option: color }]);
});

test('linked controls form one pair in either order and retain unrelated controls', () => {
  const rows = designControlRows([bottom, timeline, top], () => 'Vertical margins');
  assert.deepEqual(rows, [
    { type: 'linked', key: link.linkKey, label: 'Vertical margins', link, options: [top, bottom] },
    { type: 'single', option: timeline },
  ]);
});

test('favoriting only one linked control keeps it editable on its own', () => {
  assert.deepEqual(designControlRows([bottom], () => 'Margins'), [{ type: 'single', option: bottom }]);
});
