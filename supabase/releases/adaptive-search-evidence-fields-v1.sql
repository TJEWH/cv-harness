-- Explain existing evidence-field validation in the hosted brief.
-- No payload validation, internal pins, recurring prompts or saved data change.
begin;
do $guard$
begin
  if (select md5(prosrc) from pg_catalog.pg_proc where oid=to_regprocedure('private.begin_adaptive_search_brief(uuid,uuid)'))
    is distinct from 'e8846788c2b986af4412ce658b558cb1' then
    raise exception 'Expected the reviewed supersession brief predecessor; inspect deployment state';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION private.begin_adaptive_search_brief(p_search_id uuid, p_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare bundle jsonb;brief jsonb;owner_id uuid;previous_run record;
begin
  if current_user<>'postgres' then raise exception 'Management startup access is required' using errcode='42501';end if;
  -- Keep all authorization, pinning, lease and privacy checks in the existing
  -- implementation. Batch verification continues to use its full internal DTO.
  bundle:=private.begin_adaptive_opportunity_search(p_search_id,p_run_id);
  if bundle#>>'{error,code}'='run_in_progress'
    and not exists(select 1 from public.opportunity_search_runs where id=p_run_id)
    and not exists(select 1 from private.opportunity_search_lifecycle_operations where restart_run_id=p_run_id) then
    -- The inner startup validated authorization and holds the owner/search
    -- advisory lock until this transaction ends. Replace only for a fresh UUID;
    -- a retry, stale worker or older reserved restart must never evict a new run.
    select user_id into owner_id from public.opportunity_search_templates where id=p_search_id;
    for previous_run in select id from public.opportunity_search_runs
      where user_id=owner_id and search_id=p_search_id and status='running' order by id for update loop
      update public.opportunity_search_runs set status='failed',completed_at=clock_timestamp(),execution_report_status='partial',
        superseded_by_run_id=p_run_id,adaptive_lease_expires_at=NULL,
        summary=jsonb_build_object('adaptive_status','superseded','coverage','partial','status','failed','superseded_by_run_id',p_run_id)
        where id=previous_run.id;
      update private.opportunity_search_adaptive_contexts set lease_expires_at=least(lease_expires_at,clock_timestamp()) where run_id=previous_run.id;
    end loop;
    bundle:=private.begin_adaptive_opportunity_search(p_search_id,p_run_id);
    -- The inner helper returns typed errors rather than throwing. Raise here so
    -- those errors also roll back replacement and retain the previous execution.
    if bundle->'compatible' is distinct from 'true'::jsonb then raise exception 'Replacement startup was rejected' using errcode='PZ005';end if;
  end if;
  if bundle#>>'{error,code}'='scope_oversized' then raise exception 'Adaptive scope exceeds its bound' using errcode='54000';end if;
  if bundle->'compatible' is distinct from 'true'::jsonb then return bundle;end if;
  brief:=bundle||jsonb_build_object('brief_version',1,'response_limit_bytes',65536);
  -- Clarify existing evidence validation in the hosted response without
  -- changing the pinned internal protocol, schema, receipts or retry identity.
  brief:=jsonb_set(brief,'{protocol_text}',to_jsonb((bundle->>'protocol_text')||E'\n\nEVIDENCE FIELD NAMES\n'
    ||E'Each sources[].supports entry identifies a canonical opportunity field actually evidenced by that source. Use an exact name from the following JSON list, or a JSON pointer rooted in one of those names (for example /data/funding). Do not use display labels, prose, source kinds, or an opportunity. prefix. Check every entry locally against this list before submission; no database discovery is needed. Keep only supported claims and never invent a field name.\n'
    ||(select jsonb_agg(key order by key)::text from jsonb_object_keys(private.opportunity_storage_schema()->'properties') as fields(key))));
  -- Transport projection only: bundle has already passed full startup validation.
  -- Keep preferences, context and schema unchanged; retain snapshot statistics.
  select jsonb_set(brief, '{planning}',
    ((bundle->'planning')-array['approved_rules','approved_preferences']) || jsonb_build_object(
      'priorities',coalesce(jsonb_agg(priority order by position) filter (where keep),'[]'::jsonb),
      'priority_projection',jsonb_build_object('policy','approved-and-supported-directions-v1',
        'included_count',count(*) filter (where keep),
        'omitted_advisory_count',count(*) filter (where not keep)))) into brief
  from (
    select priority,position,(priority->>'basis'='approved'
      or (priority->'provisional'='false'::jsonb and priority->>'direction' in ('increase','decrease'))) as keep
    from jsonb_array_elements(bundle#>'{planning,priorities}') with ordinality as p(priority,position)
  ) priorities;
  brief:=jsonb_set(brief,'{feedback}',
    ((bundle->'feedback')-array['approved_preferences','fingerprint_encoding','input_fingerprint']) ||
    jsonb_build_object('example_projection',jsonb_build_object('version',1,
      'selected_ids_and_order_preserved',true,'research_summary_preview_max_characters',240)));
  brief:=jsonb_set(brief,'{feedback,aggregates}',(bundle#>'{feedback,aggregates}')-'groups');
  select jsonb_set(brief,'{feedback,examples}',coalesce(jsonb_agg(
    (select jsonb_object_agg(key,value) from jsonb_each(example) where key=any(array[
      'opportunity_id','title','institution','topics','interest_score','interest_origin','interest_gap',
      'review_state','metric_version','confirmed_submission','reasons','search_feedback_summary','technical_issue_category','manually_archived']))
    || jsonb_build_object('predicted_interest_score',example#>'{original_prediction,score}')
    || case when example ? 'summary_inclusion' then jsonb_build_object('summary_inclusion',
      jsonb_build_object('source_length',example#>'{summary_inclusion,source_length}',
        'truncated',example#>'{summary_inclusion,truncated}')) else '{}'::jsonb end
    || case when example ? 'research_summary' then jsonb_build_object(
      'research_summary',left(example->>'research_summary',240),
      'research_summary_truncated',char_length(example->>'research_summary')>240)
      else '{}'::jsonb end
    order by position),'[]'::jsonb)) into brief
  from jsonb_array_elements(bundle#>'{feedback,examples}') with ordinality as e(example,position);
  brief:=jsonb_set(brief,'{capabilities,allowed_helpers}',
    '["private.begin_adaptive_search_brief(uuid,uuid)","private.submit_adaptive_search_batch(uuid,uuid,jsonb)","private.verify_and_complete_adaptive_search(uuid,jsonb)"]');
  -- Never trim authoritative scope, selected example identities, shared feedback, schema or protocol to make it fit.
  -- Raising here rolls back every nested startup write before returning the
  -- bounded error, so a rejected first start leaves no running lease behind.
  if octet_length(brief::text)>65536 then raise exception 'Adaptive brief exceeds its response bound' using errcode='54000';end if;
  return brief;
exception when sqlstate 'PZ005' then return bundle;
  when program_limit_exceeded then
  -- Numeric diagnostics survive the rollback; never return the oversized data
  -- or require another database read merely to identify which section grew.
  return private.opportunity_search_adaptive_error('scope_oversized')||jsonb_build_object('brief_version',1,'response_limit_bytes',65536,
    'size_diagnostics',case when brief is null then null else jsonb_build_object('response_bytes',octet_length(brief::text),
      'context_bytes',octet_length((brief-array['planning','protocol_text','result_schema','feedback'])::text),
      'planning_bytes',octet_length((brief->'planning')::text),'protocol_bytes',octet_length((brief->'protocol_text')::text),
      'schema_bytes',octet_length((brief->'result_schema')::text),'feedback_bytes',octet_length((brief->'feedback')::text)) end);
end;
$$;

commit;
