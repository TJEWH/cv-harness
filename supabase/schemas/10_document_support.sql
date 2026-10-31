-- Current desired schema: 10_document_support.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.clear_refinement_history(uuid, integer)
CREATE FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,'both');
$$;

-- private.clear_refinement_history(uuid, integer, text)
CREATE FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

-- private.prevent_refinement_protocol_update()
CREATE FUNCTION private.prevent_refinement_protocol_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'Published refinement protocols are immutable.' using errcode='42501';
end;
$$;

-- private.read_current_refinement_request(uuid, uuid, text)
CREATE FUNCTION private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
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

-- private.read_refinement_protocol(uuid, text)
CREATE FUNCTION private.read_refinement_protocol(p_request_id uuid, p_protocol_id text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare saved public.application_refinement_protocols;
begin
  if current_user<>'postgres' then raise exception 'Use the authorized management connection.' using errcode='42501'; end if;
  select * into saved from public.application_refinement_protocols where request_id=p_request_id and protocol_id=p_protocol_id;
  if not found then raise exception 'Refinement protocol not found. Copy the task again in the app.' using errcode='P0002'; end if;
  return to_jsonb(saved);
end;
$$;

-- private.read_refinement_request(uuid)
CREATE FUNCTION private.read_refinement_request(request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare result public.application_refinement_requests;
begin
  if current_user<>'postgres' then raise exception 'The postgres management connection is required.' using errcode='42501'; end if;
  select * into result from public.application_refinement_requests where id=request_id;
  if not found then raise exception 'Refinement request unavailable.' using errcode='22023'; end if;
  return to_jsonb(result);
end;
$$;

-- private.resolve_application_reference(text)
CREATE FUNCTION private.resolve_application_reference(p_reference text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  raise exception 'Document scope is required. Copy a fresh CV or letter task from the application.' using errcode='22023';
end;
$$;

-- private.resolve_application_reference(text, text)
CREATE FUNCTION private.resolve_application_reference(p_reference text, p_scope text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- private.save_refinement_proposal(uuid, uuid, jsonb)
CREATE FUNCTION private.save_refinement_proposal(request_id uuid, proposal_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.assign_job_application_cv(uuid, uuid, text, jsonb, jsonb, integer, jsonb)
CREATE FUNCTION public.assign_job_application_cv(p_application_id uuid, p_cv_variant_id uuid, p_cv_name text, p_content_json jsonb, p_config_json jsonb, p_cv_version integer DEFAULT 7, p_changes jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.clear_refinement_history(uuid, integer)
CREATE FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.clear_refinement_history(p_application_id,p_expected_revision);
$$;

-- public.clear_refinement_history(uuid, integer, text)
CREATE FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.clear_refinement_history(p_application_id,p_expected_revision,p_scope);
$$;

-- public.create_job_application(uuid, uuid)
CREATE FUNCTION public.create_job_application(p_application_id uuid, p_opportunity_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.cv_adjustment_validate_request(jsonb, uuid)
CREATE FUNCTION public.cv_adjustment_validate_request(value jsonb, expected_id uuid) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.cv_adjustment_validate_response(jsonb, jsonb, uuid)
CREATE FUNCTION public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.delete_local_attachment_metadata(uuid)
CREATE FUNCTION public.delete_local_attachment_metadata(p_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Sign in before removing attachment descriptions.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'An attachment reference is required.' using errcode='22023'; end if;
  delete from public.local_attachment_metadata where id=p_id and user_id=auth.uid();
end;
$$;

-- public.job_drafting_redact_samples(jsonb)
CREATE FUNCTION public.job_drafting_redact_samples(value jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

-- public.job_workspace_assign_application_code()
CREATE FUNCTION public.job_workspace_assign_application_code() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.job_workspace_capture_application_context()
CREATE FUNCTION public.job_workspace_capture_application_context() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.job_workspace_guard_cv_snapshot()
CREATE FUNCTION public.job_workspace_guard_cv_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.publish_refinement_protocol(uuid, text, text)
CREATE FUNCTION public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.publish_refinement_request(jsonb)
CREATE FUNCTION public.publish_refinement_request(p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.refinement_activate_request()
CREATE FUNCTION public.refinement_activate_request() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.application_refinement_state set current_cv_request_id=case when new.request_json->>'scope'='cv' then new.id else current_cv_request_id end,
    current_letter_request_id=case when new.request_json->>'scope'='letter' then new.id else current_letter_request_id end, revision=revision+1 where application_id=new.application_id and user_id=new.user_id;
  return new;
end;
$$;

-- public.refinement_capture_proposal()
CREATE FUNCTION public.refinement_capture_proposal() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.refinement_capture_request()
CREATE FUNCTION public.refinement_capture_request() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.refinement_capture_review()
CREATE FUNCTION public.refinement_capture_review() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_capture_state()
CREATE FUNCTION public.refinement_capture_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_close_spelling(text, text, integer)
CREATE FUNCTION public.refinement_close_spelling(before_word text, after_word text, budget integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
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

-- public.refinement_exact_keys(jsonb, text[])
CREATE FUNCTION public.refinement_exact_keys(value jsonb, keys text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_typeof(value)='object' and value-keys='{}'::jsonb and value ?& keys,false);
$$;

-- public.refinement_guard_immutable()
CREATE FUNCTION public.refinement_guard_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.refinement_guard_initial_history_scope()
CREATE FUNCTION public.refinement_guard_initial_history_scope() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.cleared_scopes<>'{}'::text[] then raise exception 'New refinement history cannot already be cleared.' using errcode='23514'; end if;
  return new;
end;
$$;

-- public.refinement_reference_permutation(jsonb, jsonb)
CREATE FUNCTION public.refinement_reference_permutation(value jsonb, expected jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
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

-- public.refinement_utf16_length(text)
CREATE FUNCTION public.refinement_utf16_length(value text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
  select coalesce(sum(case when ascii(character)>65535 then 2 else 1 end),0)::integer
    from string_to_table(value,null) as characters(character);
$$;

-- public.refinement_validate_annotations(jsonb, jsonb, text)
CREATE FUNCTION public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_cv_decisions(jsonb, jsonb)
CREATE FUNCTION public.refinement_validate_cv_decisions(value jsonb, proposal jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_cv_operations(jsonb, jsonb, uuid)
CREATE FUNCTION public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_cv_structure(jsonb, jsonb)
CREATE FUNCTION public.refinement_validate_cv_structure(value jsonb, fields jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_privacy_legend(jsonb, jsonb)
CREATE FUNCTION public.refinement_validate_privacy_legend(value jsonb, fields jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_setup(jsonb)
CREATE FUNCTION public.refinement_validate_setup(value jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refinement_validate_typo_fix(text, text, uuid)
CREATE FUNCTION public.refinement_validate_typo_fix(original text, replacement text, expected_id uuid) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.refresh_job_application_context(uuid)
CREATE FUNCTION public.refresh_job_application_context(p_application_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.remove_job_application(uuid)
CREATE FUNCTION public.remove_job_application(p_application_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.resolve_application_reference(text)
CREATE FUNCTION public.resolve_application_reference(p_reference text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  raise exception 'Document scope is required. Copy a fresh CV or letter task from the application.' using errcode='22023';
end;
$$;

-- public.resolve_application_reference(text, text)
CREATE FUNCTION public.resolve_application_reference(p_reference text, p_scope text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
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
$_$;

-- public.save_local_attachment_metadata(uuid, text, text)
CREATE FUNCTION public.save_local_attachment_metadata(p_id uuid, p_name text, p_description text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.save_refinement_review(uuid, uuid, text, jsonb, uuid)
CREATE FUNCTION public.save_refinement_review(p_application_id uuid, p_request_id uuid, p_kind text, p_payload jsonb, p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.save_refinement_state(uuid, jsonb, jsonb, integer)
CREATE FUNCTION public.save_refinement_state(p_application_id uuid, p_setup jsonb, p_approvals jsonb, p_expected_revision integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.set_job_application_checklist_item(uuid, text, boolean)
CREATE FUNCTION public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
