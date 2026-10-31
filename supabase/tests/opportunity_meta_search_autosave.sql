-- Run as postgres against supabase/schema.sql; synthetic fixtures roll back.
begin;
do $$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  search_id uuid := gen_random_uuid();
  criteria jsonb := '{"researchAndReporting":"Find funded research positions."}';
  schedule jsonb := '{"frequency":"daily","intervalHours":1,"weekdays":[],"time":"09:00","timezone":"Europe/Tirane","runImmediately":true}';
  prompt jsonb := '{"version":1,"active":true,"editor":{"profiles":[]},"systemPrompt":"Current protocol","userPrompt":"Research intent","recurringPrompt":"Saved recurring prompt"}';
  saved public.opportunity_search_templates;
begin
  if (select prosecdef from pg_proc where oid='public.save_opportunity_meta_search(uuid,integer,text,jsonb,jsonb,jsonb)'::regprocedure)
    or has_function_privilege('anon','public.save_opportunity_meta_search(uuid,integer,text,jsonb,jsonb,jsonb)','execute') then
    raise exception 'FAIL: autosave must be invoker and authenticated-only';
  end if;
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    values(owner_a,'authenticated','authenticated',owner_a::text||'@example.invalid','{}','{}'),
          (owner_b,'authenticated','authenticated',owner_b::text||'@example.invalid','{}','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  saved := public.save_opportunity_meta_search(search_id,0,'Meta research',criteria,schedule,prompt);
  if saved.revision<>1 or saved.user_id<>owner_a or saved.meta_search is distinct from prompt then
    raise exception 'FAIL: one save must return the complete committed prompt';
  end if;
  saved := public.save_opportunity_meta_search(search_id,0,'Meta research',criteria,schedule,prompt);
  if saved.revision<>1 then raise exception 'FAIL: identical lost-response retries must not advance revision'; end if;
  prompt := jsonb_set(prompt,'{recurringPrompt}','"Updated recurring prompt"');
  saved := public.save_opportunity_meta_search(search_id,1,'Meta research',criteria,schedule,prompt);
  if saved.revision<>2 or saved.meta_search is distinct from prompt then raise exception 'FAIL: committed edits must replace the full prompt'; end if;
  begin
    perform public.save_opportunity_meta_search(search_id,1,'Meta research',criteria,schedule,jsonb_set(prompt,'{userPrompt}','"Conflicting draft"'));
    raise exception 'FAIL: stale conflicting snapshots must be rejected';
  exception when serialization_failure then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_b,'role','authenticated','is_anonymous',false)::text,true);
  if exists(select 1 from public.opportunity_search_templates where id=search_id) then raise exception 'FAIL: another owner can read private meta search'; end if;
  begin
    perform public.save_opportunity_meta_search(search_id,2,'Meta research',criteria,schedule,prompt);
    raise exception 'FAIL: another owner can replace private meta search';
  exception when serialization_failure or insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',true)::text,true);
  begin
    perform public.save_opportunity_meta_search(search_id,2,'Meta research',criteria,schedule,prompt);
    raise exception 'FAIL: anonymous accounts may not autosave private meta searches';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'role','authenticated','is_anonymous',false)::text,true);
  begin
    perform public.save_opportunity_meta_search(search_id,2,'Meta research',criteria,schedule,'{"version":1}');
    raise exception 'FAIL: incomplete prompts must not replace saved data';
  exception when invalid_parameter_value then null; end;
  saved := public.save_opportunity_search_template(search_id,2,'Legacy edit',criteria,schedule);
  if saved.meta_search is not null then raise exception 'FAIL: legacy edits must invalidate the obsolete full prompt'; end if;
  execute 'reset role';
end;
$$;
rollback;
