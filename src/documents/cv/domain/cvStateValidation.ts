import type { Contact, CvDesign, CvState, CustomFont, CustomSection, CvItem, SidebarSection, CvContent, CvContentItem, CvConfig } from '../types';
import { CONTACT_FIELDS, CV_STATE_VERSION, FIELD_PRIVACY_TYPES } from '../types';
import { SUPPORTED_LANGUAGES } from '../defaults';
import { isPrivacyFieldOverrides } from '../../privacy/domain/privacyOverrides';
import { normalizeProxyFields } from '../../privacy/domain/fieldPrivacy';

type Guard<T> = (value: unknown) => value is T;
type Shape<T> = { [K in keyof T]-?: Guard<Exclude<T[K], undefined>> };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Mapped shapes require a validator for every declared property.
function partialObject<T>(shape: Shape<T>, exact = false): Guard<Partial<T>> {
  return (value): value is Partial<T> => isRecord(value)
    && (!exact || Object.keys(value).every((key) => Object.hasOwn(shape, key)))
    && (Object.keys(shape) as (keyof T & string)[]).every((key) =>
      value[key] === undefined || shape[key](value[key]));
}
function object<T>(shape: { [K in keyof T]-?: Guard<T[K]> }, exact = false): Guard<T> {
  return (value): value is T => isRecord(value)
    && (!exact || Object.keys(value).every((key) => Object.hasOwn(shape, key)))
    && (Object.keys(shape) as (keyof T & string)[]).every((key) => shape[key](value[key]));
}
function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}
const string: Guard<string> = (value) => typeof value === 'string';
const number: Guard<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
const boolean: Guard<boolean> = (value) => typeof value === 'boolean';
function array<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}
function literals<const T extends readonly (string | null)[]>(...values: T): Guard<T[number]> {
  return (value): value is T[number] => values.some((candidate) => candidate === value);
}
const strings = array(string);
const stringRecord: Guard<Record<string, string>> = (value): value is Record<string, string> => isRecord(value) && Object.values(value).every(string);
const contactShape: Shape<Contact> = {
  name: string, location: string, role: string, email: string,
  phone: string, website: string, linkedin: string, github: string,
};
const contact = object<Contact>(contactShape);
const designShape: Shape<CvDesign> = {
  h1: string, h2: string, h3: string, bullets: string,
  showTimeline: boolean,
  ink: string, graphicOpacity: number, dateOpacity: number,
  fontBody: string, fontHead: string, hstyle: string,
  customFonts: array(object<CustomFont>({
    name: (value): value is string => string(value) && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value),
    source: literals('bunny', 'google'),
  }, true)),
  badgeMode: string, badgeBorderWidth: string, badgeBorderRadius: string,
  sectionSpacingBody: string, sectionSpacingSidebar: string, itemSpacing: string,
  sidebarWidth: string, sidebarAlign: string, sidebarFillMode: string, sidebarHeightMode: string,
  sidebarBottomPadding: string, headerLayoutStyle: string, sidebarLayoutStyle: string,
  contactLayout: string, contactItemSpacing: string, separatorWidth: string,
  letterContactFields: array(literals(...CONTACT_FIELDS)),
  pageMarginTop: string, pageMarginRight: string, pageMarginBottom: string, pageMarginLeft: string,
  pageMarginHorizontalLinked: boolean, pageMarginVerticalLinked: boolean,
  headerPaddingBottom: string, headerBottomMargin: string, headerBottomSpacingLinked: boolean,
  bodySidebarSpacing: string, favoriteControls: strings,
};
const design = partialObject<CvDesign>(designShape);
const id: Guard<string> = (value): value is string => string(value) && value.length > 0;
const text = optional(string);
const contentItemShape: { [K in keyof CvContentItem]-?: Guard<CvContentItem[K]> } = {
  id, name: text, title: text, company: text,
  institution: text, sub: text, place: text, start: text, end: text,
  state: optional(literals('planned', 'ongoing', 'complete')),
  bullets: text, desc: text, thesis: text, coursesText: text,
  level: text, levelValue: optional(number),
};
const item = object<CvItem>({ ...contentItemShape, hidden: optional(boolean) });
const items = array(item);
const customSection = object<CustomSection>({
  id, name: string, entryMode: optional(literals('fields', 'textarea')), text,
  fields: optional(array(literals('title', 'institution', 'place', 'start', 'end', 'state', 'desc'))), entries: items,
});
const sidebarSection = object<SidebarSection>({
  id, name: string, levelType: literals('experience', 'years', null), items,
});
const currentState = object<CvState>({
  version: number, lang: literals(...SUPPORTED_LANGUAGES), disabled: strings,
  completedSections: strings, keepTogetherSections: strings, design, contact,
  anonymization: object<CvState['anonymization']>({ excludedSections: strings, excludedItems: strings, proxyFields: optional(array(literals(...FIELD_PRIVACY_TYPES))), fieldOverrides: optional(isPrivacyFieldOverrides) }),
  about: object<CvState['about']>({ text: string }),
  education: items,
  experience: object<CvState['experience']>({ jobs: items }),
  languages: items, hobbies: items,
  customSections: array(customSection), sidebarSections: array(sidebarSection),
  sectionNames: stringRecord, sectionHeaderSizes: stringRecord, bodyOrder: strings, sidebarOrder: strings,
});

/** Preserve saved CVs when the earlier individual proxy switches are encountered. */
function currentProxySettings(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.anonymization)) return value;
  const fields = value.anonymization.proxyFields;
  const legacyFields = ['start', 'end', 'title', 'name', 'level'];
  if (!Array.isArray(fields) || !fields.some(field => legacyFields.includes(field))
    || !fields.every(field => [...FIELD_PRIVACY_TYPES, ...legacyFields].includes(field))) return value;
  return { ...value, anonymization: { ...value.anonymization, proxyFields: normalizeProxyFields(fields) } };
}

/** Accept the current schema after upgrading earlier proxy settings. */
export function readCvState(value: unknown): CvState {
  value = currentProxySettings(value);
  if (!isRecord(value) || value.version !== CV_STATE_VERSION) throw new Error('Unsupported CV data version.');
  if (!currentState(value)) throw new Error('The CV contains invalid or missing fields.');
  return value;
}

const contentItems = array(object<CvContentItem>(contentItemShape, true));
const contentShape: { [K in keyof CvContent]-?: Guard<CvContent[K]> } = {
  contact: object<Contact>(contactShape, true),
  about: object<CvContent['about']>({ text: string }, true),
  education: contentItems,
  experience: object<CvContent['experience']>({ jobs: contentItems }, true),
  languages: contentItems, hobbies: contentItems,
  customSections: array(object<CvContent['customSections'][number]>({
    id, name: string, entryMode: optional(literals('fields', 'textarea')), text,
    fields: optional(array(literals('title', 'institution', 'place', 'start', 'end', 'state', 'desc'))), entries: contentItems,
  }, true)),
  sidebarSections: array(object<CvContent['sidebarSections'][number]>({
    id, name: string, levelType: literals('experience', 'years', null), items: contentItems,
  }, true)),
  sectionNames: stringRecord,
};
const configShape: { [K in keyof CvConfig]-?: Guard<CvConfig[K]> } = {
  lang: literals(...SUPPORTED_LANGUAGES), design: partialObject<CvDesign>(designShape, true),
  disabled: strings, completedSections: strings, keepTogetherSections: strings,
  anonymization: object<CvConfig['anonymization']>({ excludedSections: strings, excludedItems: strings, proxyFields: optional(array(literals(...FIELD_PRIVACY_TYPES))), fieldOverrides: optional(isPrivacyFieldOverrides) }, true),
  sectionHeaderSizes: stringRecord, bodyOrder: strings, sidebarOrder: strings, hiddenItems: strings,
};

export const CV_CONTENT_KEYS = Object.keys(contentShape) as (keyof CvContent)[];
export const CV_CONFIG_KEYS = Object.keys(configShape) as (keyof CvConfig)[];
export const CV_CONTENT_ITEM_KEYS = Object.keys(contentItemShape) as (keyof CvContentItem)[];
export const CV_DESIGN_KEYS = Object.keys(designShape) as (keyof CvDesign)[];
export const CV_CONTACT_KEYS = Object.keys(contactShape) as (keyof Contact)[];

export function readCvContent(value: unknown): CvContent {
  if (!object<CvContent>(contentShape, true)(value)) throw new Error('Invalid CV content fields.');
  // References in configuration must identify one unambiguous section/item.
  const sections = [...value.customSections, ...value.sidebarSections].map(({ id }) => id);
  const reserved = new Set(['header', 'about', 'education', 'jobs', 'languages', 'hobbies', '__proto__', 'constructor', 'prototype']);
  if (new Set(sections).size !== sections.length || sections.some((id) => reserved.has(id))) throw new Error('Invalid section IDs.');
  const ids = [value.education, value.experience.jobs, value.languages, value.hobbies,
    ...value.customSections.map(({ entries }) => entries), ...value.sidebarSections.map(({ items }) => items)]
    .flat().map(({ id }) => id);
  if (new Set(ids).size !== ids.length || ids.some((id) => reserved.has(id) || sections.includes(id))) throw new Error('Invalid item IDs.');
  return value;
}

export function readCvConfig(value: unknown): CvConfig {
  value = currentProxySettings(value);
  if (!object<CvConfig>(configShape, true)(value)) throw new Error('Invalid CV configuration fields.');
  return value;
}
