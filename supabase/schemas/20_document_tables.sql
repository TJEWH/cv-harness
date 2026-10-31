-- Current desired schema: 20_document_tables.sql
-- Derived from the isolated PostgreSQL 17 catalogue; no historical upgrade replay.

-- public.applications
CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    cv_variant_id uuid,
    contact_email text,
    status text DEFAULT 'preparation'::text NOT NULL,
    notes text,
    contacted_at timestamp with time zone,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    context_json jsonb NOT NULL,
    context_captured_at timestamp with time zone NOT NULL,
    completed_checklist_keys text[] DEFAULT '{}'::text[] NOT NULL,
    application_code text NOT NULL,
    status_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    workflow_stage text DEFAULT 'preparation'::text NOT NULL,
    tracking_started boolean DEFAULT false NOT NULL,
    CONSTRAINT applications_application_code_format CHECK ((application_code ~ '^APP-[A-F0-9]{10}$'::text)),
    CONSTRAINT applications_checklist_bounds CHECK (((COALESCE(array_ndims(completed_checklist_keys), 1) = 1) AND (cardinality(completed_checklist_keys) <= 500) AND (array_position(completed_checklist_keys, NULL::text) IS NULL) AND (octet_length((completed_checklist_keys)::text) <= 262144))),
    CONSTRAINT applications_contact_email_check CHECK ((((char_length(contact_email) >= 3) AND (char_length(contact_email) <= 254)) AND (contact_email = btrim(contact_email)) AND (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text))),
    CONSTRAINT applications_context_object CHECK ((jsonb_typeof(context_json) = 'object'::text)),
    CONSTRAINT applications_status_check CHECK ((status = ANY (ARRAY['preparation'::text, 'refinement'::text, 'attachments'::text, 'ready'::text, 'contacted'::text, 'submitted'::text, 'interview'::text, 'offer'::text, 'rejected'::text, 'withdrawn'::text]))),
    CONSTRAINT applications_status_history_array CHECK (((jsonb_typeof(status_history) = 'array'::text) AND (jsonb_array_length(status_history) > 0))),
    CONSTRAINT applications_workflow_stage_check CHECK ((workflow_stage = ANY (ARRAY['preparation'::text, 'refinement'::text, 'review'::text, 'tracking'::text])))
);

-- public.application_refinement_proposals
CREATE TABLE public.application_refinement_proposals (
    id uuid NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    proposal_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refinement_proposal_v2 CHECK ((NOT ((proposal_json -> 'schemaVersion'::text) IS DISTINCT FROM '2'::jsonb)))
);

-- public.application_refinement_protocols
CREATE TABLE public.application_refinement_protocols (
    request_id uuid NOT NULL,
    protocol_id text NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    protocol_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT application_refinement_protocols_protocol_id_check CHECK ((protocol_id ~ '^v1:[0-9a-f]{64}$'::text)),
    CONSTRAINT application_refinement_protocols_protocol_text_check CHECK (((char_length(protocol_text) >= 1) AND (char_length(protocol_text) <= 100000)))
);

-- public.application_refinement_requests
CREATE TABLE public.application_refinement_requests (
    id uuid NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_json jsonb NOT NULL,
    opportunity_snapshot jsonb NOT NULL,
    cv_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT application_refinement_requests_cleared_scopes_check CHECK (((((cleared_scopes = '{}'::text[]) OR (cleared_scopes = '{cv}'::text[])) OR (cleared_scopes = '{letter}'::text[])) OR (cleared_scopes = '{cv,letter}'::text[]))),
    CONSTRAINT refinement_request_v2 CHECK ((NOT ((request_json -> 'schemaVersion'::text) IS DISTINCT FROM '2'::jsonb)))
);

-- public.application_refinement_reviews
CREATE TABLE public.application_refinement_reviews (
    id uuid NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    request_id uuid,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT application_refinement_reviews_cleared_scopes_check CHECK (((((cleared_scopes = '{}'::text[]) OR (cleared_scopes = '{cv}'::text[])) OR (cleared_scopes = '{letter}'::text[])) OR (cleared_scopes = '{cv,letter}'::text[]))),
    CONSTRAINT application_refinement_reviews_kind_check CHECK ((kind = ANY (ARRAY['feedback'::text, 'approve_cv'::text, 'approve_letter'::text, 'reopen_cv'::text, 'reopen_letter'::text, 'cv_decisions'::text, 'annotation'::text])))
);

-- public.application_refinement_state
CREATE TABLE public.application_refinement_state (
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    setup_json jsonb NOT NULL,
    approvals_json jsonb DEFAULT '{"cv": null, "letter": null}'::jsonb NOT NULL,
    current_request_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_cv_request_id uuid,
    current_letter_request_id uuid,
    CONSTRAINT application_refinement_state_revision_check CHECK ((revision > 0))
);

-- public.cv_variants
CREATE TABLE public.cv_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    research_track text,
    is_base_variant boolean DEFAULT false NOT NULL,
    content_json jsonb NOT NULL,
    config_json jsonb NOT NULL,
    cv_version integer DEFAULT 7 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    parent_variant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cv_variants_contact_fields CHECK (COALESCE(((jsonb_typeof((content_json -> 'contact'::text)) = 'object'::text) AND (((content_json -> 'contact'::text) - ARRAY['name'::text, 'location'::text, 'role'::text, 'email'::text, 'phone'::text, 'website'::text, 'linkedin'::text, 'github'::text]) = '{}'::jsonb) AND (jsonb_typeof((content_json #> '{contact,name}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,location}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,role}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,email}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,phone}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,website}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,linkedin}'::text[])) = 'string'::text) AND (jsonb_typeof((content_json #> '{contact,github}'::text[])) = 'string'::text)), false)),
    CONSTRAINT cv_variants_cv_version_check CHECK ((cv_version > 0)),
    CONSTRAINT cv_variants_json_objects CHECK (((jsonb_typeof(content_json) = 'object'::text) AND (jsonb_typeof(config_json) = 'object'::text) AND (octet_length((content_json)::text) <= 5242880) AND (octet_length((config_json)::text) <= 5242880))),
    CONSTRAINT cv_variants_known_json_fields CHECK ((((content_json - ARRAY['contact'::text, 'about'::text, 'education'::text, 'experience'::text, 'languages'::text, 'hobbies'::text, 'customSections'::text, 'sidebarSections'::text, 'sectionNames'::text]) = '{}'::jsonb) AND ((config_json - ARRAY['lang'::text, 'design'::text, 'disabled'::text, 'completedSections'::text, 'keepTogetherSections'::text, 'anonymization'::text, 'sectionHeaderSizes'::text, 'bodyOrder'::text, 'sidebarOrder'::text, 'hiddenItems'::text]) = '{}'::jsonb))),
    CONSTRAINT cv_variants_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200))),
    CONSTRAINT cv_variants_revision_check CHECK ((revision > 0))
);

-- public.local_attachment_metadata
CREATE TABLE public.local_attachment_metadata (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    CONSTRAINT local_attachment_description_valid CHECK ((((public.refinement_utf16_length(description) >= 1) AND (public.refinement_utf16_length(description) <= 4000)) AND (description = btrim(description, (E' \t\n\r\013\f'::text || '               '::text))) AND (translate(description, E'\t\n\r'::text, ''::text) !~ '[[:cntrl:]]'::text))),
    CONSTRAINT local_attachment_name_valid CHECK ((((public.refinement_utf16_length(name) >= 1) AND (public.refinement_utf16_length(name) <= 200)) AND (name = btrim(name, (E' \t\n\r\013\f'::text || '               '::text))) AND (name !~ '[[:cntrl:]]'::text)))
);
