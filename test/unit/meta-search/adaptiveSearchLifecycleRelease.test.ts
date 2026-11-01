import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
function definitions(sql: string) {
  return new Map([...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
    .map(match => [match[1]!, match[0].replace('CREATE OR REPLACE FUNCTION ', 'CREATE FUNCTION ')]));
}

test('the versioned lifecycle upgrade contains the reviewed current fencing and operation definitions', () => {
  const upgrade = read('supabase/releases/adaptive-search-lifecycle-v1.sql');
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  const installed = definitions(upgrade);
  assert.equal(installed.size, 26, 'review additions to the targeted upgrade explicitly');
  // Preserve historical installers while checking the final ordered deployment state.
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-brief-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-supersession-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-response-handling-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-batch-diagnostics-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-evidence-fields-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-startup-logging-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql'))]);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature), `stale upgrade definition: ${signature}`);
  for (const name of ['begin_adaptive_opportunity_search', 'begin_opportunity_search', 'complete_opportunity_search',
    'opportunity_search_adaptive_error', 'opportunity_search_adaptive_completion_error', 'verify_and_complete_adaptive_search',
    'guard_search_run_not_aborted', 'guard_adaptive_search_lifecycle_start', 'adaptive_search_lifecycle_receipt',
    'prepare_adaptive_search_lifecycle', 'apply_adaptive_search_lifecycle', 'read_adaptive_search_lifecycle', 'job_workspace_adaptive_run_pins']) {
    assert.ok([...installed.keys()].some(signature => signature.startsWith(`private.${name}(`) || signature.startsWith(`public.${name}(`)), name);
  }
  assert.match(upgrade, /ADD COLUMN owner_cancel_operation_id uuid/u);
  assert.match(upgrade, /CREATE TABLE private\.opportunity_search_lifecycle_operations/u);
  assert.match(upgrade, /ENABLE ROW LEVEL SECURITY/u);
  const security = read('supabase/schemas/60_security.sql').split('-- Lifecycle operations are private owner-authorized commands, never an executable research packet.\n')[1]!.trim();
  assert.ok(upgrade.includes(security), 'upgrade ACLs must match the current lifecycle security module');
  assert.match(security, /REVOKE ALL ON FUNCTION public\.prepare_adaptive_search_lifecycle\(uuid,text,text,uuid\) FROM PUBLIC,anon,authenticated,service_role;/u);
  assert.match(upgrade, /Lifecycle installation already exists or is partial/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});
