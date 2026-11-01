import { stub } from '../../support/fixtures/cvState';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDeferredSidebarToContent } from '../../../src/documents/pdf/pdfSidebarHeight.ts';

test('content-height deferred sidebars release the float below their content', () => {
  const properties: Record<string, string> = {};
  let bottom = 940;
  const content = { getBoundingClientRect: () => ({ bottom }) };
  const sidebar = {
    style: { height: '', setProperty: (key: string, value: string) => { properties[key] = value; } },
    querySelector: () => content,
    getBoundingClientRect: () => ({ top: 200 }),
  };
  const root = { querySelector: () => sidebar };
  fitDeferredSidebarToContent(stub<HTMLElement>(root));
  assert.equal(properties['--sidebar-deferred-min-height'], '0px');
  assert.equal(sidebar.style.height, '740px');

  // A sidebar section moved to the next page must enlarge its float before
  // the body is paginated; otherwise the body could overlap that section.
  bottom = 1110;
  fitDeferredSidebarToContent(stub<HTMLElement>(root));
  assert.equal(sidebar.style.height, '910px');
  bottom = 800;
  fitDeferredSidebarToContent(stub<HTMLElement>(root));
  assert.equal(sidebar.style.height, '600px');
});

test('normal-flow and missing sidebars need no height override', () => {
  assert.doesNotThrow(() => fitDeferredSidebarToContent(stub<HTMLElement>({ querySelector: () => null })));
});
