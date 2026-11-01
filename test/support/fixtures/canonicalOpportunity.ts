import { opportunityFixture } from './opportunity';

/** Synthetic canonical research. No production records or applicant data. */
export const canonicalChecklistStatuses = ['required', 'optional', 'conditional', 'preferred', 'recommended', 'desired', 'advantageous', 'unspecified'] as const;

export function canonicalOpportunityFixture() {
  const checklist = (field: string) => canonicalChecklistStatuses.map((status, index) => ({
    entity_id: `INTERNAL-${field}-${index}`, text: `${field === 'requirement' ? 'Qualification' : 'Document'} ${status}`,
    status, stage: index % 2 ? 'doctoral_admission' as const : 'recruitment' as const,
    conditions: status === 'conditional' ? ['Only if the graduate school requests it'] : [],
    source_urls: ['https://example.invalid/canonical/job'],
    ...(field === 'document' && status === 'required' ? { max_words: 400 } : {}),
  }));
  return opportunityFixture({
    id: '10000000-0000-4000-8000-000000000099', opportunity_key: 'INTERNAL-catalogue-key',
    title: 'Canonical Acoustic Robotics PhD', institution: 'Synthetic Research Institute', country: 'Sweden', city: 'Synthetic City',
    vacancy_id: 'PUBLIC-VACANCY-2027', deadline: '2027-01-15', deadline_time_local: null, deadline_timezone: 'Europe/Stockholm',
    deadline_original_text: 'Applications close 15 January 2027.', availability: 'open', position_type: 'Funded PhD',
    official_url: 'https://example.invalid/canonical/job', application_url: 'https://example.invalid/canonical/apply', source_url: 'https://example.invalid/canonical/job',
    research_summary: 'Build acoustic sensing prototypes for human–robot interaction and evaluate them with real hardware.',
    topics: ['Acoustics', 'Robotics'],
    contacts: [{ entity_id: 'INTERNAL-contact', name: 'Dr. Alex Example', email: 'alex@example.invalid', roles: ['Scientific contact', 'Programme contact'],
      institution: 'Synthetic Research Institute', verification: { identity_verified: true, role_verified: true, supervision_confirmed: false },
      source_urls: ['https://example.invalid/canonical/team'], notes: [{ label: 'Contact hours', text: 'Office hours by appointment' }] }],
    supervisors: [{ entity_id: 'INTERNAL-supervisor', name: 'Prof. Morgan Example', email: 'morgan@example.invalid', roles: ['Supervisor'],
      orcid: '0000-0002-1825-0097', source_urls: ['https://example.invalid/canonical/lab'] }],
    supervisor_research_focus: { profiles: [{ entity_id: 'INTERNAL-focus', researcher_id: 'INTERNAL-supervisor', name: 'Prof. Morgan Example',
      summary: 'Acoustic sensing and robot audition.', topics: ['Robot audition'], methods: ['Physical experiments'] }] },
    supervisor_top_papers: [{ entity_id: 'INTERNAL-paper', title: 'Synthetic Acoustic Robot Study', year: 2026, doi: '10.1234/example', relevance: 'Connects acoustic sensing with robot evaluation.' }],
    salary: { min: 3000, max: 3500, currency: 'EUR', period: 'month', gross: true, details: 'Fully funded doctoral contract.',
      components: [{ entity_id: 'INTERNAL-salary-component', label: 'Research allowance', amount: 1000, currency: 'EUR', period: 'year' }] },
    personal_fit: { score: 8.7, scale_min: 0, scale_max: 10, summary: 'Matches technical research interests.', gaps: ['Confirm graduate admission eligibility'] },
    requirements: checklist('requirement'), required_documents: checklist('document'),
    data: { research_methods: ['Signal processing', 'Hardware prototyping'],
      research_context: [{ label: 'Research setting', text: 'An interdisciplinary acoustic robotics laboratory.' }],
      application_process: [{ label: 'Portal submission', text: 'Use the graduate-school application portal.' }],
      funding: [{ label: 'Funding', text: 'Salary is confirmed for the doctoral contract.' }] },
    sources: [{ source_id: 'INTERNAL-source', url: 'https://example.invalid/canonical/job', kind: 'official', checked_at: '2026-10-28T09:00:00Z', precision: 'instant',
      supports: ['title', 'requirements', 'required_documents', 'salary', 'contacts', 'supervisors'], notes: [
        { label: 'Source', text: 'Synthetic official vacancy notice' },
        { label: 'Source ID', text: 'INTERNAL-preserved-source-note' },
        { label: 'Vacancy ID', text: 'PUBLIC-VACANCY-2027' },
      ] }],
    last_checked_at: '2026-10-28T09:00:00Z', created_at: '2026-10-27T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
  });
}
