import type { CvContent, CvContentItem, CvState, FieldPrivacyType } from '../../cv/types';
import { FIELD_PRIVACY_TYPES } from '../../cv/types';

const LABELS: Record<FieldPrivacyType, string> = {
  company: 'Company', institution: 'Institution', place: 'Place', dates: 'Date',
};
const fieldType = (key: string): FieldPrivacyType => (key === 'sub' ? 'institution'
  : key === 'start' || key === 'end' ? 'dates' : key) as FieldPrivacyType;
const fieldKeys = (field: FieldPrivacyType) => field === 'institution' ? ['institution', 'sub'] as const
  : field === 'dates' ? ['start', 'end'] as const : [field];

export function normalizeProxyFields(value: unknown): FieldPrivacyType[] {
  return FIELD_PRIVACY_TYPES.filter(field => Array.isArray(value)
    && (value.includes(field) || field === 'dates' && (value.includes('start') || value.includes('end'))));
}

export function isProxyFieldEnabled(state: CvState, key: string): boolean {
  return normalizeProxyFields(state.anonymization?.proxyFields).includes(fieldType(key));
}

function allItems(content: CvContent | CvState): CvContentItem[] {
  return [content.education ?? [], content.experience?.jobs ?? [], content.languages ?? [], content.hobbies ?? [],
    ...(content.customSections ?? []).map(section => section.entries ?? []),
    ...(content.sidebarSections ?? []).map(section => section.items ?? [])].flat();
}

/** Also protect readable labels and destinations when a selected field contains Markdown. */
function originalValues(value: string): string[] {
  const values = new Set([value, value.trim()]);
  for (const match of value.matchAll(/\[([^\]]*)\]\(([^\s)]+)\)/g)) {
    values.add(match[1].trim()); values.add(match[2].trim());
  }
  let plain = value.replaceAll('**', '');
  plain = plain.replace(/\[([^\]]*)\]\(([^\s)]+)\)/g, (_link, label: string, href: string) => {
    values.add(label.trim()); values.add(href.trim()); return label;
  });
  values.add(plain.trim());
  return [...values].filter(value => value.trim().length > 0);
}

export interface FieldPrivacyReplacement { field: FieldPrivacyType; value: string; proxy: string }

/** Build once per output so equal originals receive the same proxy everywhere. */
export function createFieldPrivacy(state: CvState) {
  const fields = new Set(normalizeProxyFields(state.anonymization?.proxyFields));
  const replacements: FieldPrivacyReplacement[] = [];
  const byField = new Map<FieldPrivacyType, Map<string, string>>();
  for (const field of fields) {
    const values = new Map<string, string>();
    byField.set(field, values);
    for (const item of allItems(state)) {
      for (const key of fieldKeys(field)) {
        const value = item[key];
        if (!value?.trim()) continue;
        const normalized = value.trim().toLocaleLowerCase();
        if (values.has(normalized)) continue;
        const proxy = `${LABELS[field]} ${values.size + 1}`;
        values.set(normalized, proxy);
        replacements.push(...originalValues(value).map(original => ({ field, value: original, proxy })));
      }
    }
  }
  const unique = new Map<string, FieldPrivacyReplacement>();
  for (const replacement of replacements) {
    const key = replacement.value.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, replacement);
  }
  const ordered = [...unique.values()].sort((a, b) => b.value.length - a.value.length);
  const matchers = ordered.map(({ value, proxy }) => ({
    pattern: new RegExp(`^(?:${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})$`, 'iu'), proxy,
  }));
  // Unicode case-insensitive matches (for example σ/ς) need not have the
  // same lowercase spelling. Resolve them with the same matching semantics.
  const matchedProxy = (value: string) => unique.get(value.toLocaleLowerCase())?.proxy
    ?? matchers.find(({ pattern }) => pattern.test(value))?.proxy ?? '{{CONFIDENTIAL}}';
  const pattern = ordered.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${ordered.map(({ value }) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
  const proxyFor = (field: FieldPrivacyType, value: string) => byField.get(field)?.get(value.trim().toLocaleLowerCase()) ?? value;
  const redactText = (text: string): string => {
    if (!pattern) return text;
    // Remove a link destination whenever its label or destination identifies a
    // protected value. Each replacement happens once, never inside a new proxy.
    return text.split(/(\[[^\]]*\]\([^\s)]+\)|\{\{[A-Z_0-9]+\}\})/g).map(part => {
      if (/^\{\{[A-Z_0-9]+\}\}$/.test(part)) return part;
      const link = part.match(/^\[([^\]]*)\]\(([^\s)]+)\)$/);
      if (link) {
        pattern.lastIndex = 0;
        const match = pattern.exec(link[1] + ' ' + link[2]);
        if (match) return matchedProxy(match[0]);
      }
      return part.replace(pattern, matchedProxy);
    }).join('');
  };
  return { fields, replacements, proxyFor, redactText };
}

/** Originals are only used locally by request builders and never returned in an output projection. */
export function selectedProxyFieldValues(state: CvState): string[] {
  return [...new Set(createFieldPrivacy(state).replacements.map(({ value }) => value))];
}

/** Mutates an isolated preview or content projection, preserving IDs, flags and numeric/enum fields. */
export function anonymizeFieldContent<T extends CvContent | CvState>(content: T, state: CvState): T {
  const privacy = createFieldPrivacy(state);
  if (!privacy.fields.size) return content;
  for (const item of allItems(content)) {
    for (const [key, value] of Object.entries(item)) {
      if (key === 'id' || key === 'state' || typeof value !== 'string') continue;
      Reflect.set(item, key, privacy.fields.has(fieldType(key))
        ? privacy.proxyFor(fieldType(key), value) : privacy.redactText(value));
    }
  }
  if (content.about) content.about.text = privacy.redactText(content.about.text);
  for (const section of content.customSections ?? []) {
    section.name = privacy.redactText(section.name);
    if (section.text !== undefined) section.text = privacy.redactText(section.text);
  }
  for (const section of content.sidebarSections ?? []) section.name = privacy.redactText(section.name);
  if (content.sectionNames) content.sectionNames = Object.fromEntries(Object.entries(content.sectionNames)
    .map(([key, value]) => [key, privacy.redactText(value)]));
  return content;
}

/** IDs bind imported public fields to their local originals, even after a section move. */
export function preservePrivateFields(current: CvContent, incoming: CvContent, state: CvState): CvContent {
  const fields = normalizeProxyFields(state.anonymization?.proxyFields);
  if (!fields.length) return incoming;
  const projected = anonymizeFieldContent(structuredClone(current), state);
  // Restore untouched exported values at their original ID/path. Keep edited
  // prose as written; reverse-matching generic proxies could replace public wording.
  function restoreUnchanged(original: object, publicValue: object, imported: object) {
    for (const [key, value] of Object.entries(original)) {
      if (typeof value === 'string' && Reflect.get(publicValue, key) !== value
        && Reflect.get(imported, key) === Reflect.get(publicValue, key)) Reflect.set(imported, key, value);
    }
  }
  const previous = new Map(allItems(current).map(item => [item.id, item]));
  const publicItems = new Map(allItems(projected).map(item => [item.id, item]));
  for (const item of allItems(incoming)) {
    const original = previous.get(item.id);
    if (!original) continue;
    restoreUnchanged(original, publicItems.get(item.id)!, item);
    for (const field of fields.flatMap(fieldKeys)) {
      if (Object.hasOwn(original, field)) Reflect.set(item, field, original[field]);
      else delete item[field];
    }
  }
  restoreUnchanged(current.about, projected.about, incoming.about);
  restoreUnchanged(current.sectionNames, projected.sectionNames, incoming.sectionNames);
  for (const key of ['customSections', 'sidebarSections'] as const) {
    const previousSections = new Map(current[key].map(section => [section.id, section]));
    const publicSections = new Map(projected[key].map(section => [section.id, section]));
    for (const section of incoming[key]) {
      const original = previousSections.get(section.id);
      if (original) restoreUnchanged(original, publicSections.get(section.id)!, section);
    }
  }
  return incoming;
}
