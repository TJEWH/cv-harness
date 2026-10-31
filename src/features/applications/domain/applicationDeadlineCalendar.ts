import type { Application } from '../../../app/cloudTypes';
import { resolveDeadline } from '../../opportunities/domain/opportunityDeadline';
import { safeWebUrl } from '../../../shared/lib/safeUrl';

type CalendarApplication = Pick<Application, 'id' | 'application_code' | 'context_json'>;
export interface ApplicationDeadlineCalendar { content: string; filename: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** RFC 5545 TEXT escaping also keeps imported research from creating properties. */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Fold UTF-8 content lines at 75 bytes without splitting a Unicode character. */
function foldLine(value: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let line = '';
  let bytes = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = ' ';
      bytes = 1;
    }
    line += character;
    bytes += size;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function calendarTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function filenamePart(value: string): string {
  const safe = value.normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
  let result = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of safe) {
    bytes += encoder.encode(character).length;
    if (bytes > 220) break;
    result += character;
  }
  return result.replace(/-+$/g, '');
}

/** Export exact instants, defaulting date-only deadlines to 23:59 in their source timezone. */
export function buildApplicationDeadlineCalendar(
  application: CalendarApplication,
  lang = 'en',
  now = new Date(),
): ApplicationDeadlineCalendar | null {
  const context = application.context_json;
  // Resolve 23:59 on the deadline date, without relying on the following midnight existing.
  // This calendar default leaves the catalogue's full-day expiry rules unchanged.
  const deadline = resolveDeadline(context, '23:59');
  if (!deadline || !Number.isFinite(now.getTime()) || now.getUTCFullYear() < 0 || now.getUTCFullYear() > 9999) return null;
  const assumedTime = deadline.dateOnly && (context.deadline_time_local === undefined || context.deadline_time_local === null || context.deadline_time_local === '');
  const timestamp = new Date(deadline.timestamp);
  if (timestamp.getUTCFullYear() < 0 || timestamp.getUTCFullYear() > 9999) return null;
  const german = lang === 'de';
  const label = german ? 'Bewerbungsfrist' : 'Application deadline';
  const title = text(context.title) || (german ? 'Bewerbung' : 'Application');
  const summary = `${label}: ${title}`;
  const institution = text(context.institution) || text(context.university);
  const reference = text(application.application_code);
  const assumedDeadline = assumedTime
    ? `${german ? 'Angenommene Frist' : 'Assumed deadline'}: ${deadline.date} 23:59 (${deadline.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone})` : '';
  const description = [summary, assumedDeadline, institution, reference ? `${german ? 'Referenz' : 'Reference'}: ${reference}` : ''].filter(Boolean).join('\n');
  const url = safeWebUrl(context.application_url) || safeWebUrl(context.official_url);
  // Keep event identity stable across product renames to avoid duplicate calendar entries.
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CV Harness//Application Deadlines//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${escapeText(`application-deadline-${application.id}@cv-builder`)}`, `DTSTAMP:${calendarTimestamp(now)}`,
  ];
  lines.push(`DTSTART:${calendarTimestamp(timestamp)}`);
  lines.push(`SUMMARY:${escapeText(summary)}`, `DESCRIPTION:${escapeText(description)}`, 'TRANSP:TRANSPARENT', 'CLASS:PRIVATE');
  if (url) lines.push(`URL:${url}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1W', `DESCRIPTION:${escapeText(summary)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  const name = [german ? 'bewerbungsfrist' : 'application-deadline', filenamePart(title), filenamePart(reference)].filter(Boolean).join('-');
  return { content: lines.map(foldLine).join('\r\n') + '\r\n', filename: `${filenamePart(name)}.ics` };
}
