-- Current desired schema: 40_relations.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.opportunity_search_merge_audit_sequence_seq
ALTER TABLE private.opportunity_search_merge_audit ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME private.opportunity_search_merge_audit_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- public.opportunity_search_preference_actions_sequence_seq
ALTER TABLE public.opportunity_search_preference_actions ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.opportunity_search_preference_actions_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- private.opportunity_search_adaptive_batches opportunity_search_adaptive_batches_pkey
ALTER TABLE ONLY private.opportunity_search_adaptive_batches
    ADD CONSTRAINT opportunity_search_adaptive_batches_pkey PRIMARY KEY (run_id, batch_id);

-- private.opportunity_search_adaptive_batches opportunity_search_adaptive_batches_run_id_ordinal_key
ALTER TABLE ONLY private.opportunity_search_adaptive_batches
    ADD CONSTRAINT opportunity_search_adaptive_batches_run_id_ordinal_key UNIQUE (run_id, ordinal);

-- private.opportunity_search_adaptive_completions opportunity_search_adaptive_completio_user_id_completion_id_key
ALTER TABLE ONLY private.opportunity_search_adaptive_completions
    ADD CONSTRAINT opportunity_search_adaptive_completio_user_id_completion_id_key UNIQUE (user_id, completion_id);

-- private.opportunity_search_adaptive_completions opportunity_search_adaptive_completions_pkey
ALTER TABLE ONLY private.opportunity_search_adaptive_completions
    ADD CONSTRAINT opportunity_search_adaptive_completions_pkey PRIMARY KEY (run_id);

-- private.opportunity_search_adaptive_contexts opportunity_search_adaptive_contexts_pkey
ALTER TABLE ONLY private.opportunity_search_adaptive_contexts
    ADD CONSTRAINT opportunity_search_adaptive_contexts_pkey PRIMARY KEY (run_id);

-- private.opportunity_search_adaptive_items opportunity_search_adaptive_items_pkey
ALTER TABLE ONLY private.opportunity_search_adaptive_items
    ADD CONSTRAINT opportunity_search_adaptive_items_pkey PRIMARY KEY (run_id, item_id);

-- private.opportunity_search_identities opportunity_search_identities_pkey
ALTER TABLE ONLY private.opportunity_search_identities
    ADD CONSTRAINT opportunity_search_identities_pkey PRIMARY KEY (identity_key);

-- private.opportunity_search_merge_audit opportunity_search_merge_audit_pkey
ALTER TABLE ONLY private.opportunity_search_merge_audit
    ADD CONSTRAINT opportunity_search_merge_audit_pkey PRIMARY KEY (sequence);

-- private.opportunity_search_merge_audit opportunity_search_merge_audit_run_id_item_id_key
ALTER TABLE ONLY private.opportunity_search_merge_audit
    ADD CONSTRAINT opportunity_search_merge_audit_run_id_item_id_key UNIQUE (run_id, item_id);

-- private.opportunity_search_merge_state opportunity_search_merge_state_pkey
ALTER TABLE ONLY private.opportunity_search_merge_state
    ADD CONSTRAINT opportunity_search_merge_state_pkey PRIMARY KEY (opportunity_id);

-- private.opportunity_search_protocols opportunity_search_protocols_pkey
ALTER TABLE ONLY private.opportunity_search_protocols
    ADD CONSTRAINT opportunity_search_protocols_pkey PRIMARY KEY (version);

-- private.opportunity_search_schedule_claims opportunity_search_schedule_claims_pkey
ALTER TABLE ONLY private.opportunity_search_schedule_claims
    ADD CONSTRAINT opportunity_search_schedule_claims_pkey PRIMARY KEY (search_id);

-- private.opportunity_search_settings opportunity_search_settings_pkey
ALTER TABLE ONLY private.opportunity_search_settings
    ADD CONSTRAINT opportunity_search_settings_pkey PRIMARY KEY (singleton);

-- private.opportunity_search_setup_acknowledgements opportunity_search_setup_acknowledgements_pkey
ALTER TABLE ONLY private.opportunity_search_setup_acknowledgements
    ADD CONSTRAINT opportunity_search_setup_acknowledgements_pkey PRIMARY KEY (setup_id);

-- private.opportunity_search_setup_operations opportunity_search_setup_operations_pkey
ALTER TABLE ONLY private.opportunity_search_setup_operations
    ADD CONSTRAINT opportunity_search_setup_operations_pkey PRIMARY KEY (setup_id);

-- public.application_refinement_proposals application_refinement_proposals_pkey
ALTER TABLE ONLY public.application_refinement_proposals
    ADD CONSTRAINT application_refinement_proposals_pkey PRIMARY KEY (id);

-- public.application_refinement_proposals application_refinement_proposals_user_id_application_id_id_key
ALTER TABLE ONLY public.application_refinement_proposals
    ADD CONSTRAINT application_refinement_proposals_user_id_application_id_id_key UNIQUE (user_id, application_id, id);

-- public.application_refinement_protocols application_refinement_protocols_pkey
ALTER TABLE ONLY public.application_refinement_protocols
    ADD CONSTRAINT application_refinement_protocols_pkey PRIMARY KEY (request_id, protocol_id);

-- public.application_refinement_requests application_refinement_requests_pkey
ALTER TABLE ONLY public.application_refinement_requests
    ADD CONSTRAINT application_refinement_requests_pkey PRIMARY KEY (id);

-- public.application_refinement_requests application_refinement_requests_user_id_application_id_id_key
ALTER TABLE ONLY public.application_refinement_requests
    ADD CONSTRAINT application_refinement_requests_user_id_application_id_id_key UNIQUE (user_id, application_id, id);

-- public.application_refinement_reviews application_refinement_reviews_pkey
ALTER TABLE ONLY public.application_refinement_reviews
    ADD CONSTRAINT application_refinement_reviews_pkey PRIMARY KEY (id);

-- public.application_refinement_state application_refinement_state_pkey
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT application_refinement_state_pkey PRIMARY KEY (application_id);

-- public.applications applications_application_code_key
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_application_code_key UNIQUE (application_code);

-- public.applications applications_pkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

-- public.applications applications_user_id_id_key
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_user_id_id_key UNIQUE (user_id, id);

-- public.applications applications_user_id_opportunity_id_key
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_user_id_opportunity_id_key UNIQUE (user_id, opportunity_id);

-- public.cv_variants cv_variants_pkey
ALTER TABLE ONLY public.cv_variants
    ADD CONSTRAINT cv_variants_pkey PRIMARY KEY (id);

-- public.cv_variants cv_variants_user_id_id_key
ALTER TABLE ONLY public.cv_variants
    ADD CONSTRAINT cv_variants_user_id_id_key UNIQUE (user_id, id);

-- public.cv_variants cv_variants_user_id_name_key
ALTER TABLE ONLY public.cv_variants
    ADD CONSTRAINT cv_variants_user_id_name_key UNIQUE (user_id, name);

-- public.local_attachment_metadata local_attachment_metadata_pkey
ALTER TABLE ONLY public.local_attachment_metadata
    ADD CONSTRAINT local_attachment_metadata_pkey PRIMARY KEY (id);

-- public.opportunities opportunities_opportunity_key_key
ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_opportunity_key_key UNIQUE (opportunity_key);

-- public.opportunities opportunities_pkey
ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);

-- public.opportunity_feedback_prediction_proofs opportunity_feedback_prediction_proofs_pkey
ALTER TABLE ONLY public.opportunity_feedback_prediction_proofs
    ADD CONSTRAINT opportunity_feedback_prediction_proofs_pkey PRIMARY KEY (user_id, source_kind, source_ref);

-- public.opportunity_reviews opportunity_reviews_pkey
ALTER TABLE ONLY public.opportunity_reviews
    ADD CONSTRAINT opportunity_reviews_pkey PRIMARY KEY (user_id, opportunity_id);

-- public.opportunity_search_adaptive_proposals opportunity_search_adaptive_proposals_pkey
ALTER TABLE ONLY public.opportunity_search_adaptive_proposals
    ADD CONSTRAINT opportunity_search_adaptive_proposals_pkey PRIMARY KEY (user_id, search_id, suggestion_id);

-- public.opportunity_search_adaptive_release opportunity_search_adaptive_release_pkey
ALTER TABLE ONLY public.opportunity_search_adaptive_release
    ADD CONSTRAINT opportunity_search_adaptive_release_pkey PRIMARY KEY (singleton);

-- public.opportunity_search_adaptive_settings opportunity_search_adaptive_settings_pkey
ALTER TABLE ONLY public.opportunity_search_adaptive_settings
    ADD CONSTRAINT opportunity_search_adaptive_settings_pkey PRIMARY KEY (user_id, search_id);

-- public.opportunity_search_dashboard_actions opportunity_search_dashboard_actions_pkey
ALTER TABLE ONLY public.opportunity_search_dashboard_actions
    ADD CONSTRAINT opportunity_search_dashboard_actions_pkey PRIMARY KEY (user_id, search_id, action_id);

-- public.opportunity_search_discoveries opportunity_search_discoveries_pkey
ALTER TABLE ONLY public.opportunity_search_discoveries
    ADD CONSTRAINT opportunity_search_discoveries_pkey PRIMARY KEY (discovery_id);

-- public.opportunity_search_discoveries opportunity_search_discoveries_run_id_item_id_key
ALTER TABLE ONLY public.opportunity_search_discoveries
    ADD CONSTRAINT opportunity_search_discoveries_run_id_item_id_key UNIQUE (run_id, item_id);

-- public.opportunity_search_execution_receipts opportunity_search_execution_receipts_pkey
ALTER TABLE ONLY public.opportunity_search_execution_receipts
    ADD CONSTRAINT opportunity_search_execution_receipts_pkey PRIMARY KEY (run_id, report_id);

-- public.opportunity_search_executions opportunity_search_executions_pkey
ALTER TABLE ONLY public.opportunity_search_executions
    ADD CONSTRAINT opportunity_search_executions_pkey PRIMARY KEY (run_id, check_id);

-- public.opportunity_search_feedback_snapshots opportunity_search_feedback_s_user_id_search_id_input_finge_key
ALTER TABLE ONLY public.opportunity_search_feedback_snapshots
    ADD CONSTRAINT opportunity_search_feedback_s_user_id_search_id_input_finge_key UNIQUE (user_id, search_id, input_fingerprint);

-- public.opportunity_search_feedback_snapshots opportunity_search_feedback_snapshots_pkey
ALTER TABLE ONLY public.opportunity_search_feedback_snapshots
    ADD CONSTRAINT opportunity_search_feedback_snapshots_pkey PRIMARY KEY (user_id, search_id, feedback_revision);

-- public.opportunity_search_preference_actions opportunity_search_preference_actions_pkey
ALTER TABLE ONLY public.opportunity_search_preference_actions
    ADD CONSTRAINT opportunity_search_preference_actions_pkey PRIMARY KEY (user_id, search_id, operation_id);

-- public.opportunity_search_preference_suggestions opportunity_search_preference_suggestions_pkey
ALTER TABLE ONLY public.opportunity_search_preference_suggestions
    ADD CONSTRAINT opportunity_search_preference_suggestions_pkey PRIMARY KEY (user_id, search_id, suggestion_id);

-- public.opportunity_search_query_plans opportunity_search_query_plan_user_id_search_id_plan_revisi_key
ALTER TABLE ONLY public.opportunity_search_query_plans
    ADD CONSTRAINT opportunity_search_query_plan_user_id_search_id_plan_revisi_key UNIQUE (user_id, search_id, plan_revision);

-- public.opportunity_search_query_plans opportunity_search_query_plans_pkey
ALTER TABLE ONLY public.opportunity_search_query_plans
    ADD CONSTRAINT opportunity_search_query_plans_pkey PRIMARY KEY (id);

-- public.opportunity_search_query_plans opportunity_search_query_plans_user_id_search_id_id_key
ALTER TABLE ONLY public.opportunity_search_query_plans
    ADD CONSTRAINT opportunity_search_query_plans_user_id_search_id_id_key UNIQUE (user_id, search_id, id);

-- public.opportunity_search_query_plans opportunity_search_query_plans_user_id_search_id_plan_hash_key
ALTER TABLE ONLY public.opportunity_search_query_plans
    ADD CONSTRAINT opportunity_search_query_plans_user_id_search_id_plan_hash_key UNIQUE (user_id, search_id, plan_hash);

-- public.opportunity_search_query_revisions opportunity_search_query_revi_search_id_template_revision_p_key
ALTER TABLE ONLY public.opportunity_search_query_revisions
    ADD CONSTRAINT opportunity_search_query_revi_search_id_template_revision_p_key UNIQUE (search_id, template_revision, protocol_version);

-- public.opportunity_search_query_revisions opportunity_search_query_revision_owner_id
ALTER TABLE ONLY public.opportunity_search_query_revisions
    ADD CONSTRAINT opportunity_search_query_revision_owner_id UNIQUE (user_id, search_id, id);

-- public.opportunity_search_query_revisions opportunity_search_query_revisions_pkey
ALTER TABLE ONLY public.opportunity_search_query_revisions
    ADD CONSTRAINT opportunity_search_query_revisions_pkey PRIMARY KEY (id);

-- public.opportunity_search_receipts opportunity_search_receipts_pkey
ALTER TABLE ONLY public.opportunity_search_receipts
    ADD CONSTRAINT opportunity_search_receipts_pkey PRIMARY KEY (run_id, item_id);

-- public.opportunity_search_rollback_requests opportunity_search_rollback_r_user_id_search_id_rollback_re_key
ALTER TABLE ONLY public.opportunity_search_rollback_requests
    ADD CONSTRAINT opportunity_search_rollback_r_user_id_search_id_rollback_re_key UNIQUE (user_id, search_id, rollback_revision);

-- public.opportunity_search_rollback_requests opportunity_search_rollback_requests_pkey
ALTER TABLE ONLY public.opportunity_search_rollback_requests
    ADD CONSTRAINT opportunity_search_rollback_requests_pkey PRIMARY KEY (user_id, search_id, rollback_id);

-- public.opportunity_search_runs opportunity_search_run_owner_search
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_search_run_owner_search UNIQUE (user_id, search_id, id);

-- public.opportunity_search_runner_authorizations opportunity_search_runner_authorizations_pkey
ALTER TABLE ONLY public.opportunity_search_runner_authorizations
    ADD CONSTRAINT opportunity_search_runner_authorizations_pkey PRIMARY KEY (user_id, search_id);

-- public.opportunity_search_runner_authorizations opportunity_search_runner_authorizations_search_id_key
ALTER TABLE ONLY public.opportunity_search_runner_authorizations
    ADD CONSTRAINT opportunity_search_runner_authorizations_search_id_key UNIQUE (search_id);

-- public.opportunity_search_runner_config opportunity_search_runner_config_pkey
ALTER TABLE ONLY public.opportunity_search_runner_config
    ADD CONSTRAINT opportunity_search_runner_config_pkey PRIMARY KEY (search_id);

-- public.opportunity_search_runs opportunity_search_runs_pkey
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_search_runs_pkey PRIMARY KEY (id);

-- public.opportunity_search_runs opportunity_search_runs_user_id_id_key
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_search_runs_user_id_id_key UNIQUE (user_id, id);

-- public.opportunity_search_schedule_bindings opportunity_search_schedule_bindings_pkey
ALTER TABLE ONLY public.opportunity_search_schedule_bindings
    ADD CONSTRAINT opportunity_search_schedule_bindings_pkey PRIMARY KEY (search_id);

-- public.opportunity_search_schedule_bindings opportunity_search_schedule_bindings_task_id_key
ALTER TABLE ONLY public.opportunity_search_schedule_bindings
    ADD CONSTRAINT opportunity_search_schedule_bindings_task_id_key UNIQUE (task_id);

-- public.opportunity_search_setup_claims opportunity_search_setup_claims_pkey
ALTER TABLE ONLY public.opportunity_search_setup_claims
    ADD CONSTRAINT opportunity_search_setup_claims_pkey PRIMARY KEY (search_id);

-- public.opportunity_search_setup_claims opportunity_search_setup_claims_setup_id_key
ALTER TABLE ONLY public.opportunity_search_setup_claims
    ADD CONSTRAINT opportunity_search_setup_claims_setup_id_key UNIQUE (setup_id);

-- public.opportunity_search_sources opportunity_search_sources_pkey
ALTER TABLE ONLY public.opportunity_search_sources
    ADD CONSTRAINT opportunity_search_sources_pkey PRIMARY KEY (registry_id);

-- public.opportunity_search_sources opportunity_search_sources_user_id_search_id_registry_id_key
ALTER TABLE ONLY public.opportunity_search_sources
    ADD CONSTRAINT opportunity_search_sources_user_id_search_id_registry_id_key UNIQUE (user_id, search_id, registry_id);

-- public.opportunity_search_templates opportunity_search_templates_pkey
ALTER TABLE ONLY public.opportunity_search_templates
    ADD CONSTRAINT opportunity_search_templates_pkey PRIMARY KEY (id);

-- public.opportunity_search_templates opportunity_search_templates_user_id_id_key
ALTER TABLE ONLY public.opportunity_search_templates
    ADD CONSTRAINT opportunity_search_templates_user_id_id_key UNIQUE (user_id, id);

-- private.opportunity_adaptive_context_lease
CREATE INDEX opportunity_adaptive_context_lease ON private.opportunity_search_adaptive_contexts USING btree (user_id, search_id, lease_expires_at);

-- private.opportunity_search_identities_opportunity
CREATE INDEX opportunity_search_identities_opportunity ON private.opportunity_search_identities USING btree (opportunity_id);

-- private.opportunity_search_merge_audit_opportunity
CREATE INDEX opportunity_search_merge_audit_opportunity ON private.opportunity_search_merge_audit USING btree (opportunity_id);

-- private.opportunity_search_merge_audit_run
CREATE INDEX opportunity_search_merge_audit_run ON private.opportunity_search_merge_audit USING btree (run_id, sequence DESC);

-- private.opportunity_search_schedule_claim_run
CREATE INDEX opportunity_search_schedule_claim_run ON private.opportunity_search_schedule_claims USING btree (run_id);

-- public.application_refinement_protocols_owner_request_idx
CREATE INDEX application_refinement_protocols_owner_request_idx ON public.application_refinement_protocols USING btree (user_id, application_id, request_id);

-- public.applications_cv_variant_idx
CREATE INDEX applications_cv_variant_idx ON public.applications USING btree (user_id, cv_variant_id);

-- public.applications_opportunity_idx
CREATE INDEX applications_opportunity_idx ON public.applications USING btree (opportunity_id);

-- public.applications_recent_idx
CREATE INDEX applications_recent_idx ON public.applications USING btree (user_id, updated_at DESC);

-- public.cv_variants_parent_idx
CREATE INDEX cv_variants_parent_idx ON public.cv_variants USING btree (user_id, parent_variant_id);

-- public.cv_variants_recent_idx
CREATE INDEX cv_variants_recent_idx ON public.cv_variants USING btree (user_id, created_at DESC);

-- public.local_attachment_metadata_user_idx
CREATE INDEX local_attachment_metadata_user_idx ON public.local_attachment_metadata USING btree (user_id);

-- public.opportunity_discovery_assessment_candidates
CREATE INDEX opportunity_discovery_assessment_candidates ON public.opportunity_search_discoveries USING btree (user_id, opportunity_id, assessment_recorded_at DESC) WHERE (assessment_verified_at IS NOT NULL);

-- public.opportunity_discovery_owner_search
CREATE INDEX opportunity_discovery_owner_search ON public.opportunity_search_discoveries USING btree (user_id, search_id);

-- public.opportunity_execution_owner_search
CREATE INDEX opportunity_execution_owner_search ON public.opportunity_search_executions USING btree (user_id, search_id);

-- public.opportunity_execution_receipt_owner
CREATE INDEX opportunity_execution_receipt_owner ON public.opportunity_search_execution_receipts USING btree (user_id, search_id);

-- public.opportunity_feedback_prediction_proofs_candidate
CREATE INDEX opportunity_feedback_prediction_proofs_candidate ON public.opportunity_feedback_prediction_proofs USING btree (user_id, opportunity_id, recorded_at, discovery_id) WHERE (source_kind = 'discovery_assessment'::text);

-- public.opportunity_feedback_prediction_proofs_item
CREATE INDEX opportunity_feedback_prediction_proofs_item ON public.opportunity_feedback_prediction_proofs USING btree (run_id, item_id);

-- public.opportunity_preference_action_revision
CREATE INDEX opportunity_preference_action_revision ON public.opportunity_search_preference_actions USING btree (user_id, search_id, preference_revision DESC, sequence DESC);

-- public.opportunity_preference_action_suggestion
CREATE INDEX opportunity_preference_action_suggestion ON public.opportunity_search_preference_actions USING btree (user_id, search_id, suggestion_id, sequence DESC);

-- public.opportunity_primary_discovery
CREATE UNIQUE INDEX opportunity_primary_discovery ON public.opportunity_search_discoveries USING btree (user_id, opportunity_id) WHERE primary_discovery;

-- public.opportunity_reviews_opportunity_idx
CREATE INDEX opportunity_reviews_opportunity_idx ON public.opportunity_reviews USING btree (opportunity_id);

-- public.opportunity_search_application_url_idx
CREATE INDEX opportunity_search_application_url_idx ON public.opportunities USING btree (private.opportunity_search_normalize_url(application_url));

-- public.opportunity_search_official_url_idx
CREATE INDEX opportunity_search_official_url_idx ON public.opportunities USING btree (private.opportunity_search_normalize_url(official_url));

-- public.opportunity_search_queries_owner
CREATE INDEX opportunity_search_queries_owner ON public.opportunity_search_query_revisions USING btree (user_id, search_id);

-- public.opportunity_search_receipts_opportunity
CREATE INDEX opportunity_search_receipts_opportunity ON public.opportunity_search_receipts USING btree (opportunity_id);

-- public.opportunity_search_receipts_owner
CREATE INDEX opportunity_search_receipts_owner ON public.opportunity_search_receipts USING btree (user_id, run_id);

-- public.opportunity_search_runs_owner_recent
CREATE INDEX opportunity_search_runs_owner_recent ON public.opportunity_search_runs USING btree (user_id, search_id, created_at DESC);

-- public.opportunity_search_schedule_owner
CREATE INDEX opportunity_search_schedule_owner ON public.opportunity_search_schedule_bindings USING btree (user_id);

-- public.opportunity_search_source_url_idx
CREATE INDEX opportunity_search_source_url_idx ON public.opportunities USING btree (private.opportunity_search_normalize_url(source_url));

-- public.opportunity_search_sources_listing
CREATE UNIQUE INDEX opportunity_search_sources_listing ON public.opportunity_search_sources USING btree (user_id, search_id, listing_url) WHERE (listing_url IS NOT NULL);

-- public.opportunity_search_templates_owner_recent
CREATE INDEX opportunity_search_templates_owner_recent ON public.opportunity_search_templates USING btree (user_id, updated_at DESC);

-- public.opportunity_search_vacancy_idx
CREATE INDEX opportunity_search_vacancy_idx ON public.opportunities USING btree (lower(btrim(institution)), lower(btrim(vacancy_id))) WHERE (vacancy_id IS NOT NULL);

-- public.refinement_proposals_request_idx
CREATE INDEX refinement_proposals_request_idx ON public.application_refinement_proposals USING btree (user_id, application_id, request_id, created_at, id);

-- public.refinement_requests_recent_idx
CREATE INDEX refinement_requests_recent_idx ON public.application_refinement_requests USING btree (user_id, application_id, created_at, id);

-- public.refinement_reviews_recent_idx
CREATE INDEX refinement_reviews_recent_idx ON public.application_refinement_reviews USING btree (user_id, application_id, created_at, id);

-- public.refinement_reviews_request_idx
CREATE INDEX refinement_reviews_request_idx ON public.application_refinement_reviews USING btree (user_id, application_id, request_id);

-- public.refinement_state_cv_request_idx
CREATE INDEX refinement_state_cv_request_idx ON public.application_refinement_state USING btree (user_id, application_id, current_cv_request_id);

-- public.refinement_state_letter_request_idx
CREATE INDEX refinement_state_letter_request_idx ON public.application_refinement_state USING btree (user_id, application_id, current_letter_request_id);

-- public.refinement_state_owner_idx
CREATE INDEX refinement_state_owner_idx ON public.application_refinement_state USING btree (user_id, application_id, current_request_id);

-- private.opportunity_search_adaptive_batches opportunity_search_adaptive_batches_run_id_fkey
ALTER TABLE ONLY private.opportunity_search_adaptive_batches
    ADD CONSTRAINT opportunity_search_adaptive_batches_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.opportunity_search_runs(id) ON DELETE CASCADE;

-- private.opportunity_search_adaptive_completions opportunity_search_adaptive_compl_user_id_search_id_run_id_fkey
ALTER TABLE ONLY private.opportunity_search_adaptive_completions
    ADD CONSTRAINT opportunity_search_adaptive_compl_user_id_search_id_run_id_fkey FOREIGN KEY (user_id, search_id, run_id) REFERENCES public.opportunity_search_runs(user_id, search_id, id) ON DELETE CASCADE;

-- private.opportunity_search_adaptive_contexts opportunity_search_adaptive_conte_user_id_search_id_run_id_fkey
ALTER TABLE ONLY private.opportunity_search_adaptive_contexts
    ADD CONSTRAINT opportunity_search_adaptive_conte_user_id_search_id_run_id_fkey FOREIGN KEY (user_id, search_id, run_id) REFERENCES public.opportunity_search_runs(user_id, search_id, id) ON DELETE CASCADE;

-- private.opportunity_search_adaptive_items opportunity_search_adaptive_items_run_id_batch_id_fkey
ALTER TABLE ONLY private.opportunity_search_adaptive_items
    ADD CONSTRAINT opportunity_search_adaptive_items_run_id_batch_id_fkey FOREIGN KEY (run_id, batch_id) REFERENCES private.opportunity_search_adaptive_batches(run_id, batch_id) ON DELETE CASCADE;

-- private.opportunity_search_identities opportunity_search_identities_opportunity_id_fkey
ALTER TABLE ONLY private.opportunity_search_identities
    ADD CONSTRAINT opportunity_search_identities_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;

-- private.opportunity_search_merge_audit opportunity_search_merge_audit_opportunity_id_fkey
ALTER TABLE ONLY private.opportunity_search_merge_audit
    ADD CONSTRAINT opportunity_search_merge_audit_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE RESTRICT;

-- private.opportunity_search_merge_state opportunity_search_merge_state_opportunity_id_fkey
ALTER TABLE ONLY private.opportunity_search_merge_state
    ADD CONSTRAINT opportunity_search_merge_state_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE RESTRICT;

-- private.opportunity_search_schedule_claims opportunity_search_schedule_claims_run_id_fkey
ALTER TABLE ONLY private.opportunity_search_schedule_claims
    ADD CONSTRAINT opportunity_search_schedule_claims_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.opportunity_search_runs(id) ON DELETE CASCADE;

-- private.opportunity_search_schedule_claims opportunity_search_schedule_claims_search_id_fkey
ALTER TABLE ONLY private.opportunity_search_schedule_claims
    ADD CONSTRAINT opportunity_search_schedule_claims_search_id_fkey FOREIGN KEY (search_id) REFERENCES public.opportunity_search_templates(id) ON DELETE CASCADE;

-- private.opportunity_search_settings opportunity_search_settings_active_protocol_version_fkey
ALTER TABLE ONLY private.opportunity_search_settings
    ADD CONSTRAINT opportunity_search_settings_active_protocol_version_fkey FOREIGN KEY (active_protocol_version) REFERENCES private.opportunity_search_protocols(version);

-- private.opportunity_search_setup_acknowledgements opportunity_search_setup_acknowledgements_setup_id_fkey
ALTER TABLE ONLY private.opportunity_search_setup_acknowledgements
    ADD CONSTRAINT opportunity_search_setup_acknowledgements_setup_id_fkey FOREIGN KEY (setup_id) REFERENCES private.opportunity_search_setup_operations(setup_id) ON DELETE CASCADE;

-- private.opportunity_search_setup_operations opportunity_search_setup_operations_user_id_search_id_fkey
ALTER TABLE ONLY private.opportunity_search_setup_operations
    ADD CONSTRAINT opportunity_search_setup_operations_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.application_refinement_proposals application_refinement_propos_user_id_application_id_reque_fkey
ALTER TABLE ONLY public.application_refinement_proposals
    ADD CONSTRAINT application_refinement_propos_user_id_application_id_reque_fkey FOREIGN KEY (user_id, application_id, request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) ON DELETE CASCADE;

-- public.application_refinement_proposals application_refinement_proposals_user_id_fkey
ALTER TABLE ONLY public.application_refinement_proposals
    ADD CONSTRAINT application_refinement_proposals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.application_refinement_protocols application_refinement_protoc_user_id_application_id_reque_fkey
ALTER TABLE ONLY public.application_refinement_protocols
    ADD CONSTRAINT application_refinement_protoc_user_id_application_id_reque_fkey FOREIGN KEY (user_id, application_id, request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) ON DELETE CASCADE;

-- public.application_refinement_requests application_refinement_requests_user_id_application_id_fkey
ALTER TABLE ONLY public.application_refinement_requests
    ADD CONSTRAINT application_refinement_requests_user_id_application_id_fkey FOREIGN KEY (user_id, application_id) REFERENCES public.applications(user_id, id) ON DELETE CASCADE;

-- public.application_refinement_requests application_refinement_requests_user_id_fkey
ALTER TABLE ONLY public.application_refinement_requests
    ADD CONSTRAINT application_refinement_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.application_refinement_reviews application_refinement_review_user_id_application_id_reque_fkey
ALTER TABLE ONLY public.application_refinement_reviews
    ADD CONSTRAINT application_refinement_review_user_id_application_id_reque_fkey FOREIGN KEY (user_id, application_id, request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) ON DELETE CASCADE;

-- public.application_refinement_reviews application_refinement_reviews_user_id_application_id_fkey
ALTER TABLE ONLY public.application_refinement_reviews
    ADD CONSTRAINT application_refinement_reviews_user_id_application_id_fkey FOREIGN KEY (user_id, application_id) REFERENCES public.applications(user_id, id) ON DELETE CASCADE;

-- public.application_refinement_reviews application_refinement_reviews_user_id_fkey
ALTER TABLE ONLY public.application_refinement_reviews
    ADD CONSTRAINT application_refinement_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.application_refinement_state application_refinement_state_user_id_application_id_fkey
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT application_refinement_state_user_id_application_id_fkey FOREIGN KEY (user_id, application_id) REFERENCES public.applications(user_id, id) ON DELETE CASCADE;

-- public.application_refinement_state application_refinement_state_user_id_fkey
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT application_refinement_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.applications applications_opportunity_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE RESTRICT;

-- public.applications applications_user_id_cv_variant_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_user_id_cv_variant_id_fkey FOREIGN KEY (user_id, cv_variant_id) REFERENCES public.cv_variants(user_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.applications applications_user_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.cv_variants cv_variants_user_id_fkey
ALTER TABLE ONLY public.cv_variants
    ADD CONSTRAINT cv_variants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.cv_variants cv_variants_user_id_parent_variant_id_fkey
ALTER TABLE ONLY public.cv_variants
    ADD CONSTRAINT cv_variants_user_id_parent_variant_id_fkey FOREIGN KEY (user_id, parent_variant_id) REFERENCES public.cv_variants(user_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.local_attachment_metadata local_attachment_metadata_user_id_fkey
ALTER TABLE ONLY public.local_attachment_metadata
    ADD CONSTRAINT local_attachment_metadata_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.opportunity_feedback_prediction_proofs opportunity_feedback_prediction_proofs_user_id_fkey
ALTER TABLE ONLY public.opportunity_feedback_prediction_proofs
    ADD CONSTRAINT opportunity_feedback_prediction_proofs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.opportunity_reviews opportunity_reviews_opportunity_id_fkey
ALTER TABLE ONLY public.opportunity_reviews
    ADD CONSTRAINT opportunity_reviews_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;

-- public.opportunity_reviews opportunity_reviews_user_id_fkey
ALTER TABLE ONLY public.opportunity_reviews
    ADD CONSTRAINT opportunity_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.opportunity_search_runs opportunity_run_query_plan_owner
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_run_query_plan_owner FOREIGN KEY (user_id, search_id, query_plan_id) REFERENCES public.opportunity_search_query_plans(user_id, search_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.opportunity_search_adaptive_proposals opportunity_search_adaptive_proposals_run_id_batch_id_fkey
ALTER TABLE ONLY public.opportunity_search_adaptive_proposals
    ADD CONSTRAINT opportunity_search_adaptive_proposals_run_id_batch_id_fkey FOREIGN KEY (run_id, batch_id) REFERENCES private.opportunity_search_adaptive_batches(run_id, batch_id) ON DELETE CASCADE;

-- public.opportunity_search_adaptive_proposals opportunity_search_adaptive_proposals_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_adaptive_proposals
    ADD CONSTRAINT opportunity_search_adaptive_proposals_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.opportunity_search_runs(id) ON DELETE CASCADE;

-- public.opportunity_search_adaptive_proposals opportunity_search_adaptive_proposals_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_adaptive_proposals
    ADD CONSTRAINT opportunity_search_adaptive_proposals_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_adaptive_settings opportunity_search_adaptive_settings_user_id_fkey
ALTER TABLE ONLY public.opportunity_search_adaptive_settings
    ADD CONSTRAINT opportunity_search_adaptive_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.opportunity_search_adaptive_settings opportunity_search_adaptive_settings_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_adaptive_settings
    ADD CONSTRAINT opportunity_search_adaptive_settings_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_adaptive_settings opportunity_search_current_plan_owner
ALTER TABLE ONLY public.opportunity_search_adaptive_settings
    ADD CONSTRAINT opportunity_search_current_plan_owner FOREIGN KEY (user_id, search_id, query_plan_id) REFERENCES public.opportunity_search_query_plans(user_id, search_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.opportunity_search_dashboard_actions opportunity_search_dashboard_actions_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_dashboard_actions
    ADD CONSTRAINT opportunity_search_dashboard_actions_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_discoveries opportunity_search_discoveries_run_id_item_id_fkey
ALTER TABLE ONLY public.opportunity_search_discoveries
    ADD CONSTRAINT opportunity_search_discoveries_run_id_item_id_fkey FOREIGN KEY (run_id, item_id) REFERENCES public.opportunity_search_receipts(run_id, item_id) ON DELETE CASCADE;

-- public.opportunity_search_discoveries opportunity_search_discoveries_user_id_search_id_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_discoveries
    ADD CONSTRAINT opportunity_search_discoveries_user_id_search_id_run_id_fkey FOREIGN KEY (user_id, search_id, run_id) REFERENCES public.opportunity_search_runs(user_id, search_id, id) ON DELETE CASCADE;

-- public.opportunity_search_execution_receipts opportunity_search_execution_rece_user_id_search_id_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_execution_receipts
    ADD CONSTRAINT opportunity_search_execution_rece_user_id_search_id_run_id_fkey FOREIGN KEY (user_id, search_id, run_id) REFERENCES public.opportunity_search_runs(user_id, search_id, id) ON DELETE CASCADE;

-- public.opportunity_search_executions opportunity_search_executions_user_id_search_id_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_executions
    ADD CONSTRAINT opportunity_search_executions_user_id_search_id_run_id_fkey FOREIGN KEY (user_id, search_id, run_id) REFERENCES public.opportunity_search_runs(user_id, search_id, id) ON DELETE CASCADE;

-- public.opportunity_search_feedback_snapshots opportunity_search_feedback_snapshots_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_feedback_snapshots
    ADD CONSTRAINT opportunity_search_feedback_snapshots_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_adaptive_settings(user_id, search_id) ON DELETE CASCADE;

-- public.opportunity_search_preference_suggestions opportunity_search_preference_suggestion_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_preference_suggestions
    ADD CONSTRAINT opportunity_search_preference_suggestion_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_preference_actions opportunity_search_preference_user_id_search_id_suggestion_fkey
ALTER TABLE ONLY public.opportunity_search_preference_actions
    ADD CONSTRAINT opportunity_search_preference_user_id_search_id_suggestion_fkey FOREIGN KEY (user_id, search_id, suggestion_id) REFERENCES public.opportunity_search_preference_suggestions(user_id, search_id, suggestion_id) ON DELETE CASCADE;

-- public.opportunity_search_query_plans opportunity_search_query_plan_user_id_search_id_query_revi_fkey
ALTER TABLE ONLY public.opportunity_search_query_plans
    ADD CONSTRAINT opportunity_search_query_plan_user_id_search_id_query_revi_fkey FOREIGN KEY (user_id, search_id, query_revision_id) REFERENCES public.opportunity_search_query_revisions(user_id, search_id, id) ON DELETE CASCADE;

-- public.opportunity_search_query_revisions opportunity_search_query_revisions_protocol_version_fkey
ALTER TABLE ONLY public.opportunity_search_query_revisions
    ADD CONSTRAINT opportunity_search_query_revisions_protocol_version_fkey FOREIGN KEY (protocol_version) REFERENCES private.opportunity_search_protocols(version);

-- public.opportunity_search_query_revisions opportunity_search_query_revisions_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_query_revisions
    ADD CONSTRAINT opportunity_search_query_revisions_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_receipts opportunity_search_receipts_opportunity_id_fkey
ALTER TABLE ONLY public.opportunity_search_receipts
    ADD CONSTRAINT opportunity_search_receipts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE RESTRICT;

-- public.opportunity_search_receipts opportunity_search_receipts_user_id_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_receipts
    ADD CONSTRAINT opportunity_search_receipts_user_id_run_id_fkey FOREIGN KEY (user_id, run_id) REFERENCES public.opportunity_search_runs(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_rollback_requests opportunity_search_rollback_requests_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_rollback_requests
    ADD CONSTRAINT opportunity_search_rollback_requests_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_runner_authorizations opportunity_search_runner_authorizations_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_runner_authorizations
    ADD CONSTRAINT opportunity_search_runner_authorizations_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_runner_config opportunity_search_runner_config_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_runner_config
    ADD CONSTRAINT opportunity_search_runner_config_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_runs opportunity_search_runs_protocol_version_fkey
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_search_runs_protocol_version_fkey FOREIGN KEY (protocol_version) REFERENCES private.opportunity_search_protocols(version);

-- public.opportunity_search_runs opportunity_search_runs_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_runs
    ADD CONSTRAINT opportunity_search_runs_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_schedule_bindings opportunity_search_schedule_bindings_confirmed_run_id_fkey
ALTER TABLE ONLY public.opportunity_search_schedule_bindings
    ADD CONSTRAINT opportunity_search_schedule_bindings_confirmed_run_id_fkey FOREIGN KEY (confirmed_run_id) REFERENCES public.opportunity_search_runs(id);

-- public.opportunity_search_schedule_bindings opportunity_search_schedule_bindings_protocol_version_fkey
ALTER TABLE ONLY public.opportunity_search_schedule_bindings
    ADD CONSTRAINT opportunity_search_schedule_bindings_protocol_version_fkey FOREIGN KEY (protocol_version) REFERENCES private.opportunity_search_protocols(version);

-- public.opportunity_search_schedule_bindings opportunity_search_schedule_bindings_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_schedule_bindings
    ADD CONSTRAINT opportunity_search_schedule_bindings_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_setup_claims opportunity_search_setup_claims_setup_id_fkey
ALTER TABLE ONLY public.opportunity_search_setup_claims
    ADD CONSTRAINT opportunity_search_setup_claims_setup_id_fkey FOREIGN KEY (setup_id) REFERENCES private.opportunity_search_setup_operations(setup_id) ON DELETE CASCADE;

-- public.opportunity_search_setup_claims opportunity_search_setup_claims_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_setup_claims
    ADD CONSTRAINT opportunity_search_setup_claims_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_sources opportunity_search_sources_user_id_search_id_fkey
ALTER TABLE ONLY public.opportunity_search_sources
    ADD CONSTRAINT opportunity_search_sources_user_id_search_id_fkey FOREIGN KEY (user_id, search_id) REFERENCES public.opportunity_search_templates(user_id, id) ON DELETE CASCADE;

-- public.opportunity_search_templates opportunity_search_templates_user_id_fkey
ALTER TABLE ONLY public.opportunity_search_templates
    ADD CONSTRAINT opportunity_search_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- public.application_refinement_state refinement_current_cv_request_fk
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT refinement_current_cv_request_fk FOREIGN KEY (user_id, application_id, current_cv_request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.application_refinement_state refinement_current_letter_request_fk
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT refinement_current_letter_request_fk FOREIGN KEY (user_id, application_id, current_letter_request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) DEFERRABLE INITIALLY DEFERRED;

-- public.application_refinement_state refinement_current_request_fk
ALTER TABLE ONLY public.application_refinement_state
    ADD CONSTRAINT refinement_current_request_fk FOREIGN KEY (user_id, application_id, current_request_id) REFERENCES public.application_refinement_requests(user_id, application_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE private.opportunity_search_lifecycle_operations
  ADD CONSTRAINT opportunity_search_lifecycle_owner_search_fkey FOREIGN KEY (user_id,search_id)
  REFERENCES public.opportunity_search_templates(user_id,id) ON DELETE CASCADE;
ALTER TABLE private.opportunity_search_lifecycle_operations
  ADD CONSTRAINT opportunity_search_lifecycle_target_scope_fkey FOREIGN KEY (user_id,search_id,target_run_id)
  REFERENCES public.opportunity_search_runs(user_id,search_id,id) ON DELETE CASCADE;

-- Replacement startup creates the referenced run later in the same transaction.
-- Keep the fence if a caller tries to delete only the replacement run.
ALTER TABLE public.opportunity_search_runs
  ADD CONSTRAINT opportunity_search_runs_superseded_scope_fkey FOREIGN KEY (user_id,search_id,superseded_by_run_id)
  REFERENCES public.opportunity_search_runs(user_id,search_id,id) DEFERRABLE INITIALLY DEFERRED;
