import { OPPORTUNITY_SCHEMA_VERSION, type OpportunityAssessment } from '../../src/features/opportunities/opportunityTypes';
import type { Opportunity } from '../../src/app/cloudTypes';
import { readOpportunity } from '../../src/features/opportunities/domain/readOpportunity';

export function opportunityAssessmentFixture(score: number | null, summary = 'Synthetic research assessment.'): OpportunityAssessment {
  return { score, scale_min: 0, scale_max: 10, summary: score === null ? null : summary };
}

/** Full synthetic canonical row; sparse overrides must still use current structured field shapes. */
export function opportunityFixture(overrides: Record<string, unknown> & { id: string }): Opportunity {
  const unrated = () => ({ score: null, scale_min: 0 as const, scale_max: 10 as const, summary: null });
  const { id, ...fields } = overrides;
  return readOpportunity({
    id, opportunity_key: id, record_type: 'opportunity', metadata_schema_version: OPPORTUNITY_SCHEMA_VERSION,
    title: id, vacancy_id: null, institution: null, unit: null, city: null, country: null,
    position_type: null, availability: null, deadline: null, deadline_time_local: null, deadline_timezone: null,
    deadline_original_text: null, start_date: null, official_url: null, source_url: null, application_url: null,
    verification_level: 'historical_context', source_context: null, duration_details: null, research_summary: null,
    topics: [], open_questions: [], contacts: [], supervisors: [],
    supervisor_research_focus: {}, supervisor_top_papers: [], supervisor_reputation: {}, salary: {},
    personal_fit: unrated(), research_career_potential: unrated(), rd_career_potential: unrated(), hardware_software_balance: {},
    requirements: [], required_documents: [], data: {}, last_checked_at: null, sources: [], created_at: null, updated_at: null,
    ...fields,
  });
}
