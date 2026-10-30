import type { Application } from '../../../app/cloudTypes';
import type { RefinementRequest, RefinementScope } from '../refinementTypes';
import { buildRefinementPrompt } from '../applicationRefinement';

type ApplicationReference = Pick<Application, 'id' | 'application_code'>;

/** Codes are opaque server values. A complete UUID is the only legacy fallback. */
export function applicationIdentifier(application: ApplicationReference): string {
  return typeof application.application_code === 'string' && application.application_code.trim()
    ? application.application_code : application.id;
}

export function buildShortRefinementInstruction(application: ApplicationReference, scope: RefinementScope, context?: { projectId: string; request: RefinementRequest }): string {
  if (scope !== 'cv' && scope !== 'letter') throw new Error('Publish a separate CV or letter request.');
  const document = scope === 'cv' ? 'CV' : 'motivation letter';
  const reference = applicationIdentifier(application);
  // Retain the legacy reference format for callers without a published source.
  if (!context) return `phd-workflow: ${reference} — refine ${document}.`;
  const { request, projectId } = context;
  if (request.applicationId !== application.id || request.scope !== scope) throw new Error('The copied task must match the published application and scope.');
  if (!/^[a-z0-9-]{1,100}$/i.test(projectId)) throw new Error('The connected Supabase project identifier is missing or invalid.');
  const initialLetter = scope !== 'cv' && !request.letter.text.trim();
  const task = initialLetter ? 'create an initial motivation-letter draft' : `refine ${document}`;
  return `phd-workflow: ${reference} — ${task}.
${buildRefinementPrompt(request, projectId)}`;
}
