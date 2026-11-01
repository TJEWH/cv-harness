-- Current desired schema: 22_search_tables.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- public.opportunity_search_sources
CREATE TABLE public.opportunity_search_sources (
    registry_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    listing_url text,
    vacancy_url text,
    kind text DEFAULT 'other'::text NOT NULL,
    institution text,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    priority integer DEFAULT 50 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    mandatory boolean DEFAULT false NOT NULL,
    check_interval_hours integer DEFAULT 168 NOT NULL,
    last_attempted_at timestamp with time zone,
    last_successful_at timestamp with time zone,
    status text DEFAULT 'pending_identification'::text NOT NULL,
    owner_disabled boolean DEFAULT false NOT NULL,
    provenance text DEFAULT 'candidate'::text NOT NULL,
    listing_verified_at timestamp with time zone,
    source_revision bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_sources_check_interval_hours_check CHECK (((check_interval_hours >= 24) AND (check_interval_hours <= 720))),
    CONSTRAINT opportunity_search_sources_kind_check CHECK ((kind = ANY (ARRAY['university'::text, 'lab'::text, 'program'::text, 'job_board'::text, 'other'::text]))),
    CONSTRAINT opportunity_search_sources_priority_check CHECK (((priority >= 0) AND (priority <= 100))),
    CONSTRAINT opportunity_search_sources_provenance_check CHECK ((provenance = ANY (ARRAY['explicit'::text, 'evidenced_listing'::text, 'candidate'::text]))),
    CONSTRAINT opportunity_search_sources_status_check CHECK ((status = ANY (ARRAY['pending_identification'::text, 'ready'::text, 'checked'::text, 'blocked'::text, 'incomplete'::text])))
);

-- public.opportunity_search_templates
CREATE TABLE public.opportunity_search_templates (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    criteria jsonb NOT NULL,
    schedule jsonb NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    meta_search jsonb,
    CONSTRAINT opportunity_search_templates_revision_check CHECK ((revision > 0))
);

-- private.opportunity_search_adaptive_batches
CREATE TABLE private.opportunity_search_adaptive_batches (
    run_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    ordinal integer NOT NULL,
    payload_hash text NOT NULL,
    plan_id uuid NOT NULL,
    plan_hash text NOT NULL,
    item_ids uuid[] NOT NULL,
    query_versions jsonb NOT NULL,
    execution_status text NOT NULL,
    recorded_checks integer NOT NULL,
    retained_backlog integer NOT NULL,
    omitted_backlog integer NOT NULL,
    execution_incomplete boolean NOT NULL,
    suggestions jsonb DEFAULT '[]'::jsonb NOT NULL,
    manifest_hash text,
    result jsonb,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_adaptive_batches_item_ids_check CHECK ((cardinality(item_ids) <= 10)),
    CONSTRAINT opportunity_search_adaptive_batches_ordinal_check CHECK (((ordinal >= 1) AND (ordinal <= 32))),
    CONSTRAINT opportunity_search_adaptive_batches_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);

-- private.opportunity_search_adaptive_completions
CREATE TABLE private.opportunity_search_adaptive_completions (
    run_id uuid NOT NULL,
    completion_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    payload_hash text NOT NULL,
    manifest_hash text NOT NULL,
    historical_summary jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_adaptive_completion_historical_summary_check CHECK (((jsonb_typeof(historical_summary) = 'object'::text) AND (octet_length((historical_summary)::text) <= 262144))),
    CONSTRAINT opportunity_search_adaptive_completions_manifest_hash_check CHECK ((manifest_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT opportunity_search_adaptive_completions_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);

-- private.opportunity_search_adaptive_contexts
CREATE TABLE private.opportunity_search_adaptive_contexts (
    run_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    project_ref text NOT NULL,
    authorization_epoch uuid NOT NULL,
    authorization_revision bigint NOT NULL,
    preference_revision bigint NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    privacy_redacted boolean DEFAULT false NOT NULL,
    bundle jsonb NOT NULL,
    bundle_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expected_shared_plan_id uuid,
    plan_pointer_captured boolean DEFAULT false NOT NULL,
    expected_source_fingerprint text,
    CONSTRAINT opportunity_search_adaptive_contexts_bundle_check CHECK ((octet_length((bundle)::text) <= 262144))
);

-- private.opportunity_search_adaptive_items
CREATE TABLE private.opportunity_search_adaptive_items (
    run_id uuid NOT NULL,
    item_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    payload_hash text NOT NULL,
    opportunity_id uuid,
    outcome text NOT NULL,
    canonical_outcome text,
    conflict_code text,
    accepted_roots jsonb DEFAULT '{}'::jsonb NOT NULL,
    deferred_fields text[] DEFAULT '{}'::text[] NOT NULL,
    discovery_id uuid,
    reusable_listing_url text,
    reusable_registry_id uuid,
    retention_deferred boolean DEFAULT false NOT NULL,
    CONSTRAINT opportunity_search_adaptive_items_canonical_outcome_check CHECK ((canonical_outcome = ANY (ARRAY['new'::text, 'updated'::text, 'unchanged'::text]))),
    CONSTRAINT opportunity_search_adaptive_items_conflict_code_check CHECK ((conflict_code = ANY (ARRAY['identity_conflict'::text, 'insufficient_evidence'::text, 'correction_deferred'::text, 'scope_changed'::text]))),
    CONSTRAINT opportunity_search_adaptive_items_outcome_check CHECK ((outcome = ANY (ARRAY['saved'::text, 'unresolved'::text]))),
    CONSTRAINT opportunity_search_adaptive_items_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);

-- private.opportunity_search_identities
CREATE TABLE private.opportunity_search_identities (
    identity_key text NOT NULL,
    opportunity_id uuid NOT NULL
);

-- private.opportunity_search_merge_audit
CREATE TABLE private.opportunity_search_merge_audit (
    sequence bigint NOT NULL,
    run_id uuid NOT NULL,
    item_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb NOT NULL,
    before_state jsonb,
    after_state jsonb NOT NULL,
    before_identities jsonb NOT NULL,
    after_identities jsonb NOT NULL,
    decisions jsonb NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    rolled_back_at timestamp with time zone
);

-- private.opportunity_search_merge_state
CREATE TABLE private.opportunity_search_merge_state (
    opportunity_id uuid NOT NULL,
    fields jsonb NOT NULL,
    CONSTRAINT opportunity_search_merge_state_fields_check CHECK ((jsonb_typeof(fields) = 'object'::text))
);

-- private.opportunity_search_protocols
CREATE TABLE private.opportunity_search_protocols (
    version text NOT NULL,
    contract_version integer NOT NULL,
    protocol_hash text NOT NULL,
    protocol_text text NOT NULL,
    result_schema jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT opportunity_search_protocols_contract_version_check CHECK ((contract_version > 0)),
    CONSTRAINT opportunity_search_protocols_protocol_text_check CHECK ((char_length(protocol_text) > 0)),
    CONSTRAINT opportunity_search_protocols_result_schema_check CHECK ((jsonb_typeof(result_schema) = 'object'::text)),
    CONSTRAINT opportunity_search_protocols_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 200)))
);

-- private.opportunity_search_schedule_claims
CREATE TABLE private.opportunity_search_schedule_claims (
    search_id uuid NOT NULL,
    run_id uuid NOT NULL,
    claimed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

-- private.opportunity_search_settings
CREATE TABLE private.opportunity_search_settings (
    singleton boolean DEFAULT true NOT NULL,
    active_protocol_version text NOT NULL,
    CONSTRAINT opportunity_search_settings_singleton_check CHECK (singleton)
);

-- private.opportunity_search_setup_acknowledgements
CREATE TABLE private.opportunity_search_setup_acknowledgements (
    setup_id uuid NOT NULL,
    payload_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

-- private.opportunity_search_setup_operations
CREATE TABLE private.opportunity_search_setup_operations (
    setup_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    project_ref text NOT NULL,
    mode text NOT NULL,
    config_revision bigint NOT NULL,
    release_revision bigint,
    authorization_epoch uuid,
    authorization_revision bigint,
    binding_hash text NOT NULL,
    target_task_id text,
    runner_capability text NOT NULL,
    template_revision integer NOT NULL,
    schedule jsonb NOT NULL,
    recurring_prompt text NOT NULL,
    recurring_prompt_hash text NOT NULL,
    handoff jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    purpose text DEFAULT 'setup'::text NOT NULL,
    rollback_prompt_origin text,
    CONSTRAINT opportunity_search_setup_operation_rollback_prompt_origin_check CHECK ((rollback_prompt_origin = ANY (ARRAY['acknowledged_legacy'::text, 'reviewed_legacy_fallback'::text]))),
    CONSTRAINT opportunity_search_setup_operations_handoff_check CHECK ((octet_length((handoff)::text) <= 65536)),
    CONSTRAINT opportunity_search_setup_operations_mode_check CHECK ((mode = ANY (ARRAY['legacy'::text, 'adaptive'::text]))),
    CONSTRAINT opportunity_search_setup_operations_purpose_check CHECK ((purpose = ANY (ARRAY['setup'::text, 'rollback'::text]))),
    CONSTRAINT opportunity_search_setup_operations_runner_capability_check CHECK ((runner_capability = ANY (ARRAY['legacy-v1'::text, 'adaptive-batch-v1'::text])))
);

-- public.opportunity_search_adaptive_proposals
CREATE TABLE public.opportunity_search_adaptive_proposals (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    suggestion_id uuid NOT NULL,
    run_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    kind text NOT NULL,
    proposal jsonb NOT NULL,
    evidence_refs uuid[] NOT NULL,
    status text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_adaptive_proposals_evidence_refs_check CHECK (((cardinality(evidence_refs) >= 1) AND (cardinality(evidence_refs) <= 16))),
    CONSTRAINT opportunity_search_adaptive_proposals_kind_check CHECK ((kind = ANY (ARRAY['preference'::text, 'source'::text, 'query'::text]))),
    CONSTRAINT opportunity_search_adaptive_proposals_proposal_check CHECK ((octet_length((proposal)::text) <= 8192)),
    CONSTRAINT opportunity_search_adaptive_proposals_reason_check CHECK ((reason = ANY (ARRAY['needs_verified_evidence'::text, 'needs_reviewed_evidence'::text, 'adaptation_disabled'::text]))),
    CONSTRAINT opportunity_search_adaptive_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_verification'::text, 'deferred'::text])))
);

-- public.opportunity_search_adaptive_release
CREATE TABLE public.opportunity_search_adaptive_release (
    singleton boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    project_ref text,
    adaptive_contract_version integer DEFAULT 1 NOT NULL,
    capability_version text DEFAULT 'adaptive-startup-v1'::text NOT NULL,
    release_revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_adaptive_release_project_ref_check CHECK (((project_ref IS NULL) OR (project_ref ~ '^[a-z0-9]{20}$'::text))),
    CONSTRAINT opportunity_search_adaptive_release_release_revision_check CHECK ((release_revision > 0)),
    CONSTRAINT opportunity_search_adaptive_release_singleton_check CHECK (singleton)
);

-- public.opportunity_search_adaptive_settings
CREATE TABLE public.opportunity_search_adaptive_settings (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    feedback_dirty boolean DEFAULT true NOT NULL,
    feedback_revision bigint DEFAULT 0 NOT NULL,
    feedback_input_fingerprint text,
    successful_source_reuse_enabled boolean DEFAULT false NOT NULL,
    reuse_check_interval_hours integer DEFAULT 168 NOT NULL,
    source_reuse_revision bigint DEFAULT 0 NOT NULL,
    query_plan_id uuid,
    query_plan_revision bigint DEFAULT 0 NOT NULL,
    query_plan_dirty boolean DEFAULT true NOT NULL,
    adaptation_enabled boolean DEFAULT false NOT NULL,
    adaptation_paused boolean DEFAULT false NOT NULL,
    adaptation_revision bigint DEFAULT 0 NOT NULL,
    search_breadth_percent integer DEFAULT 20 NOT NULL,
    breadth_revision bigint DEFAULT 0 NOT NULL,
    institution_sources_seeded boolean DEFAULT false NOT NULL,
    institution_sources_omitted smallint DEFAULT 0 NOT NULL,
    CONSTRAINT opportunity_search_adaptive_s_institution_sources_omitted_check CHECK (((institution_sources_omitted >= 0) AND (institution_sources_omitted <= 7))),
    CONSTRAINT opportunity_search_adaptive_se_reuse_check_interval_hours_check CHECK (((reuse_check_interval_hours >= 24) AND (reuse_check_interval_hours <= 720))),
    CONSTRAINT opportunity_search_adaptive_settin_search_breadth_percent_check CHECK ((((search_breadth_percent >= 0) AND (search_breadth_percent <= 100)) AND ((search_breadth_percent % 5) = 0))),
    CONSTRAINT opportunity_search_adaptive_settings_adaptation_revision_check CHECK ((adaptation_revision >= 0)),
    CONSTRAINT opportunity_search_adaptive_settings_breadth_revision_check CHECK ((breadth_revision >= 0)),
    CONSTRAINT opportunity_search_adaptive_settings_feedback_revision_check CHECK ((feedback_revision >= 0))
);

-- public.opportunity_search_dashboard_actions
CREATE TABLE public.opportunity_search_dashboard_actions (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    action_id uuid NOT NULL,
    kind text NOT NULL,
    registry_id uuid,
    patch jsonb NOT NULL,
    expected_revisions jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_dashboard_actions_check CHECK (((octet_length((patch)::text) <= 8192) AND (octet_length((expected_revisions)::text) <= 1024) AND (octet_length((result)::text) <= 32768))),
    CONSTRAINT opportunity_search_dashboard_actions_kind_check CHECK ((kind = ANY (ARRAY['settings'::text, 'source'::text])))
);

-- public.opportunity_search_discoveries
CREATE TABLE public.opportunity_search_discoveries (
    discovery_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    run_id uuid NOT NULL,
    item_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    query_plan_id uuid,
    base_revision integer NOT NULL,
    feedback_revision bigint NOT NULL,
    preference_revision bigint NOT NULL,
    protocol_version text NOT NULL,
    primary_discovery boolean NOT NULL,
    execution_refs uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    primary_check_id uuid,
    discovered_at timestamp with time zone,
    encountered_at timestamp with time zone,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    original_assessment jsonb,
    assessment_score numeric GENERATED ALWAYS AS (((original_assessment ->> 'score'::text))::numeric) STORED,
    assessment_scale_min numeric GENERATED ALWAYS AS (((original_assessment ->> 'scale_min'::text))::numeric) STORED,
    assessment_scale_max numeric GENERATED ALWAYS AS (((original_assessment ->> 'scale_max'::text))::numeric) STORED,
    assessment_recorded_at timestamp with time zone,
    assessment_verified_at timestamp with time zone,
    assessment_version text,
    assessment_evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified_at timestamp with time zone,
    institution text,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    recommendation_eligible boolean,
    recommendation_generated boolean DEFAULT false NOT NULL,
    recommendation_policy_violation boolean DEFAULT false NOT NULL,
    updated_only boolean DEFAULT false NOT NULL,
    delivery_status text DEFAULT 'unknown'::text NOT NULL,
    deadline_quality jsonb NOT NULL,
    payload_hash text NOT NULL,
    CONSTRAINT opportunity_search_discoveries_delivery_status_check CHECK ((delivery_status = 'unknown'::text)),
    CONSTRAINT opportunity_search_discoveries_discovered_at_check CHECK (((discovered_at IS NULL) OR isfinite(discovered_at))),
    CONSTRAINT opportunity_search_discoveries_encountered_at_check CHECK (((encountered_at IS NULL) OR isfinite(encountered_at))),
    CONSTRAINT opportunity_search_discoveries_original_assessment_check CHECK (((original_assessment IS NULL) OR ((jsonb_typeof(original_assessment) = 'object'::text) AND (original_assessment ?& ARRAY['score'::text, 'scale_min'::text, 'scale_max'::text]) AND (jsonb_typeof((original_assessment -> 'score'::text)) = ANY (ARRAY['number'::text, 'null'::text])) AND ((original_assessment -> 'scale_min'::text) = '0'::jsonb) AND ((original_assessment -> 'scale_max'::text) = '10'::jsonb) AND (((((original_assessment ->> 'score'::text))::numeric >= (0)::numeric) AND (((original_assessment ->> 'score'::text))::numeric <= (10)::numeric)) OR ((original_assessment -> 'score'::text) = 'null'::jsonb))))),
    CONSTRAINT opportunity_search_discoveries_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);

-- public.opportunity_search_execution_receipts
CREATE TABLE public.opportunity_search_execution_receipts (
    run_id uuid NOT NULL,
    report_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    payload_hash text NOT NULL,
    result jsonb NOT NULL
);

-- public.opportunity_search_executions
CREATE TABLE public.opportunity_search_executions (
    run_id uuid NOT NULL,
    check_id uuid NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    kind text NOT NULL,
    query_id uuid,
    text_hash text,
    source_registry_id uuid,
    attempted_at timestamp with time zone NOT NULL,
    status text NOT NULL,
    results_count integer,
    failure_reason text,
    payload_hash text NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_executions_attempted_at_check CHECK (isfinite(attempted_at)),
    CONSTRAINT opportunity_search_executions_check CHECK ((((kind = 'query'::text) AND (query_id IS NOT NULL) AND (text_hash IS NOT NULL)) OR ((kind = 'source'::text) AND (source_registry_id IS NOT NULL) AND (query_id IS NULL) AND (text_hash IS NULL)))),
    CONSTRAINT opportunity_search_executions_check1 CHECK (((status <> 'complete'::text) OR (results_count IS NOT NULL))),
    CONSTRAINT opportunity_search_executions_failure_reason_check CHECK ((failure_reason = ANY (ARRAY['access_denied'::text, 'network_error'::text, 'pagination_limit'::text, 'dynamic_content'::text, 'budget_exhausted'::text, 'unknown'::text]))),
    CONSTRAINT opportunity_search_executions_kind_check CHECK ((kind = ANY (ARRAY['query'::text, 'source'::text]))),
    CONSTRAINT opportunity_search_executions_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT opportunity_search_executions_results_count_check CHECK ((results_count >= 0)),
    CONSTRAINT opportunity_search_executions_status_check CHECK ((status = ANY (ARRAY['complete'::text, 'blocked'::text, 'failed'::text, 'partial'::text, 'paginated'::text, 'dynamic'::text]))),
    CONSTRAINT opportunity_search_executions_text_hash_check CHECK (((text_hash IS NULL) OR (text_hash ~ '^[0-9a-f]{64}$'::text)))
);

-- public.opportunity_search_feedback_snapshots
CREATE TABLE public.opportunity_search_feedback_snapshots (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    feedback_revision bigint NOT NULL,
    input_fingerprint text NOT NULL,
    packet jsonb NOT NULL,
    redact_aggregates boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_feedback_snapshots_feedback_revision_check CHECK ((feedback_revision > 0)),
    CONSTRAINT opportunity_search_feedback_snapshots_input_fingerprint_check CHECK ((input_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT opportunity_search_feedback_snapshots_packet_check CHECK (((jsonb_typeof(packet) = 'object'::text) AND (octet_length((packet)::text) <= 65536)))
);

-- public.opportunity_search_preference_actions
CREATE TABLE public.opportunity_search_preference_actions (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    suggestion_id uuid NOT NULL,
    action text NOT NULL,
    expected_revision bigint NOT NULL,
    preference_revision bigint NOT NULL,
    approved_rules jsonb NOT NULL,
    replaced_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    document_hash text NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    sequence bigint NOT NULL,
    CONSTRAINT opportunity_search_preference_actions_action_check CHECK ((action = ANY (ARRAY['approve'::text, 'reject'::text, 'undo'::text]))),
    CONSTRAINT opportunity_search_preference_actions_expected_revision_check CHECK ((expected_revision >= 0))
);

-- public.opportunity_search_preference_suggestions
CREATE TABLE public.opportunity_search_preference_suggestions (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    suggestion_id uuid NOT NULL,
    rule jsonb NOT NULL,
    rule_hash text NOT NULL,
    origin text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_preference_suggestions_origin_check CHECK ((origin = ANY (ARRAY['owner'::text, 'runner'::text])))
);

-- public.opportunity_search_query_plans
CREATE TABLE public.opportunity_search_query_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    query_revision_id uuid NOT NULL,
    plan_revision bigint NOT NULL,
    base_revision integer NOT NULL,
    feedback_revision bigint NOT NULL,
    preference_revision bigint NOT NULL,
    protocol_version text NOT NULL,
    document jsonb NOT NULL,
    plan_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    planning_policy jsonb,
    CONSTRAINT opportunity_search_query_plans_base_revision_check CHECK ((base_revision > 0)),
    CONSTRAINT opportunity_search_query_plans_document_check CHECK (((jsonb_typeof(document) = 'object'::text) AND (octet_length((document)::text) <= 524288))),
    CONSTRAINT opportunity_search_query_plans_feedback_revision_check CHECK ((feedback_revision >= 0)),
    CONSTRAINT opportunity_search_query_plans_plan_hash_check CHECK ((plan_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT opportunity_search_query_plans_plan_revision_check CHECK ((plan_revision > 0)),
    CONSTRAINT opportunity_search_query_plans_planning_policy_check CHECK (((planning_policy IS NULL) OR ((jsonb_typeof(planning_policy) = 'object'::text) AND (octet_length((planning_policy)::text) <= 1024)))),
    CONSTRAINT opportunity_search_query_plans_preference_revision_check CHECK ((preference_revision >= 0))
);

-- public.opportunity_search_query_revisions
CREATE TABLE public.opportunity_search_query_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    search_id uuid NOT NULL,
    user_id uuid NOT NULL,
    template_revision integer NOT NULL,
    protocol_version text NOT NULL,
    queries jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT opportunity_search_query_revisions_queries_check CHECK ((jsonb_typeof(queries) = 'array'::text)),
    CONSTRAINT opportunity_search_query_revisions_template_revision_check CHECK ((template_revision > 0))
);

-- public.opportunity_search_receipts
CREATE TABLE public.opportunity_search_receipts (
    run_id uuid NOT NULL,
    item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    payload jsonb NOT NULL,
    result jsonb NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- public.opportunity_search_rollback_requests
CREATE TABLE public.opportunity_search_rollback_requests (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    rollback_id uuid NOT NULL,
    project_ref text NOT NULL,
    expected_runner_revision bigint NOT NULL,
    expected_rollback_revision bigint NOT NULL,
    rollback_revision bigint NOT NULL,
    runner_revision bigint NOT NULL,
    accept_reviewed_fallback boolean DEFAULT false NOT NULL,
    binding_hash text NOT NULL,
    requested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_rollback_re_expected_rollback_revision_check CHECK ((expected_rollback_revision >= 0)),
    CONSTRAINT opportunity_search_rollback_requ_expected_runner_revision_check CHECK ((expected_runner_revision >= 0)),
    CONSTRAINT opportunity_search_rollback_requests_binding_hash_check CHECK ((binding_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT opportunity_search_rollback_requests_project_ref_check CHECK ((project_ref ~ '^[a-z0-9]{20}$'::text)),
    CONSTRAINT opportunity_search_rollback_requests_rollback_revision_check CHECK ((rollback_revision > 0)),
    CONSTRAINT opportunity_search_rollback_requests_runner_revision_check CHECK ((runner_revision > 0))
);

-- public.opportunity_search_runner_authorizations
CREATE TABLE public.opportunity_search_runner_authorizations (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    project_ref text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    authorization_revision bigint DEFAULT 0 NOT NULL,
    authorization_epoch uuid DEFAULT gen_random_uuid() NOT NULL,
    authorized_at timestamp with time zone,
    CONSTRAINT opportunity_search_runner_authoriz_authorization_revision_check CHECK ((authorization_revision >= 0)),
    CONSTRAINT opportunity_search_runner_authorizations_project_ref_check CHECK ((project_ref ~ '^[a-z0-9]{20}$'::text))
);

-- public.opportunity_search_runner_config
CREATE TABLE public.opportunity_search_runner_config (
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    project_ref text NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    mode text DEFAULT 'legacy'::text NOT NULL,
    migration_requested boolean DEFAULT true NOT NULL,
    setup_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT opportunity_search_runner_config_mode_check CHECK ((mode = ANY (ARRAY['legacy'::text, 'adaptive'::text]))),
    CONSTRAINT opportunity_search_runner_config_project_ref_check CHECK ((project_ref ~ '^[a-z0-9]{20}$'::text)),
    CONSTRAINT opportunity_search_runner_config_revision_check CHECK ((revision > 0))
);

-- public.opportunity_search_runs
CREATE TABLE public.opportunity_search_runs (
    id uuid NOT NULL,
    search_id uuid NOT NULL,
    user_id uuid NOT NULL,
    template_revision integer NOT NULL,
    protocol_version text NOT NULL,
    definition jsonb NOT NULL,
    queries jsonb,
    status text DEFAULT 'running'::text NOT NULL,
    recovery_count integer DEFAULT 0 NOT NULL,
    summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    feedback_snapshot_revision bigint,
    feedback_input_fingerprint text,
    query_plan_id uuid,
    execution_expectations jsonb,
    execution_report_status text DEFAULT 'unreported'::text NOT NULL,
    execution_backlog jsonb DEFAULT '[]'::jsonb NOT NULL,
    execution_backlog_omitted integer DEFAULT 0 NOT NULL,
    execution_report_overflow boolean DEFAULT false NOT NULL,
    adaptive_contract_version integer,
    preference_snapshot_revision bigint,
    adaptive_authorization_revision bigint,
    adaptive_project_ref text,
    adaptive_lease_expires_at timestamp with time zone,
    owner_cancel_operation_id uuid,
    superseded_by_run_id uuid,
    CONSTRAINT opportunity_search_runs_supersession_check CHECK (superseded_by_run_id IS NULL OR
      (superseded_by_run_id<>id AND status='failed' AND completed_at IS NOT NULL AND adaptive_lease_expires_at IS NULL AND owner_cancel_operation_id IS NULL)),
    CONSTRAINT opportunity_search_runs_execution_backlog_check CHECK (((jsonb_typeof(execution_backlog) = 'array'::text) AND (jsonb_array_length(execution_backlog) <= 64))),
    CONSTRAINT opportunity_search_runs_execution_backlog_omitted_check CHECK ((execution_backlog_omitted >= 0)),
    CONSTRAINT opportunity_search_runs_execution_report_status_check CHECK ((execution_report_status = ANY (ARRAY['unreported'::text, 'complete'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT opportunity_search_runs_recovery_count_check CHECK (((recovery_count >= 0) AND (recovery_count <= 1))),
    CONSTRAINT opportunity_search_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'complete'::text, 'failed'::text]))),
    CONSTRAINT opportunity_search_runs_template_revision_check CHECK ((template_revision > 0))
);

-- public.opportunity_search_schedule_bindings
CREATE TABLE public.opportunity_search_schedule_bindings (
    search_id uuid NOT NULL,
    user_id uuid NOT NULL,
    task_id text NOT NULL,
    schedule jsonb NOT NULL,
    template_revision integer NOT NULL,
    confirmed_run_id uuid,
    protocol_version text NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    runner_capability text,
    confirmed_setup_id uuid,
    CONSTRAINT opportunity_search_schedule_bindings_task_id_check CHECK (((char_length(btrim(task_id)) >= 1) AND (char_length(btrim(task_id)) <= 500)))
);

-- public.opportunity_search_setup_claims
CREATE TABLE public.opportunity_search_setup_claims (
    search_id uuid NOT NULL,
    user_id uuid NOT NULL,
    setup_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

-- An explicit authenticated owner command pins one target forever. No research payload is stored here.
CREATE TABLE private.opportunity_search_lifecycle_operations (
    operation_id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    search_id uuid NOT NULL,
    project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$'),
    task_id text NOT NULL CHECK (char_length(task_id) BETWEEN 1 AND 500),
    mode text NOT NULL CHECK (mode IN ('abort','abort_and_restart')),
    target_run_id uuid,
    target_version text,
    target_lease_expires_at timestamptz,
    authorization_epoch uuid NOT NULL,
    authorization_revision bigint NOT NULL,
    restart_run_id uuid UNIQUE,
    outcome text NOT NULL CHECK (outcome IN ('prepared','no_active_run','ambiguous_active_run','target_changed','binding_changed','aborted')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    aborted_at timestamptz,
    aborted_transaction_id bigint,
    verified_at timestamptz,
    CHECK ((target_run_id IS NULL) = (target_version IS NULL)),
    CHECK (target_version IS NULL OR target_version ~ '^[0-9a-f]{64}$'),
    CHECK (restart_run_id IS NULL OR (mode='abort_and_restart' AND target_run_id IS NOT NULL))
);
CREATE INDEX opportunity_search_lifecycle_operations_search_idx ON private.opportunity_search_lifecycle_operations(user_id,search_id);
