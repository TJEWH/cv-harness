export interface LetterContent {
  subject: string;
  salutation: string;
  body: string;
  closing: string;
}

/** Local rendering settings for a template or application; never writing instructions. */
export interface LetterFormatting {
  marginMm: number;
  fontSizePt: number;
  lineHeight: number;
  /** Older backups use the original 16 pt header name. */
  headerNameSizePt?: number;
}

export interface LetterTemplateGuidance {
  /** Optional so libraries exported before template guidance remain readable. */
  subjectInstructions?: string;
  salutationInstructions?: string;
  closingInstructions?: string;
  /** Applicant-defined interests, not evidence of qualifications or past experience. */
  researchInterests?: string;
  /** Local source preference; omitted from the published refinement contract. */
  useMetaSearchInterests?: boolean;
  /** When and why to ask the applicant for useful context during drafting or refinement. */
  questionGuidance?: string;
  /** Instructions for evaluating resolved answers and handling letter refinement iterations. */
  refinementSystemPrompt?: string;
}

export interface LetterTemplate extends LetterTemplateGuidance {
  id: string;
  name: string;
  revision: number;
  structure: string;
  tone: string;
  /** Optional reference wording/style, never evidence of the applicant's experience. */
  exampleText?: string;
  /** Base rendering settings, frozen with the template when selected for an application. */
  formatting?: LetterFormatting;
  language: string;
  maxWords: number;
  updatedAt: string;
}

/** Content and design are tracked independently: a design change only needs layout review. */
export interface LetterContextVersion { content: string; theme: string }
/** Explicitly selected local source context; kept stable when its search template changes. */
export interface LetterSearchProfile {
  templateId: string;
  templateName: string;
  profileId?: string;
  profileName?: string;
  revision: number;
  capturedAt: string;
  professionalContext: string;
  researchInterests: string;
}
export interface LetterRevision {
  id: string;
  kind: 'generated' | 'edited' | 'final';
  content: LetterContent;
  context: LetterContextVersion;
  cloudDraftId?: string;
  cloudContextId?: string;
  createdAt: string;
}

export interface ApplicationLetter {
  version: 1;
  applicationId: string;
  userId: string;
  templateId: string;
  /** Captured on selection; untouched applications can refresh it on open. */
  templateSnapshot?: LetterTemplate;
  /** Private reusable context, included in the privacy preview before publication. */
  searchProfile?: LetterSearchProfile;
  instructions: string;
  language: string;
  maxWords: number;
  working: LetterContent;
  /** Absent in older backups: render with the general PhD letter defaults. */
  formatting?: LetterFormatting;
  workingContext: LetterContextVersion;
  publishedContexts: Record<string, LetterContextVersion>;
  finalRevisionId: string | null;
  revisions: LetterRevision[];
  updatedAt: string;
}
