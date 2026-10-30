/** Storage identities have no role in displayed research or letter-writing evidence.
 * Vacancy references, ORCIDs, DOIs and public source URLs remain meaningful evidence.
 */
const INTERNAL_FIELDS = new Set([
  'id', 'user_id', 'opportunity_id', 'application_id', 'opportunity_key',
  'entity_id', 'source_id', 'researcher_id', 'entity_ids', 'source_ids', 'researcher_ids',
  'metadata_schema_version', 'record_type',
]);

export function isOpportunityInternalField(key: string): boolean {
  const normalized = key.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/[ -]+/g, '_');
  return INTERNAL_FIELDS.has(normalized);
}

/** Migration notes can preserve a retired ID as a labeled fact. Keep it in the
 * stored snapshot, but give it the same treatment as the original metadata key.
 */
export function isOpportunityInternalFact(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fact = value as Record<string, unknown>;
  return typeof fact.label === 'string' && typeof fact.text === 'string'
    && isOpportunityInternalField(fact.label.split(/\s*\/\s*/).at(-1)!);
}
