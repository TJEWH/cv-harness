-- Current snapshot compilation: deterministic whole-set evidence, pins and exclusion.
begin;
do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();search_a uuid:=gen_random_uuid();search_b uuid:=gen_random_uuid();
 run_a uuid:=gen_random_uuid();target uuid;opportunity uuid;packet jsonb;again jsonb;pinned jsonb;later jsonb;revision bigint;n integer;
 cadence jsonb:='{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}';
begin
 insert into auth.users(id) values(owner_a),(owner_b);
 insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values
 (search_a,owner_a,'Synthetic snapshot','{"topicsAndMethods":"BCI"}',cadence),(search_b,owner_b,'Other snapshot','{"topicsAndMethods":"Acoustics"}',cadence);
 perform private.begin_opportunity_search(search_a,run_a);
 pinned:=private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a);
 assert pinned#>'{counts,eligible}'='0'::jsonb and pinned->'examples'='[]'::jsonb,'Cold start invented evidence';
 for n in 1..30 loop
  opportunity:=gen_random_uuid();if n=1 then target:=opportunity;end if;
  insert into public.opportunities(id,opportunity_key,title,institution,topics,contacts)
  values(opportunity,'snapshot-'||opportunity,'Synthetic sensing research','Synthetic Institute',array['BCI','Acoustics'],
  '[{"name":"Hidden Synthetic Person","email":"person@example.invalid","roles":["contact"],"entity_id":"hidden-synthetic-person"}]');
  insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_reasons,comment)
  values(owner_a,opportunity,'interested','[{"category":"method","polarity":"positive","target":"Prototyping"}]','Private person@example.invalid');
 end loop;
 packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
 assert packet->>'metric_version'='opportunity-interest-v2' and packet#>'{counts,eligible}'='30'::jsonb and packet#>'{counts,scored}'='30'::jsonb,'Whole-set aggregation sampled evidence';
 assert packet#>'{aggregates,score_sum}'='180'::jsonb and packet#>'{aggregates,mean_interest}'='6'::jsonb,'Current interest aggregate incorrect';
 assert jsonb_array_length(packet->'examples')=16 and packet#>'{counts,omitted_limit}'='14'::jsonb,'Example bound incorrect';
 assert packet::text!~'person@example.invalid|Hidden Synthetic Person|context_json|"comment"','Snapshot leaked private raw fields';
 again:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);assert packet=again,'Same semantic inputs allocated a new packet';
 assert private.pin_opportunity_feedback_snapshot(owner_a,search_a,run_a)=pinned,'Run retry recaptured newer evidence';
 assert private.compile_opportunity_feedback_snapshot(owner_b,search_b)#>'{counts,eligible}'='0'::jsonb,'Another account received evidence';
 target:=(packet#>>'{examples,0,opportunity_id}')::uuid;
 assert target is not null,'Redaction fixture must select a genuinely exported opportunity';
 revision:=(packet->>'feedback_revision')::bigint;
 update public.opportunities set title='Changed public research title' where id=target;
 later:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);assert(later->>'feedback_revision')::bigint>revision,'Changed public evidence did not invalidate snapshot';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_a,'is_anonymous',false)::text,true);execute 'set local role authenticated';
 perform public.save_opportunity_feedback(target,'{"feedback_excluded":true}');execute 'reset role';
 packet:=private.compile_opportunity_feedback_snapshot(owner_a,search_a);
 assert (select feedback_excluded from public.opportunity_reviews where user_id=owner_a and opportunity_id=target)
 and packet#>'{counts,eligible}'='29'::jsonb,'Exclusion did not remove one opportunity';
 assert not exists(select 1 from public.opportunity_search_feedback_snapshots s cross join lateral jsonb_array_elements(s.packet->'examples') e
   where s.user_id=owner_a and e->>'opportunity_id'=target::text),'Exclusion left a historical retry packet with withdrawn evidence';
 assert not exists(select 1 from private.opportunity_search_adaptive_contexts c cross join lateral jsonb_array_elements(c.bundle#>'{feedback,examples}') e
   where c.user_id=owner_a and e->>'opportunity_id'=target::text),'Exclusion left a pinned outgoing adaptive packet';
end $$;
rollback;
