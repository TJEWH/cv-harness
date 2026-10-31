import type { CvConfig, CvContent, CvItem, CvState } from '../../../documents/cv/types';
import { CV_STATE_VERSION } from '../../../documents/cv/types';
import { anonymizeContentJson, preservePrivateContent } from '../../../documents/privacy/domain/contentJsonPrivacy';
import type { ContentPrivacyOptions } from '../../../documents/privacy/domain/contentJsonPrivacy';
import { normalizeAnonymizationState } from '../../../documents/privacy/domain/anonymization';
import {
  CV_CONFIG_KEYS, CV_CONTACT_KEYS, CV_CONTENT_ITEM_KEYS, CV_CONTENT_KEYS, CV_DESIGN_KEYS,
  isRecord, readCvConfig, readCvContent, readCvState,
} from '../../../documents/cv/domain/cvStateValidation';

export const CV_CONTENT_JSON_FORMAT = 'cv-harness/content';
export const CV_CONFIG_JSON_FORMAT = 'cv-harness/config';
const LEGACY_CV_JSON_FORMATS = { [CV_CONTENT_JSON_FORMAT]: 'cv-builder/content', [CV_CONFIG_JSON_FORMAT]: 'cv-builder/config' } as const;
export const CV_JSON_FORMAT_VERSION = 1;
export const MAX_CV_JSON_FILE_BYTES = 5 * 1024 * 1024;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value as object, key)).map((key) => [key, value[key]])) as Pick<T, K>;
}
function allItems(state: CvState): CvItem[] {
  return [state.education, state.experience.jobs, state.languages, state.hobbies,
    ...state.customSections.map(({ entries }) => entries), ...state.sidebarSections.map(({ items }) => items)].flat();
}

/** Explicit projections prevent settings or unknown private fields leaking into content files. */
export function cvContent(state: CvState): CvContent {
  readCvState(state);
  const items = (values: CvItem[]) => values.map((item) => pick(item, CV_CONTENT_ITEM_KEYS));
  return clone(readCvContent({
    ...pick(state, CV_CONTENT_KEYS),
    contact: pick(state.contact, CV_CONTACT_KEYS), about: { text: state.about.text },
    education: items(state.education), experience: { jobs: items(state.experience.jobs) },
    languages: items(state.languages), hobbies: items(state.hobbies),
    customSections: state.customSections.map((section) => ({
      ...pick(section, ['id', 'name', 'entryMode', 'text', 'fields']), entries: items(section.entries),
    })),
    sidebarSections: state.sidebarSections.map((section) => ({
      ...pick(section, ['id', 'name', 'levelType']), items: items(section.items),
    })),
  }));
}

export function cvConfig(state: CvState): CvConfig {
  readCvState(state);
  const design = pick(state.design, CV_DESIGN_KEYS);
  if (design.customFonts) design.customFonts = design.customFonts.map((font) => pick(font, ['name', 'source']));
  return clone(readCvConfig({
    ...pick({ ...state, hiddenItems: allItems(state).filter(({ hidden }) => hidden).map(({ id }) => id) }, CV_CONFIG_KEYS),
    design, anonymization: pick(state.anonymization, ['excludedSections', 'excludedItems', 'proxyFields', 'fieldOverrides']),
  }));
}

function envelope<T>(format: string, data: T, exportedAt: Date) {
  return { format, formatVersion: CV_JSON_FORMAT_VERSION, cvVersion: CV_STATE_VERSION, exportedAt: exportedAt.toISOString(), data };
}
export function createCvContentJson(state: CvState, { bypassPrivacy = false }: ContentPrivacyOptions = {}, exportedAt = new Date()) {
  const content = cvContent(state);
  return envelope(CV_CONTENT_JSON_FORMAT, bypassPrivacy ? content : anonymizeContentJson(content, state), exportedAt);
}
export function createCvConfigJson(state: CvState, exportedAt = new Date()) {
  return envelope(CV_CONFIG_JSON_FORMAT, cvConfig(state), exportedAt);
}

function parseEnvelope(text: string, format: typeof CV_CONTENT_JSON_FORMAT | typeof CV_CONFIG_JSON_FORMAT): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(text, (key, value) => RESERVED_KEYS.has(key) ? undefined : value); }
  catch { throw new Error('The selected file is not valid JSON.'); }
  if (!isRecord(parsed) || (parsed.format !== format && parsed.format !== LEGACY_CV_JSON_FORMATS[format]) || parsed.formatVersion !== CV_JSON_FORMAT_VERSION
    || Object.keys(parsed).some((key) => !['format', 'formatVersion', 'cvVersion', 'exportedAt', 'data'].includes(key))) {
    throw new Error('This file uses an unsupported CV export format.');
  }
  if (parsed.cvVersion !== CV_STATE_VERSION) throw new Error('Unsupported CV data version.');
  if (typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))) throw new Error('Invalid export date.');
  return parsed.data;
}
export function parseCvContentJson(text: string): CvContent {
  return readCvContent(parseEnvelope(text, CV_CONTENT_JSON_FORMAT));
}
export function parseCvConfigJson(text: string): CvConfig {
  return readCvConfig(parseEnvelope(text, CV_CONFIG_JSON_FORMAT));
}

/** Replace editable content, protecting local private fields unless explicitly bypassed. */
export function applyCvContent(state: CvState, content: CvContent, { bypassPrivacy = false }: ContentPrivacyOptions = {}): CvState {
  const hidden = new Map(allItems(state).map((item) => [item.id, item.hidden]));
  const imported = clone(readCvContent(content));
  const local = clone(readCvState(state));
  const next = bypassPrivacy ? imported : preservePrivateContent(cvContent(local), imported, local);
  const result = Object.assign(local, readCvContent(next));
  for (const item of allItems(result)) {
    if (hidden.get(item.id) !== undefined) item.hidden = hidden.get(item.id);
  }
  normalizeAnonymizationState(result);
  return result;
}

/** Replace configuration without replacing any CV text or entries. */
export function applyCvConfig(state: CvState, config: CvConfig): CvState {
  const { hiddenItems, ...settings } = clone(readCvConfig(config));
  const result = Object.assign(clone(readCvState(state)), settings);
  const hidden = new Set(hiddenItems);
  for (const item of allItems(result)) {
    if (hidden.has(item.id)) item.hidden = true;
    else delete item.hidden;
  }
  return result;
}

/** Internal browser storage is separate from the two portable JSON formats. */
export function parseStoredCvState(text: string): CvState {
  const stored: unknown = JSON.parse(text);
  if (!isRecord(stored) || !isRecord(stored.__meta)) throw new Error('Invalid saved configuration.');
  return readCvState(stored.data);
}
