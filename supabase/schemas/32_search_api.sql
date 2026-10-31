-- Current desired schema: 32_search_api.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- public.opportunity_search_dashboard_source(public.opportunity_search_sources)
CREATE FUNCTION public.opportunity_search_dashboard_source(p_source public.opportunity_search_sources) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object('registry_id',p_source.registry_id,
    'listing_url',public.opportunity_search_source_url(p_source.listing_url),'vacancy_url',public.opportunity_search_source_url(p_source.vacancy_url),
    'kind',p_source.kind,'institution',case when public.opportunity_search_public_text(p_source.institution,200) then p_source.institution end,
    'topics',coalesce((select jsonb_agg(t order by n) from unnest(p_source.topics) with ordinality v(t,n)
      where n<=16 and public.opportunity_search_public_text(t,120)),'[]'),
    'priority',p_source.priority,'enabled',p_source.enabled,'pinned',p_source.pinned,'mandatory',p_source.mandatory,
    'check_interval_hours',p_source.check_interval_hours,'last_attempted_at',p_source.last_attempted_at,'last_successful_at',p_source.last_successful_at,
    'status',p_source.status,'owner_disabled',p_source.owner_disabled,'provenance',p_source.provenance,
    'listing_verified_at',p_source.listing_verified_at,'source_revision',p_source.source_revision)
$$;

-- public.save_opportunity_meta_search(uuid, integer, text, jsonb, jsonb, jsonb)
CREATE FUNCTION public.save_opportunity_meta_search(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb) RETURNS public.opportunity_search_templates
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare saved public.opportunity_search_templates;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') <> 'false' then
    raise exception 'A non-anonymous signed-in owner is required.' using errcode='42501';
  end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 0 or p_meta_search is null then
    raise exception 'An exact search ID, expected revision and complete prompt are required.' using errcode='22023';
  end if;
  perform private.validate_opportunity_search_definition(p_name,p_criteria,p_schedule);
  if p_expected_revision = 0 then
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule,meta_search)
      values(p_id,auth.uid(),p_name,p_criteria,p_schedule,p_meta_search)
      on conflict(id) do nothing returning * into saved;
  else
    update public.opportunity_search_templates set name=p_name,criteria=p_criteria,schedule=p_schedule,
      meta_search=p_meta_search,revision=revision+1
      where id=p_id and user_id=auth.uid() and revision=p_expected_revision returning * into saved;
  end if;
  if saved.id is null then
    -- Retrying a lost response returns the same committed revision, without a read-back request.
    select * into saved from public.opportunity_search_templates where id=p_id and user_id=auth.uid()
      and revision=p_expected_revision+1 and name=btrim(p_name) and criteria=p_criteria
      and schedule=p_schedule and meta_search=p_meta_search;
    if saved.id is null then raise exception 'Search changed elsewhere. Reload before saving.' using errcode='40001'; end if;
  end if;
  return saved;
end;
$$;

-- public.save_opportunity_search_template(uuid, integer, text, jsonb, jsonb)
CREATE FUNCTION public.save_opportunity_search_template(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb) RETURNS public.opportunity_search_templates
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare saved public.opportunity_search_templates;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
    raise exception 'A non-anonymous signed-in owner is required.' using errcode='42501';
  end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'An exact search ID and expected revision are required.' using errcode='22023';
  end if;
  perform private.validate_opportunity_search_definition(p_name,p_criteria,p_schedule);
  if p_expected_revision=0 then
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule)
      values(p_id,auth.uid(),p_name,p_criteria,p_schedule) on conflict(id) do nothing returning * into saved;
  else
    update public.opportunity_search_templates set name=p_name,criteria=p_criteria,schedule=p_schedule,revision=revision+1
      where id=p_id and user_id=auth.uid() and revision=p_expected_revision returning * into saved;
  end if;
  if saved.id is null then
    -- A response may have been lost after a successful write. A byte-for-byte retry
    -- of the same intended next revision returns that saved row, never a new revision.
    select * into saved from public.opportunity_search_templates where id=p_id and user_id=auth.uid()
      and revision=p_expected_revision+1 and name=btrim(p_name) and criteria=p_criteria and schedule=p_schedule;
    if saved.id is null then raise exception 'Search changed elsewhere. Reload before saving.' using errcode='40001'; end if;
  end if;
  return saved;
end;
$$;
