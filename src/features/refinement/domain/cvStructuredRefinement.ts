import type { CvAdjustmentField, LocalCvAdjustmentRequest } from '../cvAdjustmentTypes';
import type { CvComment, CvOperation, CvStructure, CvStructureBindings } from '../cvStructuredTypes';
import type { CvItem, CvState } from '../../../documents/cv/types';
import { reconstructCvAdjustment, validateLocalCvAdjustment } from './cvAdjustments';
import { readCvState } from '../../../documents/cv/domain/cvStateValidation';
import { getFieldPrivacyOverride } from '../../../documents/privacy/domain/privacyOverrides';

const TOKEN = /\{\{PRIVATE_[1-9][0-9]*\}\}/g;
const MAX_ITEMS = 1000;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const id = (value: unknown, prefix: string): value is string => typeof value === 'string' && new RegExp(`^${prefix}-[1-9][0-9]*$`).test(value);
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function same(left: unknown, right: unknown) { return canonical(left) === canonical(right); }
// Keep the shared UTF-16 bound without creating an invalid JSON surrogate at the cutoff.
function truncateLabel(value: string) { return value.slice(0, 200).replace(/[\uD800-\uDBFF]$/, ''); }
function pathKey(path: (string | number)[]) { return JSON.stringify(path); }
function atPath(object: unknown, path: (string | number)[]): unknown { return path.reduce((value: unknown, part) => Reflect.get(value as object, part), object); }
function setPath(object: object, path: (string | number)[], value: unknown) {
  Reflect.set(atPath(object, path.slice(0, -1)) as object, path.at(-1)!, value);
}
function links(value: string): string[] {
  return [...value.matchAll(/\]\(([^\s)]+)\)|(?:https?:\/\/|mailto:|tel:|javascript:|data:)[^\s<>)]+/gi)].map(match => match[1] ?? match[0]).sort();
}

/** Allow structural edits to plain prose; keep complex Markdown available for comments. */
function plainProse(value: string): boolean {
  const withoutLinks = value.replace(/\[[^\]\r\n]+\]\([^\s)]+\)/g, 'LINK').replace(TOKEN, 'PRIVATE');
  return !!value.trim() && !/[^\S \t\r\n]/u.test(value) && !/\r(?!\n)/.test(value)
    && !/(?:^|\n)[ \t]*(?:[-*+•][ \t]|[0-9]+[.)][ \t]|[#>]|```|~~~)/.test(value)
    && !/[`*_~\[\]\\]|<\/?[a-z]|!\[/i.test(withoutLinks);
}
interface ParsedBullets { lines: { prefix: string; text: string; suffix: string }[]; separators: string[]; trailing: string }
function parseFlatBullets(value: string): ParsedBullets | null {
  if (!value.trim() || /\r(?!\n)/.test(value)) return null;
  const pieces = value.split(/(\r\n|\n)/);
  const lines: string[] = []; const separators: string[] = [];
  for (let index = 0; index < pieces.length; index += 2) {
    lines.push(pieces[index]);
    if (index + 1 < pieces.length) separators.push(pieces[index + 1]);
  }
  let trailing = '';
  if (lines.at(-1) === '' && separators.length) { lines.pop(); trailing = separators.pop()!; }
  if (!lines.length || lines.some(line => !line.trim() || /^[ \t]/.test(line))
    || new Set([...separators, ...(trailing ? [trailing] : [])]).size > 1) return null;
  const marked = lines[0].match(/^([-*+•])([ \t]+)/);
  const result: ParsedBullets['lines'] = [];
  for (const line of lines) {
    const marker = line.match(/^([-*+•])([ \t]+)/);
    if (Boolean(marker) !== Boolean(marked) || (marker && marker[1] !== marked![1])) return null;
    const prefix = marker?.[0] ?? '';
    const content = line.slice(prefix.length);
    const suffix = content.match(/[ \t]*$/)![0];
    const text = content.slice(0, content.length - suffix.length);
    if (!plainProse(text) || /\n|\r/.test(text)) return null;
    result.push({ prefix, text, suffix });
  }
  return { lines: result, separators, trailing };
}

/** Verify private maps and derive capabilities only from the exact local source. */
export function prepareCvStructure(localCv: LocalCvAdjustmentRequest, options: { titleTypos?: boolean } = {}): { structure: CvStructure; bindings: CvStructureBindings } {
  const rebuilt = validateLocalCvAdjustment(localCv);
  const state = rebuilt.baselineState;
  const fields = new Map(rebuilt.publicRequest.fields.map(field => [field.id, field]));
  const fieldsByPath = new Map(rebuilt.bindings.map(binding => [pathKey(binding.path), fields.get(binding.fieldId)!]));
  const tokensByField = new Map(rebuilt.bindings.map(binding => [binding.fieldId, binding.tokens]));
  const structure: CvStructure = { schemaVersion: 1, areas: [{ id: 'body', sectionIds: [] }, { id: 'sidebar', sectionIds: [] }], sections: [], entries: [], bullets: [], ranges: [], unsupported: [] };
  const bindings: CvStructureBindings = { sections: [], entries: [], bulletFields: [], ranges: [] };
  const unsupported = new Map<string, string>();
  const excluded = new Set([...state.disabled, ...state.anonymization.excludedSections]);
  const excludedItems = new Set(state.anonymization.excludedItems);
  const titlePaths: (string | number)[][] = [['contact', 'role']];
  const visible = (item: CvItem) => !item.hidden && !excludedItems.has(item.id);
  function field(path: (string | number)[]) { return fieldsByPath.get(pathKey(path)); }
  function label(path: (string | number)[], fallback: string) { return truncateLabel(field(path)?.text.trim() ?? '') || fallback; }
  function prose(path: (string | number)[], rangeLabel: string, typoOnly = false) {
    const value = field(path);
    if (!value || !value.text.trim()) return;
    if (getFieldPrivacyOverride(state, path) !== undefined) { unsupported.set(value.id, 'Privacy replacement fields support comments only. Edit their replacement in CV Studio Privacy.'); return; }
    if (!plainProse(value.text) || structure.ranges.length >= MAX_ITEMS) { unsupported.set(value.id, 'Complex or oversized prose supports comments only.'); return; }
    const id = `range-${structure.ranges.length + 1}`;
    structure.ranges.push({ id, fieldId: value.id, bulletId: null, text: value.text, label: truncateLabel(rangeLabel), ...(typoOnly ? { typoOnly: true as const } : {}) });
    bindings.ranges.push({ id, fieldId: value.id, path, bulletId: null });
  }
  function bullets(path: (string | number)[], entry: CvStructure['entries'][number]) {
    const value = field(path);
    if (!value || !value.text.trim()) return;
    if (getFieldPrivacyOverride(state, path) !== undefined) { unsupported.set(value.id, 'Privacy replacement fields support comments only. Edit their replacement in CV Studio Privacy.'); return; }
    const parsed = parseFlatBullets(value.text);
    if (!parsed || Object.values(tokensByField.get(value.id) ?? {}).some(text => /\r|\n/.test(text))
      || parsed.lines.length + structure.bullets.length > MAX_ITEMS || parsed.lines.length + structure.ranges.length > MAX_ITEMS) {
      unsupported.set(value.id, 'Ambiguous or complex bullet formatting supports comments only.'); return;
    }
    const bound: CvStructureBindings['bulletFields'][number] = { entryId: entry.id, fieldId: value.id, path, lines: [], separators: parsed.separators, trailing: parsed.trailing };
    for (const line of parsed.lines) {
      const id = `bullet-${structure.bullets.length + 1}`;
      const rangeId = `range-${structure.ranges.length + 1}`;
      entry.bulletIds.push(id);
      structure.bullets.push({ id, entryId: entry.id, fieldId: value.id, text: line.text });
      structure.ranges.push({ id: rangeId, fieldId: value.id, bulletId: id, text: line.text, label: truncateLabel(`${entry.label}: bullet ${entry.bulletIds.length}`) });
      bound.lines.push({ bulletId: id, prefix: line.prefix, suffix: line.suffix });
      bindings.ranges.push({ id: rangeId, fieldId: value.id, path, bulletId: id });
    }
    bindings.bulletFields.push(bound);
  }
  function entries(values: CvItem[], path: (string | number)[], section: CvStructure['sections'][number], allowDescription: boolean, allowBullets: boolean, allowTitle: boolean) {
    values.forEach((item, index) => {
      if (!visible(item)) return;
      const entryPath = [...path, index];
      const entry: CvStructure['entries'][number] = { id: `entry-${structure.entries.length + 1}`, sectionId: section.id,
        label: label([...entryPath, 'title'], label([...entryPath, 'name'], `${section.label}: entry ${section.entryIds.length + 1}`)), bulletIds: [] };
      structure.entries.push(entry); section.entryIds.push(entry.id); bindings.entries.push({ id: entry.id, path: entryPath });
      if (allowTitle) titlePaths.push([...entryPath, 'title']);
      if (allowBullets) bullets([...entryPath, 'bullets'], entry);
      if (allowDescription) prose([...entryPath, 'desc'], `${entry.label}: description`);
    });
  }
  for (const area of structure.areas) {
    const order = area.id === 'body' ? state.bodyOrder : state.sidebarOrder;
    const unique = new Set<string>();
    for (const sourceId of order) {
      if (unique.has(sourceId)) throw new Error('Duplicate section order entries must be corrected before structural refinement.');
      unique.add(sourceId);
      if (excluded.has(sourceId)) continue;
      const custom = area.id === 'body' ? state.customSections.findIndex(item => item.id === sourceId) : state.sidebarSections.findIndex(item => item.id === sourceId);
      let path: (string | number)[] | null = null; let values: CvItem[] | null = null; let sectionLabel = ''; let textPath: (string | number)[] | null = null; let allowDescription = false; let allowBullets = false; let allowTitle = false;
      if (area.id === 'body') {
        if (sourceId === 'about') { textPath = ['about', 'text']; sectionLabel = 'Profile'; }
        else if (sourceId === 'education') { path = ['education']; values = state.education; sectionLabel = 'Education'; allowTitle = true; }
        else if (sourceId === 'jobs') { path = ['experience', 'jobs']; values = state.experience.jobs; sectionLabel = 'Experience'; allowBullets = true; allowTitle = true; }
        else if (custom >= 0) {
          const item = state.customSections[custom]; sectionLabel = label(['customSections', custom, 'name'], 'Additional section');
          if (item.entryMode === 'textarea') textPath = ['customSections', custom, 'text'];
          else { path = ['customSections', custom, 'entries']; values = item.entries; allowDescription = item.fields?.includes('desc') ?? true; allowTitle = item.fields?.includes('title') ?? true; }
        }
      } else {
        if (sourceId === 'languages') { path = ['languages']; values = state.languages; sectionLabel = 'Languages'; }
        else if (sourceId === 'hobbies') { path = ['hobbies']; values = state.hobbies; sectionLabel = 'Interests'; }
        else if (custom >= 0) { path = ['sidebarSections', custom, 'items']; values = state.sidebarSections[custom].items; sectionLabel = label(['sidebarSections', custom, 'name'], 'Sidebar section'); }
      }
      if (!sectionLabel || (values && !values.some(visible)) || (textPath && !field(textPath)?.text.trim())) continue;
      sectionLabel = label(['sectionNames', sourceId], sectionLabel);
      const section: CvStructure['sections'][number] = { id: `section-${structure.sections.length + 1}`, label: sectionLabel, area: area.id, entryIds: [] };
      structure.sections.push(section); area.sectionIds.push(section.id);
      bindings.sections.push({ id: section.id, sourceId, area: area.id, entriesPath: path });
      if (state.sectionHeaderSizes[sourceId] !== 'null') titlePaths.push(custom >= 0
        ? [area.id === 'body' ? 'customSections' : 'sidebarSections', custom, 'name'] : ['sectionNames', sourceId]);
      if (values && path) entries(values, path, section, allowDescription, allowBullets, allowTitle);
      if (textPath) prose(textPath, section.label);
    }
  }
  // Publish eligible titles, without detecting or correcting their spelling here.
  // Append them so existing prose IDs stay stable; legacy snapshots omit them.
  if (options.titleTypos !== false) for (const path of titlePaths) {
    const value = field(path);
    if (value && plainProse(value.text) && getFieldPrivacyOverride(state, path) === undefined && structure.ranges.length < MAX_ITEMS) prose(path, value.label, true);
  }
  const supported = new Set(structure.ranges.map(range => range.fieldId));
  for (const value of rebuilt.publicRequest.fields) if (!supported.has(value.id)) unsupported.set(value.id, unsupported.get(value.id) ?? 'This field supports comments only; names, titles, dates and other facts are not editable operations.');
  structure.unsupported = [...unsupported].map(([fieldId, reason]) => ({ fieldId, reason }));
  return { structure: validateCvStructure(structure, rebuilt.publicRequest.fields), bindings };
}

function references(values: unknown, expected: readonly string[]): values is string[] {
  return Array.isArray(values) && values.length === expected.length && values.every(value => typeof value === 'string')
    && new Set(values).size === values.length && expected.every(value => values.includes(value));
}
function arrays(value: Record<string, unknown>, keys: string[]) { return keys.every(key => Array.isArray(value[key]) && value[key].length <= MAX_ITEMS); }
/** Validate the public graph independently of the local reconstruction maps. */
export function validateCvStructure(value: unknown, inputFields: readonly CvAdjustmentField[]): CvStructure {
  const fail = (): never => { throw new Error('Invalid or inconsistent CV structure.'); };
  if (!exact(value, ['schemaVersion', 'areas', 'sections', 'entries', 'bullets', 'ranges', 'unsupported']) || value.schemaVersion !== 1
    || !arrays(value, ['areas', 'sections', 'entries', 'bullets', 'ranges', 'unsupported']) || JSON.stringify(value).length > 2097152) return fail();
  const structure = value as unknown as CvStructure;
  const fields = new Map<string, CvAdjustmentField>();
  for (const field of inputFields) { if (!id(field.id, 'field') || fields.has(field.id) || !bounded(field.text)) return fail(); fields.set(field.id, field); }
  function unique<T extends { id: string }>(list: T[], prefix: string) {
    if (list.some(item => !record(item) || !id(item.id, prefix)) || new Set(list.map(item => item.id)).size !== list.length) fail();
  }
  unique(structure.sections, 'section'); unique(structure.entries, 'entry'); unique(structure.bullets, 'bullet'); unique(structure.ranges, 'range');
  if (structure.areas.length !== 2 || !references(structure.areas.map(area => area?.id), ['body', 'sidebar'])) return fail();
  for (const area of structure.areas) {
    if (!exact(area, ['id', 'sectionIds']) || !references(area.sectionIds, structure.sections.filter(section => section.area === area.id).map(section => section.id))) return fail();
  }
  for (const section of structure.sections) {
    if (!exact(section, ['id', 'label', 'area', 'entryIds']) || !['body', 'sidebar'].includes(section.area) || !bounded(section.label, 200) || !section.label.trim()
      || !references(section.entryIds, structure.entries.filter(entry => entry.sectionId === section.id).map(entry => entry.id))) return fail();
  }
  for (const entry of structure.entries) {
    if (!exact(entry, ['id', 'sectionId', 'label', 'bulletIds']) || !structure.sections.some(section => section.id === entry.sectionId)
      || !bounded(entry.label, 200) || !entry.label.trim() || !references(entry.bulletIds, structure.bullets.filter(bullet => bullet.entryId === entry.id).map(bullet => bullet.id))) return fail();
    // A reorder target is exactly one physical list field, never several unrelated text fields.
    if (new Set(structure.bullets.filter(bullet => bullet.entryId === entry.id).map(bullet => bullet.fieldId)).size > 1) return fail();
  }
  for (const bullet of structure.bullets) {
    if (!exact(bullet, ['id', 'entryId', 'fieldId', 'text']) || !structure.entries.some(entry => entry.id === bullet.entryId)
      || !fields.has(bullet.fieldId) || !bounded(bullet.text) || !bullet.text.trim() || /\r|\n/.test(bullet.text)
      || !fields.get(bullet.fieldId)!.text.includes(bullet.text)) return fail();
  }
  const rangeTargets = new Set<string>();
  for (const range of structure.ranges) {
    if (!exact(range, ['id', 'fieldId', 'bulletId', 'text', 'label', ...(Object.hasOwn(range, 'typoOnly') ? ['typoOnly'] : [])])
      || (Object.hasOwn(range, 'typoOnly') && (range.typoOnly !== true || range.bulletId !== null))
      || !fields.has(range.fieldId) || !bounded(range.text) || !range.text.trim()
      || !bounded(range.label, 200) || !range.label.trim() || !(range.bulletId === null || id(range.bulletId, 'bullet'))) return fail();
    const target = range.bulletId ?? range.fieldId;
    if (rangeTargets.has(target)) return fail(); rangeTargets.add(target);
    if (range.bulletId === null) {
      if (range.text !== fields.get(range.fieldId)!.text || structure.bullets.some(bullet => bullet.fieldId === range.fieldId)) return fail();
    } else {
      const bullet = structure.bullets.find(item => item.id === range.bulletId);
      if (!bullet || bullet.fieldId !== range.fieldId || bullet.text !== range.text) return fail();
    }
  }
  const unsupported = new Set<string>();
  for (const item of structure.unsupported) {
    if (!exact(item, ['fieldId', 'reason']) || !fields.has(item.fieldId) || unsupported.has(item.fieldId)
      || !bounded(item.reason, 1000) || !item.reason.trim() || structure.ranges.some(range => range.fieldId === item.fieldId)
      || structure.bullets.some(bullet => bullet.fieldId === item.fieldId)) return fail();
    unsupported.add(item.fieldId);
  }
  return clone(structure);
}

function validateShortening(next: string, original: string) {
  if (!bounded(next) || !next.trim() || [...next].length >= [...original].length) throw new Error('Shortening must produce shorter, nonempty text.');
  if (!same(original.match(TOKEN) ?? [], next.match(TOKEN) ?? []) || /\{\{|\}\}/.test(next.replace(TOKEN, ''))) throw new Error('Private placeholders must remain intact and in their original order.');
  if (!same(links(original), links(next)) || /!\[|<\/?[a-z]|\]\([^)]*\{\{/i.test(next)) throw new Error('Shortening cannot add or remove links, images or HTML.');
  const originalTokens = original.trim().split(/\s+/u); const replacementTokens = next.trim().split(/\s+/u);
  let position = 0;
  for (const token of replacementTokens) {
    while (position < originalTokens.length && originalTokens[position] !== token) position++;
    if (position === originalTokens.length) throw new Error('Shortening must retain an ordered selection of the original words without additions or rewrites.');
    position++;
  }
}

// Bounded spelling edits, including adjacent transpositions. The prompt and review
// still decide whether a nearby spelling is appropriate; distance cannot prove meaning.
function closeSpelling(before: string[], after: string[], budget: number, left = 0, right = 0): boolean {
  while (left < before.length && right < after.length && before[left] === after[right]) { left++; right++; }
  if (left === before.length || right === after.length) return before.length - left + after.length - right <= budget;
  if (!budget || Math.abs(before.length - left - after.length + right) > budget) return false;
  return closeSpelling(before, after, budget - 1, left + 1, right + 1)
    || closeSpelling(before, after, budget - 1, left + 1, right)
    || closeSpelling(before, after, budget - 1, left, right + 1)
    || (before[left] === after[right + 1] && before[left + 1] === after[right]
      && closeSpelling(before, after, budget - 1, left + 2, right + 2));
}

function validateTypoFix(next: string, original: string) {
  if (!bounded(next) || !next.trim() || next === original) throw new Error('A typo correction must change nonempty text.');
  if (!same(original.match(TOKEN) ?? [], next.match(TOKEN) ?? []) || /\{\{|\}\}/.test(next.replace(TOKEN, '')))
    throw new Error('Private placeholders must remain intact and in their original order.');
  if (!same(links(original), links(next))) throw new Error('Typo corrections must preserve links.');
  const before = original.split(/(\s+)/u); const after = next.split(/(\s+)/u);
  const word = /^([^\p{L}\p{M}\p{N}]*)([\p{L}\p{M}]+)([^\p{L}\p{M}\p{N}]*)$/u;
  if (before.length !== after.length) throw new Error('Typo corrections cannot add, remove or reorder words.');
  for (let index = 0; index < before.length; index++) {
    if (before[index] === after[index]) continue;
    const oldWord = before[index].match(word); const newWord = after[index].match(word);
    if (!oldWord || !newWord || oldWord[1] !== newWord[1] || oldWord[3] !== newWord[3])
      throw new Error('Typo corrections must preserve whitespace, punctuation, numbers and protected content.');
    const left = [...oldWord[2]]; const right = [...newWord[2]];
    if (Math.max(left.length, right.length) > 64 || !closeSpelling(left, right, Math.min(left.length, right.length) < 5 ? 1 : 2))
      throw new Error('Typo corrections allow only small spelling changes, not wording rewrites.');
  }
}

export function validateCvOperations(unknownOperations: unknown, unknownComments: unknown, inputStructure: CvStructure, fields: readonly CvAdjustmentField[]): { operations: CvOperation[]; comments: CvComment[] } {
  const structure = validateCvStructure(inputStructure, fields);
  if (!Array.isArray(unknownOperations) || unknownOperations.length > MAX_ITEMS || !Array.isArray(unknownComments) || unknownComments.length > MAX_ITEMS) throw new Error('Invalid CV operations or comments.');
  const operations: CvOperation[] = []; const comments: CvComment[] = [];
  const ids = new Set<string>(); const targets = new Set<string>(); const editedRanges = new Set<string>();
  const shortenedBullets = new Set<string>(); const correctedBullets = new Set<string>(); const omittedBullets = new Set<string>();
  for (const value of unknownOperations) {
    if (!record(value) || !id(value.id, 'change') || ids.has(value.id) || !bounded(value.explanation, 1000) || !value.explanation.trim()
      || typeof value.targetId !== 'string' || typeof value.type !== 'string') throw new Error('Invalid or duplicate CV operation.');
    ids.add(value.id);
    if (targets.has(`${value.type}:${value.targetId}`)) throw new Error('Conflicting CV operations target the same content.');
    targets.add(`${value.type}:${value.targetId}`);
    if (['reorder_sections', 'reorder_entries', 'reorder_bullets'].includes(value.type)) {
      if (!exact(value, ['id', 'type', 'targetId', 'explanation', 'order'])) throw new Error('Invalid CV reorder operation.');
      const original = value.type === 'reorder_sections' ? structure.areas.find(area => area.id === value.targetId)?.sectionIds
        : value.type === 'reorder_entries' ? structure.sections.find(section => section.id === value.targetId)?.entryIds
          : structure.entries.find(entry => entry.id === value.targetId)?.bulletIds;
      if (!original || !original.length || !references(value.order, original)) throw new Error('Reordering requires a complete permutation of existing eligible items in the same container.');
    } else if (value.type === 'shorten_text' || value.type === 'fix_typos') {
      if (!exact(value, ['id', 'type', 'targetId', 'explanation', 'text']) || typeof value.text !== 'string') throw new Error('Invalid CV text operation.');
      const range = structure.ranges.find(item => item.id === value.targetId);
      if (!range) throw new Error('The text target is unavailable or supports comments only.');
      if (editedRanges.has(range.id)) throw new Error('Conflicting CV text operations target the same range.');
      editedRanges.add(range.id);
      if (value.type === 'shorten_text') {
        if (range.typoOnly) throw new Error('Titles allow only single-word typo corrections, not shortening.');
        validateShortening(value.text, range.text);
      }
      else validateTypoFix(value.text, range.text);
      if (range.bulletId) {
        if (/\r|\n/.test(value.text)) throw new Error('An edited bullet must remain one line.');
        (value.type === 'shorten_text' ? shortenedBullets : correctedBullets).add(range.bulletId);
      }
    } else if (value.type === 'omit_bullet') {
      if (!exact(value, ['id', 'type', 'targetId', 'explanation']) || !structure.bullets.some(bullet => bullet.id === value.targetId)) throw new Error('The bullet omission target is unavailable.');
      omittedBullets.add(value.targetId);
    } else throw new Error('Unknown CV operation type.');
    operations.push(clone(value as unknown as CvOperation));
  }
  if ([...shortenedBullets].some(id => omittedBullets.has(id))) throw new Error('A bullet cannot be shortened and omitted in the same proposal.');
  if ([...correctedBullets].some(id => omittedBullets.has(id))) throw new Error('A bullet cannot have typos corrected and be omitted in the same proposal.');
  for (const value of unknownComments) {
    if (!exact(value, ['id', 'fieldId', 'explanation']) || !id(value.id, 'comment') || ids.has(value.id)
      || !fields.some(field => field.id === value.fieldId) || !bounded(value.explanation, 1000) || !value.explanation.trim()) throw new Error('Invalid or duplicate CV comment.');
    ids.add(value.id); comments.push(clone(value as unknown as CvComment));
  }
  return { operations, comments };
}

/** Apply wording first and then structural permutations, making checkbox selection independent of proposal order. */
export function applyCvOperations(localCv: LocalCvAdjustmentRequest, structure: CvStructure, operations: readonly CvOperation[], currentState: CvState, selectedIds?: readonly string[]): CvState {
  const result = reconstructCvAdjustment(localCv, { schemaVersion: 1, requestId: localCv.publicRequest.requestId, edits: [] }, currentState).state;
  const rebuilt = prepareCvStructure(localCv, { titleTypos: structure.ranges.some(range => range.typoOnly === true) });
  if (!same(structure, rebuilt.structure)) throw new Error('The CV structure does not match the original local snapshot. Prepare a new request.');
  const checked = validateCvOperations(operations, [], structure, localCv.publicRequest.fields).operations;
  if (selectedIds && (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !checked.some(operation => operation.id === id)))) throw new Error('Selected CV operations contain unknown or duplicate identifiers.');
  const selected = selectedIds ? checked.filter(operation => selectedIds.includes(operation.id)) : checked;
  const privacy = validateLocalCvAdjustment(localCv);
  const tokensByField = new Map(privacy.bindings.map(binding => [binding.fieldId, binding.tokens]));
  const restore = (text: string, fieldId: string) => text.replace(TOKEN, token => {
    const value = tokensByField.get(fieldId)?.[token];
    if (value === undefined) throw new Error('A private reconstruction token is unavailable.');
    return value;
  });
  for (const operation of selected) if (operation.type === 'shorten_text' || operation.type === 'fix_typos') {
    const range = rebuilt.bindings.ranges.find(item => item.id === operation.targetId)!;
    if (range.bulletId === null) setPath(result, range.path, restore(operation.text, range.fieldId));
  }
  for (const bound of rebuilt.bindings.bulletFields) {
    const entry = structure.entries.find(item => item.id === bound.entryId)!;
    const reorder = selected.find((operation): operation is CvOperation & { order: string[] } => operation.type === 'reorder_bullets' && operation.targetId === entry.id);
    const omissions = new Set(selected.filter(operation => operation.type === 'omit_bullet').map(operation => operation.targetId));
    const replacements = new Map(selected.filter((operation): operation is CvOperation & { text: string } => operation.type === 'shorten_text' || operation.type === 'fix_typos')
      .map(operation => [structure.ranges.find(range => range.id === operation.targetId)!.bulletId, operation.text]));
    if (!reorder && !entry.bulletIds.some(id => omissions.has(id) || replacements.has(id))) continue;
    const order = (reorder?.order ?? entry.bulletIds).filter(id => !omissions.has(id));
    const lines = order.map(id => {
      const line = bound.lines.find(item => item.bulletId === id)!;
      const bullet = structure.bullets.find(item => item.id === id)!;
      return line.prefix + (replacements.get(id) ?? bullet.text) + line.suffix;
    });
    const text = lines.map((line, index) => line + (index < lines.length - 1 ? bound.separators[index] ?? bound.trailing ?? '\n' : bound.trailing)).join('');
    setPath(result, bound.path, restore(text, bound.fieldId));
  }
  for (const operation of selected) if (operation.type === 'reorder_entries') {
    const section = rebuilt.bindings.sections.find(item => item.id === operation.targetId)!;
    if (!section.entriesPath) throw new Error('This section has no reorderable entries.');
    const entries = atPath(result, section.entriesPath) as CvItem[];
    const targetIndices = new Map(structure.sections.find(item => item.id === section.id)!.entryIds.map(id => [id, Number(rebuilt.bindings.entries.find(item => item.id === id)!.path.at(-1))]));
    const remaining = operation.order.map(id => entries[targetIndices.get(id)!]);
    const eligible = new Set(targetIndices.values()); let cursor = 0;
    setPath(result, section.entriesPath, entries.map((entry, index) => eligible.has(index) ? remaining[cursor++] : entry));
  }
  for (const operation of selected) if (operation.type === 'reorder_sections') {
    const key = operation.targetId === 'body' ? 'bodyOrder' : 'sidebarOrder';
    const eligible = new Set(rebuilt.bindings.sections.filter(section => section.area === operation.targetId).map(section => section.sourceId));
    const order = operation.order.map(id => rebuilt.bindings.sections.find(section => section.id === id)!.sourceId); let cursor = 0;
    result[key] = result[key].map(sourceId => eligible.has(sourceId) ? order[cursor++] : sourceId);
  }
  return readCvState(result);
}

export function describeCvOperation(operation: CvOperation, structure: CvStructure): { target: string; before: string; after: string } {
  if (operation.type === 'shorten_text' || operation.type === 'fix_typos') {
    const range = structure.ranges.find(item => item.id === operation.targetId);
    if (!range) throw new Error('Unknown CV text target.');
    return { target: range.label, before: range.text, after: operation.text };
  }
  if (operation.type === 'omit_bullet') {
    const bullet = structure.bullets.find(item => item.id === operation.targetId);
    if (!bullet) throw new Error('Unknown CV bullet target.');
    return { target: structure.entries.find(entry => entry.id === bullet.entryId)!.label, before: bullet.text, after: '' };
  }
  const target = operation.type === 'reorder_sections' ? structure.areas.find(area => area.id === operation.targetId)
    : operation.type === 'reorder_entries' ? structure.sections.find(section => section.id === operation.targetId) : structure.entries.find(entry => entry.id === operation.targetId);
  if (!target) throw new Error('Unknown CV reorder target.');
  const values = operation.type === 'reorder_sections' ? structure.sections.map(item => ({ id: item.id, label: item.label }))
    : operation.type === 'reorder_entries' ? structure.entries.map(item => ({ id: item.id, label: item.label })) : structure.bullets.map(item => ({ id: item.id, label: item.text }));
  const order = 'sectionIds' in target ? target.sectionIds : 'entryIds' in target ? target.entryIds : target.bulletIds;
  const display = (ids: string[]) => ids.map(id => { const value = values.find(item => item.id === id); if (!value) throw new Error('Unknown CV reorder item.'); return value.label; }).join('\n');
  return { target: 'label' in target ? target.label : target.id === 'body' ? 'Body sections' : 'Sidebar sections', before: display(order), after: display(operation.order) };
}
