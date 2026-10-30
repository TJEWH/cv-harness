export interface SearchTemplateCloudBinding {
  id: string;
  revision: number;
  /** Exact committed content acknowledged by Supabase. */
  contentKey: string;
}

export interface SearchTemplate {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  /** Compatibility metadata: newly saved meta searches are always active. */
  active: boolean;
  opportunityDescription: string;
  researchInterests: string;
  fundingConditions: string;
  locationPreferences: string;
  userPrompt: string;
  dailyTime: string;
  timezone: string;
  cloud?: SearchTemplateCloudBinding;
  /** Recovery-only retired configuration; excluded from search prompts and letter context. */
  legacySearchArchive?: string;
}

export const SEARCH_CRITERIA_KEYS = ['opportunityTypes', 'topicsAndMethods', 'locationsAndLanguages', 'fundingAndConditions', 'fitAndExclusions', 'sourcesAndQueries', 'researchAndReporting'] as const;
export type SearchCriteria = Record<typeof SEARCH_CRITERIA_KEYS[number], string>;
export interface SearchCloudSchedule {
  frequency: 'hourly' | 'daily' | 'weekly';
  intervalHours: number;
  weekdays: number[];
  time: string;
  timezone: string;
  runImmediately: boolean;
}
export interface SearchCloudTemplate {
  id: string;
  user_id: string;
  name: string;
  revision: number;
  criteria: SearchCriteria;
  schedule: SearchCloudSchedule;
  created_at: string;
  updated_at: string;
  meta_search?: SearchMetaSearchDocument | null;
}

export interface SearchMetaSearchDocument {
  version: 1;
  active: boolean;
  editor: SearchTemplate;
  systemPrompt: string;
  userPrompt: string;
  recurringPrompt: string;
}
