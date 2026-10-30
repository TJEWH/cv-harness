import type { CvState, FieldPrivacyType } from '../../cv/types';
import type { PrivacyFieldEntry } from './privacyOverrides';
import { normalizeProxyFields } from './fieldPrivacy';

export type AutomaticPrivacyMask = 'header' | FieldPrivacyType;

/** Directly controlled fields are locked; repeated values inside editable prose are not. */
export function automaticMaskForField(state: CvState, entry: PrivacyFieldEntry): AutomaticPrivacyMask | undefined {
  if (entry.path[0] === 'contact') return 'header';
  if (!entry.key.startsWith('["item",')) return undefined;
  const field = entry.field === 'sub' ? 'institution'
    : entry.field === 'start' || entry.field === 'end' ? 'dates'
    : entry.field;
  return normalizeProxyFields(state.anonymization?.proxyFields).find(selected => selected === field);
}
