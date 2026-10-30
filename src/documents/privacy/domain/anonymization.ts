import type { CvState, CvItem, Contact } from '../../cv/types';
import { SAMPLE_CONTACT } from '../../cv/defaults';
import { anonymizeFieldContent, normalizeProxyFields } from './fieldPrivacy';
import { applyPrivacyOverrides, normalizePrivacyOverrides } from './privacyOverrides';
const BUILT_IN_BODY_SECTION_KEYS = ['about', 'education', 'jobs'];
const BUILT_IN_SIDEBAR_SECTION_KEYS = ['languages', 'hobbies'];

export { SAMPLE_CONTACT as ANONYMIZED_CONTACT } from '../../cv/defaults';

function uniqueKnownIds(value: unknown, knownIds: Set<string | undefined>) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((id) => (
    typeof id === 'string' && knownIds.has(id) && !seen.has(id) && (seen.add(id), true)
  ));
}

function sectionKeys(state: CvState) {
  return [
    'header', 'sidebar-contact',
    ...BUILT_IN_BODY_SECTION_KEYS,
    ...BUILT_IN_SIDEBAR_SECTION_KEYS,
    ...(state.customSections || []).map((section) => section.id),
    ...(state.sidebarSections || []).map((section) => section.id),
  ];
}

function itemIds(state: CvState) {
  return [
    ...(state.education || []).map((item) => item.id),
    ...(state.experience?.jobs || []).map((item) => item.id),
    ...(state.languages || []).map((item) => item.id),
    ...(state.hobbies || []).map((item) => item.id),
    ...(state.customSections || []).flatMap((section) => (section.entries || []).map((item) => item.id)),
    ...(state.sidebarSections || []).flatMap((section) => (section.items || []).map((item) => item.id)),
  ];
}

export function normalizeAnonymizationState(state: CvState) {
  const settings = state.anonymization || { excludedSections: [], excludedItems: [] };
  const fieldOverrides = normalizePrivacyOverrides(state);
  state.anonymization = {
    excludedSections: uniqueKnownIds(settings.excludedSections, new Set(sectionKeys(state))),
    excludedItems: uniqueKnownIds(settings.excludedItems, new Set(itemIds(state))),
    ...(settings.proxyFields !== undefined ? { proxyFields: normalizeProxyFields(settings.proxyFields) } : {}),
    ...(Object.keys(fieldOverrides).length ? { fieldOverrides } : {}),
  };
}

function clonedState(state: CvState): CvState {
  return JSON.parse(JSON.stringify(state));
}

function hideMatchingItems(items: CvItem[], excludedItems: Set<string>) {
  return (items || []).map((item) => ({
    ...item,
    hidden: Boolean(item.hidden) || excludedItems.has(item.id),
  }));
}

export function createAnonymizedContact(contact: Partial<Contact> = {}): Contact {
  return Object.fromEntries(Object.entries(SAMPLE_CONTACT).map(([key, dummyValue]) => [
    key, contact?.[key as keyof Contact] ? dummyValue : '',
  ])) as unknown as Contact;
}

/**
 * Produce the isolated render state used by anonymous preview and export.
 * The editor state is never modified.
 */
export function createAnonymizedState(state: CvState): CvState {
  const anonymized = clonedState(state || {});
  const settings = state?.anonymization || { excludedSections: [], excludedItems: [] };
  const excludedSections = new Set(settings.excludedSections || []);
  const excludedItems = new Set(settings.excludedItems || []);

  anonymized.contact = createAnonymizedContact(state?.contact);
  anonymized.disabled = [...new Set([...(anonymized.disabled || []), ...excludedSections])];
  anonymized.education = hideMatchingItems(anonymized.education, excludedItems);
  anonymized.experience ||= { jobs: [] };
  anonymized.experience.jobs = hideMatchingItems(anonymized.experience.jobs, excludedItems);
  anonymized.languages = hideMatchingItems(anonymized.languages, excludedItems);
  anonymized.hobbies = hideMatchingItems(anonymized.hobbies, excludedItems);
  anonymized.customSections = (anonymized.customSections || []).map((section) => ({
    ...section,
    entries: hideMatchingItems(section.entries, excludedItems),
  }));
  anonymized.sidebarSections = (anonymized.sidebarSections || []).map((section) => ({
    ...section,
    items: hideMatchingItems(section.items, excludedItems),
  }));

  return applyPrivacyOverrides(anonymizeFieldContent(anonymized, state), state);
}
