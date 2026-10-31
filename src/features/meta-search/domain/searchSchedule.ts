import type { SearchCloudSchedule, SearchScheduleCadence, SearchTemplate } from '../searchTypes';

export type SearchScheduleUnit = 'hours' | 'days' | 'weeks';
export const MAX_SEARCH_INTERVAL_HOURS = 23;
export const MAX_SEARCH_INTERVAL_DAYS = 365;
const MAX_INTERVAL_HOURS = MAX_SEARCH_INTERVAL_DAYS * 24;
const defaultCadence = (): SearchScheduleCadence => ({ frequency: 'daily', intervalHours: 1, weekdays: [], runImmediately: true });

export function readSearchScheduleCadence(value: unknown): SearchScheduleCadence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a valid search interval.');
  const cadence = value as Record<string, unknown>;
  if (Object.keys(cadence).some(key => !['frequency', 'intervalHours', 'weekdays', 'runImmediately'].includes(key))
    || !['hourly', 'daily', 'weekly'].includes(cadence.frequency as string)
    || !Number.isInteger(cadence.intervalHours) || Number(cadence.intervalHours) < 1 || Number(cadence.intervalHours) > MAX_INTERVAL_HOURS
    || !Array.isArray(cadence.weekdays) || cadence.weekdays.length > 7
    || cadence.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || cadence.frequency === 'weekly' && !cadence.weekdays.length || typeof cadence.runImmediately !== 'boolean') {
    throw new Error('Choose a whole-number interval and valid weekdays.');
  }
  return { frequency: cadence.frequency as SearchScheduleCadence['frequency'], intervalHours: Number(cadence.intervalHours),
    weekdays: [...cadence.weekdays] as number[], runImmediately: cadence.runImmediately };
}

/** Preserve historical daily metadata and imported weekly/hourly schedules until an explicit cadence edit. */
export function readSearchScheduleControls(template: Pick<SearchTemplate, 'cadence'>): { unit: SearchScheduleUnit; interval: number; weekdays: number[] } {
  const cadence = template.cadence ? readSearchScheduleCadence(template.cadence) : defaultCadence();
  return { unit: cadence.frequency === 'hourly' ? 'hours' : cadence.frequency === 'weekly' ? 'weeks' : 'days',
    interval: cadence.frequency === 'hourly' ? cadence.intervalHours : cadence.frequency === 'weekly' ? 1
      : cadence.intervalHours === 1 ? 1 : Math.max(1, cadence.intervalHours / 24), weekdays: [...cadence.weekdays] };
}

export function setSearchScheduleCadence(template: Pick<SearchTemplate, 'cadence'>, unit: SearchScheduleUnit, interval: number, weekdays?: number[]): SearchScheduleCadence {
  if (!['hours', 'days', 'weeks'].includes(unit) || !Number.isInteger(interval) || interval < 1
    || interval > (unit === 'hours' ? MAX_SEARCH_INTERVAL_HOURS : unit === 'days' ? MAX_SEARCH_INTERVAL_DAYS : 1)) throw new Error('Choose a valid whole-number search interval.');
  const current = template.cadence ? readSearchScheduleCadence(template.cadence) : defaultCadence();
  return readSearchScheduleCadence({ frequency: unit === 'hours' ? 'hourly' : unit === 'weeks' ? 'weekly' : 'daily',
    intervalHours: unit === 'days' && interval > 1 ? interval * 24 : unit === 'weeks' ? current.frequency === 'weekly' ? current.intervalHours : 1 : interval,
    weekdays: unit === 'weeks' ? [...new Set(weekdays ?? (current.weekdays.length ? current.weekdays : [1]))] : [], runImmediately: current.runImmediately });
}

export function searchScheduleFromTemplate(template: Pick<SearchTemplate, 'cadence' | 'dailyTime' | 'timezone'>): SearchCloudSchedule {
  const cadence = template.cadence ? readSearchScheduleCadence(template.cadence) : defaultCadence();
  return { ...cadence, time: template.dailyTime, timezone: template.timezone };
}

export function searchCadenceFromCloud(schedule: SearchCloudSchedule): SearchScheduleCadence | undefined {
  const cadence = readSearchScheduleCadence({ frequency: schedule.frequency, intervalHours: schedule.intervalHours,
    weekdays: schedule.weekdays, runImmediately: schedule.runImmediately });
  return cadence.frequency === 'daily' && cadence.intervalHours === 1 && !cadence.weekdays.length && cadence.runImmediately
    ? undefined : cadence;
}
