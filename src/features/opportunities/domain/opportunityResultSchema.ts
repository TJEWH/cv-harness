import storageSchema from '../../../../supabase/opportunity_schema_v6.json';

export interface OpportunityResultSchema {
  [keyword: string]: unknown;
  properties: Record<string, Record<string, unknown>>;
  $defs: Record<string, Record<string, unknown>>;
}

/**
 * Static canonical v6 intake schema, matching the reviewed
 * private.opportunity_search_result_schema() derivation. Storage requires
 * server-generated entity/source identities; incoming research does not.
 * No database discovery or external schema fetch is performed.
 */
export function createOpportunityResultSchema(): OpportunityResultSchema {
  const schema = structuredClone(storageSchema) as unknown as OpportunityResultSchema;
  schema.properties.last_checked_at!.type = 'string';
  schema.properties.sources!.minItems = 1;
  for (const name of ['person', 'checklist', 'paper', 'focus_profile', 'money_component', 'source']) {
    const definition = schema.$defs[name]!;
    definition.required = (definition.required as string[]).filter(field => field !== 'entity_id' && field !== 'source_id'
      && !(name === 'person' && field === 'roles'));
  }
  schema.properties.merge_control = {
    type: 'object', additionalProperties: false,
    properties: {
      corrections: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['path', 'expected', 'reason'],
        properties: { path: { type: 'string', pattern: '^/', minLength: 2 }, expected: true,
          reason: { type: 'string', minLength: 1, maxLength: 4000 } },
      } },
    },
  };
  return schema;
}
