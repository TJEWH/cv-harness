-- Current desired schema: 50_triggers.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.opportunity_search_adaptive_batches adaptive_batches_immutable
CREATE TRIGGER adaptive_batches_immutable BEFORE UPDATE ON private.opportunity_search_adaptive_batches FOR EACH ROW EXECUTE FUNCTION private.adaptive_batch_immutable();

-- private.opportunity_search_adaptive_contexts adaptive_context_plan_pointer
CREATE TRIGGER adaptive_context_plan_pointer BEFORE INSERT ON private.opportunity_search_adaptive_contexts FOR EACH ROW EXECUTE FUNCTION private.capture_adaptive_plan_pointer();

-- private.opportunity_search_adaptive_items adaptive_items_immutable
CREATE TRIGGER adaptive_items_immutable BEFORE UPDATE ON private.opportunity_search_adaptive_items FOR EACH ROW EXECUTE FUNCTION private.adaptive_batch_immutable();

-- private.opportunity_search_schedule_claims legacy_search_setup_claim_guard
CREATE TRIGGER legacy_search_setup_claim_guard BEFORE INSERT ON private.opportunity_search_schedule_claims FOR EACH ROW EXECUTE FUNCTION private.guard_legacy_search_setup_claim();

-- private.opportunity_search_adaptive_completions opportunity_adaptive_completion_immutable
CREATE TRIGGER opportunity_adaptive_completion_immutable BEFORE UPDATE ON private.opportunity_search_adaptive_completions FOR EACH ROW EXECUTE FUNCTION private.opportunity_search_adaptive_completion_immutable();

-- private.opportunity_search_merge_audit opportunity_assessment_rollback
CREATE TRIGGER opportunity_assessment_rollback AFTER DELETE OR UPDATE OF rolled_back_at ON private.opportunity_search_merge_audit FOR EACH ROW EXECUTE FUNCTION private.invalidate_opportunity_assessment_proof();

-- private.opportunity_search_merge_audit opportunity_feedback_prediction_audit
CREATE TRIGGER opportunity_feedback_prediction_audit AFTER INSERT OR DELETE OR UPDATE ON private.opportunity_search_merge_audit FOR EACH ROW EXECUTE FUNCTION private.maintain_opportunity_feedback_prediction_proofs();

-- private.opportunity_search_protocols opportunity_search_protocol_immutable
CREATE TRIGGER opportunity_search_protocol_immutable BEFORE DELETE OR UPDATE ON private.opportunity_search_protocols FOR EACH ROW EXECUTE FUNCTION private.immutable_opportunity_search_record();

-- public.opportunity_search_runner_config adaptive_search_runner_config_guard
CREATE TRIGGER adaptive_search_runner_config_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_runner_config FOR EACH ROW EXECUTE FUNCTION public.guard_adaptive_search_runner_config();

-- public.opportunity_search_schedule_bindings adaptive_task_binding_guard
CREATE TRIGGER adaptive_task_binding_guard BEFORE UPDATE ON public.opportunity_search_schedule_bindings FOR EACH ROW EXECUTE FUNCTION private.guard_adaptive_task_binding();

-- public.applications applications_application_code
CREATE TRIGGER applications_application_code BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_assign_application_code();

-- public.applications applications_capture_context
CREATE TRIGGER applications_capture_context BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_capture_application_context();

-- public.applications applications_feedback_invalidate
CREATE TRIGGER applications_feedback_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_feedback_invalidation();

-- public.applications applications_stage_state
CREATE TRIGGER applications_stage_state BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_track_stage();

-- public.applications applications_status_history
CREATE TRIGGER applications_status_history BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_record_status();

-- public.applications applications_updated_at
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.job_workspace_touch_updated_at();

-- public.cv_variants cv_variants_preserve_snapshot
CREATE TRIGGER cv_variants_preserve_snapshot BEFORE UPDATE ON public.cv_variants FOR EACH ROW EXECUTE FUNCTION public.job_workspace_guard_cv_snapshot();

-- public.cv_variants cv_variants_updated_at
CREATE TRIGGER cv_variants_updated_at BEFORE UPDATE ON public.cv_variants FOR EACH ROW EXECUTE FUNCTION public.job_workspace_touch_updated_at();

-- public.opportunity_search_templates guard_opportunity_meta_search
CREATE TRIGGER guard_opportunity_meta_search BEFORE INSERT OR UPDATE ON public.opportunity_search_templates FOR EACH ROW EXECUTE FUNCTION private.guard_opportunity_meta_search();

-- public.opportunity_search_adaptive_settings opportunity_adaptation_settings
CREATE TRIGGER opportunity_adaptation_settings BEFORE INSERT OR UPDATE ON public.opportunity_search_adaptive_settings FOR EACH ROW EXECUTE FUNCTION public.job_workspace_adaptation_settings();

-- public.opportunity_search_adaptive_release opportunity_adaptive_release_guard
CREATE TRIGGER opportunity_adaptive_release_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_adaptive_release FOR EACH ROW EXECUTE FUNCTION public.job_workspace_adaptive_release();

-- public.opportunity_search_runs opportunity_adaptive_run_pins
CREATE TRIGGER opportunity_adaptive_run_pins BEFORE INSERT OR UPDATE ON public.opportunity_search_runs FOR EACH ROW EXECUTE FUNCTION public.job_workspace_adaptive_run_pins();

-- public.opportunity_search_discoveries opportunity_assessment_invalidate_feedback
CREATE TRIGGER opportunity_assessment_invalidate_feedback AFTER DELETE OR UPDATE ON public.opportunity_search_discoveries FOR EACH ROW EXECUTE FUNCTION public.job_workspace_assessment_invalidate_feedback();

-- public.opportunity_search_receipts opportunity_assessment_unverify
CREATE TRIGGER opportunity_assessment_unverify AFTER DELETE OR UPDATE OF verified_at ON public.opportunity_search_receipts FOR EACH ROW EXECUTE FUNCTION private.invalidate_opportunity_assessment_proof();

-- public.opportunity_search_adaptive_settings opportunity_breadth_settings
CREATE TRIGGER opportunity_breadth_settings BEFORE INSERT OR UPDATE ON public.opportunity_search_adaptive_settings FOR EACH ROW EXECUTE FUNCTION public.job_workspace_breadth_settings();

-- public.opportunity_search_dashboard_actions opportunity_dashboard_action_guard
CREATE TRIGGER opportunity_dashboard_action_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_dashboard_actions FOR EACH ROW EXECUTE FUNCTION public.job_workspace_dashboard_action();

-- public.opportunity_search_discoveries opportunity_discovery_immutable
CREATE TRIGGER opportunity_discovery_immutable BEFORE UPDATE ON public.opportunity_search_discoveries FOR EACH ROW EXECUTE FUNCTION public.job_workspace_discovery_immutable();

-- public.opportunity_search_executions opportunity_execution_immutable
CREATE TRIGGER opportunity_execution_immutable BEFORE UPDATE ON public.opportunity_search_executions FOR EACH ROW EXECUTE FUNCTION public.job_workspace_execution_immutable();

-- public.opportunity_search_execution_receipts opportunity_execution_receipt_immutable
CREATE TRIGGER opportunity_execution_receipt_immutable BEFORE UPDATE ON public.opportunity_search_execution_receipts FOR EACH ROW EXECUTE FUNCTION public.job_workspace_execution_immutable();

-- public.opportunity_search_discoveries opportunity_feedback_prediction_discovery
CREATE TRIGGER opportunity_feedback_prediction_discovery AFTER INSERT OR DELETE OR UPDATE ON public.opportunity_search_discoveries FOR EACH ROW EXECUTE FUNCTION private.maintain_opportunity_feedback_prediction_proofs();

-- public.opportunity_search_receipts opportunity_feedback_prediction_receipt
CREATE TRIGGER opportunity_feedback_prediction_receipt AFTER INSERT OR DELETE OR UPDATE ON public.opportunity_search_receipts FOR EACH ROW EXECUTE FUNCTION private.maintain_opportunity_feedback_prediction_proofs();

-- public.opportunity_search_feedback_snapshots opportunity_feedback_snapshot_redaction
CREATE TRIGGER opportunity_feedback_snapshot_redaction BEFORE UPDATE ON public.opportunity_search_feedback_snapshots FOR EACH ROW EXECUTE FUNCTION public.job_workspace_snapshot_redaction();

-- public.opportunity_search_adaptive_settings opportunity_feedback_snapshot_settings
CREATE TRIGGER opportunity_feedback_snapshot_settings BEFORE INSERT OR UPDATE ON public.opportunity_search_adaptive_settings FOR EACH ROW EXECUTE FUNCTION public.job_workspace_snapshot_settings();

-- public.opportunity_search_adaptive_settings opportunity_plan_settings
CREATE TRIGGER opportunity_plan_settings BEFORE INSERT OR UPDATE ON public.opportunity_search_adaptive_settings FOR EACH ROW EXECUTE FUNCTION public.job_workspace_plan_settings();

-- public.opportunity_search_preference_actions opportunity_preference_action_guard
CREATE TRIGGER opportunity_preference_action_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_preference_actions FOR EACH ROW EXECUTE FUNCTION public.job_workspace_preference_action();

-- public.opportunity_search_preference_actions opportunity_preference_invalidate
CREATE TRIGGER opportunity_preference_invalidate AFTER INSERT ON public.opportunity_search_preference_actions FOR EACH ROW EXECUTE FUNCTION public.job_workspace_preference_invalidation();

-- public.opportunity_search_preference_suggestions opportunity_preference_suggestion_guard
CREATE TRIGGER opportunity_preference_suggestion_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_preference_suggestions FOR EACH ROW EXECUTE FUNCTION public.job_workspace_preference_suggestion();

-- public.opportunity_search_runs opportunity_query_plan_pin
CREATE TRIGGER opportunity_query_plan_pin BEFORE INSERT OR UPDATE ON public.opportunity_search_runs FOR EACH ROW EXECUTE FUNCTION public.job_workspace_query_plan_pin();

-- public.opportunity_reviews opportunity_reviews_evaluation_revision
CREATE TRIGGER opportunity_reviews_evaluation_revision BEFORE INSERT OR UPDATE ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION public.job_workspace_evaluation_revision();

-- public.opportunity_reviews opportunity_reviews_feedback_invalidate
CREATE TRIGGER opportunity_reviews_feedback_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION public.job_workspace_feedback_invalidation();

-- public.opportunity_reviews opportunity_reviews_feedback_revision
CREATE TRIGGER opportunity_reviews_feedback_revision BEFORE INSERT OR UPDATE ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION public.job_workspace_feedback_revision();

-- public.opportunity_reviews opportunity_reviews_updated_at
CREATE TRIGGER opportunity_reviews_updated_at BEFORE UPDATE ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION public.job_workspace_touch_updated_at();

-- public.opportunity_search_runner_authorizations opportunity_runner_authorization_guard
CREATE TRIGGER opportunity_runner_authorization_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_runner_authorizations FOR EACH ROW EXECUTE FUNCTION public.job_workspace_runner_authorization();

-- public.opportunity_search_runs opportunity_runs_feedback_pin_guard
CREATE TRIGGER opportunity_runs_feedback_pin_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_runs FOR EACH ROW EXECUTE FUNCTION public.job_workspace_feedback_pin_guard();

-- public.opportunity_search_query_revisions opportunity_search_queries_immutable
CREATE TRIGGER opportunity_search_queries_immutable BEFORE UPDATE ON public.opportunity_search_query_revisions FOR EACH ROW EXECUTE FUNCTION private.immutable_opportunity_search_record();

-- public.opportunity_search_query_plans opportunity_search_query_plan_immutable
CREATE TRIGGER opportunity_search_query_plan_immutable BEFORE UPDATE ON public.opportunity_search_query_plans FOR EACH ROW EXECUTE FUNCTION public.job_workspace_plan_immutable();

-- public.opportunity_search_rollback_requests opportunity_search_rollback_request_guard
CREATE TRIGGER opportunity_search_rollback_request_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_rollback_requests FOR EACH ROW EXECUTE FUNCTION public.job_workspace_rollback_request();

-- public.opportunity_search_sources opportunity_search_sources_guard
CREATE TRIGGER opportunity_search_sources_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_sources FOR EACH ROW EXECUTE FUNCTION public.job_workspace_source_guard();

-- public.opportunity_search_templates opportunity_search_template_guard
CREATE TRIGGER opportunity_search_template_guard BEFORE INSERT OR UPDATE ON public.opportunity_search_templates FOR EACH ROW EXECUTE FUNCTION private.guard_opportunity_search_template();

-- public.opportunity_search_sources opportunity_source_invalidation
CREATE TRIGGER opportunity_source_invalidation AFTER INSERT OR DELETE OR UPDATE ON public.opportunity_search_sources FOR EACH ROW EXECUTE FUNCTION public.job_workspace_source_invalidation();

-- public.application_refinement_proposals refinement_proposals_capture
CREATE TRIGGER refinement_proposals_capture BEFORE INSERT ON public.application_refinement_proposals FOR EACH ROW EXECUTE FUNCTION public.refinement_capture_proposal();

-- public.application_refinement_proposals refinement_proposals_immutable
CREATE TRIGGER refinement_proposals_immutable BEFORE DELETE OR UPDATE ON public.application_refinement_proposals FOR EACH ROW EXECUTE FUNCTION public.refinement_guard_immutable();

-- public.application_refinement_protocols refinement_protocol_immutable
CREATE TRIGGER refinement_protocol_immutable BEFORE UPDATE ON public.application_refinement_protocols FOR EACH ROW EXECUTE FUNCTION private.prevent_refinement_protocol_update();

-- public.application_refinement_requests refinement_requests_activate
CREATE TRIGGER refinement_requests_activate AFTER INSERT ON public.application_refinement_requests FOR EACH ROW EXECUTE FUNCTION public.refinement_activate_request();

-- public.application_refinement_requests refinement_requests_capture
CREATE TRIGGER refinement_requests_capture BEFORE INSERT ON public.application_refinement_requests FOR EACH ROW EXECUTE FUNCTION public.refinement_capture_request();

-- public.application_refinement_requests refinement_requests_immutable
CREATE TRIGGER refinement_requests_immutable BEFORE DELETE OR UPDATE ON public.application_refinement_requests FOR EACH ROW EXECUTE FUNCTION public.refinement_guard_immutable();

-- public.application_refinement_requests refinement_requests_initial_scope
CREATE TRIGGER refinement_requests_initial_scope BEFORE INSERT ON public.application_refinement_requests FOR EACH ROW EXECUTE FUNCTION public.refinement_guard_initial_history_scope();

-- public.application_refinement_reviews refinement_reviews_capture
CREATE TRIGGER refinement_reviews_capture BEFORE INSERT ON public.application_refinement_reviews FOR EACH ROW EXECUTE FUNCTION public.refinement_capture_review();

-- public.application_refinement_reviews refinement_reviews_immutable
CREATE TRIGGER refinement_reviews_immutable BEFORE DELETE OR UPDATE ON public.application_refinement_reviews FOR EACH ROW EXECUTE FUNCTION public.refinement_guard_immutable();

-- public.application_refinement_reviews refinement_reviews_initial_scope
CREATE TRIGGER refinement_reviews_initial_scope BEFORE INSERT ON public.application_refinement_reviews FOR EACH ROW EXECUTE FUNCTION public.refinement_guard_initial_history_scope();

-- public.application_refinement_state refinement_state_capture
CREATE TRIGGER refinement_state_capture BEFORE INSERT OR UPDATE ON public.application_refinement_state FOR EACH ROW EXECUTE FUNCTION public.refinement_capture_state();
