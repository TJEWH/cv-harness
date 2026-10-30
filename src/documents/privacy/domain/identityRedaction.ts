import type { Contact } from '../../cv/types';

export const IDENTITY_PLACEHOLDERS: Record<keyof Contact, string> = {
  name: '{{APPLICANT_NAME}}', location: '{{APPLICANT_LOCATION}}', role: '{{APPLICANT_ROLE}}',
  email: '{{APPLICANT_EMAIL}}', phone: '{{APPLICANT_PHONE}}', website: '{{APPLICANT_WEBSITE}}',
  linkedin: '{{APPLICANT_LINKEDIN}}', github: '{{APPLICANT_GITHUB}}',
};

const IDENTITY_KEYS = ['name', 'email', 'phone', 'website', 'linkedin', 'github'] as const;
const placeholder = /^\{\{[A-Z_]+\}\}$/;
const STRUCTURAL_KEYS = new Set(['id', 'state', 'entryMode', 'levelType', 'fields']);

/**
 * Replace known names and contact destinations, preserving roles and cities as
 * professional evidence. Use CV Studio Privacy to replace other identifying prose.
 */
export function redactKnownIdentityText(text: string, contacts: readonly Partial<Contact>[]): string {
  const replacements = contacts.flatMap((contact) => IDENTITY_KEYS.flatMap((key) => {
    const value = contact[key]?.trim();
    if (!value) return [];
    const literal = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A short name such as "Ann" must not remove part of "annual". Unicode
    // letters make the same boundary rule work for non-Latin applicant names.
    const pattern = key === 'name' ? `(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])` : literal;
    return [{ value, pattern, replacement: IDENTITY_PLACEHOLDERS[key] }];
  })).sort((a, b) => b.value.length - a.value.length);
  let result = text;
  for (const { pattern, replacement } of replacements) {
    const expression = new RegExp(pattern, 'giu');
    result = result.split(/(\{\{[A-Z_]+\}\})/g).map((part) => placeholder.test(part) ? part : part.replace(expression, replacement)).join('');
  }
  return result;
}

/** Work on an isolated JSON projection and leave internal item references intact. */
export function redactKnownIdentityValues<T>(value: T, contacts: readonly Partial<Contact>[]): T {
  if (typeof value === 'string') return redactKnownIdentityText(value, contacts) as T;
  if (Array.isArray(value)) return value.map((entry) => redactKnownIdentityValues(entry, contacts)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, STRUCTURAL_KEYS.has(key) ? entry : redactKnownIdentityValues(entry, contacts)])) as T;
  return value;
}
