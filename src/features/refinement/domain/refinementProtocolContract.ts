import type { RefinementRequest } from '../refinementTypes';

/** Stable database contract shared by copied tasks, protocol documents and regression checks. */
export const REFINEMENT_COMMANDS = {
  currentRequest: { name: 'private.read_current_refinement_request', types: ['uuid', 'uuid', 'text'] },
  // Historical helpers remain available for already-copied tasks and stored protocols.
  resolve: { name: 'private.resolve_application_reference', types: ['text', 'text'] },
  protocol: { name: 'private.read_refinement_protocol', types: ['uuid', 'text'] },
  request: { name: 'private.read_refinement_request', types: ['uuid'] },
  save: { name: 'private.save_refinement_proposal', types: ['uuid', 'uuid', 'jsonb'] },
} as const;
export type RefinementCommand = keyof typeof REFINEMENT_COMMANDS;

export const REFINEMENT_SQL_DISCOVERY_QUERIES = [
  'Supabase execute_sql',
  'Supabase executes raw SQL in the Postgres database',
] as const;

/** Loading the known connector capability is distinct from exploring database contents. */
export const REFINEMENT_SQL_CAPABILITY_GUIDANCE = `Use Supabase execute_sql on this connection; its exposed name may include a namespace prefix. Use its loaded definition when available. Otherwise use tool discovery, targeted only at "${REFINEMENT_SQL_DISCOVERY_QUERIES[0]}" on this same connector. A partial result or query_logs alone does not establish that execute_sql is unavailable. If that search succeeds but does not load execute_sql, make one additional targeted search on the SAME connector: "${REFINEMENT_SQL_DISCOVERY_QUERIES[1]}". This is execute_sql's purpose; query_logs runs ClickHouse queries on logs and cannot perform this workflow. Never call query_logs as a substitute. Use only an actually returned execute_sql definition; never invent a tool path. Stop searching as soon as it is loaded. Maximum two discovery calls before each SQL operation, in that order; do not repeat either search. If the definition disappears after the read, the same bounded lookup is allowed before saving, preserving the exact request, proposal UUID and payload. This only loads tool definitions; it does not authorize database exploration or another access path. If execute_sql is unavailable after both lookups, or no discovery facility exists, stop and report the searched phrases and returned tool names as a capability-loading failure, without claiming that SQL ran or access was denied.
A permission, security or approval denial must stop the workflow immediately; do not rediscover or retry to bypass it. Report the exact tool error and blocked operation. Do not switch roles, widen permissions, retry through another access path or substitute conversation history.`;

export function sqlText(value: string): string {
  if (value.includes('\0')) throw new Error('SQL text cannot contain a null character.');
  return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
export function refinementSql(command: RefinementCommand, values: string[], alias?: string): string {
  const definition = REFINEMENT_COMMANDS[command];
  if (values.length !== definition.types.length) throw new Error('Incorrect refinement SQL argument count.');
  if (alias && !/^[a-z_]+$/.test(alias)) throw new Error('Invalid SQL alias.');
  const args = values.map((value, i) => {
    const type = definition.types[i];
    if (type === 'uuid' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) throw new Error('Invalid refinement UUID.');
    return type === 'uuid' ? `'${value}'::uuid` : `${sqlText(value)}${type === 'jsonb' ? '::jsonb' : ''}`;
  });
  return `SELECT ${definition.name}(${args.join(', ')})${alias ? ` AS ${alias}` : ''};`;
}
export function proposalContractExample(request: RefinementRequest, summary: string) {
  return { schemaVersion: 2, requestId: request.requestId, summary, cvOperations: [], cvComments: [], annotations: [], letterText: 'complete letter text' };
}
