import type { CvContent, CvContentItem, CvState, PrivacyFieldOverrides } from '../../cv/types';

type PrivacyContent = CvContent | CvState;
type FieldValue = string | number;
const ITEM_TEXT_FIELDS = ['name', 'title', 'company', 'institution', 'sub', 'place', 'start', 'end',
  'bullets', 'desc', 'thesis', 'coursesText', 'level'] as const;
const CONTACT_FIELDS = ['name', 'location', 'role', 'email', 'phone', 'website', 'linkedin', 'github'] as const;
const BUILTIN_SECTIONS = ['header', 'sidebar-contact', 'about', 'education', 'jobs', 'languages', 'hobbies'];
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Stable identities survive item moves and ordering changes without storing the original text. */
export function privacyFieldKey(...parts: string[]): string { return JSON.stringify(parts); }

export interface PrivacyFieldEntry {
  key: string;
  path: (string | number)[];
  value: FieldValue;
  owner: object;
  field: string;
}

/** Include blank editable fields in the same privacy override model. */
export function privacyFieldEntries(content: PrivacyContent): PrivacyFieldEntry[] {
  const entries: PrivacyFieldEntry[] = [];
  const add = (owner: object | undefined, field: string, parts: string[], path: (string | number)[]) => {
    if (!owner) return;
    const value = Reflect.get(owner, field);
    entries.push({ key: privacyFieldKey(...parts), path, value: typeof value === 'string' || typeof value === 'number' ? value : '', owner, field });
  };
  for (const field of CONTACT_FIELDS) add(content.contact, field, ['contact', field], ['contact', field]);
  add(content.about, 'text', ['about', 'text'], ['about', 'text']);
  const items = (values: CvContentItem[], path: (string | number)[]) => values.forEach((item, index) => {
    for (const field of [...ITEM_TEXT_FIELDS, 'state', 'levelValue']) {
      add(item, field, ['item', item.id, field], [...path, index, field]);
    }
  });
  items(content.education ?? [], ['education']);
  items(content.experience?.jobs ?? [], ['experience', 'jobs']);
  items(content.languages ?? [], ['languages']);
  items(content.hobbies ?? [], ['hobbies']);
  (content.customSections ?? []).forEach((section, index) => {
    for (const field of ['name', 'text']) add(section, field, ['section', section.id, field], ['customSections', index, field]);
    items(section.entries ?? [], ['customSections', index, 'entries']);
  });
  (content.sidebarSections ?? []).forEach((section, index) => {
    add(section, 'name', ['section', section.id, 'name'], ['sidebarSections', index, 'name']);
    items(section.items ?? [], ['sidebarSections', index, 'items']);
  });
  const sections = new Set([...BUILTIN_SECTIONS, ...(content.customSections ?? []).map(({ id }) => id),
    ...(content.sidebarSections ?? []).map(({ id }) => id)]);
  for (const id of sections) add(content.sectionNames, id, ['heading', id], ['sectionNames', id]);
  return entries;
}

function keyParts(key: string): string[] | null {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) && parts.every(part => typeof part === 'string' && part.length > 0 && !RESERVED_KEYS.has(part))
      && JSON.stringify(parts) === key ? parts : null;
  } catch { return null; }
}

/** Validation checks logical fields only; no imported key can traverse an object. */
export function isPrivacyFieldOverride(key: string, value: unknown): value is FieldValue {
  const parts = keyParts(key);
  if (!parts) return false;
  const [scope, id, field] = parts;
  if (scope === 'item' && parts.length === 3) {
    if (field === 'state') return value === '' || value === 'planned' || value === 'ongoing' || value === 'complete';
    if (field === 'levelValue') return value === '' || typeof value === 'number' && Number.isFinite(value);
    return ITEM_TEXT_FIELDS.includes(field as typeof ITEM_TEXT_FIELDS[number]) && typeof value === 'string';
  }
  return typeof value === 'string' && (
    scope === 'contact' && parts.length === 2 && CONTACT_FIELDS.includes(id as typeof CONTACT_FIELDS[number])
    || scope === 'about' && parts.length === 2 && id === 'text'
    || scope === 'section' && parts.length === 3 && (field === 'name' || field === 'text')
    || scope === 'heading' && parts.length === 2
  );
}

export function isPrivacyFieldOverrides(value: unknown): value is PrivacyFieldOverrides {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => isPrivacyFieldOverride(key, entry));
}

/** Drop overrides for deleted fields and values equal to the original values. */
export function normalizePrivacyOverrides(state: CvState): PrivacyFieldOverrides {
  const stored = state.anonymization?.fieldOverrides;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(privacyFieldEntries(state).flatMap(({ key, value }) => {
    const override = Object.hasOwn(stored, key) ? stored[key] : undefined;
    return isPrivacyFieldOverride(key, override) && override !== value ? [[key, override]] : [];
  }));
}

function setField(entry: PrivacyFieldEntry, value: FieldValue) {
  if ((entry.field === 'state' || entry.field === 'levelValue') && value === '') Reflect.deleteProperty(entry.owner, entry.field);
  else Reflect.set(entry.owner, entry.field, value);
}

/** Mutates an isolated output, never the source CV or its local override map. */
export function applyPrivacyOverrides<T extends PrivacyContent>(content: T, state: CvState, {
  existingOnly = false, respectExclusions = false,
}: { existingOnly?: boolean; respectExclusions?: boolean } = {}): T {
  const overrides = normalizePrivacyOverrides(state);
  const excluded = respectExclusions
    ? new Set(privacyFieldEntries(state).filter(entry => isExcludedField(state, entry)).map(entry => entry.key))
    : new Set<string>();
  for (const entry of privacyFieldEntries(content)) {
    if (Object.hasOwn(overrides, entry.key) && !excluded.has(entry.key)
      && (!existingOnly || Object.hasOwn(entry.owner, entry.field))) setField(entry, overrides[entry.key]);
  }
  return content;
}

export function getFieldPrivacyOverride(state: CvState, path: readonly (string | number)[]): FieldValue | undefined {
  const entry = privacyFieldEntries(state).find(entry => entry.path.length === path.length && entry.path.every((part, index) => part === path[index]));
  if (!entry) return undefined;
  const overrides = normalizePrivacyOverrides(state);
  return Object.hasOwn(overrides, entry.key) ? overrides[entry.key] : undefined;
}

/** Show original text until the user provides privacy wording for that field. */
export function createPrivacyEditorState(state: CvState): CvState {
  const draft: CvState = JSON.parse(JSON.stringify(state));
  applyPrivacyOverrides(draft, state);
  draft.disabled = [...new Set([...(state.disabled ?? []), ...(state.anonymization?.excludedSections ?? [])])];
  const excluded = new Set(state.anonymization?.excludedItems ?? []);
  for (const entry of privacyFieldEntries(draft)) {
    if (entry.field === 'name' && 'id' in entry.owner || entry.field === 'title' && 'id' in entry.owner) {
      const id = Reflect.get(entry.owner, 'id');
      if (typeof id === 'string' && excluded.has(id)) Reflect.set(entry.owner, 'hidden', true);
    }
  }
  return draft;
}

/** Copy back privacy settings only; preserve the original structure and content. */
export function applyPrivacyEditorChanges(state: CvState, draft: CvState): boolean {
  const originals = new Map(privacyFieldEntries(state).map(entry => [entry.key, entry]));
  const overrides: PrivacyFieldOverrides = {};
  for (const entry of privacyFieldEntries(draft)) {
    const original = originals.get(entry.key);
    if (original && original.value !== entry.value && isPrivacyFieldOverride(entry.key, entry.value)) overrides[entry.key] = entry.value;
  }
  const originalSections = new Set(state.disabled ?? []);
  const knownSections = new Set([...BUILTIN_SECTIONS, ...(state.customSections ?? []).map(({ id }) => id), ...(state.sidebarSections ?? []).map(({ id }) => id)]);
  const excludedSections = [...new Set((draft.disabled ?? []).filter(id => knownSections.has(id) && !originalSections.has(id)))];
  const excludedItems = new Set<string>();
  for (const entry of privacyFieldEntries(draft)) {
    const original = originals.get(entry.key);
    if (original && 'id' in entry.owner && !Reflect.get(original.owner, 'hidden') && Reflect.get(entry.owner, 'hidden')) {
      const id = Reflect.get(entry.owner, 'id');
      if (typeof id === 'string') excludedItems.add(id);
    }
  }
  const { fieldOverrides: _previous, ...settings } = state.anonymization;
  const previousOverrides = _previous || {};
  const sameOverrides = Object.keys(previousOverrides).length === Object.keys(overrides).length
    && Object.entries(overrides).every(([key, value]) => Object.hasOwn(previousOverrides, key) && previousOverrides[key] === value);
  const sameIds = (previous: string[] | undefined, next: string[]) => (previous || []).length === next.length
    && next.every(id => previous?.includes(id));
  if (sameOverrides && sameIds(settings.excludedSections, excludedSections) && sameIds(settings.excludedItems, [...excludedItems])) return false;
  state.anonymization = { ...settings, excludedSections, excludedItems: [...excludedItems],
    ...(Object.keys(overrides).length ? { fieldOverrides: overrides } : {}) };
  return true;
}

function isExcludedField(state: CvState, entry: PrivacyFieldEntry): boolean {
  const excludedSections = new Set([...(state.disabled ?? []), ...(state.anonymization?.excludedSections ?? [])]);
  const [group, index] = entry.path;
  if (group === 'contact' && index !== 'name' && index !== 'role' && state.design?.contactLayout === 'sidebar'
    && excludedSections.has('sidebar-contact')) return true;
  const section = group === 'contact' ? 'header' : group === 'about' ? 'about'
    : group === 'experience' ? 'jobs' : group === 'customSections' ? state.customSections[Number(index)]?.id
    : group === 'sidebarSections' ? state.sidebarSections[Number(index)]?.id
    : group === 'sectionNames' ? String(index) : String(group);
  if (section && excludedSections.has(section)) return true;
  return entry.key.startsWith('["item",') && (Boolean(Reflect.get(entry.owner, 'hidden'))
    || (state.anonymization?.excludedItems ?? []).includes(Reflect.get(entry.owner, 'id')));
}

/** A public import can revise a proxy without overwriting the private original at that identity. */
export function preservePrivacyOverrides(current: CvContent, incoming: CvContent, state: CvState): CvContent {
  const overrides = normalizePrivacyOverrides(state);
  const originals = new Map(privacyFieldEntries(current).map(entry => [entry.key, entry]));
  const hidden = new Set(privacyFieldEntries(state).filter(entry => isExcludedField(state, entry)).map(entry => entry.key));
  for (const entry of privacyFieldEntries(incoming)) {
    const original = originals.get(entry.key);
    if (!original || hidden.has(entry.key) || !Object.hasOwn(overrides, entry.key)) continue;
    if (entry.value === original.value) delete overrides[entry.key];
    else if (isPrivacyFieldOverride(entry.key, entry.value)) overrides[entry.key] = entry.value;
    if (Object.hasOwn(original.owner, original.field)) setField(entry, original.value);
    else Reflect.deleteProperty(entry.owner, entry.field);
  }
  if (Object.keys(overrides).length) state.anonymization.fieldOverrides = overrides;
  else delete state.anonymization.fieldOverrides;
  return incoming;
}
