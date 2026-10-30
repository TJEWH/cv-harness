import { DEFAULT_SECTION_HEADER_SIZE } from '../cv/defaults';
import type { CvState, CustomBodyField } from '../cv/types';
import { normalizeAnonymizationState } from '../privacy/domain/anonymization';

export const BODY_SECTION_KEYS = ['about', 'education', 'jobs'];
export const SIDEBAR_SECTION_KEYS = ['languages', 'hobbies'];
export const CUSTOM_BODY_FIELDS: CustomBodyField[] = ['title', 'institution', 'place', 'start', 'end', 'state', 'desc'];

let generatedId = 0;

export function createContentId(prefix = 'content') {
  generatedId += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10)
    || `${Date.now().toString(36)}${generatedId.toString(36)}`;
  return `${prefix}_${random}`;
}

function normalizedOrder(order: string[], allowed: string[]) {
  const allowedSet = new Set(allowed);
  return [...new Set([...order.filter((key) => allowedSet.has(key)), ...allowed])];
}

export function moveSectionInOrder(order: string[], key: string, direction: number) {
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= order.length) return order;
  const result = [...order];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

/** Apply optional editor defaults and remove references to deleted content. */
export function normalizeContentState(state: CvState) {
  for (const section of state.customSections) {
    section.entryMode ??= 'fields';
    section.text ??= '';
    const selected = new Set(section.fields ?? CUSTOM_BODY_FIELDS);
    section.fields = CUSTOM_BODY_FIELDS.filter((field) => selected.has(field));
    state.sectionHeaderSizes[section.id] ??= DEFAULT_SECTION_HEADER_SIZE;
    for (const entry of section.entries) {
      entry.institution ??= '';
      entry.desc ??= '';
    }
  }
  for (const item of state.experience.jobs) {
    item.bullets ??= '';
  }
  for (const section of state.sidebarSections) {
    for (const item of section.items) {
      item.name ??= '';
      item.levelValue ??= 0;
    }
  }
  const bodyKeys = [...BODY_SECTION_KEYS, ...state.customSections.map(({ id }) => id)];
  const sidebarKeys = [...SIDEBAR_SECTION_KEYS, ...state.sidebarSections.map(({ id }) => id)];
  state.bodyOrder = normalizedOrder(state.bodyOrder, bodyKeys);
  state.sidebarOrder = normalizedOrder(state.sidebarOrder, sidebarKeys);
  state.keepTogetherSections = [...new Set(state.keepTogetherSections.filter((key) => bodyKeys.includes(key)))];
  state.completedSections = [...new Set(state.completedSections)];
  normalizeAnonymizationState(state);
}

export function createNormalizedContentState(state: CvState): CvState {
  const normalized: CvState = JSON.parse(JSON.stringify(state));
  normalizeContentState(normalized);
  return normalized;
}
