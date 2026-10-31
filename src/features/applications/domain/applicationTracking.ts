import { APPLICATION_STAGES, APPLICATION_STATUSES, type Application, type ApplicationStage, type ApplicationStatus } from '../../../app/cloudTypes';

export function applicationStatusLabel(status: string, lang: string = 'en'): string {
  const labels: Record<string, [string, string]> = {
    preparation: ['Preparation', 'Vorbereitung'], refinement: ['Refinement', 'Überarbeitung'],
    attachments: ['Attachments', 'Anhänge'], ready: ['Ready', 'Bereit'],
    contacted: ['Contacted', 'Kontaktiert'], submitted: ['Submitted', 'Eingereicht'],
    interview: ['Interview', 'Gespräch'], offer: ['Offer', 'Angebot'], rejected: ['Rejected', 'Abgelehnt'], withdrawn: ['Withdrawn', 'Zurückgezogen'],
  };
  return labels[status]?.[lang === 'de' ? 1 : 0] ?? status;
}

/** Shared colors for workflow stages and the explicitly selected tracking status. */
export function applicationStatusTone(status: string): 'neutral' | 'yellow' | 'red' {
  if (['submitted', 'interview', 'offer', 'rejected', 'withdrawn'].includes(status)) return 'red';
  if (['review', 'attachments', 'tracking', 'ready', 'contacted'].includes(status)) return 'yellow';
  return 'neutral';
}

/** Accept only statuses from the installed application contract. */
export function normalizeApplication(application: Application): Application {
  const normalize = (status: unknown): ApplicationStatus => {
    if (!APPLICATION_STATUSES.includes(status as ApplicationStatus)) throw new Error('The application has an unsupported status.');
    return status as ApplicationStatus;
  };
  return { ...application, status: normalize(application.status),
    ...(Array.isArray(application.status_history) ? { status_history: application.status_history.map(entry => ({ ...entry, status: normalize(entry?.status) })) } : {}),
  };
}

export function applicationTrackingStarted(application: Application): boolean {
  return application.tracking_started ?? ['contacted', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'].includes(application.status);
}

/** Ready/contacted are not submissions; a withdrawal needs prior submission evidence. */
export function applicationWasSubmitted(application: Pick<Application, 'status' | 'submitted_at' | 'status_history'>): boolean {
  const submitted = (status: string) => ['submitted', 'interview', 'offer', 'rejected'].includes(status);
  return submitted(application.status)
    || Boolean(application.submitted_at && Number.isFinite(Date.parse(application.submitted_at)))
    || Boolean(application.status_history?.some(entry => submitted(entry.status)));
}

export function applicationStage(application: Application): ApplicationStage {
  if (application.workflow_stage && APPLICATION_STAGES.includes(application.workflow_stage)) return application.workflow_stage;
  if (application.status === 'preparation' || application.status === 'refinement') return application.status;
  if (application.status === 'attachments') return 'review';
  return 'tracking';
}

/** Never infer a transition date from unrelated edits or legacy contact/submission dates. */
export function applicationStatusHistory(application: Application): NonNullable<Application['status_history']> {
  const normalized = normalizeApplication(application);
  const history = normalized.status_history;
  if (!Array.isArray(history) || !history.length || !history.every(entry => entry && APPLICATION_STATUSES.includes(entry.status)
    && (entry.changedAt === null || typeof entry.changedAt === 'string' && Number.isFinite(Date.parse(entry.changedAt))))) {
    return [{ status: normalized.status, changedAt: null }];
  }
  return history.at(-1)!.status === normalized.status ? history : [...history, { status: normalized.status, changedAt: null }];
}
