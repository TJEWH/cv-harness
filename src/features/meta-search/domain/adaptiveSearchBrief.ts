/** One bounded startup response for hosted manual and scheduled executions.
 * The full internal bundle/paged codec remains available for historical offline fixtures.
 * This SQL template is not a connector, approval mechanism or automatic retry runner.
 */
export const ADAPTIVE_BRIEF_VERSION = 1;
export const ADAPTIVE_BRIEF_MAX_BYTES = 98_304;
export const ADAPTIVE_BRIEF_HELPER = 'private.begin_adaptive_search_brief(uuid,uuid)';
export const ADAPTIVE_STARTUP_BRIEF_SQL_TEMPLATE = "SELECT private.begin_adaptive_search_brief('{{search_id}}'::uuid,'<run-uuid>'::uuid) AS startup;";

export function buildAdaptiveStartupBriefSql(scope: { project_ref: string; search_id: string; run_id: string }): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  if (!scope || !/^[a-z0-9]{20}$/u.test(scope.project_ref) || !uuid.test(scope.search_id) || !uuid.test(scope.run_id)) {
    throw new TypeError('Use the exact authorized project, saved search and stable run UUID.');
  }
  return ADAPTIVE_STARTUP_BRIEF_SQL_TEMPLATE.replace('{{search_id}}', scope.search_id.toLowerCase()).replace('<run-uuid>', scope.run_id.toLowerCase());
}
