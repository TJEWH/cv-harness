import type { CvState } from '../../documents/cv/types';
import { readCvState, isRecord } from '../../documents/cv/domain/cvStateValidation';
import { normalizeContentState } from '../../documents/layout/contentLayout';
import { readLetterHeaderSource, type LetterHeaderSource } from '../../documents/letter/domain/letterContact';

type LocalStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface ApplicationCvRecord {
  format: 1;
  userId: string;
  applicationId: string;
  baseId: string;
  /** Library source identity; only an unrefined working copy can refresh on open. */
  variantId?: string;
  /** Legacy backup provenance retained without changing the independent working copy. */
  detached?: boolean;
  baseName: string;
  /** Revision of the captured source; advances when an untouched snapshot refreshes. */
  baseRevision: number;
  baseState: CvState;
  state: CvState;
  revision: number;
  updatedAt: string;
  publishedState: CvState | null;
  publishedSnapshotId: string | null;
  /** Live sender information for letters; the independent CV snapshots stay frozen. */
  letterHeaderSource?: LetterHeaderSource;
}
export interface CvDifference { path: string[]; label: string; before: unknown; after: unknown }
/** Match FormBuilder defaults before pinning or comparing, without editing the source. */
export function cloneCv(state: CvState): CvState {
  const copy = readCvState(JSON.parse(JSON.stringify(state)));
  normalizeContentState(copy);
  return copy;
}
const cloneValue = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (isRecord(a) && isRecord(b)) return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
  return false;
}
const keyFor = (userId: string, applicationId: string) => `CV_APPLICATION:1:${encodeURIComponent(userId)}:${encodeURIComponent(applicationId)}`;
export function createApplicationCv(userId: string, applicationId: string, baseId: string, baseName: string, source: CvState): ApplicationCvRecord {
  if (!userId || !applicationId || !baseId) throw new Error('The application and career variant are required.');
  return { format: 1, userId, applicationId, baseId, baseName, baseRevision: 1,
    baseState: cloneCv(source), state: cloneCv(source), revision: 1, updatedAt: new Date().toISOString(),
    publishedState: null, publishedSnapshotId: null };
}

export function loadApplicationCv(userId: string, applicationId: string, store: LocalStore = localStorage): ApplicationCvRecord | null {
  const raw = store.getItem(keyFor(userId, applicationId));
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.format !== 1 || value.userId !== userId || value.applicationId !== applicationId
    || typeof value.baseId !== 'string' || typeof value.baseName !== 'string'
    || !Number.isInteger(value.baseRevision) || !Number.isInteger(value.revision)
    || Number(value.baseRevision) < 1 || Number(value.revision) < 1 || typeof value.updatedAt !== 'string'
    || !(value.publishedSnapshotId === null || typeof value.publishedSnapshotId === 'string')) throw new Error('The local application CV is invalid. Restore its backup before editing.');
  return { format: 1, userId, applicationId, baseId: value.baseId, baseName: value.baseName,
    ...(typeof value.variantId === 'string' ? { variantId: value.variantId } : {}),
    ...(value.detached === true ? { detached: true } : {}),
    baseRevision: Number(value.baseRevision), revision: Number(value.revision), updatedAt: value.updatedAt,
    baseState: cloneCv(readCvState(value.baseState)), state: cloneCv(readCvState(value.state)),
    publishedState: value.publishedState === null ? null : cloneCv(readCvState(value.publishedState)),
    publishedSnapshotId: value.publishedSnapshotId,
    ...(value.letterHeaderSource === undefined ? {} : { letterHeaderSource: readLetterHeaderSource(value.letterHeaderSource) }) };
}

export function saveApplicationCv(record: ApplicationCvRecord, store: LocalStore = localStorage) {
  if (!record.userId || !record.applicationId) throw new Error('Missing application identity.');
  store.setItem(keyFor(record.userId, record.applicationId), JSON.stringify(record));
}
export function removeApplicationCv(userId: string, applicationId: string, store: LocalStore = localStorage) { store.removeItem(keyFor(userId, applicationId)); }
export function isApplicationCvPublished(record: ApplicationCvRecord, snapshotId: string | null) {
  return Boolean(snapshotId && record.publishedSnapshotId === snapshotId && same(record.state, record.publishedState));
}

/** Arrays retain entry-level changes only while their identities/order still match. */
export function cvDifferences(base: CvState, current: CvState): CvDifference[] {
  const result: CvDifference[] = [];
  const visit = (before: unknown, after: unknown, path: string[]) => {
    if (same(before, after)) return;
    if (isRecord(before) && isRecord(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) visit(before[key], after[key], [...path, key]);
      return;
    }
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length
      && before.every((item, i) => isRecord(item) && isRecord(after[i]) && item.id && item.id === after[i].id)) {
      before.forEach((item, i) => visit(item, after[i], [...path, String(i)]));
      return;
    }
    result.push({ path, label: path.join(' › '), before: cloneValue(before), after: cloneValue(after) });
  };
  visit(cloneCv(base), cloneCv(current), []);
  return result;
}

export function copyCvSection(target: CvState, source: CvState, key: string): CvState {
  const next = cloneCv(target);
  const from = cloneCv(source);
  if (key === 'header') next.contact = from.contact;
  else if (key === 'about') next.about = from.about;
  else if (key === 'jobs') next.experience = from.experience;
  else if (key === 'education' || key === 'languages' || key === 'hobbies') next[key] = from[key];
  else {
    const body = from.customSections.find((section) => section.id === key);
    const sidebar = from.sidebarSections.find((section) => section.id === key);
    if (body) {
      const index = next.customSections.findIndex((section) => section.id === key);
      if (index >= 0) next.customSections[index] = body; else next.customSections.push(body);
      if (!next.bodyOrder.includes(key)) next.bodyOrder.push(key);
    } else if (sidebar) {
      const index = next.sidebarSections.findIndex((section) => section.id === key);
      if (index >= 0) next.sidebarSections[index] = sidebar; else next.sidebarSections.push(sidebar);
      if (!next.sidebarOrder.includes(key)) next.sidebarOrder.push(key);
    } else throw new Error('This section is unavailable in the selected variant.');
  }
  if (from.sectionNames[key]) next.sectionNames[key] = from.sectionNames[key];
  return next;
}
