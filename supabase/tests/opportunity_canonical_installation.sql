-- Current canonical installation verification: synthetic JSON only.
do $check$
declare p jsonb; a jsonb; b jsonb; c jsonb; s jsonb; old_evidence jsonb; result jsonb;
begin
 if (select active_protocol_version from private.opportunity_search_settings where singleton)<>'opportunity-search-v1-canonical-6' then raise exception 'Canonical protocol is not active'; end if;
 if exists(select 1 from public.opportunities o where metadata_schema_version<>6 or not private.opportunity_payload_storage_valid(to_jsonb(o))) then raise exception 'Noncanonical catalogue rows'; end if;
 if to_regprocedure('private.opportunity_search_normalize_record(jsonb)') is not null or to_regprocedure('private.opportunity_search_merge_value(jsonb,jsonb)') is not null or to_regprocedure('private.opportunity_merge_input_schema_v3()') is not null then raise exception 'Compatibility functions remain installed'; end if;
 if private.opportunity_storage_schema()->>'additionalProperties'<>'false' or private.opportunity_search_result_schema()->>'x-canonical-version'<>'6' then raise exception 'Incorrect result schema'; end if;
 s:='[{"url":"https://example.invalid/jobs/smoke","kind":"official","checked_at":"2000-01-01T09:00:00Z","precision":"instant","supports":["title","city","contacts","opportunity_key"]}]';
 p:=jsonb_build_object('opportunity_key','canonical-readonly-smoke','title','Research','city','Espoo','last_checked_at','2000-01-01T09:00:00Z','sources',s,'contacts','[{"name":"Person","roles":["Scientific contact"],"entity_id":"person"}]'::jsonb);
 a:=private.opportunity_merge_plan(null,p,null);
 if a#>>'{value,city}'<>'Espoo' or a#>>'{value,contacts,0,entity_id}' is null then raise exception 'Canonical values or stable IDs missing'; end if;
 old_evidence:=a#>'{state,/city}';
 b:=private.opportunity_merge_plan(a->'value',p||'{"city":"Helsinki"}',a->'state');
 if b#>>'{value,city}'<>'Espoo' or b#>'{state,/city}' is distinct from old_evidence then raise exception 'Rejected field advanced effective evidence'; end if;
 c:=private.opportunity_merge_plan(a->'value',p||'{"city":"Helsinki","merge_control":{"corrections":[{"path":"/city","expected":"Espoo","reason":"Same official notice interpreted correctly."}]}}',a->'state');
 if c#>>'{value,city}'<>'Helsinki' then raise exception 'Same-evidence correction rejected'; end if;
 if jsonb_array_length(private.opportunity_canonical_set('/source_urls','["https://EXAMPLE.invalid/Job","https://example.invalid/Job","https://example.invalid/job"]'))<>2 then raise exception 'Case-sensitive URL path lost'; end if;
 begin
   perform private.validate_opportunity_search_result(p||'{"requirements":{"required":["MSc"]}}');
   raise exception 'Legacy grouped checklist accepted';
 exception when sqlstate '22023' then null;
 end;
end $check$;
