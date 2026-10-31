-- Current desired schema: 11_opportunity_support.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.invalidate_opportunity_assessment_proof()
CREATE FUNCTION private.invalidate_opportunity_assessment_proof() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare invalidate boolean:=tg_op='DELETE';
begin
  if tg_op<>'DELETE' then
    if tg_table_schema='private' then invalidate:=new.rolled_back_at is not null;
    else invalidate:=new.verified_at is null;end if;
  end if;
  if invalidate then
    update public.opportunity_search_discoveries set verified_at=null,assessment_verified_at=null where run_id=old.run_id and item_id=old.item_id;
  end if;
  return null;
end;
$$;

-- private.maintain_opportunity_feedback_prediction_proofs()
CREATE FUNCTION private.maintain_opportunity_feedback_prediction_proofs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='DELETE' then perform private.refresh_opportunity_feedback_prediction_proofs(old.run_id,old.item_id);return old;end if;
  if tg_op='UPDATE' and(new.run_id,new.item_id) is distinct from(old.run_id,old.item_id) then
    perform private.refresh_opportunity_feedback_prediction_proofs(old.run_id,old.item_id);
  end if;
  perform private.refresh_opportunity_feedback_prediction_proofs(new.run_id,new.item_id);return new;
end;
$$;

-- private.opportunity_canonical_input(jsonb, jsonb, text)
CREATE FUNCTION private.opportunity_canonical_input(v jsonb, s jsonb, p_path text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare d jsonb:=private.opportunity_storage_schema(); k text; a jsonb; x jsonb; r jsonb; type_name text; id text;
begin
 type_name:=split_part(s->>'$ref','/',3);
 if s?'$ref' then s:=d#>string_to_array(substring(s->>'$ref' from 3),'/'); end if;
 if jsonb_typeof(v)='object' then
   r:='{}';
   for k,a in select * from jsonb_each(v) order by key loop
     if k='merge_control' then r:=r||jsonb_build_object(k,a); continue; end if;
     x:=private.opportunity_canonical_input(a,coalesce(s->'properties'->k,s->'additionalProperties','true'),p_path||'/'||private.opportunity_merge_pointer(k));
     r:=r||jsonb_build_object(k,x);
   end loop;
   if type_name='person' then
     if not r?'roles' then r:=r||'{"roles":[]}'::jsonb; end if;
     if jsonb_typeof(r->'email')='string' then r:=jsonb_set(r,'{email}',to_jsonb(lower(btrim(r->>'email')))); end if;
   end if;
   if type_name in ('person','checklist','paper','focus_profile','money_component') and not r?'entity_id' then
     id:=case type_name when 'person' then coalesce(nullif(lower(btrim(r->>'email')),''),nullif(r->>'orcid',''),nullif(private.opportunity_merge_key(r->>'name'),''),r::text)
       when 'checklist' then private.opportunity_merge_key(r->>'text')||':'||(r->>'stage')
       when 'paper' then coalesce(nullif(lower(r->>'doi'),''),nullif(private.opportunity_merge_url(r->>'url'),''),private.opportunity_merge_key(r->>'title'),r::text)
       when 'focus_profile' then private.opportunity_merge_key(r->>'name') else private.opportunity_merge_key(r->>'label')||':'||coalesce(r->>'currency','')||':'||coalesce(r->>'period','') end;
     r:=r||jsonb_build_object('entity_id','generated:'||md5(type_name||':'||id));
   elsif type_name='source' and not r?'source_id' then
     r:=r||jsonb_build_object('source_id','source:'||md5(private.opportunity_merge_url(r->>'url')||':'||coalesce(r->>'checked_at','unknown')||':'||(r->>'kind')));
   end if;
   return r;
 elsif jsonb_typeof(v)='array' then
   r:='[]';
   for a in select value from jsonb_array_elements(v) loop r:=r||jsonb_build_array(private.opportunity_canonical_input(a,coalesce(s->'items','true'),p_path)); end loop;
   if s#>>'{items,type}'='string' then return private.opportunity_canonical_set(p_path,r); end if;
   return r;
 end if;
 return v;
end $_$;

-- private.opportunity_canonical_set(text, jsonb)
CREATE FUNCTION private.opportunity_canonical_set(p_path text, v jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select coalesce(jsonb_agg(x order by identity,x),'[]') from (
   select distinct on (private.opportunity_canonical_set_key(p_path,a#>>'{}')) a x,private.opportunity_canonical_set_key(p_path,a#>>'{}') identity
   from jsonb_array_elements(v) t(a) order by private.opportunity_canonical_set_key(p_path,a#>>'{}'),a
 ) q
$$;

-- private.opportunity_canonical_set_key(text, text)
CREATE FUNCTION private.opportunity_canonical_set_key(p_path text, v text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select case when p_path like '%/source_urls' then private.opportunity_merge_url(v) else private.opportunity_merge_key(v) end
$$;

-- private.opportunity_context_checksum()
CREATE FUNCTION private.opportunity_context_checksum() RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select encode(sha256(convert_to(jsonb_build_object(
   'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]') from public.opportunity_reviews r),
   'applications',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.applications a))::text,'UTF8')),'hex')
$$;

-- private.opportunity_discovery_prediction_candidate(uuid, uuid, timestamp with time zone)
CREATE FUNCTION private.opportunity_discovery_prediction_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare candidate jsonb;
begin
  if p_before is null or not isfinite(p_before) then return null; end if;
  for candidate in select jsonb_build_object('user_id',d.user_id,'opportunity_id',d.opportunity_id,'score',d.assessment_score,
      'scale_min',0,'scale_max',10,'predicted_at',d.assessment_recorded_at,'source_kind','discovery_assessment',
      'source_ref','opportunity-discovery-assessment:'||d.discovery_id::text)
    from public.opportunity_search_discoveries d
    where d.user_id=p_user_id and d.opportunity_id=p_opportunity_id and d.assessment_verified_at is not null
      and d.assessment_recorded_at<=p_before and d.assessment_score between 0 and 10
      and d.assessment_scale_min=0 and d.assessment_scale_max=10
    order by d.assessment_recorded_at,d.discovery_id loop
    if private.opportunity_feedback_baseline_matches(candidate,p_user_id,p_opportunity_id,p_before) then return candidate; end if;
  end loop;
  return null;
end;
$$;

-- private.opportunity_feedback_baseline_matches(jsonb, uuid, uuid, timestamp with time zone)
CREATE FUNCTION private.opportunity_feedback_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare reference text[]; recorded timestamptz; assessment jsonb;
begin
  if p_baseline is null or jsonb_typeof(p_baseline) is distinct from 'object'
    or p_baseline-array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref']<>'{}'::jsonb
    or not(p_baseline?&array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'])
    or jsonb_typeof(p_baseline->'source_kind') is distinct from 'string'
    or jsonb_typeof(p_baseline->'source_ref') is distinct from 'string'
    or jsonb_typeof(p_baseline->'predicted_at') is distinct from 'string'
    or p_baseline->>'user_id' is distinct from p_user_id::text or p_baseline->>'opportunity_id' is distinct from p_opportunity_id::text
    or jsonb_typeof(p_baseline->'score') is distinct from 'number'
    or p_baseline->'scale_min' is distinct from '0'::jsonb or p_baseline->'scale_max' is distinct from '10'::jsonb
    or not((p_baseline->>'score')::numeric between 0 and 10) or p_feedback_at is null or not isfinite(p_feedback_at) then return false; end if;
  if p_baseline->>'source_kind'='historical_snapshot' then
    reference:=regexp_match(p_baseline->>'source_ref','^opportunity-search-receipt:([0-9a-f-]{36}):([0-9a-f-]{36})$');
    if reference is null then return false; end if;
    select a.recorded_at,a.after_snapshot->'personal_fit' into recorded,assessment
      from public.opportunity_search_receipts r
      join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=r.user_id
      join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=r.opportunity_id
      where r.run_id=reference[1]::uuid and r.item_id=reference[2]::uuid
        and r.user_id=p_user_id and r.opportunity_id=p_opportunity_id and r.verified_at is not null and a.rolled_back_at is null;
  elsif p_baseline->>'source_kind'='discovery_assessment' then
    reference:=regexp_match(p_baseline->>'source_ref','^opportunity-discovery-assessment:([0-9a-f-]{36})$');
    if reference is null then return false; end if;
    select d.assessment_recorded_at,d.original_assessment into recorded,assessment
      from public.opportunity_search_discoveries d
      join public.opportunity_search_receipts r on r.run_id=d.run_id and r.item_id=d.item_id
        and r.user_id=d.user_id and r.opportunity_id=d.opportunity_id
      join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=d.user_id and run.search_id=d.search_id
        and run.protocol_version=d.assessment_version
      join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=d.opportunity_id
      where d.discovery_id=reference[1]::uuid and d.user_id=p_user_id and d.opportunity_id=p_opportunity_id
        and d.assessment_verified_at is not null and d.assessment_verified_at=r.verified_at
        and r.verified_at is not null and a.rolled_back_at is null and d.assessment_recorded_at=a.recorded_at
        and d.original_assessment=r.payload->'personal_fit'
        and d.assessment_score=(p_baseline->>'score')::numeric and d.assessment_scale_min=0 and d.assessment_scale_max=10;
  else return false;
  end if;
  return coalesce(recorded<=p_feedback_at and recorded=private.opportunity_feedback_time(p_baseline->>'predicted_at')
    and jsonb_typeof(assessment)='object' and jsonb_typeof(assessment->'score')='number'
    and assessment->'scale_min'='0'::jsonb and assessment->'scale_max'='10'::jsonb
    and assessment->'score'=p_baseline->'score',false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$_$;

-- private.opportunity_feedback_projection_text(text, integer)
CREATE FUNCTION private.opportunity_feedback_projection_text(p_text text, p_max_length integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select public.opportunity_feedback_safe_text(p_text,p_max_length)
    and p_text ~ '[^[:space:]]'
    and p_text !~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)';
$$;

-- private.opportunity_feedback_safe_url(text)
CREATE FUNCTION private.opportunity_feedback_safe_url(p_url text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare parts text[]; authority text[]; scheme text; host text; port integer; path text; query text;
  plain text; component text; pair text; key text; value text;
  private_key text:='(access[[:space:]_-]*token|refresh[[:space:]_-]*token|token|key|api[[:space:]_-]*key|auth(entication|orization)?|password|passwd|pwd|secret|session([[:space:]_-]*id)?|jwt|code|email([[:space:]_-]*address)?|e[[:space:]_-]*mail|phone([[:space:]_-]*number)?|mobile|tel|telephone|address|street|name|first[[:space:]_-]*name|last[[:space:]_-]*name|full[[:space:]_-]*name|user([[:space:]_-]*id|[[:space:]_-]*name)?|candidate([[:space:]_-]*id)?|applicant([[:space:]_-]*id)?|person([[:space:]_-]*id)?|contact([[:space:]_-]*id)?)';
begin
  if p_url is null or char_length(p_url)>2048 or p_url ~ '[[:cntrl:][:space:]]' or position(chr(92) in p_url)>0 then return null; end if;
  parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)([?][^#]*)?(#.*)?$','i');
  if parts is null then return null; end if;
  scheme:=lower(parts[1]);
  authority:=regexp_match(parts[2],'^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]+)?$');
  if authority is null then return null; end if;
  host:=lower(authority[1]);
  if position('.' in host)=0 or host !~ '[.][A-Za-z][A-Za-z0-9-]*$' or host ~ '^[0-9.]+$' or host ~ '[.][.]'
    or host ~ '(^|[.])-|-[.]' or host ~ '[.](localhost|local)$' then return null; end if;
  if authority[3] is not null then
    port:=substr(authority[3],2)::integer;
    if port<0 or port>65535 then return null; end if;
  end if;
  path:=coalesce(nullif(parts[3],''),'/'); query:=coalesce(parts[4],'');
  plain:=private.opportunity_feedback_url_decoded(p_url);
  if plain is null or plain ~ '[[:cntrl:]]' or position(chr(92) in plain)>0
    or plain ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    or plain ~* '(mailto|tel):'
    or plain ~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    or plain ~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)'
    or plain ~* '/(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|authorize|password|reset-password|session)(/|$)'
    or regexp_replace(plain,'[[:space:]_+-]+','','g') ~* ('[?&#]'||private_key||'=')
    or plain ~* 'https?://[^[:space:]/]+@' then return null; end if;
  foreach pair in array string_to_array(substr(query,2),'&') loop
    key:=private.opportunity_feedback_url_decoded(replace(split_part(pair,'=',1),'+',' '));
    value:=private.opportunity_feedback_url_decoded(replace(substr(pair,position('=' in pair)+1),'+',' '));
    if key is null or value is null or regexp_replace(key,'[[:space:]_+-]+','','g') ~* ('^'||private_key||'$') then return null; end if;
  end loop;
  component:=private.opportunity_feedback_url_decoded(coalesce(parts[5],''));
  if component is null then return null; end if;
  return scheme||'://'||host||case when port is not null and not (scheme='http' and port=80 or scheme='https' and port=443)
    then ':'||port::text else '' end||path||query||coalesce(parts[5],'');
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$_$;

-- private.opportunity_feedback_time(text)
CREATE FUNCTION private.opportunity_feedback_time(p_value text) RETURNS timestamp with time zone
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare parsed timestamptz;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' then return null; end if;
  parsed := p_value::timestamptz;
  if not isfinite(parsed) then return null; end if;
  return parsed;
exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then return null;
end;
$_$;

-- private.opportunity_feedback_url_decoded(text)
CREATE FUNCTION private.opportunity_feedback_url_decoded(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare current_text text:=p_text; next_text text; bytes bytea; piece text; index integer; pass integer;
begin
  if p_text is null or char_length(p_text)>8192 then return null; end if;
  for pass in 1..3 loop
    if position('%' in current_text)=0 then return current_text; end if;
    bytes:=''::bytea; index:=1;
    while index<=char_length(current_text) loop
      piece:=substr(current_text,index,1);
      if piece='%' then
        piece:=substr(current_text,index+1,2);
        if piece !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
        bytes:=bytes||decode(piece,'hex'); index:=index+3;
      else
        bytes:=bytes||convert_to(piece,'UTF8'); index:=index+1;
      end if;
    end loop;
    next_text:=convert_from(bytes,'UTF8');
    if next_text=current_text then return current_text; end if;
    current_text:=next_text;
  end loop;
  if current_text ~ '%[0-9A-Fa-f]{2}' then return null; end if;
  return current_text;
exception when character_not_in_repertoire or untranslatable_character or invalid_parameter_value then return null;
end;
$_$;

-- private.opportunity_interest_metric(uuid, uuid)
CREATE FUNCTION private.opportunity_interest_metric(p_user_id uuid, p_opportunity_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare review record; application record; score numeric; origin text := 'none';
  has_application boolean := false; submitted boolean := false; submitted_time timestamptz; baseline jsonb; gap numeric; outcome_at timestamptz;
begin
  if p_user_id is null or p_opportunity_id is null then
    raise exception 'Feedback requires an owner and opportunity' using errcode = '22023';
  end if;
  select state, interest_rating, feedback_excluded, feedback_revision, feedback_updated_at, prediction_baseline
    into review from public.opportunity_reviews where user_id = p_user_id and opportunity_id = p_opportunity_id;
  select status, submitted_at, status_history into application from public.applications
    where user_id = p_user_id and opportunity_id = p_opportunity_id;
  has_application := found;
  if has_application then
    submitted := coalesce(isfinite(application.submitted_at), false) or application.status = 'submitted'
      or exists(select 1 from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted');
    select min(value) into submitted_time from (
      select application.submitted_at as value where isfinite(application.submitted_at)
      union all select private.opportunity_feedback_time(e->>'changedAt')
      from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted'
    ) times;
  end if;
  if coalesce(review.feedback_excluded, false) then origin := 'excluded';
  elsif submitted then score := 9.5; origin := 'confirmed_submission';
  elsif has_application then score := 9; origin := 'application';
  elsif review.state in ('very_high_interest','strong_interest','interested','not_interested') then
    score := case review.state when 'very_high_interest' then 9 when 'strong_interest' then 8 when 'interested' then 6 else 2 end; origin := 'categorical_review'; end if;
  baseline := case when origin='categorical_review' then review.prediction_baseline end;
  outcome_at := case when origin='confirmed_submission' then submitted_time when origin='categorical_review' then review.feedback_updated_at end;
  if origin='confirmed_submission' and outcome_at is not null then
    baseline:=private.opportunity_discovery_prediction_candidate(p_user_id,p_opportunity_id,outcome_at);
  end if;
  if score is null or outcome_at is null or not private.opportunity_feedback_baseline_matches(
    baseline, p_user_id, p_opportunity_id, outcome_at
  ) then baseline := null; end if;
  if score is not null and baseline is not null then gap := score - (baseline->>'score')::numeric; end if;
  return jsonb_build_object('metric_version','opportunity-interest-v2', 'user_id',p_user_id, 'opportunity_id',p_opportunity_id,
    'interest_score',score, 'interest_origin',origin, 'confirmed_submission',submitted, 'submission_at',submitted_time,
    'feedback_revision',coalesce(review.feedback_revision,0), 'feedback_updated_at',review.feedback_updated_at,
    'interest_gap',gap, 'baseline_status',case when baseline is null then 'unavailable' else 'available' end);
end;
$$;

-- private.opportunity_merge_authorize(jsonb, jsonb, jsonb, jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_authorize(p_old jsonb, p_new jsonb, p_old_evidence jsonb, p_new_evidence jsonb, p_correction jsonb) RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare ot timestamptz; nt timestamptz; official_old boolean; shared boolean; correction boolean;
begin
 if p_correction is not null and p_correction->'expected' is distinct from coalesce(p_old,'null') then return 'conflicting:correction_precondition_failed'; end if;
 if p_old is not distinct from p_new then return 'unchanged'; end if;
 correction:=p_correction->'expected' is not distinct from coalesce(p_old,'null') and length(btrim(coalesce(p_correction->>'reason','')))>0;
 select max(private.opportunity_merge_precise_time(s->>'checked_at')) into nt from jsonb_array_elements(coalesce(p_new_evidence,'[]')) t(s)
   where private.opportunity_merge_precise_time(s->>'checked_at') is not null and private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school');
 if nt is null then return 'rejected:missing_precise_official_evidence'; end if;
 if not private.opportunity_merge_present(p_new) and not correction then return 'unchanged:empty_partial'; end if;
 if not private.opportunity_merge_present(p_old) then return 'accepted:verified_addition'; end if;
 select max(private.opportunity_search_evidence_time(s)),coalesce(bool_or(private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school')),false)
   into ot,official_old from jsonb_array_elements(coalesce(p_old_evidence,'[]')) t(s);
 select exists(select 1 from jsonb_array_elements(coalesce(p_new_evidence,'[]')) n, jsonb_array_elements(coalesce(p_old_evidence,'[]')) o
   where private.opportunity_merge_url(n->>'url')=private.opportunity_merge_url(o->>'url')
   and private.opportunity_search_source_kind(n) in ('official','official_listing','institution','graduate_school')
   and private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school')) into shared;
 if nt<ot then return 'rejected:stale_evidence'; end if;
 if correction and nt=ot and private.opportunity_merge_same_evidence(p_old_evidence,p_new_evidence)
   then return 'accepted:same_evidence_correction'; end if;
 if nt=ot then return 'conflicting:equal_time_requires_compare_and_set_correction'; end if;
 if official_old and not shared and not correction then return 'conflicting:different_official_authority'; end if;
 if jsonb_typeof(p_old)<>jsonb_typeof(p_new) and not correction then return 'conflicting:type_change_requires_correction'; end if;
 return 'accepted:newer_official_evidence';
end $$;

-- private.opportunity_merge_can_revalidate(jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_can_revalidate(p_old jsonb, p_new jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select exists(select 1 from jsonb_array_elements(coalesce(p_new,'[]')) n
   where private.opportunity_search_source_kind(n) in ('official','official_listing','institution','graduate_school')
   and private.opportunity_merge_precise_time(n->>'checked_at')>coalesce((select max(private.opportunity_search_evidence_time(o)) from jsonb_array_elements(coalesce(p_old,'[]')) o),'-infinity'::timestamptz)
   and (not exists(select 1 from jsonb_array_elements(coalesce(p_old,'[]')) o where private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school'))
     or exists(select 1 from jsonb_array_elements(coalesce(p_old,'[]')) o where private.opportunity_search_source_kind(o) in ('official','official_listing','institution','graduate_school')
       and private.opportunity_merge_url(o->>'url')=private.opportunity_merge_url(n->>'url'))))
$$;

-- private.opportunity_merge_canonical(text, jsonb)
CREATE FUNCTION private.opportunity_merge_canonical(p_field text, v jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
 if p_field='sources' then return private.opportunity_merge_sources(v); end if;
 if p_field in ('contacts','supervisors','requirements','required_documents','supervisor_top_papers') then return private.opportunity_merge_entities(p_field,v); end if;
 if p_field in ('topics','open_questions','research_methods','roles') then return private.opportunity_merge_set(v); end if;
 return v;
end $$;

-- private.opportunity_merge_entities(text, jsonb)
CREATE FUNCTION private.opportunity_merge_entities(p_field text, v jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
 if jsonb_typeof(v)<>'array' then raise exception 'Canonical entity arrays are required.' using errcode='22023'; end if;
 return (select coalesce(jsonb_agg(x order by private.opportunity_merge_entity_key(p_field,x),x),'[]') from (select distinct a x from jsonb_array_elements(v) t(a)) q);
end $$;

-- private.opportunity_merge_entity_key(text, jsonb)
CREATE FUNCTION private.opportunity_merge_entity_key(p_field text, v jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select coalesce('id:'||nullif(v->>'entity_id',''),
   case when p_field in ('contacts','supervisors') then coalesce('email:'||nullif(lower(btrim(v->>'email')),''),'orcid:'||nullif(v->>'orcid',''),'name:'||private.opportunity_merge_key(v->>'name'))
     when p_field='supervisor_top_papers' then coalesce('doi:'||nullif(lower(v->>'doi'),''),'url:'||nullif(private.opportunity_merge_url(v->>'url'),''),'title:'||private.opportunity_merge_key(v->>'title'))
     else 'fact:'||md5(private.opportunity_merge_key(v->>'label')||':'||private.opportunity_merge_key(v->>'text')) end)
$$;

-- private.opportunity_merge_evidence(jsonb, text)
CREATE FUNCTION private.opportunity_merge_evidence(p_sources jsonb, p_path text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select coalesce(jsonb_agg(s order by s),'[]') from (
   select distinct private.opportunity_search_normalize_source(a) s from jsonb_array_elements(coalesce(p_sources,'[]')) t(a)
 ) n where exists(select 1 from jsonb_array_elements_text(s->'supports') t(f)
   where p_path='/'||f or left(p_path,length(f)+2)='/'||f||'/' or p_path=f or left(p_path,length(f)+1)=f||'/')
$$;

-- private.opportunity_merge_evidence_signature(jsonb)
CREATE FUNCTION private.opportunity_merge_evidence_signature(v jsonb) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select coalesce(jsonb_agg(x order by x),'[]') from (
   select distinct jsonb_build_array(private.opportunity_merge_url(s->>'url'),
     private.opportunity_merge_precise_time(s->>'checked_at')) x from jsonb_array_elements(coalesce(v,'[]')) t(s)
   where private.opportunity_merge_precise_time(s->>'checked_at') is not null and private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school')
 ) n
$$;

-- private.opportunity_merge_key(text)
CREATE FUNCTION private.opportunity_merge_key(v text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select regexp_replace(lower(btrim(coalesce(v,''))), '[[:space:]_-]+',' ','g')
$$;

-- private.opportunity_merge_node(text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_node(p_path text, p_old jsonb, p_new jsonb, p_state jsonb, p_old_sources jsonb, p_new_sources jsonb, p_control jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare policy text:=private.opportunity_merge_policy(p_path); r jsonb:=p_old; state jsonb:=p_state; decisions jsonb:='[]';
  k text; v jsonb; child jsonb; path text; old_e jsonb; new_e jsonb; correction jsonb; verdict text; entry jsonb;
  old_entry jsonb; idx integer; matches integer[]; canonical_field text:=split_part(p_path,'/',2); added jsonb;
  quote_keys text[]:=array['amount','min','max','currency','period','gross','model']; old_quote jsonb; new_quote jsonb;
  ancestor record; bound boolean:=false; effective_absence boolean:=false; old_t timestamptz; new_t timestamptz;
begin
 select c into correction from jsonb_array_elements(coalesce(p_control->'corrections','[]')) t(c) where c->>'path'=p_path;
 if p_new is null then return jsonb_build_object('value',coalesce(p_old,'null'),'state',state,'decisions',decisions); end if;
 -- An explicit correction replaces a collection atomically; absent members are otherwise retained.
 if correction is null and policy='entities' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by private.opportunity_merge_entity_key(canonical_field,value),value loop
     select array_agg(n::integer) into matches from jsonb_array_elements(r) with ordinality t(a,n)
       where case when canonical_field in ('contacts','supervisors') then private.opportunity_merge_person_match(a,v)
         when canonical_field='supervisor_top_papers' then private.opportunity_merge_paper_match(a,v)
         else private.opportunity_merge_entity_key(canonical_field,a)=private.opportunity_merge_entity_key(canonical_field,v) end;
     if cardinality(matches)>1 then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path',p_path,'status','conflicting','reason','ambiguous_entity','before',r,'after',r,'proposed',v));
       continue;
     end if;
     idx:=case when cardinality(matches)=1 then matches[1]-1 else jsonb_array_length(r) end;
     old_entry:=r->idx;
     if old_entry?'entity_id' and v->>'entity_id' like 'generated:%' then v:=jsonb_set(v,'{entity_id}',old_entry->'entity_id'); end if;
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_merge_entity_key(canonical_field,coalesce(old_entry,v)));
     child:=private.opportunity_merge_node(path,old_entry,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if private.opportunity_merge_present(child->'value') then r:=jsonb_set(r,array[idx::text],child->'value'); end if;
   end loop;
   select coalesce(jsonb_agg(a order by private.opportunity_merge_entity_key(canonical_field,a),a),'[]') into r from jsonb_array_elements(r) t(a);
 elsif correction is null and policy='salary' and jsonb_typeof(p_new)='object' then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   select coalesce(jsonb_object_agg(key,value),'{}') into old_quote from jsonb_each(r) where key=any(quote_keys);
   select coalesce(jsonb_object_agg(key,value),'{}') into new_quote from jsonb_each(p_new) where key=any(quote_keys);
   if new_quote<>'{}' then
     if ((new_quote ?| array['amount','min','max','currency','period']) and not (new_quote ?& array['currency','period']))
       or exists(select 1 from jsonb_object_keys(old_quote) t(qk) where not new_quote?qk or (private.opportunity_merge_present(old_quote->qk) and not private.opportunity_merge_present(new_quote->qk))) then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/salary/@quote','policy','assessment','status','conflicting','reason','incomplete_salary_quote',
         'before',old_quote,'after',old_quote,'proposed',new_quote));
     else
       child:=private.opportunity_merge_node('/salary/@quote',old_quote,new_quote,state,p_old_sources,p_new_sources,p_control);
       state:=child->'state'; decisions:=decisions||(child->'decisions');
       if jsonb_typeof(child->'value')='object' then r:=(r-quote_keys)||(child->'value'); end if;
     end if;
   end if;
   for k,v in select * from jsonb_each(p_new-quote_keys) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 elsif correction is null and policy='set' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by value loop
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_canonical_set_key(p_path,v#>>'{}'));
     select a into old_entry from jsonb_array_elements(r) t(a) where private.opportunity_canonical_set_key(p_path,a#>>'{}')=private.opportunity_canonical_set_key(p_path,v#>>'{}');
     child:=private.opportunity_merge_node(path,old_entry,coalesce(old_entry,v),state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if old_entry is null and private.opportunity_merge_present(child->'value') then r:=r||jsonb_build_array(child->'value'); end if;
   end loop;
   r:=private.opportunity_canonical_set(p_path,r);
 elsif correction is null and policy='recursive' and jsonb_typeof(p_new)='object'
   and (not private.opportunity_merge_present(p_old) or jsonb_typeof(p_old)='object') then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   for k,v in select * from jsonb_each(p_new) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 else
   entry:=state->p_path;
   -- Atomic parent corrections/revalidations supersede their old child bindings.
   if entry is null then
     for ancestor in select key,value from jsonb_each(state) where left(p_path,length(key)+1)=key||'/' order by length(key) desc loop
       if coalesce(private.opportunity_merge_value_at(ancestor.value->'value',substring(p_path from length(ancestor.key)+2),canonical_field),'null')
         is not distinct from coalesce(p_old,'null') then
         entry:=jsonb_build_object('value',coalesce(p_old,'null'),'evidence',ancestor.value->'evidence');
         bound:=true; exit;
       end if;
     end loop;
   else bound:=true; end if;
   -- Detect out-of-band edits rather than blessing the stale state's evidence.
   if entry is not null and entry->'value' is distinct from coalesce(p_old,'null') then
     old_e:='[]'::jsonb;
   else old_e:=coalesce(entry->'evidence','[]'::jsonb); end if;
   new_e:=private.opportunity_merge_evidence(p_new_sources,p_path);
   -- A whole-container correction must respect every effective descendant fact.
   if correction is not null and jsonb_typeof(p_old) in ('array','object') then
     select coalesce(jsonb_agg(distinct evidence),'[]') into old_e from (
       select evidence from jsonb_array_elements(old_e) t(evidence)
       union all select e from jsonb_each(state) t(sk,sv) cross join lateral jsonb_array_elements(coalesce(sv->'evidence','[]')) x(e)
         where left(sk,length(p_path)+1)=p_path||'/'
     ) all_evidence;
   end if;
   effective_absence:=bound and not private.opportunity_merge_present(p_old) and private.opportunity_merge_present(p_new);
   if effective_absence then
     select max(private.opportunity_search_evidence_time(s)) into old_t from jsonb_array_elements(old_e) t(s);
     select max(private.opportunity_merge_precise_time(s->>'checked_at')) into new_t from jsonb_array_elements(new_e) t(s)
       where private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school');
   end if;
   if policy='identity' then
     verdict:=case when not private.opportunity_merge_present(p_old) then 'accepted:new_canonical_identity' when p_old=p_new then 'unchanged' else 'conflicting:immutable_canonical_key' end;
   elsif p_path in ('/official_url','/source_url','/application_url') and private.opportunity_merge_url(p_old#>>'{}')=private.opportunity_merge_url(p_new#>>'{}') then
     verdict:='unchanged:equivalent_url';
   elsif policy='clock' then
     verdict:=case when not private.opportunity_merge_present(p_old) or (p_new#>>'{}')::timestamptz>(p_old#>>'{}')::timestamptz then 'accepted:monotonic_check_time'
       when (p_new#>>'{}')::timestamptz=(p_old#>>'{}')::timestamptz then 'unchanged' else 'rejected:older_check_time' end;
   else
     verdict:=private.opportunity_merge_authorize(p_old,p_new,old_e,new_e,correction);
   end if;
   if effective_absence and new_t<=old_t then
     if new_t<old_t then verdict:='rejected:stale_evidence_for_cleared_value';
     elsif correction is null or correction->'expected' is distinct from coalesce(p_old,'null')
       or not private.opportunity_merge_same_evidence(old_e,new_e) then
       verdict:='conflicting:cleared_value_requires_correction';
     end if;
   end if;
   if verdict like 'accepted:%' then
     r:=p_new;
     state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
   else
     r:=coalesce(p_old,'null');
     if entry is null then state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',old_e,'verification','unknown')); end if;
     if verdict like 'unchanged%' and private.opportunity_merge_present(r) and private.opportunity_merge_can_revalidate(old_e,new_e) then
       state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
       verdict:='unchanged:same_value_revalidated';
     end if;
   end if;
   if jsonb_typeof(r) in ('object','array') and (verdict like 'accepted:%' or verdict='unchanged:same_value_revalidated') then
     select coalesce(jsonb_object_agg(key,value),'{}') into state from jsonb_each(state) where left(key,length(p_path)+1)<>p_path||'/';
   end if;
   decisions:=jsonb_build_array(jsonb_build_object('path',p_path,'policy',policy,'status',split_part(verdict,':',1),
     'reason',coalesce(nullif(split_part(verdict,':',2),''),'same_value'),'before',coalesce(p_old,'null'),'after',r,'proposed',p_new,
     'before_evidence',old_e,'after_evidence',coalesce(state#>array[p_path,'evidence'],old_e),'proposed_evidence',new_e,
     'correction_reason',correction->>'reason'));
 end if;
 return jsonb_build_object('value',coalesce(r,'null'),'state',state,'decisions',decisions);
end $$;

-- private.opportunity_merge_paper_match(jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_paper_match(a jsonb, b jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select (a->>'entity_id'=b->>'entity_id') or
 (nullif(a->>'doi','') is not null and regexp_replace(lower(a->>'doi'),'^https?://(dx[.])?doi[.]org/','')=regexp_replace(lower(b->>'doi'),'^https?://(dx[.])?doi[.]org/','')) or
 (not (nullif(a->>'doi','') is not null and nullif(b->>'doi','') is not null and regexp_replace(lower(a->>'doi'),'^https?://(dx[.])?doi[.]org/','')<>regexp_replace(lower(b->>'doi'),'^https?://(dx[.])?doi[.]org/',''))
   and ((nullif(a->>'url','') is not null and private.opportunity_merge_url(a->>'url')=private.opportunity_merge_url(b->>'url'))
     or (nullif(private.opportunity_merge_key(a->>'title'),'') is not null and private.opportunity_merge_key(a->>'title')=private.opportunity_merge_key(b->>'title')
       and (a->>'year' is null or b->>'year' is null or a->>'year'=b->>'year'))))
$$;

-- private.opportunity_merge_person_match(jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_person_match(a jsonb, b jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select not (nullif(a->>'orcid','') is not null and nullif(b->>'orcid','') is not null and lower(a->>'orcid')<>lower(b->>'orcid')) and (
 (nullif(a->>'entity_id','') is not null and a->>'entity_id'=b->>'entity_id') or
 (nullif(a->>'orcid','') is not null and lower(a->>'orcid')=lower(b->>'orcid')) or
 (nullif(a->>'email','') is not null and lower(btrim(a->>'email'))=lower(btrim(b->>'email'))) or
 (nullif(private.opportunity_merge_key(a->>'name'),'') is not null
   and private.opportunity_merge_key(a->>'name')=private.opportunity_merge_key(b->>'name')
   and (nullif(a->>'institution','') is null or nullif(b->>'institution','') is null or private.opportunity_merge_key(a->>'institution')=private.opportunity_merge_key(b->>'institution'))
   and not (nullif(a->>'email','') is not null and nullif(b->>'email','') is not null and lower(btrim(a->>'email'))<>lower(btrim(b->>'email')))
   and not (nullif(a->>'orcid','') is not null and nullif(b->>'orcid','') is not null and lower(a->>'orcid')<>lower(b->>'orcid'))))
$$;

-- private.opportunity_merge_plan(jsonb, jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_plan(p_before jsonb, p_payload jsonb, p_state jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare old jsonb:=coalesce(nullif(p_before,'null'::jsonb),'{}'); incoming jsonb; merged jsonb:=old;
 state jsonb:=coalesce(nullif(p_state,'null'::jsonb),'{}'); decisions jsonb:='[]'; k text; v jsonb; child jsonb; old_state jsonb;
 deadline_bad boolean:=false; clock_fields text[]:=array['deadline','deadline_time_local','deadline_timezone','deadline_original_text'];
 normalized_payload jsonb; normalization jsonb:='[]';
begin
 if old<>'{}' and p_state is null then raise exception 'Effective field state is required for an existing canonical record.' using errcode='23514'; end if;
 if old?'metadata_schema_version' and old->'metadata_schema_version'<>'6' then raise exception 'Only canonical v6 records may be merged.' using errcode='22023'; end if;
 perform private.validate_opportunity_search_result(p_payload);
 incoming:=private.opportunity_canonical_input(p_payload,private.opportunity_search_result_schema());
 normalized_payload:=incoming;
 -- Run the tuple against one state snapshot; one rejected member rejects the tuple.
 old_state:=state;
 foreach k in array clock_fields loop
   if not incoming?k then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,incoming->k,state,'[]'::jsonb,incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions'); merged:=jsonb_set(merged,array[k],child->'value');
   if exists(select 1 from jsonb_array_elements(child->'decisions') t(a) where a->>'status' in ('rejected','conflicting')) then deadline_bad:=true; end if;
 end loop;
 if incoming?'deadline' and incoming->'deadline' is distinct from old->'deadline' and private.opportunity_merge_present(old->'deadline_time_local')
   and not (incoming ?& array['deadline','deadline_time_local','deadline_timezone']) then deadline_bad:=true; end if;
 if deadline_bad then
   select coalesce(jsonb_agg(case when a->>'status'='accepted' then a||jsonb_build_object('status','conflicting','reason','deadline_tuple_rejected','after',a->'before','after_evidence',a->'before_evidence') else a end),'[]') into decisions from jsonb_array_elements(decisions) t(a);
   state:=old_state;
   foreach k in array clock_fields loop
     if old?k then merged:=jsonb_set(merged,array[k],old->k); else merged:=merged-k; end if;
   end loop;
 end if;
 for k,v in select * from jsonb_each(incoming) order by key loop
   if k=any(clock_fields) or k in ('sources','merge_control') then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,v,state,'[]'::jsonb,incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions');
   if child->'value'<>'null' or old?k then merged:=jsonb_set(merged,array[k],child->'value'); end if;
 end loop;
 -- The historical source log is lossless, but is never consulted as effective state.
 merged:=merged||jsonb_build_object('sources',private.opportunity_merge_canonical('sources',coalesce(old->'sources','[]')||(incoming->'sources')));
 decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/sources','policy','source_log','status',
   case when merged->'sources' is not distinct from old->'sources' then 'unchanged' else 'accepted' end,
   'reason','historical_claims_only_not_effective_evidence','before',old->'sources','after',merged->'sources','proposed',incoming->'sources'));

 return jsonb_build_object('value',merged,'state',state,'decisions',decisions,'normalization',normalization,'normalized_payload',normalized_payload);
end $$;

-- private.opportunity_merge_pointer(text)
CREATE FUNCTION private.opportunity_merge_pointer(v text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ select replace(replace(v,'~','~0'),'/','~1') $$;

-- private.opportunity_merge_policy(text)
CREATE FUNCTION private.opportunity_merge_policy(p_path text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select case
 when p_path in ('/personal_fit','/rd_career_potential','/research_career_potential','/supervisor_reputation','/hardware_software_balance','/data/living_standard') then 'assessment'
 when p_path='/salary' then 'salary'
 when p_path in ('/contacts','/supervisors','/requirements','/required_documents','/supervisor_top_papers') then 'entities'
 when p_path in ('/topics','/open_questions','/data/research_methods') or p_path like '%/roles'
   or p_path like '/supervisor_top_papers/%/supervisors' then 'set'
 when p_path='/salary/@quote' then 'assessment'
 when p_path like '/salary/components/@%' then 'assessment'
 when p_path in ('/salary/components','/supervisor_research_focus/profiles','/data/research_context','/data/application_process','/data/funding','/data/start_details','/data/provenance','/data/notes') or p_path like '%/notes' then 'entities'
 when p_path like '%/source_urls' or p_path like '%/topics' or p_path like '%/methods' or p_path like '%/conditions' or p_path like '%/file_formats' or p_path like '%/authors' or p_path like '%/gaps' or p_path like '%/limitations' or p_path like '%/evidence' then 'set'
 when p_path='/opportunity_key' or p_path like '%/entity_id' then 'identity'
 when p_path='/last_checked_at' then 'clock'
 else 'recursive' end
$$;

-- private.opportunity_merge_precise_time(text)
CREATE FUNCTION private.opportunity_merge_precise_time(v text) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
begin
 if v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return null; end if;
 return v::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $_$;

-- private.opportunity_merge_present(jsonb)
CREATE FUNCTION private.opportunity_merge_present(v jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select v is not null and v not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)
$$;

-- private.opportunity_merge_same_evidence(jsonb, jsonb)
CREATE FUNCTION private.opportunity_merge_same_evidence(p_old jsonb, p_new jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select private.opportunity_merge_evidence_signature(p_new)<>'[]' and
   private.opportunity_merge_evidence_signature(p_old) @> private.opportunity_merge_evidence_signature(p_new)
$$;

-- private.opportunity_merge_set(jsonb)
CREATE FUNCTION private.opportunity_merge_set(v jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_agg(value order by key),'[]') from (
    select private.opportunity_merge_key(value#>>'{}') key,min(value#>>'{}')::text representative,
      to_jsonb(min(btrim(value#>>'{}'))) value
    from jsonb_array_elements(case jsonb_typeof(v) when 'array' then v when 'null' then '[]' else jsonb_build_array(v) end)
    where jsonb_typeof(value)='string' and btrim(value#>>'{}')<>'' group by 1
  ) s
$$;

-- private.opportunity_merge_sources(jsonb)
CREATE FUNCTION private.opportunity_merge_sources(v jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare r jsonb:='[]'; a jsonb; old jsonb; id text; idx integer; notes jsonb;
begin
 if jsonb_typeof(v)<>'array' then raise exception 'Canonical source arrays are required.' using errcode='22023'; end if;
 for a in select value from jsonb_array_elements(v) order by value loop
   a:=private.opportunity_search_normalize_source(a);
   id:=private.opportunity_merge_url(a->>'url')||':'||coalesce(private.opportunity_merge_precise_time(a->>'checked_at')::text,a->>'checked_at','unknown')||':'||(a->>'kind');
   select (n-1)::integer,x into idx,old from jsonb_array_elements(r) with ordinality t(x,n)
     where private.opportunity_merge_url(x->>'url')||':'||coalesce(private.opportunity_merge_precise_time(x->>'checked_at')::text,x->>'checked_at','unknown')||':'||(x->>'kind')=id limit 1;
   if idx is null then r:=r||jsonb_build_array(a);
   else
     select coalesce(jsonb_agg(x order by x),'[]') into notes from (select distinct x from jsonb_array_elements(coalesce(old->'notes','[]')||coalesce(a->'notes','[]')) t(x)) q;
     old:=old||jsonb_build_object('supports',private.opportunity_merge_set(coalesce(old->'supports','[]')||coalesce(a->'supports','[]')),'notes',notes);
     r:=jsonb_set(r,array[idx::text],old);
   end if;
 end loop;
 return (select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements(r) t(x));
end $$;

-- private.opportunity_merge_stage(text)
CREATE FUNCTION private.opportunity_merge_stage(v text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ select v $$;

-- private.opportunity_merge_url(text)
CREATE FUNCTION private.opportunity_merge_url(v text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare p text[]; q text;
begin
  p:=regexp_match(btrim(v),'^https?://([^/?#]+)([^?#]*)(?:[?]([^#]*))?(?:#.*)?$','i');
  if p is null then return lower(btrim(v)); end if;
  select string_agg(x,'&' order by x) into q from unnest(string_to_array(p[3],'&')) x
    where x<>'' and lower(split_part(x,'=',1))!~'^(utm_.*|gclid|fbclid|msclkid)$';
  return regexp_replace(lower(p[1]),':(80|443)$','')||regexp_replace(p[2],'/+$','')||coalesce('?'||q,'');
end $_$;

-- private.opportunity_merge_value_at(jsonb, text, text)
CREATE FUNCTION private.opportunity_merge_value_at(p_value jsonb, p_suffix text, p_field text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare r jsonb:=p_value; part text; candidates jsonb;
begin
 foreach part in array string_to_array(p_suffix,'/') loop
   part:=replace(replace(part,'~1','/'),'~0','~');
   if part='@quote' and p_field='salary' and jsonb_typeof(r)='object' then
     select coalesce(jsonb_object_agg(key,value),'{}') into r from jsonb_each(r) where key=any(array['amount','min','max','currency','period','gross','model']);
   elsif left(part,1)='@' and jsonb_typeof(r)='array' then
     select jsonb_agg(a) into candidates from jsonb_array_elements(r) t(a) where
       case when jsonb_typeof(a)='string' then private.opportunity_merge_key(a#>>'{}')=substring(part from 2)
       else private.opportunity_merge_entity_key(p_field,a)=substring(part from 2) end;
     if jsonb_array_length(candidates)=1 then r:=candidates->0; else return null; end if;
   elsif jsonb_typeof(r)='object' then r:=r->part;
   else return null; end if;
 end loop;
 return r;
end $$;

-- private.opportunity_payload_schema_valid(jsonb, jsonb, jsonb)
CREATE FUNCTION private.opportunity_payload_schema_valid(v jsonb, s jsonb, root_schema jsonb) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare k text; child jsonb; expected jsonb; kind text:=jsonb_typeof(v); value text:=v#>>'{}'; valid boolean; path text[];
begin
 if s?'$ref' then
   if s->>'$ref' not like '#/%' then return false; end if;
   path:=string_to_array(substring(s->>'$ref' from 3),'/'); s:=root_schema#>path;
   if s is null then return false; end if;
 end if;
 if s='true' then return true; end if;
 if s='false' or v is null then return false; end if;
 if s?'anyOf' then
   valid:=false;
   for child in select x from jsonb_array_elements(s->'anyOf') t(x) loop
     if private.opportunity_payload_schema_valid(v,child,root_schema) then valid:=true; exit; end if;
   end loop;
   if not valid then return false; end if;
 end if;
 if s?'type' then
   expected:=case when jsonb_typeof(s->'type')='array' then s->'type' else jsonb_build_array(s->'type') end;
   if not expected?kind then return false; end if;
 end if;
 if s?'const' and v<>s->'const' then return false; end if;
 if s?'enum' and not (s->'enum' @> jsonb_build_array(v)) then return false; end if;
 if kind='object' then
   if s?'minProperties' and (select count(*) from jsonb_object_keys(v))<(s->>'minProperties')::integer then return false; end if;
   for k in select jsonb_array_elements_text(coalesce(s->'required','[]')) loop if not v?k then return false; end if; end loop;
   for k,child in select * from jsonb_each(v) loop
     if (s->'properties')?k then expected:=s->'properties'->k;
     else expected:=coalesce(s->'additionalProperties','true'); end if;
     if not private.opportunity_payload_schema_valid(child,expected,root_schema) then return false; end if;
   end loop;
 elsif kind='array' then
   if s?'minItems' and jsonb_array_length(v)<(s->>'minItems')::integer then return false; end if;
   if s?'items' then for child in select x from jsonb_array_elements(v) t(x) loop
     if not private.opportunity_payload_schema_valid(child,s->'items',root_schema) then return false; end if;
   end loop; end if;
 elsif kind='number' then
   if s?'minimum' and value::numeric<(s->>'minimum')::numeric then return false; end if;
   if s?'maximum' and value::numeric>(s->>'maximum')::numeric then return false; end if;
 elsif kind='string' then
   if s?'minLength' and length(value)<(s->>'minLength')::integer then return false; end if;
   if s?'maxLength' and length(value)>(s->>'maxLength')::integer then return false; end if;
   if s?'pattern' and value!~(s->>'pattern') then return false; end if;
   if s->>'format'='date' then
     if value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if; perform value::date;
   elsif s->>'format'='date-time' then
     if private.opportunity_merge_precise_time(value) is null then return false; end if;
   elsif s->>'format'='opportunity-timezone' then
     if value!~'^UTC[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$' and not exists(select 1 from pg_timezone_names where name=value and (name in ('UTC','GMT') or name like '%/%')) then return false; end if;
   end if;
 end if;
 return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then return false;
end $_$;

-- private.opportunity_payload_storage_valid(jsonb)
CREATE FUNCTION private.opportunity_payload_storage_valid(p jsonb) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
 select private.opportunity_payload_schema_valid(
   (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p) where (private.opportunity_storage_schema()->'properties')?key),
   private.opportunity_storage_schema(),private.opportunity_storage_schema())
$$;

-- private.opportunity_storage_schema()
CREATE FUNCTION private.opportunity_storage_schema() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$select E'{"type": "object", "$defs": {"data": {"type": "object", "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "funding": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "url_roles": {"type": "object", "properties": {"source_url": {"enum": ["vacancy", "listing", "application_portal", "context", "unknown"], "type": "string"}, "official_url": {"enum": ["vacancy", "listing", "application_portal", "context", "unknown"], "type": "string"}, "application_url": {"enum": ["vacancy", "listing", "application_portal", "context", "unknown"], "type": "string"}}, "additionalProperties": false}, "provenance": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "start_details": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "teaching_load": {"$ref": "#/$defs/teaching"}, "living_standard": {"$ref": "#/$defs/living_standard"}, "research_context": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "research_methods": {"type": "array", "items": {"type": "string"}}, "application_process": {"type": "array", "items": {"$ref": "#/$defs/fact"}}}, "additionalProperties": false}, "fact": {"type": "object", "required": ["label", "text"], "properties": {"text": {"type": "string", "minLength": 1}, "label": {"type": "string", "minLength": 1}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}}, "additionalProperties": false}, "focus": {"type": "object", "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "profiles": {"type": "array", "items": {"$ref": "#/$defs/focus_profile"}}}, "additionalProperties": false}, "paper": {"type": "object", "required": ["entity_id"], "properties": {"doi": {"type": ["string", "null"]}, "url": {"type": ["string", "null"], "pattern": "^https?://[^\\\\s]+$"}, "year": {"type": ["number", "null"], "maximum": 2200, "minimum": 1000}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "title": {"type": ["string", "null"]}, "venue": {"type": ["string", "null"]}, "authors": {"type": "array", "items": {"type": "string"}}, "entity_id": {"type": "string", "minLength": 1}, "relevance": {"type": ["string", "null"]}, "checked_at": {"type": ["string", "null"]}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}, "supervisors": {"type": "array", "items": {"type": "string"}}, "selection_basis": {"type": ["string", "null"]}}, "additionalProperties": false}, "person": {"type": "object", "required": ["entity_id", "roles"], "properties": {"name": {"type": ["string", "null"]}, "email": {"type": ["string", "null"]}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "orcid": {"type": ["string", "null"]}, "phone": {"type": ["string", "null"]}, "roles": {"type": "array", "items": {"type": "string"}}, "entity_id": {"type": "string", "minLength": 1}, "institution": {"type": ["string", "null"]}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}, "verification": {"$ref": "#/$defs/verification"}}, "additionalProperties": false}, "salary": {"type": "object", "properties": {"max": {"type": ["number", "null"]}, "min": {"type": ["number", "null"]}, "gross": {"type": ["boolean", "null"]}, "model": {"type": ["string", "null"]}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "amount": {"type": ["number", "null"]}, "period": {"enum": ["hour", "day", "week", "month", "year", "contract", null], "type": ["string", "null"]}, "details": {"type": ["string", "null"]}, "currency": {"type": ["string", "null"], "pattern": "^[A-Z]{3}$"}, "components": {"type": "array", "items": {"$ref": "#/$defs/money_component"}}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}}, "additionalProperties": false}, "source": {"type": "object", "anyOf": [{"properties": {"precision": {"const": "instant"}, "checked_at": {"type": "string", "format": "date-time"}}}, {"properties": {"precision": {"const": "date"}, "checked_at": {"type": "string", "format": "date"}}}, {"properties": {"precision": {"const": "unknown"}, "checked_at": {"const": null}}}], "required": ["source_id", "url", "kind", "checked_at", "precision", "supports"], "properties": {"url": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}, "kind": {"enum": ["official", "official_listing", "institution", "graduate_school", "discovery", "unknown"], "type": "string"}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "supports": {"type": "array", "items": {"type": "string"}}, "precision": {"enum": ["instant", "date", "unknown"], "type": "string"}, "source_id": {"type": "string", "minLength": 1}, "checked_at": {"type": ["string", "null"]}}, "additionalProperties": false}, "balance": {"type": "object", "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "details": {"type": ["string", "null"]}, "summary": {"type": ["string", "null"]}, "hardware": {"type": "array", "items": {"type": "string"}}, "software": {"type": "array", "items": {"type": "string"}}, "classification": {"type": ["string", "null"]}}, "additionalProperties": false}, "teaching": {"type": "object", "required": ["status"], "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "status": {"enum": ["specified", "not_specified", "unknown"], "type": "string"}, "details": {"type": ["string", "null"]}}, "additionalProperties": false}, "checklist": {"type": "object", "required": ["entity_id", "text", "status", "stage"], "properties": {"text": {"type": "string", "minLength": 1}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "stage": {"enum": ["unspecified", "recruitment", "doctoral_admission", "after_selection", "interview", "offer", "enrolment", "other"], "type": "string"}, "status": {"enum": ["required", "optional", "conditional", "preferred", "recommended", "desired", "advantageous", "unspecified"], "type": "string"}, "entity_id": {"type": "string", "minLength": 1}, "max_pages": {"type": ["number", "null"]}, "max_words": {"type": ["number", "null"]}, "conditions": {"type": "array", "items": {"type": "string"}}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}, "file_formats": {"type": "array", "items": {"type": "string"}}}, "additionalProperties": false}, "assessment": {"type": "object", "anyOf": [{"properties": {"score": {"type": "number"}, "summary": {"type": "string", "pattern": "\\\\S", "minLength": 1}}}, {"properties": {"score": {"const": null}}}], "required": ["score", "scale_min", "scale_max", "summary"], "properties": {"gaps": {"type": "array", "items": {"type": "string"}}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "summary": {"type": ["string", "null"]}, "scale_max": {"type": "number", "const": 10}, "scale_min": {"type": "number", "const": 0}, "subscores": {"type": "object", "additionalProperties": {"type": "number", "maximum": 10, "minimum": 0}}}, "additionalProperties": false}, "background": {"type": "object", "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "summary": {"type": ["string", "null"]}, "evidence": {"type": "array", "items": {"type": "string"}}, "limitations": {"type": "array", "items": {"type": "string"}}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}}, "additionalProperties": false}, "verification": {"type": "object", "properties": {"notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "role_verified": {"type": ["boolean", "null"]}, "identity_verified": {"type": ["boolean", "null"]}, "supervision_confirmed": {"type": ["boolean", "null"]}}, "additionalProperties": false}, "focus_profile": {"type": "object", "required": ["entity_id", "name"], "properties": {"name": {"type": "string", "minLength": 1}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "topics": {"type": "array", "items": {"type": "string"}}, "methods": {"type": "array", "items": {"type": "string"}}, "summary": {"type": ["string", "null"]}, "entity_id": {"type": "string", "minLength": 1}, "checked_at": {"type": ["string", "null"]}, "source_urls": {"type": "array", "items": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}}, "researcher_id": {"type": ["string", "null"]}}, "additionalProperties": false}, "living_standard": {"type": "object", "required": ["version", "housing_baseline", "assessed_at", "confidence", "summary", "salary_basis", "budget_basis", "factors", "sources"], "properties": {"factors": {"type": "object", "required": ["affordability", "housing", "culture", "nature", "student_life", "climate"], "properties": {"nature": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}, "climate": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}, "culture": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}, "housing": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}, "student_life": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}, "affordability": {"type": "object", "required": ["score", "reason"], "properties": {"score": {"type": ["number", "null"], "maximum": 10, "minimum": 0}, "reason": {"type": "string"}}, "additionalProperties": false}}, "additionalProperties": false}, "sources": {"type": "array", "items": {"type": "object", "required": ["title", "url"], "properties": {"url": {"type": "string", "pattern": "^https?://[^\\\\s]+$"}, "title": {"type": "string"}}, "additionalProperties": false}}, "summary": {"type": "string"}, "version": {"const": 1}, "confidence": {"enum": ["low", "medium", "high"], "type": "string"}, "assessed_at": {"type": "string", "format": "date"}, "budget_basis": {"type": "string"}, "funding_note": {"type": "string"}, "salary_basis": {"type": "string"}, "housing_baseline": {"enum": ["shared_flat", "private_apartment"], "type": "string"}}, "additionalProperties": false}, "money_component": {"type": "object", "required": ["entity_id", "label"], "properties": {"max": {"type": ["number", "null"]}, "min": {"type": ["number", "null"]}, "gross": {"type": ["boolean", "null"]}, "label": {"type": "string", "minLength": 1}, "model": {"type": ["string", "null"]}, "notes": {"type": "array", "items": {"$ref": "#/$defs/fact"}}, "amount": {"type": ["number", "null"]}, "period": {"enum": ["hour", "day", "week", "month", "year", "contract", null], "type": ["string", "null"]}, "currency": {"type": ["string", "null"], "pattern": "^[A-Z]{3}$"}, "condition": {"type": ["string", "null"]}, "entity_id": {"type": "string", "minLength": 1}}, "additionalProperties": false}}, "title": "Canonical opportunity payload v6", "$schema": "https://json-schema.org/draft/2020-12/schema", "required": ["opportunity_key", "title", "last_checked_at", "sources"], "properties": {"city": {"type": ["string", "null"]}, "data": {"$ref": "#/$defs/data"}, "unit": {"type": ["string", "null"]}, "title": {"type": "string", "maxLength": 2000, "minLength": 1}, "salary": {"$ref": "#/$defs/salary"}, "topics": {"type": "array", "items": {"type": "string"}}, "country": {"type": ["string", "null"]}, "sources": {"type": "array", "items": {"$ref": "#/$defs/source"}}, "contacts": {"type": "array", "items": {"$ref": "#/$defs/person"}}, "deadline": {"type": ["string", "null"], "format": "date"}, "source_url": {"type": ["string", "null"], "pattern": "^https?://[^\\\\s]+$"}, "start_date": {"type": ["string", "null"], "format": "date"}, "vacancy_id": {"type": ["string", "null"]}, "institution": {"type": ["string", "null"]}, "supervisors": {"type": "array", "items": {"$ref": "#/$defs/person"}}, "availability": {"type": ["string", "null"]}, "official_url": {"type": ["string", "null"], "pattern": "^https?://[^\\\\s]+$"}, "personal_fit": {"$ref": "#/$defs/assessment"}, "requirements": {"type": "array", "items": {"$ref": "#/$defs/checklist"}}, "position_type": {"type": ["string", "null"]}, "open_questions": {"type": "array", "items": {"type": "string"}}, "source_context": {"type": ["string", "null"]}, "application_url": {"type": ["string", "null"], "pattern": "^(https?://[^\\\\s]+|mailto:[^\\\\s@?]+@[^\\\\s@?]+(?:\\\\?[^\\\\s]*)?)$"}, "last_checked_at": {"type": ["string", "null"], "format": "date-time"}, "opportunity_key": {"type": "string", "maxLength": 2000, "minLength": 1}, "duration_details": {"type": ["string", "null"]}, "research_summary": {"type": ["string", "null"], "description": "Describe the factual project and end with a concise Unique selling points section containing its distinguishing features and specific fit rationale. Do not repeat the description or invent applicant qualifications."}, "deadline_timezone": {"type": ["string", "null"], "format": "opportunity-timezone"}, "required_documents": {"type": "array", "items": {"$ref": "#/$defs/checklist"}}, "verification_level": {"type": "string"}, "deadline_time_local": {"type": ["string", "null"], "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"}, "rd_career_potential": {"$ref": "#/$defs/assessment"}, "supervisor_reputation": {"$ref": "#/$defs/background"}, "supervisor_top_papers": {"type": "array", "items": {"$ref": "#/$defs/paper"}}, "deadline_original_text": {"type": ["string", "null"]}, "hardware_software_balance": {"$ref": "#/$defs/balance"}, "research_career_potential": {"$ref": "#/$defs/assessment"}, "supervisor_research_focus": {"$ref": "#/$defs/focus"}}, "x-server-generated": ["entity_id", "source_id"], "x-canonical-version": 6, "additionalProperties": false}'::jsonb$_$;

-- private.project_opportunity_feedback(uuid, uuid)
CREATE FUNCTION private.project_opportunity_feedback(p_user_id uuid, p_opportunity_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select public.project_opportunity_feedback_preview(p_user_id,p_opportunity_id)
$$;

-- private.refresh_opportunity_feedback_prediction_proofs(uuid, uuid)
CREATE FUNCTION private.refresh_opportunity_feedback_prediction_proofs(p_run_id uuid, p_item_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare owner_id uuid;
begin
  if current_user<>'postgres' then raise exception 'Management proof verification required' using errcode='42501';end if;
  for owner_id in select distinct user_id from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id loop
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id;
  end loop;
  delete from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id;
  insert into public.opportunity_feedback_prediction_proofs(user_id,opportunity_id,source_kind,source_ref,run_id,item_id,
    score,scale_min,scale_max,recorded_at,verified_at)
  select r.user_id,r.opportunity_id,'historical_snapshot','opportunity-search-receipt:'||r.run_id::text||':'||r.item_id::text,r.run_id,r.item_id,
    case when jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number' then (a.after_snapshot#>>'{personal_fit,score}')::numeric end,0,10,a.recorded_at,r.verified_at
    from public.opportunity_search_receipts r join auth.users owner on owner.id=r.user_id
    join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=r.user_id
    join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=r.opportunity_id
    where r.run_id=p_run_id and r.item_id=p_item_id and r.verified_at is not null and isfinite(r.verified_at)
      and a.rolled_back_at is null and isfinite(a.recorded_at)
      and jsonb_typeof(a.after_snapshot->'personal_fit')='object' and jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number'
      and a.after_snapshot#>'{personal_fit,scale_min}'='0'::jsonb and a.after_snapshot#>'{personal_fit,scale_max}'='10'::jsonb
      and case when jsonb_typeof(a.after_snapshot#>'{personal_fit,score}')='number' then (a.after_snapshot#>>'{personal_fit,score}')::numeric end between 0 and 10;
  insert into public.opportunity_feedback_prediction_proofs(user_id,opportunity_id,source_kind,source_ref,run_id,item_id,discovery_id,
    score,scale_min,scale_max,recorded_at,verified_at)
  select d.user_id,d.opportunity_id,'discovery_assessment','opportunity-discovery-assessment:'||d.discovery_id::text,d.run_id,d.item_id,d.discovery_id,
    d.assessment_score,0,10,d.assessment_recorded_at,d.assessment_verified_at
    from public.opportunity_search_discoveries d join auth.users owner on owner.id=d.user_id
    join public.opportunity_search_receipts r on r.run_id=d.run_id and r.item_id=d.item_id
      and r.user_id=d.user_id and r.opportunity_id=d.opportunity_id
    join public.opportunity_search_runs run on run.id=r.run_id and run.user_id=d.user_id and run.search_id=d.search_id and run.protocol_version=d.assessment_version
    join private.opportunity_search_merge_audit a on a.run_id=r.run_id and a.item_id=r.item_id and a.opportunity_id=d.opportunity_id
    where d.run_id=p_run_id and d.item_id=p_item_id and r.verified_at is not null and isfinite(r.verified_at)
      and d.assessment_verified_at=r.verified_at and a.rolled_back_at is null and d.assessment_recorded_at=a.recorded_at
      and isfinite(d.assessment_recorded_at) and d.original_assessment=r.payload->'personal_fit'
      and jsonb_typeof(d.original_assessment)='object' and jsonb_typeof(d.original_assessment->'score')='number'
      and d.original_assessment->'scale_min'='0'::jsonb and d.original_assessment->'scale_max'='10'::jsonb
      and d.original_assessment->'score'=to_jsonb(d.assessment_score)
      and d.assessment_score between 0 and 10 and d.assessment_scale_min=0 and d.assessment_scale_max=10;
  for owner_id in select distinct user_id from public.opportunity_feedback_prediction_proofs where run_id=p_run_id and item_id=p_item_id loop
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id;
  end loop;
end;
$$;

-- private.retain_successful_opportunity_source(uuid, uuid, uuid, text, uuid)
CREATE FUNCTION private.retain_successful_opportunity_source(p_user_id uuid, p_search_id uuid, p_opportunity_id uuid, p_listing_url text, p_registry_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare settings public.opportunity_search_adaptive_settings;metric jsonb;url text;checked timestamptz;source record;saved public.opportunity_search_sources;
begin
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id;
  if not found or not settings.adaptation_enabled or settings.adaptation_paused
    or not settings.successful_source_reuse_enabled then return null; end if;
  metric:=private.opportunity_interest_metric(p_user_id,p_opportunity_id);
  if metric->>'interest_origin'='excluded' or not ((metric->>'interest_origin' in ('categorical_review','application') and (metric->>'interest_score')::numeric>=8)
    or coalesce((metric->>'confirmed_submission')::boolean,false)) then return null; end if;
  url:=private.opportunity_feedback_safe_url(p_listing_url);
  if url is null then raise exception 'Use an evidenced public reusable listing URL' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':source:'||url,0));
  -- Effective title evidence must bind the current title. The historical source
  -- log can contain rejected claims and cannot establish listing authority.
  select max(private.opportunity_feedback_time(e.value->>'checked_at')) into checked
    from private.opportunity_search_merge_state state join public.opportunities o on o.id=state.opportunity_id
    cross join lateral jsonb_array_elements(coalesce(state.fields#>array['/title','evidence'],'[]'::jsonb)) e
    where o.id=p_opportunity_id and state.fields#>array['/title','value']=to_jsonb(o.title)
      and e.value->>'kind'='official_listing' and e.value->>'precision'='instant'
      and private.opportunity_feedback_safe_url(e.value->>'url')=url
      and private.opportunity_feedback_time(e.value->>'checked_at')<=clock_timestamp();
  if checked is null then return null; end if;
  if p_registry_id is not null then
    select * into saved from public.opportunity_search_sources where registry_id=p_registry_id and user_id=p_user_id and search_id=p_search_id for update;
    if not found then raise exception 'Source unavailable' using errcode='42501'; end if;
    if saved.listing_url is not null and saved.listing_url<>url then raise exception 'The verified listing belongs to a different registry entry' using errcode='22023'; end if;
    if saved.listing_url is null and (saved.vacancy_url is null or not exists(
      select 1 from public.opportunities o cross join lateral(values('official_url',o.official_url),('source_url',o.source_url),('application_url',o.application_url)) v(field,url)
      where o.id=p_opportunity_id and o.data#>>array['url_roles',v.field]='vacancy' and private.opportunity_feedback_safe_url(v.url)=saved.vacancy_url)) then
      return null;
    end if;
  else select * into saved from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id and listing_url=url for update;
  end if;
  if saved.owner_disabled then return to_jsonb(saved); end if;
  if saved.registry_id is null then
    insert into public.opportunity_search_sources(user_id,search_id,listing_url,enabled,kind,provenance,listing_verified_at,status,check_interval_hours)
      values(p_user_id,p_search_id,url,true,'other','evidenced_listing',checked,'ready',settings.reuse_check_interval_hours) returning * into saved;
  else
    update public.opportunity_search_sources set listing_url=url,enabled=true,listing_verified_at=greatest(listing_verified_at,checked),
      status=case when status='pending_identification' then 'ready' else status end,
      provenance=case when provenance='candidate' then 'evidenced_listing' else provenance end,
      check_interval_hours=case when (status='pending_identification' or not enabled and provenance='evidenced_listing'
        and last_attempted_at is null and last_successful_at is null) and not pinned and not mandatory and provenance<>'explicit'
        then settings.reuse_check_interval_hours else check_interval_hours end
      where registry_id=saved.registry_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

-- private.seed_opportunity_institution_sources(uuid, uuid)
CREATE FUNCTION private.seed_opportunity_institution_sources(p_user_id uuid, p_search_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare settings public.opportunity_search_adaptive_settings;source jsonb;total integer;retained integer;requested integer:=7;
begin
  if current_user<>'postgres' or not exists(select 1 from public.opportunity_search_templates where user_id=p_user_id and id=p_search_id) then
    raise exception 'Management source configuration requires an authorized search' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_search_id::text||':institution-sources',0));
  insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(p_user_id,p_search_id) on conflict do nothing;
  select * into settings from public.opportunity_search_adaptive_settings where user_id=p_user_id and search_id=p_search_id for update;
  if not settings.institution_sources_seeded then
    select count(*) into total from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id;
    for source in select value from jsonb_array_elements(public.opportunity_institution_source_configuration()) loop
      if exists(select 1 from public.opportunity_search_sources where user_id=p_user_id and search_id=p_search_id and listing_url=source->>'listing_url') then continue;end if;
      if total>=64 then continue;end if;
      insert into public.opportunity_search_sources(user_id,search_id,listing_url,kind,institution,priority,enabled,pinned,mandatory,check_interval_hours,provenance,status)
        values(p_user_id,p_search_id,source->>'listing_url','university',source->>'institution',50,true,false,false,settings.reuse_check_interval_hours,'explicit','ready')
        on conflict(user_id,search_id,listing_url) where listing_url is not null do nothing;
      if found then total:=total+1;end if;
    end loop;
  end if;
  select count(*) into retained from public.opportunity_search_sources s
    join jsonb_array_elements(public.opportunity_institution_source_configuration()) configured on configured->>'listing_url'=s.listing_url
    where s.user_id=p_user_id and s.search_id=p_search_id;
  update public.opportunity_search_adaptive_settings set institution_sources_seeded=true,institution_sources_omitted=requested-retained
    where user_id=p_user_id and search_id=p_search_id;
  return jsonb_build_object('requested',requested,'retained',retained,'omitted',requested-retained);
end;
$$;

-- public.job_workspace_adaptation_settings()
CREATE FUNCTION public.job_workspace_adaptation_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare changed boolean;
begin
  if tg_op='INSERT' then
    new.adaptation_revision:=case when new.adaptation_enabled or new.adaptation_paused then 1 else 0 end;
  else
    changed:=(new.adaptation_enabled,new.adaptation_paused) is distinct from (old.adaptation_enabled,old.adaptation_paused);
    new.adaptation_revision:=old.adaptation_revision+case when changed then 1 else 0 end;
    if changed then new.feedback_dirty:=true;new.query_plan_dirty:=true;end if;
  end if;
  return new;
end;
$$;

-- public.job_workspace_assessment_invalidate_feedback()
CREATE FUNCTION public.job_workspace_assessment_invalidate_feedback() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='DELETE' then
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=old.user_id;
  elsif (new.verified_at,new.assessment_verified_at) is distinct from (old.verified_at,old.assessment_verified_at) then
    update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=new.user_id;
  end if;
  return null;
end;
$$;

-- public.job_workspace_breadth_settings()
CREATE FUNCTION public.job_workspace_breadth_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then new.breadth_revision:=case when new.search_breadth_percent=20 then 0 else 1 end;
  else
    new.breadth_revision:=old.breadth_revision+case when new.search_breadth_percent is distinct from old.search_breadth_percent then 1 else 0 end;
    if new.search_breadth_percent is distinct from old.search_breadth_percent then new.query_plan_dirty:=true;end if;
  end if;
  return new;
end;
$$;

-- public.job_workspace_dashboard_action()
CREATE FUNCTION public.job_workspace_dashboard_action() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare s public.opportunity_search_adaptive_settings;source_row public.opportunity_search_sources;key text;expected_keys text[]:='{}';expected_source bigint;
begin
  if tg_op<>'INSERT' then raise exception 'Control receipts are immutable' using errcode='23514';end if;
  if auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Search unavailable' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  if jsonb_typeof(new.patch) is distinct from 'object' or new.patch='{}'::jsonb or octet_length(new.patch::text)>8192
    or jsonb_typeof(new.expected_revisions) is distinct from 'object' then raise exception 'Invalid control patch' using errcode='22023';end if;
  if new.kind='settings' then
    if new.registry_id is not null or new.patch-array['adaptation_enabled','adaptation_paused','successful_source_reuse_enabled','reuse_check_interval_hours','search_breadth_percent']<>'{}'::jsonb then
      raise exception 'Invalid settings patch' using errcode='22023';end if;
    for key in select jsonb_object_keys(new.patch) loop
      if key not in('reuse_check_interval_hours','search_breadth_percent') and jsonb_typeof(new.patch->key) is distinct from 'boolean' then raise exception 'Explicit boolean settings required' using errcode='22023';end if;
    end loop;
    if new.patch?'reuse_check_interval_hours' and (jsonb_typeof(new.patch->'reuse_check_interval_hours') is distinct from 'number'
      or(new.patch->>'reuse_check_interval_hours')::numeric not between 24 and 720
      or(new.patch->>'reuse_check_interval_hours')::numeric<>trunc((new.patch->>'reuse_check_interval_hours')::numeric)) then
      raise exception 'Cadence must be 24 to 720 hours' using errcode='22023';end if;
    if new.patch?'search_breadth_percent' and (jsonb_typeof(new.patch->'search_breadth_percent') is distinct from 'number'
      or(new.patch->>'search_breadth_percent')::numeric not between 0 and 100
      or(new.patch->>'search_breadth_percent')::numeric<>trunc((new.patch->>'search_breadth_percent')::numeric)
      or(new.patch->>'search_breadth_percent')::numeric%5<>0) then
      raise exception 'Search breadth must be 0 to 100 percent in steps of 5' using errcode='22023';end if;
    if new.patch?'search_breadth_percent' then expected_keys:=array_append(expected_keys,'breadth_revision');end if;
    if new.patch?|array['adaptation_enabled','adaptation_paused'] then expected_keys:=array_append(expected_keys,'adaptation_revision');end if;
    if new.patch?|array['successful_source_reuse_enabled','reuse_check_interval_hours'] then expected_keys:=array_append(expected_keys,'source_reuse_revision');end if;
    if new.expected_revisions-expected_keys<>'{}'::jsonb or not(new.expected_revisions?&expected_keys) then raise exception 'Use only touched setting revisions' using errcode='22023';end if;
    foreach key in array expected_keys loop
      if jsonb_typeof(new.expected_revisions->key) is distinct from 'number' or new.expected_revisions->>key!~'^[0-9]{1,18}$' then
        raise exception 'Expected revisions must be nonnegative integers' using errcode='22023';end if;
    end loop;
    insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(new.user_id,new.search_id) on conflict(user_id,search_id) do nothing;
    select * into s from public.opportunity_search_adaptive_settings where user_id=new.user_id and search_id=new.search_id for update;
    if new.patch?'search_breadth_percent' and(new.expected_revisions->>'breadth_revision')::bigint<>s.breadth_revision
      or new.patch?|array['adaptation_enabled','adaptation_paused'] and(new.expected_revisions->>'adaptation_revision')::bigint<>s.adaptation_revision
      or new.patch?|array['successful_source_reuse_enabled','reuse_check_interval_hours'] and(new.expected_revisions->>'source_reuse_revision')::bigint<>s.source_reuse_revision then
      raise exception 'Settings changed; reload the current revision' using errcode='40001';end if;
    -- One UPDATE preserves a consistent adaptation/source policy.
    update public.opportunity_search_adaptive_settings set
      search_breadth_percent=coalesce((new.patch->>'search_breadth_percent')::integer,search_breadth_percent),
      adaptation_enabled=coalesce((new.patch->>'adaptation_enabled')::boolean,adaptation_enabled),
      adaptation_paused=coalesce((new.patch->>'adaptation_paused')::boolean,adaptation_paused),
      successful_source_reuse_enabled=coalesce((new.patch->>'successful_source_reuse_enabled')::boolean,successful_source_reuse_enabled),
      reuse_check_interval_hours=coalesce((new.patch->>'reuse_check_interval_hours')::integer,reuse_check_interval_hours)
      where user_id=new.user_id and search_id=new.search_id;
    new.result:=jsonb_build_object('dashboard_version',1,'action_id',new.action_id,'search_id',new.search_id,'kind','settings',
      'settings',public.opportunity_search_dashboard_settings(new.user_id,new.search_id));
  elsif new.kind='source' then
    if new.registry_id is null or new.expected_revisions-array['source_revision']<>'{}'::jsonb
      or jsonb_typeof(new.expected_revisions->'source_revision') is distinct from 'number'
      or new.expected_revisions->>'source_revision'!~'^[0-9]{1,18}$' then raise exception 'Expected source revision required' using errcode='22023';end if;
    expected_source:=(new.expected_revisions->>'source_revision')::bigint;
    select * into source_row from public.opportunity_search_sources where registry_id=new.registry_id and user_id=new.user_id and search_id=new.search_id for update;
    if coalesce(source_row.source_revision,0)<>expected_source then raise exception 'Source changed; reload its current revision' using errcode='40001';end if;
    perform public.save_opportunity_search_source(new.search_id,new.registry_id,new.patch);
    select * into source_row from public.opportunity_search_sources where registry_id=new.registry_id and user_id=new.user_id and search_id=new.search_id;
    new.result:=jsonb_build_object('dashboard_version',1,'action_id',new.action_id,'search_id',new.search_id,'kind','source','source',public.opportunity_search_dashboard_source(source_row));
  else raise exception 'Invalid control action' using errcode='22023';end if;
  new.created_at:=clock_timestamp();return new;
end;
$_$;

-- public.job_workspace_discovery_immutable()
CREATE FUNCTION public.job_workspace_discovery_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (to_jsonb(new)-array['verified_at','assessment_verified_at','assessment_score','assessment_scale_min','assessment_scale_max'])
    is distinct from (to_jsonb(old)-array['verified_at','assessment_verified_at','assessment_score','assessment_scale_min','assessment_scale_max']) then
    raise exception 'Original discovery assessments and attribution are immutable' using errcode='23514'; end if;
  if new.verified_at is not null and not exists(select 1 from public.opportunity_search_receipts r join private.opportunity_search_merge_audit a
    on a.run_id=r.run_id and a.item_id=r.item_id where r.run_id=new.run_id and r.item_id=new.item_id and r.user_id=new.user_id
      and r.opportunity_id=new.opportunity_id and r.verified_at=new.verified_at and a.rolled_back_at is null) then
    raise exception 'Canonical verification is unavailable' using errcode='23514'; end if;
  if new.assessment_verified_at is not null and (new.original_assessment is null or new.assessment_verified_at is distinct from new.verified_at) then
    raise exception 'Assessment verification requires exact canonical proof' using errcode='23514'; end if;
  return new;
end;
$$;

-- public.job_workspace_evaluation_revision()
CREATE FUNCTION public.job_workspace_evaluation_revision() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then new.evaluation_revision:=case when new.comment is null then 0 else 1 end;
  else new.evaluation_revision:=old.evaluation_revision+case when new.comment is distinct from old.comment then 1 else 0 end;end if;
  return new;
end $$;

-- public.job_workspace_execution_immutable()
CREATE FUNCTION public.job_workspace_execution_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin raise exception 'Execution audit records are immutable' using errcode='23514';end;
$$;

-- public.job_workspace_feedback_invalidation()
CREATE FUNCTION public.job_workspace_feedback_invalidation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare owner_id uuid;target_search uuid;semantic boolean:=false;privacy boolean:=false;redact_aggregate_context boolean:=false;
begin
  if tg_table_name='opportunity_reviews' then
    if tg_op='DELETE' then
      owner_id:=old.user_id;
      semantic:=old.comment is not null or old.manually_archived or old.technical_issue_category is not null
        or old.state<>'unreviewed' or old.interest_rating is not null or old.interest_reasons<>'[]'::jsonb or old.feedback_excluded;
      privacy:=semantic;redact_aggregate_context:=semantic;
    elsif tg_op='INSERT' then
      owner_id:=new.user_id;
      semantic:=new.comment is not null or new.manually_archived or new.technical_issue_category is not null
        or new.state<>'unreviewed' or new.interest_rating is not null or new.interest_reasons<>'[]'::jsonb or new.feedback_excluded;
      privacy:=new.feedback_excluded;redact_aggregate_context:=new.feedback_excluded;
    else
      owner_id:=new.user_id;
      semantic:=(new.comment,new.manually_archived,new.technical_issue_category,new.state,new.interest_rating,new.interest_reasons,new.feedback_excluded,new.prediction_baseline)
        is distinct from(old.comment,old.manually_archived,old.technical_issue_category,old.state,old.interest_rating,old.interest_reasons,old.feedback_excluded,old.prediction_baseline);
      privacy:=new.feedback_excluded or new.comment is distinct from old.comment;
      redact_aggregate_context:=new.feedback_excluded and not old.feedback_excluded;
    end if;
  elsif tg_table_name='applications' then
    if tg_op='DELETE' then owner_id:=old.user_id;semantic:=true;
    elsif tg_op='INSERT' then owner_id:=new.user_id;semantic:=true;
    else owner_id:=new.user_id;
      semantic:=(new.submitted_at,new.status='submitted',jsonb_path_query_array(new.status_history,'$[*] ? (@.status == "submitted")'))
        is distinct from(old.submitted_at,old.status='submitted',jsonb_path_query_array(old.status_history,'$[*] ? (@.status == "submitted")'));end if;
  end if;
  if semantic then update public.opportunity_search_adaptive_settings set feedback_dirty=true where user_id=owner_id and(target_search is null or search_id=target_search);end if;
  if privacy then
    update public.opportunity_search_feedback_snapshots s set packet=s.packet||'{"privacy_scope_changed":true}'::jsonb,
      redact_aggregates=s.redact_aggregates or redact_aggregate_context
    where s.user_id=owner_id and(target_search is null or s.search_id=target_search)
      and exists(select 1 from public.opportunity_search_adaptive_settings parent where parent.user_id=s.user_id and parent.search_id=s.search_id);
  end if;
  return null;
end $_$;

-- public.job_workspace_feedback_pin_guard()
CREATE FUNCTION public.job_workspace_feedback_pin_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then
    if current_user<>'postgres' then new.feedback_snapshot_revision:=null; new.feedback_input_fingerprint:=null; end if;
  elsif old.feedback_snapshot_revision is not null or current_user<>'postgres' then
    new.feedback_snapshot_revision:=old.feedback_snapshot_revision; new.feedback_input_fingerprint:=old.feedback_input_fingerprint;
  end if;
  return new;
end;
$$;

-- public.job_workspace_feedback_revision()
CREATE FUNCTION public.job_workspace_feedback_revision() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare reason jsonb; normalized jsonb := '[]'::jsonb; target text; changed boolean; baseline_changed boolean; server_pinned boolean := false; old_baseline_null boolean; observed_baseline jsonb;
begin
  if tg_op = 'UPDATE' and (new.user_id, new.opportunity_id) is distinct from (old.user_id, old.opportunity_id) then
    raise exception 'Opportunity review identity is immutable' using errcode = '23514';
  end if;
  if jsonb_typeof(new.interest_reasons) is distinct from 'array' or jsonb_array_length(new.interest_reasons) > 24 then
    raise exception 'Interest reasons must be an array of at most 24 tags' using errcode = '23514';
  end if;
  for reason in select value from jsonb_array_elements(new.interest_reasons) loop
    if jsonb_typeof(reason) <> 'object'
      or reason - array['category','polarity','target'] <> '{}'::jsonb
      or not (reason ?& array['category','polarity'])
      or jsonb_typeof(reason->'category') <> 'string' or jsonb_typeof(reason->'polarity') <> 'string'
      or reason->>'category' not in ('topic','method','hardware','location','funding','timing','background_fit','project_context','requirements','availability','other')
      or reason->>'polarity' not in ('positive','negative')
      or reason->>'category' in ('requirements','availability') and reason->>'polarity'<>'negative' then
      raise exception 'Invalid structured interest reason' using errcode = '23514';
    end if;
    if reason ? 'target' then
      target := btrim(reason->>'target');
      if reason->>'category' not in ('topic','method') or jsonb_typeof(reason->'target') <> 'string'
        or target = '' or char_length(target) > 120
        or reason->>'target' ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || ']') then
        raise exception 'Only topic/method reasons may have an explicit target (1–120 characters)' using errcode = '23514';
      end if;
      reason := jsonb_set(reason, '{target}', to_jsonb(target));
    end if;
    normalized := normalized || jsonb_build_array(reason);
  end loop;
  select coalesce(jsonb_agg(value order by value->>'category' collate "C", value->>'polarity' collate "C",
    coalesce(value->>'target','') collate "C"), '[]'::jsonb) into new.interest_reasons
    from (select distinct value from jsonb_array_elements(normalized)) reasons;

  if tg_op = 'INSERT' then
    changed := new.state <> 'unreviewed' or new.interest_rating is not null
      or new.interest_reasons <> '[]'::jsonb or new.feedback_excluded;
    new.feedback_revision := case when changed then 1 else 0 end;
    new.feedback_updated_at := case when changed then clock_timestamp() else null end;
    baseline_changed := new.prediction_baseline is not null;
    old_baseline_null := true;
  else
    changed := (new.state, new.interest_rating, new.interest_reasons, new.feedback_excluded)
      is distinct from (old.state, old.interest_rating, old.interest_reasons, old.feedback_excluded);
    new.feedback_revision := old.feedback_revision + case when changed then 1 else 0 end;
    new.feedback_updated_at := case when changed then clock_timestamp() else old.feedback_updated_at end;
    baseline_changed := new.prediction_baseline is distinct from old.prediction_baseline;
    old_baseline_null := old.prediction_baseline is null;
  end if;
  -- A supplied baseline is never accepted from a browser, even if it resembles
  -- a known assessment. Only this trigger can select the protected owner row.
  if baseline_changed and current_user <> 'postgres' then
    raise exception 'Prediction baselines require established management-verified provenance' using errcode = '42501';
  end if;
  if changed and old_baseline_null and new.prediction_baseline is null and not new.feedback_excluded
    and (new.interest_rating is not null or new.state <> 'unreviewed') and current_user in ('postgres','authenticated') then
    select jsonb_build_object('user_id',d.user_id,'opportunity_id',d.opportunity_id,'score',d.assessment_score,
      'scale_min',0,'scale_max',10,'predicted_at',d.assessment_recorded_at,'source_kind','discovery_assessment',
      'source_ref','opportunity-discovery-assessment:'||d.discovery_id::text) into observed_baseline
    from public.opportunity_search_discoveries d
    where d.user_id=new.user_id and d.opportunity_id=new.opportunity_id and d.assessment_verified_at is not null
      and d.assessment_recorded_at<=new.feedback_updated_at and d.assessment_verified_at<=new.feedback_updated_at
      and d.assessment_score between 0 and 10 and d.assessment_scale_min=0 and d.assessment_scale_max=10
    order by d.assessment_recorded_at,d.discovery_id limit 1;
    if observed_baseline is not null then
      new.prediction_baseline:=observed_baseline; baseline_changed:=true; server_pinned:=true;
    end if;
  end if;
  if baseline_changed then
    if current_user <> 'postgres' and not server_pinned then
      raise exception 'Prediction baselines require established management-verified provenance' using errcode = '42501';
    end if;
    if not changed then
      raise exception 'A prediction baseline is frozen for its feedback revision' using errcode = '23514';
    end if;
    -- Keep the private helper in a separate PL/pgSQL statement. PostgreSQL
    -- checks EXECUTE while planning an expression even when an AND operand
    -- would short-circuit; authenticated automatic pins must never plan it.
    if not server_pinned then
      if new.prediction_baseline is not null and not private.opportunity_feedback_baseline_matches(
        new.prediction_baseline, new.user_id, new.opportunity_id,
        new.feedback_updated_at
      ) then
        raise exception 'Original prediction provenance unavailable or inconsistent' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- public.job_workspace_plan_immutable()
CREATE FUNCTION public.job_workspace_plan_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin raise exception 'Query plan revisions are immutable' using errcode='23514'; end;
$$;

-- public.job_workspace_plan_settings()
CREATE FUNCTION public.job_workspace_plan_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then
    new.source_reuse_revision:=case when new.successful_source_reuse_enabled then 1 else 0 end;
    if current_user<>'postgres' then new.query_plan_id:=null;new.query_plan_revision:=0;new.query_plan_dirty:=true; end if;
  else
    new.source_reuse_revision:=old.source_reuse_revision+case when (new.successful_source_reuse_enabled,new.reuse_check_interval_hours)
      is distinct from (old.successful_source_reuse_enabled,old.reuse_check_interval_hours) then 1 else 0 end;
    if current_user<>'postgres' then
      new.query_plan_id:=old.query_plan_id;new.query_plan_revision:=old.query_plan_revision;
      new.query_plan_dirty:=old.query_plan_dirty or coalesce(new.query_plan_dirty,true);
    end if;
    if new.feedback_dirty and not old.feedback_dirty or new.feedback_revision is distinct from old.feedback_revision then new.query_plan_dirty:=true; end if;
  end if;
  return new;
end;
$$;

-- public.job_workspace_preference_action()
CREATE FUNCTION public.job_workspace_preference_action() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare proposal public.opportunity_search_preference_suggestions; current_doc jsonb; rules jsonb; current_revision bigint; state text; prior_rule jsonb;restore jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'Preference decisions are immutable' using errcode='23514';end if;
  -- Management research can propose, but it cannot approve its own proposal.
  if current_user<>'authenticated' or auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Preference decisions require an explicit signed-in owner action' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  current_doc:=public.opportunity_search_preference_document(new.user_id,new.search_id);current_revision:=(current_doc->>'preference_revision')::bigint;rules:=current_doc->'approved_rules';
  if new.expected_revision is distinct from current_revision then raise exception 'Approved preferences changed; refresh before deciding' using errcode='40001';end if;
  select * into proposal from public.opportunity_search_preference_suggestions where user_id=new.user_id and search_id=new.search_id and suggestion_id=new.suggestion_id;
  if not found then raise exception 'Suggestion unavailable' using errcode='42501';end if;
  select case action when 'approve' then 'approved' when 'reject' then 'rejected' else 'undone' end into state from public.opportunity_search_preference_actions
    where user_id=new.user_id and search_id=new.search_id and suggestion_id=new.suggestion_id order by sequence desc limit 1;
  state:=coalesce(state,'pending');
  select r into prior_rule from jsonb_array_elements(rules) r where r->>'rule_id'=proposal.rule->>'rule_id';
  new.replaced_rules:='[]';
  if new.action='approve' then
    perform public.opportunity_search_validate_preference_rule(new.user_id,new.search_id,proposal.rule,false);
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into new.replaced_rules from jsonb_array_elements(rules) r
      where r->>'rule_id'=proposal.rule->>'rule_id' or r->>'kind'='emphasis' and proposal.rule->>'kind'='emphasis'
        and r->>'category'=proposal.rule->>'category'
        and translate(btrim(r->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(btrim(proposal.rule->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into rules from (
      select r from jsonb_array_elements(rules) r where not exists(select 1 from jsonb_array_elements(new.replaced_rules) replaced where replaced=r)
      union all select proposal.rule) approved;
    if jsonb_array_length(rules)>32 then raise exception 'Keep at most 32 approved preference rules' using errcode='22023';end if;
  elsif new.action='reject' then
    if state='approved' then raise exception 'Undo an approved rule explicitly' using errcode='22023';end if;
  elsif new.action='undo' then
    if state<>'approved' or prior_rule is distinct from proposal.rule then raise exception 'This decision no longer owns the active rule' using errcode='40001';end if;
    select replaced_rules into restore from public.opportunity_search_preference_actions where user_id=new.user_id and search_id=new.search_id
      and suggestion_id=new.suggestion_id and action='approve' and preference_revision>expected_revision order by sequence desc limit 1;
    if not found then raise exception 'This suggestion has no effective approval to undo' using errcode='40001';end if;
    if exists(select 1 from jsonb_array_elements(rules) active cross join jsonb_array_elements(coalesce(restore,'[]')) restored
      where active->>'rule_id'<>proposal.rule->>'rule_id' and (active->>'rule_id'=restored->>'rule_id'
        or active->>'kind'='emphasis' and restored->>'kind'='emphasis' and active->>'category'=restored->>'category'
          and translate(btrim(active->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(btrim(restored->>'target'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))) then
      raise exception 'Undo conflicts with newer explicit owner intent' using errcode='40001';end if;
    select coalesce(jsonb_agg(r order by r->>'rule_id'),'[]') into rules from (
      select r from jsonb_array_elements(rules) r where r->>'rule_id'<>proposal.rule->>'rule_id'
      union all select r from jsonb_array_elements(coalesce(restore,'[]')) r) restored;
  else raise exception 'Use approve, reject or undo' using errcode='22023';end if;
  if jsonb_array_length(rules)>32 then raise exception 'Keep at most 32 approved preference rules' using errcode='22023';end if;
  new.preference_revision:=current_revision+case when rules is distinct from current_doc->'approved_rules' then 1 else 0 end;
  new.approved_rules:=rules;new.document_hash:=encode(sha256(convert_to(rules::text,'UTF8')),'hex');new.recorded_at:=clock_timestamp();
  new.sequence:=nextval('public.opportunity_search_preference_actions_sequence_seq'::regclass);
  return new;
end;
$$;

-- public.job_workspace_preference_invalidation()
CREATE FUNCTION public.job_workspace_preference_invalidation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.preference_revision<>new.expected_revision then
    insert into public.opportunity_search_adaptive_settings(user_id,search_id) values(new.user_id,new.search_id) on conflict do nothing;
    update public.opportunity_search_adaptive_settings set feedback_dirty=true,query_plan_dirty=true where user_id=new.user_id and search_id=new.search_id;
  end if;
  return null;
end;
$$;

-- public.job_workspace_preference_suggestion()
CREATE FUNCTION public.job_workspace_preference_suggestion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op<>'INSERT' then raise exception 'Preference proposals are immutable' using errcode='23514';end if;
  if not exists(select 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id) then raise exception 'Search unavailable' using errcode='42501';end if;
  if current_user='postgres' then new.origin:='runner';
  else
    if auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501';end if;
    new.origin:='owner';
  end if;
  new.rule:=public.opportunity_search_validate_preference_rule(new.user_id,new.search_id,new.rule,new.origin='runner');
  new.rule_hash:=encode(sha256(convert_to(new.rule::text,'UTF8')),'hex');new.created_at:=clock_timestamp();
  return new;
end;
$$;

-- public.job_workspace_query_plan_pin()
CREATE FUNCTION public.job_workspace_query_plan_pin() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='INSERT' then if current_user<>'postgres' then new.query_plan_id:=null; end if;
  elsif current_user<>'postgres' or old.query_plan_id is not null then new.query_plan_id:=old.query_plan_id; end if;
  return new;
end;
$$;

-- public.job_workspace_record_status()
CREATE FUNCTION public.job_workspace_record_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.job_workspace_rollback_request()
CREATE FUNCTION public.job_workspace_rollback_request() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare config public.opportunity_search_runner_config;binding public.opportunity_search_schedule_bindings;current_revision bigint;
begin
  if tg_op<>'INSERT' then raise exception 'Rollback requests are immutable' using errcode='23514';end if;
  if current_user<>'authenticated' or auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Explicit signed-in owner rollback request required' using errcode='42501';end if;
  perform 1 from public.opportunity_search_templates where user_id=new.user_id and id=new.search_id for update;
  if not found then raise exception 'Search unavailable' using errcode='42501';end if;
  if new.rollback_id is null or new.project_ref is null or new.project_ref!~'^[a-z0-9]{20}$' or new.accept_reviewed_fallback is null
    or new.expected_runner_revision is null or new.expected_runner_revision<0 or new.expected_rollback_revision is null or new.expected_rollback_revision<0 then
    raise exception 'Exact rollback scope and revisions required' using errcode='22023';end if;
  select * into config from public.opportunity_search_runner_config where user_id=new.user_id and search_id=new.search_id for update;
  select * into binding from public.opportunity_search_schedule_bindings where user_id=new.user_id and search_id=new.search_id;
  if config.project_ref is distinct from new.project_ref or not exists(select 1 from public.opportunity_search_adaptive_release where singleton and project_ref=new.project_ref)
    then raise exception 'Exact configured project required' using errcode='42501';end if;
  if config.mode is distinct from 'adaptive' or binding.runner_capability is distinct from 'adaptive-batch-v1'
    or not public.adaptive_search_setup_task_id(binding.task_id) or not public.adaptive_search_setup_schedule(binding.schedule) then
    raise exception 'An acknowledged bound adaptive task is required' using errcode='55000';end if;
  if config.migration_requested then raise exception 'Reconcile the pending technical setup before requesting rollback' using errcode='40001';end if;
  if new.rollback_id=config.setup_id or new.rollback_id=binding.confirmed_setup_id then
    raise exception 'Use a fresh stable rollback identity' using errcode='22023';end if;
  if exists(select 1 from public.opportunity_search_setup_claims where user_id=new.user_id and search_id=new.search_id) then
    raise exception 'Reconcile the outstanding setup operation first' using errcode='55000';end if;
  select coalesce(max(r.rollback_revision),0) into current_revision from public.opportunity_search_rollback_requests r where r.user_id=new.user_id and r.search_id=new.search_id;
  if config.revision<>new.expected_runner_revision or current_revision<>new.expected_rollback_revision then
    raise exception 'Rollback intent changed; reload current revisions' using errcode='40001';end if;
  -- Invalidate any older adaptive setup handoff without changing the confirmed
  -- runner mode or task binding. This is explicit workflow intent, never autosave.
  update public.opportunity_search_runner_config set migration_requested=false,setup_id=new.rollback_id
    where user_id=new.user_id and search_id=new.search_id returning revision into new.runner_revision;
  new.rollback_revision:=current_revision+1;
  new.binding_hash:=public.opportunity_search_rollback_binding_hash(new.user_id,new.search_id);
  new.requested_at:=clock_timestamp();return new;
end;
$_$;

-- public.job_workspace_runner_authorization()
CREATE FUNCTION public.job_workspace_runner_authorization() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user<>'authenticated' or auth.uid() is distinct from new.user_id or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Explicit signed-in owner authorization is required' using errcode='42501';end if;
  if tg_op='UPDATE' and(new.user_id,new.search_id) is distinct from(old.user_id,old.search_id) then raise exception 'Authorization scope is immutable' using errcode='23514';end if;
  if not exists(select 1 from public.opportunity_search_adaptive_release where singleton and project_ref=new.project_ref) then
    raise exception 'Configured project binding is required' using errcode='22023';end if;
  if tg_op='INSERT' then new.authorization_epoch:=gen_random_uuid();new.authorization_revision:=case when new.enabled then 1 else 0 end;
  else
    new.authorization_epoch:=old.authorization_epoch;
    new.authorization_revision:=old.authorization_revision+case when(new.enabled,new.project_ref) is distinct from(old.enabled,old.project_ref) then 1 else 0 end;
  end if;
  if new.enabled then
    if tg_op='INSERT' then new.authorized_at:=clock_timestamp();
    elsif not old.enabled or new.project_ref is distinct from old.project_ref then new.authorized_at:=clock_timestamp();else new.authorized_at:=old.authorized_at;end if;
  else new.authorized_at:=null;end if;
  return new;
end;
$$;

-- public.job_workspace_snapshot_redaction()
CREATE FUNCTION public.job_workspace_snapshot_redaction() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare scope_exists boolean;item jsonb;original jsonb;items jsonb:='[]';review record;proof jsonb;
  result jsonb:=old.packet;removed boolean:=false;changed boolean:=false;
begin
  if(new.user_id,new.search_id,new.feedback_revision,new.input_fingerprint,new.created_at)
    is distinct from(old.user_id,old.search_id,old.feedback_revision,old.input_fingerprint,old.created_at) then
    raise exception 'Feedback snapshot identity and audit metadata are immutable' using errcode='23514';end if;
  new.redact_aggregates:=old.redact_aggregates or coalesce(new.redact_aggregates,false);
  select exists(select 1 from public.opportunity_search_adaptive_settings
    where user_id=old.user_id and search_id=old.search_id) into scope_exists;
  if not scope_exists or new.redact_aggregates then
    result:=result||jsonb_build_object('examples','[]'::jsonb,'approved_preferences','[]'::jsonb,
      'aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
      'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
        'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    changed:=new.redact_aggregates or coalesce((old.packet#>>'{counts,eligible}')::bigint,0)>0;
  else
    for original in select value from jsonb_array_elements(coalesce(old.packet->'examples','[]')) loop
      -- Only the current example contract may survive a pinned-packet read.
      select coalesce(jsonb_object_agg(key,value),'{}') into item from jsonb_each(original)
      where key=any(array['opportunity_id','opportunity_key','title','institution','official_url','source_url','research_summary','topics',
        'metric_version','interest_score','interest_origin','interest_gap','baseline_status','original_prediction','feedback_revision','feedback_updated_at',
        'review_state','confirmed_submission','submission_at','reasons','search_feedback_summary','summary_inclusion','manually_archived','technical_issue_category']);
      if item is distinct from original then changed:=true;end if;
      select feedback_excluded,comment,evaluation_revision into review from public.opportunity_reviews
        where user_id=old.user_id and opportunity_id=(item->>'opportunity_id')::uuid;
      if coalesce(review.feedback_excluded,false) or(not found and
        (item->>'interest_origin' in('explicit_rating','categorical_review') or jsonb_array_length(coalesce(item->'reasons','[]'))>0 or item?'search_feedback_summary')) then
        removed:=true;changed:=true;continue;end if;
      if item?'search_feedback_summary' then
        proof:=public.opportunity_feedback_inclusion(review.comment,review.evaluation_revision);
        if proof is null or proof->'proof' is distinct from item->'summary_inclusion' or proof->>'text' is distinct from item->>'search_feedback_summary' then
          item:=item-array['search_feedback_summary','summary_inclusion'];changed:=true;end if;
      elsif item?'summary_inclusion' then item:=item-'summary_inclusion';changed:=true;end if;
      items:=items||jsonb_build_array(item);
    end loop;
    result:=jsonb_set(result,'{examples}',items);
    result:=jsonb_set(result,'{counts,approved_summaries}',to_jsonb((select count(*) from jsonb_array_elements(items) e where e?'search_feedback_summary')));
    if removed then
      result:=result||jsonb_build_object('aggregates',jsonb_build_object('score_sum',0,'mean_interest',null,'groups','[]'::jsonb),
        'counts',jsonb_build_object('eligible',0,'scored',0,'confirmed_submissions',0,'explicit_rating',0,'categorical_review',0,
          'submission_fallback',0,'baseline_available',0,'approved_summaries',0,'selected',0,'omitted_limit',0,'omitted_bytes',0,'omitted_groups',0));
    end if;
  end if;
  if changed or coalesce((old.packet->>'privacy_scope_changed')::boolean,false) or new.packet->'privacy_scope_changed'='true'::jsonb then
    result:=result||'{"privacy_scope_changed":true}'::jsonb;end if;
  if result->>'metric_version'='opportunity-interest-v2' and not(result->'counts'?'application') then
    result:=jsonb_set(result,'{counts,application}','0'::jsonb);end if;
  new.packet:=result;return new;
end $$;

-- public.job_workspace_snapshot_settings()
CREATE FUNCTION public.job_workspace_snapshot_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user<>'postgres' then
    if tg_op='INSERT' then
      new.feedback_revision:=0; new.feedback_input_fingerprint:=null; new.feedback_dirty:=true;
    else
      new.feedback_revision:=old.feedback_revision;
      new.feedback_input_fingerprint:=old.feedback_input_fingerprint;
      new.feedback_dirty:=old.feedback_dirty or coalesce(new.feedback_dirty,true);
    end if;
  end if;
  return new;
end;
$$;

-- public.job_workspace_source_guard()
CREATE FUNCTION public.job_workspace_source_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare topic text; changed boolean;
begin
  if tg_op='UPDATE' and (new.registry_id,new.user_id,new.search_id,new.created_at) is distinct from (old.registry_id,old.user_id,old.search_id,old.created_at) then
    raise exception 'Source identity is immutable' using errcode='23514'; end if;
  if new.listing_url is not null then
    new.listing_url:=public.opportunity_search_source_url(new.listing_url);
    if new.listing_url is null then raise exception 'Use a public listing URL without contact details or credentials' using errcode='22023'; end if;
  end if;
  if new.vacancy_url is not null then
    new.vacancy_url:=public.opportunity_search_source_url(new.vacancy_url);
    if new.vacancy_url is null then raise exception 'Use a public vacancy reference URL' using errcode='22023'; end if;
  end if;
  if new.institution is not null and not public.opportunity_search_public_text(new.institution,200) then
    raise exception 'Institution must be bounded public text' using errcode='22023'; end if;
  if array_ndims(new.topics)>1 or cardinality(new.topics)>16 or array_position(new.topics,null) is not null then
    raise exception 'Use at most 16 public topic labels' using errcode='22023'; end if;
  foreach topic in array new.topics loop
    if not public.opportunity_search_public_text(topic,120) then raise exception 'Use bounded public topic labels' using errcode='22023'; end if;
  end loop;
  select coalesce(array_agg(t order by t collate "C"),'{}') into new.topics from (select distinct t from unnest(new.topics) t) topics;
  if current_user<>'postgres' then
    if tg_op='INSERT' then
      new.last_attempted_at:=null;new.last_successful_at:=null;new.listing_verified_at:=null;
      new.provenance:=case when new.listing_url is null then 'candidate' else 'explicit' end;
      new.owner_disabled:=new.owner_disabled or (new.listing_url is not null and not new.enabled);
      new.status:=case when new.listing_url is null then 'pending_identification' else 'ready' end;
    else
      new.last_attempted_at:=old.last_attempted_at;new.last_successful_at:=old.last_successful_at;new.listing_verified_at:=old.listing_verified_at;
      new.provenance:=old.provenance;new.status:=old.status;
      if new.enabled is distinct from old.enabled then new.owner_disabled:=not new.enabled;
      else new.owner_disabled:=old.owner_disabled or new.owner_disabled; end if;
      if new.owner_disabled then new.enabled:=false; end if;
      if new.listing_url is distinct from old.listing_url then
        new.last_attempted_at:=null;new.last_successful_at:=null;new.listing_verified_at:=null;
        new.provenance:=case when new.listing_url is null then 'candidate' else 'explicit' end;
        new.status:=case when new.listing_url is null then 'pending_identification' else 'ready' end;
      end if;
    end if;
  elsif tg_op='UPDATE' and old.owner_disabled then
    new.owner_disabled:=true;new.enabled:=false;
  end if;
  if current_user='postgres' and tg_op='UPDATE' and new.listing_url is not distinct from old.listing_url then
    new.last_attempted_at:=greatest(new.last_attempted_at,old.last_attempted_at);
    new.last_successful_at:=greatest(new.last_successful_at,old.last_successful_at);
  end if;
  if new.listing_url is null then
    new.enabled:=false;new.mandatory:=false;new.status:='pending_identification';new.listing_verified_at:=null;
  end if;
  if new.owner_disabled then new.enabled:=false; end if;
  if new.last_attempted_at is not null and not isfinite(new.last_attempted_at)
    or new.last_successful_at is not null and not isfinite(new.last_successful_at)
    or new.listing_verified_at is not null and not isfinite(new.listing_verified_at) then
    raise exception 'Unknown source times must stay null' using errcode='22023'; end if;
  if tg_op='INSERT' then new.source_revision:=1;
  else
    changed:=(to_jsonb(new)-array['source_revision','updated_at']) is distinct from (to_jsonb(old)-array['source_revision','updated_at']);
    new.source_revision:=old.source_revision+case when changed then 1 else 0 end;
  end if;
  new.updated_at:=case when tg_op='UPDATE' and new.source_revision=old.source_revision then old.updated_at else clock_timestamp() end;
  return new;
end;
$$;

-- public.job_workspace_source_invalidation()
CREATE FUNCTION public.job_workspace_source_invalidation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare owner_id uuid; target uuid; changed boolean:=true;
begin
  if tg_op='DELETE' then owner_id:=old.user_id;target:=old.search_id;
  else owner_id:=new.user_id;target:=new.search_id;
    if tg_op='UPDATE' then changed:=(new.listing_url,new.vacancy_url,new.kind,new.institution,new.topics,new.priority,new.enabled,new.pinned,new.mandatory,new.check_interval_hours,new.owner_disabled)
      is distinct from (old.listing_url,old.vacancy_url,old.kind,old.institution,old.topics,old.priority,old.enabled,old.pinned,old.mandatory,old.check_interval_hours,old.owner_disabled); end if;
  end if;
  if changed then update public.opportunity_search_adaptive_settings set query_plan_dirty=true where user_id=owner_id and search_id=target; end if;
  return null;
end;
$$;

-- public.job_workspace_touch_updated_at()
CREATE FUNCTION public.job_workspace_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- public.job_workspace_track_stage()
CREATE FUNCTION public.job_workspace_track_stage() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.status is null or new.status not in ('preparation','refinement','attachments','ready','contacted','submitted','interview','offer','rejected','withdrawn') then
    raise exception 'Select a valid application status.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
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

-- public.opportunity_feedback_inclusion(text, bigint)
CREATE FUNCTION public.opportunity_feedback_inclusion(p_comment text, p_revision bigint) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare excerpt text;
begin
  if p_revision is null or p_revision<0 or not public.opportunity_feedback_preview_text(p_comment,12000) then return null;end if;
  excerpt:=left(p_comment,600);
  if not public.opportunity_feedback_preview_text(excerpt,600) then return null;end if;
  return jsonb_build_object('text',excerpt,'proof',jsonb_build_object('policy_version','included-unless-excluded-v1',
    'summary_hash',encode(sha256(convert_to(excerpt,'UTF8')),'hex'),'source_hash',encode(sha256(convert_to(p_comment,'UTF8')),'hex'),
    'summary_revision',p_revision,'truncated',char_length(p_comment)>600,'source_length',char_length(p_comment)));
end $$;

-- public.opportunity_feedback_preview_baseline_matches(jsonb, uuid, uuid, timestamp with time zone)
CREATE FUNCTION public.opportunity_feedback_preview_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_baseline is null or jsonb_typeof(p_baseline) is distinct from 'object'
    or p_baseline-array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref']<>'{}'::jsonb
    or not(p_baseline?&array['user_id','opportunity_id','score','scale_min','scale_max','predicted_at','source_kind','source_ref'])
    or jsonb_typeof(p_baseline->'source_kind') is distinct from 'string' or jsonb_typeof(p_baseline->'source_ref') is distinct from 'string'
    or jsonb_typeof(p_baseline->'predicted_at') is distinct from 'string'
    or p_baseline->>'user_id' is distinct from p_user_id::text or p_baseline->>'opportunity_id' is distinct from p_opportunity_id::text
    or jsonb_typeof(p_baseline->'score') is distinct from 'number' or p_baseline->'scale_min' is distinct from '0'::jsonb
    or p_baseline->'scale_max' is distinct from '10'::jsonb or p_feedback_at is null or not isfinite(p_feedback_at) then return false;end if;
  return exists(select 1 from public.opportunity_feedback_prediction_proofs p where p.user_id=p_user_id and p.opportunity_id=p_opportunity_id
    and p.source_kind=p_baseline->>'source_kind' and p.source_ref=p_baseline->>'source_ref' and p.score=(p_baseline->>'score')::numeric
    and p.recorded_at=public.opportunity_feedback_preview_time(p_baseline->>'predicted_at') and p.recorded_at<=p_feedback_at);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- public.opportunity_feedback_preview_candidate(uuid, uuid, timestamp with time zone)
CREATE FUNCTION public.opportunity_feedback_preview_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_before is null or not isfinite(p_before) then return null;end if;
  return(select jsonb_build_object('user_id',p.user_id,'opportunity_id',p.opportunity_id,'score',p.score,'scale_min',0,'scale_max',10,
    'predicted_at',p.recorded_at,'source_kind',p.source_kind,'source_ref',p.source_ref)
    from public.opportunity_feedback_prediction_proofs p where p.user_id=p_user_id and p.opportunity_id=p_opportunity_id
      and p.source_kind='discovery_assessment' and p.recorded_at<=p_before order by p.recorded_at,p.discovery_id limit 1);
end;
$$;

-- public.opportunity_feedback_preview_metric(uuid, uuid)
CREATE FUNCTION public.opportunity_feedback_preview_metric(p_user_id uuid, p_opportunity_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare review record; application record; score numeric; origin text := 'none';
  has_application boolean := false; submitted boolean := false; submitted_time timestamptz; baseline jsonb; gap numeric; outcome_at timestamptz;
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_user_id is null or p_opportunity_id is null then
    raise exception 'Feedback requires an owner and opportunity' using errcode = '22023';
  end if;
  select state, interest_rating, feedback_excluded, feedback_revision, feedback_updated_at, prediction_baseline
    into review from public.opportunity_reviews where user_id = p_user_id and opportunity_id = p_opportunity_id;
  select status, submitted_at, status_history into application from public.applications
    where user_id = p_user_id and opportunity_id = p_opportunity_id;
  has_application := found;
  if has_application then
    submitted := coalesce(isfinite(application.submitted_at), false) or application.status = 'submitted'
      or exists(select 1 from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted');
    select min(value) into submitted_time from (
      select application.submitted_at as value where isfinite(application.submitted_at)
      union all select public.opportunity_feedback_preview_time(e->>'changedAt')
      from jsonb_array_elements(application.status_history) e where e->>'status' = 'submitted'
    ) times;
  end if;
  if coalesce(review.feedback_excluded, false) then origin := 'excluded';
  elsif submitted then score := 9.5; origin := 'confirmed_submission';
  elsif has_application then score := 9; origin := 'application';
  elsif review.state in ('very_high_interest','strong_interest','interested','not_interested') then
    score := case review.state when 'very_high_interest' then 9 when 'strong_interest' then 8 when 'interested' then 6 else 2 end; origin := 'categorical_review'; end if;
  baseline := case when origin='categorical_review' then review.prediction_baseline end;
  outcome_at := case when origin='confirmed_submission' then submitted_time when origin='categorical_review' then review.feedback_updated_at end;
  if origin='confirmed_submission' and outcome_at is not null then
    baseline:=public.opportunity_feedback_preview_candidate(p_user_id,p_opportunity_id,outcome_at);
  end if;
  if score is null or outcome_at is null or not public.opportunity_feedback_preview_baseline_matches(
    baseline, p_user_id, p_opportunity_id, outcome_at
  ) then baseline := null; end if;
  if score is not null and baseline is not null then gap := score - (baseline->>'score')::numeric; end if;
  return jsonb_build_object('metric_version','opportunity-interest-v2', 'user_id',p_user_id, 'opportunity_id',p_opportunity_id,
    'interest_score',score, 'interest_origin',origin, 'confirmed_submission',submitted, 'submission_at',submitted_time,
    'feedback_revision',coalesce(review.feedback_revision,0), 'feedback_updated_at',review.feedback_updated_at,
    'interest_gap',gap, 'baseline_status',case when baseline is null then 'unavailable' else 'available' end);
end;
$$;

-- public.opportunity_feedback_preview_owner(uuid)
CREATE FUNCTION public.opportunity_feedback_preview_owner(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  if p_user_id is null or(current_user<>'postgres' and(current_user<>'authenticated' or auth.uid() is distinct from p_user_id
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false))) then raise exception 'Feedback unavailable' using errcode='42501';end if;
end;
$$;

-- public.opportunity_feedback_preview_text(text, integer)
CREATE FUNCTION public.opportunity_feedback_preview_text(p_text text, p_max_length integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select public.opportunity_feedback_safe_text(p_text,p_max_length)
    and p_text ~ '[^[:space:]]'
    and p_text !~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)';
$$;

-- public.opportunity_feedback_preview_time(text)
CREATE FUNCTION public.opportunity_feedback_preview_time(p_value text) RETURNS timestamp with time zone
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare parsed timestamptz;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' then return null; end if;
  parsed := p_value::timestamptz;
  if not isfinite(parsed) then return null; end if;
  return parsed;
exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then return null;
end;
$_$;

-- public.opportunity_feedback_preview_url(text)
CREATE FUNCTION public.opportunity_feedback_preview_url(p_url text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare parts text[]; authority text[]; scheme text; host text; port integer; path text; query text;
  plain text; component text; pair text; key text; value text;
  private_key text:='(access[[:space:]_-]*token|refresh[[:space:]_-]*token|token|key|api[[:space:]_-]*key|auth(entication|orization)?|password|passwd|pwd|secret|session([[:space:]_-]*id)?|jwt|code|email([[:space:]_-]*address)?|e[[:space:]_-]*mail|phone([[:space:]_-]*number)?|mobile|tel|telephone|address|street|name|first[[:space:]_-]*name|last[[:space:]_-]*name|full[[:space:]_-]*name|user([[:space:]_-]*id|[[:space:]_-]*name)?|candidate([[:space:]_-]*id)?|applicant([[:space:]_-]*id)?|person([[:space:]_-]*id)?|contact([[:space:]_-]*id)?)';
begin
  if p_url is null or char_length(p_url)>2048 or p_url ~ '[[:cntrl:][:space:]]' or position(chr(92) in p_url)>0 then return null; end if;
  parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)([?][^#]*)?(#.*)?$','i');
  if parts is null then return null; end if;
  scheme:=lower(parts[1]);
  authority:=regexp_match(parts[2],'^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]+)?$');
  if authority is null then return null; end if;
  host:=lower(authority[1]);
  if position('.' in host)=0 or host !~ '[.][A-Za-z][A-Za-z0-9-]*$' or host ~ '^[0-9.]+$' or host ~ '[.][.]'
    or host ~ '(^|[.])-|-[.]' or host ~ '[.](localhost|local)$' then return null; end if;
  if authority[3] is not null then
    port:=substr(authority[3],2)::integer;
    if port<0 or port>65535 then return null; end if;
  end if;
  path:=coalesce(nullif(parts[3],''),'/'); query:=coalesce(parts[4],'');
  plain:=public.opportunity_feedback_preview_url_decoded(p_url);
  if plain is null or plain ~ '[[:cntrl:]]' or position(chr(92) in plain)>0
    or plain ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    or plain ~* '(mailto|tel):'
    or plain ~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    or plain ~* '(eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+)'
    or plain ~* '/(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|authorize|password|reset-password|session)(/|$)'
    or regexp_replace(plain,'[[:space:]_+-]+','','g') ~* ('[?&#]'||private_key||'=')
    or plain ~* 'https?://[^[:space:]/]+@' then return null; end if;
  foreach pair in array string_to_array(substr(query,2),'&') loop
    key:=public.opportunity_feedback_preview_url_decoded(replace(split_part(pair,'=',1),'+',' '));
    value:=public.opportunity_feedback_preview_url_decoded(replace(substr(pair,position('=' in pair)+1),'+',' '));
    if key is null or value is null or regexp_replace(key,'[[:space:]_+-]+','','g') ~* ('^'||private_key||'$') then return null; end if;
  end loop;
  component:=public.opportunity_feedback_preview_url_decoded(coalesce(parts[5],''));
  if component is null then return null; end if;
  return scheme||'://'||host||case when port is not null and not (scheme='http' and port=80 or scheme='https' and port=443)
    then ':'||port::text else '' end||path||query||coalesce(parts[5],'');
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$_$;

-- public.opportunity_feedback_preview_url_decoded(text)
CREATE FUNCTION public.opportunity_feedback_preview_url_decoded(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare current_text text:=p_text; next_text text; bytes bytea; piece text; index integer; pass integer;
begin
  if p_text is null or char_length(p_text)>8192 then return null; end if;
  for pass in 1..3 loop
    if position('%' in current_text)=0 then return current_text; end if;
    bytes:=''::bytea; index:=1;
    while index<=char_length(current_text) loop
      piece:=substr(current_text,index,1);
      if piece='%' then
        piece:=substr(current_text,index+1,2);
        if piece !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
        bytes:=bytes||decode(piece,'hex'); index:=index+3;
      else
        bytes:=bytes||convert_to(piece,'UTF8'); index:=index+1;
      end if;
    end loop;
    next_text:=convert_from(bytes,'UTF8');
    if next_text=current_text then return current_text; end if;
    current_text:=next_text;
  end loop;
  if current_text ~ '%[0-9A-Fa-f]{2}' then return null; end if;
  return current_text;
exception when character_not_in_repertoire or untranslatable_character or invalid_parameter_value then return null;
end;
$_$;

-- public.opportunity_feedback_safe_text(text, integer)
CREATE FUNCTION public.opportunity_feedback_safe_text(p_text text, p_max_length integer DEFAULT 600) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select coalesce(p_max_length between 1 and 12000 and char_length(p_text) between 1 and p_max_length
    and btrim(p_text)<>''
    and p_text !~ ('['||chr(1)||'-'||chr(8)||chr(11)||chr(12)||chr(14)||'-'||chr(31)||chr(127)||']')
    and p_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    and p_text !~* '(mailto|tel):'
    and p_text !~ '[+]?[0-9][0-9 ()/.-]{5,}[0-9]'
    and p_text !~* '(bearer[[:space:]]+[A-Za-z0-9._~+/-]+|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session[_ -]?id)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)'
    and p_text !~ '(eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})'
    and p_text !~* '(ignore[[:space:]]+((all|any)[[:space:]]+)?(previous|prior|system)|execute_sql|(drop|alter)[[:space:]]+(table|role|schema)|service_role)'
    -- Public URLs have their own typed/sanitized fields, never free-text approval.
    and p_text !~* '(https?://|//[a-z0-9])',false);
$$;

-- public.opportunity_institution_source_configuration()
CREATE FUNCTION public.opportunity_institution_source_configuration() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select '[{"institution":"ETH Zurich","listing_url":"https://jobs.ethz.ch/"},
    {"institution":"Delft University of Technology","listing_url":"https://careers.tudelft.nl/"},
    {"institution":"Eindhoven University of Technology","listing_url":"https://tue.varbi.com/en/"},
    {"institution":"KTH Royal Institute of Technology","listing_url":"https://www.kth.se/lediga-jobb/"},
    {"institution":"Technical University of Denmark","listing_url":"https://www.dtu.dk/english/about/job-and-career/vacant-positions"},
    {"institution":"Aarhus University","listing_url":"https://international.au.dk/about/profile/vacant-positions"},
    {"institution":"University of Southampton","listing_url":"https://jobs.soton.ac.uk/"}]'::jsonb;
$$;

-- public.project_opportunity_feedback_preview(uuid, uuid)
CREATE FUNCTION public.project_opportunity_feedback_preview(p_user_id uuid, p_opportunity_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare public_fact record; review record; metric jsonb; result jsonb; baseline jsonb;
  topic text; reason jsonb; value text; approved_summary text; inclusion jsonb; reasons jsonb:='[]'; topics jsonb:='[]';
  withheld jsonb:=jsonb_build_object('unsafe_text',0,'unsafe_url',0,'topic_limit',0,'unsafe_reason',0,'unapproved_summary',0);
  field text; limit_length integer; counter text;
begin
  perform public.opportunity_feedback_preview_owner(p_user_id);
  if p_user_id is null or p_opportunity_id is null then raise exception 'Feedback requires an owner and opportunity' using errcode='22023'; end if;
  select o.opportunity_key,o.title,o.institution,o.official_url,o.source_url,o.research_summary,o.topics
    into public_fact from public.opportunities o where o.id=p_opportunity_id;
  if not found then return null; end if;
  select r.state,r.interest_reasons,r.feedback_excluded,r.prediction_baseline,r.comment,r.manually_archived,r.technical_issue_category,
    r.evaluation_revision
    into review from public.opportunity_reviews r where r.user_id=p_user_id and r.opportunity_id=p_opportunity_id;
  if coalesce(review.feedback_excluded,false) then return null; end if;
  metric:=public.opportunity_feedback_preview_metric(p_user_id,p_opportunity_id);
  result:=jsonb_build_object('opportunity_id',p_opportunity_id,'topics',topics,
    'metric_version',metric->'metric_version','interest_score',metric->'interest_score','interest_origin',metric->'interest_origin',
    'interest_gap',metric->'interest_gap','baseline_status',metric->'baseline_status',
    'feedback_revision',metric->'feedback_revision','feedback_updated_at',metric->'feedback_updated_at',
    'review_state',coalesce(review.state,'unreviewed'),'confirmed_submission',metric->'confirmed_submission','submission_at',metric->'submission_at');
  if metric->>'baseline_status'='available' then
    baseline:=review.prediction_baseline;
    if metric->>'interest_origin'='confirmed_submission' then
      baseline:=public.opportunity_feedback_preview_candidate(p_user_id,p_opportunity_id,public.opportunity_feedback_preview_time(metric->>'submission_at'));
    end if;
    result:=result||jsonb_build_object('original_prediction',jsonb_build_object('user_id',p_user_id,'opportunity_id',p_opportunity_id,
      'score',baseline->'score','scale_min',0,'scale_max',10,'predicted_at',baseline->>'predicted_at',
      'source_kind',baseline->>'source_kind','source_ref',baseline->>'source_ref'));
  end if;
  foreach field in array array['opportunity_key','title','institution','research_summary'] loop
    value:=case field when 'opportunity_key' then public_fact.opportunity_key when 'title' then public_fact.title
      when 'institution' then public_fact.institution else public_fact.research_summary end;
    limit_length:=case field when 'title' then 240 when 'research_summary' then 1000 else 200 end;
    if value is not null and value<>'' then
      if public.opportunity_feedback_preview_text(value,limit_length) then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_text}',to_jsonb((withheld->>'unsafe_text')::integer+1)); end if;
    end if;
  end loop;
  foreach field in array array['official_url','source_url'] loop
    value:=case field when 'official_url' then public_fact.official_url else public_fact.source_url end;
    if value is not null and value<>'' then
      value:=public.opportunity_feedback_preview_url(value);
      if value is not null then result:=result||jsonb_build_object(field,value);
      else withheld:=jsonb_set(withheld,'{unsafe_url}',to_jsonb((withheld->>'unsafe_url')::integer+1)); end if;
    end if;
  end loop;
  for topic in select distinct t.label collate "C" from unnest(public_fact.topics) t(label) order by t.label collate "C" loop
    counter:=null;
    if not public.opportunity_feedback_preview_text(topic,120) then counter:='unsafe_text';
    elsif jsonb_array_length(topics)>=16 then counter:='topic_limit';
    else topics:=topics||jsonb_build_array(topic); end if;
    if counter is not null then withheld:=jsonb_set(withheld,array[counter],to_jsonb((withheld->>counter)::integer+1)); end if;
  end loop;
  if jsonb_typeof(review.interest_reasons)='array' then
    for reason in select e.value from jsonb_array_elements(review.interest_reasons) e loop
      if jsonb_array_length(reasons)>=24 or jsonb_typeof(reason)<>'object'
        or jsonb_typeof(reason->'category') is distinct from 'string' or jsonb_typeof(reason->'polarity') is distinct from 'string'
        or reason->>'category' not in ('topic','method','hardware','location','funding','timing','background_fit','project_context','requirements','availability','other')
        or reason->>'polarity' not in ('positive','negative')
        or reason->>'category' in ('requirements','availability') and reason->>'polarity'<>'negative'
        or reason ? 'target' and (reason->>'category' not in ('topic','method')
          or not public.opportunity_feedback_preview_text(reason->>'target',120)) then
        withheld:=jsonb_set(withheld,'{unsafe_reason}',to_jsonb((withheld->>'unsafe_reason')::integer+1));
      else
        reasons:=reasons||jsonb_build_array(jsonb_build_object('category',reason->>'category','polarity',reason->>'polarity')
          ||case when reason ? 'target' then jsonb_build_object('target',reason->>'target') else '{}'::jsonb end);
      end if;
    end loop;
  end if;
  inclusion:=public.opportunity_feedback_inclusion(review.comment,review.evaluation_revision);
  if inclusion is not null then
    approved_summary:=inclusion->>'text';
    result:=result||jsonb_build_object('search_feedback_summary',approved_summary,'summary_inclusion',inclusion->'proof');
    withheld:=jsonb_set(withheld,'{unapproved_summary}','0'::jsonb);
  end if;
  if coalesce(review.manually_archived,false) then result:=result||jsonb_build_object('manually_archived',true);end if;
  if review.technical_issue_category is not null then result:=result||jsonb_build_object('technical_issue_category',review.technical_issue_category);end if;
  -- Structured quality outcomes and feedback remain useful without a
  -- numeric rating. Unknown interest stays JSON null, never an implicit zero.
  if metric->'interest_score'='null'::jsonb and jsonb_array_length(reasons)=0 and approved_summary is null and not coalesce(review.manually_archived,false) and review.technical_issue_category is null then return null; end if;
  return result||jsonb_build_object('topics',topics,'reasons',reasons,'withheld_counts',withheld);
end;
$$;

-- public.review_job_opportunity(uuid, timestamp with time zone, text)
CREATE FUNCTION public.review_job_opportunity(p_opportunity_id uuid, p_observed_updated_at timestamp with time zone, p_state text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

-- public.save_opportunity_comment(uuid, text)
CREATE FUNCTION public.save_opportunity_comment(p_opportunity_id uuid, p_comment text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare actor uuid:=auth.uid();saved public.opportunity_reviews;value text:=nullif(p_comment,'');
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in account is required' using errcode='42501';end if;
  if char_length(value)>12000 then raise exception 'Keep the evaluation to 12000 characters or fewer' using errcode='22023';end if;
  perform 1 from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  insert into public.opportunity_reviews(user_id,opportunity_id,comment) values(actor,p_opportunity_id,value)
  on conflict(user_id,opportunity_id) do update set comment=excluded.comment returning * into saved;
  return to_jsonb(saved);
end $$;

-- public.save_opportunity_feedback(uuid, jsonb)
CREATE FUNCTION public.save_opportunity_feedback(p_opportunity_id uuid, p_patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare actor uuid:=auth.uid();saved public.opportunity_reviews;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501';end if;
  if p_opportunity_id is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
    or p_patch-array['interest_rating','interest_reasons','feedback_excluded','manually_archived','technical_issue_category','technical_issue_note']<>'{}'::jsonb then
    raise exception 'Use a supported partial feedback update' using errcode='22023';end if;
  if p_patch?'interest_rating' and p_patch->'interest_rating'<>'null'::jsonb
    and(jsonb_typeof(p_patch->'interest_rating') is distinct from 'number' or not((p_patch->>'interest_rating')::numeric between 0 and 10)) then
    raise exception 'Interest rating must be a number from 0 to 10' using errcode='22023';end if;
  if p_patch?'feedback_excluded' and jsonb_typeof(p_patch->'feedback_excluded') is distinct from 'boolean' then
    raise exception 'Feedback exclusion must be boolean' using errcode='22023';end if;
  if p_patch?'manually_archived' and jsonb_typeof(p_patch->'manually_archived') is distinct from 'boolean' then
    raise exception 'Past override must be boolean' using errcode='22023';end if;
  if p_patch?'technical_issue_category' and p_patch->'technical_issue_category'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_category') is distinct from 'string' or p_patch->>'technical_issue_category' not in('closed','requirements','application_problem','other')) then
    raise exception 'Choose a supported technical issue category' using errcode='22023';end if;
  if p_patch?'technical_issue_note' and p_patch->'technical_issue_note'<>'null'::jsonb and
    (jsonb_typeof(p_patch->'technical_issue_note') is distinct from 'string' or char_length(p_patch->>'technical_issue_note')>1000) then
    raise exception 'Technical notes must be at most 1000 characters' using errcode='22023';end if;
  perform 1 from public.opportunities where id=p_opportunity_id;
  if not found then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  insert into public.opportunity_reviews(user_id,opportunity_id) values(actor,p_opportunity_id) on conflict(user_id,opportunity_id) do nothing;
  update public.opportunity_reviews set
    manually_archived=case when p_patch?'manually_archived' then(p_patch->>'manually_archived')::boolean else manually_archived end,
    technical_issue_category=case when p_patch?'technical_issue_category' then p_patch->>'technical_issue_category' else technical_issue_category end,
    technical_issue_note=case when p_patch?'technical_issue_note' then nullif(p_patch->>'technical_issue_note','') else technical_issue_note end,
    interest_rating=case when p_patch?'interest_rating' then(p_patch->>'interest_rating')::numeric else interest_rating end,
    interest_reasons=case when p_patch?'interest_reasons' then p_patch->'interest_reasons' else interest_reasons end,
    feedback_excluded=case when p_patch?'feedback_excluded' then(p_patch->>'feedback_excluded')::boolean else feedback_excluded end
  where user_id=actor and opportunity_id=p_opportunity_id returning * into saved;
  return to_jsonb(saved);
end $$;

-- public.set_opportunity_source_reuse(uuid, boolean, integer)
CREATE FUNCTION public.set_opportunity_source_reuse(p_search_id uuid, p_enabled boolean, p_interval_hours integer DEFAULT 168) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare actor uuid:=auth.uid();saved public.opportunity_search_adaptive_settings;
begin
  if actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'A signed-in owner is required' using errcode='42501'; end if;
  if p_enabled is null or p_interval_hours is null or p_interval_hours not between 24 and 720 then raise exception 'Choose explicit reuse and a bounded 24–720-hour interval' using errcode='22023'; end if;
  perform 1 from public.opportunity_search_templates where id=p_search_id and user_id=actor;
  if not found then raise exception 'Search unavailable' using errcode='42501'; end if;
  insert into public.opportunity_search_adaptive_settings(user_id,search_id,successful_source_reuse_enabled,reuse_check_interval_hours)
    values(actor,p_search_id,p_enabled,p_interval_hours) on conflict(user_id,search_id) do update set successful_source_reuse_enabled=excluded.successful_source_reuse_enabled,reuse_check_interval_hours=excluded.reuse_check_interval_hours returning * into saved;
  return jsonb_build_object('user_id',actor,'search_id',p_search_id,'successful_source_reuse_enabled',saved.successful_source_reuse_enabled,
    'reuse_check_interval_hours',saved.reuse_check_interval_hours,'source_reuse_revision',saved.source_reuse_revision);
end;
$$;
