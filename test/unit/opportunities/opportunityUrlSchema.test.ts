import assert from 'node:assert/strict';
import test from 'node:test';
import schemaV6 from '../../../supabase/contracts/opportunity.schema.json';
import { readOpportunity } from '../../../src/features/opportunities/domain/readOpportunity';
import { canonicalOpportunityFixture } from '../../support/fixtures/canonicalOpportunity';
import { opportunityFixture } from '../../support/fixtures/opportunity';

const httpUrls = [
  'http://example.invalid',
  'https://example.invalid/jobs/doctoral-position?department=robotics&language=en#apply',
];
const invalidHttpUrls = [
  'https://example.invalid/jobs/doctoral position',
  'https://example.invalid/jobs/doctoral\tposition',
  'https://example.invalid/jobs/doctoral\nposition',
  'example.invalid/jobs/doctoral-position',
  'ftp://example.invalid/jobs/doctoral-position',
];

const expectedHttpPatternPaths = [
  '/properties/official_url',
  '/properties/source_url',
  '/properties/application_url',
  '/$defs/fact/properties/source_urls/items',
  '/$defs/person/properties/source_urls/items',
  '/$defs/checklist/properties/source_urls/items',
  '/$defs/paper/properties/url',
  '/$defs/paper/properties/source_urls/items',
  '/$defs/focus_profile/properties/source_urls/items',
  '/$defs/salary/properties/source_urls/items',
  '/$defs/background/properties/source_urls/items',
  '/$defs/source/properties/url',
  '/$defs/living_standard/properties/sources/items/properties/url',
];

function httpPatterns(value: unknown, path = ''): Map<string, string> {
  const found = new Map<string, string>();
  if (!value || typeof value !== 'object') return found;
  const node = value as Record<string, unknown>;
  if (typeof node.pattern === 'string' && node.pattern.includes('http')) found.set(path, node.pattern);
  for (const [key, child] of Object.entries(node)) {
    for (const [childPath, pattern] of httpPatterns(child, `${path}/${key}`)) found.set(childPath, pattern);
  }
  return found;
}

test('current URL patterns preserve HTTP(S) paths and queries at every schema location', async t => {
    const patterns = httpPatterns(schemaV6);
    assert.deepEqual([...patterns.keys()].sort(), [...expectedHttpPatternPaths].sort());
    for (const [path, pattern] of patterns) {
      await t.test(path, () => {
        const rule = new RegExp(pattern);
        for (const url of httpUrls) assert.equal(rule.test(url), true, `${path} must accept ${url}`);
        for (const url of invalidHttpUrls) assert.equal(rule.test(url), false, `${path} must reject ${JSON.stringify(url)}`);
      });
    }
});

test('v6 application URLs preserve advertised email application query parameters', () => {
  const rule = new RegExp(schemaV6.properties.application_url.pattern);
  for (const url of [
    'mailto:jobs@example.invalid',
    'mailto:jobs@example.invalid?subject=Doctoral%20application',
    'mailto:jobs@example.invalid?subject=Doctoral%20application&body=Dear%20selection%20committee',
  ]) assert.equal(rule.test(url), true, `must accept ${url}`);
  for (const url of [
    'jobs@example.invalid',
    'mailto:@example.invalid',
    'mailto:jobs@@example.invalid',
    'mailto:jobs@example.invalid?subject=Doctoral application',
  ]) assert.equal(rule.test(url), false, `must reject ${url}`);
});

test('the catalogue reader accepts the full canonical fixture with evidenced URLs', () => {
  const row = canonicalOpportunityFixture();
  assert.strictEqual(readOpportunity(row), row);
  assert.equal(row.official_url, 'https://example.invalid/canonical/job');
  assert.equal(row.sources[0]?.url, 'https://example.invalid/canonical/job');
  assert.equal(row.required_documents[0]?.source_urls?.[0], 'https://example.invalid/canonical/job');
  assert.equal(row.contacts[0]?.source_urls?.[0], 'https://example.invalid/canonical/team');
});

test('the catalogue read boundary validates top-level and nested source, person and document URLs', async t => {
  const base = opportunityFixture({ id: 'synthetic-url-contract' });
  const cases: Record<string, (url: string) => Record<string, unknown>> = {
    official_url: url => ({ official_url: url }),
    source_url: url => ({ source_url: url }),
    application_url: url => ({ application_url: url }),
    'sources[].url': url => ({ sources: [{ source_id: 'source', url, kind: 'official',
      checked_at: '2026-10-28T09:00:00Z', precision: 'instant', supports: ['title'] }] }),
    'contacts[].source_urls[]': url => ({ contacts: [{ entity_id: 'contact', roles: ['Scientific contact'], source_urls: [url] }] }),
    'supervisors[].source_urls[]': url => ({ supervisors: [{ entity_id: 'supervisor', roles: ['Supervisor'], source_urls: [url] }] }),
    'requirements[].source_urls[]': url => ({ requirements: [{ entity_id: 'degree', text: 'Relevant degree',
      status: 'required', stage: 'recruitment', source_urls: [url] }] }),
    'required_documents[].source_urls[]': url => ({ required_documents: [{ entity_id: 'statement', text: 'Research statement',
      status: 'required', stage: 'recruitment', source_urls: [url] }] }),
  };
  for (const [path, patch] of Object.entries(cases)) {
    await t.test(path, () => {
      for (const url of httpUrls) {
        const row = { ...structuredClone(base), ...patch(url) };
        assert.strictEqual(readOpportunity(row), row, `${path} must retain the canonical record`);
      }
      for (const url of invalidHttpUrls) {
        assert.throws(() => readOpportunity({ ...structuredClone(base), ...patch(url) }), /invalid canonical record/, path);
      }
    });
  }
  const emailApplication = { ...base, application_url: 'mailto:jobs@example.invalid?subject=Application&body=Dear%20committee' };
  assert.strictEqual(readOpportunity(emailApplication), emailApplication);
});
