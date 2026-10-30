import type { CvState, SavedConfiguration } from '../../../documents/cv/types';
import { CV_STATE_VERSION } from '../../../documents/cv/types';
import { createDefaultDesign, DEFAULT_LANGUAGE, SAMPLE_CONTACT } from '../../../documents/cv/defaults';
import { makeT } from '../../../i18n/dict';

export const EMPTY_DOCUMENT_ID = 'builtin:empty';
export const SAMPLE_DOCUMENT_ID = 'builtin:sample';

export function isBuiltinDocument(id: string) {
  return id === EMPTY_DOCUMENT_ID || id === SAMPLE_DOCUMENT_ID;
}

export function builtinConfigurations(lang: string): SavedConfiguration[] {
  const t = makeT({ value: lang });
  return [
    { id: EMPTY_DOCUMENT_ID, name: t('emptyDocument') },
    { id: SAMPLE_DOCUMENT_ID, name: t('sampleCv') },
  ];
}

export function createEmptyDocument(): CvState {
  return {
    version: CV_STATE_VERSION, lang: DEFAULT_LANGUAGE, disabled: [], completedSections: [], keepTogetherSections: [],
    design: createDefaultDesign(),
    anonymization: { excludedSections: [], excludedItems: [] },
    contact: { name: '', location: '', role: '', email: '', phone: '', website: '', linkedin: '', github: '' },
    about: { text: '' }, education: [], experience: { jobs: [] }, languages: [], hobbies: [],
    customSections: [], sidebarSections: [], sectionNames: {}, sectionHeaderSizes: {},
    bodyOrder: ['about', 'education', 'jobs'], sidebarOrder: ['languages', 'hobbies'],
  };
}

/** Shipped with the app; each caller receives an independent editable copy. */
export function createSampleDocument(): CvState {
  const state = createEmptyDocument();
  state.contact = { ...SAMPLE_CONTACT };
  state.about.text = 'Software engineer with eight years of experience building accessible web applications and reliable cloud services. I enjoy turning complex problems into clear, useful products and helping teams deliver maintainable software. My work combines hands-on development, thoughtful technical leadership, and close collaboration with design and product teams.';
  state.experience.jobs = [
    {
      id: 'sample-job-1', title: 'Senior Software Engineer', company: 'Northstar Studio', place: 'Berlin', start: '2022', end: 'Present',
      bullets: '- Led a team of five engineers building a customer platform used by 40,000 people across Europe.\n- Designed a shared Vue and TypeScript component library, improving consistency and accessibility across three products.\n- Reduced page load times by 35% through profiling, smaller bundles, and better caching.\n- Introduced automated integration tests and gradual releases, making weekly deployments predictable.\n- Partnered with product managers to translate customer interviews into practical roadmap improvements.\n- Mentored junior developers through code reviews, pairing sessions, and individual development plans.',
    },
    {
      id: 'sample-job-2', title: 'Software Engineer', company: 'Harbor Digital', place: 'Hamburg', start: '2019', end: '2022',
      bullets: '- Built reporting dashboards that helped operations teams understand delivery performance and customer needs.\n- Developed Node.js services and PostgreSQL data models for a growing logistics platform.\n- Replaced manual data imports with validated workflows, saving the support team several hours each week.\n- Worked with designers to improve keyboard navigation, form validation, and responsive layouts.\n- Added monitoring and documented incident procedures to make service recovery faster.\n- Coordinated releases with customer support and wrote clear migration notes for internal users.',
    },
    {
      id: 'sample-job-3', title: 'Junior Web Developer', company: 'Fieldwork Labs', place: 'Leipzig', start: '2017', end: '2019',
      bullets: '- Delivered responsive websites and internal tools for education and nonprofit clients.\n- Implemented reusable forms and content management integrations with a focus on simplicity.\n- Collaborated with a small multidisciplinary team from discovery through launch and maintenance.\n- Established a practical checklist for cross-browser testing and accessibility reviews.',
    },
  ];
  state.education = [{
    id: 'sample-education', title: 'B.Sc. Computer Science', sub: 'Example University', place: 'Leipzig', start: '2013', end: '2017',
    coursesText: '- Software engineering, human-computer interaction, and distributed systems\n- Final project: an accessible scheduling application for community organizations',
  }];
  state.customSections = [{
    id: 'sample-projects', name: 'Selected projects', fields: ['title', 'desc'], entries: [
      { id: 'sample-project-1', title: 'Community Toolkit', desc: 'Created an open-source resource directory that helps local groups share events and services. Built searchable listings, accessible submission forms, and a lightweight moderation workflow. Worked with volunteers to test the product and document its ongoing maintenance.' },
      { id: 'sample-project-2', title: 'Sustainable Delivery Dashboard', desc: 'Prototyped a dashboard for comparing delivery routes and estimated emissions. Combined geospatial data with clear visual summaries so operations teams could evaluate trade-offs. Presented findings to stakeholders and handed over a documented implementation plan.' },
    ],
  }];
  state.languages = [{ id: 'sample-language-1', name: 'English', level: 'Fluent' }, { id: 'sample-language-2', name: 'German', level: 'Native' }];
  state.hobbies = [{ id: 'sample-hobby-1', name: 'Hiking & cycling' }, { id: 'sample-hobby-2', name: 'Photography' }];
  state.sidebarSections = [{ id: 'sample-skills', name: 'Skills', levelType: null, items: ['TypeScript & JavaScript', 'Vue & accessible UI', 'Node.js & REST APIs', 'PostgreSQL', 'Automated testing', 'CI/CD & cloud services', 'Technical mentoring'].map((name, i) => ({ id: `sample-skill-${i}`, name })) }];
  state.bodyOrder = ['about', 'jobs', 'education', 'sample-projects'];
  state.sidebarOrder = ['sample-skills', 'languages', 'hobbies'];
  return state;
}
