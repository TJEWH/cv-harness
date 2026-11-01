import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral as json } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());
const project = 'abcdefghijklmnopqrst';
const signatures = ['private.begin_adaptive_search_brief(uuid,uuid)', 'private.adaptive_search_recurring_prompt(uuid,text)'];
const query = (statement: string) => JSON.parse(sql(statement));
const definitions = (source: string) => [...source.matchAll(
  /^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu,
)];
const definition = (source: string, name: string) => {
  const match = definitions(source).find(entry => entry[1]!.startsWith(name + '('));
  assert.ok(match, `Missing fixture definition: ${name}`);
  return match[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
};
function fixture() {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID();
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values('${search}','${owner}','Synthetic brief-limit upgrade','{"topicsAndMethods":"Synthetic sensing 音響🧠"}',
        '{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
    update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
    begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
    set local role authenticated;
    select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
    reset role;commit;
    insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
      select id,user_id,'synthetic-existing-task-${search}',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1'
      from public.opportunity_search_templates where id='${search}';`);
  return { owner, search, run };
}
function cleanup(f: ReturnType<typeof fixture>) {
  sql(`delete from auth.users where id='${f.owner}';
    update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
}
const startup = (f: ReturnType<typeof fixture>) => `select private.begin_adaptive_search_brief('${f.search}','${f.run}');`;

test('96 KiB upgrade changes only the response limit and future task instruction while preserving an existing pin and schedule', () => {
  const f = fixture();
  const current = signatures.map(signature => sql(`select pg_get_functiondef('${signature}'::regprocedure);`)).join(';\n') + ';';
  const previous = definition(file('supabase/releases/adaptive-search-startup-logging-v1.sql'), 'private.begin_adaptive_search_brief')
    + '\n' + definition(file('supabase/releases/adaptive-search-standalone-saves-v1.sql'), 'private.adaptive_search_recurring_prompt');
  const properties = () => sql(`select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) from pg_proc p
    where p.oid in(${signatures.map(signature => `'${signature}'::regprocedure`).join(',')});`);
  const untouched = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid not in(${signatures.map(signature => `'${signature}'::regprocedure`).join(',')});`);
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${f.run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${f.search}'),
    'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${f.search}'),
    'settings',(select to_jsonb(s) from public.opportunity_search_adaptive_settings s where search_id='${f.search}'),
    'snapshots',(select jsonb_agg(to_jsonb(s) order by feedback_revision) from public.opportunity_search_feedback_snapshots s where search_id='${f.search}'));`);
  const prompt = () => sql(`select private.adaptive_search_recurring_prompt('${f.search}','${project}');`);
  try {
    sql(previous);
    const old = query(startup(f));
    assert.equal(old.compatible, true);
    assert.equal(old.response_limit_bytes, 65_536);
    const saved = snapshot(), access = properties(), others = untouched(), oldPrompt = prompt();
    const upgrade = file('supabase/releases/adaptive-search-brief-limit-v1.sql');
    sql(upgrade);
    assert.equal(snapshot(), saved, 'Installing the size limit changed an existing run, feedback snapshot or schedule');
    assert.equal(properties(), access, 'The limit change must not alter privileges or execution properties');
    assert.equal(untouched(), others, 'The limit change altered an unrelated function');
    const updated = query(startup(f));
    assert.deepEqual(updated, { ...old, response_limit_bytes: 98_304 }, 'The complete response changed beyond its advertised limit');
    assert.equal(snapshot(), saved, 'The existing run lost or rewrote its pinned research context');
    assert.equal(prompt(), oldPrompt.replace('response_limit_bytes=65536', 'response_limit_bytes=98304'));
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${f.search}';`), '1');
    assert.throws(() => sql(upgrade), /predecessor|already installed/iu);
    assert.equal(snapshot(), saved, 'A repeated installation changed saved state');
  } finally {
    try { sql(current); } finally { cleanup(f); }
  }
});

test('the outward brief accepts exactly 98,304 UTF-8 bytes and rejects one byte more without trimming content', () => {
  const f = fixture();
  const original = sql("select pg_get_functiondef('private.begin_adaptive_opportunity_search(uuid,uuid)'::regprocedure);");
  try {
    // Freeze an actual validated bundle to make timestamp widths stable. This
    // test-only helper isolates the outward byte boundary from the inner builder.
    const frozen = query(`select private.begin_adaptive_opportunity_search('${f.search}','${f.run}');`);
    assert.equal(frozen.compatible, true);
    const keys = ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions',
      'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'];
    frozen.base.criteria = Object.fromEntries(keys.map(key => [key, '']));
    const install = () => sql(`create or replace function private.begin_adaptive_opportunity_search(p_search_id uuid,p_run_id uuid)
      returns jsonb language sql set search_path='' as $fixture$select ${json(frozen)};$fixture$;`);
    install();
    let remaining = 98_304 - Buffer.byteLength(sql(startup(f)));
    assert.ok(remaining > 0);
    for (const key of keys) {
      const bytes = Math.min(remaining, 24_000);
      frozen.base.criteria[key] = '界'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3);
      assert.ok(Array.from(frozen.base.criteria[key]).length <= 12_000);
      remaining -= bytes;
    }
    assert.equal(remaining, 0);
    install();
    const exact = sql(startup(f));
    const accepted = JSON.parse(exact);
    assert.equal(accepted.compatible, true, exact);
    assert.equal(Buffer.byteLength(exact), 98_304, 'The fixture must hit the exact UTF-8 boundary');
    assert.deepEqual(accepted.base.criteria, frozen.base.criteria);
    const stored = sql(`select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}';`);
    frozen.base.criteria.topicsAndMethods += 'x';
    install();
    const rejected = query(startup(f));
    assert.equal(rejected.error.code, 'scope_oversized');
    assert.equal(rejected.response_limit_bytes, 98_304);
    assert.equal(rejected.size_diagnostics.response_bytes, 98_305);
    assert.equal(sql(`select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${f.run}';`), stored);
  } finally {
    try { sql(original); } finally { cleanup(f); }
  }
});
