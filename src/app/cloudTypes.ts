import type { CvConfig, CvContent, CvState } from '../documents/cv/types';

export const TRACKING_STATUSES = ['ready', 'contacted', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export const APPLICATION_STATUSES = ['preparation', 'refinement', 'attachments', ...TRACKING_STATUSES] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
export const APPLICATION_STAGES = ['preparation', 'refinement', 'review', 'tracking'] as const;
export type ApplicationStage = typeof APPLICATION_STAGES[number];
export const OPPORTUNITY_REVIEW_STATES = ['unreviewed', 'not_interested', 'interested', 'strong_interest', 'very_high_interest'] as const;
export type OpportunityReviewState = typeof OPPORTUNITY_REVIEW_STATES[number];
export const OPPORTUNITY_INTEREST_REASON_CATEGORIES = ['topic', 'method', 'background_fit', 'project_context', 'hardware', 'location', 'funding', 'timing', 'requirements', 'availability', 'other'] as const;
export type OpportunityInterestReasonCategory = typeof OPPORTUNITY_INTEREST_REASON_CATEGORIES[number];
export const OPPORTUNITY_TECHNICAL_ISSUES = ['closed', 'requirements', 'application_problem', 'other'] as const;
export type OpportunityTechnicalIssue = typeof OPPORTUNITY_TECHNICAL_ISSUES[number];
export interface OpportunityDispositionPatch {
  manually_archived?: boolean;
  technical_issue_category?: OpportunityTechnicalIssue | null;
  technical_issue_note?: string | null;
}

export interface OpportunityInterestReason {
  category: OpportunityInterestReasonCategory;
  polarity: 'positive' | 'negative';
  /** An explicitly selected topic/method, never a target inferred from private prose. */
  target?: string;
}

/** Reference to a structured original prediction; its source must be independently verified. */
export interface OpportunityPredictionBaseline {
  user_id: string;
  opportunity_id: string;
  score: number;
  scale_min: 0;
  scale_max: 10;
  predicted_at: string;
  source_kind: 'historical_snapshot' | 'discovery_assessment';
  source_ref: string;
}

export interface OpportunityReview {
  user_id: string;
  opportunity_id: string;
  state: OpportunityReviewState;
  /** Complete owner evaluation; shared only as a safe derived excerpt unless this opportunity is excluded. */
  comment?: string | null;
  /** Server-maintained evaluation revision, independent of numeric interest. */
  evaluation_revision?: number;
  /** Legacy numeric override, retained for record compatibility; current feedback uses review/application state. */
  interest_rating?: number | null;
  interest_reasons?: OpportunityInterestReason[];
  feedback_excluded?: boolean;
  feedback_revision?: number;
  feedback_updated_at?: string | null;
  /** Owner-only list disposition; never a catalogue deadline or interest rating. */
  manually_archived?: boolean;
  technical_issue_category?: OpportunityTechnicalIssue | null;
  technical_issue_note?: string | null;
  /** Frozen for the explicit feedback revision, separate from the catalogue's AI fit. */
  prediction_baseline?: OpportunityPredictionBaseline | null;
  reviewed_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpportunityFeedbackPatch extends OpportunityDispositionPatch {
  interest_rating?: number | null;
  interest_reasons?: OpportunityInterestReason[];
  feedback_excluded?: boolean;
}

/** Current canonical catalogue contract, generated from the shared JSON Schema. */
export type { Opportunity } from '../features/opportunities/opportunityTypes';

export interface CloudCvVariant {
  id: string;
  user_id: string;
  name: string;
  cv_version: number;
  revision: number;
  created_at: string;
}

export interface CloudCvSnapshot {
  id: string;
  name: string;
  content_json: CvContent;
  config_json: CvConfig;
  cv_version: number;
  revision: number;
  is_base_variant: boolean;
}

export interface Application {
  id: string;
  /** Persistent server-assigned reference; older workspaces may not provide one yet. */
  application_code?: string | null;
  user_id: string;
  opportunity_id: string;
  cv_variant_id: string | null;
  contact_email: string | null;
  /** Captured opportunity research, stable until the user explicitly refreshes it. */
  context_json: Record<string, unknown>;
  context_captured_at: string;
  completed_checklist_keys: string[];
  status: ApplicationStatus;
  /** Last opened application tab; absent on databases that need the stage upgrade. */
  workflow_stage?: ApplicationStage;
  /** Sticky after the first explicit Tracking dropdown selection, including Ready. */
  tracking_started?: boolean;
  /** Server-recorded transitions; older installations may not have history yet. */
  status_history?: { status: ApplicationStatus; changedAt: string | null }[];
  notes: string | null;
  contacted_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationInput {
  opportunityId: string;
}

export interface ApplicationContext {
  application: Application;
  cv: CloudCvSnapshot | null;
}

export interface UpdateApplicationInput {
  status?: ApplicationStatus;
  notes?: string | null;
  contactEmail?: string | null;
  contactedAt?: string | null;
  submittedAt?: string | null;
  /** Assign a new immutable privacy snapshot; never update the previous CV. */
  cvState?: CvState;
}
