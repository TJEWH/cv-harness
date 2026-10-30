import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from './db';
import { adaptiveJsonSqlLiteral, buildAdaptiveSearchSqlCall, type AdaptiveBatchPayload } from '../../src/features/meta-search/domain/adaptiveSearchProtocol';

test('AF-08 atomic intake preserves canonical v5 and returns only safe pending-verification receipts', () => {
  reset({ searchProtocol: true });
  for (const path of ['opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql',
    'opportunity_feedback_projection.sql', 'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql',
    'opportunity_search_attribution.sql', 'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql',
    'opportunity_search_preferences.sql', 'opportunity_search_adaptation_sources.sql', 'opportunity_search_adaptive_startup.sql',
    'opportunity_search_adaptive_batches.sql', 'opportunity_search_adaptive_completion.sql']) sql(file(`../../supabase/${path}`));
  sql(file('../../supabase/tests/opportunity_search_adaptive_batches.sql'));
});

test('AF-08 completion independently verifies the full manifest, current state and terminal retries', () => {
  sql(file('../../supabase/tests/opportunity_search_adaptive_completion.sql'));
});

test('AF-08 JSON transport round-trips adversarial text as data in PostgreSQL', () => {
  const payload = { text: "O'Brien'); SELECT 'INJECTION_MARKER'; --", backslash: '\\path\\file\nline', quote: "\\'; SELECT 1; --", unicode: '研究 — BCI' };
  assert.deepEqual(JSON.parse(sql(`select ${adaptiveJsonSqlLiteral(payload)};`)), payload);
});

for (const batches of [1, 2]) test(`AF-08 ${batches} batch run uses exactly ${2 + batches} API calls across independent commits`, () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), query = randomUUID(), check = randomUUID();
  const project = 'abcdefghijklmnopqrst', scope = { project_ref: project, search_id: search, run_id: run };
  const batchIds = Array.from({ length: batches }, () => randomUUID());
  const item = randomUUID(), completion = randomUUID();
  // Fixture setup/teardown and postcondition assertions are outside the API
  // phase. Every API-phase request is exactly one fixed SELECT helper call.
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic batch budget','{"topicsAndMethods":"Acoustic sensing; BCI"}',
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    select set_config('request.jwt.claims','{"sub":"${owner}","is_anonymous":false}',false);
    set role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;`);
  const calls: string[] = [];
  const api = (call: ReturnType<typeof buildAdaptiveSearchSqlCall>) => {
    assert.equal(call.project_ref, project); calls.push(call.sql);
    return JSON.parse(sql(call.sql));
  };
  try {
    const startup = api(buildAdaptiveSearchSqlCall({ action: 'startup', scope }));
    assert.equal(startup.compatible, true, JSON.stringify(startup));
    assert.equal(startup.capabilities.batch, true); assert.equal(startup.capabilities.completion, true);
    const attempted = new Date().toISOString(), discovered = new Date().toISOString();
    const url = `https://example.invalid/Vacancy/${run}`;
    const first: AdaptiveBatchPayload = { schema_version: 1,
      query_plan: { schema_version: 2, queries: [{ query_id: query, query: 'synthetic acoustic sensing research', role: 'core', manual: false }] },
      opportunities: [{ item_id: item, opportunity: { opportunity_key: `af08-budget-${run}`, title: "Synthetic O'Brien acoustic research",
        institution: 'Example Institute', topics: ['Acoustic sensing'], official_url: url,
        deadline: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), deadline_time_local: '12:00:00', deadline_timezone: 'UTC',
        personal_fit: { score: 8, scale_min: 0, scale_max: 10, summary: 'Synthetic acoustic research alignment.' }, last_checked_at: discovered,
        sources: [{ url, kind: 'official', checked_at: discovered, precision: 'instant',
          supports: ['title', 'institution', 'topics', 'official_url', 'deadline', 'deadline_time_local', 'deadline_timezone', 'personal_fit'] }] },
      attribution: { execution_refs: [check], primary_check_id: check, discovered_at: discovered, encountered_at: discovered, recommendation_generated: true } }],
      execution: { checks: [{ check_id: check, kind: 'query', query_id: query, attempted_at: attempted, status: 'complete', results_count: 1 }], backlog: [], complete: true } };
    let receipt = api(buildAdaptiveSearchSqlCall({ action: 'batch', scope, batch_id: batchIds[0]!, payload: first }));
    assert.equal(receipt.verification_required, true, JSON.stringify(receipt));
    assert.equal(receipt.items.length, 1); assert.equal(receipt.items[0].outcome, 'saved');
    assert.match(receipt.plan_hash, /^[0-9a-f]{64}$/u);
    for (const batchId of batchIds.slice(1)) {
      receipt = api(buildAdaptiveSearchSqlCall({ action: 'batch', scope, batch_id: batchId,
        payload: { schema_version: 1, plan_hash: receipt.plan_hash, opportunities: [], execution: { checks: [], backlog: [], complete: true } } }));
      assert.equal(receipt.verification_required, true, JSON.stringify(receipt));
    }
    const finished = api(buildAdaptiveSearchSqlCall({ action: 'complete', scope, payload: { schema_version: 1, completion_id: completion,
      batch_ids: [...batchIds].sort(), manifest_hash: receipt.manifest_hash, status: 'complete' } }));
    assert.equal(calls.length, 2 + batches);
    assert.ok(calls.every(call => /^SELECT private\.(begin_adaptive_opportunity_search|submit_adaptive_search_batch|verify_and_complete_adaptive_search)\(/u.test(call)));
    assert.equal(finished.compatible, true, JSON.stringify(finished));
    assert.equal(finished.persisted_summary_read, true); assert.equal(finished.historical_summary.status, 'complete');
    assert.equal(finished.historical_summary.incomplete, false); assert.equal(finished.current_verification.all_saved_items_verified, true);
    assert.equal(finished.current_verification.verified_items, 1); assert.equal(finished.delivery_status, 'unknown');
    assert.doesNotMatch(JSON.stringify(finished), /O'Brien|current_snapshot|effective_fields|after_snapshot|contacts|private_comment/u);
    assert.equal(sql(`select count(*) from public.opportunity_search_receipts where run_id='${run}' and verified_at is not null;`), '1');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_batches where run_id='${run}';`), String(batches));
  } finally {
    sql(`delete from auth.users where id='${owner}';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
});
