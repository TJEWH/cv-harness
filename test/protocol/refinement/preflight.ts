import { CASE_NAMES, createCase, stableId } from './cases';
import { seedSql, inspectSql } from './fixtures';
import { refinementSql } from '../../../src/features/refinement/domain/refinementProtocolContract';
import { randomUUID } from 'node:crypto';

/** Run this SQL through the existing MCP execute_sql tool as postgres. Everything rolls back. */
export function preflightSql(projectId: string) {
  const statements = ['BEGIN;'];
  for (const name of CASE_NAMES) {
    const fixture = createCase(name, projectId, randomUUID());
    statements.push(seedSql(fixture).replace(/^BEGIN;\n/, '').replace(inspectSql(fixture), '').replace(/COMMIT;$/, ''));
    const read = refinementSql('currentRequest', [fixture.application.id, fixture.request.requestId, fixture.request.scope]);
    statements.push(`DO $check$ DECLARE result jsonb; BEGIN ` +
      (fixture.expected === 'stop-read'
        ? `BEGIN ${read.replace(/^SELECT/, 'PERFORM')} RAISE EXCEPTION 'Unavailable request unexpectedly returned'; EXCEPTION WHEN serialization_failure THEN NULL; END;`
        : `result := ${read.replace(/^SELECT /, '')} IF result IS DISTINCT FROM private.read_refinement_request('${fixture.request.requestId}'::uuid) THEN RAISE EXCEPTION 'Source context changed'; END IF;`) +
      ` END; $check$;`);
    if (fixture.expected === 'saved') {
      const proposal = { schemaVersion: 2, requestId: fixture.request.requestId, summary: 'Synthetic protocol validation.',
        cvOperations: [], cvComments: [], annotations: [], letterText: fixture.request.letter.text || 'Dear committee,\nI built Python measurement tools.\n{{APPLICANT_NAME}}' };
      const save = refinementSql('save', [fixture.request.requestId, stableId(fixture.namespace + 'proposal'), JSON.stringify(proposal)]);
      statements.push(`DO $save$ BEGIN ${save.replace(/^SELECT/, 'PERFORM')} ${save.replace(/^SELECT/, 'PERFORM')} END; $save$;`);
    }
  }
  statements.push("SELECT 'All synthetic protocol SQL cases passed; transaction rolled back.' AS result;", 'ROLLBACK;');
  return statements.join('\n');
}
