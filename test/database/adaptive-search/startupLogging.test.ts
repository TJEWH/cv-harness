import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql, sqlWithMessages } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral as json } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());
const project = 'abcdefghijklmnopqrst';
const marker = 'PRIVATE_STARTUP_CRITERIA';
function fixture() {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID();
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic logging',${json({ topicsAndMethods: marker })},
        '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"09:00","timezone":"UTC","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
    set local role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;commit;`);
  return { owner, search, run };
}
function cleanup(f: ReturnType<typeof fixture>) {
  sql(`delete from auth.users where id='${f.owner}';
    update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
}
type Log = Record<string, any>;
function capture(statement: string) {
  const captured = sqlWithMessages(`set client_min_messages=log; ${statement}`);
  const logs: Log[] = [...captured.messages.matchAll(/CV_HARNESS_STARTUP (\{[^\n]+\})/gu)].map(match => JSON.parse(match[1]!));
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|"criteria":|"feedback":|https:\/\/|SQLERRM|query_text/u);
  return { ...captured, logs };
}
const start = (search: string, run: string) => `select private.begin_adaptive_search_brief('${search}','${run}');`;

test('startup logs correlate entry and returned response without logging criteria or implying commit', () => {
  const f = fixture();
  try {
    const first = capture(start(f.search, f.run));
    const result = JSON.parse(first.output);
    assert.equal(result.compatible, true);
    assert.deepEqual(first.logs.map(log => log.event), ['entered', 'returned']);
    assert.ok(first.logs.every(log => log.search_id === f.search && log.run_id === f.run && log.diagnostic_version === 1));
    assert.equal(first.logs[1]!.compatible, true);
    assert.equal(first.logs[1]!.response_bytes, Buffer.byteLength(first.output));
    assert.deepEqual(JSON.parse(capture(start(f.search, f.run)).output), result, 'An identical retry must retain the same payload');
    const rolledBack = randomUUID();
    const observed = capture(`begin;${start(f.search, rolledBack)}rollback;`);
    assert.equal(observed.logs.at(-1)!.compatible, true);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${rolledBack}';`), '0');
    assert.equal(sql(`select status from public.opportunity_search_runs where id='${f.run}';`), 'running');
  } finally { cleanup(f); }
});

test('ordinary startup rejection logs its exact code even though no run is created', () => {
  const search = randomUUID(), run = randomUUID();
  const observed = capture(start(search, run));
  assert.equal(JSON.parse(observed.output).error.code, 'runner_disabled');
  assert.equal(observed.logs.at(-1)!.error_code, 'runner_disabled');
  assert.equal(observed.logs.at(-1)!.compatible, false);
  assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${run}';`), '0');
});

test('oversize diagnostics survive startup rollback and retain only section sizes', () => {
  const f = fixture();
  try {
    const criteria = Object.fromEntries(['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages',
      'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting']
      .map(key => [key, `${marker} `.repeat(400)]));
    sql(`update public.opportunity_search_templates set criteria=${json(criteria)},revision=revision+1 where id='${f.search}';`);
    const observed = capture(start(f.search, f.run));
    assert.equal(JSON.parse(observed.output).error.code, 'scope_oversized');
    const returned = observed.logs.at(-1)!;
    assert.equal(returned.error_code, 'scope_oversized');
    assert.equal(returned.sqlstate, '54000');
    assert.equal(returned.stage, 'response_bound');
    assert.ok(returned.size_diagnostics.response_bytes > 65536);
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${f.run}';`), '0');
    assert.equal(sql(`select count(*) from private.opportunity_search_adaptive_contexts where run_id='${f.run}';`), '0');
  } finally { cleanup(f); }
});

test('caught SQL failures keep their exact SQLSTATE and source location with the original public error mapping', () => {
  const f = fixture();
  const original = sql("select pg_get_functiondef('private.begin_opportunity_search(uuid,uuid)'::regprocedure);");
  try {
    for (const [state, code] of [['22023', 'invalid_bundle'], ['54000', 'scope_oversized'], ['54001', 'scope_oversized'],
      ['0A000', 'incompatible_release'], ['55000', 'restart_unavailable'], ['55P03', 'restart_unavailable'], ['42501', 'authorization_revoked']]) {
      sql(`create or replace function private.begin_opportunity_search(p_search_id uuid,p_run_id uuid) returns jsonb
        language plpgsql set search_path='' as $$begin
          raise exception 'PRIVATE injected failure https://example.invalid/?token=private' using errcode='${state}';
        end;$$;`);
      const observed = capture(start(f.search, f.run));
      assert.equal(JSON.parse(observed.output).error.code, code);
      const caught = observed.logs.find(log => log.event === 'caught_exception')!;
      assert.equal(caught.sqlstate, state);
      assert.equal(caught.function, 'private.begin_opportunity_search');
      assert.ok(Number.isInteger(caught.line));
      assert.equal(observed.logs.at(-1)!.error_code, code);
      assert.equal(sql(`select count(*) from public.opportunity_search_runs where id='${f.run}';`), '0');
    }
    for (const state of ['40P01', '57014']) {
      sql(`create or replace function private.begin_opportunity_search(p_search_id uuid,p_run_id uuid) returns jsonb
        language plpgsql set search_path='' as $$begin raise exception 'PRIVATE propagated failure' using errcode='${state}';end;$$;`);
      const propagated = capture(`do $$begin perform private.begin_adaptive_search_brief('${f.search}','${f.run}');
        raise exception 'Expected original exception';exception when sqlstate '${state}' then null;end;$$;`);
      assert.equal(propagated.logs.at(-1)!.event, 'exception');
      assert.equal(propagated.logs.at(-1)!.sqlstate, state);
    }
  } finally { sql(original); cleanup(f); }
});

test('logging upgrade preserves pinned response, function privileges, all unrelated functions and saved data', () => {
  const f = fixture();
  const signature = ['private.begin_adaptive_search_brief(uuid,uuid)', 'private.begin_adaptive_opportunity_search(uuid,uuid)'];
  const definitions = (source: string) => [...source.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)];
  const current = definitions(file('supabase/schemas/12_search_support.sql')).filter(match => signature.some(sig => match[1]!.startsWith(sig.split('(')[0]! + '('))).map(match => match[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')).join('\n');
  const predecessor = [...definitions(file('supabase/releases/adaptive-search-supersession-v1.sql')),
    ...definitions(file('supabase/releases/adaptive-search-evidence-fields-v1.sql'))];
  const previous = signature.map(sig => predecessor.findLast(match => match[1]!.startsWith(sig.split('(')[0]! + '('))![0]).join('\n');
  const properties = () => sql(`select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid)::text from pg_proc p where p.oid in(${signature.map(sig => `'${sig}'::regprocedure`).join(',')});`);
  const untouched = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid not in(${signature.map(sig => `'${sig}'::regprocedure`).join(',')});`);
  const snapshot = () => sql(`select jsonb_build_object('run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${f.run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}'));`);
  try {
    sql(previous);
    const response = sql(start(f.search, f.run)), before = snapshot(), access = properties(), others = untouched();
    sql(file('supabase/releases/adaptive-search-startup-logging-v1.sql'));
    assert.equal(snapshot(), before);
    assert.equal(properties(), access);
    assert.equal(untouched(), others);
    assert.equal(sql(start(f.search, f.run)), response);
    assert.equal(sql("select md5(prosrc) from pg_proc where oid='private.begin_adaptive_search_brief(uuid,uuid)'::regprocedure;"),
      sql(current + "select md5(prosrc) from pg_proc where oid='private.begin_adaptive_search_brief(uuid,uuid)'::regprocedure;"));
  } finally { sql(current); cleanup(f); }
});
