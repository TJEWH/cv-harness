-- Fresh current-schema setup; apply once to a project without this workspace.
-- Existing projects require a targeted schema diff; do not rerun this setup.
-- Retired standalone drafting storage/RPCs are intentionally absent.
-- Existing opportunities are a shared, authenticated, read-only research catalogue.
-- This additive setup preserves its rows, metadata and opportunity_history.
begin;

-- On a fresh project this creates the same catalogue shape used by the app.
-- On an existing project no columns or research records are replaced.
create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_key text not null unique,
  record_type text not null default 'opportunity',
  title text not null,
  institution text,
  unit text,
  city text,
  country text,
  position_type text,
  availability text,
  deadline date,
  official_url text,
  source_url text,
  verification_level text not null default 'historical_context',
  data jsonb not null default '{}',
  source_context text,
  vacancy_id text,
  topics text[] not null default '{}',
  supervisors jsonb not null default '[]',
  supervisor_reputation jsonb not null default '{}',
  contacts jsonb not null default '[]',
  duration_details text,
  salary jsonb not null default '{}',
  research_career_potential jsonb not null default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}',
  rd_career_potential jsonb not null default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}',
  hardware_software_balance jsonb not null default '{}',
  personal_fit jsonb not null default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}',
  special_features text[] not null default '{}',
  requirements jsonb not null default '[]',
  required_documents jsonb not null default '[]',
  particularly_suitable boolean,
  particularly_suitable_reason text,
  deadline_time_local time,
  deadline_timezone text,
  deadline_original_text text,
  application_url text,
  start_date date,
  research_summary text,
  last_checked_at timestamptz,
  sources jsonb not null default '[]',
  open_questions text[] not null default '{}',
  metadata_schema_version integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cv_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  research_track text,
  is_base_variant boolean not null default false,
  content_json jsonb not null,
  config_json jsonb not null,
  cv_version integer not null default 7 check (cv_version > 0),
  revision integer not null default 1 check (revision > 0),
  parent_variant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, name),
  foreign key (user_id, parent_variant_id)
    references public.cv_variants(user_id, id) on delete no action deferrable initially deferred,
  constraint cv_variants_json_objects check (
    jsonb_typeof(content_json) = 'object' and jsonb_typeof(config_json) = 'object'
    and octet_length(content_json::text) <= 5242880
    and octet_length(config_json::text) <= 5242880
  ),
  -- The browser applies automatic masking and the user's explicit privacy edits.
  constraint cv_variants_contact_fields check (coalesce(
    jsonb_typeof(content_json -> 'contact') = 'object'
    and ((content_json -> 'contact') - array['name','location','role','email','phone','website','linkedin','github']) = '{}'::jsonb
    and jsonb_typeof(content_json #> '{contact,name}') = 'string'
    and jsonb_typeof(content_json #> '{contact,location}') = 'string'
    and jsonb_typeof(content_json #> '{contact,role}') = 'string'
    and jsonb_typeof(content_json #> '{contact,email}') = 'string'
    and jsonb_typeof(content_json #> '{contact,phone}') = 'string'
    and jsonb_typeof(content_json #> '{contact,website}') = 'string'
    and jsonb_typeof(content_json #> '{contact,linkedin}') = 'string'
    and jsonb_typeof(content_json #> '{contact,github}') = 'string'
    , false
  )),
  constraint cv_variants_known_json_fields check (
    (content_json - array['contact','about','education','experience','languages','hobbies','customSections','sidebarSections','sectionNames']) = '{}'::jsonb
    and (config_json - array['lang','design','disabled','completedSections','keepTogetherSections','anonymization','sectionHeaderSizes','bodyOrder','sidebarOrder','hiddenItems']) = '{}'::jsonb
  )
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  cv_variant_id uuid,
  contact_email text check (
    char_length(contact_email) between 3 and 254
    and contact_email = btrim(contact_email)
    and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  status text not null default 'preparation'
    check (status in ('preparation','refinement','attachments','ready','contacted','submitted','interview','offer','rejected','withdrawn')),
  notes text,
  contacted_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, opportunity_id),
  -- NO ACTION deferred keeps snapshots required while allowing account cascades.
  foreign key (user_id, cv_variant_id)
    references public.cv_variants(user_id, id) on delete no action deferrable initially deferred
);

comment on column public.applications.contact_email is 'Employer contact email for follow-up; not the applicant email.';
comment on table public.cv_variants is 'Private, immutable privacy-filtered CV snapshots. Complete CVs stay in local browser storage.';

-- Leading user_id serves ownership policies and each tenant-scoped foreign key.
create index cv_variants_parent_idx on public.cv_variants(user_id, parent_variant_id);
create index cv_variants_recent_idx on public.cv_variants(user_id, created_at desc);
create index applications_opportunity_idx on public.applications(opportunity_id);
create index applications_cv_variant_idx on public.applications(user_id, cv_variant_id);
create index applications_recent_idx on public.applications(user_id, updated_at desc);

create function public.job_workspace_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.job_workspace_touch_updated_at() from public, anon, authenticated;

create function public.job_workspace_guard_cv_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.user_id is distinct from old.user_id
     or new.content_json is distinct from old.content_json
     or new.config_json is distinct from old.config_json
     or new.cv_version is distinct from old.cv_version
     or new.revision is distinct from old.revision then
    raise exception 'Saved CV snapshots are immutable; create a new snapshot.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_guard_cv_snapshot() from public, anon, authenticated;

create trigger cv_variants_preserve_snapshot before update on public.cv_variants
  for each row execute function public.job_workspace_guard_cv_snapshot();
create trigger cv_variants_updated_at before update on public.cv_variants
  for each row execute function public.job_workspace_touch_updated_at();
create trigger applications_updated_at before update on public.applications
  for each row execute function public.job_workspace_touch_updated_at();

alter table public.opportunities enable row level security;
alter table public.cv_variants enable row level security;
alter table public.applications enable row level security;

revoke all on public.opportunities, public.cv_variants, public.applications from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.opportunities to authenticated;
grant select, insert, update, delete on public.cv_variants, public.applications to authenticated;
grant select, insert, update, delete on public.opportunities, public.cv_variants, public.applications to service_role;

-- Existing research history is backend-only. RLS does not replace least-privilege
-- grants (for example, TRUNCATE is not subject to row policies).
do $$
declare history_sequence text;
begin
  if to_regclass('public.opportunity_history') is not null then
    alter table public.opportunity_history enable row level security;
    revoke all on public.opportunity_history from public, anon, authenticated;
    history_sequence := pg_get_serial_sequence('public.opportunity_history', 'id');
    if history_sequence is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', history_sequence::regclass);
    end if;
  end if;
end;
$$;

create policy "Signed-in users can review the shared catalogue" on public.opportunities
  for select to authenticated
  using ((select auth.uid()) is not null and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

create policy "Read own CV snapshots" on public.cv_variants for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own CV snapshots" on public.cv_variants for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own CV metadata" on public.cv_variants for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own unused CV snapshots" on public.cv_variants for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Read own applications" on public.applications for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own applications" on public.applications for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own applications" on public.applications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own applications" on public.applications for delete to authenticated using ((select auth.uid()) = user_id);

-- SECURITY INVOKER preserves all ownership policies and grants in these atomic RPCs.
-- Client-generated IDs make identical retries safe after an ambiguous network error.

create function public.assign_job_application_cv(
  p_application_id uuid, p_cv_variant_id uuid, p_cv_name text,
  p_content_json jsonb, p_config_json jsonb, p_cv_version integer default 7,
  p_changes jsonb default '{}'
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  existing public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before assigning a CV.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or (p_changes - array['contact_email','status','notes','contacted_at','submitted_at']) <> '{}'::jsonb
     or exists (select 1 from jsonb_each(p_changes) as field
       where jsonb_typeof(field.value) not in ('string', 'null')) then
    raise exception 'Invalid application changes.' using errcode = '22023';
  end if;
  select * into existing from public.applications where id = p_application_id and user_id = actor for update;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  if existing.cv_variant_id = p_cv_variant_id then
    if not exists (select 1 from public.cv_variants where id = p_cv_variant_id and user_id = actor
      and name = p_cv_name and content_json = p_content_json and config_json = p_config_json and cv_version = p_cv_version)
    then raise exception 'CV snapshot ID already exists with different data.' using errcode = '23505';
    end if;
  else
    insert into public.cv_variants(id, user_id, name, content_json, config_json, cv_version, is_base_variant)
      values (p_cv_variant_id, actor, p_cv_name, p_content_json, p_config_json, p_cv_version, false);
  end if;
  -- Updating metadata also on an identical retry ensures the entire save is applied.
  update public.applications set
    cv_variant_id = p_cv_variant_id,
    contact_email = case when p_changes ? 'contact_email' then p_changes ->> 'contact_email' else contact_email end,
    status = case when p_changes ? 'status' then p_changes ->> 'status' else status end,
    tracking_started = tracking_started or p_changes ? 'status',
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end,
    contacted_at = case when p_changes ? 'contacted_at' then (p_changes ->> 'contacted_at')::timestamptz else contacted_at end,
    submitted_at = case when p_changes ? 'submitted_at' then (p_changes ->> 'submitted_at')::timestamptz else submitted_at end
  where id = p_application_id and user_id = actor;
  return p_cv_variant_id;
end;
$$;

revoke all on function public.assign_job_application_cv(uuid, uuid, text, jsonb, jsonb, integer, jsonb) from public, anon;
grant execute on function public.assign_job_application_cv(uuid, uuid, text, jsonb, jsonb, integer, jsonb) to authenticated;

-- Review workflow and captured application research.
-- Preserve independently populated research metadata and support fresh catalogues.
alter table public.opportunities
  add column if not exists supervisor_research_focus jsonb not null default '{}',
  add column if not exists supervisor_top_papers jsonb not null default '[]';

create table public.opportunity_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  state text not null default 'unreviewed'
    check (state in ('unreviewed', 'interested', 'strong_interest', 'very_high_interest', 'not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);
comment on column public.opportunity_reviews.state is
  'Private explicit user preference. strong_interest can seed new searches across prior searches, fit scores and deadlines.';
create index opportunity_reviews_opportunity_idx on public.opportunity_reviews(opportunity_id);
create trigger opportunity_reviews_updated_at before update on public.opportunity_reviews
  for each row execute function public.job_workspace_touch_updated_at();
alter table public.opportunity_reviews enable row level security;
revoke all on public.opportunity_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.opportunity_reviews to authenticated, service_role;
create policy "Read own opportunity reviews" on public.opportunity_reviews for select to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Insert own opportunity reviews" on public.opportunity_reviews for insert to authenticated
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Update own opportunity reviews" on public.opportunity_reviews for update to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false))
  with check ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));
create policy "Delete own opportunity reviews" on public.opportunity_reviews for delete to authenticated
  using ((select auth.uid()) = user_id and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false));

alter table public.applications
  add column context_json jsonb not null,
  add column context_captured_at timestamptz not null,
  add constraint applications_context_object check (jsonb_typeof(context_json) = 'object');
comment on column public.applications.context_json is 'Immutable opportunity research captured by the server when this application is created, including requirements, documents, contacts and supervisor research.';
comment on column public.applications.context_captured_at is 'Server time when the opportunity context was captured; existing applications use their migration backfill time.';
comment on column public.applications.cv_variant_id is 'Optional privacy-filtered CV snapshot, assigned after the application is created.';
comment on column public.applications.contact_email is 'Optional employer email retained for legacy applications; all researched contacts are available in context_json.';

create function public.job_workspace_capture_application_context()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  capture_requested boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id
       or new.opportunity_id is distinct from old.opportunity_id then
      raise exception 'Application identity is immutable.' using errcode = '23514';
    end if;
    capture_requested := new.context_json is distinct from old.context_json
      or new.context_captured_at is distinct from old.context_captured_at;
  end if;
  if capture_requested then
    -- Treat any requested context change as a refresh from the source. Neither
    -- RPC nor direct REST clients can inject arbitrary research or capture dates.
    select to_jsonb(opportunity) into new.context_json
      from public.opportunities as opportunity where opportunity.id = new.opportunity_id;
    if not found then
      raise exception 'The opportunity is not available to this user.' using errcode = '42501';
    end if;
    new.context_captured_at = now();
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_capture_application_context() from public, anon, authenticated;
create trigger applications_capture_context before insert or update on public.applications
  for each row execute function public.job_workspace_capture_application_context();

-- Two-argument entry point for one-click creation. No CV or email is uploaded.
-- Retry only an application-code collision; a conflicting UUID/opportunity
-- and all other failures still fail.
create function public.create_job_application(p_application_id uuid,p_opportunity_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.applications; violated_constraint text; attempt integer;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before creating an application.' using errcode='42501';
  end if;
  if p_application_id is null or p_opportunity_id is null then
    raise exception 'Application and opportunity IDs are required.' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_opportunity_id::text,0));
  select * into existing from public.applications where id=p_application_id and user_id=actor;
  if found then
    if existing.opportunity_id=p_opportunity_id then return existing.id; end if;
    raise exception 'Application ID already belongs to a different opportunity.' using errcode='23505';
  end if;
  select * into existing from public.applications where opportunity_id=p_opportunity_id and user_id=actor;
  if found then return existing.id; end if;
  for attempt in 1..32 loop
    begin
      insert into public.applications(id,user_id,opportunity_id) values(p_application_id,actor,p_opportunity_id);
      return p_application_id;
    exception when unique_violation then
      get stacked diagnostics violated_constraint=constraint_name;
      if violated_constraint is distinct from 'applications_application_code_key' then raise; end if;
    end;
  end loop;
  raise exception 'Could not allocate an application code; retry creating the application.' using errcode='23505';
end;
$$;
revoke all on function public.create_job_application(uuid, uuid) from public, anon;
grant execute on function public.create_job_application(uuid, uuid) to authenticated;

-- Explicit authoritative research refresh.

revoke all on function public.job_workspace_capture_application_context() from public, anon, authenticated;

create function public.refresh_job_application_context(p_application_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  refreshed_id uuid;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in before refreshing application research.' using errcode = '42501';
  end if;
  -- BEFORE UPDATE replaces this sentinel with authoritative source data before
  -- the NOT NULL constraint is checked. Other application fields are unchanged.
  update public.applications set context_json = null
    where id = p_application_id and user_id = actor
    returning id into refreshed_id;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  return refreshed_id;
end;
$$;
revoke all on function public.refresh_job_application_context(uuid) from public, anon;
grant execute on function public.refresh_job_application_context(uuid) to authenticated;
comment on column public.applications.context_json is 'Opportunity research captured by the server on create or explicit refresh; client-supplied research is always replaced with the authoritative same opportunity.';
comment on column public.applications.context_captured_at is 'Server time of the latest explicit research capture; normal application edits leave it unchanged.';

-- Private source-version review receipts.
alter table public.opportunity_reviews add column reviewed_updated_at timestamptz;
comment on column public.opportunity_reviews.reviewed_updated_at is
  'Opportunity source version last reviewed by this user; independent of their interest state.';

create or replace function public.review_job_opportunity(
  p_opportunity_id uuid,
  p_observed_updated_at timestamptz,
  p_state text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  source_version timestamptz;
  receipt timestamptz;
  saved public.opportunity_reviews;
begin
  if account is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('unreviewed', 'interested', 'strong_interest', 'very_high_interest', 'not_interested') then
    raise exception 'Invalid opportunity review state' using errcode = '22023';
  end if;
  select coalesce(updated_at, created_at) into source_version
    from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity unavailable' using errcode = '42501';
  end if;
  -- An old browser view must not acknowledge research that changed before this request.
  if p_observed_updated_at = source_version then receipt := source_version; end if;
  insert into public.opportunity_reviews as existing (user_id, opportunity_id, state, reviewed_updated_at)
    values (account, p_opportunity_id, coalesce(p_state, 'unreviewed'), receipt)
    on conflict (user_id, opportunity_id) do update
      set state = coalesce(p_state, existing.state),
          reviewed_updated_at = greatest(existing.reviewed_updated_at, excluded.reviewed_updated_at)
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.review_job_opportunity(uuid, timestamptz, text) from public, anon;
grant execute on function public.review_job_opportunity(uuid, timestamptz, text) to authenticated;

-- Private context for opportunity interest choices.

alter table public.opportunity_reviews
  add column comment text constraint opportunity_reviews_comment_length
    check (char_length(comment) <= 5000);
comment on column public.opportunity_reviews.comment is
  'Private optional context for the owner''s interest choice; independent of review state and source-version receipt.';

create function public.save_opportunity_comment(p_opportunity_id uuid, p_comment text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  comment_text text := nullif(regexp_replace(p_comment, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  saved public.opportunity_reviews;
begin
  if account is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if char_length(comment_text) > 5000 then
    raise exception 'Opportunity comments must be 5000 characters or fewer' using errcode = '22023';
  end if;
  perform 1 from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity unavailable' using errcode = '42501';
  end if;
  -- Change only the comment so parallel interest/receipt updates cannot be lost.
  insert into public.opportunity_reviews (user_id, opportunity_id, comment)
    values (account, p_opportunity_id, comment_text)
    on conflict (user_id, opportunity_id) do update
      set comment = excluded.comment
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.save_opportunity_comment(uuid, text) from public, anon;
grant execute on function public.save_opportunity_comment(uuid, text) to authenticated;

-- Application ownership policies also cover checklist data.
alter table public.applications add column completed_checklist_keys text[] not null default '{}'
  constraint applications_checklist_bounds check (
    coalesce(array_ndims(completed_checklist_keys), 1) = 1
    and cardinality(completed_checklist_keys) <= 500
    and array_position(completed_checklist_keys, null) is null
    and octet_length(completed_checklist_keys::text) <= 262144
  );
comment on column public.applications.completed_checklist_keys is
  'Private preparation progress keyed by requirement/document content, independent of captured research and CV snapshots.';

create function public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.applications;
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if p_item_key is null or char_length(p_item_key) not between 1 and 16000 or p_completed is null
    or not (p_item_key like 'requirements:%' or p_item_key like 'documents:%') then
    raise exception 'Invalid checklist item' using errcode = '22023';
  end if;
  -- Atomic per-item updates preserve checks made by another tab or device.
  update public.applications set completed_checklist_keys = case
    when not p_completed then array_remove(completed_checklist_keys, p_item_key)
    when p_item_key = any(completed_checklist_keys) then completed_checklist_keys
    else array_append(completed_checklist_keys, p_item_key) end
    where id = p_application_id and user_id = actor returning * into saved;
  if not found then raise exception 'Application unavailable' using errcode = '42501'; end if;
  return to_jsonb(saved);
end;
$$;

create function public.remove_job_application(p_application_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  delete from public.applications where id = p_application_id and user_id = actor;
  -- A lost response can safely be retried. No data is returned about another user's application.
  return p_application_id;
end;
$$;

revoke all on function public.set_job_application_checklist_item(uuid, text, boolean) from public, anon;
revoke all on function public.remove_job_application(uuid) from public, anon;
grant execute on function public.set_job_application_checklist_item(uuid, text, boolean) to authenticated;
grant execute on function public.remove_job_application(uuid) to authenticated;

-- Shared identity redaction for the current unified refinement contract.
-- Standalone drafting storage and APIs were retired; retain this validator.

-- Defense in depth for the previous fictional sample identity.
-- Free prose still requires the browser privacy projection.
create function public.job_drafting_redact_samples(value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare result jsonb; item record; plain text;
begin
  case jsonb_typeof(value)
    when 'object' then
      result := '{}';
      for item in select key, val from jsonb_each(value) as e(key, val) loop
        result := result || jsonb_build_object(item.key, public.job_drafting_redact_samples(item.val));
      end loop;
    when 'array' then
      select coalesce(jsonb_agg(public.job_drafting_redact_samples(e.val) order by e.ordinality), '[]'::jsonb)
        into result from jsonb_array_elements(value) with ordinality as e(val, ordinality);
    when 'string' then
      plain := value #>> '{}';
      for item in select * from (values
        ('https://link[.]com/in/alexmuster', '{{APPLICANT_LINKEDIN}}'),
        ('https://git[.]com/musterlex', '{{APPLICANT_GITHUB}}'),
        ('https://alexmuster[.]dev', '{{APPLICANT_WEBSITE}}'),
        ('muster-ex@mp[.]le', '{{APPLICANT_EMAIL}}'),
        ('[+]49 123 456789', '{{APPLICANT_PHONE}}'),
        ('Alex Muster', '{{APPLICANT_NAME}}')
      ) as replacements(pattern, placeholder) loop
        plain := regexp_replace(plain, item.pattern, item.placeholder, 'gi');
      end loop;
      result := to_jsonb(plain);
    else result := value;
  end case;
  return result;
end;
$$;
revoke all on function public.job_drafting_redact_samples(jsonb) from public, anon;
grant execute on function public.job_drafting_redact_samples(jsonb) to authenticated;

-- Shared public-field/token validators used by current unified refinement.
-- Standalone adjustment storage and APIs were retired; retain these helpers.

create function public.cv_adjustment_validate_request(value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare field jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','fields','opportunity','instructions'] <> '{}'::jsonb
    or not (value ?& array['schemaVersion','requestId','fields','opportunity','instructions'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'fields') is distinct from 'array'
    or jsonb_typeof(value->'opportunity') is distinct from 'object'
    or jsonb_typeof(value->'instructions') is distinct from 'string'
    or char_length(value->>'instructions') > 20000
    or translate(value->>'instructions', E'\t\n\r', '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid CV adjustment request.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'fields') > 1000 then raise exception 'Too many CV adjustment fields.' using errcode = '22023'; end if;
  for field in select jsonb_array_elements(value->'fields') loop
    if jsonb_typeof(field) is distinct from 'object' or field - array['id','label','text'] <> '{}'::jsonb
      or not (field ?& array['id','label','text'])
      or jsonb_typeof(field->'id') is distinct from 'string' or field->>'id' !~ '^field-[1-9][0-9]*$' or field->>'id' = any(ids)
      or jsonb_typeof(field->'label') is distinct from 'string' or char_length(field->>'label') > 200
      or jsonb_typeof(field->'text') is distinct from 'string' or char_length(field->>'text') > 20000
      or translate((field->>'label') || (field->>'text'), E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment field.' using errcode = '22023';
    end if;
    ids := array_append(ids, field->>'id');
  end loop;
end;
$$;

create function public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare
  edit jsonb; original text; replacement text; ids text[] := '{}';
  original_lines jsonb; replacement_lines jsonb;
  original_tokens text[]; replacement_tokens text[]; original_links text[]; replacement_links text[];
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 1048576
    or value - array['schemaVersion','requestId','edits'] <> '{}'::jsonb or not (value ?& array['schemaVersion','requestId','edits'])
    or value->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(value->'requestId') is distinct from 'string' or expected_id is null or value->>'requestId' is distinct from expected_id::text
    or jsonb_typeof(value->'edits') is distinct from 'array' then
    raise exception 'Invalid CV adjustment response.' using errcode = '22023';
  end if;
  if jsonb_array_length(value->'edits') > 1000 then raise exception 'Too many CV adjustment edits.' using errcode = '22023'; end if;
  for edit in select jsonb_array_elements(value->'edits') loop
    if jsonb_typeof(edit) is distinct from 'object' or edit - array['fieldId','text'] <> '{}'::jsonb
      or not (edit ?& array['fieldId','text'])
      or jsonb_typeof(edit->'fieldId') is distinct from 'string' or edit->>'fieldId' !~ '^field-[1-9][0-9]*$' or edit->>'fieldId' = any(ids)
      or jsonb_typeof(edit->'text') is distinct from 'string' or char_length(edit->>'text') > 20000
      or translate(edit->>'text', E'\t\n\r', '') ~ '[[:cntrl:]]' then
      raise exception 'Invalid or duplicate CV adjustment edit.' using errcode = '22023';
    end if;
    ids := array_append(ids, edit->>'fieldId');
    select field->>'text' into original from jsonb_array_elements(request_value->'fields') as fields(field) where field->>'id' = edit->>'fieldId';
    if not found then raise exception 'The response edits an unavailable CV field.' using errcode = '22023'; end if;
    replacement := edit->>'text';
    if replacement = original then continue; end if;
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into original_tokens
      from regexp_matches(original, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    select coalesce(array_agg(parts[1] order by ordinal), '{}') into replacement_tokens
      from regexp_matches(replacement, '(\{\{PRIVATE_[1-9][0-9]*\}\})', 'g') with ordinality as tokens(parts, ordinal);
    if original_tokens <> replacement_tokens
      or regexp_replace(replacement, '\{\{PRIVATE_[1-9][0-9]*\}\}', '', 'g') ~ '\{\{|\}\}' then
      raise exception 'Private placeholders must remain in their original field, order and count.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into original_lines
      from regexp_split_to_table(original,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    select coalesce(jsonb_agg(jsonb_build_array(line_number,parts[1]) order by line_number,token_number),'[]') into replacement_lines
      from regexp_split_to_table(replacement,E'\\r\\n|\\r|\\n') with ordinality as lines(line,line_number)
      cross join lateral regexp_matches(line,'(\{\{PRIVATE_[1-9][0-9]*\}\})','g') with ordinality as tokens(parts,token_number);
    if original_lines<>replacement_lines then raise exception 'Private tokens must remain attached to their original bullet or content line.' using errcode='22023'; end if;
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into original_links
      from regexp_matches(original, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    select coalesce(array_agg(coalesce(parts[1], parts[2]) order by coalesce(parts[1], parts[2])), '{}') into replacement_links
      from regexp_matches(replacement, '\]\(([^[:space:])]+)\)|((https?://|mailto:|tel:|javascript:|data:)[^[:space:]<>)]+)', 'gi') as links(parts);
    if original_links <> replacement_links or replacement ~* '!\[|</?[a-z]|\]\([^)]*\{\{' then
      raise exception 'CV adjustments cannot add links, images or HTML.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.cv_adjustment_validate_request(jsonb,uuid), public.cv_adjustment_validate_response(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.cv_adjustment_validate_request(jsonb,uuid), public.cv_adjustment_validate_response(jsonb,jsonb,uuid) to authenticated;

-- Unified application preparation and refinement.
-- Unified requests, proposals and reviews retain their versioned history.

create schema if not exists private;

create table public.application_refinement_state (
  application_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_json jsonb not null,
  approvals_json jsonb not null default '{"cv":null,"letter":null}',
  current_request_id uuid,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_requests (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_json jsonb not null constraint refinement_request_v2 check ((request_json->'schemaVersion') is not distinct from '2'::jsonb),
  opportunity_snapshot jsonb not null,
  cv_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade
);
create table public.application_refinement_proposals (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  proposal_json jsonb not null constraint refinement_proposal_v2 check ((proposal_json->'schemaVersion') is not distinct from '2'::jsonb),
  created_at timestamptz not null default now(),
  unique (user_id, application_id, id),
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
create table public.application_refinement_reviews (
  id uuid primary key,
  application_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid,
  kind text not null check (kind in ('feedback','approve_cv','approve_letter','reopen_cv','reopen_letter','cv_decisions','annotation')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, application_id) references public.applications(user_id,id) on delete cascade,
  foreign key (user_id, application_id, request_id) references public.application_refinement_requests(user_id,application_id,id) on delete cascade
);
alter table public.application_refinement_state add constraint refinement_current_request_fk
  foreign key (user_id,application_id,current_request_id) references public.application_refinement_requests(user_id,application_id,id)
  on delete no action deferrable initially deferred;
create index refinement_state_owner_idx on public.application_refinement_state(user_id,application_id,current_request_id);
create index refinement_requests_recent_idx on public.application_refinement_requests(user_id,application_id,created_at,id);
create index refinement_proposals_request_idx on public.application_refinement_proposals(user_id,application_id,request_id,created_at,id);
create index refinement_reviews_request_idx on public.application_refinement_reviews(user_id,application_id,request_id);
create index refinement_reviews_recent_idx on public.application_refinement_reviews(user_id,application_id,created_at,id);

comment on table public.application_refinement_state is 'Frozen letter setup and approval revision hashes. Full CVs and reconstruction bindings stay local.';
comment on table public.application_refinement_requests is 'Immutable anonymized refinement context; server captures assigned public CV and application research. No application notes or supporting files.';
comment on table public.application_refinement_proposals is 'Append-only validated proposals, written only by the postgres management connection. Reading a proposal never applies it locally.';
comment on table public.application_refinement_reviews is 'Append-only owner feedback and approval history. Feedback must be anonymized before sending.';

alter table public.application_refinement_state enable row level security;
alter table public.application_refinement_requests enable row level security;
alter table public.application_refinement_proposals enable row level security;
alter table public.application_refinement_reviews enable row level security;
revoke all on public.application_refinement_state, public.application_refinement_requests, public.application_refinement_proposals, public.application_refinement_reviews from public,anon,authenticated,service_role;
grant select,insert,update on public.application_refinement_state to authenticated;
grant select,insert on public.application_refinement_requests, public.application_refinement_reviews to authenticated;
grant select on public.application_refinement_proposals to authenticated;
create policy "Read own refinement state" on public.application_refinement_state for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement state" on public.application_refinement_state for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Update own refinement state" on public.application_refinement_state for update to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)) with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement requests" on public.application_refinement_requests for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement requests" on public.application_refinement_requests for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement proposals" on public.application_refinement_proposals for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Read own refinement reviews" on public.application_refinement_reviews for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own refinement reviews" on public.application_refinement_reviews for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.refinement_validate_setup(value jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare template jsonb := value->'template'; item record;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>200000
    or value - array['template','language','maxWords'] <> '{}'::jsonb or not(value ?& array['template','language','maxWords'])
    or jsonb_typeof(value->'language') is distinct from 'string' or char_length(value->>'language') not between 1 and 30
    or jsonb_typeof(value->'maxWords') is distinct from 'number' or coalesce(value->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (value->>'maxWords')::integer not between 50 and 2000
    or jsonb_typeof(template) is distinct from 'object'
    or template - array['id','name','revision','structure','tone','language','maxWords','updatedAt','subjectInstructions','salutationInstructions','closingInstructions','exampleText','researchInterests','questionGuidance','refinementSystemPrompt'] <> '{}'::jsonb
    or not(template ?& array['id','name','revision','structure','tone','language','maxWords','updatedAt'])
    or jsonb_typeof(template->'revision') is distinct from 'number' or coalesce(template->>'revision','') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(template->'maxWords') is distinct from 'number' or coalesce(template->>'maxWords','') !~ '^[0-9]{2,4}$'
    or (template->>'maxWords')::integer not between 50 and 2000 then
    raise exception 'Invalid refinement letter template or word target.' using errcode='22023';
  end if;
  for item in select key,val from jsonb_each(template-array['revision','maxWords']) e(key,val) loop
    if jsonb_typeof(item.val) is distinct from 'string' or char_length(item.val#>>'{}')>20000
      or (item.key in ('subjectInstructions','salutationInstructions','closingInstructions') and char_length(item.val#>>'{}')>1000)
      or (item.key in ('researchInterests','questionGuidance','refinementSystemPrompt') and public.refinement_utf16_length(item.val#>>'{}')>4000)
      or translate(item.val#>>'{}', E'\t\n\r','') ~ '[[:cntrl:]]' then
      raise exception 'Invalid refinement template text.' using errcode='22023';
    end if;
  end loop;
  if value is distinct from public.job_drafting_redact_samples(value) then
    raise exception 'Anonymize refinement text before publishing.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_capture_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  perform public.refinement_validate_setup(new.setup_json);
  if jsonb_typeof(new.approvals_json) is distinct from 'object' or not(new.approvals_json ?& array['cv','letter'])
    or new.approvals_json-array['cv','letter'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(new.approvals_json) e where jsonb_typeof(e.value) not in ('string','null') or (jsonb_typeof(e.value)='string' and e.value#>>'{}' !~ '^v1:[a-f0-9]{64}$')) then
    raise exception 'Invalid document approvals.' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if new.application_id<>old.application_id or new.user_id<>old.user_id then raise exception 'Refinement ownership cannot change.' using errcode='23514'; end if;
    if new.revision<>old.revision+1 then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    if pg_trigger_depth()=1 and exists(select 1 from jsonb_each(new.approvals_json) e where e.value<>'null'::jsonb and e.value is distinct from old.approvals_json->e.key) then
      raise exception 'Approve documents through a recorded review.' using errcode='23514';
    end if;
    if pg_trigger_depth()=1 and new.current_request_id is not null and new.current_request_id is distinct from old.current_request_id then
      raise exception 'Publish a request to advance the refinement round.' using errcode='23514';
    end if;
    if new.setup_json<>old.setup_json then
      new.current_request_id:=null;
      new.approvals_json:=jsonb_set(new.approvals_json,'{letter}','null');
    end if;
  else
    if new.approvals_json<>'{"cv":null,"letter":null}'::jsonb then raise exception 'Approve documents through a recorded review.' using errcode='23514'; end if;
    new.revision:=1;
    new.current_request_id:=null;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_state_capture before insert or update on public.application_refinement_state for each row execute function public.refinement_capture_state();

create function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  -- A custom setting alone grants no authority. Only the postgres-owned RPC can
  -- delete directly, and its scope must match both the signed-in owner and row.
  if tg_op='DELETE' and current_user='postgres' and auth.uid()=old.user_id
    and current_setting('cv_builder.clearing_refinement_history',true)=old.user_id::text||':'||old.application_id::text then
    return old;
  end if;
  raise exception 'Refinement history is immutable; create a new round or clear history.' using errcode='23514';
end;
$$;
create trigger refinement_requests_immutable before update or delete on public.application_refinement_requests for each row execute function public.refinement_guard_immutable();
create trigger refinement_proposals_immutable before update or delete on public.application_refinement_proposals for each row execute function public.refinement_guard_immutable();
create trigger refinement_reviews_immutable before update or delete on public.application_refinement_reviews for each row execute function public.refinement_guard_immutable();

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; privacy_input jsonb; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure'] || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}');
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  -- CV fields and structure already contain the user's final privacy wording.
  -- Keep identity checks on the remaining template, letter, feedback and context inputs.
  privacy_input := (value-array['cv','cvStructure']) || jsonb_build_object('cv',(value->'cv')-'fields');
  if privacy_input is distinct from public.job_drafting_redact_samples(privacy_input) then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback' order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    cv.content_json);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_requests_capture before insert on public.application_refinement_requests for each row execute function public.refinement_capture_request();
create function public.refinement_activate_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.application_refinement_state set current_request_id=new.id, revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
  return new;
end;
$$;
create trigger refinement_requests_activate after insert on public.application_refinement_requests for each row execute function public.refinement_activate_request();

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb; annotation jsonb; reference jsonb; previous public.application_refinement_reviews; has_previous boolean;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.kind='annotation' or (new.kind='feedback' and new.payload ? 'annotation') then
    reference:=case when new.kind='annotation' then jsonb_build_object('proposalId',new.payload->'proposalId','annotationId',new.payload->'annotationId','reviewId',new.payload->'previousReviewId') else new.payload->'annotation' end;
    if not public.refinement_exact_keys(reference,array['proposalId','annotationId','reviewId'])
      or jsonb_typeof(reference->'proposalId') is distinct from 'string' or coalesce(reference->>'proposalId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(reference->'annotationId') is distinct from 'string' or coalesce(reference->>'annotationId','') !~ '^annotation-[1-9][0-9]*$'
      or (reference->'reviewId'<>'null'::jsonb and (jsonb_typeof(reference->'reviewId') is distinct from 'string' or coalesce(reference->>'reviewId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) then
      raise exception 'Invalid annotation reference.' using errcode='22023';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p where p.user_id=new.user_id
      and p.application_id=new.application_id and p.request_id=new.request_id and p.id::text=lower(reference->>'proposalId');
    if not found then raise exception 'Annotation proposal unavailable.' using errcode='42501'; end if;
    select a into annotation from jsonb_array_elements(coalesce(proposal->'annotations','[]'::jsonb)) as x(a) where a->>'id'=reference->>'annotationId';
    if not found then raise exception 'Annotation unavailable.' using errcode='22023'; end if;
    select * into previous from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id
      and r.kind='annotation' and r.payload->>'proposalId'=reference->>'proposalId' and r.payload->>'annotationId'=reference->>'annotationId'
      order by r.created_at desc,r.id desc limit 1;
    has_previous:=found;
    if (has_previous and lower(reference->>'reviewId') is distinct from previous.id::text) or (not has_previous and reference->'reviewId'<>'null'::jsonb) then
      raise exception 'Annotation changed elsewhere; reload the saved annotation. Your documents are unchanged.' using errcode='40001';
    end if;
    if new.kind='feedback' and (new.payload->>'scope' is distinct from annotation->>'document'
      or (has_previous and previous.payload->>'status'<>'open' and previous.payload->'response'='null'::jsonb)) then
      raise exception 'Only open or answered annotations can be included in their document feedback.' using errcode='22023';
    end if;
  end if;
  if new.kind='annotation' then
    if not public.refinement_exact_keys(new.payload,array['proposalId','annotationId','status','response','previousReviewId'])
      or coalesce(new.payload->>'status','') not in ('open','resolved','ignored')
      or (new.payload->'response'<>'null'::jsonb and (jsonb_typeof(new.payload->'response') is distinct from 'string' or btrim(new.payload->>'response')='' or public.refinement_utf16_length(new.payload->>'response')>12000))
      or translate(coalesce(new.payload->>'response',''),E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized annotation review.' using errcode='22023';
    end if;
  elsif new.kind='feedback' then
    if new.payload-array['text','scope','annotation']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter','both')
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from state.current_request_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if jsonb_array_length(new.payload->'accepted')>0 and state.approvals_json->'cv'<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    if new.request_id is not null and new.request_id is distinct from state.current_request_id then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_reviews_capture before insert on public.application_refinement_reviews for each row execute function public.refinement_capture_review();

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText'] || case when value ? 'annotations' then array['annotations'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if value ? 'annotations' then perform public.refinement_validate_annotations(value->'annotations',request.request_json#>'{cv,fields}',value->>'letterText'); end if;
  perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
  if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger refinement_proposals_capture before insert on public.application_refinement_proposals for each row execute function public.refinement_capture_proposal();

create function public.save_refinement_state(p_application_id uuid,p_setup jsonb,p_approvals jsonb,p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_state;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving preparation.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into result from public.application_refinement_state where user_id=actor and application_id=p_application_id for update;
  if found then
    if result.revision is distinct from p_expected_revision then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    update public.application_refinement_state set setup_json=p_setup,approvals_json=p_approvals,revision=revision+1 where application_id=p_application_id and user_id=actor returning * into result;
  else
    if p_expected_revision is distinct from 0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    insert into public.application_refinement_state(application_id,user_id,setup_json,approvals_json) values(p_application_id,actor,p_setup,p_approvals) returning * into result;
  end if;
  return to_jsonb(result);
end;
$$;
create function public.publish_refinement_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request_id uuid; application_id uuid; result public.application_refinement_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before publishing refinement.' using errcode='42501'; end if;
  begin request_id:=(p_request->>'requestId')::uuid; application_id:=(p_request->>'applicationId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid refinement identifiers.' using errcode='22023'; end;
  if request_id is null or application_id is null then raise exception 'Refinement identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||application_id::text,0));
  select * into result from public.application_refinement_requests r where r.user_id=actor and r.id=request_id;
  if found then
    if result.request_json=p_request then return to_jsonb(result); end if;
    raise exception 'Request ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_requests(id,application_id,user_id,request_json,opportunity_snapshot,cv_snapshot)
    values(request_id,application_id,actor,p_request,'{}','{}') returning * into result;
  return to_jsonb(result);
end;
$$;
create function public.save_refinement_review(p_application_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result public.application_refinement_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before saving a review.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  select * into result from public.application_refinement_reviews where user_id=actor and id=p_id;
  if found then
    if result.application_id=p_application_id and result.request_id is not distinct from p_request_id and result.kind=p_kind and result.payload=p_payload then return to_jsonb(result); end if;
    raise exception 'Review ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_reviews(id,application_id,user_id,request_id,kind,payload) values(p_id,p_application_id,actor,p_request_id,p_kind,p_payload) returning * into result;
  return to_jsonb(result);
end;
$$;

create function private.read_refinement_request(request_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into result from public.application_refinement_requests where id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  return to_jsonb(result);
end;
$$;
create function private.save_refinement_proposal(request_id uuid,proposal_id uuid,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.application_refinement_proposals; request public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if request_id is null or proposal_id is null then raise exception 'Request and proposal identifiers are required.' using errcode='22023'; end if;
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  -- Match request/review publication and history clearing. Check again after the
  -- lock so a proposal waiting for a completed clear cannot revive old history.
  perform pg_advisory_xact_lock(hashtextextended(request.user_id::text||request.application_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(proposal_id::text,0));
  select * into request from public.application_refinement_requests r where r.id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  select * into result from public.application_refinement_proposals p where p.id=proposal_id;
  if found then
    if result.request_id=request_id and result.proposal_json=payload then return to_jsonb(result); end if;
    raise exception 'Proposal ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_proposals(id,application_id,user_id,request_id,proposal_json)
    values(proposal_id,request.application_id,request.user_id,request_id,payload) returning * into result;
  return to_jsonb(result);
end;
$$;

revoke all on function public.refinement_validate_setup(jsonb) from public,anon,service_role;
grant execute on function public.refinement_validate_setup(jsonb) to authenticated;
revoke all on function public.refinement_capture_state(), public.refinement_guard_immutable(), public.refinement_capture_request(), public.refinement_activate_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;
revoke all on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.save_refinement_state(uuid,jsonb,jsonb,integer), public.publish_refinement_request(jsonb), public.save_refinement_review(uuid,uuid,text,jsonb,uuid) to authenticated;
revoke all on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant usage on schema private to postgres;
grant execute on function private.read_refinement_request(uuid),private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

-- Immutable server-generated application reference codes.
-- Codes identify applications;
-- they are not authorization secrets and do not replace internal UUIDs or owner RLS.

alter table public.applications add column application_code text not null;
alter table public.applications
  add constraint applications_application_code_key unique(application_code),
  add constraint applications_application_code_format check(application_code ~ '^APP-[A-F0-9]{10}$');
comment on column public.applications.application_code is 'Immutable globally unique server-assigned application reference. Owner RLS still governs access; the UUID remains the internal key.';

create function public.job_workspace_assign_application_code()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    -- Ignore supplied values so browser clients cannot choose or reuse a code.
    new.application_code := 'APP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  elsif new.application_code is distinct from old.application_code then
    raise exception 'Application codes are immutable.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_assign_application_code() from public,anon,authenticated,service_role;
create trigger applications_application_code before insert or update on public.applications
  for each row execute function public.job_workspace_assign_application_code();

create function public.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before resolving an application.' using errcode='42501';
  end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'current_request_id',s.current_request_id)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.user_id=actor and (a.application_code=reference or a.id=resolved_id);
  if result is null then raise exception 'Application unavailable.' using errcode='42501'; end if;
  return result;
end;
$$;

create function private.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'current_request_id',s.current_request_id)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.application_code=reference or a.id=resolved_id;
  if result is null then raise exception 'Application unavailable.' using errcode='22023'; end if;
  return result;
end;
$$;

revoke all on function public.resolve_application_reference(text) from public,anon,service_role;
grant execute on function public.resolve_application_reference(text) to authenticated;
revoke all on function private.resolve_application_reference(text) from public,anon,authenticated,service_role;
grant execute on function private.resolve_application_reference(text) to postgres;

-- Structured CV refinement version 2
-- Structured CV contract for outer version-2 requests and proposals.

-- Match JavaScript String.length for new structured-contract size limits.
-- On UTF8 PostgreSQL, ascii(character) returns its Unicode code point.
create function public.refinement_utf16_length(value text)
returns integer language sql immutable strict security invoker set search_path='' as $$
  select coalesce(sum(case when ascii(character)>65535 then 2 else 1 end),0)::integer
    from string_to_table(value,null) as characters(character);
$$;

create function public.refinement_exact_keys(value jsonb, keys text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(value)='object' and value-keys='{}'::jsonb and value ?& keys,false);
$$;

create function public.refinement_reference_permutation(value jsonb, expected jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare actual_values text[]; expected_values text[];
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>1000
    or exists(select 1 from jsonb_array_elements(value) e where jsonb_typeof(e)<>'string') then
    raise exception 'CV order must contain a complete reference list.' using errcode='22023';
  end if;
  select coalesce(array_agg(v order by v),'{}') into actual_values from jsonb_array_elements_text(value) v;
  select coalesce(array_agg(v order by v),'{}') into expected_values from jsonb_array_elements_text(expected) v;
  if actual_values<>expected_values or cardinality(actual_values)<>(select count(distinct v) from unnest(actual_values) v) then
    raise exception 'CV order must be an exact permutation within its existing parent.' using errcode='22023';
  end if;
end;
$$;

create function public.refinement_validate_cv_structure(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  category text; item jsonb; expected jsonb; ids text[]; fields_map jsonb; sections_map jsonb; entries_map jsonb; bullets_map jsonb;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  keys text[]; id_pattern text; range_targets text[]:='{}'; unsupported_fields text[]:='{}'; range_target text;
begin
  if not public.refinement_exact_keys(value,array['schemaVersion','areas','sections','entries','bullets','ranges','unsupported'])
    or value->'schemaVersion' is distinct from '1'::jsonb then raise exception 'Invalid structured CV context.' using errcode='22023'; end if;
  foreach category in array array['areas','sections','entries','bullets','ranges','unsupported'] loop
    if jsonb_typeof(value->category) is distinct from 'array' or jsonb_array_length(value->category)>1000 then raise exception 'Invalid structured CV list.' using errcode='22023'; end if;
    if category='unsupported' then continue; end if;
    keys:=case category
      when 'areas' then array['id','sectionIds'] when 'sections' then array['id','label','area','entryIds']
      when 'entries' then array['id','sectionId','label','bulletIds'] when 'bullets' then array['id','entryId','fieldId','text']
      else array['id','fieldId','bulletId','text','label'] end;
    id_pattern:=case category when 'areas' then '^(body|sidebar)$' when 'sections' then '^section-[1-9][0-9]*$'
      when 'entries' then '^entry-[1-9][0-9]*$' when 'bullets' then '^bullet-[1-9][0-9]*$' else '^range-[1-9][0-9]*$' end;
    ids:='{}';
    for item in select jsonb_array_elements(value->category) loop
      if not public.refinement_exact_keys(item,case when category='ranges' and item ? 'typoOnly' then array_append(keys,'typoOnly') else keys end) or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~ id_pattern or item->>'id'=any(ids) then raise exception 'Invalid or duplicate structured CV reference.' using errcode='22023'; end if;
      ids:=array_append(ids,item->>'id');
      if category='bullets' and item->>'text'~E'[\r\n]' then raise exception 'A CV bullet must occupy one line.' using errcode='22023'; end if;
      if category in ('sections','entries','ranges') and (jsonb_typeof(item->'label') is distinct from 'string'
        or public.refinement_utf16_length(item->>'label')>200 or btrim(item->>'label',whitespace_chars)='' or translate(item->>'label',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV label.' using errcode='22023';
      end if;
      if category in ('bullets','ranges') and (jsonb_typeof(item->'text') is distinct from 'string'
        or public.refinement_utf16_length(item->>'text')>20000 or btrim(item->>'text',whitespace_chars)='' or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]') then
        raise exception 'Invalid structured CV text.' using errcode='22023';
      end if;
    end loop;
  end loop;
  perform public.refinement_reference_permutation((select coalesce(jsonb_agg(e->'id'),'[]') from jsonb_array_elements(value->'areas') e),'["body","sidebar"]');
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into fields_map from jsonb_array_elements(fields) e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into sections_map from jsonb_array_elements(value->'sections') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into entries_map from jsonb_array_elements(value->'entries') e;
  select coalesce(jsonb_object_agg(e->>'id',e),'{}') into bullets_map from jsonb_array_elements(value->'bullets') e;
  for item in select jsonb_array_elements(value->'areas') loop
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'sections') e where e->>'area'=item->>'id';
    perform public.refinement_reference_permutation(item->'sectionIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'sections') loop
    if coalesce(item->>'area','') not in ('body','sidebar') then raise exception 'Unknown CV area.' using errcode='22023'; end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'entries') e where e->'sectionId'=item->'id';
    perform public.refinement_reference_permutation(item->'entryIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'entries') loop
    if not coalesce(sections_map ? (item->>'sectionId'),false) then raise exception 'Unknown CV section.' using errcode='22023'; end if;
    if (select count(distinct e->>'fieldId') from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id')>1 then
      raise exception 'An entry can expose bullets from only one field.' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(value->'bullets') e where e->'entryId'=item->'id';
    perform public.refinement_reference_permutation(item->'bulletIds',expected);
  end loop;
  for item in select jsonb_array_elements(value->'bullets') loop
    if not coalesce(entries_map ? (item->>'entryId'),false) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or position(item->>'text' in fields_map->(item->>'fieldId')->>'text')=0 then
      raise exception 'CV bullet must belong to an authorized field and entry.' using errcode='22023';
    end if;
  end loop;
  for item in select jsonb_array_elements(value->'ranges') loop
    if item ? 'typoOnly' and (item->'typoOnly' is distinct from 'true'::jsonb or item->'bulletId' is distinct from 'null'::jsonb) then
      raise exception 'A typo-only range must be a whole field and explicitly marked true.' using errcode='22023';
    end if;
    if not coalesce(fields_map ? (item->>'fieldId'),false) or jsonb_typeof(item->'bulletId') not in ('string','null') then raise exception 'Unknown CV text range.' using errcode='22023'; end if;
    if item->'bulletId'='null'::jsonb then
      if item->'text' is distinct from fields_map->(item->>'fieldId')->'text'
        or exists(select 1 from jsonb_array_elements(value->'bullets') e where e->'fieldId'=item->'fieldId') then
        raise exception 'A prose range must match its whole non-bullet field.' using errcode='22023';
      end if;
    elsif not coalesce(bullets_map ? (item->>'bulletId'),false)
      or item->'fieldId' is distinct from bullets_map->(item->>'bulletId')->'fieldId'
      or item->'text' is distinct from bullets_map->(item->>'bulletId')->'text' then
      raise exception 'A bullet range must exactly match its authorized bullet.' using errcode='22023';
    end if;
    range_target:=(item->>'fieldId')||':'||coalesce(item->>'bulletId','');
    if range_target=any(range_targets) then raise exception 'Duplicate CV range target.' using errcode='22023'; end if;
    range_targets:=array_append(range_targets,range_target);
  end loop;
  for item in select jsonb_array_elements(value->'unsupported') loop
    if not public.refinement_exact_keys(item,array['fieldId','reason']) or not coalesce(fields_map ? (item->>'fieldId'),false)
      or item->>'fieldId'=any(unsupported_fields) or jsonb_typeof(item->'reason') is distinct from 'string'
      or exists(select 1 from jsonb_array_elements((value->'bullets')||(value->'ranges')) e where e->'fieldId'=item->'fieldId')
      or public.refinement_utf16_length(item->>'reason')>1000 or btrim(item->>'reason',whitespace_chars)='' or translate(item->>'reason',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid unsupported CV field.' using errcode='22023';
    end if;
    unsupported_fields:=array_append(unsupported_fields,item->>'fieldId');
  end loop;
end;
$$;

create function public.refinement_close_spelling(before_word text, after_word text, budget integer)
returns boolean language plpgsql immutable strict security invoker set search_path='' as $$
declare position integer:=1; before_length integer:=char_length(before_word); after_length integer:=char_length(after_word);
begin
  if budget<0 or budget>2 or greatest(before_length,after_length)>64 then return false; end if;
  while position<=least(before_length,after_length) and substr(before_word,position,1)=substr(after_word,position,1) loop
    position:=position+1;
  end loop;
  if position>least(before_length,after_length) then return abs(before_length-after_length)<=budget; end if;
  if budget=0 or abs(before_length-after_length)>budget then return false; end if;
  return public.refinement_close_spelling(substr(before_word,position+1),substr(after_word,position+1),budget-1)
    or public.refinement_close_spelling(substr(before_word,position+1),substr(after_word,position),budget-1)
    or public.refinement_close_spelling(substr(before_word,position),substr(after_word,position+1),budget-1)
    or (substr(before_word,position,1)=substr(after_word,position+1,1)
      and substr(before_word,position+1,1)=substr(after_word,position,1)
      and public.refinement_close_spelling(substr(before_word,position+2),substr(after_word,position+2),budget-1));
end;
$$;

create function public.refinement_validate_typo_fix(original text, replacement text, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  whitespace text:=E'[[:space:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';
  spelling_pattern text:=E'^([^[:alnum:]\u0300-\u036F]*)([[:alpha:]\u0300-\u036F]+)([^[:alnum:]\u0300-\u036F]*)$';
  before_words text[]; after_words text[]; before_parts text[]; after_parts text[]; position integer;
begin
  if original is null or replacement is null or replacement=original or btrim(replacement,whitespace_chars)=''
    or public.refinement_utf16_length(replacement)>20000 then
    raise exception 'A typo correction must change bounded nonempty text.' using errcode='22023';
  end if;
  if regexp_replace(original,'[^'||substr(whitespace,2,char_length(whitespace)-2)||']+','X','g')
    <>regexp_replace(replacement,'[^'||substr(whitespace,2,char_length(whitespace)-2)||']+','X','g') then
    raise exception 'Typo corrections must preserve whitespace and word count.' using errcode='22023';
  end if;
  before_words:=regexp_split_to_array(original,whitespace||'+');
  after_words:=regexp_split_to_array(replacement,whitespace||'+');
  if cardinality(before_words)<>cardinality(after_words) then
    raise exception 'Typo corrections cannot add or remove words.' using errcode='22023';
  end if;
  for position in 1..cardinality(before_words) loop
    if before_words[position]=after_words[position] then continue; end if;
    before_parts:=regexp_match(before_words[position],spelling_pattern);
    after_parts:=regexp_match(after_words[position],spelling_pattern);
    if before_parts is null or after_parts is null or before_parts[1]<>after_parts[1] or before_parts[3]<>after_parts[3]
      or not public.refinement_close_spelling(before_parts[2],after_parts[2],case when least(char_length(before_parts[2]),char_length(after_parts[2]))<5 then 1 else 2 end) then
      raise exception 'Typo corrections allow only small spelling changes and preserve punctuation, numbers and protected content.' using errcode='22023';
    end if;
  end loop;
  perform public.cv_adjustment_validate_response(
    jsonb_build_object('schemaVersion',1,'requestId',expected_id,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',translate(replacement,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),
    jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id','field-1','text',translate(original,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),expected_id);
end;
$$;

revoke all on function public.refinement_close_spelling(text,text,integer), public.refinement_validate_typo_fix(text,text,uuid) from public,anon,service_role;
grant execute on function public.refinement_close_spelling(text,text,integer), public.refinement_validate_typo_fix(text,text,uuid) to authenticated;

create function public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare
  item jsonb; target jsonb; original text; replacement text; expected jsonb; structure jsonb:=request_value->'cvStructure';
  ids text[]:='{}'; targets text[]:='{}'; omitted text[]:='{}'; shortened_bullets text[]:='{}'; corrected_bullets text[]:='{}'; edited_ranges text[]:='{}'; signature text;
  whitespace_chars text:=E' \t\n\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  words text[]; word text; cursor_index integer; total integer; whitespace text:=E'[[:space:]\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+';
begin
  if jsonb_typeof(value->'cvOperations') is distinct from 'array' or jsonb_typeof(value->'cvComments') is distinct from 'array'
    or jsonb_array_length(value->'cvOperations')>1000 or jsonb_array_length(value->'cvComments')>1000 then
    raise exception 'Invalid CV operations or comments.' using errcode='22023';
  end if;
  for item in select jsonb_array_elements(value->'cvOperations') loop
    if jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^change-[1-9][0-9]*$' or item->>'id'=any(ids)
      or jsonb_typeof(item->'targetId') is distinct from 'string' or jsonb_typeof(item->'explanation') is distinct from 'string'
      or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)='' or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then
      raise exception 'Invalid CV change ID, target or explanation.' using errcode='22023';
    end if;
    ids:=array_append(ids,item->>'id');
    signature:=(item->>'type')||':'||(item->>'targetId');
    if signature=any(targets) then raise exception 'Duplicate CV operation target.' using errcode='22023'; end if;
    targets:=array_append(targets,signature);
    if item->>'type' in ('reorder_sections','reorder_entries','reorder_bullets') then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','order']) then raise exception 'Invalid CV reorder operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->(case item->>'type' when 'reorder_sections' then 'areas' when 'reorder_entries' then 'sections' else 'entries' end)) e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV reorder target.' using errcode='22023'; end if;
      expected:=target->(case item->>'type' when 'reorder_sections' then 'sectionIds' when 'reorder_entries' then 'entryIds' else 'bulletIds' end);
      if jsonb_array_length(expected)=0 then raise exception 'An empty CV container cannot be reordered.' using errcode='22023'; end if;
      perform public.refinement_reference_permutation(item->'order',expected);
    elsif item->>'type'='omit_bullet' then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation'])
        or not exists(select 1 from jsonb_array_elements(structure->'bullets') e where e->'id'=item->'targetId') then raise exception 'Unknown CV omission target.' using errcode='22023'; end if;
      omitted:=array_append(omitted,item->>'targetId');
    elsif item->>'type' in ('shorten_text','fix_typos') then
      if not public.refinement_exact_keys(item,array['id','type','targetId','explanation','text']) or jsonb_typeof(item->'text') is distinct from 'string' then raise exception 'Invalid CV text operation.' using errcode='22023'; end if;
      select e into target from jsonb_array_elements(structure->'ranges') e where e->'id'=item->'targetId';
      if not found then raise exception 'Unknown CV text range.' using errcode='22023'; end if;
      if item->>'targetId'=any(edited_ranges) then raise exception 'Conflicting CV text operations target the same range.' using errcode='22023'; end if;
      edited_ranges:=array_append(edited_ranges,item->>'targetId');
      original:=target->>'text'; replacement:=item->>'text';
      if item->>'type'='fix_typos' then
        if target->>'bulletId' is not null and replacement~E'[\r\n]' then raise exception 'A corrected bullet must occupy one line.' using errcode='22023'; end if;
        perform public.refinement_validate_typo_fix(original,replacement,expected_id);
        if target->>'bulletId' is not null then corrected_bullets:=array_append(corrected_bullets,target->>'bulletId'); end if;
        continue;
      end if;
      if target->'typoOnly'='true'::jsonb then raise exception 'This CV range permits spelling corrections only.' using errcode='22023'; end if;
      if target->>'bulletId' is not null and replacement~E'[\r\n]' then raise exception 'A shortened bullet must occupy one line.' using errcode='22023'; end if;
      if public.refinement_utf16_length(replacement)>20000 or char_length(replacement)>=char_length(original) or regexp_replace(replacement,whitespace,'','g')='' then raise exception 'A shortened range must be nonempty and strictly shorter.' using errcode='22023'; end if;
      select coalesce(array_agg(v order by n),'{}') into words from regexp_split_to_table(original,whitespace) with ordinality as w(v,n) where v<>'';
      cursor_index:=1; total:=cardinality(words);
      for word in select v from regexp_split_to_table(replacement,whitespace) v where v<>'' loop
        while cursor_index<=total and words[cursor_index]<>word loop cursor_index:=cursor_index+1; end loop;
        if cursor_index>total then raise exception 'Shortening may only remove original words in their existing order.' using errcode='22023'; end if;
        cursor_index:=cursor_index+1;
      end loop;
      -- Normalize only the synthetic validation view so the legacy POSIX link
      -- regex sees the same whitespace boundaries as JavaScript. Keep character
      -- counts unchanged so shortening cannot trigger its unchanged-text shortcut.
      perform public.cv_adjustment_validate_response(
        jsonb_build_object('schemaVersion',1,'requestId',expected_id,'edits',jsonb_build_array(jsonb_build_object('fieldId','field-1','text',translate(replacement,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),
        jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('id','field-1','text',translate(original,whitespace_chars,repeat(' ',char_length(whitespace_chars)))))),expected_id);
      if target->>'bulletId' is not null then shortened_bullets:=array_append(shortened_bullets,target->>'bulletId'); end if;
    else raise exception 'Unsupported CV operation.' using errcode='22023'; end if;
  end loop;
  if omitted && shortened_bullets then raise exception 'A CV bullet cannot be omitted and shortened in one proposal.' using errcode='22023'; end if;
  if omitted && corrected_bullets then raise exception 'A CV bullet cannot be omitted and corrected in one proposal.' using errcode='22023'; end if;
  ids:='{}';
  for item in select jsonb_array_elements(value->'cvComments') loop
    if not public.refinement_exact_keys(item,array['id','fieldId','explanation']) or jsonb_typeof(item->'id') is distinct from 'string'
      or item->>'id' !~ '^comment-[1-9][0-9]*$' or item->>'id'=any(ids)
      or not exists(select 1 from jsonb_array_elements(request_value#>'{cv,fields}') e where e->'id'=item->'fieldId')
      or jsonb_typeof(item->'explanation') is distinct from 'string' or public.refinement_utf16_length(item->>'explanation')>1000 or btrim(item->>'explanation',whitespace_chars)=''
      or translate(item->>'explanation',E'\t\n\r','')~'[[:cntrl:]]' then raise exception 'Invalid CV comment.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
end;
$$;

create function public.refinement_validate_cv_decisions(value jsonb, proposal jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare expected jsonb;
begin
  if not public.refinement_exact_keys(value,array['proposalId','accepted','rejected','revision'])
    or jsonb_typeof(value->'proposalId') is distinct from 'string'
    or jsonb_typeof(value->'revision') is distinct from 'string' or value->>'revision' !~ '^v1:[a-f0-9]{64}$'
    or jsonb_typeof(value->'accepted') is distinct from 'array' or jsonb_typeof(value->'rejected') is distinct from 'array' then
    raise exception 'Invalid CV decision payload.' using errcode='22023';
  end if;
  if proposal->'schemaVersion' is distinct from '2'::jsonb then raise exception 'Unsupported refinement proposal version.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(e->'id'),'[]') into expected from jsonb_array_elements(proposal->'cvOperations') e;
  perform public.refinement_reference_permutation((value->'accepted')||(value->'rejected'),expected);
end;
$$;

-- Pure validators expose no stored data. Owner request/review triggers need these
-- invoker calls; the unchanged proposal write path still requires postgres.
revoke all on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.refinement_utf16_length(text), public.refinement_exact_keys(jsonb,text[]), public.refinement_reference_permutation(jsonb,jsonb), public.refinement_validate_cv_structure(jsonb,jsonb), public.refinement_validate_cv_operations(jsonb,jsonb,uuid), public.refinement_validate_cv_decisions(jsonb,jsonb) to authenticated;
revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;

-- Shared CV/letter annotations and persistent referenced reviews.
-- Additive v2 annotation extension. No document content or older proposals are rewritten.
-- All annotation status, responses and feedback stay in reviews.
create function public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; location jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then raise exception 'Invalid refinement annotations.' using errcode='22023'; end if;
  for item in select v from jsonb_array_elements(value) as x(v) loop
    if not public.refinement_exact_keys(item,array['id','type','document','location','text'])
      or jsonb_typeof(item->'id') is distinct from 'string' or coalesce(item->>'id','') !~ '^annotation-[1-9][0-9]*$' or item->>'id'=any(ids)
      or coalesce(item->>'type','') not in ('comment','todo','question') or coalesce(item->>'document','') not in ('cv','letter')
      or jsonb_typeof(item->'text') is distinct from 'string' or btrim(item->>'text')=''
      or public.refinement_utf16_length(item->>'text')>4000
      or translate(item->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or item is distinct from public.job_drafting_redact_samples(item) then raise exception 'Invalid refinement annotation.' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id'); location:=item->'location';
    if location='null'::jsonb then continue; end if;
    if item->>'document'='cv' then
      if not public.refinement_exact_keys(location,array['fieldId']) or jsonb_typeof(location->'fieldId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(fields) as f(v) where v->'id'=location->'fieldId') then raise exception 'Unknown CV annotation field.' using errcode='22023'; end if;
    else
      if not public.refinement_exact_keys(location,array['start','quote']) or jsonb_typeof(location->'start') is distinct from 'number'
        or coalesce(location->>'start','') !~ '^(0|[1-9][0-9]{0,5})$'
        or jsonb_typeof(location->'quote') is distinct from 'string' or btrim(location->>'quote')=''
        or public.refinement_utf16_length(location->>'quote')>2000 then raise exception 'Invalid letter annotation reference.' using errcode='22023'; end if;
      if substring(letter_text from (location->>'start')::integer+1 for char_length(location->>'quote')) is distinct from location->>'quote' then
        raise exception 'Invalid letter annotation reference.' using errcode='22023';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.refinement_validate_annotations(jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.refinement_validate_annotations(jsonb,jsonb,text) to authenticated;

revoke all on function public.refinement_capture_request(), public.refinement_capture_review(), public.refinement_capture_proposal() from public,anon,authenticated,service_role;

-- Ticket 6: explicit pseudonymization and approved context descriptions.
-- Optional user-approved context for existing public tokens; private originals and maps stay local.
-- Optional approved privacy context on current version-2 requests.
create or replace function public.refinement_validate_privacy_legend(value jsonb, fields jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; seen text[]:='{}'; source_text text;
begin
  if jsonb_typeof(value) is distinct from 'array' then raise exception 'Invalid privacy legend.' using errcode='22023'; end if;
  if jsonb_array_length(value)>1000 then raise exception 'Privacy legend is too large.' using errcode='22023'; end if;
  for item in select jsonb_array_elements(value) loop
    if not public.refinement_exact_keys(item,array['fieldId','token','type','description'])
      or jsonb_typeof(item->'fieldId') is distinct from 'string'
      or jsonb_typeof(item->'token') is distinct from 'string' or item->>'token' !~ '^\{\{PRIVATE_[1-9][0-9]*\}\}$'
      or coalesce(item->>'type','') not in ('person','organization','location','link','contact','confidential','other')
      or jsonb_typeof(item->'description') is distinct from 'string'
      or coalesce(btrim(item->>'description', E' \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'),'')='' or public.refinement_utf16_length(item->>'description')>500
      or item->>'description' ~ '[[:cntrl:]]|\{\{|\}\}|<|>' then
      raise exception 'Invalid approved privacy context.' using errcode='22023';
    end if;
    select field->>'text' into source_text from jsonb_array_elements(fields) field where field->>'id'=item->>'fieldId';
    if source_text is null or position(item->>'token' in source_text)=0 or item->>'token'=any(seen) then
      raise exception 'Privacy context must reference a unique token in its original field.' using errcode='22023';
    end if;
    seen:=array_append(seen,item->>'token');
  end loop;
end;
$$;
revoke all on function public.refinement_validate_privacy_legend(jsonb,jsonb) from public, anon, service_role;
grant execute on function public.refinement_validate_privacy_legend(jsonb,jsonb) to authenticated;

revoke all on function public.refinement_capture_request() from public, anon, authenticated, service_role;
revoke all on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) from public, anon;
grant execute on function public.cv_adjustment_validate_response(jsonb,jsonb,uuid) to authenticated;

-- Record status transitions on the existing owner-protected application row.

alter table public.applications add column status_history jsonb not null default '[]'::jsonb;

alter table public.applications add constraint applications_status_history_array
  check (jsonb_typeof(status_history) = 'array' and jsonb_array_length(status_history) > 0);

create function public.job_workspace_record_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(jsonb_build_object('status', new.status, 'changedAt', clock_timestamp()));
  elsif current_user = 'postgres' and auth.uid() = old.user_id
    and current_setting('cv_builder.resetting_application_history', true) = old.user_id::text || ':' || old.id::text
    and to_jsonb(new) - 'status_history' = to_jsonb(old) - 'status_history' then
    -- Only the owner-checked private reset helper can remove earlier entries.
    return new;
  else
    -- Clients may update the status, but cannot forge, remove or replace history.
    new.status_history := old.status_history;
    if new.status is distinct from old.status then
      new.status_history := old.status_history || jsonb_build_array(jsonb_build_object('status', new.status, 'changedAt', clock_timestamp()));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_record_status() from public, anon, authenticated;
create trigger applications_status_history before insert or update on public.applications
  for each row execute function public.job_workspace_record_status();
comment on column public.applications.status_history is 'Server-maintained ordered status transitions. A null changedAt marks an existing status whose transition time was never recorded. Owner RLS is inherited from applications.';

-- Local attachment metadata library (files remain in browser storage).
-- Reusable attachment descriptions only. File bytes and all file-derived metadata remain local.

create table public.local_attachment_metadata (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null,
  constraint local_attachment_name_valid check (
    public.refinement_utf16_length(name) between 1 and 200
    and name=btrim(name, E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and name !~ '[[:cntrl:]]'),
  constraint local_attachment_description_valid check (
    public.refinement_utf16_length(description) between 1 and 4000
    and description=btrim(description, E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    and translate(description, E'\t\n\r', '') !~ '[[:cntrl:]]')
);
create index local_attachment_metadata_user_idx on public.local_attachment_metadata(user_id);
alter table public.local_attachment_metadata enable row level security;
revoke all on public.local_attachment_metadata from public, anon, authenticated, service_role;
grant select, insert, delete on public.local_attachment_metadata to authenticated;
grant update(name, description) on public.local_attachment_metadata to authenticated;

create policy "Read own attachment descriptions" on public.local_attachment_metadata for select to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Insert own attachment descriptions" on public.local_attachment_metadata for insert to authenticated
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Update own attachment descriptions" on public.local_attachment_metadata for update to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false))
  with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Delete own attachment descriptions" on public.local_attachment_metadata for delete to authenticated
  using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function public.save_local_attachment_metadata(p_id uuid, p_name text, p_description text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved public.local_attachment_metadata;
  whitespace_chars constant text:=E' \t\n\r\013\f'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before saving attachment descriptions.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'An attachment reference is required.' using errcode='22023'; end if;
  insert into public.local_attachment_metadata(id,user_id,name,description)
    values(p_id,actor,btrim(p_name,whitespace_chars),btrim(p_description,whitespace_chars))
    on conflict(id) do update set name=excluded.name,description=excluded.description
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.delete_local_attachment_metadata(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before removing attachment descriptions.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'An attachment reference is required.' using errcode='22023'; end if;
  delete from public.local_attachment_metadata where id=p_id and user_id=auth.uid();
end;
$$;
revoke all on function public.save_local_attachment_metadata(uuid,text,text), public.delete_local_attachment_metadata(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_local_attachment_metadata(uuid,text,text), public.delete_local_attachment_metadata(uuid)
  to authenticated;
comment on table public.local_attachment_metadata is 'Only user-entered attachment names and descriptions, with technical identity/ownership. Files, filenames, paths, MIME types, sizes, extracted text, and application selections stay in local browser storage.';

-- Owner-requested history removal.
-- Documents, assigned CV snapshots, setup and approval hashes remain unchanged.

create function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'An application and current refinement revision are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then
    raise exception 'Application unavailable.' using errcode='42501';
  end if;
  select * into result from public.application_refinement_state
    where user_id=actor and application_id=p_application_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    return 'null'::jsonb;
  end if;
  if result.revision<>p_expected_revision then
    raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001';
  end if;
  update public.application_refinement_state set current_request_id=null,revision=revision+1
    where user_id=actor and application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  -- Reviews without a request (including approval history) must also be removed.
  delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
  -- Request deletion cascades to its proposals. Restore the transaction-local
  -- scope on success; an exception rolls back both deletions and the setting.
  delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

-- The owner-checked private helper supplies the narrowly scoped delete permission.
-- The public entry point remains invoker-only.
create function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision);
$$;
alter function public.clear_refinement_history(uuid,integer) owner to postgres;
revoke all on function private.clear_refinement_history(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.clear_refinement_history(uuid,integer) to postgres;
revoke all on function public.clear_refinement_history(uuid,integer) from public,anon,service_role;
grant execute on function public.clear_refinement_history(uuid,integer) to authenticated;
revoke all on function public.refinement_guard_immutable() from public,anon,authenticated,service_role;

revoke all on function private.save_refinement_proposal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_refinement_proposal(uuid,uuid,jsonb) to postgres;

-- Keep elevated execution outside the exposed API schema.
alter function private.clear_refinement_history(uuid,integer) owner to postgres;
-- USAGE permits resolving this helper; existing management helpers retain their
-- revoked EXECUTE grants and cannot be called by authenticated users.
grant usage on schema private to authenticated;
grant execute on function private.clear_refinement_history(uuid,integer) to authenticated;
-- Store the exact connected protocol before copying a task. Existing source snapshots stay immutable.
create table public.application_refinement_protocols (
  request_id uuid not null,
  protocol_id text not null check (protocol_id ~ '^v1:[0-9a-f]{64}$'),
  application_id uuid not null,
  user_id uuid not null,
  protocol_text text not null check (char_length(protocol_text) between 1 and 100000),
  created_at timestamptz not null default now(),
  primary key (request_id, protocol_id),
  foreign key (user_id, application_id, request_id)
    references public.application_refinement_requests(user_id, application_id, id) on delete cascade
);
create index application_refinement_protocols_owner_request_idx
  on public.application_refinement_protocols(user_id, application_id, request_id);
alter table public.application_refinement_protocols enable row level security;
revoke all on public.application_refinement_protocols from public, anon, authenticated, service_role;
grant select, insert on public.application_refinement_protocols to authenticated;
create policy "Read own refinement protocols" on public.application_refinement_protocols
  for select to authenticated using ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));
create policy "Publish own refinement protocols" on public.application_refinement_protocols
  for insert to authenticated with check ((select auth.uid())=user_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false));

create function private.prevent_refinement_protocol_update()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Published refinement protocols are immutable.' using errcode='42501';
end;
$$;
revoke all on function private.prevent_refinement_protocol_update() from public, anon, authenticated, service_role;
create trigger refinement_protocol_immutable before update on public.application_refinement_protocols
  for each row execute function private.prevent_refinement_protocol_update();

create function public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); source public.application_refinement_requests;
  saved public.application_refinement_protocols;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before publishing a refinement protocol.' using errcode='42501';
  end if;
  if p_request_id is null or p_protocol_id is null or p_protocol_id !~ '^v1:[0-9a-f]{64}$'
    or p_protocol_text is null or char_length(p_protocol_text) not between 1 and 100000 then
    raise exception 'Invalid refinement protocol document.' using errcode='22023';
  end if;
  select * into source from public.application_refinement_requests where id=p_request_id and user_id=actor;
  if not found then raise exception 'Published request not found for this account.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||source.application_id::text,0));
  if not exists (select 1 from public.application_refinement_state where user_id=actor
    and application_id=source.application_id and current_request_id=p_request_id) then
    raise exception 'The current refinement request changed. Copy the task again.' using errcode='40001';
  end if;
  insert into public.application_refinement_protocols(request_id,protocol_id,application_id,user_id,protocol_text)
    values(p_request_id,p_protocol_id,source.application_id,actor,p_protocol_text)
    on conflict (request_id,protocol_id) do nothing;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if saved.protocol_text is distinct from p_protocol_text then
    raise exception 'This protocol identifier already belongs to different instructions.' using errcode='22023';
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.publish_refinement_protocol(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_refinement_protocol(uuid,text,text) to authenticated;

create function private.read_refinement_protocol(p_request_id uuid, p_protocol_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.application_refinement_protocols;
begin
  if current_user<>'postgres' then raise exception 'Use the authorized management connection.' using errcode='42501'; end if;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if not found then raise exception 'Refinement protocol not found. Copy the task again in the app.' using errcode='P0002'; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function private.read_refinement_protocol(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.read_refinement_protocol(uuid,text) to postgres;

-- Persist the open application stage and stop deriving status after explicit tracking.

alter table public.applications
  add column workflow_stage text not null default 'preparation'
    check (workflow_stage in ('preparation','refinement','review','tracking')),
  add column tracking_started boolean not null default false;

create function public.job_workspace_track_stage()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Older clients can still submit the former Ready name.
    if new.status = 'shortlist' then new.status := 'ready'; new.workflow_stage := 'tracking'; end if;
    new.tracking_started := new.tracking_started or new.status in ('contacted','submitted','interview','offer','rejected','withdrawn');
  else
    -- Explicit status writes lock tracking; clients cannot later clear the lock.
    new.tracking_started := old.tracking_started or new.tracking_started or new.status is distinct from old.status;
  end if;
  if new.tracking_started then
    if new.status not in ('ready','contacted','submitted','interview','offer','rejected','withdrawn') then
      raise exception 'Select a valid tracking status.' using errcode = '23514';
    end if;
  elsif new.workflow_stage <> 'tracking' then
    -- Tracking only displays and edits history; opening it never selects Ready.
    new.status := case new.workflow_stage
      when 'preparation' then 'preparation' when 'refinement' then 'refinement'
      when 'review' then 'attachments' end;
  end if;
  return new;
end;
$$;
revoke all on function public.job_workspace_track_stage() from public, anon, authenticated, service_role;
-- Runs before applications_status_history so history records the final status.
create trigger applications_stage_state before insert or update on public.applications
  for each row execute function public.job_workspace_track_stage();

create function public.set_job_application_stage(p_application_id uuid, p_stage text)
returns public.applications language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); saved public.applications;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before changing an application stage.' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('preparation','refinement','review','tracking') then
    raise exception 'Select a valid application stage.' using errcode = '22023';
  end if;
  -- One UPDATE takes the row lock. A concurrent explicit status save wins in
  -- either order because the trigger reads the current row's sticky lock.
  update public.applications set workflow_stage = p_stage
    where id = p_application_id and user_id = actor returning * into saved;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  return saved;
end;
$$;
revoke all on function public.set_job_application_stage(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_job_application_stage(uuid, text) to authenticated;

comment on column public.applications.workflow_stage is 'Last active application tab. Before explicit tracking, Preparation, Refinement and Attachments set their matching status; Tracking preserves the current status.';
comment on column public.applications.tracking_started is 'Sticky after the first explicit Tracking status choice, including Ready. Stage changes continue to save but no longer change status.';

-- Reset only the status timeline; retain the current state and its recorded time.
create function private.reset_job_application_history(p_application_id uuid)
returns public.applications language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); saved public.applications; latest jsonb; retained jsonb;
  previous_scope text := current_setting('cv_builder.resetting_application_history', true);
begin
  if current_user <> 'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in before resetting application history.' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'An application is required.' using errcode = '22023';
  end if;
  -- Serialize with status/stage writes, so a concurrent transition is not lost.
  select * into saved from public.applications where id = p_application_id and user_id = actor for update;
  if not found then raise exception 'Application was not found.' using errcode = '42501'; end if;
  latest := saved.status_history -> -1;
  retained := jsonb_build_object('status', saved.status, 'changedAt', null);
  if jsonb_typeof(latest) = 'object' and latest->>'status' = saved.status then
    if latest->'changedAt' = 'null'::jsonb then
      retained := jsonb_build_object('status', saved.status, 'changedAt', null);
    elsif jsonb_typeof(latest->'changedAt') = 'string' then
      begin
        if isfinite((latest->>'changedAt')::timestamptz) then
          retained := jsonb_build_object('status', saved.status, 'changedAt', latest->'changedAt');
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        -- Legacy malformed/unknown times must not become a new transition date.
        null;
      end;
    end if;
  end if;
  retained := jsonb_build_array(retained);
  if saved.status_history = retained then return saved; end if;
  perform set_config('cv_builder.resetting_application_history', actor::text || ':' || p_application_id::text, true);
  update public.applications set status_history = retained
    where id = p_application_id and user_id = actor returning * into saved;
  -- Exceptions roll back both the update and the transaction-local scope.
  perform set_config('cv_builder.resetting_application_history', coalesce(previous_scope, ''), true);
  return saved;
end;
$$;

create function public.reset_job_application_history(p_application_id uuid)
returns public.applications language sql security invoker set search_path = '' as $$
  select private.reset_job_application_history(p_application_id);
$$;
alter function private.reset_job_application_history(uuid) owner to postgres;
alter function public.reset_job_application_history(uuid) owner to postgres;
revoke all on function private.reset_job_application_history(uuid) from public, anon, authenticated, service_role;
grant execute on function private.reset_job_application_history(uuid) to authenticated, postgres;
revoke all on function public.reset_job_application_history(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reset_job_application_history(uuid) to authenticated;

commit;

-- Additive upgrade: clear one document's refinement history without discarding
-- the other document's rounds. Legacy shared rounds survive until both are cleared.
alter table public.application_refinement_requests
  add column cleared_scopes text[] not null default '{}' check (cleared_scopes in ('{}'::text[],'{cv}'::text[],'{letter}'::text[],'{cv,letter}'::text[]));
alter table public.application_refinement_reviews
  add column cleared_scopes text[] not null default '{}' check (cleared_scopes in ('{}'::text[],'{cv}'::text[],'{letter}'::text[],'{cv,letter}'::text[]));

create or replace function public.refinement_guard_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if current_user='postgres' and auth.uid()=old.user_id
    and current_setting('cv_builder.clearing_refinement_history',true)=old.user_id::text||':'||old.application_id::text then
    if tg_op='DELETE' then return old; end if;
    if tg_op='UPDATE' and tg_table_name in ('application_refinement_requests','application_refinement_reviews')
      and to_jsonb(new)-'cleared_scopes'=to_jsonb(old)-'cleared_scopes'
      and (to_jsonb(new)->'cleared_scopes') @> (to_jsonb(old)->'cleared_scopes') then return new; end if;
  end if;
  raise exception 'Refinement history is immutable; create a new round or clear history.' using errcode='23514';
end;
$$;

-- Client inserts may not pre-clear history; only the owner-checked helper below
-- can mutate this metadata after publication.
create function public.refinement_guard_initial_history_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.cleared_scopes<>'{}'::text[] then raise exception 'New refinement history cannot already be cleared.' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger refinement_requests_initial_scope before insert on public.application_refinement_requests
  for each row execute function public.refinement_guard_initial_history_scope();
create trigger refinement_reviews_initial_scope before insert on public.application_refinement_reviews
  for each row execute function public.refinement_guard_initial_history_scope();
revoke all on function public.refinement_guard_initial_history_scope() from public,anon,authenticated,service_role;

create function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
  removed integer;
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0
    or p_scope is null or p_scope not in ('cv','letter','both') then
    raise exception 'An application, refinement scope and current revision are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then
    raise exception 'Application unavailable.' using errcode='42501';
  end if;
  select * into result from public.application_refinement_state
    where user_id=actor and application_id=p_application_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    return 'null'::jsonb;
  end if;
  if result.revision<>p_expected_revision then
    raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001';
  end if;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  if p_scope='both' then
    delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
    delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  else
    update public.application_refinement_requests
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and request_json->>'scope' in ('both',p_scope)
        and not (p_scope=any(cleared_scopes));
    update public.application_refinement_reviews
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and kind='feedback' and payload->>'scope'='both'
        and not (p_scope=any(cleared_scopes));
    delete from public.application_refinement_reviews r where r.user_id=actor and r.application_id=p_application_id and (
      r.cleared_scopes=array['cv','letter']
      or r.kind in ('approve_'||p_scope,'reopen_'||p_scope)
      or (p_scope='cv' and r.kind='cv_decisions')
      or (r.kind='feedback' and r.payload->>'scope'=p_scope)
      or (r.kind='annotation' and exists (
        select 1 from public.application_refinement_proposals p,
          lateral jsonb_array_elements(coalesce(p.proposal_json->'annotations','[]'::jsonb)) a
        where p.user_id=actor and p.application_id=p_application_id and p.id::text=r.payload->>'proposalId'
          and a->>'id'=r.payload->>'annotationId' and a->>'document'=p_scope
      ))
    );
    -- Older clients linked reviews for either document to the global current
    -- request. Keep that immutable source while the other document needs it,
    -- along with ancestors referenced by surviving iteration lineage.
    loop
      delete from public.application_refinement_requests r where r.user_id=actor and r.application_id=p_application_id
        and (r.request_json->>'scope'=any(r.cleared_scopes) or r.cleared_scopes=array['cv','letter'])
        and not exists(select 1 from public.application_refinement_reviews v where v.user_id=actor and v.application_id=p_application_id and v.request_id=r.id)
        and not exists(select 1 from public.application_refinement_proposals p
          join public.application_refinement_requests child on child.user_id=actor and child.application_id=p_application_id
            and child.request_json->>'parentProposalId'=p.id::text
          where p.user_id=actor and p.application_id=p_application_id and p.request_id=r.id);
      get diagnostics removed=row_count;
      exit when removed=0;
    end loop;
  end if;
  -- A current request for the other document remains current. The deferred FK
  -- permits clearing a selected pointer and its request within this transaction.
  update public.application_refinement_state s set current_request_id=case when exists (
      select 1 from public.application_refinement_requests r where r.user_id=actor and r.application_id=p_application_id and r.id=s.current_request_id
        and not (r.request_json->>'scope'=any(r.cleared_scopes) or r.cleared_scopes=array['cv','letter'])
    ) then s.current_request_id else null end, revision=s.revision+1
    where s.user_id=actor and s.application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

create function public.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,p_scope);
$$;
alter function private.clear_refinement_history(uuid,integer,text) owner to postgres;
alter function public.clear_refinement_history(uuid,integer,text) owner to postgres;
revoke all on function private.clear_refinement_history(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.clear_refinement_history(uuid,integer,text) to authenticated,postgres;
revoke all on function public.clear_refinement_history(uuid,integer,text) from public,anon,service_role;
grant execute on function public.clear_refinement_history(uuid,integer,text) to authenticated;

-- Retain the explicit legacy all-history entry point for previously shipped clients.
create or replace function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,'both');
$$;

-- Retained shared feedback is omitted only for its cleared document facet.
create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; privacy_input jsonb; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure'] || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('both','cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}');
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  -- CV fields and structure already contain the user's final privacy wording.
  -- Keep identity checks on the remaining template, letter, feedback and context inputs.
  privacy_input := (value-array['cv','cvStructure']) || jsonb_build_object('cv',(value->'cv')-'fields');
  if privacy_input is distinct from public.job_drafting_redact_samples(privacy_input) then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope' in ('both','cv') and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope' in ('both','letter') and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId') then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback'
    and (value->>'scope'='both' or not ((value->>'scope')=any(r.cleared_scopes))) order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    cv.content_json);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

-- Independent document refinement rounds (additive upgrade).
-- Separate active CV and letter rounds. Apply once, in a transaction, before the new client.
-- Existing requests/proposals/reviews remain immutable, including legacy combined history.
alter table public.application_refinement_state
  add column current_cv_request_id uuid,
  add column current_letter_request_id uuid,
  add constraint refinement_current_cv_request_fk foreign key (user_id,application_id,current_cv_request_id)
    references public.application_refinement_requests(user_id,application_id,id) on delete no action deferrable initially deferred,
  add constraint refinement_current_letter_request_fk foreign key (user_id,application_id,current_letter_request_id)
    references public.application_refinement_requests(user_id,application_id,id) on delete no action deferrable initially deferred;
create index refinement_state_cv_request_idx on public.application_refinement_state(user_id,application_id,current_cv_request_id);
create index refinement_state_letter_request_idx on public.application_refinement_state(user_id,application_id,current_letter_request_id);

-- Do not resurrect superseded requests. Preserve timestamps, revisions and all source records.
alter table public.application_refinement_state disable trigger refinement_state_capture;
update public.application_refinement_state s set
  current_cv_request_id=case when r.request_json->>'scope'='cv' and not ('cv'=any(r.cleared_scopes)) then r.id end,
  current_letter_request_id=case when r.request_json->>'scope'='letter' and not ('letter'=any(r.cleared_scopes)) then r.id end
from public.application_refinement_requests r where r.id=s.current_request_id and r.user_id=s.user_id and r.application_id=s.application_id;
update public.application_refinement_state set current_request_id=null where current_request_id is not null;
-- Validate deferred pointer checks before changing trigger state in this transaction.
set constraints refinement_current_cv_request_fk, refinement_current_letter_request_fk immediate;
alter table public.application_refinement_state enable trigger refinement_state_capture;
set constraints refinement_current_cv_request_fk, refinement_current_letter_request_fk deferred;
comment on column public.application_refinement_state.current_request_id is 'Retired global pointer. Always null; use document-specific pointers.';


create or replace function public.refinement_capture_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  perform public.refinement_validate_setup(new.setup_json);
  if jsonb_typeof(new.approvals_json) is distinct from 'object' or not(new.approvals_json ?& array['cv','letter'])
    or new.approvals_json-array['cv','letter'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(new.approvals_json) e where jsonb_typeof(e.value) not in ('string','null') or (jsonb_typeof(e.value)='string' and e.value#>>'{}' !~ '^v1:[a-f0-9]{64}$')) then
    raise exception 'Invalid document approvals.' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if new.application_id<>old.application_id or new.user_id<>old.user_id then raise exception 'Refinement ownership cannot change.' using errcode='23514'; end if;
    if new.revision<>old.revision+1 then raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001'; end if;
    if pg_trigger_depth()=1 and exists(select 1 from jsonb_each(new.approvals_json) e where e.value<>'null'::jsonb and e.value is distinct from old.approvals_json->e.key) then
      raise exception 'Approve documents through a recorded review.' using errcode='23514';
    end if;
    if new.current_request_id is not null or (pg_trigger_depth()=1 and (
      new.current_cv_request_id is not null and new.current_cv_request_id is distinct from old.current_cv_request_id
      or new.current_letter_request_id is not null and new.current_letter_request_id is distinct from old.current_letter_request_id)) then
      raise exception 'Publish a document request to advance its refinement round.' using errcode='23514';
    end if;
    if new.setup_json<>old.setup_json then
      new.current_letter_request_id:=null;
      new.approvals_json:=jsonb_set(new.approvals_json,'{letter}','null');
    end if;
  else
    if new.approvals_json<>'{"cv":null,"letter":null}'::jsonb then raise exception 'Approve documents through a recorded review.' using errcode='23514'; end if;
    new.revision:=1;
    new.current_request_id:=null; new.current_cv_request_id:=null; new.current_letter_request_id:=null;
  end if;
  if new.current_cv_request_id is not null and not exists(select 1 from public.application_refinement_requests r
      where r.id=new.current_cv_request_id and r.user_id=new.user_id and r.application_id=new.application_id and r.request_json->>'scope'='cv')
    or new.current_letter_request_id is not null and not exists(select 1 from public.application_refinement_requests r
      where r.id=new.current_letter_request_id and r.user_id=new.user_id and r.application_id=new.application_id and r.request_json->>'scope'='letter') then
    raise exception 'The current request must belong to its document.' using errcode='23514';
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_activate_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.application_refinement_state set current_cv_request_id=case when new.request_json->>'scope'='cv' then new.id else current_cv_request_id end,
    current_letter_request_id=case when new.request_json->>'scope'='letter' then new.id else current_letter_request_id end, revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
  return new;
end;
$$;

create or replace function public.refinement_capture_request()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  app public.applications; cv public.cv_variants; state public.application_refinement_state;
  value jsonb:=new.request_json; privacy_input jsonb; feedback jsonb; review record; item jsonb; idx integer:=0;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'A signed-in owner is required.' using errcode='42501';
  end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','applicationId','cv','letter','scope','feedback','parentProposalId','cvStructure'] || case when value?'privacyLegend' then array['privacyLegend'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb or value->>'requestId' is distinct from new.id::text
    or value->>'applicationId' is distinct from new.application_id::text
    or coalesce(value->>'scope','') not in ('cv','letter')
    or jsonb_typeof(value->'feedback') is distinct from 'array'
    or jsonb_typeof(value->'letter') is distinct from 'object'
    or not((value->'letter')?'text') or jsonb_typeof(value#>'{letter,text}') is distinct from 'string'
    or char_length(value#>>'{letter,text}')>50000 or translate(value#>>'{letter,text}',E'\t\n\r','')~'[[:cntrl:]]'
    or jsonb_typeof(value->'parentProposalId') not in ('string','null') then
    raise exception 'Invalid refinement request.' using errcode='22023';
  end if;
  perform public.cv_adjustment_validate_request(value->'cv',new.id);
  perform public.refinement_validate_cv_structure(value->'cvStructure',value#>'{cv,fields}');
  if value?'privacyLegend' then perform public.refinement_validate_privacy_legend(value->'privacyLegend',value#>'{cv,fields}'); end if;
  perform public.refinement_validate_setup((value->'letter')-'text');
  -- CV fields and structure already contain the user's final privacy wording.
  -- Keep identity checks on the remaining template, letter, feedback and context inputs.
  privacy_input := (value-array['cv','cvStructure']) || jsonb_build_object('cv',(value->'cv')-'fields');
  if privacy_input is distinct from public.job_drafting_redact_samples(privacy_input) then
    raise exception 'Filter private refinement content before publishing.' using errcode='22023';
  end if;
  select * into app from public.applications where user_id=new.user_id and id=new.application_id for share;
  if not found then raise exception 'Application unavailable.' using errcode='42501'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Save preparation before requesting refinement.' using errcode='22023'; end if;
  if value->>'scope'='letter' and state.setup_json is distinct from (value->'letter')-'text' then raise exception 'Letter setup changed; save preparation and create a new request.' using errcode='40001'; end if;
  if (value->>'scope'='cv' and state.approvals_json->'cv'<>'null'::jsonb)
    or (value->>'scope'='letter' and state.approvals_json->'letter'<>'null'::jsonb) then
    raise exception 'Reopen an approved document before requesting changes.' using errcode='22023';
  end if;
  if value->>'parentProposalId' is not null and not exists(select 1 from public.application_refinement_proposals p where p.user_id=new.user_id and p.application_id=new.application_id and p.id::text=value->>'parentProposalId'
    and exists(select 1 from public.application_refinement_requests parent where parent.id=p.request_id and parent.user_id=new.user_id
      and parent.application_id=new.application_id and parent.request_json->>'scope'=value->>'scope' and not ((value->>'scope')=any(parent.cleared_scopes)))) then
    raise exception 'Parent proposal unavailable.' using errcode='22023';
  end if;
  feedback:=value->'feedback';
  for review in select * from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id and r.kind='feedback'
    and r.payload->>'scope'=value->>'scope' and not ((value->>'scope')=any(r.cleared_scopes))
    and (r.request_id is null or exists(select 1 from public.application_refinement_requests source where source.id=r.request_id and source.request_json->>'scope'=value->>'scope')) order by r.created_at,r.id loop
    item:=feedback->idx;
    if item is null or jsonb_typeof(item) is distinct from 'object' or item-array['id','text','scope','createdAt','annotation']<>'{}'::jsonb
      or not(item ?& array['id','text','scope','createdAt']) or item->>'id' is distinct from review.id::text
      or item->'annotation' is distinct from review.payload->'annotation'
      or (item ? 'annotation') is distinct from (review.payload ? 'annotation')
      or item->'text' is distinct from review.payload->'text' or item->'scope' is distinct from review.payload->'scope'
      or jsonb_typeof(item->'createdAt') is distinct from 'string'
      or (item->>'createdAt')::timestamptz is distinct from review.created_at then
      raise exception 'Feedback history changed; reload all saved feedback before publishing.' using errcode='40001';
    end if;
    idx:=idx+1;
  end loop;
  if jsonb_array_length(feedback)<>idx then raise exception 'Feedback history must contain every saved reply exactly once.' using errcode='40001'; end if;
  select * into cv from public.cv_variants where user_id=new.user_id and id=app.cv_variant_id;
  if not found then raise exception 'Assign a privacy-filtered CV before requesting refinement.' using errcode='22023'; end if;
  new.opportunity_snapshot:=app.context_json;
  new.cv_snapshot:=jsonb_build_object('snapshotId',cv.id,'revision',cv.revision,'content',
    cv.content_json);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.publish_refinement_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request_id uuid; application_id uuid; result public.application_refinement_requests;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Sign in before publishing refinement.' using errcode='42501'; end if;
  if coalesce(p_request->>'scope','') not in ('cv','letter') then raise exception 'Publish a separate CV or letter request.' using errcode='22023'; end if;
  begin request_id:=(p_request->>'requestId')::uuid; application_id:=(p_request->>'applicationId')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid refinement identifiers.' using errcode='22023'; end;
  if request_id is null or application_id is null then raise exception 'Refinement identifiers are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||application_id::text,0));
  select * into result from public.application_refinement_requests r where r.user_id=actor and r.id=request_id;
  if found then
    if result.request_json=p_request then return to_jsonb(result); end if;
    raise exception 'Request ID already exists with different input.' using errcode='23505';
  end if;
  insert into public.application_refinement_requests(id,application_id,user_id,request_json,opportunity_snapshot,cv_snapshot)
    values(request_id,application_id,actor,p_request,'{}','{}') returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.refinement_capture_review()
returns trigger language plpgsql security invoker set search_path='' as $$
declare state public.application_refinement_state; target text; proposal jsonb; annotation jsonb; reference jsonb; previous public.application_refinement_reviews; has_previous boolean; request_scope text; current_id uuid;
begin
  if auth.uid() is null or auth.uid()<>new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required.' using errcode='42501'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object' or octet_length(new.payload::text)>100000 then raise exception 'Invalid review payload.' using errcode='22023'; end if;
  select * into state from public.application_refinement_state where user_id=new.user_id and application_id=new.application_id for update;
  if not found then raise exception 'Application refinement unavailable.' using errcode='42501'; end if;
  if new.request_id is not null and not exists(select 1 from public.application_refinement_requests r where r.user_id=new.user_id and r.application_id=new.application_id and r.id=new.request_id) then raise exception 'Review request unavailable.' using errcode='42501'; end if;
  if new.request_id is not null then
    select r.request_json->>'scope' into request_scope from public.application_refinement_requests r where r.id=new.request_id and r.user_id=new.user_id and r.application_id=new.application_id;
    if request_scope not in ('cv','letter') then raise exception 'Combined rounds are read-only history. Publish a separate request.' using errcode='22023'; end if;
    current_id:=case when request_scope='cv' then state.current_cv_request_id else state.current_letter_request_id end;
  end if;
  if new.kind='annotation' or (new.kind='feedback' and new.payload ? 'annotation') then
    reference:=case when new.kind='annotation' then jsonb_build_object('proposalId',new.payload->'proposalId','annotationId',new.payload->'annotationId','reviewId',new.payload->'previousReviewId') else new.payload->'annotation' end;
    if not public.refinement_exact_keys(reference,array['proposalId','annotationId','reviewId'])
      or jsonb_typeof(reference->'proposalId') is distinct from 'string' or coalesce(reference->>'proposalId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or jsonb_typeof(reference->'annotationId') is distinct from 'string' or coalesce(reference->>'annotationId','') !~ '^annotation-[1-9][0-9]*$'
      or (reference->'reviewId'<>'null'::jsonb and (jsonb_typeof(reference->'reviewId') is distinct from 'string' or coalesce(reference->>'reviewId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) then
      raise exception 'Invalid annotation reference.' using errcode='22023';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p where p.user_id=new.user_id
      and p.application_id=new.application_id and p.request_id=new.request_id and p.id::text=lower(reference->>'proposalId');
    if not found then raise exception 'Annotation proposal unavailable.' using errcode='42501'; end if;
    select a into annotation from jsonb_array_elements(coalesce(proposal->'annotations','[]'::jsonb)) as x(a) where a->>'id'=reference->>'annotationId';
    if not found or annotation->>'document' is distinct from request_scope then raise exception 'Annotation unavailable for this document.' using errcode='22023'; end if;
    select * into previous from public.application_refinement_reviews r where r.user_id=new.user_id and r.application_id=new.application_id
      and r.kind='annotation' and r.payload->>'proposalId'=reference->>'proposalId' and r.payload->>'annotationId'=reference->>'annotationId'
      order by r.created_at desc,r.id desc limit 1;
    has_previous:=found;
    if (has_previous and lower(reference->>'reviewId') is distinct from previous.id::text) or (not has_previous and reference->'reviewId'<>'null'::jsonb) then
      raise exception 'Annotation changed elsewhere; reload the saved annotation. Your documents are unchanged.' using errcode='40001';
    end if;
    if new.kind='feedback' and (new.payload->>'scope' is distinct from annotation->>'document'
      or (has_previous and previous.payload->>'status'<>'open' and previous.payload->'response'='null'::jsonb)) then
      raise exception 'Only open or answered annotations can be included in their document feedback.' using errcode='22023';
    end if;
  end if;
  if new.kind='annotation' then
    if not public.refinement_exact_keys(new.payload,array['proposalId','annotationId','status','response','previousReviewId'])
      or coalesce(new.payload->>'status','') not in ('open','resolved','ignored')
      or (new.payload->'response'<>'null'::jsonb and (jsonb_typeof(new.payload->'response') is distinct from 'string' or btrim(new.payload->>'response')='' or public.refinement_utf16_length(new.payload->>'response')>12000))
      or translate(coalesce(new.payload->>'response',''),E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized annotation review.' using errcode='22023';
    end if;
  elsif new.kind='feedback' then
    if new.payload-array['text','scope','annotation']<>'{}'::jsonb or not(new.payload ?& array['text','scope'])
      or jsonb_typeof(new.payload->'text') is distinct from 'string' or char_length(btrim(new.payload->>'text')) not between 1 and 20000
      or coalesce(new.payload->>'scope','') not in ('cv','letter')
      or (new.request_id is not null and new.payload->>'scope' is distinct from request_scope)
      or translate(new.payload->>'text',E'\t\n\r','')~'[[:cntrl:]]'
      or new.payload is distinct from public.job_drafting_redact_samples(new.payload) then
      raise exception 'Invalid or unanonymized feedback.' using errcode='22023';
    end if;
  elsif new.kind='cv_decisions' then
    if new.request_id is null or new.request_id is distinct from current_id then
      raise exception 'This request is stale; review the current documents.' using errcode='40001';
    end if;
    select p.proposal_json into proposal from public.application_refinement_proposals p
      where p.user_id=new.user_id and p.application_id=new.application_id and p.request_id=new.request_id
        and p.id::text=new.payload->>'proposalId';
    if not found then raise exception 'CV decision proposal unavailable.' using errcode='42501'; end if;
    perform public.refinement_validate_cv_decisions(new.payload,proposal);
    if (request_scope='cv' and jsonb_array_length(new.payload->'accepted')>0 or request_scope='letter') and state.approvals_json->request_scope<>'null'::jsonb then
      raise exception 'Reopen the approved CV before accepting changes.' using errcode='22023';
    end if;
  elsif new.kind in ('approve_cv','approve_letter','reopen_cv','reopen_letter') then
    if jsonb_typeof(new.payload->'expectedRevision') is distinct from 'number' or coalesce(new.payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,8}$'
      or (new.payload->>'expectedRevision')::integer<>state.revision then raise exception 'Refinement changed elsewhere; reload before reviewing.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.request_id is not null and (request_scope is distinct from target or new.request_id is distinct from current_id) then raise exception 'This request is stale; review the current documents.' using errcode='40001'; end if;
    target:=case when new.kind in ('approve_cv','reopen_cv') then 'cv' else 'letter' end;
    if new.kind like 'approve_%' then
      if new.payload-array['revision','expectedRevision']<>'{}'::jsonb or jsonb_typeof(new.payload->'revision') is distinct from 'string' or new.payload->>'revision' !~ '^v1:[a-f0-9]{64}$' then raise exception 'Invalid approved revision.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],new.payload->'revision'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    else
      if new.payload-array['expectedRevision']<>'{}'::jsonb then raise exception 'Invalid reopen payload.' using errcode='22023'; end if;
      update public.application_refinement_state set approvals_json=jsonb_set(approvals_json,array[target],'null'),revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
    end if;
  else raise exception 'Invalid review kind.' using errcode='22023'; end if;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.refinement_capture_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.application_refinement_requests; value jsonb:=new.proposal_json;
begin
  -- Management MCP runs as postgres. Never manufacture an app-user JWT for this path.
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into request from public.application_refinement_requests where id=new.request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  if request.request_json->>'scope' not in ('cv','letter') then raise exception 'Combined rounds are read-only history. Publish a separate request.' using errcode='22023'; end if;
  perform 1 from public.application_refinement_state s where s.user_id=request.user_id and s.application_id=request.application_id
    and new.request_id=case when request.request_json->>'scope'='cv' then s.current_cv_request_id else s.current_letter_request_id end for share;
  if not found or (request.request_json->>'scope')=any(request.cleared_scopes) then raise exception 'This document request is stale. Copy a fresh task.' using errcode='40001'; end if;
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>2097152
    or not public.refinement_exact_keys(value,array['schemaVersion','requestId','summary','cvOperations','cvComments','letterText'] || case when value ? 'annotations' then array['annotations'] else array[]::text[] end)
    or value->'schemaVersion' is distinct from '2'::jsonb
    or value->'schemaVersion' is distinct from request.request_json->'schemaVersion' or value->>'requestId' is distinct from request.id::text
    or jsonb_typeof(value->'summary') is distinct from 'string' or char_length(btrim(value->>'summary')) not between 1 and 8000
    or jsonb_typeof(value->'letterText') is distinct from 'string' or char_length(value->>'letterText')>50000
    or (request.request_json->>'scope'<>'cv' and btrim(value->>'letterText')='')
    or value->>'letterText' ~* '\{\{PRIVATE_|!\[|</?[a-z]'
    or translate((value->>'summary')||(value->>'letterText'),E'\t\n\r','')~'[[:cntrl:]]'
    or value is distinct from public.job_drafting_redact_samples(value) then
    raise exception 'Invalid or unanonymized refinement proposal.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(value->'annotations')='array' then value->'annotations' else '[]'::jsonb end) a where a->>'document' is distinct from request.request_json->>'scope') then raise exception 'Questions must belong to the requested document.' using errcode='22023'; end if;
  if request.request_json->>'scope'='letter' and value->'cvComments'<>'[]'::jsonb then raise exception 'Letter requests cannot include CV comments.' using errcode='22023'; end if;
  if value ? 'annotations' then perform public.refinement_validate_annotations(value->'annotations',request.request_json#>'{cv,fields}',value->>'letterText'); end if;
  perform public.refinement_validate_cv_operations(value,request.request_json,new.request_id);
  if request.request_json->>'scope'='letter' and value->'cvOperations'<>'[]'::jsonb then raise exception 'A letter-only request cannot change the CV.' using errcode='22023'; end if;
  if request.request_json->>'scope'='cv' and value->'letterText' is distinct from request.request_json#>'{letter,text}' then raise exception 'A CV-only request must preserve the letter exactly.' using errcode='22023'; end if;
  new.user_id:=request.user_id;
  new.application_id:=request.application_id;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;

create or replace function public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); source public.application_refinement_requests;
  saved public.application_refinement_protocols;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before publishing a refinement protocol.' using errcode='42501';
  end if;
  if p_request_id is null or p_protocol_id is null or p_protocol_id !~ '^v1:[0-9a-f]{64}$'
    or p_protocol_text is null or char_length(p_protocol_text) not between 1 and 100000 then
    raise exception 'Invalid refinement protocol document.' using errcode='22023';
  end if;
  select * into source from public.application_refinement_requests where id=p_request_id and user_id=actor;
  if not found then raise exception 'Published request not found for this account.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||source.application_id::text,0));
  if not exists (select 1 from public.application_refinement_state where user_id=actor
    and application_id=source.application_id and source.request_json->>'scope' in ('cv','letter')
    and case when source.request_json->>'scope'='cv' then current_cv_request_id else current_letter_request_id end=p_request_id) then
    raise exception 'The current refinement request changed. Copy the task again.' using errcode='40001';
  end if;
  insert into public.application_refinement_protocols(request_id,protocol_id,application_id,user_id,protocol_text)
    values(p_request_id,p_protocol_id,source.application_id,actor,p_protocol_text)
    on conflict (request_id,protocol_id) do nothing;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if saved.protocol_text is distinct from p_protocol_text then
    raise exception 'This protocol identifier already belongs to different instructions.' using errcode='22023';
  end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.resolve_application_reference(p_reference text,p_scope text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before resolving an application.' using errcode='42501';
  end if;
  if p_scope is null or p_scope not in ('cv','letter') then raise exception 'Choose CV or letter and copy a fresh task.' using errcode='22023'; end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'scope',p_scope,'current_request_id',case when p_scope='cv' then s.current_cv_request_id else s.current_letter_request_id end)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.user_id=actor and (a.application_code=reference or a.id=resolved_id);
  if result is null then raise exception 'Application unavailable.' using errcode='42501'; end if;
  return result;
end;
$$;

create or replace function public.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  raise exception 'Document scope is required. Copy a fresh CV or letter task from the application.' using errcode='22023';
end;
$$;
revoke all on function public.resolve_application_reference(text,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_application_reference(text,text) to authenticated;

create or replace function private.resolve_application_reference(p_reference text,p_scope text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare reference text:=upper(btrim(p_reference)); resolved_id uuid; result jsonb;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  if p_scope is null or p_scope not in ('cv','letter') then raise exception 'Choose CV or letter and copy a fresh task.' using errcode='22023'; end if;
  if reference is null or reference !~ '^APP-[A-F0-9]{10}$|^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$' then
    raise exception 'Provide a complete application code or UUID.' using errcode='22023';
  end if;
  if reference not like 'APP-%' then resolved_id:=reference::uuid; end if;
  select jsonb_build_object('application_id',a.id,'application_code',a.application_code,'scope',p_scope,'current_request_id',case when p_scope='cv' then s.current_cv_request_id else s.current_letter_request_id end)
    into result from public.applications a left join public.application_refinement_state s
      on s.application_id=a.id and s.user_id=a.user_id
    where a.application_code=reference or a.id=resolved_id;
  if result is null then raise exception 'Application unavailable.' using errcode='22023'; end if;
  return result;
end;
$$;

create or replace function private.resolve_application_reference(p_reference text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  raise exception 'Document scope is required. Copy a fresh CV or letter task from the application.' using errcode='22023';
end;
$$;
revoke all on function private.resolve_application_reference(text,text) from public,anon,authenticated,service_role;
grant execute on function private.resolve_application_reference(text,text) to postgres;

create or replace function private.clear_refinement_history(p_application_id uuid,p_expected_revision integer,p_scope text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); result public.application_refinement_state;
  previous_scope text:=current_setting('cv_builder.clearing_refinement_history',true);
  removed integer;
begin
  if current_user<>'postgres' or actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before clearing refinement history.' using errcode='42501';
  end if;
  if p_application_id is null or p_expected_revision is null or p_expected_revision<0
    or p_scope is null or p_scope not in ('cv','letter','both') then
    raise exception 'An application, refinement scope and current revision are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_application_id::text,0));
  if not exists(select 1 from public.applications where user_id=actor and id=p_application_id) then
    raise exception 'Application unavailable.' using errcode='42501';
  end if;
  select * into result from public.application_refinement_state
    where user_id=actor and application_id=p_application_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Preparation is not saved; reload and retry.' using errcode='40001'; end if;
    return 'null'::jsonb;
  end if;
  if result.revision<>p_expected_revision then
    raise exception 'Refinement changed elsewhere; reload and retry.' using errcode='40001';
  end if;
  perform set_config('cv_builder.clearing_refinement_history',actor::text||':'||p_application_id::text,true);
  if p_scope='both' then
    delete from public.application_refinement_reviews where user_id=actor and application_id=p_application_id;
    delete from public.application_refinement_requests where user_id=actor and application_id=p_application_id;
  else
    update public.application_refinement_requests
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and request_json->>'scope' in ('both',p_scope)
        and not (p_scope=any(cleared_scopes));
    update public.application_refinement_reviews
      set cleared_scopes=case when cleared_scopes='{}'::text[] then array[p_scope] else array['cv','letter'] end
      where user_id=actor and application_id=p_application_id and kind='feedback' and payload->>'scope'='both'
        and not (p_scope=any(cleared_scopes));
    delete from public.application_refinement_reviews r where r.user_id=actor and r.application_id=p_application_id and (
      r.cleared_scopes=array['cv','letter']
      or r.kind in ('approve_'||p_scope,'reopen_'||p_scope)
      or (r.kind='cv_decisions' and exists(select 1 from public.application_refinement_requests source where source.id=r.request_id
        and (source.request_json->>'scope'=p_scope or source.request_json->>'scope'='both' and p_scope='cv')))
      or (r.kind='feedback' and r.payload->>'scope'=p_scope)
      or (r.kind='annotation' and exists (
        select 1 from public.application_refinement_proposals p,
          lateral jsonb_array_elements(coalesce(p.proposal_json->'annotations','[]'::jsonb)) a
        where p.user_id=actor and p.application_id=p_application_id and p.id::text=r.payload->>'proposalId'
          and a->>'id'=r.payload->>'annotationId' and a->>'document'=p_scope
      ))
    );
    -- Older clients linked reviews for either document to the global current
    -- request. Keep that immutable source while the other document needs it,
    -- along with ancestors referenced by surviving iteration lineage.
    loop
      delete from public.application_refinement_requests r where r.user_id=actor and r.application_id=p_application_id
        and (r.request_json->>'scope'=any(r.cleared_scopes) or r.cleared_scopes=array['cv','letter'])
        and not exists(select 1 from public.application_refinement_reviews v where v.user_id=actor and v.application_id=p_application_id and v.request_id=r.id)
        and not exists(select 1 from public.application_refinement_proposals p
          join public.application_refinement_requests child on child.user_id=actor and child.application_id=p_application_id
            and child.request_json->>'parentProposalId'=p.id::text
          where p.user_id=actor and p.application_id=p_application_id and p.request_id=r.id);
      get diagnostics removed=row_count;
      exit when removed=0;
    end loop;
  end if;
  -- A current request for the other document remains current. The deferred FK
  -- permits clearing a selected pointer and its request within this transaction.
  update public.application_refinement_state s set current_request_id=null,
    current_cv_request_id=case when p_scope in ('cv','both') then null else s.current_cv_request_id end,
    current_letter_request_id=case when p_scope in ('letter','both') then null else s.current_letter_request_id end,
    revision=s.revision+1
    where s.user_id=actor and s.application_id=p_application_id returning * into result;
  perform set_config('cv_builder.clearing_refinement_history',coalesce(previous_scope,''),true);
  return to_jsonb(result);
end;
$$;

comment on table public.application_refinement_state is 'Independent current CV/letter requests, letter settings and approval hashes. Full private sources remain local.';
notify pgrst, 'reload schema';

-- Verified source acquisition for self-contained refinement tasks.
-- Deploy before the self-contained, two-call refinement client. No history is rewritten.
create function private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then
    raise exception 'The postgres management connection is required.' using errcode='42501';
  end if;
  if p_application_id is null or p_request_id is null or p_scope is null or p_scope not in ('cv','letter') then
    raise exception 'An exact application, request and CV or letter scope are required.' using errcode='22023';
  end if;
  -- One statement snapshot verifies ownership relationships and the document pointer.
  -- Proposal publication checks freshness again if a new round starts after this read.
  select r.* into result from public.application_refinement_requests r
    join public.applications a on a.id=r.application_id and a.user_id=r.user_id
    join public.application_refinement_state s on s.application_id=a.id and s.user_id=a.user_id
    where r.application_id=p_application_id and r.id=p_request_id
      and r.request_json->>'scope'=p_scope and not (p_scope=any(r.cleared_scopes))
      and r.id=case when p_scope='cv' then s.current_cv_request_id else s.current_letter_request_id end;
  if not found then
    raise exception 'The published request is unavailable or no longer current for this document. Copy a fresh task.' using errcode='40001';
  end if;
  return to_jsonb(result);
end;
$$;
revoke all on function private.read_current_refinement_request(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.read_current_refinement_request(uuid,uuid,text) to postgres;
comment on function private.read_current_refinement_request(uuid,uuid,text) is
  'Read-only exact current document snapshot, including the unchanged request and captured CV/opportunity context. Management connection only.';
notify pgrst, 'reload schema';
