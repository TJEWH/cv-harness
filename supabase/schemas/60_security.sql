-- Current desired schema: 60_security.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- private.FUNCTION disable_adaptive_search_release(p_project_ref text, p_expected_release_revision bigint)
COMMENT ON FUNCTION private.disable_adaptive_search_release(p_project_ref text, p_expected_release_revision bigint) IS 'Technical database stop only. Does not change scheduled tasks or delete research.';

-- private.FUNCTION legacy_dynamic_search_rollback_prompt(p_search_id uuid, p_project_ref text)
COMMENT ON FUNCTION private.legacy_dynamic_search_rollback_prompt(p_search_id uuid, p_project_ref text) IS 'Reviewed legacy-dynamic-v1 technical fallback. Local compatibility tests are not evidence of unattended scheduler execution.';

-- private.FUNCTION read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text)
COMMENT ON FUNCTION private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text) IS 'Read-only exact current document snapshot, including the unchanged request and captured CV/opportunity context. Management connection only.';

-- public.COLUMN applications.cv_variant_id
COMMENT ON COLUMN public.applications.cv_variant_id IS 'Optional privacy-filtered CV snapshot, assigned after the application is created.';

-- public.COLUMN applications.contact_email
COMMENT ON COLUMN public.applications.contact_email IS 'Optional employer email retained for legacy applications; all researched contacts are available in context_json.';

-- public.COLUMN applications.context_json
COMMENT ON COLUMN public.applications.context_json IS 'Opportunity research captured by the server on create or explicit refresh; client-supplied research is always replaced with the authoritative same opportunity.';

-- public.COLUMN applications.context_captured_at
COMMENT ON COLUMN public.applications.context_captured_at IS 'Server time of the latest explicit research capture; normal application edits leave it unchanged.';

-- public.COLUMN applications.completed_checklist_keys
COMMENT ON COLUMN public.applications.completed_checklist_keys IS 'Private preparation progress keyed by requirement/document content, independent of captured research and CV snapshots.';

-- public.COLUMN applications.application_code
COMMENT ON COLUMN public.applications.application_code IS 'Immutable globally unique server-assigned application reference. Owner RLS still governs access; the UUID remains the internal key.';

-- public.COLUMN applications.status_history
COMMENT ON COLUMN public.applications.status_history IS 'Server-maintained ordered status transitions. A null changedAt marks an existing status whose transition time was never recorded. Owner RLS is inherited from applications.';

-- public.COLUMN applications.workflow_stage
COMMENT ON COLUMN public.applications.workflow_stage IS 'Last active application tab. Before explicit tracking, Preparation, Refinement and Attachments set their matching status; Tracking preserves the current status.';

-- public.COLUMN applications.tracking_started
COMMENT ON COLUMN public.applications.tracking_started IS 'Sticky after the first explicit Tracking status choice, including Ready. Stage changes continue to save but no longer change status.';

-- public.TABLE opportunity_search_sources
COMMENT ON TABLE public.opportunity_search_sources IS 'Owner-scoped reusable listings and pending identification; registry_id is not a canonical evidence source_id or proof of historical discovery.';

-- public.FUNCTION preview_opportunity_search_feedback(p_search_id uuid)
COMMENT ON FUNCTION public.preview_opportunity_search_feedback(p_search_id uuid) IS 'Read-only exact current or next runner feedback packet. Does not approve sharing or create a run.';

-- public.FUNCTION read_opportunity_search_dashboard(p_search_id uuid, p_project_ref text)
COMMENT ON FUNCTION public.read_opportunity_search_dashboard(p_search_id uuid, p_project_ref text) IS 'Fixed owner DTO: exact outgoing feedback preview, explicit preference actions, public reusable sources, saved queries and actual history. Verification counts are persisted separate-verification observations, not delivery or a fresh canonical comparison.';

-- public.FUNCTION read_opportunity_search_metrics(p_search_id uuid)
COMMENT ON FUNCTION public.read_opportunity_search_metrics(p_search_id uuid) IS 'Owner-private observed quality metrics. Overlapping groups are not additive and generated recommendations never prove delivery.';

-- private.TABLE opportunity_search_adaptive_batches
REVOKE ALL ON FUNCTION private.opportunity_search_schema_error_path(jsonb,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON COLUMN public.opportunity_search_runs.last_batch_rejection IS 'Latest authorized active-run batch validation failure. Bounded codes, schema paths and identities only; no submitted values, SQL or error text. Historical failures are not backfilled.';

COMMENT ON TABLE private.opportunity_search_adaptive_batches IS 'Immutable safe batch manifest/receipt metadata. No raw input payload, canonical snapshot, people or nested decision paths are exported.';

-- private.TABLE opportunity_search_adaptive_contexts
COMMENT ON TABLE private.opportunity_search_adaptive_contexts IS 'Management-only pinned safe context. Approved summary plaintext is resolved only from AF-03; privacy-redacted adaptive query text is never restored on retry.';

-- private.TABLE opportunity_search_setup_acknowledgements
COMMENT ON TABLE private.opportunity_search_setup_acknowledgements IS 'Idempotent normalized caller attestations of actual task-tool success. Exact retry returns historical acknowledgement, not proof of current scheduler state. Not cryptographic receipts; no scheduler call or disabled-task success is claimed.';

-- public.TABLE application_refinement_proposals
COMMENT ON TABLE public.application_refinement_proposals IS 'Append-only validated proposals, written only by the postgres management connection. Reading a proposal never applies it locally.';

-- public.TABLE application_refinement_requests
COMMENT ON TABLE public.application_refinement_requests IS 'Immutable anonymized refinement context; server captures assigned public CV and application research. No application notes or supporting files.';

-- public.TABLE application_refinement_reviews
COMMENT ON TABLE public.application_refinement_reviews IS 'Append-only owner feedback and approval history. Feedback must be anonymized before sending.';

-- public.TABLE application_refinement_state
COMMENT ON TABLE public.application_refinement_state IS 'Independent current CV/letter requests, letter settings and approval hashes. Full private sources remain local.';

-- public.COLUMN application_refinement_state.current_request_id
COMMENT ON COLUMN public.application_refinement_state.current_request_id IS 'Retired global pointer. Always null; use document-specific pointers.';

-- public.TABLE cv_variants
COMMENT ON TABLE public.cv_variants IS 'Private, immutable privacy-filtered CV snapshots. Complete CVs stay in local browser storage.';

-- public.TABLE local_attachment_metadata
COMMENT ON TABLE public.local_attachment_metadata IS 'Only user-entered attachment names and descriptions, with technical identity/ownership. Files, filenames, paths, MIME types, sizes, extracted text, and application selections stay in local browser storage.';

-- public.TABLE opportunity_feedback_prediction_proofs
COMMENT ON TABLE public.opportunity_feedback_prediction_proofs IS 'Owner-readable verified technical prediction proof. No audit snapshots, assessment prose, contacts or private application context.';

-- public.COLUMN opportunity_reviews.state
COMMENT ON COLUMN public.opportunity_reviews.state IS 'Private explicit user preference. strong_interest can seed new searches across prior searches, fit scores and deadlines.';

-- public.COLUMN opportunity_reviews.reviewed_updated_at
COMMENT ON COLUMN public.opportunity_reviews.reviewed_updated_at IS 'Opportunity source version last reviewed by this user; independent of their interest state.';

-- public.COLUMN opportunity_reviews.comment
COMMENT ON COLUMN public.opportunity_reviews.comment IS 'Complete owner evaluation. Only a safe derived first-600-character excerpt may enter feedback after search consent, unless excluded. No second editable summary is stored.';

-- public.COLUMN opportunity_reviews.interest_rating
COMMENT ON COLUMN public.opportunity_reviews.interest_rating IS 'Retained legacy numeric override; current opportunity-interest-v2 derives interest from the review choice and application evidence.';

-- public.COLUMN opportunity_reviews.feedback_updated_at
COMMENT ON COLUMN public.opportunity_reviews.feedback_updated_at IS 'Time of the last actual state/rating/reason/exclusion change. Unknown for legacy feedback; views/comments do not advance it.';

-- public.COLUMN opportunity_reviews.prediction_baseline
COMMENT ON COLUMN public.opportunity_reviews.prediction_baseline IS 'Frozen independently proven original assessment. The server may pin protected verified discovery metadata only on a new meaningful explicit feedback revision; views and later verification never rebase unchanged feedback.';

-- public.COLUMN opportunity_reviews.evaluation_revision
COMMENT ON COLUMN public.opportunity_reviews.evaluation_revision IS 'Server-maintained revision of the complete evaluation; independent of numeric interest and search-level consent revisions.';

-- public.COLUMN opportunity_reviews.manually_archived
COMMENT ON COLUMN public.opportunity_reviews.manually_archived IS 'Owner-only past/current override. Does not modify catalogue availability, deadlines or interest.';

-- public.COLUMN opportunity_reviews.technical_issue_note
COMMENT ON COLUMN public.opportunity_reviews.technical_issue_note IS 'Private technical context; never copied into research feedback or an interest score.';

-- public.TABLE opportunity_search_adaptive_proposals
COMMENT ON TABLE public.opportunity_search_adaptive_proposals IS 'Owner-readable inert future suggestions. A pending suggestion never executes a preference, source or query change.';

-- public.TABLE opportunity_search_dashboard_actions
COMMENT ON TABLE public.opportunity_search_dashboard_actions IS 'Owner-only immutable control receipts. Exact retry acknowledges historical settings/source state; refresh dashboard for current state. Does not edit base criteria or task text.';

-- public.TABLE opportunity_search_discoveries
COMMENT ON TABLE public.opportunity_search_discoveries IS 'Immutable owner-specific incoming run assessments and actual attribution; historical times remain unknown and delivery is always unknown in AF-05.';

-- public.COLUMN opportunity_search_discoveries.opportunity_id
COMMENT ON COLUMN public.opportunity_search_discoveries.opportunity_id IS 'Canonical audit identity without a live FK, preserving authorized canonical rollback/deletion compatibility.';

-- public.TABLE opportunity_search_executions
COMMENT ON TABLE public.opportunity_search_executions IS 'Actual declared query/source checks only; saved plans never create execution credit. Failure reasons are fixed non-sensitive codes.';

-- public.TABLE opportunity_search_feedback_snapshots
COMMENT ON TABLE public.opportunity_search_feedback_snapshots IS 'Immutable owner-scoped safe packets; only deterministic privacy redaction may change cached text. No contacts, comments or documents.';

-- public.TABLE opportunity_search_query_plans
COMMENT ON TABLE public.opportunity_search_query_plans IS 'Immutable v2 extensions anchored to original v1 query revisions. Legacy strict arrays/unique keys and writer remain unchanged.';

-- public.TABLE opportunity_search_rollback_requests
COMMENT ON TABLE public.opportunity_search_rollback_requests IS 'Explicit desired legacy intent. Immutable owner request; confirmed task mode and binding change only after real task-tool acknowledgement.';

-- public.TABLE opportunity_search_runner_authorizations
COMMENT ON TABLE public.opportunity_search_runner_authorizations IS 'Explicit owner grant for one configured project/search. This does not authenticate an administrative connector as a human user or downscope its general database privileges.';

-- public.TABLE opportunity_search_setup_claims
COMMENT ON TABLE public.opportunity_search_setup_claims IS 'One outstanding unbound setup per search, serialized with legacy scheduling. Uncertain external results retain the claim without automatic expiry; only its successful acknowledgement clears it.';

-- private.opportunity_search_settings Read active search protocol
CREATE POLICY "Read active search protocol" ON private.opportunity_search_settings FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- private.opportunity_search_protocols Read installed search protocol
CREATE POLICY "Read installed search protocol" ON private.opportunity_search_protocols FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- private.opportunity_search_adaptive_batches
ALTER TABLE private.opportunity_search_adaptive_batches ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_adaptive_completions
ALTER TABLE private.opportunity_search_adaptive_completions ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_adaptive_contexts
ALTER TABLE private.opportunity_search_adaptive_contexts ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_adaptive_items
ALTER TABLE private.opportunity_search_adaptive_items ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_identities
ALTER TABLE private.opportunity_search_identities ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_merge_audit
ALTER TABLE private.opportunity_search_merge_audit ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_merge_state
ALTER TABLE private.opportunity_search_merge_state ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_protocols
ALTER TABLE private.opportunity_search_protocols ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_schedule_claims
ALTER TABLE private.opportunity_search_schedule_claims ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_settings
ALTER TABLE private.opportunity_search_settings ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_setup_acknowledgements
ALTER TABLE private.opportunity_search_setup_acknowledgements ENABLE ROW LEVEL SECURITY;

-- private.opportunity_search_setup_operations
ALTER TABLE private.opportunity_search_setup_operations ENABLE ROW LEVEL SECURITY;

-- public.applications Delete own applications
CREATE POLICY "Delete own applications" ON public.applications FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- public.local_attachment_metadata Delete own attachment descriptions
CREATE POLICY "Delete own attachment descriptions" ON public.local_attachment_metadata FOR DELETE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_reviews Delete own opportunity reviews
CREATE POLICY "Delete own opportunity reviews" ON public.opportunity_reviews FOR DELETE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.cv_variants Delete own unused CV snapshots
CREATE POLICY "Delete own unused CV snapshots" ON public.cv_variants FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- public.opportunity_search_preference_actions Explicit owner preference writes
CREATE POLICY "Explicit owner preference writes" ON public.opportunity_search_preference_actions FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_preference_suggestions Explicit owner preference writes
CREATE POLICY "Explicit owner preference writes" ON public.opportunity_search_preference_suggestions FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.cv_variants Insert own CV snapshots
CREATE POLICY "Insert own CV snapshots" ON public.cv_variants FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

-- public.applications Insert own applications
CREATE POLICY "Insert own applications" ON public.applications FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

-- public.local_attachment_metadata Insert own attachment descriptions
CREATE POLICY "Insert own attachment descriptions" ON public.local_attachment_metadata FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_reviews Insert own opportunity reviews
CREATE POLICY "Insert own opportunity reviews" ON public.opportunity_reviews FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_requests Insert own refinement requests
CREATE POLICY "Insert own refinement requests" ON public.application_refinement_requests FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_reviews Insert own refinement reviews
CREATE POLICY "Insert own refinement reviews" ON public.application_refinement_reviews FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_state Insert own refinement state
CREATE POLICY "Insert own refinement state" ON public.application_refinement_state FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_templates Own search templates
CREATE POLICY "Own search templates" ON public.opportunity_search_templates TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- public.opportunity_search_dashboard_actions Owner adaptive control actions
CREATE POLICY "Owner adaptive control actions" ON public.opportunity_search_dashboard_actions TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_adaptive_settings Owner adaptive settings
CREATE POLICY "Owner adaptive settings" ON public.opportunity_search_adaptive_settings TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_rollback_requests Owner explicit rollback requests
CREATE POLICY "Owner explicit rollback requests" ON public.opportunity_search_rollback_requests TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_runner_authorizations Owner explicit runner authorization
CREATE POLICY "Owner explicit runner authorization" ON public.opportunity_search_runner_authorizations TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_feedback_snapshots Owner feedback snapshots
CREATE POLICY "Owner feedback snapshots" ON public.opportunity_search_feedback_snapshots FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_adaptive_proposals Owner inert adaptive proposals
CREATE POLICY "Owner inert adaptive proposals" ON public.opportunity_search_adaptive_proposals FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_setup_claims Owner outstanding setup metadata
CREATE POLICY "Owner outstanding setup metadata" ON public.opportunity_search_setup_claims FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_feedback_prediction_proofs Owner prediction proof metadata
CREATE POLICY "Owner prediction proof metadata" ON public.opportunity_feedback_prediction_proofs FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_preference_actions Owner preference reads
CREATE POLICY "Owner preference reads" ON public.opportunity_search_preference_actions FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_preference_suggestions Owner preference reads
CREATE POLICY "Owner preference reads" ON public.opportunity_search_preference_suggestions FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_query_plans Owner query plans
CREATE POLICY "Owner query plans" ON public.opportunity_search_query_plans FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_sources Owner reusable sources
CREATE POLICY "Owner reusable sources" ON public.opportunity_search_sources TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_discoveries Owner search attribution
CREATE POLICY "Owner search attribution" ON public.opportunity_search_discoveries FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_execution_receipts Owner search attribution
CREATE POLICY "Owner search attribution" ON public.opportunity_search_execution_receipts FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_executions Owner search attribution
CREATE POLICY "Owner search attribution" ON public.opportunity_search_executions FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_feedback_snapshots Owner snapshot privacy redaction
CREATE POLICY "Owner snapshot privacy redaction" ON public.opportunity_search_feedback_snapshots FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_runner_config Owner technical runner request
CREATE POLICY "Owner technical runner request" ON public.opportunity_search_runner_config TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_protocols Publish own refinement protocols
CREATE POLICY "Publish own refinement protocols" ON public.application_refinement_protocols FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.cv_variants Read own CV snapshots
CREATE POLICY "Read own CV snapshots" ON public.cv_variants FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- public.applications Read own applications
CREATE POLICY "Read own applications" ON public.applications FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- public.local_attachment_metadata Read own attachment descriptions
CREATE POLICY "Read own attachment descriptions" ON public.local_attachment_metadata FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_reviews Read own opportunity reviews
CREATE POLICY "Read own opportunity reviews" ON public.opportunity_reviews FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_proposals Read own refinement proposals
CREATE POLICY "Read own refinement proposals" ON public.application_refinement_proposals FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_protocols Read own refinement protocols
CREATE POLICY "Read own refinement protocols" ON public.application_refinement_protocols FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_requests Read own refinement requests
CREATE POLICY "Read own refinement requests" ON public.application_refinement_requests FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_reviews Read own refinement reviews
CREATE POLICY "Read own refinement reviews" ON public.application_refinement_reviews FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_state Read own refinement state
CREATE POLICY "Read own refinement state" ON public.application_refinement_state FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_search_query_revisions Read own search records
CREATE POLICY "Read own search records" ON public.opportunity_search_query_revisions FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- public.opportunity_search_receipts Read own search records
CREATE POLICY "Read own search records" ON public.opportunity_search_receipts FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- public.opportunity_search_runs Read own search records
CREATE POLICY "Read own search records" ON public.opportunity_search_runs FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- public.opportunity_search_schedule_bindings Read own search records
CREATE POLICY "Read own search records" ON public.opportunity_search_schedule_bindings FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(( SELECT (auth.jwt() ->> 'is_anonymous'::text)), 'false'::text) = 'false'::text)));

-- public.opportunity_search_adaptive_release Safe technical adaptive release
CREATE POLICY "Safe technical adaptive release" ON public.opportunity_search_adaptive_release FOR SELECT TO authenticated USING ((NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)));

-- public.opportunities Signed-in users can review the shared catalogue
CREATE POLICY "Signed-in users can review the shared catalogue" ON public.opportunities FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false) = false)));

-- public.cv_variants Update own CV metadata
CREATE POLICY "Update own CV metadata" ON public.cv_variants FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

-- public.applications Update own applications
CREATE POLICY "Update own applications" ON public.applications FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

-- public.local_attachment_metadata Update own attachment descriptions
CREATE POLICY "Update own attachment descriptions" ON public.local_attachment_metadata FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.opportunity_reviews Update own opportunity reviews
CREATE POLICY "Update own opportunity reviews" ON public.opportunity_reviews FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_state Update own refinement state
CREATE POLICY "Update own refinement state" ON public.application_refinement_state FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false)))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT COALESCE(((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text))::boolean, false))));

-- public.application_refinement_proposals
ALTER TABLE public.application_refinement_proposals ENABLE ROW LEVEL SECURITY;

-- public.application_refinement_protocols
ALTER TABLE public.application_refinement_protocols ENABLE ROW LEVEL SECURITY;

-- public.application_refinement_requests
ALTER TABLE public.application_refinement_requests ENABLE ROW LEVEL SECURITY;

-- public.application_refinement_reviews
ALTER TABLE public.application_refinement_reviews ENABLE ROW LEVEL SECURITY;

-- public.application_refinement_state
ALTER TABLE public.application_refinement_state ENABLE ROW LEVEL SECURITY;

-- public.applications
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- public.cv_variants
ALTER TABLE public.cv_variants ENABLE ROW LEVEL SECURITY;

-- public.local_attachment_metadata
ALTER TABLE public.local_attachment_metadata ENABLE ROW LEVEL SECURITY;

-- public.opportunities
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- public.opportunity_feedback_prediction_proofs
ALTER TABLE public.opportunity_feedback_prediction_proofs ENABLE ROW LEVEL SECURITY;

-- public.opportunity_reviews
ALTER TABLE public.opportunity_reviews ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_adaptive_proposals
ALTER TABLE public.opportunity_search_adaptive_proposals ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_adaptive_release
ALTER TABLE public.opportunity_search_adaptive_release ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_adaptive_settings
ALTER TABLE public.opportunity_search_adaptive_settings ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_dashboard_actions
ALTER TABLE public.opportunity_search_dashboard_actions ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_discoveries
ALTER TABLE public.opportunity_search_discoveries ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_execution_receipts
ALTER TABLE public.opportunity_search_execution_receipts ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_executions
ALTER TABLE public.opportunity_search_executions ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_feedback_snapshots
ALTER TABLE public.opportunity_search_feedback_snapshots ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_preference_actions
ALTER TABLE public.opportunity_search_preference_actions ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_preference_suggestions
ALTER TABLE public.opportunity_search_preference_suggestions ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_query_plans
ALTER TABLE public.opportunity_search_query_plans ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_query_revisions
ALTER TABLE public.opportunity_search_query_revisions ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_receipts
ALTER TABLE public.opportunity_search_receipts ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_rollback_requests
ALTER TABLE public.opportunity_search_rollback_requests ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_runner_authorizations
ALTER TABLE public.opportunity_search_runner_authorizations ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_runner_config
ALTER TABLE public.opportunity_search_runner_config ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_runs
ALTER TABLE public.opportunity_search_runs ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_schedule_bindings
ALTER TABLE public.opportunity_search_schedule_bindings ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_setup_claims
ALTER TABLE public.opportunity_search_setup_claims ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_sources
ALTER TABLE public.opportunity_search_sources ENABLE ROW LEVEL SECURITY;

-- public.opportunity_search_templates
ALTER TABLE public.opportunity_search_templates ENABLE ROW LEVEL SECURITY;

-- -.SCHEMA private
GRANT USAGE ON SCHEMA private TO authenticated;

-- -.SCHEMA public
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- private.FUNCTION ack_adaptive_search_rollback(p_search_id uuid, p_rollback_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.ack_adaptive_search_rollback(p_search_id uuid, p_rollback_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION ack_adaptive_search_setup(p_search_id uuid, p_setup_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.ack_adaptive_search_setup(p_search_id uuid, p_setup_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION ack_adaptive_search_setup_internal(p_search_id uuid, p_setup_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.ack_adaptive_search_setup_internal(p_search_id uuid, p_setup_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION adaptive_accepted_roots(p_run_id uuid, p_item_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_accepted_roots(p_run_id uuid, p_item_id uuid) FROM PUBLIC;

-- private.FUNCTION adaptive_batch_error(p_code text)
REVOKE ALL ON FUNCTION private.adaptive_batch_error(p_code text) FROM PUBLIC;

-- private.FUNCTION adaptive_batch_immutable()
REVOKE ALL ON FUNCTION private.adaptive_batch_immutable() FROM PUBLIC;

-- private.FUNCTION adaptive_batch_receipt(p_run_id uuid, p_batch_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_batch_receipt(p_run_id uuid, p_batch_id uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION private.adaptive_item_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.save_adaptive_search_item(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.verify_adaptive_search_item(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- private.FUNCTION adaptive_expected_safe(p_value jsonb)
REVOKE ALL ON FUNCTION private.adaptive_expected_safe(p_value jsonb) FROM PUBLIC;

-- private.FUNCTION adaptive_plan_policy_valid(p_document jsonb, p_policy jsonb, p_active boolean)
REVOKE ALL ON FUNCTION private.adaptive_plan_policy_valid(p_document jsonb, p_policy jsonb, p_active boolean) FROM PUBLIC;

-- private.FUNCTION adaptive_search_binding_hash(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_search_binding_hash(p_user_id uuid, p_search_id uuid) FROM PUBLIC;

-- private.FUNCTION adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) FROM PUBLIC;

-- private.FUNCTION adaptive_search_rollback_error(p_code text)
REVOKE ALL ON FUNCTION private.adaptive_search_rollback_error(p_code text) FROM PUBLIC;

-- private.FUNCTION adaptive_search_rollback_handoff(p_rollback_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_search_rollback_handoff(p_rollback_id uuid) FROM PUBLIC;

-- private.FUNCTION adaptive_search_rollback_publication_pending(p_search_id uuid, p_rollback_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_search_rollback_publication_pending(p_search_id uuid, p_rollback_id uuid) FROM PUBLIC;

-- private.FUNCTION adaptive_search_setup_error(p_code text)
REVOKE ALL ON FUNCTION private.adaptive_search_setup_error(p_code text) FROM PUBLIC;

-- private.FUNCTION adaptive_setup_handoff(p_setup_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_setup_handoff(p_setup_id uuid) FROM PUBLIC;

-- private.FUNCTION adaptive_source_basis(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION private.adaptive_source_basis(p_user_id uuid, p_search_id uuid) FROM PUBLIC;

-- The brief is management-only even under broad owner default privileges.
REVOKE ALL ON FUNCTION private.begin_adaptive_search_brief(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- private.FUNCTION begin_adaptive_opportunity_search(p_search_id uuid, p_run_id uuid)
REVOKE ALL ON FUNCTION private.begin_adaptive_opportunity_search(p_search_id uuid, p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION begin_opportunity_search(p_search_id uuid, p_run_id uuid)
REVOKE ALL ON FUNCTION private.begin_opportunity_search(p_search_id uuid, p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION capture_adaptive_plan_pointer()
REVOKE ALL ON FUNCTION private.capture_adaptive_plan_pointer() FROM PUBLIC;

-- private.FUNCTION claim_opportunity_search_schedule(p_search_id uuid, p_run_id uuid)
REVOKE ALL ON FUNCTION private.claim_opportunity_search_schedule(p_search_id uuid, p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION clear_refinement_history(p_application_id uuid, p_expected_revision integer)
REVOKE ALL ON FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer) TO authenticated;

-- private.FUNCTION clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text)
REVOKE ALL ON FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) TO authenticated;

-- private.FUNCTION compile_opportunity_feedback_snapshot(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION private.compile_opportunity_feedback_snapshot(p_user_id uuid, p_search_id uuid) FROM PUBLIC;

-- private.FUNCTION complete_opportunity_search(p_run_id uuid, p_summary jsonb)
REVOKE ALL ON FUNCTION private.complete_opportunity_search(p_run_id uuid, p_summary jsonb) FROM PUBLIC;

-- private.FUNCTION confirm_opportunity_search_schedule(p_search_id uuid, p_run_id uuid, p_task_id text, p_schedule jsonb)
REVOKE ALL ON FUNCTION private.confirm_opportunity_search_schedule(p_search_id uuid, p_run_id uuid, p_task_id text, p_schedule jsonb) FROM PUBLIC;

-- private.FUNCTION disable_adaptive_search_release(p_project_ref text, p_expected_release_revision bigint)
REVOKE ALL ON FUNCTION private.disable_adaptive_search_release(p_project_ref text, p_expected_release_revision bigint) FROM PUBLIC;

-- private.FUNCTION due_opportunity_search_sources(p_user_id uuid, p_search_id uuid, p_at timestamp with time zone)
REVOKE ALL ON FUNCTION private.due_opportunity_search_sources(p_user_id uuid, p_search_id uuid, p_at timestamp with time zone) FROM PUBLIC;

-- private.FUNCTION guard_adaptive_task_binding()
REVOKE ALL ON FUNCTION private.guard_adaptive_task_binding() FROM PUBLIC;

-- private.FUNCTION guard_legacy_search_setup_claim()
REVOKE ALL ON FUNCTION private.guard_legacy_search_setup_claim() FROM PUBLIC;

-- private.FUNCTION guard_opportunity_meta_search()
REVOKE ALL ON FUNCTION private.guard_opportunity_meta_search() FROM PUBLIC;

-- private.FUNCTION guard_opportunity_search_template()
REVOKE ALL ON FUNCTION private.guard_opportunity_search_template() FROM PUBLIC;

-- private.FUNCTION immutable_opportunity_search_record()
REVOKE ALL ON FUNCTION private.immutable_opportunity_search_record() FROM PUBLIC;

-- private.FUNCTION inspect_opportunity_search_result(p_run_id uuid, p_identity jsonb)
REVOKE ALL ON FUNCTION private.inspect_opportunity_search_result(p_run_id uuid, p_identity jsonb) FROM PUBLIC;

-- private.FUNCTION invalidate_opportunity_assessment_proof()
REVOKE ALL ON FUNCTION private.invalidate_opportunity_assessment_proof() FROM PUBLIC;

-- private.FUNCTION legacy_dynamic_search_rollback_prompt(p_search_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION private.legacy_dynamic_search_rollback_prompt(p_search_id uuid, p_project_ref text) FROM PUBLIC;

-- private.FUNCTION maintain_opportunity_feedback_prediction_proofs()
REVOKE ALL ON FUNCTION private.maintain_opportunity_feedback_prediction_proofs() FROM PUBLIC;

-- private.FUNCTION normalize_adaptive_execution(p_run_id uuid, p_execution jsonb)
REVOKE ALL ON FUNCTION private.normalize_adaptive_execution(p_run_id uuid, p_execution jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_canonical_input(v jsonb, s jsonb, p_path text)
REVOKE ALL ON FUNCTION private.opportunity_canonical_input(v jsonb, s jsonb, p_path text) FROM PUBLIC;

-- private.FUNCTION opportunity_canonical_set(p_path text, v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_canonical_set(p_path text, v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_canonical_set_key(p_path text, v text)
REVOKE ALL ON FUNCTION private.opportunity_canonical_set_key(p_path text, v text) FROM PUBLIC;

-- private.FUNCTION opportunity_context_checksum()
REVOKE ALL ON FUNCTION private.opportunity_context_checksum() FROM PUBLIC;

-- private.FUNCTION opportunity_discovery_prediction_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone)
REVOKE ALL ON FUNCTION private.opportunity_discovery_prediction_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone) FROM PUBLIC;

-- private.FUNCTION opportunity_feedback_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone)
REVOKE ALL ON FUNCTION private.opportunity_feedback_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone) FROM PUBLIC;

-- private.FUNCTION opportunity_feedback_projection_text(p_text text, p_max_length integer)
REVOKE ALL ON FUNCTION private.opportunity_feedback_projection_text(p_text text, p_max_length integer) FROM PUBLIC;

-- private.FUNCTION opportunity_feedback_safe_url(p_url text)
REVOKE ALL ON FUNCTION private.opportunity_feedback_safe_url(p_url text) FROM PUBLIC;

-- private.FUNCTION opportunity_feedback_time(p_value text)
REVOKE ALL ON FUNCTION private.opportunity_feedback_time(p_value text) FROM PUBLIC;

-- private.FUNCTION opportunity_feedback_url_decoded(p_text text)
REVOKE ALL ON FUNCTION private.opportunity_feedback_url_decoded(p_text text) FROM PUBLIC;

-- private.FUNCTION opportunity_interest_metric(p_user_id uuid, p_opportunity_id uuid)
REVOKE ALL ON FUNCTION private.opportunity_interest_metric(p_user_id uuid, p_opportunity_id uuid) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_authorize(p_old jsonb, p_new jsonb, p_old_evidence jsonb, p_new_evidence jsonb, p_correction jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_authorize(p_old jsonb, p_new jsonb, p_old_evidence jsonb, p_new_evidence jsonb, p_correction jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_can_revalidate(p_old jsonb, p_new jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_can_revalidate(p_old jsonb, p_new jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_canonical(p_field text, v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_canonical(p_field text, v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_entities(p_field text, v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_entities(p_field text, v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_entity_key(p_field text, v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_entity_key(p_field text, v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_evidence(p_sources jsonb, p_path text)
REVOKE ALL ON FUNCTION private.opportunity_merge_evidence(p_sources jsonb, p_path text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_evidence_signature(v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_evidence_signature(v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_key(v text)
REVOKE ALL ON FUNCTION private.opportunity_merge_key(v text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_node(p_path text, p_old jsonb, p_new jsonb, p_state jsonb, p_old_sources jsonb, p_new_sources jsonb, p_control jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_node(p_path text, p_old jsonb, p_new jsonb, p_state jsonb, p_old_sources jsonb, p_new_sources jsonb, p_control jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_paper_match(a jsonb, b jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_paper_match(a jsonb, b jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_person_match(a jsonb, b jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_person_match(a jsonb, b jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_plan(p_before jsonb, p_payload jsonb, p_state jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_plan(p_before jsonb, p_payload jsonb, p_state jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_pointer(v text)
REVOKE ALL ON FUNCTION private.opportunity_merge_pointer(v text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_policy(p_path text)
REVOKE ALL ON FUNCTION private.opportunity_merge_policy(p_path text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_precise_time(v text)
REVOKE ALL ON FUNCTION private.opportunity_merge_precise_time(v text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_present(v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_present(v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_same_evidence(p_old jsonb, p_new jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_same_evidence(p_old jsonb, p_new jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_set(v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_set(v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_sources(v jsonb)
REVOKE ALL ON FUNCTION private.opportunity_merge_sources(v jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_stage(v text)
REVOKE ALL ON FUNCTION private.opportunity_merge_stage(v text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_url(v text)
REVOKE ALL ON FUNCTION private.opportunity_merge_url(v text) FROM PUBLIC;

-- private.FUNCTION opportunity_merge_value_at(p_value jsonb, p_suffix text, p_field text)
REVOKE ALL ON FUNCTION private.opportunity_merge_value_at(p_value jsonb, p_suffix text, p_field text) FROM PUBLIC;

-- private.FUNCTION opportunity_payload_schema_valid(v jsonb, s jsonb, root_schema jsonb)
REVOKE ALL ON FUNCTION private.opportunity_payload_schema_valid(v jsonb, s jsonb, root_schema jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_payload_storage_valid(p jsonb)
REVOKE ALL ON FUNCTION private.opportunity_payload_storage_valid(p jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_capabilities()
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_capabilities() FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_completion_error(p_code text)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_completion_error(p_code text) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_completion_immutable()
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_completion_immutable() FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_current_verification(p_run_id uuid, p_user_id uuid)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_current_verification(p_run_id uuid, p_user_id uuid) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_error(p_code text)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_error(p_code text) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_execution_contract()
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_execution_contract() FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_keys(p_value jsonb, p_keys text[])
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_keys(p_value jsonb, p_keys text[]) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_legacy_queries(p_queries jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_legacy_queries(p_queries jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_manifest(p_run_id uuid)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_manifest(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_number(p_value jsonb, p_min numeric, p_max numeric, p_integer boolean, p_nullable boolean)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_number(p_value jsonb, p_min numeric, p_max numeric, p_integer boolean, p_nullable boolean) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_protocol_text()
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_protocol_text() FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_queries(p_document jsonb, p_core_only boolean, p_manual_only boolean)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_queries(p_document jsonb, p_core_only boolean, p_manual_only boolean) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_shape(p_kind text, p_value jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_shape(p_kind text, p_value jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_source_context(p_user_id uuid, p_search_id uuid, p_ids text[], p_rules jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_source_context(p_user_id uuid, p_search_id uuid, p_ids text[], p_rules jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_sources(p_user_id uuid, p_search_id uuid, p_sources jsonb, p_rules jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_sources(p_user_id uuid, p_search_id uuid, p_sources jsonb, p_rules jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_adaptive_text(p_text text, p_limit integer)
REVOKE ALL ON FUNCTION private.opportunity_search_adaptive_text(p_text text, p_limit integer) FROM PUBLIC;

-- private.FUNCTION opportunity_search_bootstrap(p_run_id uuid)
REVOKE ALL ON FUNCTION private.opportunity_search_bootstrap(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION opportunity_search_deadline_quality(p_date date, p_time time without time zone, p_zone text, p_original text, p_availability text, p_verified boolean, p_discovered_at timestamp with time zone, p_checked_at timestamp with time zone)
REVOKE ALL ON FUNCTION private.opportunity_search_deadline_quality(p_date date, p_time time without time zone, p_zone text, p_original text, p_availability text, p_verified boolean, p_discovered_at timestamp with time zone, p_checked_at timestamp with time zone) FROM PUBLIC;

-- private.FUNCTION opportunity_search_evidence(p_sources jsonb, p_field text)
REVOKE ALL ON FUNCTION private.opportunity_search_evidence(p_sources jsonb, p_field text) FROM PUBLIC;

-- private.FUNCTION opportunity_search_evidence_time(p_source jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_evidence_time(p_source jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_identity_keys(p_payload jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_identity_keys(p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_matches(p_payload jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_matches(p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_normalize_source(s jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_normalize_source(s jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_normalize_url(p_url text)
REVOKE ALL ON FUNCTION private.opportunity_search_normalize_url(p_url text) FROM PUBLIC;

-- private.FUNCTION opportunity_search_planning_context(p_user_id uuid, p_search_id uuid, p_packet jsonb, p_plan_id uuid)
REVOKE ALL ON FUNCTION private.opportunity_search_planning_context(p_user_id uuid, p_search_id uuid, p_packet jsonb, p_plan_id uuid) FROM PUBLIC;

-- private.FUNCTION opportunity_search_result_schema()
REVOKE ALL ON FUNCTION private.opportunity_search_result_schema() FROM PUBLIC;
GRANT ALL ON FUNCTION private.opportunity_search_result_schema() TO authenticated;

-- private.FUNCTION opportunity_search_schema_valid(v jsonb, s jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_schema_valid(v jsonb, s jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_source_kind(s jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_source_kind(s jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_search_support_field(p_field text)
REVOKE ALL ON FUNCTION private.opportunity_search_support_field(p_field text) FROM PUBLIC;

-- private.FUNCTION opportunity_search_uncertain_evidence(p_sources jsonb)
REVOKE ALL ON FUNCTION private.opportunity_search_uncertain_evidence(p_sources jsonb) FROM PUBLIC;

-- private.FUNCTION opportunity_storage_schema()
REVOKE ALL ON FUNCTION private.opportunity_storage_schema() FROM PUBLIC;
GRANT ALL ON FUNCTION private.opportunity_storage_schema() TO authenticated;

-- private.FUNCTION pin_adaptive_batch_plan(p_run_id uuid, p_proposal jsonb, p_plan_hash text)
REVOKE ALL ON FUNCTION private.pin_adaptive_batch_plan(p_run_id uuid, p_proposal jsonb, p_plan_hash text) FROM PUBLIC;

-- private.FUNCTION pin_opportunity_feedback_snapshot(p_user_id uuid, p_search_id uuid, p_run_id uuid)
REVOKE ALL ON FUNCTION private.pin_opportunity_feedback_snapshot(p_user_id uuid, p_search_id uuid, p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION pin_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_run_id uuid, p_plan_id uuid)
REVOKE ALL ON FUNCTION private.pin_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_run_id uuid, p_plan_id uuid) FROM PUBLIC;

-- private.FUNCTION prepare_opportunity_search_execution(p_run_id uuid)
REVOKE ALL ON FUNCTION private.prepare_opportunity_search_execution(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION prevalidate_adaptive_opportunities(p_items jsonb)
REVOKE ALL ON FUNCTION private.prevalidate_adaptive_opportunities(p_items jsonb) FROM PUBLIC;

-- private.FUNCTION prevent_refinement_protocol_update()
REVOKE ALL ON FUNCTION private.prevent_refinement_protocol_update() FROM PUBLIC;

-- private.FUNCTION project_opportunity_feedback(p_user_id uuid, p_opportunity_id uuid)
REVOKE ALL ON FUNCTION private.project_opportunity_feedback(p_user_id uuid, p_opportunity_id uuid) FROM PUBLIC;

-- private.FUNCTION propose_opportunity_search_preference(p_user_id uuid, p_search_id uuid, p_suggestion_id uuid, p_rule jsonb)
REVOKE ALL ON FUNCTION private.propose_opportunity_search_preference(p_user_id uuid, p_search_id uuid, p_suggestion_id uuid, p_rule jsonb) FROM PUBLIC;

-- private.FUNCTION publish_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_query_revision_id uuid, p_document jsonb, p_base_revision integer, p_feedback_revision bigint, p_preference_revision bigint, p_protocol_version text)
REVOKE ALL ON FUNCTION private.publish_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_query_revision_id uuid, p_document jsonb, p_base_revision integer, p_feedback_revision bigint, p_preference_revision bigint, p_protocol_version text) FROM PUBLIC;

-- private.FUNCTION read_adaptive_search_rollback(p_search_id uuid, p_rollback_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION private.read_adaptive_search_rollback(p_search_id uuid, p_rollback_id uuid, p_project_ref text) FROM PUBLIC;

-- private.FUNCTION read_adaptive_search_setup(p_search_id uuid, p_setup_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION private.read_adaptive_search_setup(p_search_id uuid, p_setup_id uuid, p_project_ref text) FROM PUBLIC;

-- private.FUNCTION read_adaptive_search_setup_internal(p_search_id uuid, p_setup_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION private.read_adaptive_search_setup_internal(p_search_id uuid, p_setup_id uuid, p_project_ref text) FROM PUBLIC;

-- private.FUNCTION read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text)
REVOKE ALL ON FUNCTION private.read_current_refinement_request(p_application_id uuid, p_request_id uuid, p_scope text) FROM PUBLIC;

-- private.FUNCTION read_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_plan_id uuid)
REVOKE ALL ON FUNCTION private.read_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_plan_id uuid) FROM PUBLIC;

-- private.FUNCTION read_opportunity_search_run(p_run_id uuid)
REVOKE ALL ON FUNCTION private.read_opportunity_search_run(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION read_refinement_protocol(p_request_id uuid, p_protocol_id text)
REVOKE ALL ON FUNCTION private.read_refinement_protocol(p_request_id uuid, p_protocol_id text) FROM PUBLIC;

-- private.FUNCTION read_refinement_request(request_id uuid)
REVOKE ALL ON FUNCTION private.read_refinement_request(request_id uuid) FROM PUBLIC;

-- private.FUNCTION record_opportunity_search_discovery(p_run_id uuid, p_item_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.record_opportunity_search_discovery(p_run_id uuid, p_item_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION record_opportunity_search_execution(p_run_id uuid, p_report_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.record_opportunity_search_execution(p_run_id uuid, p_report_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION refresh_adaptive_execution_scope(p_run_id uuid)
REVOKE ALL ON FUNCTION private.refresh_adaptive_execution_scope(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION refresh_opportunity_feedback_prediction_proofs(p_run_id uuid, p_item_id uuid)
REVOKE ALL ON FUNCTION private.refresh_opportunity_feedback_prediction_proofs(p_run_id uuid, p_item_id uuid) FROM PUBLIC;

-- private.FUNCTION refresh_opportunity_search_protocol(p_run_id uuid)
REVOKE ALL ON FUNCTION private.refresh_opportunity_search_protocol(p_run_id uuid) FROM PUBLIC;

-- private.FUNCTION require_adaptive_search_scope(p_run_id uuid, p_require_active_lease boolean)
REVOKE ALL ON FUNCTION private.require_adaptive_search_scope(p_run_id uuid, p_require_active_lease boolean) FROM PUBLIC;

-- private.FUNCTION require_adaptive_setup_scope(p_search_id uuid, p_project_ref text, p_adaptive boolean)
REVOKE ALL ON FUNCTION private.require_adaptive_setup_scope(p_search_id uuid, p_project_ref text, p_adaptive boolean) FROM PUBLIC;

-- public.TABLE applications
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.applications TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.applications TO service_role;

-- private.FUNCTION reset_job_application_history(p_application_id uuid)
REVOKE ALL ON FUNCTION private.reset_job_application_history(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.reset_job_application_history(p_application_id uuid) TO authenticated;

-- private.FUNCTION resolve_application_reference(p_reference text)
REVOKE ALL ON FUNCTION private.resolve_application_reference(p_reference text) FROM PUBLIC;

-- private.FUNCTION resolve_application_reference(p_reference text, p_scope text)
REVOKE ALL ON FUNCTION private.resolve_application_reference(p_reference text, p_scope text) FROM PUBLIC;

-- private.FUNCTION retain_successful_opportunity_source(p_user_id uuid, p_search_id uuid, p_opportunity_id uuid, p_listing_url text, p_registry_id uuid)
REVOKE ALL ON FUNCTION private.retain_successful_opportunity_source(p_user_id uuid, p_search_id uuid, p_opportunity_id uuid, p_listing_url text, p_registry_id uuid) FROM PUBLIC;

-- private.FUNCTION rollback_opportunity_search_merge(p_run_id uuid, p_apply boolean)
REVOKE ALL ON FUNCTION private.rollback_opportunity_search_merge(p_run_id uuid, p_apply boolean) FROM PUBLIC;

-- private.FUNCTION save_opportunity_search_queries(p_run_id uuid, p_queries jsonb)
REVOKE ALL ON FUNCTION private.save_opportunity_search_queries(p_run_id uuid, p_queries jsonb) FROM PUBLIC;

-- private.FUNCTION save_refinement_proposal(request_id uuid, proposal_id uuid, payload jsonb)
REVOKE ALL ON FUNCTION private.save_refinement_proposal(request_id uuid, proposal_id uuid, payload jsonb) FROM PUBLIC;

-- private.FUNCTION seed_opportunity_institution_sources(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION private.seed_opportunity_institution_sources(p_user_id uuid, p_search_id uuid) FROM PUBLIC;

-- private.FUNCTION submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb)
REVOKE ALL ON FUNCTION private.submit_adaptive_search_batch(p_run_id uuid, p_batch_id uuid, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION submit_opportunity_search_result(p_run_id uuid, p_item_id uuid, p_opportunity jsonb)
REVOKE ALL ON FUNCTION private.submit_opportunity_search_result(p_run_id uuid, p_item_id uuid, p_opportunity jsonb) FROM PUBLIC;

-- private.FUNCTION validate_adaptive_attribution(p_run_id uuid, p_attribution jsonb, p_execution jsonb)
REVOKE ALL ON FUNCTION private.validate_adaptive_attribution(p_run_id uuid, p_attribution jsonb, p_execution jsonb) FROM PUBLIC;

-- private.FUNCTION validate_adaptive_proposals(p_scope jsonb, p_payload jsonb)
REVOKE ALL ON FUNCTION private.validate_adaptive_proposals(p_scope jsonb, p_payload jsonb) FROM PUBLIC;

-- private.FUNCTION validate_opportunity_search_definition(p_name text, p_criteria jsonb, p_schedule jsonb)
REVOKE ALL ON FUNCTION private.validate_opportunity_search_definition(p_name text, p_criteria jsonb, p_schedule jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.validate_opportunity_search_definition(p_name text, p_criteria jsonb, p_schedule jsonb) TO authenticated;

-- private.FUNCTION validate_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_document jsonb)
REVOKE ALL ON FUNCTION private.validate_opportunity_search_plan(p_user_id uuid, p_search_id uuid, p_document jsonb) FROM PUBLIC;

-- private.FUNCTION validate_opportunity_search_result(p jsonb)
REVOKE ALL ON FUNCTION private.validate_opportunity_search_result(p jsonb) FROM PUBLIC;

-- private.FUNCTION verify_and_complete_adaptive_search(p_run_id uuid, p_completion jsonb)
REVOKE ALL ON FUNCTION private.verify_and_complete_adaptive_search(p_run_id uuid, p_completion jsonb) FROM PUBLIC;

-- private.FUNCTION verify_opportunity_search_discovery(p_run_id uuid, p_item_id uuid)
REVOKE ALL ON FUNCTION private.verify_opportunity_search_discovery(p_run_id uuid, p_item_id uuid) FROM PUBLIC;

-- private.FUNCTION verify_opportunity_search_result(p_run_id uuid, p_item_id uuid)
REVOKE ALL ON FUNCTION private.verify_opportunity_search_result(p_run_id uuid, p_item_id uuid) FROM PUBLIC;

-- public.FUNCTION adaptive_search_runner_state(p_user_id uuid, p_search_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION public.adaptive_search_runner_state(p_user_id uuid, p_search_id uuid, p_project_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adaptive_search_runner_state(p_user_id uuid, p_search_id uuid, p_project_ref text) TO authenticated;

-- public.FUNCTION adaptive_search_setup_capable()
REVOKE ALL ON FUNCTION public.adaptive_search_setup_capable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.adaptive_search_setup_capable() TO authenticated;

-- public.FUNCTION adaptive_search_setup_schedule(p_value jsonb)
REVOKE ALL ON FUNCTION public.adaptive_search_setup_schedule(p_value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adaptive_search_setup_schedule(p_value jsonb) TO authenticated;

-- public.FUNCTION adaptive_search_setup_task_id(p_value text)
REVOKE ALL ON FUNCTION public.adaptive_search_setup_task_id(p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.adaptive_search_setup_task_id(p_value text) TO authenticated;

-- public.FUNCTION assign_job_application_cv(p_application_id uuid, p_cv_variant_id uuid, p_cv_name text, p_content_json jsonb, p_config_json jsonb, p_cv_version integer, p_changes jsonb)
REVOKE ALL ON FUNCTION public.assign_job_application_cv(p_application_id uuid, p_cv_variant_id uuid, p_cv_name text, p_content_json jsonb, p_config_json jsonb, p_cv_version integer, p_changes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_job_application_cv(p_application_id uuid, p_cv_variant_id uuid, p_cv_name text, p_content_json jsonb, p_config_json jsonb, p_cv_version integer, p_changes jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.assign_job_application_cv(p_application_id uuid, p_cv_variant_id uuid, p_cv_name text, p_content_json jsonb, p_config_json jsonb, p_cv_version integer, p_changes jsonb) TO service_role;

-- public.FUNCTION build_opportunity_search_feedback(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION public.build_opportunity_search_feedback(p_user_id uuid, p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.build_opportunity_search_feedback(p_user_id uuid, p_search_id uuid) TO authenticated;

-- public.FUNCTION clear_refinement_history(p_application_id uuid, p_expected_revision integer)
REVOKE ALL ON FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer) TO authenticated;

-- public.FUNCTION clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text)
REVOKE ALL ON FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_refinement_history(p_application_id uuid, p_expected_revision integer, p_scope text) TO authenticated;

-- public.FUNCTION create_job_application(p_application_id uuid, p_opportunity_id uuid)
REVOKE ALL ON FUNCTION public.create_job_application(p_application_id uuid, p_opportunity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_job_application(p_application_id uuid, p_opportunity_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_job_application(p_application_id uuid, p_opportunity_id uuid) TO service_role;

-- public.FUNCTION cv_adjustment_validate_request(value jsonb, expected_id uuid)
REVOKE ALL ON FUNCTION public.cv_adjustment_validate_request(value jsonb, expected_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cv_adjustment_validate_request(value jsonb, expected_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cv_adjustment_validate_request(value jsonb, expected_id uuid) TO service_role;

-- public.FUNCTION cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid)
REVOKE ALL ON FUNCTION public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cv_adjustment_validate_response(value jsonb, request_value jsonb, expected_id uuid) TO service_role;

-- public.FUNCTION decide_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_action text, p_expected_revision bigint, p_operation_id uuid)
REVOKE ALL ON FUNCTION public.decide_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_action text, p_expected_revision bigint, p_operation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_action text, p_expected_revision bigint, p_operation_id uuid) TO authenticated;

-- public.FUNCTION delete_local_attachment_metadata(p_id uuid)
REVOKE ALL ON FUNCTION public.delete_local_attachment_metadata(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_local_attachment_metadata(p_id uuid) TO authenticated;

-- public.FUNCTION guard_adaptive_search_runner_config()
REVOKE ALL ON FUNCTION public.guard_adaptive_search_runner_config() FROM PUBLIC;

-- public.FUNCTION job_drafting_redact_samples(value jsonb)
REVOKE ALL ON FUNCTION public.job_drafting_redact_samples(value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_drafting_redact_samples(value jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.job_drafting_redact_samples(value jsonb) TO service_role;

-- public.FUNCTION job_workspace_adaptation_settings()
REVOKE ALL ON FUNCTION public.job_workspace_adaptation_settings() FROM PUBLIC;

-- public.FUNCTION job_workspace_adaptive_release()
REVOKE ALL ON FUNCTION public.job_workspace_adaptive_release() FROM PUBLIC;

-- public.FUNCTION job_workspace_adaptive_run_pins()
REVOKE ALL ON FUNCTION public.job_workspace_adaptive_run_pins() FROM PUBLIC;

-- public.FUNCTION job_workspace_assessment_invalidate_feedback()
REVOKE ALL ON FUNCTION public.job_workspace_assessment_invalidate_feedback() FROM PUBLIC;

-- public.FUNCTION job_workspace_assign_application_code()
REVOKE ALL ON FUNCTION public.job_workspace_assign_application_code() FROM PUBLIC;

-- public.FUNCTION job_workspace_breadth_settings()
REVOKE ALL ON FUNCTION public.job_workspace_breadth_settings() FROM PUBLIC;

-- public.FUNCTION job_workspace_capture_application_context()
REVOKE ALL ON FUNCTION public.job_workspace_capture_application_context() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_workspace_capture_application_context() TO service_role;

-- public.FUNCTION job_workspace_dashboard_action()
REVOKE ALL ON FUNCTION public.job_workspace_dashboard_action() FROM PUBLIC;

-- public.FUNCTION job_workspace_discovery_immutable()
REVOKE ALL ON FUNCTION public.job_workspace_discovery_immutable() FROM PUBLIC;

-- public.FUNCTION job_workspace_evaluation_revision()
REVOKE ALL ON FUNCTION public.job_workspace_evaluation_revision() FROM PUBLIC;

-- public.FUNCTION job_workspace_execution_immutable()
REVOKE ALL ON FUNCTION public.job_workspace_execution_immutable() FROM PUBLIC;

-- public.FUNCTION job_workspace_feedback_invalidation()
REVOKE ALL ON FUNCTION public.job_workspace_feedback_invalidation() FROM PUBLIC;

-- public.FUNCTION job_workspace_feedback_pin_guard()
REVOKE ALL ON FUNCTION public.job_workspace_feedback_pin_guard() FROM PUBLIC;

-- public.FUNCTION job_workspace_feedback_revision()
REVOKE ALL ON FUNCTION public.job_workspace_feedback_revision() FROM PUBLIC;

-- public.FUNCTION job_workspace_guard_cv_snapshot()
REVOKE ALL ON FUNCTION public.job_workspace_guard_cv_snapshot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_workspace_guard_cv_snapshot() TO service_role;

-- public.FUNCTION job_workspace_plan_immutable()
REVOKE ALL ON FUNCTION public.job_workspace_plan_immutable() FROM PUBLIC;

-- public.FUNCTION job_workspace_plan_settings()
REVOKE ALL ON FUNCTION public.job_workspace_plan_settings() FROM PUBLIC;

-- public.FUNCTION job_workspace_preference_action()
REVOKE ALL ON FUNCTION public.job_workspace_preference_action() FROM PUBLIC;

-- public.FUNCTION job_workspace_preference_invalidation()
REVOKE ALL ON FUNCTION public.job_workspace_preference_invalidation() FROM PUBLIC;

-- public.FUNCTION job_workspace_preference_suggestion()
REVOKE ALL ON FUNCTION public.job_workspace_preference_suggestion() FROM PUBLIC;

-- public.FUNCTION job_workspace_query_plan_pin()
REVOKE ALL ON FUNCTION public.job_workspace_query_plan_pin() FROM PUBLIC;

-- public.FUNCTION job_workspace_record_status()
REVOKE ALL ON FUNCTION public.job_workspace_record_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_workspace_record_status() TO service_role;

-- public.FUNCTION job_workspace_rollback_request()
REVOKE ALL ON FUNCTION public.job_workspace_rollback_request() FROM PUBLIC;

-- public.FUNCTION job_workspace_runner_authorization()
REVOKE ALL ON FUNCTION public.job_workspace_runner_authorization() FROM PUBLIC;

-- public.FUNCTION job_workspace_snapshot_redaction()
REVOKE ALL ON FUNCTION public.job_workspace_snapshot_redaction() FROM PUBLIC;

-- public.FUNCTION job_workspace_snapshot_settings()
REVOKE ALL ON FUNCTION public.job_workspace_snapshot_settings() FROM PUBLIC;

-- public.FUNCTION job_workspace_source_guard()
REVOKE ALL ON FUNCTION public.job_workspace_source_guard() FROM PUBLIC;

-- public.FUNCTION job_workspace_source_invalidation()
REVOKE ALL ON FUNCTION public.job_workspace_source_invalidation() FROM PUBLIC;

-- public.FUNCTION job_workspace_touch_updated_at()
REVOKE ALL ON FUNCTION public.job_workspace_touch_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.job_workspace_touch_updated_at() TO service_role;

-- public.FUNCTION job_workspace_track_stage()
REVOKE ALL ON FUNCTION public.job_workspace_track_stage() FROM PUBLIC;

-- public.FUNCTION opportunity_feedback_inclusion(p_comment text, p_revision bigint)
REVOKE ALL ON FUNCTION public.opportunity_feedback_inclusion(p_comment text, p_revision bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_inclusion(p_comment text, p_revision bigint) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_baseline_matches(p_baseline jsonb, p_user_id uuid, p_opportunity_id uuid, p_feedback_at timestamp with time zone) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_candidate(p_user_id uuid, p_opportunity_id uuid, p_before timestamp with time zone) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_metric(p_user_id uuid, p_opportunity_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_metric(p_user_id uuid, p_opportunity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_metric(p_user_id uuid, p_opportunity_id uuid) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_owner(p_user_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_owner(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_owner(p_user_id uuid) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_text(p_text text, p_max_length integer)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_text(p_text text, p_max_length integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_text(p_text text, p_max_length integer) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_time(p_value text)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_time(p_value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_time(p_value text) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_url(p_url text)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_url(p_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_url(p_url text) TO authenticated;

-- public.FUNCTION opportunity_feedback_preview_url_decoded(p_text text)
REVOKE ALL ON FUNCTION public.opportunity_feedback_preview_url_decoded(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_preview_url_decoded(p_text text) TO authenticated;

-- public.FUNCTION opportunity_feedback_safe_text(p_text text, p_max_length integer)
REVOKE ALL ON FUNCTION public.opportunity_feedback_safe_text(p_text text, p_max_length integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_feedback_safe_text(p_text text, p_max_length integer) TO authenticated;

-- public.FUNCTION opportunity_institution_source_configuration()
REVOKE ALL ON FUNCTION public.opportunity_institution_source_configuration() FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_institution_source_configuration() TO authenticated;

-- public.FUNCTION opportunity_search_adaptation_policy()
REVOKE ALL ON FUNCTION public.opportunity_search_adaptation_policy() FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_adaptation_policy() TO authenticated;

-- public.FUNCTION opportunity_search_adaptation_policy(p_search_breadth_percent integer)
REVOKE ALL ON FUNCTION public.opportunity_search_adaptation_policy(p_search_breadth_percent integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_adaptation_policy(p_search_breadth_percent integer) TO authenticated;

-- public.FUNCTION opportunity_search_dashboard_number(p_value jsonb)
REVOKE ALL ON FUNCTION public.opportunity_search_dashboard_number(p_value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_dashboard_number(p_value jsonb) TO authenticated;

-- public.FUNCTION opportunity_search_dashboard_outcomes(p_search_id uuid, p_registry_id uuid, p_query_id uuid, p_text_hash text)
REVOKE ALL ON FUNCTION public.opportunity_search_dashboard_outcomes(p_search_id uuid, p_registry_id uuid, p_query_id uuid, p_text_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_dashboard_outcomes(p_search_id uuid, p_registry_id uuid, p_query_id uuid, p_text_hash text) TO authenticated;

-- public.FUNCTION opportunity_search_dashboard_query(p_text text)
REVOKE ALL ON FUNCTION public.opportunity_search_dashboard_query(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_dashboard_query(p_text text) TO authenticated;

-- public.FUNCTION opportunity_search_dashboard_settings(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_search_dashboard_settings(p_user_id uuid, p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_dashboard_settings(p_user_id uuid, p_search_id uuid) TO authenticated;

-- public.TABLE opportunity_search_sources
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunity_search_sources TO authenticated;

-- public.FUNCTION opportunity_search_dashboard_source(p_source public.opportunity_search_sources)
REVOKE ALL ON FUNCTION public.opportunity_search_dashboard_source(p_source public.opportunity_search_sources) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_dashboard_source(p_source public.opportunity_search_sources) TO authenticated;

-- public.FUNCTION opportunity_search_planning_capacity(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_search_planning_capacity(p_user_id uuid, p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_planning_capacity(p_user_id uuid, p_search_id uuid) TO authenticated;

-- public.FUNCTION opportunity_search_preference_document(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_search_preference_document(p_user_id uuid, p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_preference_document(p_user_id uuid, p_search_id uuid) TO authenticated;

-- public.FUNCTION opportunity_search_public_text(p_text text, p_limit integer)
REVOKE ALL ON FUNCTION public.opportunity_search_public_text(p_text text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_public_text(p_text text, p_limit integer) TO authenticated;

-- public.FUNCTION opportunity_search_readiness()
REVOKE ALL ON FUNCTION public.opportunity_search_readiness() FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_readiness() TO authenticated;

-- public.FUNCTION opportunity_search_rollback_binding_hash(p_user_id uuid, p_search_id uuid)
REVOKE ALL ON FUNCTION public.opportunity_search_rollback_binding_hash(p_user_id uuid, p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_rollback_binding_hash(p_user_id uuid, p_search_id uuid) TO authenticated;

-- public.FUNCTION opportunity_search_source_url(p_url text)
REVOKE ALL ON FUNCTION public.opportunity_search_source_url(p_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_source_url(p_url text) TO authenticated;

-- public.FUNCTION opportunity_search_url_decoded(p_text text)
REVOKE ALL ON FUNCTION public.opportunity_search_url_decoded(p_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_url_decoded(p_text text) TO authenticated;

-- public.FUNCTION opportunity_search_validate_preference_rule(p_user_id uuid, p_search_id uuid, p_rule jsonb, p_require_evidence boolean)
REVOKE ALL ON FUNCTION public.opportunity_search_validate_preference_rule(p_user_id uuid, p_search_id uuid, p_rule jsonb, p_require_evidence boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.opportunity_search_validate_preference_rule(p_user_id uuid, p_search_id uuid, p_rule jsonb, p_require_evidence boolean) TO authenticated;

-- public.FUNCTION patch_opportunity_search_settings(p_search_id uuid, p_action_id uuid, p_patch jsonb, p_expected_revisions jsonb)
REVOKE ALL ON FUNCTION public.patch_opportunity_search_settings(p_search_id uuid, p_action_id uuid, p_patch jsonb, p_expected_revisions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.patch_opportunity_search_settings(p_search_id uuid, p_action_id uuid, p_patch jsonb, p_expected_revisions jsonb) TO authenticated;

-- public.FUNCTION patch_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_action_id uuid, p_patch jsonb, p_expected_source_revision bigint)
REVOKE ALL ON FUNCTION public.patch_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_action_id uuid, p_patch jsonb, p_expected_source_revision bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.patch_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_action_id uuid, p_patch jsonb, p_expected_source_revision bigint) TO authenticated;

-- public.FUNCTION preview_opportunity_search_feedback(p_search_id uuid)
REVOKE ALL ON FUNCTION public.preview_opportunity_search_feedback(p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.preview_opportunity_search_feedback(p_search_id uuid) TO authenticated;

-- public.FUNCTION project_opportunity_feedback_preview(p_user_id uuid, p_opportunity_id uuid)
REVOKE ALL ON FUNCTION public.project_opportunity_feedback_preview(p_user_id uuid, p_opportunity_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.project_opportunity_feedback_preview(p_user_id uuid, p_opportunity_id uuid) TO authenticated;

-- public.FUNCTION propose_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_rule jsonb)
REVOKE ALL ON FUNCTION public.propose_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_rule jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.propose_opportunity_search_preference(p_search_id uuid, p_suggestion_id uuid, p_rule jsonb) TO authenticated;

-- public.FUNCTION publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text)
REVOKE ALL ON FUNCTION public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_refinement_protocol(p_request_id uuid, p_protocol_id text, p_protocol_text text) TO authenticated;

-- public.FUNCTION publish_refinement_request(p_request jsonb)
REVOKE ALL ON FUNCTION public.publish_refinement_request(p_request jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_refinement_request(p_request jsonb) TO authenticated;

-- public.FUNCTION read_adaptive_search_readiness(p_search_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION public.read_adaptive_search_readiness(p_search_id uuid, p_project_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_adaptive_search_readiness(p_search_id uuid, p_project_ref text) TO authenticated;

-- public.FUNCTION read_opportunity_search_dashboard(p_search_id uuid, p_project_ref text)
REVOKE ALL ON FUNCTION public.read_opportunity_search_dashboard(p_search_id uuid, p_project_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_opportunity_search_dashboard(p_search_id uuid, p_project_ref text) TO authenticated;

-- public.FUNCTION read_opportunity_search_metrics(p_search_id uuid)
REVOKE ALL ON FUNCTION public.read_opportunity_search_metrics(p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_opportunity_search_metrics(p_search_id uuid) TO authenticated;

-- public.FUNCTION read_opportunity_search_preferences(p_search_id uuid)
REVOKE ALL ON FUNCTION public.read_opportunity_search_preferences(p_search_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_opportunity_search_preferences(p_search_id uuid) TO authenticated;

-- public.FUNCTION refinement_activate_request()
REVOKE ALL ON FUNCTION public.refinement_activate_request() FROM PUBLIC;

-- public.FUNCTION refinement_capture_proposal()
REVOKE ALL ON FUNCTION public.refinement_capture_proposal() FROM PUBLIC;

-- public.FUNCTION refinement_capture_request()
REVOKE ALL ON FUNCTION public.refinement_capture_request() FROM PUBLIC;

-- public.FUNCTION refinement_capture_review()
REVOKE ALL ON FUNCTION public.refinement_capture_review() FROM PUBLIC;

-- public.FUNCTION refinement_capture_state()
REVOKE ALL ON FUNCTION public.refinement_capture_state() FROM PUBLIC;

-- public.FUNCTION refinement_close_spelling(before_word text, after_word text, budget integer)
REVOKE ALL ON FUNCTION public.refinement_close_spelling(before_word text, after_word text, budget integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_close_spelling(before_word text, after_word text, budget integer) TO authenticated;

-- public.FUNCTION refinement_exact_keys(value jsonb, keys text[])
REVOKE ALL ON FUNCTION public.refinement_exact_keys(value jsonb, keys text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_exact_keys(value jsonb, keys text[]) TO authenticated;

-- public.FUNCTION refinement_guard_immutable()
REVOKE ALL ON FUNCTION public.refinement_guard_immutable() FROM PUBLIC;

-- public.FUNCTION refinement_guard_initial_history_scope()
REVOKE ALL ON FUNCTION public.refinement_guard_initial_history_scope() FROM PUBLIC;

-- public.FUNCTION refinement_reference_permutation(value jsonb, expected jsonb)
REVOKE ALL ON FUNCTION public.refinement_reference_permutation(value jsonb, expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_reference_permutation(value jsonb, expected jsonb) TO authenticated;

-- public.FUNCTION refinement_utf16_length(value text)
REVOKE ALL ON FUNCTION public.refinement_utf16_length(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_utf16_length(value text) TO authenticated;

-- public.FUNCTION refinement_validate_annotations(value jsonb, fields jsonb, letter_text text)
REVOKE ALL ON FUNCTION public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_annotations(value jsonb, fields jsonb, letter_text text) TO authenticated;

-- public.FUNCTION refinement_validate_cv_decisions(value jsonb, proposal jsonb)
REVOKE ALL ON FUNCTION public.refinement_validate_cv_decisions(value jsonb, proposal jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_cv_decisions(value jsonb, proposal jsonb) TO authenticated;

-- public.FUNCTION refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid)
REVOKE ALL ON FUNCTION public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_cv_operations(value jsonb, request_value jsonb, expected_id uuid) TO authenticated;

-- public.FUNCTION refinement_validate_cv_structure(value jsonb, fields jsonb)
REVOKE ALL ON FUNCTION public.refinement_validate_cv_structure(value jsonb, fields jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_cv_structure(value jsonb, fields jsonb) TO authenticated;

-- public.FUNCTION refinement_validate_privacy_legend(value jsonb, fields jsonb)
REVOKE ALL ON FUNCTION public.refinement_validate_privacy_legend(value jsonb, fields jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_privacy_legend(value jsonb, fields jsonb) TO authenticated;

-- public.FUNCTION refinement_validate_setup(value jsonb)
REVOKE ALL ON FUNCTION public.refinement_validate_setup(value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_setup(value jsonb) TO authenticated;

-- public.FUNCTION refinement_validate_typo_fix(original text, replacement text, expected_id uuid)
REVOKE ALL ON FUNCTION public.refinement_validate_typo_fix(original text, replacement text, expected_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refinement_validate_typo_fix(original text, replacement text, expected_id uuid) TO authenticated;

-- public.FUNCTION refresh_job_application_context(p_application_id uuid)
REVOKE ALL ON FUNCTION public.refresh_job_application_context(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_job_application_context(p_application_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.refresh_job_application_context(p_application_id uuid) TO service_role;

-- public.FUNCTION remove_job_application(p_application_id uuid)
REVOKE ALL ON FUNCTION public.remove_job_application(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_job_application(p_application_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.remove_job_application(p_application_id uuid) TO service_role;

-- public.FUNCTION request_adaptive_search_migration(p_search_id uuid, p_project_ref text, p_expected_revision bigint, p_setup_id uuid)
REVOKE ALL ON FUNCTION public.request_adaptive_search_migration(p_search_id uuid, p_project_ref text, p_expected_revision bigint, p_setup_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_adaptive_search_migration(p_search_id uuid, p_project_ref text, p_expected_revision bigint, p_setup_id uuid) TO authenticated;

-- public.FUNCTION request_adaptive_search_rollback(p_search_id uuid, p_project_ref text, p_expected_runner_revision bigint, p_expected_rollback_revision bigint, p_rollback_id uuid, p_accept_reviewed_fallback boolean)
REVOKE ALL ON FUNCTION public.request_adaptive_search_rollback(p_search_id uuid, p_project_ref text, p_expected_runner_revision bigint, p_expected_rollback_revision bigint, p_rollback_id uuid, p_accept_reviewed_fallback boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_adaptive_search_rollback(p_search_id uuid, p_project_ref text, p_expected_runner_revision bigint, p_expected_rollback_revision bigint, p_rollback_id uuid, p_accept_reviewed_fallback boolean) TO authenticated;

-- public.FUNCTION reset_job_application_history(p_application_id uuid)
REVOKE ALL ON FUNCTION public.reset_job_application_history(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_job_application_history(p_application_id uuid) TO authenticated;

-- public.FUNCTION resolve_application_reference(p_reference text)
REVOKE ALL ON FUNCTION public.resolve_application_reference(p_reference text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_application_reference(p_reference text) TO authenticated;

-- public.FUNCTION resolve_application_reference(p_reference text, p_scope text)
REVOKE ALL ON FUNCTION public.resolve_application_reference(p_reference text, p_scope text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_application_reference(p_reference text, p_scope text) TO authenticated;

-- public.FUNCTION review_job_opportunity(p_opportunity_id uuid, p_observed_updated_at timestamp with time zone, p_state text)
REVOKE ALL ON FUNCTION public.review_job_opportunity(p_opportunity_id uuid, p_observed_updated_at timestamp with time zone, p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_job_opportunity(p_opportunity_id uuid, p_observed_updated_at timestamp with time zone, p_state text) TO authenticated;
GRANT ALL ON FUNCTION public.review_job_opportunity(p_opportunity_id uuid, p_observed_updated_at timestamp with time zone, p_state text) TO service_role;

-- public.FUNCTION save_local_attachment_metadata(p_id uuid, p_name text, p_description text)
REVOKE ALL ON FUNCTION public.save_local_attachment_metadata(p_id uuid, p_name text, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_local_attachment_metadata(p_id uuid, p_name text, p_description text) TO authenticated;

-- public.FUNCTION save_opportunity_comment(p_opportunity_id uuid, p_comment text)
REVOKE ALL ON FUNCTION public.save_opportunity_comment(p_opportunity_id uuid, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_comment(p_opportunity_id uuid, p_comment text) TO authenticated;
GRANT ALL ON FUNCTION public.save_opportunity_comment(p_opportunity_id uuid, p_comment text) TO service_role;

-- public.FUNCTION save_opportunity_feedback(p_opportunity_id uuid, p_patch jsonb)
REVOKE ALL ON FUNCTION public.save_opportunity_feedback(p_opportunity_id uuid, p_patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_feedback(p_opportunity_id uuid, p_patch jsonb) TO authenticated;

-- public.TABLE opportunity_search_templates
GRANT SELECT,INSERT,UPDATE ON TABLE public.opportunity_search_templates TO authenticated;

-- public.FUNCTION save_opportunity_meta_search(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb)
REVOKE ALL ON FUNCTION public.save_opportunity_meta_search(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_meta_search(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.save_opportunity_meta_search(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb, p_meta_search jsonb) TO service_role;

-- public.FUNCTION save_opportunity_search_adaptation(p_search_id uuid, p_enabled boolean, p_paused boolean, p_expected_revision bigint)
REVOKE ALL ON FUNCTION public.save_opportunity_search_adaptation(p_search_id uuid, p_enabled boolean, p_paused boolean, p_expected_revision bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_search_adaptation(p_search_id uuid, p_enabled boolean, p_paused boolean, p_expected_revision bigint) TO authenticated;

-- public.FUNCTION save_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_patch jsonb)
REVOKE ALL ON FUNCTION public.save_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_search_source(p_search_id uuid, p_registry_id uuid, p_patch jsonb) TO authenticated;

-- public.FUNCTION save_opportunity_search_template(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb)
REVOKE ALL ON FUNCTION public.save_opportunity_search_template(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_opportunity_search_template(p_id uuid, p_expected_revision integer, p_name text, p_criteria jsonb, p_schedule jsonb) TO authenticated;

-- public.FUNCTION save_refinement_review(p_application_id uuid, p_request_id uuid, p_kind text, p_payload jsonb, p_id uuid)
REVOKE ALL ON FUNCTION public.save_refinement_review(p_application_id uuid, p_request_id uuid, p_kind text, p_payload jsonb, p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_refinement_review(p_application_id uuid, p_request_id uuid, p_kind text, p_payload jsonb, p_id uuid) TO authenticated;

-- public.FUNCTION save_refinement_state(p_application_id uuid, p_setup jsonb, p_approvals jsonb, p_expected_revision integer)
REVOKE ALL ON FUNCTION public.save_refinement_state(p_application_id uuid, p_setup jsonb, p_approvals jsonb, p_expected_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_refinement_state(p_application_id uuid, p_setup jsonb, p_approvals jsonb, p_expected_revision integer) TO authenticated;

-- public.FUNCTION set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean)
REVOKE ALL ON FUNCTION public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_job_application_checklist_item(p_application_id uuid, p_item_key text, p_completed boolean) TO service_role;

-- public.FUNCTION set_job_application_stage(p_application_id uuid, p_stage text)
REVOKE ALL ON FUNCTION public.set_job_application_stage(p_application_id uuid, p_stage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_job_application_stage(p_application_id uuid, p_stage text) TO authenticated;

-- public.FUNCTION set_opportunity_search_runner_authorization(p_search_id uuid, p_project_ref text, p_enabled boolean, p_expected_revision bigint)
REVOKE ALL ON FUNCTION public.set_opportunity_search_runner_authorization(p_search_id uuid, p_project_ref text, p_enabled boolean, p_expected_revision bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_opportunity_search_runner_authorization(p_search_id uuid, p_project_ref text, p_enabled boolean, p_expected_revision bigint) TO authenticated;

-- public.FUNCTION set_opportunity_source_reuse(p_search_id uuid, p_enabled boolean, p_interval_hours integer)
REVOKE ALL ON FUNCTION public.set_opportunity_source_reuse(p_search_id uuid, p_enabled boolean, p_interval_hours integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_opportunity_source_reuse(p_search_id uuid, p_enabled boolean, p_interval_hours integer) TO authenticated;

-- private.TABLE opportunity_search_protocols
GRANT SELECT ON TABLE private.opportunity_search_protocols TO authenticated;

-- private.TABLE opportunity_search_settings
GRANT SELECT ON TABLE private.opportunity_search_settings TO authenticated;

-- public.TABLE application_refinement_proposals
GRANT SELECT ON TABLE public.application_refinement_proposals TO authenticated;

-- public.TABLE application_refinement_protocols
GRANT SELECT,INSERT ON TABLE public.application_refinement_protocols TO authenticated;

-- public.TABLE application_refinement_requests
GRANT SELECT,INSERT ON TABLE public.application_refinement_requests TO authenticated;

-- public.TABLE application_refinement_reviews
GRANT SELECT,INSERT ON TABLE public.application_refinement_reviews TO authenticated;

-- public.TABLE application_refinement_state
GRANT SELECT,INSERT,UPDATE ON TABLE public.application_refinement_state TO authenticated;

-- public.TABLE cv_variants
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cv_variants TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.cv_variants TO service_role;

-- public.TABLE local_attachment_metadata
GRANT SELECT,INSERT,DELETE ON TABLE public.local_attachment_metadata TO authenticated;

-- public.COLUMN local_attachment_metadata.name
GRANT UPDATE(name) ON TABLE public.local_attachment_metadata TO authenticated;

-- public.COLUMN local_attachment_metadata.description
GRANT UPDATE(description) ON TABLE public.local_attachment_metadata TO authenticated;

-- public.TABLE opportunities
GRANT SELECT ON TABLE public.opportunities TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunities TO service_role;

-- public.TABLE opportunity_feedback_prediction_proofs
GRANT SELECT ON TABLE public.opportunity_feedback_prediction_proofs TO authenticated;

-- public.TABLE opportunity_reviews
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunity_reviews TO authenticated;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunity_reviews TO service_role;

-- public.TABLE opportunity_search_adaptive_proposals
GRANT SELECT ON TABLE public.opportunity_search_adaptive_proposals TO authenticated;

-- public.TABLE opportunity_search_adaptive_release
GRANT SELECT ON TABLE public.opportunity_search_adaptive_release TO authenticated;

-- public.TABLE opportunity_search_adaptive_settings
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunity_search_adaptive_settings TO authenticated;
GRANT SELECT,UPDATE ON TABLE public.opportunity_search_adaptive_settings TO service_role;

-- public.TABLE opportunity_search_dashboard_actions
GRANT SELECT,INSERT ON TABLE public.opportunity_search_dashboard_actions TO authenticated;

-- public.TABLE opportunity_search_discoveries
GRANT SELECT ON TABLE public.opportunity_search_discoveries TO authenticated;

-- public.TABLE opportunity_search_execution_receipts
GRANT SELECT ON TABLE public.opportunity_search_execution_receipts TO authenticated;

-- public.TABLE opportunity_search_executions
GRANT SELECT ON TABLE public.opportunity_search_executions TO authenticated;

-- public.TABLE opportunity_search_feedback_snapshots
GRANT SELECT,UPDATE ON TABLE public.opportunity_search_feedback_snapshots TO authenticated;
GRANT SELECT,UPDATE ON TABLE public.opportunity_search_feedback_snapshots TO service_role;

-- public.TABLE opportunity_search_preference_actions
GRANT SELECT,INSERT ON TABLE public.opportunity_search_preference_actions TO authenticated;

-- public.SEQUENCE opportunity_search_preference_actions_sequence_seq
GRANT USAGE ON SEQUENCE public.opportunity_search_preference_actions_sequence_seq TO authenticated;

-- public.TABLE opportunity_search_preference_suggestions
GRANT SELECT,INSERT ON TABLE public.opportunity_search_preference_suggestions TO authenticated;

-- public.TABLE opportunity_search_query_plans
GRANT SELECT ON TABLE public.opportunity_search_query_plans TO authenticated;

-- public.TABLE opportunity_search_query_revisions
GRANT SELECT ON TABLE public.opportunity_search_query_revisions TO authenticated;

-- public.TABLE opportunity_search_receipts
GRANT SELECT ON TABLE public.opportunity_search_receipts TO authenticated;

-- public.TABLE opportunity_search_rollback_requests
GRANT SELECT,INSERT ON TABLE public.opportunity_search_rollback_requests TO authenticated;

-- public.TABLE opportunity_search_runner_authorizations
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.opportunity_search_runner_authorizations TO authenticated;

-- public.TABLE opportunity_search_runner_config
GRANT SELECT,INSERT,UPDATE ON TABLE public.opportunity_search_runner_config TO authenticated;

-- public.TABLE opportunity_search_runs
GRANT SELECT ON TABLE public.opportunity_search_runs TO authenticated;

-- public.TABLE opportunity_search_schedule_bindings
GRANT SELECT ON TABLE public.opportunity_search_schedule_bindings TO authenticated;

-- public.TABLE opportunity_search_setup_claims
GRANT SELECT ON TABLE public.opportunity_search_setup_claims TO authenticated;



-- Preserve the current deployed administrative table grants.
GRANT ALL PRIVILEGES ON TABLE public.opportunities TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.opportunity_reviews TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.applications TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.cv_variants TO service_role;

-- Lifecycle operations are private owner-authorized commands, never an executable research packet.
ALTER TABLE private.opportunity_search_lifecycle_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.opportunity_search_lifecycle_operations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.adaptive_search_lifecycle_error(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_search_run_not_aborted(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_adaptive_search_lifecycle_start(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.adaptive_search_lifecycle_target_version(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.adaptive_search_lifecycle_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.apply_adaptive_search_lifecycle(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.read_adaptive_search_lifecycle(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_adaptive_search_lifecycle(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apply_adaptive_search_lifecycle(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_adaptive_search_lifecycle(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_adaptive_search_lifecycle(uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_adaptive_search_lifecycle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_adaptive_search_lifecycle(uuid) TO authenticated;
COMMENT ON TABLE private.opportunity_search_lifecycle_operations IS 'Authenticated owner-prepared, immutable target binding for controlled abort and at most one reserved restart. No research payload or provider dispatch receipt.';
COMMENT ON COLUMN public.opportunity_search_runs.owner_cancel_operation_id IS 'Permanent mutation fence and audit link for an owner-cancelled execution. Cancellation is represented as failed with partial coverage, never successful completion.';

-- Current adaptive hosted helpers and their internal coverage implementation.
-- These remain management-only; the task binding is not an application-role grant.
REVOKE ALL ON FUNCTION private.record_adaptive_search_coverage(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.finish_adaptive_search(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.adaptive_search_hosted_protocol_text() FROM PUBLIC,anon,authenticated,service_role;
