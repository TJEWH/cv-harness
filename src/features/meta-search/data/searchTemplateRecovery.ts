import type { SearchTemplate } from '../searchTypes';
import { readSearchTemplate, searchTemplateContentKey } from './useSearchTemplates';

interface Draft { form: SearchTemplate; baseline: SearchTemplate | null }
const drafts = new Map<string, Draft>();
const key = (owner: string) => `cv.search-template-recovery.v1:${encodeURIComponent(owner)}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Keep failed commits scoped to their original account, including across editor remounts. */
export function retainSearchDraft(owner: string, form: SearchTemplate, baseline: SearchTemplate | null) {
  const draft = clone({ form, baseline });
  drafts.set(owner, draft);
  try { sessionStorage.setItem(key(owner), JSON.stringify(draft)); } catch { /* In-memory recovery remains available. */ }
}
export function recoverSearchDraft(owner: string): Draft | null {
  const memory = drafts.get(owner);
  try {
    const raw = memory ? null : sessionStorage.getItem(key(owner));
    if (memory) return { form: readSearchTemplate(memory.form), baseline: memory.baseline === null ? null : readSearchTemplate(memory.baseline) };
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const draft = { form: readSearchTemplate(parsed.form), baseline: parsed.baseline === null ? null : readSearchTemplate(parsed.baseline) };
    drafts.set(owner, draft);
    return clone(draft);
  } catch { return null; }
}
export function clearSearchDraft(owner: string, id: string, expectedKey?: string) {
  const draft = recoverSearchDraft(owner);
  if (draft?.form.id !== id) return;
  if (expectedKey !== undefined && searchTemplateContentKey(draft.form) !== expectedKey) return;
  drafts.delete(owner);
  try { sessionStorage.removeItem(key(owner)); } catch { /* Optional recovery storage. */ }
}
