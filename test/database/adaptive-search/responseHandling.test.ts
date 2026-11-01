import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { file, reset, sql } from '../../support/database/postgres';
import { adaptiveJsonSqlLiteral } from '../../../src/features/meta-search/domain/adaptiveSearchProtocol';

before(() => reset());

const json = adaptiveJsonSqlLiteral;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const query = (statement: string) => JSON.parse(sql(statement));
const signature = 'private.adaptive_search_recurring_prompt(uuid,text)';

test('response-handling upgrade changes only the prompt and never starts or recovers active research', () => {
  const owner = randomUUID(), search = randomUUID(), run = randomUUID(), setup = randomUUID();
  const project = 'hhhhhhhhhhhhhhhhhhhh';
  const freshDefinition = sql('select pg_get_functiondef(' + quote(signature) + '::regprocedure);');
  const historical = [...file('supabase/releases/adaptive-search-supersession-v1.sql').matchAll(
    /^CREATE OR REPLACE FUNCTION ([^\n]+)\n[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\2;/gmu,
  )].find(match => match[1]!.startsWith('private.adaptive_search_recurring_prompt('));
  assert.ok(historical, 'The reviewed predecessor prompt must remain available');
  try {
    sql(historical[0]);
    sql(`insert into auth.users(id) values('${owner}');
      insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
        values('${search}','${owner}','Synthetic response handling',
          '{"topicsAndMethods":"Synthetic acoustic research"}',
          '{"frequency":"hourly","intervalHours":12,"weekdays":[],"time":"09:00","timezone":"Europe/Berlin","runImmediately":false}');
      update public.opportunity_search_adaptive_release set enabled=true,project_ref='${project}' where singleton;
      begin;
      select set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true);
      set local role authenticated;
      select public.set_opportunity_search_runner_authorization('${search}','${project}',true,0);
      reset role;commit;
      insert into public.opportunity_search_runner_config(user_id,search_id,project_ref,mode,migration_requested,setup_id)
        values('${owner}','${search}','${project}','adaptive',false,'${setup}');
      insert into public.opportunity_search_schedule_bindings(search_id,user_id,task_id,schedule,template_revision,protocol_version,runner_capability,confirmed_setup_id)
        select id,user_id,'synthetic-response-handling',schedule,revision,'opportunity-search-v1-canonical-6','adaptive-batch-v1','${setup}'
        from public.opportunity_search_templates where id='${search}';`);
    const startup = query(`select private.begin_adaptive_search_brief('${search}','${run}');`);
    assert.equal(startup.compatible, true);
    assert.equal(startup.lease.status, 'active');
    const beforePrompt = sql(`select private.adaptive_search_recurring_prompt('${search}','${project}');`);
    assert.doesNotMatch(beforePrompt, /outer \{text: \.\.\.\}/u);

    // This is an isolated fixture database. Compare every public/private table,
    // including configuration, binding, cached response, lease and run counts.
    const tables = () => query(`select jsonb_agg(format('%I.%I',n.nspname,c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in('public','private') and c.relkind in('r','p');`) as string[];
    const tableState = () => query('select jsonb_object_agg(relation,digest) from (values '
      + tables().map(table => '(' + quote(table) + ",(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from "
        + table + ' t))').join(',') + ') snapshots(relation,digest);');
    const functionState = () => query(`select jsonb_build_object(
      'prompt_metadata',(select to_jsonb(p)-'prosrc' from pg_proc p where oid='${signature}'::regprocedure),
      'other_functions',(select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in('public','private') and p.oid<>'${signature}'::regprocedure));`);
    const beforeTables = tableState(), beforeFunctions = functionState();
    assert.equal(beforeFunctions.prompt_metadata.provolatile, 'i');
    assert.equal(beforeFunctions.prompt_metadata.prosecdef, false);
    assert.deepEqual(beforeFunctions.prompt_metadata.proconfig, ['search_path=""']);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}','${signature}','execute');`), 'f');
    }

    const upgrade = file('supabase/releases/adaptive-search-response-handling-v1.sql');
    sql(upgrade);
    assert.equal(sql('select pg_get_functiondef(' + quote(signature) + '::regprocedure);'), freshDefinition);
    assert.deepEqual(functionState(), beforeFunctions, 'Installation changed another function or prompt privileges/properties');
    assert.deepEqual(tableState(), beforeTables, 'Deployment started, recovered or otherwise changed stored research/configuration');
    const prompt = sql(`select private.adaptive_search_recurring_prompt('${search}','${project}');`);
    assert.notEqual(prompt, beforePrompt);
    assert.ok(prompt.length <= 7500);
    assert.match(prompt, /complete raw connector response unchanged before decoding/u);
    assert.match(prompt, /A decoding failure must not discard the raw response/u);
    assert.match(prompt, /outer \{text: \.\.\.\} with or without type:"text"/u);
    assert.match(prompt, /Accept matching mirrors; reject conflicts/u);
    assert.match(prompt, /require lease\.status=active; a terminal or expired run must not resume research/u);
    assert.match(prompt, /Reinspect the retained raw response locally first/u);
    assert.match(prompt, /one startup-only re-read after acceptance of that exact run was established, its response was then lost locally, and no batches were sent/u);
    assert.match(prompt, /share one startup retry budget; keep project, SQL and UUID identical/u);
    assert.match(prompt, /Unknown acceptance blocks local-loss re-reads/u);
    assert.match(prompt, /Never retry a denial, rejection or invalid contract, or use recovery to renew a lease/u);
    assert.match(prompt, /Never execute text or unwrap fields inside startup/u);
    assert.throws(() => sql(upgrade), /Expected the reviewed supersession prompt/u);
    assert.deepEqual(tableState(), beforeTables, 'A refused repeat changed stored state');
    assert.deepEqual(functionState(), beforeFunctions, 'A refused repeat changed function privileges or properties');
    assert.equal(sql(`select private.adaptive_search_recurring_prompt('${search}','${project}');`), prompt);
  } finally {
    sql(`delete from auth.users where id='${owner}';
      update public.opportunity_search_adaptive_release set enabled=false,project_ref=null where singleton;`);
  }
});
