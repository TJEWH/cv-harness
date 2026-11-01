import assert from 'node:assert/strict';
import test from 'node:test';
import { safeEmailUrl, safeLinkUrl, safeWebUrl } from '../../../src/shared/lib/safeUrl';
import { parseInlineMarkdown } from '../../../src/shared/lib/markdownText';
import { vectorPageLinks } from '../../../src/documents/pdf/pdfVectorLinks';

test('web links require HTTP(S) and reject executable, relative, and disguised schemes', () => {
  assert.equal(safeWebUrl(' HTTPS://Example.com/cv '), 'https://example.com/cv');
  assert.equal(safeWebUrl('http://example.com'), 'http://example.com/');
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
    'data:text/html,test', 'vbscript:test', 'file:///tmp/cv', 'blob:https://example.com/id',
    '//example.com', '/relative', 'example.com', 'https:', 'https://', 'https://user:secret@example.com', null]) {
    assert.equal(safeWebUrl(value), null, String(value));
    assert.equal(safeLinkUrl(value), null, String(value));
  }
  assert.equal(parseInlineMarkdown('[bad](data:text/html,test)')[0].type, 'text');
});

test('email links allow one address without header or recipient injection', () => {
  assert.equal(safeEmailUrl(' alice+cv@example.com '), 'mailto:alice%2Bcv@example.com');
  assert.equal(safeLinkUrl('MAILTO:alice%2Bcv@example.com'), 'mailto:alice%2Bcv@example.com');
  assert.equal(safeLinkUrl('tel:+49 123-456'), 'tel:+49 123-456');
  for (const value of ['alice@example.com?bcc=other@example.com', 'alice@example.com\r\nBcc:other@example.com',
    'alice@example.com,other@example.com', 'alice%0a@example.com', 'not-an-email']) {
    assert.equal(safeEmailUrl(value), null);
    assert.equal(safeLinkUrl(`mailto:${value}`), null);
  }
  assert.equal(safeLinkUrl('mailto:alice@example.com%0d%0aBcc:other@example.com'), null);
  assert.equal(safeLinkUrl('tel:javascript:alert(1)'), null);
});

test('PDF and SVG annotation output rejects unsafe URLs even in a prebuilt capture', () => {
  const capture = { width: 100, height: 100, links: [
    { href: 'javascript:alert(1)', x: 0, y: 0, width: 20, height: 20 },
    { href: 'https://example.com/cv', x: 0, y: 0, width: 20, height: 20 },
  ] };
  const links = vectorPageLinks(capture, { width: 100, height: 100 }, {
    canvasWidth: 100, contentWidth: 100, sourceTop: 0, sourceBottom: 100, leftOffset: 0, topOffset: 0,
  });
  assert.deepEqual(links.map(({ href }) => href), ['https://example.com/cv']);
});
