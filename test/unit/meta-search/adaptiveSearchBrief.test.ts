import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ADAPTIVE_BRIEF_MAX_BYTES, buildAdaptiveStartupBriefSql } from '../../../src/features/meta-search/domain/adaptiveSearchBrief';
import { buildAdaptiveRecurringSearchPrompt } from '../../../src/features/meta-search/domain/adaptiveSearchTask';

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

test('96-KiB startup changes only the response bound and the matching recurring requirement', () => {
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  const upgrade = read('supabase/releases/adaptive-search-brief-limit-v1.sql');
  const installed = definitions(upgrade);
  const brief = 'private.begin_adaptive_search_brief(p_search_id uuid, p_run_id uuid) RETURNS jsonb';
  const prompt = 'private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) RETURNS text';
  assert.equal(ADAPTIVE_BRIEF_MAX_BYTES, 96 * 1024);
  assert.deepEqual([...installed.keys()].sort(), [brief, prompt].sort());
  assert.equal(installed.get(brief), definitions(read('supabase/releases/adaptive-search-startup-logging-v1.sql'))
    .get(brief)!.replaceAll('65536', String(ADAPTIVE_BRIEF_MAX_BYTES)));
  assert.equal(installed.get(prompt), definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql'))
    .get(prompt)!.replace('response_limit_bytes=65536', `response_limit_bytes=${ADAPTIVE_BRIEF_MAX_BYTES}`));
  const latest = definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'));
  assert.equal(latest.get(brief), current.get(brief));
  assert.equal(latest.get(prompt), current.get(prompt));
  const instructions = buildAdaptiveRecurringSearchPrompt(scope.search_id, scope.project_ref);
  assert.ok(instructions.includes(`response_limit_bytes=${ADAPTIVE_BRIEF_MAX_BYTES}`));
  assert.ok(!instructions.includes('response_limit_bytes=65536'));
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM|ALTER|GRANT|REVOKE|DROP)\b/iu);
  assert.equal((installation.match(/Expected the reviewed 64-KiB startup predecessor/gu) ?? []).length, 2);
});

test('inline response codec upgrade replaces only the recurring formatter behind its exact historical guard', () => {
  const upgrade = read('supabase/releases/adaptive-search-inline-codec-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  const prompt = 'private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) RETURNS text';
  assert.deepEqual([...installed.keys()], [prompt]);
  assert.notEqual(installed.get(prompt), current.get(prompt), 'the immutable codec installer predates direct connector instructions');
  const predecessor = definitions(read('supabase/releases/adaptive-search-hosted-codec-v1.sql')).get(prompt)!;
  const body = /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/u.exec(predecessor)![2]!;
  assert.equal(createHash('md5').update(body).digest('hex'), 'f0f1107bfb90554396b1ab6f12944f9f');
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.match(installation, /is distinct from 'f0f1107bfb90554396b1ab6f12944f9f'/u);
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM|ALTER|GRANT|REVOKE|DROP|CALL)\b/iu);
  assert.match(installed.get(prompt)!, /LANGUAGE plpgsql IMMUTABLE\n\s+SET search_path TO ''/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('targeted brief upgrade matches current definitions and grants no app-role access', () => {
  const upgrade = read('supabase/releases/adaptive-search-brief-v1.sql');
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  const installed = definitions(upgrade);
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-supersession-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-response-handling-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-batch-diagnostics-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-evidence-fields-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-startup-logging-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-brief-limit-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-hosted-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-inline-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'))]);
  assert.equal(installed.size, 3);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature), `stale brief upgrade: ${signature}`);
  assert.match(upgrade, /octet_length\(brief::text\)>65536/u);
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
    ...definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-batch-diagnostics-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-evidence-fields-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-startup-logging-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-brief-limit-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-hosted-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-inline-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'))]);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature), `stale replacement upgrade: ${signature}`);
  assert.match(upgrade, /ADD COLUMN superseded_by_run_id uuid/u);
  assert.match(upgrade, /FOREIGN KEY \(user_id,search_id,superseded_by_run_id\)[\s\S]*?REFERENCES public\.opportunity_search_runs\(user_id,search_id,id\) DEFERRABLE INITIALLY DEFERRED/u);
  assert.doesNotMatch(upgrade, /DROP TABLE|GRANT |SECURITY DEFINER/u);
  assert.match(upgrade, /Supersession installation already exists/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('historical response-handling upgrade keeps its original contract before the incremental override', () => {
  const upgrade = read('supabase/releases/adaptive-search-response-handling-v1.sql');
  const installed = definitions(upgrade), incremental = definitions(read('supabase/releases/adaptive-search-incremental-saves-v1.sql'));
  const later = new Map([...incremental, ...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-brief-limit-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-hosted-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-inline-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'))]);
  const current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.equal(installed.size, 1);
  for (const [signature, body] of installed) {
    assert.match(body, /Keep each complete raw connector response unchanged before decoding/u);
    assert.match(body, /outer \{text: \.\.\.\} with or without type:"text"/u);
    assert.match(body, /share one startup retry budget/u);
    assert.doesNotMatch(body, /MISSING BATCH RECEIPT/u);
    assert.notEqual(incremental.get(signature), body, 'the historical prompt must remain immutable');
    assert.match(incremental.get(signature)!, /MISSING BATCH RECEIPT/u, 'the original incremental override remains intact');
    assert.equal(later.get(signature), current.get(signature), 'the ordered upgrades install the current prompt');
  }
  assert.doesNotMatch(upgrade, /ALTER TABLE|DROP |GRANT |REVOKE |SECURITY DEFINER|UPDATE public\.|DELETE FROM/u);
  assert.match(upgrade, /Expected the reviewed supersession prompt/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('incremental save upgrade replaces exactly three guarded functions without changing access or executing writes', () => {
  const upgrade = read('supabase/releases/adaptive-search-incremental-saves-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-batch-diagnostics-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-brief-limit-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-hosted-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-inline-codec-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'))]);
  assert.deepEqual([...installed.keys()].sort(), [
    'private.adaptive_batch_error(p_code text) RETURNS jsonb',
    'private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) RETURNS text',
    'private.submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb) RETURNS jsonb',
  ]);
  for (const [signature, body] of installed) {
    assert.equal(later.get(signature) ?? body, current.get(signature), `stale incremental upgrade: ${signature}`);
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

test('batch diagnostics upgrade adds bounded owner-scoped metadata without changing hosted instructions or access', () => {
  const upgrade = read('supabase/releases/adaptive-search-batch-diagnostics-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.deepEqual([...installed.keys()].sort(), [
    'private.opportunity_search_schema_error_path(v jsonb, s jsonb, root_schema jsonb, depth integer DEFAULT 0) RETURNS text',
    'private.submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb) RETURNS jsonb',
  ]);
  const later = new Map([...definitions(read('supabase/releases/adaptive-search-standalone-saves-v1.sql')),
    ...definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql'))]);
  for (const [signature, body] of installed) assert.equal(later.get(signature) ?? body, current.get(signature));
  assert.match(upgrade, /ADD COLUMN last_batch_rejection jsonb/u);
  assert.match(upgrade, /octet_length\(last_batch_rejection::text\)<=2048/u);
  assert.match(upgrade, /REVOKE ALL ON FUNCTION private\.opportunity_search_schema_error_path\(jsonb,jsonb,jsonb,integer\) FROM PUBLIC,anon,authenticated,service_role/u);
  assert.doesNotMatch(upgrade, /SECURITY DEFINER|\bGRANT\b|RAISE LOG|RAISE WARNING|CREATE TABLE/u);
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM)\b/iu);
  assert.match(installation, /Expected the reviewed incremental-saves predecessor/u);
  assert.match(installation, /Batch diagnostics installation already exists or is partial/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});

test('evidence guidance upgrade changes only the bounded brief and preserves validation and internal pins', () => {
  const upgrade = read('supabase/releases/adaptive-search-evidence-fields-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.deepEqual([...installed.keys()], ['private.begin_adaptive_search_brief(p_search_id uuid, p_run_id uuid) RETURNS jsonb']);
  for (const [signature, body] of installed) assert.equal(definitions(read('supabase/releases/adaptive-search-current-saves-v1.sql')).get(signature) ?? body, current.get(signature));
  assert.match(upgrade, /EVIDENCE FIELD NAMES/u);
  assert.match(upgrade, /jsonb_object_keys\(private\.opportunity_storage_schema\(\)->'properties'\)/u);
  assert.match(upgrade, /octet_length\(brief::text\)>65536/u);
  assert.doesNotMatch(upgrade, /SECURITY DEFINER|\bGRANT\b|\bREVOKE\b|\bALTER\b|\bDROP\b|CREATE TABLE/u);
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM)\b/iu);
  assert.match(installation, /Expected the reviewed supersession brief predecessor/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});


test('current saving upgrade replaces only guarded definitions and keeps private helpers closed', () => {
  const upgrade = read('supabase/releases/adaptive-search-current-saves-v1.sql');
  const installed = definitions(upgrade), current = definitions(read('supabase/schemas/12_search_support.sql'));
  assert.equal(installed.size, 12);
  for (const [signature, body] of installed) {
    assert.equal(body, current.get(signature), `stale current save definition: ${signature}`);
    assert.match(body, /SET search_path TO ''/u);
  }
  const installation = upgrade.replace(functionDefinition, '').replace(/^--.*$/gmu, '');
  assert.equal((installation.match(/is distinct from '[a-f0-9]{32}'/gu) ?? []).length, 9);
  assert.equal((installation.match(/Current-saves installation already exists or is partial/gu) ?? []).length, 3);
  assert.doesNotMatch(installation, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|PERFORM|ALTER|GRANT|DROP|CALL)\b/iu);
  for (const signature of ['record_adaptive_search_coverage(uuid,uuid,jsonb)', 'finish_adaptive_search(uuid,jsonb)', 'adaptive_search_hosted_protocol_text()']) {
    assert.ok(upgrade.includes(`REVOKE ALL ON FUNCTION private.${signature} FROM PUBLIC,anon,authenticated,service_role;`));
  }
  for (const name of ['submit_adaptive_search_batch', 'verify_and_complete_adaptive_search']) {
    const body = [...installed].find(([signature]) => signature.startsWith(`private.${name}(`))![1];
    assert.match(body, /retired_contract/u);
    assert.doesNotMatch(body, /(?:INSERT INTO|UPDATE public\.|private\.save_adaptive_search_item|private\.finish_adaptive_search)/u);
  }
  assert.doesNotMatch(upgrade, /SECURITY DEFINER/u);
  assert.match(upgrade, /begin;[\s\S]*commit;\s*$/u);
});
