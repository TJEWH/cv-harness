import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ADAPTIVE_BRIEF_MAX_BYTES, buildAdaptiveStartupBriefSql } from '../../../src/features/meta-search/domain/adaptiveSearchBrief';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: '91000000-0000-4000-8000-000000000001', run_id: '91000000-0000-4000-8000-000000000002' };

test('brief startup has only fixed scope substitutions and no discovery or pagination', () => {
  assert.equal(buildAdaptiveStartupBriefSql(scope), `SELECT private.begin_adaptive_search_brief('${scope.search_id}'::uuid,'${scope.run_id}'::uuid) AS startup;`);
  assert.equal(buildAdaptiveStartupBriefSql({ ...scope, search_id: scope.search_id.toUpperCase() }), buildAdaptiveStartupBriefSql(scope));
  for (const patch of [{ search_id: "';select * from public.opportunities;--" }, { run_id: '<run-uuid>' }, { project_ref: 'other-project' }]) {
    assert.throws(() => buildAdaptiveStartupBriefSql({ ...scope, ...patch }), /exact authorized project/u);
  }
});

test('targeted brief upgrade matches current definitions and grants no app-role access', () => {
  function definitions(sql: string) {
    return new Map([...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
      .map(match => [match[1]!, match[0].replace('CREATE OR REPLACE FUNCTION ', 'CREATE FUNCTION ')]));
  }
  const upgrade = read('supabase/releases/adaptive-search-brief-v1.sql');
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  const installed = definitions(upgrade);
  const later = definitions(read('supabase/releases/adaptive-search-supersession-v1.sql'));
  assert.equal(installed.size, 3);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature), `stale brief upgrade: ${signature}`);
  assert.match(upgrade, new RegExp(`octet_length\\(brief::text\\)>${ADAPTIVE_BRIEF_MAX_BYTES}`, 'u'));
  assert.match(upgrade, /REVOKE ALL ON FUNCTION private\.begin_adaptive_search_brief\(uuid,uuid\) FROM PUBLIC,anon,authenticated,service_role;/u);
  assert.doesNotMatch(upgrade, /SECURITY DEFINER|GRANT |ALTER TABLE|UPDATE public\.|DELETE FROM/u);
  assert.match(upgrade, /installation already exists/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('automatic replacement upgrade installs the same current fences with a deferred scoped reference', () => {
  const upgrade = read('supabase/releases/adaptive-search-supersession-v1.sql');
  const source = read('supabase/schemas/12_search_support.sql');
  const definitions = (sql: string) => new Map([...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
    .map(match => [match[1]!, match[0].replace('CREATE OR REPLACE FUNCTION ', 'CREATE FUNCTION ')]));
  const current = definitions(source), installed = definitions(upgrade);
  assert.equal(installed.size, 7);
  for (const [signature, body] of installed) assert.equal(body, current.get(signature), `stale replacement upgrade: ${signature}`);
  assert.match(upgrade, /ADD COLUMN superseded_by_run_id uuid/u);
  assert.match(upgrade, /FOREIGN KEY \(user_id,search_id,superseded_by_run_id\)[\s\S]*?REFERENCES public\.opportunity_search_runs\(user_id,search_id,id\) DEFERRABLE INITIALLY DEFERRED/u);
  assert.doesNotMatch(upgrade, /DROP TABLE|GRANT |SECURITY DEFINER/u);
  assert.match(upgrade, /Supersession installation already exists/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});
