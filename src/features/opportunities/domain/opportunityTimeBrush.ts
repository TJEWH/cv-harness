/** Inclusive local-calendar day ordinals, independent of 23/25-hour DST days. */
export interface OpportunityBrushRange { start: number; end: number }
export interface OpportunityBrushDomain { min: number; max: number }
export type OpportunityBrushAction = 'create' | 'start' | 'end' | 'move';
export type OpportunityBrushHandle = 'start' | 'end' | 'selection';

export function opportunityCalendarDay(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  calendar.setUTCHours(0, 0, 0, 0);
  return calendar.getTime() / 86_400_000;
}
export function opportunityCalendarDate(day: number): string {
  if (!Number.isInteger(day)) throw new TypeError('Use a calendar-day ordinal.');
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

const copy = (range: OpportunityBrushRange | null) => range ? { ...range } : null;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** One captured pointer at a time; DOM gesture direction and pointer capture belong to the view. */
export function createOpportunityTimeBrush(domain: OpportunityBrushDomain, initial: OpportunityBrushRange | null = null) {
  if (!Number.isInteger(domain.min) || !Number.isInteger(domain.max) || domain.min > domain.max) throw new RangeError('Use an ordered calendar-day domain.');
  const normalize = (range: OpportunityBrushRange | null) => range ? {
    start: clamp(Math.round(Math.min(range.start, range.end)), domain.min, domain.max),
    end: clamp(Math.round(Math.max(range.start, range.end)), domain.min, domain.max),
  } : null;
  let selected = normalize(initial);
  let gesture: { pointerId: number; action: OpportunityBrushAction; anchor: number; original: OpportunityBrushRange | null; origin: OpportunityBrushRange } | null = null;
  const visible = () => selected ?? { start: domain.min, end: domain.max };

  return {
    get selection(): OpportunityBrushRange | null { return copy(selected); },
    get pointerId(): number | null { return gesture?.pointerId ?? null; },
    begin(pointerId: number, action: OpportunityBrushAction, day: number): boolean {
      if (gesture || !Number.isFinite(day)) return false;
      const anchor = clamp(Math.round(day), domain.min, domain.max);
      gesture = { pointerId, action, anchor, original: copy(selected), origin: { ...visible() } };
      if (action === 'create') selected = { start: anchor, end: anchor };
      return true;
    },
    move(pointerId: number, day: number): OpportunityBrushRange | null {
      if (!gesture || gesture.pointerId !== pointerId || !Number.isFinite(day)) return copy(selected);
      const current = clamp(Math.round(day), domain.min, domain.max), { action, anchor, origin } = gesture;
      if (action === 'create') selected = { start: Math.min(anchor, current), end: Math.max(anchor, current) };
      else if (action === 'start') selected = { start: Math.min(current, origin.end), end: origin.end };
      else if (action === 'end') selected = { start: origin.start, end: Math.max(current, origin.start) };
      else {
        const delta = clamp(current - anchor, domain.min - origin.start, domain.max - origin.end);
        selected = { start: origin.start + delta, end: origin.end + delta };
      }
      return copy(selected);
    },
    end(pointerId: number): OpportunityBrushRange | null {
      if (gesture?.pointerId === pointerId) gesture = null;
      return copy(selected);
    },
    cancel(pointerId?: number): OpportunityBrushRange | null {
      if (gesture && (pointerId === undefined || gesture.pointerId === pointerId)) {
        selected = copy(gesture.original);
        gesture = null;
      }
      return copy(selected);
    },
    keyboard(handle: OpportunityBrushHandle, key: string, shift = false): OpportunityBrushRange | null {
      if (gesture) return copy(selected);
      const origin = visible(), step = shift ? 7 : 1;
      const direction = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : key === 'ArrowRight' || key === 'ArrowUp' ? 1 : 0;
      if (!direction && key !== 'Home' && key !== 'End') return copy(selected);
      if (handle === 'start') selected = { start: key === 'Home' ? domain.min : key === 'End' ? origin.end : clamp(origin.start + direction * step, domain.min, origin.end), end: origin.end };
      else if (handle === 'end') selected = { start: origin.start, end: key === 'Home' ? origin.start : key === 'End' ? domain.max : clamp(origin.end + direction * step, origin.start, domain.max) };
      else {
        const delta = key === 'Home' ? domain.min - origin.start : key === 'End' ? domain.max - origin.end : clamp(direction * step, domain.min - origin.start, domain.max - origin.end);
        selected = { start: origin.start + delta, end: origin.end + delta };
      }
      return copy(selected);
    },
  };
}
