import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ADAPTIVE_BRIEF_MAX_BYTES, buildAdaptiveStartupBriefSql } from '../../../src/features/meta-search/domain/adaptiveSearchBrief';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const scope = { project_ref: 'abcdefghijklmnopqrst', search_id: '91000000-0000-4000-8000-000000000001', run_id: '91000000-0000-4000-8000-000000000002' };
const functionDefinition = /^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu;
function definitions(sql: string) {
  return new Map([...sql.matchAll(functionDefinition)]
    .map(match => [match[1]!, match[0].replace('CREATE OR REPLACE FUNCTION ', 'CREATE FUNCTION ')]));
}

test('brief startup has only fixed scope substitutions and no discovery or pagination', () => {
  assert.equal(buildAdaptiveStartupBriefSql(scope), `SELECT private.begin_adaptive_search_brief('${scope.search_id}'::uuid,'${scope.run_id}'::uuid) AS startup;`);
  assert.equal(buildAdaptiveStartupBriefSql({ ...scope, search_id: scope.search_id.toUpperCase() }), buildAdaptiveStartupBriefSql(scope));
  for (const patch of [{ search_id: "';select * from public.opportunities;--" }, { run_id: '<run-uuid>' }, { project_ref: 'other-project' }]) {
    assert.throws(() => buildAdaptiveStartupBriefSql({ ...scope, ...patch }), /exact authorized project/u);
  }
});

test('targeted brief upgrade matches current definitions and grants no app-role access', () => {
  const upgrade = read('supabase/releases/adaptive-search-brief-v1.sql');
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  const installed = definitions(upgrade);
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-supersession-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-response-handling-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql'))]);
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
  const current = definitions(source), installed = definitions(upgrade);
  assert.equal(installed.size, 7);
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-response-handling-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql'))]);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature), `stale replacement upgrade: ${signature}`);
  assert.match(upgrade, /ADD COLUMN superseded_by_run_id uuid/u);
  assert.match(upgrade, /FOREIGN KEY \(user_id,search_id,superseded_by_run_id\)[\s\S]*?REFERENCES public\.opportunity_search_runs\(user_id,search_id,id\) DEFERRABLE INITIALLY DEFERRED/u);
  assert.doesNotMatch(upgrade, /DROP TABLE|GRANT |SECURITY DEFINER/u);
  assert.match(upgrade, /Supersession installation already exists/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('historical response-handling upgrade keeps its original contract before the incremental override', () => {
  const upgrade = read('supabase/releases/adaptive-search-response-handling-v1.sql');
  const installed = definitions(upgrade), later = definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql'));
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.equal(installed.size, 1);
  for (const [signature, body] of installed) {
    assert.match(body, /Keep each complete raw connector response unchanged before decoding/u);
    assert.match(body, /outer \{text: \.\.\.\} with or without type:"text"/u);
    assert.match(body, /share one startup retry budget/u);
    assert.doesNotMatch(body, /MISSING BATCH RECEIPT/u);
    assert.notEqual(later.get(signature), body, 'the historical prompt must remain immutable');
    assert.equal(later.get(signature), current.get(signature), 'the incremental upgrade installs the current prompt');
  }
  assert.doesNotMatch(upgrade, /ALTER TABLE|DROP |GRANT |REVOKE |SECURITY DEFINER|UPDATE public\.|DELETE FROM/u);
  assert.match(upgrade, /Expected the reviewed supersession prompt/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('incremental save upgrade replaces exactly three guarded functions without changing access or executing writes', () => {
  const upgrade = read('supabase/releases/adaptive-search-incremental-saves-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.deepEqual([...installed.keys()].sort(), [
    'private.adaptive_batch_error(p_code text) RETURNS jsonb',
    'private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) RETURNS text',
    'private.submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb) RETURNS jsonb',
  ]);
  for (const [signature, body] of installed) {
    assert.equal(body, current.get(signature), `stale incremental upgrade: ${signature}`);
    assert.match(body, /SET search_path TO ''/u);
  }
  assert.doesNotMatch(upgrade, /SECURITY DEFINER|\bGRANT\b|\bREVOKE\b|\bALTER\b|\bDROP\b|CREATE TABLE/u);
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM)\b/iu, 'installing definitions must not mutate runs, results or scheduled tasks');
  assert.match(installation, /Install the single-response brief and supersession contracts first/u);
  assert.equal((installation.match(/Expected the reviewed response-handling predecessor/gmu) ?? []).length, 3);
  assert.equal((installation.match(/is distinct from '[a-f0-9]{32}'/gmu) ?? []).length, 3);
  const priorPrompt = [...definitions(read('supabase/releases/adaptive-search-response-handling-v1.sql')).values()][0]!;
  const priorBody = /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/u.exec(priorPrompt)?.[2];
  assert.ok(priorBody);
  assert.ok(installation.includes(createHash('md5').update(priorBody).digest('hex')), 'the prompt guard must accept the exact historical predecessor');
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});
