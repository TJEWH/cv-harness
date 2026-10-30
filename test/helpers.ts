import type { CvState } from '../src/documents/cv/types';
import { CV_STATE_VERSION } from '../src/documents/cv/types';

export function createTestState(overrides: Partial<CvState> = {}): CvState {
  return {
    version: CV_STATE_VERSION, lang: 'en', disabled: [], completedSections: [], keepTogetherSections: [],
    design: {}, anonymization: { excludedSections: [], excludedItems: [] },
    contact: { name: '', role: '', location: '', email: '', phone: '', website: '', linkedin: '', github: '' },
    about: { text: '' }, education: [], experience: { jobs: [] }, languages: [], hobbies: [],
    customSections: [], sidebarSections: [], sectionNames: {}, sectionHeaderSizes: {},
    bodyOrder: ['about', 'education', 'jobs'], sidebarOrder: ['languages', 'hobbies'],
    ...overrides,
  };
}

/** Test stubs implement the API members each case uses.
 * Confine the type assertion to this helper so callers retain type checking. */
export function stub<T>(implementation: unknown): T {
  return implementation as T;
}
