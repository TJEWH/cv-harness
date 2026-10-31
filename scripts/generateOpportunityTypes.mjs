import { readFileSync, writeFileSync } from 'node:fs';

const schemaPath = new URL('../supabase/contracts/opportunity.schema.json', import.meta.url);
const outputPath = new URL('../src/features/opportunities/opportunityTypes.ts', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const name = value => `Opportunity${value.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join('')}`;
function typeOf(node, depth = 0, required = new Set(node.required || [])) {
  if (node === true) return 'unknown';
  if (node === false) return 'never';
  if (node.$ref) return name(node.$ref.split('/').at(-1));
  if (node.enum) return node.enum.map(value => JSON.stringify(value)).join(' | ');
  if ('const' in node) return JSON.stringify(node.const);
  if (Array.isArray(node.type)) return node.type.map(type => typeOf({ ...node, type }, depth, required)).join(' | ');
  if (node.type === 'array') return `Array<${typeOf(node.items || true, depth)}>`;
  if (node.type === 'object') {
    if (!node.properties) return `Record<string, ${typeOf(node.additionalProperties ?? true, depth)}>`;
    const indent = '  '.repeat(depth + 1);
    const fields = Object.entries(node.properties).map(([key, value]) => `${indent}${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${typeOf(value, depth + 1)};`);
    return `{\n${fields.join('\n')}\n${'  '.repeat(depth)}}`;
  }
  return { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' }[node.type] || 'unknown';
}
const definitions = Object.entries(schema.$defs).map(([key, value]) => `export type ${name(key)} = ${typeOf(value)};`);
const root = typeOf(schema, 0, new Set(Object.keys(schema.properties)));
const version = schema['x-canonical-version'];
const output = `// Generated from supabase/contracts/opportunity.schema.json by scripts/generateOpportunityTypes.mjs.\n// Edit the schema and regenerate; catalogue consumers use these structured values directly.\n\nexport const OPPORTUNITY_SCHEMA_VERSION = ${version} as const;\n\n${definitions.join('\n\n')}\n\nexport type Opportunity = ${root} & {\n  id: string;\n  record_type: 'opportunity';\n  metadata_schema_version: typeof OPPORTUNITY_SCHEMA_VERSION;\n  created_at: string | null;\n  updated_at: string | null;\n};\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== output) throw new Error('Opportunity types are stale. Run node scripts/generateOpportunityTypes.mjs.');
} else writeFileSync(outputPath, output);
