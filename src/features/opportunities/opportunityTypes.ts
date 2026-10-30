// Generated from supabase/opportunity_schema_v6.json by scripts/generateOpportunityTypes.mjs.
// Edit the schema and regenerate; catalogue consumers use these structured values directly.

export const OPPORTUNITY_SCHEMA_VERSION = 6 as const;

export type OpportunityFact = {
  "label": string;
  "text": string;
  "source_urls"?: Array<string>;
};

export type OpportunityVerification = {
  "identity_verified"?: boolean | null;
  "role_verified"?: boolean | null;
  "supervision_confirmed"?: boolean | null;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityPerson = {
  "entity_id": string;
  "name"?: string | null;
  "email"?: string | null;
  "orcid"?: string | null;
  "phone"?: string | null;
  "institution"?: string | null;
  "roles": Array<string>;
  "verification"?: OpportunityVerification;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityChecklist = {
  "entity_id": string;
  "text": string;
  "status": "required" | "optional" | "conditional" | "preferred" | "recommended" | "desired" | "advantageous" | "unspecified";
  "stage": "unspecified" | "recruitment" | "doctoral_admission" | "after_selection" | "interview" | "offer" | "enrolment" | "other";
  "conditions"?: Array<string>;
  "max_pages"?: number | null;
  "max_words"?: number | null;
  "file_formats"?: Array<string>;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityPaper = {
  "entity_id": string;
  "title"?: string | null;
  "doi"?: string | null;
  "url"?: string | null;
  "year"?: number | null;
  "venue"?: string | null;
  "authors"?: Array<string>;
  "supervisors"?: Array<string>;
  "selection_basis"?: string | null;
  "relevance"?: string | null;
  "checked_at"?: string | null;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityFocusProfile = {
  "entity_id": string;
  "name": string;
  "researcher_id"?: string | null;
  "summary"?: string | null;
  "topics"?: Array<string>;
  "methods"?: Array<string>;
  "checked_at"?: string | null;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityFocus = {
  "profiles"?: Array<OpportunityFocusProfile>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityMoneyComponent = {
  "entity_id": string;
  "label": string;
  "amount"?: number | null;
  "min"?: number | null;
  "max"?: number | null;
  "currency"?: string | null;
  "period"?: "hour" | "day" | "week" | "month" | "year" | "contract" | null;
  "gross"?: boolean | null;
  "model"?: string | null;
  "condition"?: string | null;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunitySalary = {
  "amount"?: number | null;
  "min"?: number | null;
  "max"?: number | null;
  "currency"?: string | null;
  "period"?: "hour" | "day" | "week" | "month" | "year" | "contract" | null;
  "gross"?: boolean | null;
  "model"?: string | null;
  "details"?: string | null;
  "components"?: Array<OpportunityMoneyComponent>;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityAssessment = {
  "score": number | null;
  "scale_min": 0;
  "scale_max": 10;
  "summary": string | null;
  "subscores"?: Record<string, number>;
  "gaps"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityBackground = {
  "summary"?: string | null;
  "evidence"?: Array<string>;
  "limitations"?: Array<string>;
  "source_urls"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityBalance = {
  "classification"?: string | null;
  "summary"?: string | null;
  "details"?: string | null;
  "hardware"?: Array<string>;
  "software"?: Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunitySource = {
  "source_id": string;
  "url": string;
  "kind": "official" | "official_listing" | "institution" | "graduate_school" | "discovery" | "unknown";
  "checked_at": string | null;
  "precision": "instant" | "date" | "unknown";
  "supports": Array<string>;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityLivingStandard = {
  "version": 1;
  "housing_baseline": "shared_flat" | "private_apartment";
  "assessed_at": string;
  "confidence": "low" | "medium" | "high";
  "summary": string;
  "salary_basis": string;
  "budget_basis": string;
  "funding_note"?: string;
  "factors": {
    "affordability": {
      "score": number | null;
      "reason": string;
    };
    "housing": {
      "score": number | null;
      "reason": string;
    };
    "culture": {
      "score": number | null;
      "reason": string;
    };
    "nature": {
      "score": number | null;
      "reason": string;
    };
    "student_life": {
      "score": number | null;
      "reason": string;
    };
    "climate": {
      "score": number | null;
      "reason": string;
    };
  };
  "sources": Array<{
    "title": string;
    "url": string;
  }>;
};

export type OpportunityTeaching = {
  "status": "specified" | "not_specified" | "unknown";
  "details"?: string | null;
  "notes"?: Array<OpportunityFact>;
};

export type OpportunityData = {
  "research_methods"?: Array<string>;
  "teaching_load"?: OpportunityTeaching;
  "living_standard"?: OpportunityLivingStandard;
  "url_roles"?: {
    "official_url"?: "vacancy" | "listing" | "application_portal" | "context" | "unknown";
    "source_url"?: "vacancy" | "listing" | "application_portal" | "context" | "unknown";
    "application_url"?: "vacancy" | "listing" | "application_portal" | "context" | "unknown";
  };
  "research_context"?: Array<OpportunityFact>;
  "application_process"?: Array<OpportunityFact>;
  "funding"?: Array<OpportunityFact>;
  "start_details"?: Array<OpportunityFact>;
  "provenance"?: Array<OpportunityFact>;
  "notes"?: Array<OpportunityFact>;
};

export type Opportunity = {
  "vacancy_id": string | null;
  "institution": string | null;
  "unit": string | null;
  "city": string | null;
  "country": string | null;
  "position_type": string | null;
  "availability": string | null;
  "deadline_original_text": string | null;
  "research_summary": string | null;
  "duration_details": string | null;
  "source_context": string | null;
  "opportunity_key": string;
  "title": string;
  "verification_level": string;
  "official_url": string | null;
  "source_url": string | null;
  "application_url": string | null;
  "deadline": string | null;
  "start_date": string | null;
  "deadline_time_local": string | null;
  "deadline_timezone": string | null;
  "topics": Array<string>;
  "open_questions": Array<string>;
  "supervisors": Array<OpportunityPerson>;
  "contacts": Array<OpportunityPerson>;
  "requirements": Array<OpportunityChecklist>;
  "required_documents": Array<OpportunityChecklist>;
  "supervisor_research_focus": OpportunityFocus;
  "supervisor_top_papers": Array<OpportunityPaper>;
  "salary": OpportunitySalary;
  "supervisor_reputation": OpportunityBackground;
  "hardware_software_balance": OpportunityBalance;
  "personal_fit": OpportunityAssessment;
  "rd_career_potential": OpportunityAssessment;
  "research_career_potential": OpportunityAssessment;
  "data": OpportunityData;
  "last_checked_at": string | null;
  "sources": Array<OpportunitySource>;
} & {
  id: string;
  record_type: 'opportunity';
  metadata_schema_version: typeof OPPORTUNITY_SCHEMA_VERSION;
  created_at: string | null;
  updated_at: string | null;
};
