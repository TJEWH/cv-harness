type DeadlineInput = unknown;
interface WallTime { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number }
interface Deadline { timestamp: number; date: string; time: string | null; timeZone: string | null; dateOnly: boolean }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function utcTime(parts: WallTime) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return date.getTime();
}

function zonedWallTime(timestamp: number, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'),
    minute: value('minute'), second: value('second'), millisecond: ((timestamp % 1000) + 1000) % 1000 };
}

/** Resolve civil time without assuming a fixed UTC offset across daylight-saving changes. */
function wallTimeToTimestamp(parts: WallTime, timeZone: string | null): number | null {
  const target = utcTime(parts);
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const offsets = new Set([-36, 0, 36].map((hours) => {
      const probe = target + hours * 3_600_000;
      return utcTime(zonedWallTime(probe, zone)) - probe;
    }));
    const candidates = [...offsets].map((offset) => target - offset)
      .filter((candidate) => utcTime(zonedWallTime(candidate, zone)) === target);
    // A repeated autumn hour has two occurrences. Keep the opportunity visible through both.
    return candidates.length ? Math.max(...candidates) : null;
  } catch { return null; }
}

/** An optional civil-time default applies only to dates without a supplied local time. */
export function resolveDeadline(input: DeadlineInput, defaultDateOnlyTime: string | null = null): Deadline | null {
  const details = record(input);
  const raw = typeof input === 'string' ? input : details.deadline;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  const date = value.slice(0, 10);
  if (!validDate(date)) return null;
  const timeZone = typeof details.deadline_timezone === 'string' && details.deadline_timezone.trim()
    ? details.deadline_timezone.trim() : null;
  const dateOnly = value === date;
  const timestampMatch = value.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!dateOnly && !timestampMatch) return null;
  const providedTime = dateOnly ? details.deadline_time_local : timestampMatch?.[1];
  const rawTime = dateOnly && (providedTime === undefined || providedTime === null || providedTime === '') ? defaultDateOnlyTime : providedTime;
  const time = typeof rawTime === 'string' && rawTime.trim() ? rawTime.trim() : null;
  const match = time?.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/);
  if ((rawTime !== undefined && rawTime !== null && rawTime !== '' && !time) || (time && !match)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const parts: WallTime = { year, month, day, hour: Number(match?.[1] || 0), minute: Number(match?.[2] || 0),
    second: Number(match?.[3] || 0), millisecond: Number((match?.[4] || '').padEnd(3, '0').slice(0, 3)) };
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;

  let timestamp: number | null;
  if (timestampMatch?.[2]) {
    // A timestamp's own offset is authoritative, even if catalogue timezone metadata differs.
    const offset = timestampMatch[2].replace(/^([+-]\d{2})$/, '$1:00');
    const parsed = Date.parse(`${date}T${timestampMatch[1]}${offset}`);
    timestamp = Number.isFinite(parsed) ? parsed : null;
  } else if (dateOnly && !time) {
    const nextDay = new Date(utcTime(parts) + 86_400_000);
    const nextMidnight = wallTimeToTimestamp({ ...parts, year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate() }, timeZone);
    timestamp = nextMidnight === null ? null : nextMidnight - 1;
  } else timestamp = wallTimeToTimestamp(parts, timeZone);
  return timestamp === null ? null : { timestamp, date, time, timeZone, dateOnly };
}

/** Missing or invalid dates stay visible; a date-only deadline includes its entire local day. */
export function isOpportunityDeadlinePassed(input: DeadlineInput, now = new Date()): boolean {
  const deadline = resolveDeadline(input);
  return deadline !== null && Number.isFinite(now.getTime()) && now.getTime() > deadline.timestamp;
}

/** Unknown deadlines sort after all confirmed deadlines. */
export function opportunityDeadlineSortKey(input: DeadlineInput): number {
  return resolveDeadline(input)?.timestamp ?? Infinity;
}

export function formatOpportunityDeadline(input: DeadlineInput, lang: string): string {
  const deadline = resolveDeadline(input);
  if (!deadline) return lang === 'de' ? 'Keine bestätigte Frist' : 'No confirmed deadline';
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  if (deadline.dateOnly) {
    const label = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
      .format(new Date(`${deadline.date}T00:00:00Z`));
    return `${label}${deadline.time ? `, ${deadline.time.replace(/^(\d{2}:\d{2}):00(?:\.0+)?$/, '$1')}` : ''}${deadline.timeZone ? ` (${deadline.timeZone})` : ''}`;
  }
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short', ...(deadline.timeZone ? { timeZone: deadline.timeZone } : {}) }).format(new Date(deadline.timestamp));
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
      .format(new Date(deadline.timestamp)) + ' UTC';
  }
}
