import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdaptiveSearchDashboardController } from '../../src/features/meta-search/composables/adaptiveSearchDashboard';
import { reset, sql } from './db';

before(() => reset());

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;

test('current authenticated dashboard controls save against a fresh installation and report missing runner configuration accurately', async () => {
  reset();
  const owner = randomUUID(), search = randomUUID(), source = randomUUID(), project = 'dddddddddddddddddddd';
  const scope = { ownerId: owner, searchId: search, projectRef: project };
  sql(`insert into auth.users(id) values(${quote(owner)});
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values(
      ${quote(search)},${quote(owner)},'Current dashboard controls','{"topicsAndMethods":"Acoustic sensing"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');`);
  const privateAcl = () => sql(`select jsonb_build_object('schema',nspacl::text,'functions',(
    select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proacl::text) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private')) from pg_namespace where nspname='private';`);
  const originalAcl = privateAcl();
  const originalTemplate = sql(`select to_jsonb(t) from public.opportunity_search_templates t where id=${quote(search)};`);
  const calls: { name: string; args: Record<string,unknown> }[] = [];
  let loseBreadthReply = false;
  // This adapter uses the actual current SQL under the authenticated role in
  // the labelled, network-disabled disposable fixture. Each RPC commits alone.
  const client = { rpc: async (name: string, args: Record<string,unknown>) => {
    calls.push({ name, args: structuredClone(args) });
    const statement = name === 'read_opportunity_search_dashboard'
      ? `public.read_opportunity_search_dashboard(${quote(String(args.p_search_id))}::uuid,${quote(String(args.p_project_ref))})`
      : name === 'patch_opportunity_search_settings'
        ? `public.patch_opportunity_search_settings(${quote(String(args.p_search_id))}::uuid,${quote(String(args.p_action_id))}::uuid,${json(args.p_patch)},${json(args.p_expected_revisions)})`
        : name === 'patch_opportunity_search_source'
          ? `public.patch_opportunity_search_source(${quote(String(args.p_search_id))}::uuid,${quote(String(args.p_registry_id))}::uuid,${quote(String(args.p_action_id))}::uuid,${json(args.p_patch)},${Number(args.p_expected_source_revision)})`
          : name === 'set_opportunity_search_runner_authorization'
            ? `public.set_opportunity_search_runner_authorization(${quote(String(args.p_search_id))}::uuid,${quote(String(args.p_project_ref))},${args.p_enabled === true},${Number(args.p_expected_revision)})`
            : assert.fail(`Unexpected fixture RPC ${name}`);
    const reply = JSON.parse(sql(`begin;
      do $$ begin perform set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true); end $$;
      set local role authenticated;
      do $rpc$ declare reply jsonb; begin
        begin reply:=jsonb_build_object('data',${statement},'error',null);
        exception when others then reply:=jsonb_build_object('data',null,'error',jsonb_build_object('code',sqlstate,'message',sqlerrm)); end;
        perform set_config('cv_test.rpc_reply',reply::text,true);
      end $rpc$;
      select current_setting('cv_test.rpc_reply'); commit;`));
    if (loseBreadthReply && name === 'patch_opportunity_search_settings' && (args.p_patch as Record<string,unknown>).search_breadth_percent !== undefined) {
      loseBreadthReply = false;
      assert.equal(reply.error,null);
      return { data: null, error: { code: 'NETWORK' } };
    }
    return reply;
  } } as unknown as Pick<SupabaseClient,'rpc'>;
  const controller = createAdaptiveSearchDashboardController(client,scope);
  try {
    assert.equal(await controller.load(),true);
    assert.equal(controller.state.data!.readiness.readiness_code,'release_disabled');
    assert.equal(await controller.authorize(true),false);
    assert.equal(controller.state.error,'runner_unavailable');
    assert.equal(controller.state.retryable,false);
    assert.equal(await controller.retry(),false);
    assert.equal(sql('select count(*) from public.opportunity_search_runner_authorizations;'),'0');
    assert.equal(await controller.load(),true);

    assert.equal(await controller.patchSettings({ adaptation_enabled: true, adaptation_paused: false }),true);
    assert.equal(await controller.patchSettings({ successful_source_reuse_enabled: true, reuse_check_interval_hours: 72 }),true);
    loseBreadthReply = true;
    assert.equal(await controller.patchSettings({ search_breadth_percent: 55 }),false);
    assert.equal(controller.state.retryable,true);
    assert.equal(await controller.retry(),true);
    const breadthCalls = calls.filter(call => call.name === 'patch_opportunity_search_settings' && (call.args.p_patch as Record<string,unknown>).search_breadth_percent !== undefined);
    assert.equal(breadthCalls.length,2);
    assert.deepEqual(breadthCalls[0]!.args,breadthCalls[1]!.args,'a lost response replays the same action identity, patch and CAS basis');
    const settings = controller.state.data!.settings;
    assert.equal(settings.adaptation_enabled,true);
    assert.equal(settings.adaptation_revision,1);
    assert.equal(settings.successful_source_reuse_enabled,true);
    assert.equal(settings.reuse_check_interval_hours,72);
    assert.equal(settings.source_reuse_revision,1);
    assert.equal(settings.search_breadth_percent,55);
    assert.equal(settings.breadth_revision,1);
    assert.equal(controller.state.data!.runner_authorization.enabled,false,'saving settings never authorizes execution');

    sql(`begin; do $$ begin perform set_config('request.jwt.claims',${json({ sub: owner, is_anonymous: false })}::text,true); end $$;
      set local role authenticated; select public.save_opportunity_search_source(${quote(search)},${quote(source)},
        '{"listing_url":"https://example.invalid/Jobs","enabled":true}'); commit;`);
    assert.equal(await controller.load(),true);
    controller.sourceDraft(source,{ pinned: true, check_interval_hours: 48 });
    assert.equal(await controller.saveSource(source),true);
    assert.equal(controller.state.data!.sources[0]!.pinned,true);
    assert.equal(controller.state.data!.sources[0]!.check_interval_hours,48);

    sql(`update public.opportunity_search_adaptive_release set project_ref=${quote(project)},enabled=true where singleton;`);
    assert.equal(await controller.load(),true);
    assert.equal(controller.state.data!.readiness.readiness_code,'owner_not_authorized');
    assert.equal(await controller.authorize(true),true);
    assert.equal(controller.state.data!.runner_authorization.enabled,true);
    assert.equal(controller.state.data!.readiness.ready,true);
    assert.equal(await controller.authorize(false),true);
    assert.equal(controller.state.data!.runner_authorization.enabled,false);
    assert.equal(controller.state.data!.runner_authorization.authorization_revision,2);

    assert.equal(privateAcl(),originalAcl,'authenticated controls never widen private schema or helper access');
    assert.equal(sql(`select to_jsonb(t) from public.opportunity_search_templates t where id=${quote(search)};`),originalTemplate,'controls preserve criteria, schedule and saved task text');
    assert.equal(sql('select count(*) from public.opportunity_search_runs;'),'0','control saves do not execute research');
  } finally { controller.dispose(); }
});
