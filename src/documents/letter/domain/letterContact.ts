import type { Contact, ContactField, CvState } from '../../cv/types';
import { CONTACT_FIELDS } from '../../cv/types';
import { DEFAULT_DESIGN } from '../../cv/defaults';
import { isRecord } from '../../cv/domain/cvStateValidation';

/** Last readable source header, kept locally so a removed library entry cannot
 * bring deleted contact details back from the original application snapshot. */
export interface LetterHeaderSource {
  sourceCvId: string;
  contact: Contact;
  fields: ContactField[];
  hidden: boolean;
}

const selectedFields = (state: CvState) => state.design.letterContactFields ?? DEFAULT_DESIGN.letterContactFields;

export function captureLetterHeaderSource(sourceCvId: string, state: CvState): LetterHeaderSource {
  return { sourceCvId, contact: { ...state.contact }, fields: CONTACT_FIELDS.filter(field => selectedFields(state).includes(field)), hidden: state.disabled.includes('header') };
}

export function readLetterHeaderSource(value: unknown): LetterHeaderSource {
  const contact = isRecord(value) && isRecord(value.contact) ? value.contact : null;
  if (!isRecord(value) || typeof value.sourceCvId !== 'string' || !value.sourceCvId
    || !contact || !CONTACT_FIELDS.every(field => typeof contact[field] === 'string')
    || !Array.isArray(value.fields) || !value.fields.every(field => CONTACT_FIELDS.includes(field))
    || typeof value.hidden !== 'boolean') throw new Error('The saved motivation letter header is invalid.');
  const source = value as unknown as LetterHeaderSource;
  return { sourceCvId: source.sourceCvId, contact: { ...source.contact }, fields: [...source.fields], hidden: source.hidden };
}

/** Inherit shared contact changes while retaining per-field application edits.
 * This is a letter render state only: neither CV nor historical sources change. */
export function resolveApplicationLetterState(state: CvState, base: CvState, source?: LetterHeaderSource): CvState {
  if (!source) return state;
  const contact = { ...state.contact };
  for (const field of CONTACT_FIELDS) {
    if (state.contact[field] === base.contact[field]) contact[field] = source.contact[field];
  }
  const localFields = selectedFields(state), baseFields = selectedFields(base);
  const fields = CONTACT_FIELDS.filter(field => localFields.includes(field) !== baseFields.includes(field)
    ? localFields.includes(field) : source.fields.includes(field));
  const localHidden = state.disabled.includes('header');
  const hidden = localHidden !== base.disabled.includes('header') ? localHidden : source.hidden;
  return applyLetterHeader(state, { contact, fields, hidden });
}

/** Historical letter wording still uses the current sender information. */
export function applyLetterHeader(state: CvState, header: Pick<LetterHeaderSource, 'contact' | 'fields' | 'hidden'>): CvState {
  const sameFields = CONTACT_FIELDS.every(field => selectedFields(state).includes(field) === header.fields.includes(field));
  const sameContact = CONTACT_FIELDS.every(field => state.contact[field] === header.contact[field]);
  if (sameContact && sameFields && state.disabled.includes('header') === header.hidden) return state;
  return { ...state, contact: { ...header.contact }, design: { ...state.design, letterContactFields: [...header.fields] },
    disabled: [...state.disabled.filter(section => section !== 'header'), ...(header.hidden ? ['header'] : [])] };
}

/** Project existing contact details into the letter without changing CV content. */
export function resolveLetterContact(contact: Contact, selected?: readonly ContactField[]): Contact {
  const fields = new Set(selected ?? DEFAULT_DESIGN.letterContactFields);
  const resolved = { ...contact };
  for (const field of CONTACT_FIELDS) {
    if (!fields.has(field)) resolved[field] = '';
  }
  return resolved;
}
