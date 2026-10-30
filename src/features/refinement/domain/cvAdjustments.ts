/** Shared privacy-field projection and reconstruction used by structured CV refinement. */
import type { CvItem, CvState } from '../../../documents/cv/types';
import type { CvAdjustmentRequest, CvAdjustmentResponse, LocalCvAdjustmentRequest } from '../cvAdjustmentTypes';
import { SAMPLE_CONTACT } from '../../../documents/cv/defaults';
import { readCvState } from '../../../documents/cv/domain/cvStateValidation';
import { redactKnownIdentityText } from '../../../documents/privacy/domain/identityRedaction';
import { redactFieldOriginals } from './refinementPrivacy';
import { isProxyFieldEnabled, selectedProxyFieldValues } from '../../../documents/privacy/domain/fieldPrivacy';
import { getFieldPrivacyOverride } from '../../../documents/privacy/domain/privacyOverrides';
import { isOpportunityInternalFact, isOpportunityInternalField } from '../../opportunities/domain/opportunityPresentation';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_JSON_LENGTH = 1048576;
const TOKEN = /\{\{PRIVATE_[1-9][0-9]*\}\}/g;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const EDITABLE_ITEM_KEYS = ['name', 'title', 'company', 'institution', 'sub', 'place', 'bullets', 'desc', 'thesis', 'coursesText', 'level'] as const;
const CONTACT_KEYS = ['name', 'email', 'phone', 'website', 'linkedin', 'github'] as const;
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function boundedText(value: unknown, max = 20000): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length > MAX_JSON_LENGTH) throw new Error('The adjustment response is too large.');
  try { return JSON.parse(value); } catch { throw new Error('Paste the returned JSON object without Markdown fences.'); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function identityPatterns(state: CvState): RegExp[] {
  return [state.contact, SAMPLE_CONTACT].flatMap((contact) => CONTACT_KEYS.flatMap((key) => {
    const value = contact[key]?.trim();
    if (!value) return [];
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [{ length: value.length, pattern: new RegExp(key === 'name' ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped, 'giu') }];
  })).sort((a, b) => b.length - a.length).map(({ pattern }) => pattern);
}

/** Project only editable, visible text. Structural IDs and all private bindings stay on this device. */
export function prepareCvAdjustment(input: {
  state: CvState; variantId: string; instructions?: string;
  opportunity?: Record<string, unknown>; applicationId?: string | null;
}): LocalCvAdjustmentRequest {
  const state = clone(readCvState(input.state));
  if (!input.variantId || typeof input.variantId !== 'string') throw new Error('Select a saved CV variant.');
  if (!boundedText(input.instructions ?? '')) throw new Error('Adjustment instructions are too long.');
  const request: CvAdjustmentRequest = { schemaVersion: 1, requestId: crypto.randomUUID(), fields: [], opportunity: {}, instructions: '' };
  const bindings: LocalCvAdjustmentRequest['bindings'] = [];
  const selectedValues = selectedProxyFieldValues(state).sort((a, b) => b.length - a.length);
  const patterns = identityPatterns(state);
  const selectedPattern = selectedValues.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${selectedValues.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
  const privateParts = new RegExp(`${selectedPattern ? `${selectedPattern.source}|` : ''}`
    + /\[([^\]]*)\]\(([^\s)]+)\)|\{\{[^{}]*\}\}/.source, 'giu');
  let tokenIndex = 0;
  function mask(text: string, wholeField = false, manualReplacement = false): { text: string; tokens: Record<string, string> } {
    const tokens: Record<string, string> = {};
    const hide = (value: string) => { const token = `{{PRIVATE_${++tokenIndex}}}`; tokens[token] = value; return token; };
    if (wholeField && text.trim()) return { text: hide(text), tokens };
    // One pass over the original text also prevents literal PRIVATE_n text
    // colliding with tokens already generated for an earlier private link.
    let safe = text.replace(manualReplacement ? /\[([^\]]*)\]\(([^\s)]+)\)|\{\{[^{}]*\}\}/gu : privateParts, (part: string, label?: string, href?: string) => {
      if (label !== undefined && href !== undefined) {
        if (selectedPattern) selectedPattern.lastIndex = 0;
        return /\{\{/.test(label + href) || !manualReplacement && (patterns.some((pattern) => { pattern.lastIndex = 0; return pattern.test(href); })
          || selectedPattern?.test(part)) ? hide(part) : part;
      }
      return hide(part);
    });
    // Existing literal placeholders are private too, so generated tokens are unambiguous.
    const outsideTokens = (transform: (part: string) => string) => {
      safe = safe.split(/(\{\{PRIVATE_[1-9][0-9]*\}\})/g).map((part) => Object.hasOwn(tokens, part) ? part : transform(part)).join('');
    };
    if (!manualReplacement) for (const pattern of patterns) outsideTokens((part) => part.replace(pattern, hide));
    return { text: safe, tokens };
  }
  function add(path: (string | number)[], label: string, value: unknown, wholeField = false) {
    const override = getFieldPrivacyOverride(state, path);
    const source = typeof override === 'string' ? override : value;
    if (typeof source !== 'string') return;
    if (!boundedText(source)) throw new Error('An editable CV field exceeds the adjustment limit. Shorten it in CV Studio first.');
    const id = `field-${request.fields.length + 1}`;
    const projected = mask(source, override === undefined && wholeField, override !== undefined);
    request.fields.push({ id, label: override === undefined ? label : `${label} [privacy replacement; comments only]`, text: projected.text });
    bindings.push({ fieldId: id, path, tokens: projected.tokens });
  }
  const excluded = new Set([...state.disabled, ...state.anonymization.excludedSections]);
  const excludedItems = new Set(state.anonymization.excludedItems);
  function items(values: CvItem[], path: (string | number)[], label: string) {
    values.forEach((item, index) => {
      if (item.hidden || excludedItems.has(item.id)) return;
      for (const key of EDITABLE_ITEM_KEYS) add([...path, index, key], `${label} ${index + 1}: ${key}`, item[key], isProxyFieldEnabled(state, key));
    });
  }
  if (!excluded.has('header')) add(['contact', 'role'], 'Professional headline', state.contact.role);
  if (!excluded.has('about')) add(['about', 'text'], 'Profile', state.about.text);
  for (const [id, values, path, label] of [
    ['education', state.education, ['education'], 'Education'], ['jobs', state.experience.jobs, ['experience', 'jobs'], 'Experience'],
    ['languages', state.languages, ['languages'], 'Language'], ['hobbies', state.hobbies, ['hobbies'], 'Interest'],
  ] as const) if (!excluded.has(id)) items(values as CvItem[], [...path], label);
  state.customSections.forEach((section, index) => {
    if (excluded.has(section.id)) return;
    add(['customSections', index, 'name'], `Body section ${index + 1}: heading`, section.name);
    if (section.entryMode === 'textarea') add(['customSections', index, 'text'], `Body section ${index + 1}: text`, section.text);
    else items(section.entries, ['customSections', index, 'entries'], `Body section ${index + 1}`);
  });
  state.sidebarSections.forEach((section, index) => {
    if (excluded.has(section.id)) return;
    add(['sidebarSections', index, 'name'], `Sidebar section ${index + 1}: heading`, section.name);
    items(section.items, ['sidebarSections', index, 'items'], `Sidebar section ${index + 1}`);
  });
  const sectionIds = new Set(['about', 'education', 'jobs', 'languages', 'hobbies', ...state.customSections.map(({ id }) => id), ...state.sidebarSections.map(({ id }) => id)]);
  for (const id of new Set([...Object.keys(state.sectionNames), ...sectionIds])) if (sectionIds.has(id) && !excluded.has(id) && !RESERVED.has(id)) add(['sectionNames', id], 'Section heading', state.sectionNames[id]);
  const cleanContext = (value: unknown, depth = 0): unknown => {
    if (depth > 12) throw new Error('Opportunity context is too deeply nested.');
    if (typeof value === 'string') return redactKnownIdentityText(redactFieldOriginals(value, state), [state.contact, SAMPLE_CONTACT]);
    if (Array.isArray(value)) return value.filter(entry => !isOpportunityInternalFact(entry)).map((entry) => cleanContext(entry, depth + 1));
    if (record(value)) return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !RESERVED.has(key) && !isOpportunityInternalField(key) && !isOpportunityInternalFact(entry)).map(([key, entry]) => [
      String(cleanContext(key, depth + 1)), cleanContext(entry, depth + 1),
    ]));
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    throw new Error('Opportunity context must contain only JSON data.');
  };
  request.instructions = cleanContext(input.instructions ?? '') as string;
  request.opportunity = cleanContext(input.opportunity ?? {}) as Record<string, unknown>;
  validateRequest(request);
  return { sourceVariantId: input.variantId, baselineState: state, publicRequest: request, bindings };
}

function validateRequest(value: unknown): CvAdjustmentRequest {
  if (!exact(value, ['schemaVersion', 'requestId', 'fields', 'opportunity', 'instructions']) || value.schemaVersion !== 1
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId) || !Array.isArray(value.fields)
    || value.fields.length > 1000 || !record(value.opportunity) || !boundedText(value.instructions)
    || JSON.stringify(value).length > MAX_JSON_LENGTH) throw new Error('Invalid CV adjustment request.');
  const ids = new Set<string>();
  for (const field of value.fields) {
    if (!exact(field, ['id', 'label', 'text']) || typeof field.id !== 'string' || !/^field-[1-9][0-9]*$/.test(field.id)
      || ids.has(field.id) || !boundedText(field.label, 200) || !boundedText(field.text)) throw new Error('Invalid CV adjustment field.');
    ids.add(field.id);
  }
  return value as unknown as CvAdjustmentRequest;
}
export function parseCvAdjustmentResponse(value: unknown): CvAdjustmentResponse {
  const parsed = parseJson(value);
  if (!exact(parsed, ['schemaVersion', 'requestId', 'edits']) || parsed.schemaVersion !== 1
    || typeof parsed.requestId !== 'string' || !UUID.test(parsed.requestId) || !Array.isArray(parsed.edits)
    || parsed.edits.length > 1000 || JSON.stringify(parsed).length > MAX_JSON_LENGTH) throw new Error('Invalid CV adjustment response.');
  const ids = new Set<string>();
  for (const edit of parsed.edits) {
    if (!exact(edit, ['fieldId', 'text']) || typeof edit.fieldId !== 'string' || !/^field-[1-9][0-9]*$/.test(edit.fieldId)
      || ids.has(edit.fieldId) || !boundedText(edit.text)) throw new Error('Invalid or duplicate CV adjustment field.');
    ids.add(edit.fieldId);
  }
  return parsed as unknown as CvAdjustmentResponse;
}
function links(text: string): string[] {
  return [...text.matchAll(/\]\(([^\s)]+)\)|(?:https?:\/\/|mailto:|tel:|javascript:|data:)[^\s<>)]+/gi)].map((match) => match[1] ?? match[0]).sort();
}
/** Legacy wording edits have no structural move operation: tokens must stay on their source line. */
export function validatePrivateTokenLines(original: string, replacement: string) {
  const attachments = (value: string) => value.split(/\r\n|\r|\n/).flatMap((line, index) => (line.match(TOKEN) || []).map(token => [index, token]));
  if (canonical(attachments(original)) !== canonical(attachments(replacement))) throw new Error('Private tokens must remain attached to their original bullet or content line. Use a structured operation to move a complete bullet.');
}
/** Check saved private mappings against their exact original; missing maps cannot be silently regenerated. */
export function validateLocalCvAdjustment(local: LocalCvAdjustmentRequest): LocalCvAdjustmentRequest {
  if (!record(local) || !record(local.baselineState)) throw new Error('The original local CV source snapshot is unavailable. Restore it or prepare a new request.');
  readCvState(local.baselineState);
  const request = validateRequest(local.publicRequest);
  if (!Array.isArray(local.bindings)) throw new Error('The local private reconstruction mappings are unavailable. Restore them or prepare a new request.');
  // Derive the allowed paths independently, then require the stored maps to agree.
  const rebuilt = prepareCvAdjustment({ state: local.baselineState, variantId: local.sourceVariantId });
  if (canonical(rebuilt.publicRequest.fields) !== canonical(request.fields)) throw new Error('The local privacy snapshot is inconsistent. Prepare it again.');
  if (canonical(local.bindings) !== canonical(rebuilt.bindings)) throw new Error('The local private reconstruction mappings are missing or inconsistent. Restore them or prepare a new request.');
  return rebuilt;
}
/** Reject stale baselines and structural/identity edits before changing a fresh local clone. */
export function reconstructCvAdjustment(local: LocalCvAdjustmentRequest, response: unknown, currentState: CvState) {
  readCvState(currentState);
  const rebuilt = validateLocalCvAdjustment(local);
  const request = validateRequest(local.publicRequest);
  const returned = parseCvAdjustmentResponse(response);
  if (returned.requestId !== request.requestId) throw new Error('This response belongs to another CV adjustment request.');
  if (canonical(currentState) !== canonical(local.baselineState)) throw new Error('The CV changed after this snapshot. Prepare a new request before applying adjustments.');
  const result = clone(currentState);
  let changedFieldCount = 0;
  for (const edit of returned.edits) {
    const field = request.fields.find(({ id }) => id === edit.fieldId);
    const binding = rebuilt.bindings.find(({ fieldId }) => fieldId === edit.fieldId);
    if (!field || !binding) throw new Error('The response edits an unavailable CV field.');
    if (edit.text === field.text) continue;
    if (getFieldPrivacyOverride(currentState, binding.path) !== undefined) throw new Error('Privacy replacement fields support comments only. Edit their replacement in CV Studio Privacy.');
    const originalTokens = field.text.match(TOKEN) ?? [];
    const nextTokens = edit.text.match(TOKEN) ?? [];
    if (JSON.stringify(originalTokens) !== JSON.stringify(nextTokens) || /\{\{|\}\}/.test(edit.text.replace(TOKEN, ''))) {
      throw new Error('Private placeholders must stay intact, once each and in the original order.');
    }
    if (JSON.stringify(links(edit.text)) !== JSON.stringify(links(field.text))
      || /!\[|<\/?[a-z]|\]\([^)]*\{\{/i.test(edit.text)) throw new Error('CV adjustments cannot add links, images or HTML.');
    validatePrivateTokenLines(field.text, edit.text);
    const restored = edit.text.replace(TOKEN, (token) => {
      const original = binding.tokens[token];
      if (original === undefined) throw new Error('A private reconstruction token is unavailable.');
      return original;
    });
    let object: unknown = result;
    for (const key of binding.path.slice(0, -1)) object = Reflect.get(object as object, key);
    const key = binding.path.at(-1)!;
    if (Reflect.get(object as object, key) !== restored) { Reflect.set(object as object, key, restored); changedFieldCount++; }
  }
  readCvState(result);
  return { state: result, changed: changedFieldCount > 0, changedFieldCount };
}
