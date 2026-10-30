import schema from '../../../../supabase/opportunity_schema_v6.json';
import type { Opportunity } from '../opportunityTypes';

type Schema = boolean | { $ref?: string; type?: string | string[]; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: Schema; items?: Schema; enum?: unknown[]; const?: unknown; anyOf?: Schema[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; pattern?: string };
const definitions = schema.$defs as Record<string, Schema>;
export const OPPORTUNITY_COLUMNS = [...Object.keys(schema.properties), 'id', 'record_type', 'metadata_schema_version', 'created_at', 'updated_at'].join(',');
const rowSchema: Schema = { ...schema, required: [...Object.keys(schema.properties), 'id', 'record_type', 'metadata_schema_version', 'created_at', 'updated_at'],
  properties: { ...schema.properties, id: { type: 'string' }, record_type: { const: 'opportunity' }, metadata_schema_version: { const: schema['x-canonical-version'] },
    created_at: { type: ['string', 'null'] }, updated_at: { type: ['string', 'null'] } } };

function matches(value: unknown, rule: Schema): boolean {
  if (typeof rule === 'boolean') return rule;
  if (rule.$ref) return matches(value, definitions[rule.$ref.split('/').at(-1)!]!);
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const types = rule.type && (Array.isArray(rule.type) ? rule.type : [rule.type]);
  if (types && !types.includes(kind) && !(types.includes('integer') && Number.isInteger(value))) return false;
  if ('const' in rule && value !== rule.const || rule.enum && !rule.enum.includes(value)) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum)) return false;
  if (typeof value === 'string' && (rule.minLength !== undefined && Array.from(value).length < rule.minLength || rule.maxLength !== undefined && Array.from(value).length > rule.maxLength
    || rule.pattern && !new RegExp(rule.pattern).test(value))) return false;
  if (rule.anyOf && !rule.anyOf.some(child => matches(value, child))) return false;
  if (Array.isArray(value)) return !(rule.minItems !== undefined && value.length < rule.minItems) && (!rule.items || value.every(item => matches(item, rule.items!)));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (rule.required?.some(key => !Object.hasOwn(object, key))) return false;
    return Object.entries(object).every(([key, item]) => matches(item, rule.properties?.[key] ?? rule.additionalProperties ?? true));
  }
  return true;
}

/** Check the current stored shape once at the read boundary; the database owns semantic validation. */
export function readOpportunity(value: unknown): Opportunity {
  if (!matches(value, rowSchema) || !(value as Opportunity).id.trim() || !(value as Opportunity).title.trim()
    || !(value as Opportunity).opportunity_key.trim()) throw new TypeError('The opportunities table returned an invalid canonical record.');
  return value as Opportunity;
}
