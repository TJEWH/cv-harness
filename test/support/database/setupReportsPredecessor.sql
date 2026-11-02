-- Synthetic upgrade test only: pre-test setup handoff projection.
CREATE OR REPLACE FUNCTION private.adaptive_setup_handoff(p_setup_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare operation private.opportunity_search_setup_operations;target jsonb;result jsonb;
begin
  if current_user<>'postgres' then raise exception 'Management setup access required' using errcode='42501';end if;
  select * into operation from private.opportunity_search_setup_operations where setup_id=p_setup_id;
  if not found or not public.adaptive_search_setup_schedule(operation.schedule)
    or encode(sha256(convert_to(operation.recurring_prompt,'UTF8')),'hex')<>operation.recurring_prompt_hash
    or operation.target_task_id is not null and not public.adaptive_search_setup_task_id(operation.target_task_id) then raise exception 'Setup unavailable' using errcode='22023';end if;
  target:=jsonb_build_object('kind',case when operation.target_task_id is null then 'selection_required' else 'bound' end,
    'task_id',operation.target_task_id,'requires_explicit_selection',operation.target_task_id is null);
  result:=jsonb_build_object('setup_contract_version',1,'compatible',true,'setup_id',operation.setup_id,'scope',jsonb_build_object(
    'user_id',operation.user_id,'search_id',operation.search_id,'project_ref',operation.project_ref),'mode',operation.mode,
    'runner_capability',operation.runner_capability,'revision',operation.config_revision,'schedule',operation.schedule,
    'recurringPrompt',operation.recurring_prompt,'recurring_prompt_hash',operation.recurring_prompt_hash,'target',target,
    'lifecycle',jsonb_build_object('setup_only',true,'research_allowed',false,'disable_before_ack',false,'broad_purpose_matching',false,
      'superseded_rule','Only explicitly human-approved task IDs may be disabled after successful acknowledgement; no disable success is recorded here.'),
    'acknowledgement',jsonb_build_object('helper','private.ack_adaptive_search_setup(uuid,uuid,jsonb)',
      'payload_template',jsonb_build_object('schema_version',1,'operation','update','task_id',coalesce(operation.target_task_id,'<actual selected or created task ID>'),
        'schedule',operation.schedule,'recurring_prompt_hash',operation.recurring_prompt_hash,
        'task_tool_receipt',jsonb_build_object('success',true,'task_id',coalesce(operation.target_task_id,'<actual task-tool returned ID>'),'schedule',operation.schedule,'operation','update'),
        'explicit_selection_confirmed',false,'approved_superseded_task_ids','[]'::jsonb,'disabled_task_ids','[]'::jsonb),
      'meanings',jsonb_build_object('operation','Use update for the exact bound/explicitly selected existing task; create only after explicit user approval when unbound.',
        'task_tool_receipt','Normalized attestation of the actual successful task-tool result, not a cryptographic receipt. Never fabricate success, ID or schedule.',
        'explicit_selection_confirmed','Must be true only after explicit human selection/create approval for an unbound search.',
        'disabled_task_ids','Must be empty. Disable only explicitly approved superseded IDs after this acknowledgement succeeds.')));
  if octet_length(result::text)>65536 then raise exception 'Setup handoff exceeds bound' using errcode='54000';end if;
  return result;
end;
$$;
