import { createHash } from 'node:crypto';
import type { RefinementRequest, RefinementScope } from '../../../src/features/refinement/refinementTypes';
import { prepareRefinement, refinementSignature } from '../../../src/features/refinement/applicationRefinement';
import { buildShortRefinementInstruction } from '../../../src/features/refinement/domain/applicationReference';
import { DEFAULT_LETTER_TEMPLATES } from '../../../src/documents/letter/motivationLetters';
import { createTestState } from '../../support/fixtures/cvState';

export const CASE_NAMES = ['cv', 'initial-letter', 'letter', 'feedback', 'missing-request', 'stale-request'] as const;
export type CaseName = typeof CASE_NAMES[number];
export type ProtocolCase = ReturnType<typeof createCase>;
export const FIXTURE_PROJECT = 'refinement-test-project';
export const CREATED = '2026-10-10T00:00:00.000Z';
export function stableId(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/** Deterministic review fixtures; live runs supply a unique namespace and real project. */
export function createCase(name: CaseName, projectId = FIXTURE_PROJECT, namespace = 'review-v1') {
  const id = (kind: string) => stableId(`refinement-protocol:${namespace}:${name}:${kind}`);
  const state = createTestState({
    contact: { name: 'Synthetic Applicant', role: 'Research assistant', location: '', email: '', phone: '', website: '', linkedin: '', github: '' },
    about: { text: 'Research assistant studying reproducible measurement methods.' },
    experience: { jobs: [{ id: 'research', title: 'Research assistant', bullets: 'Built measurement tools using Python.\nDocumented reproducible experiments.\nHelped organize a laboratory event.' }] },
  });
  const scope: RefinementScope = name === 'cv' || name === 'missing-request' || name === 'stale-request' ? 'cv' : 'letter';
  const setup = { template: { ...DEFAULT_LETTER_TEMPLATES[0], updatedAt: CREATED }, language: 'en', maxWords: 200 };
  const feedback = name === 'feedback' ? [{ id: id('feedback'), scope, createdAt: CREATED,
    text: 'Keep the opening short. Emphasize my Python measurement tools and reproducible experiments. Do not claim leadership experience.' }] : [];
  const local = prepareRefinement({ applicationId: id('application'), state, variantId: 'synthetic', setup,
    letterText: name === 'initial-letter' ? '' : 'Dear committee,\nI am interested in reproducible measurement research. I built measurement tools using Python.\nSincerely,\n{{APPLICANT_NAME}}',
    opportunity: { title: 'Synthetic PhD in measurement', description: 'Study reproducible measurement methods and Python tools.' },
    scope, feedback, parentProposalId: null, baselineSignature: refinementSignature(state) });
  const request: RefinementRequest = { ...local.request, requestId: id('request'), cv: { ...local.request.cv, requestId: id('request') } };
  const application = { id: request.applicationId, application_code: `APP-${id('code').replaceAll('-', '').slice(0, 10).toUpperCase()}` };
  const task = buildShortRefinementInstruction(application, scope, { projectId, request });
  return { name, projectId, namespace, ownerId: id('owner'), opportunityId: id('opportunity'), snapshotId: id('snapshot'),
    application, request, task, state, setup,
    expected: name === 'missing-request' || name === 'stale-request' ? 'stop-read' as const : 'saved' as const };
}

export function suiteFingerprint() {
  return refinementSignature(CASE_NAMES.map(name => {
    const fixture = createCase(name);
    return [name, fixture.task, fixture.expected];
  }));
}
