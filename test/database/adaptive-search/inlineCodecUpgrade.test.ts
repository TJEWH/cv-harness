import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral as json } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());
const project = 'abcdefghijklmnopqrst';
const signature = 'private.adaptive_search_recurring_prompt(uuid,text)';
const query = (statement: string) => JSON.parse(sql(statement));
const definition = (source: string) => {
  const match = [...source.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu)]
    .find(entry => entry[1]!.startsWith('private.adaptive_search_recurring_prompt('));
  assert.ok(match, 'Missing recurring-prompt definition');
  return match[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
};

test('inline codec upgrade removes mandatory host storage while preserving research, schedules and complete setup', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), oldSetup = randomUUID(), nextSetup = randomUUID();
  const current = sql(`select pg_get_functiondef('${signature}'::regprocedure);`) + ';';
  const properties = () => sql(`select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='${signature}'::regprocedure;`);
  const untouched = () => sql(`select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.oid<>'${signature}'::regprocedure;`);
  const snapshot = () => sql(`select jsonb_build_object(
    'run',(select to_jsonb(r) from public.opportunity_search_runs r where id='${run}'),
    'context',(select to_jsonb(c) from private.opportunity_search_adaptive_contexts c where run_id='${run}'),
    'template',(select to_jsonb(t) from public.opportunity_search_templates t where id='${search}'),
    'binding',(select to_jsonb(b) from public.opportunity_search_schedule_bindings b where search_id='${search}'),
    'settings',(select to_jsonb(s) from public.opportunity_search_adaptive_settings s where search_id='${search}'),
    'snapshots',(select jsonb_agg(to_jsonb(s) order by feedback_revision) from public.opportunity_search_feedback_snapshots s where search_id='${search}'),
    'old_setup',(select to_jsonb(o) from private.opportunity_search_setup_operations o where setup_id='${oldSetup}'));`);
  const startup = () => query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
  const handoff = (setup: string) => query(`select private.read_adaptive_search_setup('${search}','${setup}','${project}');`);
  try {
    sql(definition(file('supabase/releases/adaptive-search-hosted-codec-v1.sql')));
    assert.equal(sql(`select md5(prosrc) from pg_proc where oid='${signature}'::regprocedure;`), 'f0f1107bfb90554396b1ab6f12944f9f');
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
        values('${search}','${owner}','Synthetic inline-codec upgrade','{"topicsAndMethods":"Synthetic sensing 音響🧠"}',
          '{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
      set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
      reset role;commit;
      insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
        values('${owner}','${search}','${project}','adaptive',false,'${randomUUID()}');
      insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability)
        select id,user_id,'synthetic-existing-task-${search}',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1'
        from public.opportunity_search_templates where id='${search}';`);
    const pinned = startup(), previous = handoff(oldSetup);
    assert.equal(pinned.compatible, true);
    assert.equal(previous.compatible, true);
    assert.ok(previous.recurringPrompt.includes('createCVResponseCodec(io)'));
    assert.ok(previous.recurringPrompt.includes('storage/readback is unavailable'));
    const saved = snapshot(), access = properties(), others = untouched();
    const upgrade = file('supabase/releases/adaptive-search-inline-codec-v1.sql');
    sql(upgrade);
    assert.equal(properties(), access, 'Codec installation changed execution privileges or properties');
    assert.equal(untouched(), others, 'Codec installation changed an unrelated database function');
    assert.equal(snapshot(), saved, 'Codec installation changed pinned research, saved feedback or schedule data');
    assert.deepEqual(startup(), pinned, 'The adaptive startup contents must remain byte-equivalent as JSON');
    assert.equal(snapshot(), saved, 'Reading the same run rewrote pinned research');
    assert.equal(handoff(oldSetup).error.code, 'setup_stale', 'An old setup must not silently publish the mandatory-storage prompt');

    const updated = handoff(nextSetup), expected = query(`select to_jsonb(private.adaptive_search_recurring_prompt('${search}','${project}'));`);
    const historicalSource = /\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/u.exec(definition(upgrade))![2]!;
    assert.equal(sql(`select md5(prosrc) from pg_proc where oid='${signature}'::regprocedure;`), createHash('md5').update(historicalSource).digest('hex'));
    assert.equal(updated.compatible, true, JSON.stringify(updated));
    assert.equal(updated.recurringPrompt, expected, 'The historical setup must carry exactly its reviewed inline codec prompt');
    assert.ok(expected.includes('codec.decode(raw,column)'));
    assert.ok(!expected.includes('createCVResponseCodec(io)'));
    assert.ok(!expected.includes('codec.capture('));
    assert.ok(!expected.includes('storage/readback is unavailable'));
    assert.equal(updated.recurring_prompt_hash, createHash('sha256').update(expected).digest('hex'));
    assert.deepEqual(updated.schedule, previous.schedule);
    assert.deepEqual(updated.target, previous.target);
    assert.equal(updated.lifecycle.phase, 'setup');
    assert.equal(updated.lifecycle.research_after_ack.requires_acknowledged, true);
    assert.equal(updated.lifecycle.research_after_ack.run_id, nextSetup);
    const handoffBytes = Number(sql(`select octet_length(handoff::text) from private.opportunity_search_setup_operations where setup_id='${nextSetup}';`));
    assert.ok(handoffBytes > Buffer.byteLength(expected));
    assert.ok(handoffBytes <= 65_536, `Executable setup handoff exceeds its unchanged byte bound: ${handoffBytes}`);
    assert.equal(snapshot(), saved, 'Preparing fresh setup changed existing runs, research or schedule binding');
    assert.equal(sql(`select count(*) from public.opportunity_search_runs where search_id='${search}';`), '1');
    assert.throws(() => sql(upgrade), /predecessor|already installed/iu);
    assert.equal(snapshot(), saved, 'Repeated codec installation changed existing state');
  } finally {
    try { sql(current); } finally {
      sql(`delete from auth.users where id='${owner}';
        update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
    }
  }
});
