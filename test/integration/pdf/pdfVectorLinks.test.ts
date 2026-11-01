import { stub } from '../../support/fixtures/cvState';
import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePdfLinks, vectorPageLinks } from '../../../src/documents/pdf/pdfVectorLinks.ts';

test('vector links follow separate clone scales and continuation page offsets', () => {
  const capture = { width: 100, height: 200, links: [{ href: 'https://example.com', x: 10, y: 90, width: 20, height: 30 }] };
  const canvas = { width: 300, height: 400 };
  const page = { canvasWidth: 300, contentWidth: 150, sourceTop: 200, sourceBottom: 400, leftOffset: 12, topOffset: 24 };
  assert.deepEqual(vectorPageLinks(capture, canvas, page), [{ href: 'https://example.com/', x: 27, y: 24, width: 30, height: 20 }]);
  assert.deepEqual(vectorPageLinks({ ...capture, links: [{ ...capture.links[0], y: 0 }] }, canvas, page), []);
});

test('capture links preserves multi-line rectangles but excludes unsafe actions and empty boxes', () => {
  const rect = { left: 30, top: 40, width: 10, height: 12 };
  const anchor = (href: string, rects = [rect]) => ({ href, getClientRects: () => rects });
  const root = {
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 99.5, height: 199.2 }),
    querySelectorAll: () => [anchor('mailto:test@example.com', [rect, { ...rect, top: 52 }]), anchor('javascript:alert(1)'), anchor('https://example.com', [{ ...rect, width: 0 }])],
  };
  const capture = capturePdfLinks(stub<HTMLElement>(root));
  assert.equal(capture.width, 100);
  assert.equal(capture.height, 200);
  assert.deepEqual(capture.links.map(({ x, y }) => [x, y]), [[10, 10], [10, 22]]);
});

test('captures independent stylesheet and FontFace snapshots from the final clone', () => {
  const stylesheets = [{ href: 'https://fonts.example.test/body.css' }, { href: 'https://fonts.example.test/head.css' }];
  const face = { family: 'Inter', style: 'italic', weight: '400 700', unicodeRange: 'U+0000-00FF', status: 'loaded' };
  const faces = new Set([face]);
  const root = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 200 }),
    querySelectorAll: () => [],
    ownerDocument: {
      querySelectorAll(selector: string) {
        assert.equal(selector, 'link[id^="cv-font-"]');
        return stylesheets;
      },
      fonts: faces,
    },
  };

  const capture = capturePdfLinks(stub<HTMLElement>(root));
  stylesheets[0].href = 'https://fonts.example.test/replaced.css';
  stylesheets.pop();
  Object.assign(face, { family: 'Montserrat', style: 'normal', weight: '300', unicodeRange: 'U+0400-04FF', status: 'error' });
  faces.clear();

  assert.deepEqual(capture.fontStyleUrls, ['https://fonts.example.test/body.css', 'https://fonts.example.test/head.css']);
  assert.deepEqual(capture.loadedFaces, [{ family: 'Inter', style: 'italic', weight: '400 700', unicodeRange: 'U+0000-00FF', status: 'loaded' }]);
  assert.notEqual(capture.loadedFaces![0], face);
});
