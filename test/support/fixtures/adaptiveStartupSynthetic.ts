import { createHash } from 'node:crypto';
import { ADAPTIVE_BATCH_CAPABILITIES, ADAPTIVE_BATCH_EXECUTION_CONTRACT } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';
import { ADAPTIVE_STARTUP_PAGE_BYTES, ADAPTIVE_STARTUP_SECTIONS, type AdaptiveStartupManifest, type AdaptiveStartupPage, type AdaptiveStartupSection } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';

/** Entirely synthetic transport data. The default mirrors the reported section page counts, never a required total. */
export function syntheticAdaptiveStartup(protocolPages?: number) {
  const id = (n: number) => `8a000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: id(1), run_id: id(2) };
  const serverScope = { ...scope, user_id: id(3), authorization_epoch: id(4), authorization_revision: 1 };
  const binding = { profile_id: id(3), scope };
  const source = { registry_id: id(5), listing_url: 'https://example.invalid/SyntheticJobs' };
  const sections: Record<AdaptiveStartupSection, unknown> = {
    context: { adaptive_contract_version: 1, bootstrap_version: 1, compatible: true, scope: serverScope,
      release: { schema_version: 6, protocol_version: 'opportunity-search-v1-canonical-6', protocol_hash: 'a'.repeat(64), release_revision: 1 },
      base: { revision: 1, criteria: { topicsAndMethods: 'Synthetic sensing 界 🎵', researchAndReporting: '' } },
      query_plan: null, legacy_core_queries: null, due_sources: [source], source_context: [source],
      preferences: { revision: 0, approved_rules: [], approved_preferences: [] },
      refresh: { cold_start: true, adaptive_slice: true, privacy_scope_changed: false },
      lease: { status: 'active', expires_at: '2035-01-01T12:00:00Z' },
      capabilities: ADAPTIVE_BATCH_CAPABILITIES, execution_contract: ADAPTIVE_BATCH_EXECUTION_CONTRACT },
    planning: { enabled: true, priorities: [{ target: 'Synthetic sensing', direction: 'increase' }] },
    protocol_text: 'Reviewed synthetic protocol.',
    result_schema: { type: 'object', properties: { title: { type: 'string' } } },
    feedback: { examples: [{ title: 'Synthetic opportunity', research_summary: 'Synthetic physical sensing research.', interest_score: 8 }] },
  };
  const layout = protocolPages === undefined ? { context: 3, planning: 4, protocol_text: 4, result_schema: 4, feedback: 12 }
    : { context: 1, planning: 1, protocol_text: protocolPages, result_schema: 1, feedback: 1 };
  for (const section of ADAPTIVE_STARTUP_SECTIONS) {
    const target = (layout[section] - 1) * ADAPTIVE_STARTUP_PAGE_BYTES + 200;
    if (section === 'protocol_text') sections.protocol_text = 'p'.repeat(target - 2);
    else {
      const value = sections[section] as Record<string, unknown>;
      const targetObject = section === 'context' ? ((value.base as { criteria: Record<string, unknown> }).criteria)
        : value;
      // Context remains within its exact field allowlist. Other sections are transport-only JSON fixtures.
      const key = section === 'context' ? 'topicsAndMethods' : section === 'result_schema' ? '$comment' : 'synthetic_padding';
      targetObject[key] = '';
      targetObject[key] = 'x'.repeat(Math.max(0, target - Buffer.byteLength(JSON.stringify(value))));
    }
  }
  const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const bundle: Record<string, unknown> = { ...(sections.context as Record<string, unknown>), planning: sections.planning, protocol_text: sections.protocol_text,
    result_schema: sections.result_schema, feedback: sections.feedback };
  const bundle_hash = digest(JSON.stringify(bundle));
  const descriptors = ADAPTIVE_STARTUP_SECTIONS.map(section => {
    const bytes = Buffer.from(JSON.stringify(sections[section]));
    return { section, byte_length: bytes.length, sha256: digest(bytes), page_count: Math.ceil(bytes.length / ADAPTIVE_STARTUP_PAGE_BYTES) };
  });
  const manifest: AdaptiveStartupManifest = { transport_version: 1, compatible: true, scope: serverScope, bundle_hash, sections: descriptors };
  const pages = descriptors.flatMap(descriptor => {
    const bytes = Buffer.from(JSON.stringify(sections[descriptor.section]));
    return Array.from({ length: descriptor.page_count }, (_, index): AdaptiveStartupPage => ({ transport_version: 1, compatible: true,
      scope: serverScope, bundle_hash, ...descriptor, index,
      data_base64: bytes.subarray(index * ADAPTIVE_STARTUP_PAGE_BYTES, (index + 1) * ADAPTIVE_STARTUP_PAGE_BYTES).toString('base64') }));
  });
  return { binding, scope, serverScope, manifest, pages, bundle, sections };
}
