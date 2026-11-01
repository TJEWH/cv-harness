/** Development-only visual fixture; never imported by the production app. No network or auth. */
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpportunityInterestReason, OpportunityReview, OpportunityReviewState } from '../../../src/app/cloudTypes';
import type { CvState, SavedConfiguration } from '../../../src/documents/cv/types';
import { library } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowDown, faArrowLeft, faArrowRight, faArrowsLeftRightToLine, faBriefcase, faCheck,
  faChevronLeft, faChevronRight, faCode, faDownload, faEnvelope, faEye, faEyeSlash,
  faFilePdf, faFolderOpen, faFont, faGlobe, faGraduationCap, faGripVertical, faHeart,
  faInfoCircle, faLanguage, faLayerGroup, faLink, faLinkSlash, faLocationDot, faLock,
  faLockOpen, faPalette, faPhone, faPlus, faSpinner, faSliders, faTableCellsLarge,
  faTableColumns, faTag, faTrash, faUserSecret, faWindowMaximize, faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import CloudWorkspace from '../../../src/app/components/CloudWorkspace.vue';
import AppToaster from '../../../src/shared/ui/AppToaster.vue';
import DesktopSidebar from '../../../src/shared/ui/DesktopSidebar.vue';
import { provideDesktopSidebar } from '../../../src/shared/ui/desktopSidebar';
import { createSampleDocument } from '../../../src/features/cv-studio/domain/builtinConfigurations';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../../../src/documents/letter/motivationLetters';
import { createRefinementFixture, REFINEMENT_TABLES } from '../../support/fixtures/refinement';
import { livingStandardFixture } from '../../support/fixtures/livingStandard';
import { canonicalOpportunityFixture } from '../../support/fixtures/canonicalOpportunity';
import { opportunityFixture } from '../../support/fixtures/opportunity';
import { createSearchTemplate, searchTemplateContentKey } from '../../../src/features/meta-search/data/searchTemplateRepository';
import { searchTemplateCloudCriteria, searchTemplateCloudSchedule } from '../../../src/features/meta-search/data/searchTemplateCloud';
import { deriveOpportunityFeedback } from '../../../src/features/opportunities/domain/opportunityFeedback';
import type { AdaptiveSearchDashboardData } from '../../../src/features/meta-search/composables/adaptiveSearchDashboard';
import dashboardFixture from '../fixtures/adaptive-dashboard.fixture.json';
import '../../../src/assets/cv.css';

if (!import.meta.env.DEV) throw new Error('The browser fixture is available only on the development server.');

type Row = Record<string, unknown>;
const account = '90000000-0000-4000-8000-000000000001';
const fixtureFlow = new URLSearchParams(location.search).get('flow');
if (fixtureFlow === 'insights' && new URLSearchParams(location.search).get('webgl') === 'disabled') {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
    return contextId.startsWith('webgl') ? null : Reflect.apply(originalGetContext, this, [contextId, ...args]);
  } as typeof originalGetContext;
}
if (['job-navigation', 'application-groups', 'canonical-data', 'manual-past', 'insights', 'interest'].includes(fixtureFlow || '')) {
  for (const key of ['CV_SELECTED_OPPORTUNITY', 'CV_SELECTED_APPLICATION']) sessionStorage.removeItem(`${key}:${account}`);
}
const now = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const database: Record<string, Row[]> = {
  opportunities: [
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000001', opportunity_key: 'robotics-phd',
      title: 'PhD in Human-Centred Robotics', institution: 'Northbridge Technical University', country: 'Netherlands',
      deadline: '2026-10-30', deadline_time_local: '23:59:00', deadline_timezone: 'UTC', topics: ['Robotics', 'Human–robot interaction', 'Machine learning'],
      contacts: [{ entity_id: 'robotics-contact', name: 'Prof. Alex Example', email: 'robotics@example.org', roles: ['Scientific contact'] }],
      salary: { min: 3100, max: 3900, currency: 'EUR', period: 'month' }, supervisors: [{ entity_id: 'robotics-advisor', name: 'Prof. Alex Example', roles: ['Supervisor'] }],
      duration_details: 'Four-year funded doctoral contract.',
      research_summary: 'Study how robots can learn safe collaboration from human demonstrations, combining learning algorithms with physical experiments.\n\nUnique selling points\n- Combines robot learning with practical experiments.',
      personal_fit: { scale_min: 0, scale_max: 10, score: 8.8, summary: 'Strong alignment with robotics experience', gaps: ['Develop experimental design skills'] },
      research_career_potential: { scale_min: 0, scale_max: 10, score: 9, summary: 'Publish research in human–robot interaction' },
      rd_career_potential: { scale_min: 0, scale_max: 10, score: 8, summary: 'Transfer safe learning methods to industrial R&D' },
      hardware_software_balance: { summary: 'Software development with hands-on robot experiments.' },
      supervisor_research_focus: { profiles: [{ entity_id: 'robotics-focus', name: 'Prof. Alex Example', summary: 'Learning safe human–robot collaboration from demonstrations.', topics: ['Robot learning', 'Safety'], source_urls: ['https://example.org/lab'] }] },
      supervisor_top_papers: [{ title: 'Example paper on learning from human feedback', year: 2025, entity_id: 'robotics-paper', relevance: 'Connects interactive learning with safe robotics.', url: 'https://example.org/paper' }],
      requirements: [
        { entity_id: 'robotics-degree', text: 'MSc in robotics or computer science', status: 'required', stage: 'recruitment' },
        { entity_id: 'robotics-background', text: 'Background in wireless communications, robotics, optimization and ML/AI', status: 'advantageous', stage: 'recruitment' },
      ],
      required_documents: [{ entity_id: 'robotics-cv', text: 'CV', status: 'required', stage: 'recruitment' }, { entity_id: 'robotics-letter', text: 'Motivation letter (maximum 400 words)', max_words: 400, status: 'required', stage: 'recruitment' }, { entity_id: 'robotics-transcript', text: 'Transcript of records', status: 'required', stage: 'recruitment' }, { entity_id: 'robotics-portfolio', text: 'Portfolio', status: 'advantageous', stage: 'recruitment' }],
      official_url: 'https://example.org/opportunities/robotics', verification_level: 'official listing',
      source_url: 'https://example.org/opportunities/robotics', source_context: 'Robotics',
      sources: [
        { source_id: 'robotics-listing', url: 'https://example.org/opportunities/robotics', kind: 'official', supports: ['salary', 'duration_details'], checked_at: '2026-09-20', precision: 'date' },
        { source_id: 'robotics-requirements', url: 'https://example.org/opportunities/robotics', kind: 'official', supports: ['requirements'], checked_at: null, precision: 'unknown' },
      ],
      data: { funding: [{ label: 'Funding', text: 'Fully funded' }], notes: [{ label: 'Work pattern', text: 'Hybrid' }], living_standard: { ...livingStandardFixture, housing_baseline: livingStandardFixture.housing_baseline || 'shared_flat' } }, created_at: recent, updated_at: recent }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000002', opportunity_key: 'research-engineer',
      title: 'Research Engineer — Embedded AI Systems', institution: 'Institute for Responsible Computing', country: 'Germany',
      deadline: '2026-11-15', deadline_time_local: '17:00:00', deadline_timezone: 'UTC', topics: ['Embedded systems', 'Efficient AI'],
      contacts: [{ entity_id: 'embedded-contact', name: 'Dr. Robin Example', email: 'careers@example.org', roles: ['Contact'] }],
      personal_fit: { scale_min: 0, scale_max: 10, score: 9.6, summary: 'Strong embedded systems fit' },
      salary: { model: 'TV-L E13' }, duration_details: 'Three-year contract', requirements: [{ entity_id: 'embedded-experience', text: 'Embedded software experience', status: 'required', stage: 'recruitment' }],
      data: { living_standard: { ...livingStandardFixture, housing_baseline: livingStandardFixture.housing_baseline || 'shared_flat', factors: { ...livingStandardFixture.factors, affordability: { score: 9, reason: 'Synthetic example: a larger buffer after essentials.' } } } },
      required_documents: [{ entity_id: 'embedded-cv', text: 'CV', status: 'required', stage: 'recruitment' }, { entity_id: 'embedded-portfolio', text: 'Portfolio', status: 'required', stage: 'recruitment' }], official_url: 'https://example.org/opportunities/embedded-ai',
      availability: 'open', created_at: now, updated_at: recent }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000003', opportunity_key: 'past-opportunity', title: 'Archived research position', institution: 'Example Institute', deadline: '2025-01-01', topics: ['Materials discovery'], contacts: [], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 6.4 }, source_context: 'Materials discovery', created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000004', opportunity_key: 'open-deadline', title: 'Rolling research fellowship', institution: 'Example Institute', deadline: null, topics: ['Research'], contacts: [], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 10 }, created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000005', opportunity_key: 'recent-learning', title: 'Learning Systems PhD', institution: 'Synthetic Science University', country: 'Sweden', deadline: null, topics: ['Learning'], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 9.1 }, created_at: recent, updated_at: recent }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000006', opportunity_key: 'older-unseen', title: 'Applied Robotics Fellowship', institution: 'Example Institute', country: 'Denmark', deadline: null, topics: ['Robotics'], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 9.5 }, created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000007', opportunity_key: 'older-update', title: 'Control Systems Researcher', institution: 'Synthetic Science University', country: 'Finland', deadline: null, topics: ['Control'], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 9.4 }, created_at: '2025-01-01T12:00:00Z', updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000008', opportunity_key: 'already-viewed', title: 'Reviewed AI Fellowship', institution: 'Synthetic Science University', country: 'Germany', deadline: null, topics: ['AI'], personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic research assessment.', score: 9.05 }, created_at: now, updated_at: recent }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000009', opportunity_key: 'unknown-fit', title: 'Research Assistant — Fit not scored', institution: 'Example Institute', country: 'France', deadline: null, topics: ['Research'],
      research_summary: Array.from({ length: 8 }, () => 'This synthetic project combines experimental research, collaborative analysis and the development of reproducible methods.').join('\n\n'),
      created_at: now, updated_at: now }),
  ],
  applications: [],
  cv_variants: [],
  local_attachment_metadata: [],
  opportunity_search_templates: [],
  opportunity_reviews: [
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000003', state: 'strong_interest', reviewed_updated_at: now, created_at: now, updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000002', state: 'unreviewed', reviewed_updated_at: now, created_at: now, updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000007', state: 'unreviewed', reviewed_updated_at: '2025-01-01T12:00:00Z', created_at: '2025-01-01T12:00:00Z', updated_at: now },
    { user_id: account, opportunity_id: '10000000-0000-4000-8000-000000000008', state: 'interested', reviewed_updated_at: recent, created_at: now, updated_at: recent },
  ],
};
let insightsDashboard: AdaptiveSearchDashboardData | null = null;
if (fixtureFlow === 'insights') {
  // Distinct current/previous feedback windows support descriptive alignment comparisons.
  database.opportunities.push(
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000010', opportunity_key: 'insights-embodied-interaction', title: 'Embodied Interaction PhD',
      institution: 'Northbridge Technical University', country: 'Netherlands', topics: ['Human–robot interaction', 'Prototyping'],
      personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic current catalogue assessment.', score: 7.2 }, created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000011', opportunity_key: 'insights-computational-materials', title: 'Computational Materials Fellowship',
      institution: 'Example Institute', country: 'France', topics: ['Materials simulation'],
      personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic current catalogue assessment.', score: 8.5 }, created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000012', opportunity_key: 'insights-acoustic-measurement', title: 'Acoustic Measurement Researcher',
      institution: 'Research University', country: 'Denmark', topics: ['Acoustics', 'Experiments'],
      personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic current catalogue assessment.', score: 6.8 }, created_at: now, updated_at: now }),
    opportunityFixture({ id: '10000000-0000-4000-8000-000000000013', opportunity_key: 'insights-robot-sensing', title: 'Human–Robot Sensing Fellowship',
      institution: 'Northbridge Technical University', country: 'Sweden', topics: ['Robotics', 'Sensing'],
      personal_fit: { scale_min: 0, scale_max: 10, summary: 'Synthetic current catalogue assessment.', score: 9.1 }, created_at: now, updated_at: now }),
  );
  const evaluations: { state: OpportunityReviewState; rating: number | null; reasons: OpportunityInterestReason[]; comment: string | null; excluded?: boolean }[] = [
    { state: 'strong_interest', rating: 9.2, reasons: [{ category: 'topic', polarity: 'positive', target: 'Robotics' }, { category: 'method', polarity: 'positive', target: 'Physical experiments' }], comment: 'Strong interest in hands-on robot learning and experiments with people.' },
    { state: 'strong_interest', rating: 8.6, reasons: [{ category: 'hardware', polarity: 'positive' }, { category: 'funding', polarity: 'positive' }], comment: 'Embedded prototypes and a funded contract make this a useful applied research direction.' },
    { state: 'not_interested', rating: 3.1, reasons: [{ category: 'topic', polarity: 'negative', target: 'Materials discovery' }], comment: 'The advertised research tasks have little connection to my preferred sensing and robotics work.' },
    { state: 'interested', rating: 7, reasons: [{ category: 'funding', polarity: 'positive' }], comment: 'Promising fellowship, but I need clearer evidence of the daily research tasks.', excluded: true },
    { state: 'strong_interest', rating: 9.4, reasons: [{ category: 'topic', polarity: 'positive', target: 'Learning systems' }, { category: 'method', polarity: 'positive', target: 'Prototyping' }], comment: 'The combination of learning methods and physical prototypes is especially appealing.' },
    { state: 'interested', rating: 7.6, reasons: [{ category: 'topic', polarity: 'positive', target: 'Robotics' }], comment: 'Interesting robotics research; verify funding and the amount of experimental work.' },
    { state: 'not_interested', rating: 2.8, reasons: [{ category: 'hardware', polarity: 'negative' }, { category: 'method', polarity: 'negative', target: 'Simulation-only work' }], comment: 'The role appears dominated by simulation, with little opportunity to build or test hardware.' },
    { state: 'interested', rating: null, reasons: [{ category: 'topic', polarity: 'positive', target: 'Learning systems' }], comment: 'A relevant topic, although the application requirements need closer inspection.' },
    { state: 'unreviewed', rating: null, reasons: [], comment: null },
    { state: 'strong_interest', rating: 8.4, reasons: [{ category: 'method', polarity: 'positive', target: 'Physical experiments' }], comment: 'Human interaction experiments and tangible prototypes match the work I want to pursue.' },
    { state: 'not_interested', rating: 2.5, reasons: [{ category: 'topic', polarity: 'negative', target: 'Materials simulation' }], comment: 'The computational materials focus does not match my preferred sensing and physical interaction tasks.' },
    { state: 'interested', rating: 7.8, reasons: [{ category: 'topic', polarity: 'positive', target: 'Acoustics' }], comment: 'Acoustic measurement and reproducible experiments are relevant; check the balance of field and desk work.' },
    { state: 'strong_interest', rating: 8.3, reasons: [{ category: 'topic', polarity: 'positive', target: 'Robotics' }], comment: 'The sensing fellowship combines robot experiments with the practical research methods I prefer.' },
  ];
  const feedbackAges = [2, 5, 44, 50, 8, 38, 12, 47, 1, 18, 35, 42, 55];
  database.opportunities.forEach((opportunity, index) => {
    opportunity.created_at = new Date(Date.now() - feedbackAges[index]! * 24 * 60 * 60 * 1000).toISOString();
  });
  database.opportunities[6]!.topics = ['Control', 'Robotics', 'Human–robot interaction', 'Simulation'];
  evaluations[6]!.reasons = [...evaluations[6]!.reasons, { category: 'topic', polarity: 'negative', target: 'Simulation' }];
  database.opportunity_reviews = database.opportunities.map((opportunity, index) => {
    const example = evaluations[index]!;
    const feedbackTime = new Date(Date.now() - feedbackAges[index]! * 24 * 60 * 60 * 1000).toISOString();
    return { user_id: account, opportunity_id: opportunity.id, state: example.state, interest_rating: example.rating,
      interest_reasons: example.reasons, feedback_excluded: example.excluded ?? false, feedback_revision: 1,
      // One legacy rating has no meaningful timestamp, despite ordinary row timestamps.
      feedback_updated_at: example.comment && index !== 7 ? feedbackTime : null, evaluation_revision: example.comment ? 1 : 0,
      comment: example.comment, reviewed_updated_at: opportunity.updated_at, created_at: feedbackTime, updated_at: feedbackTime };
  });
  const topicBundles = [
    ['Robotics', 'Human–robot interaction', 'Prototyping'], ['Sensing', 'Acoustics', 'Experiments'],
    ['Machine learning', 'Embedded systems', 'Efficient AI'], ['Control', 'Robotics', 'Simulation'],
    ['Acoustics', 'Human–robot interaction', 'Physical computing'], ['Embedded systems', 'Sensing', 'Robotics'],
  ];
  for (let index = 0; index < 24; index++) {
    const topics = topicBundles[index % topicBundles.length]!;
    const mismatch = index % 6 === 3, high = !mismatch && index % 6 !== 1 && index % 6 !== 4;
    const added = new Date(Date.now() - (index * 3 + 3) * 86_400_000).toISOString();
    const opportunity = opportunityFixture({ id: `10000000-0000-4000-8000-${String(index + 14).padStart(12, '0')}`,
      opportunity_key: `insights-history-${index}`, title: `Synthetic ${topics[0]} research ${index + 1}`,
      institution: index % 2 ? 'Northbridge Technical University' : 'Research University', country: ['Netherlands', 'Germany', 'Denmark'][index % 3],
      topics: [...topics], personal_fit: { scale_min: 0, scale_max: 10, score: mismatch ? 9.3 : index % 7 === 0 ? 7.1 : 8.3 + index % 4 * .2, summary: 'Synthetic current catalogue fit.' },
      created_at: added, updated_at: recent });
    database.opportunities.push(opportunity);
    database.opportunity_reviews.push({ user_id: account, opportunity_id: opportunity.id,
      state: mismatch ? 'not_interested' : high ? 'strong_interest' : 'interested', interest_rating: mismatch ? 2.5 : high ? 8.5 + index % 3 * .3 : 6.4,
      interest_reasons: mismatch ? [{ category: 'topic', polarity: 'negative', target: 'Simulation' }, { category: 'method', polarity: 'negative', target: 'Simulation-only work' }]
        : [{ category: 'topic', polarity: 'positive', target: topics[0] }],
      feedback_revision: 1, feedback_updated_at: now, evaluation_revision: 1,
      comment: mismatch ? 'A familiar robotics topic appears alongside simulation-only tasks that I want to avoid.' : 'Synthetic evidence of interest in the advertised research topic bundle.',
      reviewed_updated_at: recent, created_at: added, updated_at: now });
  }
  const acousticExamples = [
    { title: 'Acoustic Array Sensing Fellowship', topics: ['ACOUSTIC_SENSING', 'acoustic sensing', 'Acoustics', 'Array signal processing'], rating: 9.1, fit: 8.9, age: 7, avoidedTopic: null },
    { title: 'Robot Audition Researcher', topics: ['Robot_Audition', 'AUDIO_SENSING', 'Embedded_AI', 'Acoustic perception'], rating: 8.7, fit: 8.6, age: 20, avoidedTopic: null },
    { title: 'Acoustic Measurement PhD', topics: ['Acoustic_measurement', 'ACOUSTIC sensing', 'Signal processing'], rating: 8.5, fit: 8.4, age: 27, avoidedTopic: null },
    { title: 'Computational Acoustics Fellowship', topics: ['Computational_acoustics', 'ACOUSTICS', 'Simulation'], rating: 2.1, fit: 8.8, age: 35, avoidedTopic: 'COMPUTATIONAL_ACOUSTICS' },
    { title: 'Ultrasound Simulation Researcher', topics: ['Ultrasound', 'Acoustic_simulation', 'Simulation'], rating: 3, fit: 8.7, age: 50, avoidedTopic: 'Acoustic_simulation' },
    { title: 'Bioacoustics Field Recording Fellowship', topics: ['BIOACOUSTICS', 'Field_recording', 'Acoustic monitoring'], rating: 3.7, fit: 7.4, age: 65, avoidedTopic: null },
  ];
  acousticExamples.forEach((example, index) => {
    const added = new Date(Date.now() - example.age * 86_400_000).toISOString();
    const opportunity = opportunityFixture({ id: `10000000-0000-4000-8000-${String(index + 38).padStart(12, '0')}`,
      opportunity_key: `insights-acoustic-${index}`, title: example.title,
      institution: index % 2 ? 'Northbridge Technical University' : 'Research University', country: index % 2 ? 'Netherlands' : 'Denmark',
      topics: example.topics, personal_fit: { scale_min: 0, scale_max: 10, score: example.fit, summary: 'Synthetic current catalogue fit.' },
      created_at: added, updated_at: recent });
    // Keep legacy variants in the mock database so the real catalogue read boundary cleans them.
    opportunity.topics = [...example.topics];
    database.opportunities.push(opportunity);
    const high = example.rating >= 8;
    database.opportunity_reviews.push({ user_id: account, opportunity_id: opportunity.id,
      state: high ? 'strong_interest' : 'not_interested', interest_rating: example.rating,
      interest_reasons: example.avoidedTopic ? [{ category: 'topic', polarity: 'negative', target: example.avoidedTopic }]
        : high ? [{ category: 'topic', polarity: 'positive', target: example.topics[0] }] : [],
      feedback_revision: 1, feedback_updated_at: now, evaluation_revision: 1,
      comment: high ? 'Synthetic interest in acoustic research supported by hands-on sensing tasks.'
        : example.avoidedTopic ? 'Synthetic feedback explicitly avoids the named topic in this research context.'
          : 'Synthetic low job interest without an explicit negative topic reason.',
      reviewed_updated_at: recent, created_at: added, updated_at: now });
  });
  database.applications = [0, 1].map((index) => {
    const opportunity = database.opportunities[index]!;
    return { id: `20000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, user_id: account,
      opportunity_id: opportunity.id, cv_variant_id: null, contact_email: null, context_json: structuredClone(opportunity),
      context_captured_at: recent, completed_checklist_keys: [], status: index === 0 ? 'submitted' : 'preparation',
      workflow_stage: index === 0 ? 'tracking' : 'preparation', tracking_started: index === 0,
      status_history: [{ status: index === 0 ? 'submitted' : 'preparation', changedAt: recent }],
      notes: 'PRIVATE_APPLICATION_NOTES_CANARY', contacted_at: null, submitted_at: index === 0 ? recent : null,
      created_at: now, updated_at: recent };
  });
  // Reuse only the isolated synthetic SQL capture, scoped to this fixture owner.
  insightsDashboard = JSON.parse(JSON.stringify(dashboardFixture).replaceAll(dashboardFixture.user_id, account)) as AdaptiveSearchDashboardData;
  const template = createSearchTemplate('Synthetic research search', 'Europe/Tirane');
  template.researchInterests = 'Robotics; acoustic sensing; embedded learning systems; hands-on experiments';
  template.cloud = { id: insightsDashboard.search_id, revision: 1, contentKey: searchTemplateContentKey(template) };
  database.opportunity_search_templates = [{ id: insightsDashboard.search_id, user_id: account, name: template.name,
    revision: 1, criteria: searchTemplateCloudCriteria(template), schedule: searchTemplateCloudSchedule(template),
    created_at: now, updated_at: recent,
    meta_search: { version: 1, active: true, editor: template, systemPrompt: '', userPrompt: '', recurringPrompt: '' } }];
}
if (fixtureFlow === 'canonical-data') {
  database.opportunities = [canonicalOpportunityFixture()];
  database.opportunity_reviews = [];
}
if (fixtureFlow === 'manual-past') {
  const opportunity = database.opportunities[0];
  opportunity.deadline = '2099-01-01T23:59:00Z';
  database.opportunities = [opportunity];
  database.opportunity_reviews = [{ user_id: account, opportunity_id: opportunity.id, state: 'interested', interest_rating: 7.4,
    interest_reasons: [], feedback_excluded: false, feedback_revision: 0, feedback_updated_at: null,
    manually_archived: false, technical_issue_category: null, technical_issue_note: null,
    comment: 'Screen each project on its own research tasks.',
    evaluation_revision: 0, reviewed_updated_at: opportunity.updated_at, created_at: now, updated_at: now }];
  database.applications = [{ id: '20000000-0000-4000-8000-000000000099', user_id: account, opportunity_id: opportunity.id,
    application_code: 'APP-MANUALPAST', cv_variant_id: null, contact_email: null, context_json: structuredClone(opportunity),
    context_captured_at: new Date().toISOString(), completed_checklist_keys: [], status: 'preparation', workflow_stage: 'preparation',
    tracking_started: false, status_history: [{ status: 'preparation', changedAt: now }], notes: null,
    contacted_at: null, submitted_at: null, created_at: now, updated_at: now }];
}
if (fixtureFlow === 'interest') {
  const opportunity = database.opportunities[0]!;
  opportunity.deadline = '2099-01-01';
  database.opportunities = [opportunity];
  database.applications = [];
  database.opportunity_reviews = [{ user_id: account, opportunity_id: opportunity.id, state: 'unreviewed',
    interest_rating: null, interest_reasons: [], feedback_excluded: false, feedback_revision: 0,
    comment: null, evaluation_revision: 0, reviewed_updated_at: null, created_at: now, updated_at: now }];
}
if (fixtureFlow === 'application-groups') {
  const deadline = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  const future = deadline(7);
  const examples = [
    { title: 'Robot Learning PhD', institution: 'Northbridge Technical University', status: 'interview', deadline: deadline(-28) },
    { title: 'Acoustic Sensing Fellowship', institution: 'Institute for Responsible Computing', status: 'submitted', deadline: deadline(-7) },
    { title: 'Embedded AI Researcher', institution: 'Synthetic Science University', status: 'ready', deadline: deadline(-35) },
    { title: 'Multisensory Interfaces PhD', institution: 'Example Institute', status: 'preparation', deadline: deadline(-14) },
    { title: 'Human–Robot Interaction PhD', institution: 'Northbridge Technical University', status: 'preparation', deadline: future },
    { title: 'Rolling Research Fellowship', institution: 'Example Institute', status: 'refinement', deadline: null },
  ];
  for (const [index, example] of examples.entries()) {
    const suffix = String(index + 10).padStart(12, '0');
    const opportunityId = `10000000-0000-4000-8000-${suffix}`;
    const context = opportunityFixture({ id: opportunityId, opportunity_key: `application-group-${index}`,
      title: example.title, institution: example.institution, deadline: example.deadline?.slice(0, 10) ?? null,
      contacts: [{ entity_id: `${opportunityId}-person`, name: 'Dr. Alex Example', email: 'research@example.org', roles: ['Scientific contact'] }],
      created_at: now, updated_at: now });
    const applied = ['submitted', 'interview'].includes(example.status);
    database.opportunities.push(context);
    database.applications.push({ id: `20000000-0000-4000-8000-${suffix}`, user_id: account, opportunity_id: opportunityId,
      application_code: `APP-GROUP${index + 1}`, cv_variant_id: null, contact_email: null, context_json: structuredClone(context),
      context_captured_at: now, completed_checklist_keys: [], status: example.status,
      workflow_stage: applied ? 'tracking' : 'preparation', tracking_started: applied, status_history: [{ status: example.status, changedAt: now }],
      notes: null, contacted_at: null, submitted_at: applied ? now : null, created_at: now, updated_at: now });
  }
}
const refinement = createRefinementFixture(database, account);
// Hold writes explicitly so the interaction check does not depend on network timing.
let holdReviewWrites = false;
const reviewWrites: Array<{ name: string; release: (fail?: boolean) => void }> = [];
const manualPastWrites: Array<{ name: string; parameters: Row }> = [];
if (fixtureFlow === 'manual-past') Object.assign(window, { manualOpportunityPastFixture: {
  snapshot: () => structuredClone({ opportunity: database.opportunities[0], review: database.opportunity_reviews[0],
    application: database.applications[0], writes: manualPastWrites }),
} });

if (fixtureFlow === 'interest') Object.assign(window, { opportunityInterestFixture: {
  snapshot: () => structuredClone({ review: database.opportunity_reviews[0], writes: manualPastWrites,
    outcome: deriveOpportunityFeedback({ user_id: account, opportunity_id: String(database.opportunities[0]!.id),
      review: database.opportunity_reviews[0] as unknown as OpportunityReview, applications: [] }) }),
} });

function from(table: string) {
  if (REFINEMENT_TABLES.includes(table as typeof REFINEMENT_TABLES[number])) return refinement.from(table);
  const filters: [string, unknown][] = [];
  let first = 0;
  let last = Infinity;
  let one = false;
  let patch: Row | null = null;
  let upsert: Row | null = null;
  let signal: AbortSignal | undefined;
  let ordering: { column: string; ascending: boolean } | null = null;
  const execute = () => {
    if (signal?.aborted) return { data: null, error: new Error('Aborted') };
    if (!database[table]) return { data: null, error: { code: '42P01', message: `Unknown fixture table: ${table}` } };
    if (upsert) {
      const saved = database[table].find((row) => row.user_id === upsert!.user_id && row.opportunity_id === upsert!.opportunity_id);
      if (saved) Object.assign(saved, upsert, { updated_at: new Date().toISOString() });
      else database[table].push({ ...upsert, created_at: now, updated_at: now });
      filters.push(['user_id', upsert.user_id], ['opportunity_id', upsert.opportunity_id]);
    }
    const matching = database[table].filter((row) => filters.every(([key, value]) => row[key] === value));
    if (ordering) {
      const { column, ascending } = ordering;
      matching.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (ascending ? 1 : -1));
    }
    const selected = matching.slice(first, last + 1);
    if (patch) selected.forEach((row) => {
      if (table === 'applications' && patch!.status && patch!.status !== row.status) {
        row.status_history = [...(row.status_history as Row[] || []), { status: patch!.status, changedAt: new Date().toISOString() }];
      }
      const tracking = table === 'applications' ? { tracking_started: row.tracking_started === true || patch!.tracking_started === true } : {};
      Object.assign(row, patch, tracking, { updated_at: new Date().toISOString() });
    });
    return { data: structuredClone(one ? selected[0] ?? null : selected), error: null, count: matching.length };
  };
  const builder = {
    select(_fields: string) { return builder; },
    order(column: string, options: { ascending?: boolean } = {}) { ordering = { column, ascending: options.ascending !== false }; return builder; },
    range(start: number, end: number) { first = start; last = end; return builder; },
    eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
    update(value: Row) { patch = value; return builder; },
    upsert(value: Row) { upsert = value; return builder; },
    single() { one = true; return builder; },
    abortSignal(value: AbortSignal) { signal = value; return builder; },
    then(resolve: (value: ReturnType<typeof execute>) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(execute()).then(resolve, reject);
    },
  };
  return builder;
}

const client = {
  supabaseUrl: 'https://fixture.supabase.co',
  from,
  rpc(name: string, parameters: Row) {
    let signal: AbortSignal | undefined;
    const execute = () => {
      if (signal?.aborted) return { data: null, error: new Error('Aborted') };
      if (insightsDashboard && name === 'read_opportunity_search_dashboard') {
        return parameters.p_search_id === insightsDashboard.search_id && parameters.p_project_ref === insightsDashboard.project_ref
          ? { data: structuredClone(insightsDashboard), error: null }
          : { data: null, error: { code: '42501', message: 'Synthetic search scope mismatch' } };
      }
      if (insightsDashboard && name === 'read_adaptive_search_readiness') return { data: structuredClone(insightsDashboard.readiness), error: null };
      if (['manual-past', 'interest'].includes(fixtureFlow || '') && name === 'save_opportunity_feedback') {
        const review = database.opportunity_reviews.find(row => row.user_id === account && row.opportunity_id === parameters.p_opportunity_id);
        if (!review) return { data: null, error: new Error('Missing fixture review') };
        const patch = parameters.p_patch as Row;
        if (!patch || Object.keys(patch).some(key => !['manually_archived', 'technical_issue_category', 'technical_issue_note', 'feedback_excluded', 'interest_reasons'].includes(key))) {
          return { data: null, error: new Error('Unexpected manual-Past fixture patch') };
        }
        manualPastWrites.push({ name, parameters: structuredClone(parameters) });
        Object.assign(review, patch, { feedback_revision: Number(review.feedback_revision || 0) + 1, updated_at: new Date().toISOString() });
        return { data: structuredClone(review), error: null };
      }
      if (['save_refinement_state', 'publish_refinement_request', 'save_refinement_review'].includes(name)) return refinement.rpc(name, parameters);
      if (name === 'save_opportunity_meta_search') {
        const existing = database.opportunity_search_templates.find(row => row.id === parameters.p_id);
        if (Number(existing?.revision || 0) !== parameters.p_expected_revision) return { data: null, error: new Error('Search changed elsewhere.') };
        const saved = { id: parameters.p_id, user_id: account, name: parameters.p_name, criteria: parameters.p_criteria,
          schedule: parameters.p_schedule, meta_search: parameters.p_meta_search, revision: Number(existing?.revision || 0) + 1,
          created_at: existing?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
        if (existing) Object.assign(existing, saved); else database.opportunity_search_templates.push(saved);
        return { data: structuredClone(saved), error: null };
      }
      const snapshot = {
        id: parameters.p_cv_variant_id, user_id: account, name: parameters.p_cv_name,
        content_json: parameters.p_content_json, config_json: parameters.p_config_json,
        cv_version: parameters.p_cv_version, revision: 1, is_base_variant: false, created_at: new Date().toISOString(),
      };
      if (name === 'review_job_opportunity' || name === 'save_opportunity_comment') {
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        if (!opportunity) return { error: new Error('Missing fixture opportunity') };
        let review = database.opportunity_reviews.find((row) => row.opportunity_id === opportunity.id && row.user_id === account);
        if (!review) {
          review = { user_id: account, opportunity_id: opportunity.id, state: 'unreviewed', reviewed_updated_at: null, created_at: now, updated_at: now };
          if (fixtureFlow === 'manual-past') Object.assign(review, { manually_archived: false, technical_issue_category: null, technical_issue_note: null, evaluation_revision: 0 });
          database.opportunity_reviews.push(review);
        }
        if (fixtureFlow === 'interest' && (parameters.p_state || name === 'save_opportunity_comment')) manualPastWrites.push({ name, parameters: structuredClone(parameters) });
        if (parameters.p_state) review.state = parameters.p_state;
        if (name === 'save_opportunity_comment') review.comment = String(parameters.p_comment || '').trim() || null;
        if (parameters.p_observed_updated_at === opportunity.updated_at) review.reviewed_updated_at = opportunity.updated_at;
        review.updated_at = new Date().toISOString();
        return { data: structuredClone(review), error: null };
      } else if (name === 'create_job_application') {
        const existing = database.applications.find((row) => row.opportunity_id === parameters.p_opportunity_id);
        if (existing) return { data: existing.id, error: null };
        const opportunity = database.opportunities.find((row) => row.id === parameters.p_opportunity_id);
        database.applications.push({ id: parameters.p_application_id, user_id: account,
          application_code: fixtureFlow === 'canonical-data' ? 'APP-C4N0N1C4L0' : opportunity?.id === '10000000-0000-4000-8000-000000000001' ? 'APP-7K4M9Q' : null,
          opportunity_id: parameters.p_opportunity_id, cv_variant_id: null,
          contact_email: null, context_json: structuredClone(opportunity), context_captured_at: new Date().toISOString(), status: 'preparation', workflow_stage: 'preparation', tracking_started: false,
          status_history: [{ status: 'preparation', changedAt: new Date().toISOString() }], completed_checklist_keys: [], notes: null,
          contacted_at: null, submitted_at: null, created_at: now, updated_at: now });
      } else if (name === 'set_job_application_stage') {
        const application = database.applications.find(row => row.id === parameters.p_application_id && row.user_id === account);
        if (!application) return { error: new Error('Missing fixture application') };
        const stage = String(parameters.p_stage);
        const status = ({ preparation: 'preparation', refinement: 'refinement', review: 'attachments' } as Record<string, string>)[stage];
        if (stage !== 'tracking' && !status) return { error: new Error('Invalid fixture application stage') };
        application.workflow_stage = stage;
        if (status && !application.tracking_started && status !== application.status) {
          application.status = status;
          application.status_history = [...(application.status_history as Row[] || []), { status, changedAt: new Date().toISOString() }];
        }
        application.updated_at = new Date().toISOString();
        return { data: structuredClone(application), error: null };
      } else if (name === 'reset_job_application_history') {
        const application = database.applications.find(row => row.id === parameters.p_application_id && row.user_id === account);
        if (!application) return { error: new Error('Missing fixture application') };
        const current = (application.status_history as Row[] || []).findLast(entry => entry.status === application.status);
        application.status_history = [current || { status: application.status, changedAt: null }];
        application.updated_at = new Date().toISOString();
        return { data: structuredClone(application), error: null };
      } else if (name === 'set_job_application_checklist_item') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id && row.user_id === account);
        if (!application) return { error: new Error('Missing fixture application') };
        const keys = new Set(application.completed_checklist_keys as string[]);
        if (parameters.p_completed) keys.add(String(parameters.p_item_key));
        else keys.delete(String(parameters.p_item_key));
        application.completed_checklist_keys = [...keys];
        application.updated_at = new Date().toISOString();
        return { data: structuredClone(application), error: null };
      } else if (name === 'remove_job_application') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id && row.user_id === account);
        database.applications = database.applications.filter((row) => row !== application);
        for (const table of REFINEMENT_TABLES) database[table] = database[table].filter(row => row.application_id !== application?.id);
        const review = database.opportunity_reviews.find((row) => row.opportunity_id === application?.opportunity_id && row.user_id === account);
        if (review?.state === 'not_interested') review.state = 'unreviewed';
      } else if (name === 'assign_job_application_cv') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id);
        if (!application) return { error: new Error('Missing fixture application') };
        database.cv_variants.push(snapshot);
        Object.assign(application, parameters.p_changes, { cv_variant_id: snapshot.id, updated_at: new Date().toISOString() });
      } else if (name === 'refresh_job_application_context') {
        const application = database.applications.find((row) => row.id === parameters.p_application_id);
        if (!application) return { error: new Error('Missing fixture application') };
        application.context_json = structuredClone(database.opportunities.find((row) => row.id === application.opportunity_id));
        application.context_captured_at = new Date().toISOString();
      } else return { error: new Error(`Unsupported fixture RPC: ${name}`) };
      return { data: parameters.p_application_id, error: null };
    };
    const builder = {
      abortSignal(value: AbortSignal) { signal = value; return builder; },
      then(resolve: (value: ReturnType<typeof execute>) => unknown, reject?: (reason: unknown) => unknown) {
        if (holdReviewWrites && (name === 'save_opportunity_comment' || (name === 'review_job_opportunity' && parameters.p_state))) {
          return new Promise<ReturnType<typeof execute>>(done => reviewWrites.push({ name,
            release: fail => done(fail ? { error: new Error('Synthetic review save failure') } : execute()),
          })).then(resolve, reject);
        }
        return Promise.resolve().then(execute).then(resolve, reject);
      },
    };
    return builder;
  },
} as unknown as SupabaseClient;

document.documentElement.style.setProperty('--font-body', 'system-ui, sans-serif');
document.documentElement.style.setProperty('--ink', '#d1fae5');
library.add(
  faArrowDown, faArrowLeft, faArrowRight, faArrowsLeftRightToLine, faBriefcase, faCheck,
  faChevronLeft, faChevronRight, faCode, faDownload, faEnvelope, faEye, faEyeSlash,
  faFilePdf, faFolderOpen, faFont, faGithub, faGlobe, faGraduationCap, faGripVertical,
  faHeart, faInfoCircle, faLanguage, faLayerGroup, faLinkedin, faLink, faLinkSlash,
  faLocationDot, faLock, faLockOpen, faPalette, faPhone, faPlus, faSpinner, faSliders,
  faTableCellsLarge, faTableColumns, faTag, faTrash, faUserSecret, faWindowMaximize, faXmark,
);
const Fixture = defineComponent({
  setup() {
    const viewport = window.matchMedia('(min-width: 761px)');
    const desktop = ref(viewport.matches);
    const resize = () => { desktop.value = viewport.matches; };
    viewport.addEventListener('change', resize);
    onBeforeUnmount(() => viewport.removeEventListener('change', resize));
    provideDesktopSidebar(desktop);
    const tab = ref<'opportunities' | 'applications'>(fixtureFlow === 'application-groups' ? 'applications' : 'opportunities');
    const lang = ref('en');
    const draftStatus = ref('');
    const workspaceKey = ref(0);
    const workspace = ref<InstanceType<typeof CloudWorkspace> | null>(null);
    async function openWorkspaceList(value: 'opportunities' | 'applications') {
      if (workspace.value && !await workspace.value.openList(value)) return;
      tab.value = value;
    }
    const cv = createSampleDocument();
    const fixtureVariants = ref<SavedConfiguration[]>([{ id: 'sample-cv', name: 'Sample research CV', mtime: 1 }]);
    const fixtureStates = new Map<string, CvState>([['sample-cv', cv]]);
    // /test/browser/pages/job-workspace.html?flow=review-interaction (phone and desktop).
    onMounted(async () => {
      if (new URLSearchParams(location.search).get('flow') !== 'review-interaction') return;
      const assert = (condition: unknown, message: string) => {
        if (!condition) throw new Error(message);
      };
      const settle = async () => { await nextTick(); await new Promise(requestAnimationFrame); };
      const until = async (check: () => unknown, message: string) => {
        const deadline = performance.now() + 5000;
        do { await settle(); } while (!check() && performance.now() < deadline);
        assert(check(), message);
      };
      document.body.dataset.reviewTest = 'running';
      try {
        await until(() => document.querySelector('.jobs-row-toggle'), 'Opportunity must load.');
        document.querySelector<HTMLButtonElement>('.jobs-row-toggle')!.click();
        await until(() => document.getElementById('opportunity-comment'), 'Opportunity detail must open.');
        let select = document.querySelector<HTMLSelectElement>('select[aria-label="Your review"]')!;
        const comment = document.querySelector<HTMLTextAreaElement>('#opportunity-comment')!;
        holdReviewWrites = true;
        comment.focus();
        comment.value = `Responsiveness check ${Date.now()}`;
        comment.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
        assert(reviewWrites.length === 0, 'Typing must stay local until committed.');
        // AutosaveTextarea commits on outside pointerdown, before native focus/click.
        select.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        await until(() => reviewWrites.length, 'The outside press must commit the evaluation.');
        assert(!select.disabled, 'The first press is blocked: evaluation autosave disabled the interest dropdown.');
        select.focus();
        assert(document.activeElement === select, 'Interest must accept focus during evaluation autosave.');
        const choose = async (state: string) => {
          assert(!select.disabled, 'Interest must stay enabled while earlier writes are pending.');
          const started = performance.now();
          select.value = state;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await settle();
          assert(select.value === state, 'The selected interest must render immediately.');
          document.body.dataset.reviewFeedbackMs = String(Math.max(Number(document.body.dataset.reviewFeedbackMs || 0), Math.round(performance.now() - started)));
        };
        await choose('interested');
        await choose('strong_interest');
        assert(reviewWrites[0].name === 'save_opportunity_comment' && reviewWrites.length === 1, 'Writes must queue behind the evaluation.');
        reviewWrites.shift()!.release();
        await until(() => reviewWrites.length, 'First interest save must start.');
        assert(select.value === 'strong_interest', 'The evaluation response must not reset the latest interest.');
        assert(!document.querySelector<HTMLButtonElement>('.jobs-detail-action')!.disabled, 'An interest save must not block Apply.');
        if (!desktop.value) {
          const initialTitle = document.querySelector('.opportunity-detail h1')!.textContent;
          const swipeDetail = async (dx: number) => {
            const body = document.querySelector<HTMLElement>('.opportunity-detail__body')!;
            const start = new Touch({ identifier: 1, target: body, clientX: 200, clientY: 180 });
            const end = new Touch({ identifier: 1, target: body, clientX: 200 + dx, clientY: 180 });
            body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }));
            body.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [end], changedTouches: [end] }));
            body.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [end] }));
            await settle();
            select = document.querySelector<HTMLSelectElement>('select[aria-label="Your review"]')!;
          };
          const started = performance.now();
          await swipeDetail(-100);
          assert(document.querySelector('.opportunity-detail h1')!.textContent !== initialTitle, 'Swipe must navigate before the interest request completes.');
          document.body.dataset.reviewSwipeMs = String(Math.round(performance.now() - started));
          await swipeDetail(100);
          assert(document.querySelector('.opportunity-detail h1')!.textContent === initialTitle && select.value === 'strong_interest', 'Returning must restore the pending interest for that opportunity.');
        }
        reviewWrites.shift()!.release();
        await until(() => reviewWrites.length, 'Second interest save must start.');
        assert(select.value === 'strong_interest', 'An older interest response must not reset a newer choice.');
        reviewWrites.shift()!.release();
        await settle();
        assert(select.value === 'strong_interest' && !select.disabled, 'The final selection must persist and stay interactive.');
        await choose('interested');
        await until(() => reviewWrites.length, 'The failing write must start.');
        reviewWrites.shift()!.release(true);
        await until(() => document.querySelector('.app-toast--error .app-toast__action'), 'A failed save must offer Retry.');
        assert(select.value === 'interested', 'A failed write must keep the chosen interest visible.');
        document.querySelector<HTMLButtonElement>('.app-toast--error .app-toast__close')!.click();
        await settle();
        assert(document.querySelector('.jobs-interest-error button'), 'Retry must remain available after dismissing the notification.');
        document.querySelector<HTMLButtonElement>('.jobs-interest-error button')!.click();
        await until(() => reviewWrites.length, 'Retry must start.');
        reviewWrites.shift()!.release();
        await settle();
        assert(select.value === 'interested' && !select.disabled, 'Retry must save the selected interest.');
        await choose('strong_interest');
        await until(() => reviewWrites.length, 'Interest must still be pending when Apply is pressed.');
        const apply = document.querySelector<HTMLButtonElement>('.jobs-detail-action')!;
        assert(!apply.disabled, 'Apply must accept the first press during interest saving.');
        apply.click(); apply.click();
        await settle();
        assert(apply.disabled && apply.textContent?.includes('Creating'), 'Apply must acknowledge the press and prevent duplicate starts.');
        assert(database.applications.length === 0, 'Creation must remain queued behind the interest save.');
        reviewWrites.shift()!.release();
        await until(() => document.querySelector('.application-workspace')?.getClientRects().length, 'Apply must open the application when its queued save finishes.');
        assert(database.applications.length === 1, 'Repeated presses must create only one application.');
        draftStatus.value = `PASS: ${desktop.value ? 'Desktop' : 'Mobile'} interest, immediate swipe/Apply, ordered writes, retained failed choices and retry.`;
        document.body.dataset.reviewTest = 'passed';
      } catch (cause) {
        draftStatus.value = `FAIL: ${cause instanceof Error ? cause.message : String(cause)}`;
        document.body.dataset.reviewTest = 'failed';
      } finally {
        holdReviewWrites = false;
        reviewWrites.splice(0).forEach(write => write.release());
      }
      document.body.dataset.reviewTestMessage = draftStatus.value;
    });
    // Opt-in regression using the real phone layout and controls:
    // /test/browser/pages/job-workspace.html?flow=phone-filters at a viewport <= 760px.
    onMounted(async () => {
      if (new URLSearchParams(location.search).get('flow') !== 'phone-filters') return;
      const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const settle = async () => { await nextTick(); await new Promise(requestAnimationFrame); };
      const rows = () => [...document.querySelectorAll<HTMLElement>('.jobs-applications-table .jobs-result-row')];
      document.body.dataset.filterTest = 'running';
      try {
        assert(!desktop.value, 'Run the phone filter check at a viewport no wider than 760px.');
        for (const opportunity of database.opportunities.slice(0, 2)) {
          await client.rpc('create_job_application', { p_application_id: crypto.randomUUID(), p_opportunity_id: opportunity.id });
        }
        database.applications[0].status = 'interview';
        tab.value = 'applications'; workspaceKey.value++;
        const deadline = performance.now() + 5000;
        do { await settle(); } while (rows().length !== 2 && performance.now() < deadline);
        assert(rows().length === 2, 'Both synthetic applications must load.');
        const toggle = document.querySelector<HTMLButtonElement>('.jobs-filter-toggle');
        assert(toggle && toggle.getBoundingClientRect().height >= 44, 'Applications must expose a touch-sized Filters button.');
        toggle.click(); await settle();
        const panel = document.getElementById(toggle.getAttribute('aria-controls')!);
        assert(panel?.getClientRects().length, 'The Filters button must open its controlled panel.');
        const selects = panel.querySelectorAll<HTMLSelectElement>('select');
        const status = selects[0], sort = selects[1];
        assert(status && sort && status.getBoundingClientRect().height >= 44 && sort.getBoundingClientRect().height >= 44, 'Status and Sort must both be usable touch controls.');
        sort.value = 'institution'; sort.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        assert(rows()[0].textContent?.includes('Research Engineer'), 'Institution sorting must reorder the application results.');
        status.value = 'interview'; status.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        assert(rows().length === 1 && rows()[0].textContent?.includes('Human-Centred Robotics'), 'Status filtering must show only the matching application.');
        status.focus();
        status.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
        assert(toggle.getAttribute('aria-expanded') === 'false' && !panel.getClientRects().length && document.activeElement === toggle, 'Escape must close Filters and return focus to its trigger.');
        toggle.click(); await settle();
        assert(status.value === 'interview' && sort.value === 'institution', 'Closing Filters must preserve the selected filter and sort.');
        const navigation = document.querySelectorAll<HTMLButtonElement>('.fixture-mobile-nav button');
        navigation[0].click(); await settle();
        assert(toggle.getAttribute('aria-expanded') === 'false', 'Changing workspaces must close Filters.');
        toggle.click(); await settle();
        assert(document.querySelectorAll('#jobs-opportunities-filters select').length === 3, 'Opportunity filters must remain available in the shared panel.');
        navigation[1].click(); await settle();
        toggle.click(); await settle();
        const retained = document.querySelectorAll<HTMLSelectElement>('#jobs-applications-filters select');
        assert(retained[0].value === 'interview' && retained[1].value === 'institution' && rows().length === 1, 'Workspace changes must preserve application filters and results.');
        toggle.click(); await settle();
        const search = document.querySelector<HTMLInputElement>('.jobs-search input')!;
        search.focus();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        search.dispatchEvent(escape); await settle();
        assert(!escape.defaultPrevented && document.activeElement === search, 'Escape must leave the search control alone when Filters is closed.');
        draftStatus.value = 'PASS: Phone application filtering, sorting, touch targets and focus restoration.';
        document.body.dataset.filterTest = 'passed';
      } catch (cause) {
        draftStatus.value = `FAIL: ${cause instanceof Error ? cause.message : String(cause)}`;
        document.body.dataset.filterTest = 'failed';
      }
      document.body.dataset.filterTestMessage = draftStatus.value;
    });
    // Exercise the same list-navigation API as App.vue using both device layouts.
    // /test/browser/pages/job-workspace.html?flow=job-navigation
    onMounted(async () => {
      if (new URLSearchParams(location.search).get('flow') !== 'job-navigation') return;
      const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const settle = async () => { await nextTick(); await new Promise(requestAnimationFrame); };
      const until = async (check: () => unknown, message: string) => {
        const deadline = performance.now() + 5000;
        do { await settle(); } while (!check() && performance.now() < deadline);
        assert(check(), message);
      };
      const rows = () => [...document.querySelectorAll<HTMLElement>('.jobs-result-row')];
      const listVisible = () => !!document.querySelector<HTMLElement>('.jobs-table-scroll')?.getClientRects().length;
      const detailTitle = () => document.querySelector(tab.value === 'opportunities' ? '.opportunity-detail h1' : '.application-header h1')?.textContent;
      const openRow = async (index: number) => {
        const row = rows()[index];
        assert(row, `Result ${index + 1} must exist.`);
        const title = row.querySelector('strong')?.textContent;
        row.querySelector<HTMLButtonElement>('.jobs-row-toggle')!.click();
        await until(() => !listVisible() && detailTitle() === title, 'Opening a result must show its detail.');
        return title;
      };
      const navigate = async (value: 'opportunities' | 'applications') => {
        const selector = desktop.value ? '.fixture-toolbar button' : '.fixture-mobile-nav button';
        const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent === value);
        assert(button, `The ${value} workspace button must exist.`);
        button.click();
        await until(() => tab.value === value && listVisible(), `Clicking ${value} must open its list.`);
      };
      const assertReturnedCard = async (id: string) => {
        await until(() => {
          const row = rows().find(item => item.dataset.itemId === id);
          const track = row?.closest<HTMLElement>('.jobs-card-track');
          if (!row || !track || document.activeElement !== row.querySelector('.jobs-row-toggle')) return false;
          const cardBounds = row.getBoundingClientRect();
          const trackBounds = track.getBoundingClientRect();
          return cardBounds.left >= trackBounds.left - 1 && cardBounds.right <= trackBounds.right + 1;
        }, 'Returning to a mobile list must reveal and focus the selected card.');
      };
      const verifyCardTracks = async () => {
        const tracks = [...document.querySelectorAll<HTMLElement>('.jobs-card-track')];
        assert(tracks.length, 'Job results must expose their card tracks.');
        if (desktop.value) {
          for (const track of tracks) {
            assert(getComputedStyle(track).scrollSnapType === 'none', 'Desktop job lists must not enable mobile snapping.');
            if (window.matchMedia('(min-width: 1001px)').matches) {
              assert(getComputedStyle(track).display === 'table-row-group', 'Desktop results must preserve table row groups.');
              assert(getComputedStyle(track.querySelector('.jobs-result-row')!).display === 'table-row', 'Desktop entries must remain table rows.');
            }
          }
          return;
        }
        const outer = document.querySelector<HTMLElement>('.jobs-table-scroll')!;
        const atTop = (track: HTMLElement) => Math.abs(track.getBoundingClientRect().top - outer.getBoundingClientRect().top
          - outer.clientTop - parseFloat(getComputedStyle(outer).paddingTop)) < 2;
        assert(outer.scrollWidth <= outer.clientWidth + 1, 'Horizontal card scrolling must stay inside each track.');
        assert(tracks.length === 1, 'All mobile results must share one continuous swipe row.');
        if (tab.value === 'opportunities') {
          assert(getComputedStyle(outer).scrollbarWidth === 'none', 'The mobile opportunity list must hide its vertical scrollbar.');
          const recentFlags = rows().map(row => row.matches('.jobs-opportunity--new, .jobs-opportunity--updated'));
          const firstOther = recentFlags.indexOf(false);
          assert(firstOther < 0 || recentFlags.slice(firstOther).every(recent => !recent), 'New and updated cards must precede all other opportunities.');
        }
        for (const track of tracks) {
          const style = getComputedStyle(track);
          assert(['auto', 'scroll'].includes(style.overflowX) && style.scrollSnapType.startsWith('x'), 'Mobile card tracks must scroll and snap horizontally.');
          assert([...track.querySelectorAll<HTMLElement>('.jobs-group-row')].every(heading => !heading.getClientRects().length),
            'Mobile opportunity cards must not have separate group headings.');
          for (const row of track.querySelectorAll<HTMLElement>('.jobs-result-row')) {
            assert(getComputedStyle(row).display !== 'table-row' && getComputedStyle(row).scrollSnapAlign.includes('start'), 'Mobile entries must be cards with start snap points.');
          }
          const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
          const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
          await until(() => Math.abs(track.clientHeight - cards[0].getBoundingClientRect().height - verticalPadding) < 1,
            'The initial card height must settle before exercising horizontal momentum.');
          const firstInset = cards[0].getBoundingClientRect().left - track.getBoundingClientRect().left;
          // Land beyond each card's start, as momentum does after a swipe. The
          // browser must settle all cards (including the last) at the first inset.
          for (const direction of [1, -1]) {
            const destinations = direction === 1 ? cards.slice(1) : cards.slice(0, -1).reverse();
            for (const card of destinations) {
              const left = track.scrollLeft + card.getBoundingClientRect().left - track.getBoundingClientRect().left - firstInset;
              const previousHeight = track.clientHeight;
              const expectedHeight = card.getBoundingClientRect().height + verticalPadding;
              track.scrollTo({ left: left + direction * 48, behavior: 'smooth' });
              await until(() => {
                const aligned = Math.abs(card.getBoundingClientRect().left - track.getBoundingClientRect().left - firstInset) < 1;
                assert(aligned || track.clientHeight === previousHeight,
                  `The horizontal scrollport must keep its height throughout momentum and snapping (card ${cards.indexOf(card)}, direction ${direction}, height ${previousHeight} → ${track.clientHeight}, offset ${track.scrollLeft - left}).`);
                return aligned && Math.abs(track.clientHeight - expectedHeight) < 1;
              },
                'Every card must snap to the same horizontal inset in both directions, including the last card.');
            }
          }
        }
        const longTrack = tracks.find(item => item.querySelectorAll('.jobs-result-row').length >= 4);
        if (longTrack) {
          const cards = [...longTrack.querySelectorAll<HTMLElement>('.jobs-result-row')];
          const tallCard = cards.at(-1)!;
          const tallHeight = tallCard.getBoundingClientRect().height;
          assert(tallHeight > cards[0].getBoundingClientRect().height * 2, 'The fixture must include a distant card with much longer content.');
          await until(() => longTrack.clientHeight < tallHeight - 100, 'A distant tall card must not inflate the current card row.');
          const compactScrollHeight = outer.scrollHeight;
          const adjacent = cards.at(-2)!;
          const snapInset = parseFloat(getComputedStyle(longTrack).scrollPaddingLeft) || 0;
          longTrack.scrollTo({ left: longTrack.scrollLeft + adjacent.getBoundingClientRect().left - longTrack.getBoundingClientRect().left - snapInset, behavior: 'instant' });
          const trackPadding = parseFloat(getComputedStyle(longTrack).paddingTop) + parseFloat(getComputedStyle(longTrack).paddingBottom);
          await until(() => Math.abs(longTrack.clientHeight - adjacent.getBoundingClientRect().height - trackPadding) <= 1,
            'The row must match the current card even with a tall card immediately beside it.');
          assert(outer.scrollHeight <= compactScrollHeight + 1, 'A tall adjacent card must not create extra vertical scrolling.');
          longTrack.scrollTo({ left: longTrack.scrollWidth, behavior: 'instant' });
          await until(() => Math.abs(longTrack.clientHeight - tallHeight - trackPadding) <= 1,
            'The row must expand to the tall card only when it becomes current.');
          assert(outer.scrollHeight > compactScrollHeight, 'The current tall card must be fully scrollable.');
          outer.scrollTop = 120;
          await settle();
          assert(longTrack.getBoundingClientRect().top < outer.getBoundingClientRect().top - 80, 'The fixture must start reading partway down a card.');
          const nativeOffset = longTrack.scrollLeft;
          const previousOffset = longTrack.scrollLeft + adjacent.getBoundingClientRect().left - longTrack.getBoundingClientRect().left - snapInset;
          await swipe(tallCard, 160, 0, outer.getBoundingClientRect().top + 40, {
            afterMove(event) {
              assert(!event.defaultPrevented, 'Touches inside a card must retain native horizontal dragging.');
              assert(atTop(longTrack),
                'Native card swipes must reset to the top before the first horizontal movement.');
              assert(longTrack.scrollLeft === nativeOffset, 'Resetting vertically must precede native horizontal scrolling.');
              // Synthetic touch events have no native scroll default action.
              longTrack.scrollTo({ left: previousOffset, behavior: 'instant' });
            },
          });
          await until(() => Math.abs(longTrack.clientHeight - adjacent.getBoundingClientRect().height - trackPadding) <= 1,
            'Leaving the tall card must immediately restore the short card height.');
          assert(atTop(longTrack),
            'The incoming card must remain at the top throughout the swipe.');
          longTrack.scrollTo({ left: longTrack.scrollWidth, behavior: 'instant' });
          await until(() => longTrack.clientHeight >= tallHeight, 'The tall card must remain horizontally reachable and not clipped.');
          outer.scrollTop += 120;
          await settle();
          const readingPosition = outer.scrollTop;
          await swipe(tallCard, -10, 100, outer.getBoundingClientRect().top + 40);
          assert(outer.scrollTop === readingPosition, 'Vertical reading inside a card must not reset its position.');
          await swipe(outer, -10, 100, outer.getBoundingClientRect().top + 40);
          assert(outer.scrollTop === readingPosition, 'Vertical reading must not trigger a jump to the top.');
          await swipe(outer, 160, 0, outer.getBoundingClientRect().top + 40, {
            afterEnd() {
              assert(atTop(longTrack),
                'Surrounding-area swipes must reset before their smooth horizontal transition, without a settling timer.');
            },
          });
          await until(() => Math.abs(longTrack.scrollLeft - previousOffset) < 2
            && atTop(longTrack)
            && Math.abs(longTrack.clientHeight - adjacent.getBoundingClientRect().height - trackPadding) <= 1,
          'Swiping back from surrounding space must also return the previous card to the top.');
          longTrack.scrollTo({ left: 0, behavior: 'instant' });
          await until(() => longTrack.clientHeight < tallHeight - 100 && outer.scrollHeight <= compactScrollHeight + 1,
            'Returning to short cards must remove the extra vertical scrolling space.');
        }
        const track = tracks.find(item => item.querySelectorAll('.jobs-result-row').length > 1);
        assert(track, 'The fixture must include multiple cards in a track.');
        assert(track.scrollWidth > track.clientWidth, 'Adjacent cards must overflow their horizontal track.');
        const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
        const card = cards[1];
        const padding = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
        const target = card.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft - padding;
        const snappedTarget = Math.min(target, track.scrollWidth - track.clientWidth);
        track.scrollLeft = target;
        await until(() => track.scrollLeft > 0 && card.getBoundingClientRect().left >= track.getBoundingClientRect().left - 1
          && card.getBoundingClientRect().right <= track.getBoundingClientRect().right + 1, 'Horizontal scrolling must reveal the next card.');
        assert(listVisible(), 'Scrolling list cards must keep the list open.');
        track.scrollLeft = 0;
        await settle();
        const swipeY = Math.max(outer.getBoundingClientRect().top + 1, track.getBoundingClientRect().top + 1);
        await swipe(outer, -160, 0, swipeY);
        await until(() => Math.abs(track.scrollLeft - snappedTarget) < 2, 'Swiping the surrounding results area must advance the nearest card row.');
        await swipe(outer, 160, 0, swipeY);
        await until(() => track.scrollLeft < 2, 'A reverse swipe in the surrounding space must return to the previous card.');
        await swipe(outer, 160, 0, swipeY);
        assert(track.scrollLeft < 2, 'Swiping past the first card must stay at the start.');
        await swipe(outer, -10, 150, swipeY);
        assert(track.scrollLeft < 2, 'Vertical scrolling in the surrounding space must not change cards.');
        const selectedId = card.dataset.itemId!;
        await openRow(rows().indexOf(card));
        await navigate(tab.value);
        await assertReturnedCard(selectedId);
      };
      const swipe = async (target: HTMLElement, dx: number, dy = 0, startY = 260, observe: {
        afterMove?: (event: TouchEvent) => void; afterEnd?: () => void;
      } = {}) => {
        const startX = dx < 0 ? 250 : 90;
        const touch = (x: number, y: number) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
        const start = touch(startX, startY), end = touch(startX + dx, startY + dy);
        target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }));
        const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [end], changedTouches: [end] });
        target.dispatchEvent(move);
        observe.afterMove?.(move);
        target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [end] }));
        observe.afterEnd?.();
        await settle();
      };
      document.body.dataset.navigationTest = 'running';
      try {
        for (const key of ['CV_SELECTED_OPPORTUNITY', 'CV_SELECTED_APPLICATION']) sessionStorage.removeItem(`${key}:${account}`);
        await until(() => rows().length && listVisible(), 'Opportunity cards must load.');
        const researchCard = rows().find(row => row.dataset.itemId === database.opportunities[0].id)!;
        const summary = researchCard.querySelector<HTMLElement>('.jobs-card-summary')!;
        assert(summary.textContent?.includes('Study how robots'), 'The mobile card must retain its research summary.');
        if (desktop.value) {
          assert(!summary.getClientRects().length, 'Desktop tables must keep their existing columns.');
        } else {
          const header = researchCard.querySelector('.jobs-cell-heading')!.getBoundingClientRect();
          const deadline = researchCard.querySelector('.jobs-card-deadline')!.getBoundingClientRect();
          const location = researchCard.querySelector('.jobs-card-location')!.getBoundingClientRect();
          const topics = researchCard.querySelector('.jobs-topics')!.getBoundingClientRect();
          assert(summary.getBoundingClientRect().top >= header.bottom && deadline.top >= summary.getBoundingClientRect().bottom,
            'Research summary must appear directly after the header, before deadline and location.');
          assert(deadline.top === location.top && deadline.left < location.left && topics.top >= deadline.bottom,
            'Deadline must precede location, with topics below them.');
        }
        for (const opportunity of database.opportunities.slice(0, 2)) {
          await client.rpc('create_job_application', { p_application_id: crypto.randomUUID(), p_opportunity_id: opportunity.id });
        }
        workspaceKey.value++;
        await until(() => rows().length >= 3 && listVisible(), 'Synthetic opportunities must load.');
        await verifyCardTracks();
        await openRow(0);
        await navigate('opportunities');
        await openRow(0);
        await navigate('applications');
        assert(rows().length === 2, 'The application list must contain both seeded applications.');
        await verifyCardTracks();
        await openRow(0);
        await navigate('applications');
        await openRow(0);
        await navigate('opportunities');
        const opportunityTitles = rows().map(row => row.querySelector('strong')?.textContent);
        const opportunityIds = rows().map(row => row.dataset.itemId!);
        const firstOpportunityId = rows()[0].dataset.itemId;
        await openRow(0);
        const initialComment = document.querySelector<HTMLTextAreaElement>('#opportunity-comment')!;
        initialComment.value = 'Saved evaluation before application preparation.';
        initialComment.dispatchEvent(new Event('input', { bubbles: true }));
        initialComment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await until(() => database.opportunity_reviews.find(row => row.opportunity_id === firstOpportunityId)?.comment === initialComment.value, 'Opportunity evaluation must save before opening its application.');
        if (!desktop.value) {
          const comment = document.querySelector<HTMLTextAreaElement>('#opportunity-comment')!;
          const evaluation = 'Swipe navigation preserves this evaluation.';
          comment.value = evaluation;
          comment.dispatchEvent(new Event('input', { bubbles: true }));
          await swipe(comment, -160);
          assert(detailTitle() === opportunityTitles[0], 'Editing a textarea must not swipe to another opportunity.');
          await swipe(document.querySelector<HTMLElement>('.opportunity-detail__body')!, -10, 150);
          assert(detailTitle() === opportunityTitles[0], 'Vertical scrolling must keep the selected opportunity.');
          await swipe(document.querySelector<HTMLElement>('.opportunity-detail__body')!, -160);
          await until(() => detailTitle() === opportunityTitles[1], 'A left swipe must open the next opportunity in list order.');
          assert(database.opportunity_reviews.find(row => row.opportunity_id === firstOpportunityId)?.comment === evaluation, 'Swiping must save the outgoing evaluation.');
          await navigate('opportunities');
          await assertReturnedCard(opportunityIds[1]);
          const evaluatedCard = rows().find(row => row.dataset.itemId === firstOpportunityId)!;
          const evaluationBounds = evaluatedCard.querySelector('.jobs-card-evaluation')!.getBoundingClientRect();
          assert(evaluationBounds.top >= evaluatedCard.querySelector('.jobs-card-location')!.getBoundingClientRect().bottom
            && evaluatedCard.querySelector('.jobs-topics')!.getBoundingClientRect().top >= evaluationBounds.bottom,
          'Personal evaluation must sit below deadline/location and above topics.');
          await openRow(1);
          await swipe(document.querySelector<HTMLElement>('.opportunity-detail__body')!, 160);
          await until(() => detailTitle() === opportunityTitles[0], 'A right swipe must open the previous opportunity.');
          await swipe(document.querySelector<HTMLElement>('.opportunity-detail__body')!, 160);
          assert(detailTitle() === opportunityTitles[0], 'Swiping before the first opportunity must stay on that item.');
        }
        document.querySelector<HTMLButtonElement>('.jobs-detail-action')!.click();
        await until(() => tab.value === 'applications' && !listVisible() && detailTitle() === opportunityTitles[0], 'Apply must still navigate directly to the created application.');
        const evaluationSection = document.querySelector<HTMLDetailsElement>('.application-evaluation');
        assert(evaluationSection && evaluationSection === document.querySelector('.preparation-stage details'), 'Personal Evaluation must be the first collapsible in Preparation.');
        assert(evaluationSection.open, 'Personal Evaluation must be expanded initially on both layouts.');
        const applicationComment = evaluationSection.querySelector<HTMLTextAreaElement>('textarea')!;
        const savedComment = () => database.opportunity_reviews.find(row => row.opportunity_id === firstOpportunityId)?.comment;
        assert(applicationComment.value === savedComment(), 'Application Preparation must load the existing opportunity evaluation.');
        evaluationSection.querySelector('summary')!.click();
        await until(() => !evaluationSection.open, 'Personal Evaluation must collapse when its heading is clicked.');
        evaluationSection.querySelector('summary')!.click();
        await until(() => evaluationSection.open && applicationComment.getClientRects().length, 'Personal Evaluation must reopen without losing its editor.');
        const beforeTyping = savedComment();
        applicationComment.value = 'Updated in application preparation.';
        applicationComment.dispatchEvent(new Event('input', { bubbles: true })); await settle();
        assert(savedComment() === beforeTyping, 'Typing in the application evaluation must not save per character.');
        applicationComment.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await until(() => savedComment() === 'Updated in application preparation.', 'Enter must save the shared personal evaluation.');
        const stageButtons = [...document.querySelectorAll<HTMLButtonElement>('.workspace-subtabs button')];
        assert(stageButtons.length === 4, 'All four application stage controls must remain available in the navigation bar or sidebar.');
        applicationComment.value = 'Evaluation retained when changing preparation stage.';
        applicationComment.dispatchEvent(new Event('input', { bubbles: true }));
        stageButtons[1].click();
        await until(() => stageButtons[1].getAttribute('aria-pressed') === 'true' && savedComment() === applicationComment.value, 'Changing stage must commit and save the evaluation before leaving Preparation.');
        const preparedApplication = database.applications.find(row => row.opportunity_id === firstOpportunityId)!;
        await until(() => preparedApplication.status === 'refinement', 'Refinement must save its automatic preparation status.');
        const historyBeforeTracking = JSON.stringify(preparedApplication.status_history);
        const currentHistoryEntry = (preparedApplication.status_history as Row[]).at(-1)!;
        stageButtons[3].click();
        await until(() => preparedApplication.workflow_stage === 'tracking' && stageButtons[3].getAttribute('aria-pressed') === 'true', 'Tracking must save the selected tab.');
        assert(preparedApplication.status === 'refinement' && preparedApplication.tracking_started === false, 'Opening Tracking must preserve the previous status without choosing Ready.');
        assert(JSON.stringify(preparedApplication.status_history) === historyBeforeTracking, 'Opening Tracking must not append a status history entry.');
        const trackingStatus = document.querySelector<HTMLSelectElement>('select.application-status[aria-label^="Status for "]');
        assert(trackingStatus?.value === '', 'Tracking must still ask for an explicit status choice.');
        const resetHistory = document.querySelector<HTMLButtonElement>('.application-status-history__header button');
        assert(resetHistory, 'Tracking must expose the Reset history button.');
        await until(() => !resetHistory.disabled, 'Existing transitions must make history reset available.');
        resetHistory.click();
        await until(() => (preparedApplication.status_history as Row[]).length === 1 && resetHistory.disabled, 'Reset must retain only the current status entry.');
        assert(JSON.stringify(preparedApplication.status_history) === JSON.stringify([currentHistoryEntry]), 'Reset must preserve the current status timestamp.');
        assert(preparedApplication.status === 'refinement' && preparedApplication.tracking_started === false && trackingStatus.value === '', 'Reset must not choose Ready or start tracking.');
        stageButtons[0].click();
        await until(() => stageButtons[0].getAttribute('aria-pressed') === 'true', 'Preparation must remain accessible after saving.');
        assert(applicationComment.value === savedComment(), 'Returning to Preparation must preserve the evaluation.');
        await navigate('applications');
        assert(rows().length === 3, 'The created application must join the list.');
        const evaluationCard = rows().find(row => row.dataset.itemId === preparedApplication.id)?.querySelector<HTMLElement>('.jobs-card-evaluation');
        assert(evaluationCard && evaluationCard.textContent?.trim() === savedComment(), 'The application card must share the saved personal evaluation.');
        assert(Boolean(evaluationCard.getClientRects().length) === !desktop.value, 'List evaluation text remains mobile-only.');
        const applicationTitles = rows().map(row => row.querySelector('strong')?.textContent);
        const applicationIds = rows().map(row => row.dataset.itemId!);
        await openRow(0);
        if (!desktop.value) {
          await swipe(document.querySelector<HTMLElement>('.application-scroll-content')!, -160);
          await until(() => detailTitle() === applicationTitles[1], 'A left swipe must open the next application.');
          await navigate('applications');
          await assertReturnedCard(applicationIds[1]);
          await openRow(1);
          await swipe(document.querySelector<HTMLElement>('.application-scroll-content')!, 160);
          await until(() => detailTitle() === applicationTitles[0], 'A right swipe must open the previous application.');
        }
        await navigate('applications');
        draftStatus.value = `PASS: ${desktop.value ? 'Desktop' : 'Mobile'} lists, workspace clicks, application creation, preparation evaluation, Tracking without status changes${desktop.value ? '' : ', cards and horizontal swipes'}.`;
        document.body.dataset.navigationTest = 'passed';
      } catch (cause) {
        draftStatus.value = `FAIL: ${cause instanceof Error ? cause.message : String(cause)}`;
        document.body.dataset.navigationTest = 'failed';
      }
      document.body.dataset.navigationTestMessage = draftStatus.value;
    });
    async function select400WordScenario() {
      const template = { ...DEFAULT_LETTER_TEMPLATES[0], maxWords: 400 };
      createLetterRepository(localStorage, account).saveTemplate(template);
      await client.rpc('create_job_application', { p_application_id: crypto.randomUUID(), p_opportunity_id: database.opportunities[0].id });
      tab.value = 'applications'; workspaceKey.value++;
      draftStatus.value = '400-word PhD scenario ready. Open the application, select both templates and attach a transcript.';
    }
    function returnRefinementProposal(overLimit = false) {
      try {
        const returned = refinement.seedProposal(undefined, { overLimit });
        draftStatus.value = `Synthetic proposal returned (${returned.proposal_json.cvOperations.length} CV changes). Use “Check for proposal”, then select the latest proposal.`;
      } catch (cause) { draftStatus.value = cause instanceof Error ? cause.message : String(cause); }
    }
    return () => h('main', { class: ['browser-workspace-fixture', { 'has-desktop-sidebar': desktop.value }], style: 'display:grid;grid-template-rows:auto minmax(0,1fr);height:100dvh;overflow:hidden;padding:16px;max-width:1440px;margin:auto' }, [
      h(AppToaster, { lang: lang.value }),
      h(DesktopSidebar, { lang: lang.value, style: desktop.value ? '' : 'display:none' }, { header: () => h('span', { style: 'display:grid;place-items:center' }, 'Synthetic account') }),
      h('header', { class: 'fixture-toolbar', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 16px;color:#9be8c7' }, [
        h('strong', 'Browser fixture · In-memory data only'),
        ...(['opportunities', 'applications'] as const).map((value) => h('button', { class: 'btn', onClick: () => openWorkspaceList(value) }, value)),
        h('button', { class: 'btn', onClick: () => { lang.value = lang.value === 'en' ? 'de' : 'en'; } }, lang.value === 'en' ? 'Deutsch' : 'English'),
        h('button', { class: 'btn', onClick: select400WordScenario }, '400-word PhD scenario'),
        h('button', { class: 'btn', onClick: () => { workspaceKey.value++; draftStatus.value = 'Workspace reopened with existing browser documents and cloud data.'; } }, 'Reopen workspace'),
        h('button', { class: 'btn', onClick: () => returnRefinementProposal() }, 'Return refinement proposal'),
        h('button', { class: 'btn', onClick: () => returnRefinementProposal(true) }, 'Return over-limit proposal'),
        draftStatus.value ? h('span', { role: 'status', style: 'font-size:12px' }, draftStatus.value) : null,
      ]),
      h(CloudWorkspace, { ref: workspace, key: workspaceKey.value, client, userId: account, tab: tab.value, lang: lang.value, projectId: insightsDashboard?.project_ref ?? (fixtureFlow === 'meta-research' ? 'fixtureproject000000' : 'fixture'),
        configurations: fixtureVariants.value, selectedId: 'sample-cv',
        readVersion: (id: string) => fixtureStates.has(id) ? structuredClone(fixtureStates.get(id)!) : null,
        createVariant: (name: string, state: CvState) => {
          const id = crypto.randomUUID(); fixtureStates.set(id, structuredClone(state));
          fixtureVariants.value.push({ id, name, mtime: Date.now() }); return id;
        },
        onEditVariant: (id: string) => { draftStatus.value = `Open ${fixtureVariants.value.find(item => item.id === id)?.name} in CV Studio (fixture).`; },
        onNavigate: async (value: 'opportunities' | 'applications') => {
          if (workspace.value && !await workspace.value.flushTextareas()) return;
          tab.value = value;
        } }),
      h('nav', { class: 'fixture-mobile-nav', 'aria-label': 'Fixture workspaces' },
        (['opportunities', 'applications'] as const).map((value) => h('button', { class: 'btn', 'aria-pressed': tab.value === value, onClick: () => openWorkspaceList(value) }, value))),
    ]);
  },
});
document.documentElement.classList.add('app-dark');
const app = createApp(Fixture);
app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } });
app.component('InputText', InputText);
app.component('InputNumber', InputNumber);
app.component('Select', Select);
app.component('Textarea', Textarea);
app.component('font-awesome-icon', FontAwesomeIcon);
app.mount('#app');
