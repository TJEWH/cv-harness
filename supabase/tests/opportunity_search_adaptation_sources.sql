-- AF-06 synthetic source learning: effective evidence and all consent gates.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); search_id_value uuid:=gen_random_uuid(); run_id_value uuid:=gen_random_uuid();
  item_id_value uuid:=gen_random_uuid(); opportunity_id_value uuid; registry_id_value uuid:=gen_random_uuid(); manual_id uuid:=gen_random_uuid();
  reply jsonb; retained jsonb; before_source jsonb; actual_title text:='Synthetic source-learning researcher';
  listing text:='https://example.invalid/Research/Jobs'; unchecked_listing text:='https://example.invalid/Unverified/Jobs';
  checked timestamptz:=clock_timestamp()-interval '1 second';
begin
  insert into auth.users(id) values(owner_id);
  insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
    values(search_id_value,owner_id,'Synthetic source learning','{"topicsAndMethods":"Physical sensing research"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
  perform private.begin_opportunity_search(search_id_value,run_id_value);
  perform private.save_opportunity_search_queries(run_id_value,'[{"query":"synthetic physical sensing research"}]');
  reply:=private.submit_opportunity_search_result(run_id_value,item_id_value,jsonb_build_object(
    'opportunity_key','af06-source-'||item_id_value,'title',actual_title,'official_url','https://example.invalid/Vacancy/AF06',
    'data','{"url_roles":{"official_url":"vacancy"}}'::jsonb,'last_checked_at',checked,
    'sources',jsonb_build_array(jsonb_build_object('url',listing,'kind','official_listing','checked_at',checked,
      'precision','instant','supports',jsonb_build_array('title','official_url','data')))));
  opportunity_id_value:=(reply->>'opportunity_id')::uuid;
  perform private.verify_opportunity_search_result(run_id_value,item_id_value);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  perform public.review_job_opportunity(opportunity_id_value,
    (select o.updated_at from public.opportunities o where o.id=opportunity_id_value),'strong_interest');
  perform public.set_opportunity_source_reuse(search_id_value,true,168);
  perform public.save_opportunity_search_source(search_id_value,manual_id,
    '{"listing_url":"https://example.invalid/Manual/Jobs","enabled":true,"pinned":true,"mandatory":true}');
  execute 'reset role';
  assert private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing) is null,
    'Source reuse bypassed structured feedback consent';
  execute 'set local role authenticated';

  execute 'reset role';
  assert private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing) is null,
    'Default-off adaptation performed automatic source learning';
  update public.opportunity_search_adaptive_settings s set adaptation_enabled=true where s.user_id=owner_id and s.search_id=search_id_value;
  insert into public.opportunity_search_sources(registry_id,user_id,search_id,listing_url,enabled,provenance,listing_verified_at,status,check_interval_hours)
    values(registry_id_value,owner_id,search_id_value,listing,false,'evidenced_listing',checked,'ready',24);
  retained:=private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing);
  assert retained->'enabled'='true'::jsonb and retained->'mandatory'='false'::jsonb
    and retained->>'listing_url'=listing,'An actively consented useful listing was not retained';
  registry_id_value:=(retained->>'registry_id')::uuid;
  assert retained->'check_interval_hours'='168'::jsonb,'A newly verified ready candidate ignored the opted-in reuse cadence';
  assert retained->'last_attempted_at'='null'::jsonb and retained->'last_successful_at'='null'::jsonb,
    'Source learning invented an executed check';
  select to_jsonb(s) into before_source from public.opportunity_search_sources s where s.registry_id=registry_id_value;

  update public.opportunity_search_adaptive_settings s set adaptation_paused=true where s.user_id=owner_id and s.search_id=search_id_value;
  assert private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing) is null,
    'Paused adaptation learned from private outcomes';
  assert (select to_jsonb(s)=before_source from public.opportunity_search_sources s where s.registry_id=registry_id_value),
    'Pausing adaptation rewrote retained source history';
  assert exists(select 1 from jsonb_array_elements(private.due_opportunity_search_sources(owner_id,search_id_value,clock_timestamp())) d
    where d->>'registry_id'=manual_id::text),'Pausing adaptation disabled an explicit mandatory source';
  update public.opportunity_search_adaptive_settings s set adaptation_paused=false where s.user_id=owner_id and s.search_id=search_id_value;

  -- A historical source claim, including an official-looking one, cannot bless
  -- a listing that did not supply the effective title evidence.
  update public.opportunities o set sources=o.sources||jsonb_build_array(jsonb_build_object('source_id','rejected-claim',
    'url',unchecked_listing,'kind','official_listing','checked_at',checked,'precision','instant','supports',jsonb_build_array('title')))
    where o.id=opportunity_id_value;
  assert private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,unchecked_listing) is null,
    'A historical/rejected claim became verified reusable evidence';
  update public.opportunities o set title='Synthetic out-of-band title' where o.id=opportunity_id_value;
  assert private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing) is null,
    'Stale evidence was applied to a different effective title';
  update public.opportunities o set title=actual_title where o.id=opportunity_id_value;
  execute 'set local role authenticated';
  perform public.save_opportunity_search_source(search_id_value,registry_id_value,'{"enabled":false}');
  execute 'reset role';
  retained:=private.retain_successful_opportunity_source(owner_id,search_id_value,opportunity_id_value,listing);
  assert retained->'owner_disabled'='true'::jsonb and retained->'enabled'='false'::jsonb,
    'Learning overrode an explicit owner source disable';
  assert (select count(*)=1 from public.opportunities o where o.id=opportunity_id_value),
    'Source learning altered the canonical opportunity identity';
end;
$$;
rollback;
