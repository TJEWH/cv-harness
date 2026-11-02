import { file, reset, sql } from './postgres';

/** Reviewed historical bodies, installed only in the labelled disposable database.
 * This is deliberately separate from production schema installation: the current
 * batch entrypoints reject all writes and must never dispatch to this contract.
 */
export function historicalFunctionDefinitions(path: string): Map<string, string> {
  return new Map([...file(path).matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ((?:private|public)\.[a-z_]+)\([^\n]*\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
    .map(match => [match[1]!, match[0]]));
}

export function installHistoricalAdaptiveBatchFixture(options: { brief?: boolean } = {}) {
  const release = historicalFunctionDefinitions('supabase/releases/adaptive-search-standalone-saves-v1.sql');
  for (const name of ['private.submit_adaptive_search_batch', 'private.verify_and_complete_adaptive_search']) {
    const definition = release.get(name);
    if (!definition) throw new Error(`Missing reviewed predecessor function ${name}`);
    sql(definition);
  }
  const startup = historicalFunctionDefinitions('supabase/releases/adaptive-search-startup-logging-v1.sql').get('private.begin_adaptive_opportunity_search');
  if (!startup) throw new Error('Missing reviewed predecessor startup');
  sql(startup);
  if (options.brief) {
    const definition = historicalFunctionDefinitions('supabase/releases/adaptive-search-brief-limit-v1.sql').get('private.begin_adaptive_search_brief');
    if (!definition) throw new Error('Missing reviewed predecessor brief');
    sql(definition);
  }
}

export function resetHistoricalAdaptiveBatchFixture() {
  reset();
  installHistoricalAdaptiveBatchFixture({ brief: true });
}
