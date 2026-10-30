export const MAX_OPPORTUNITY_EVALUATION_LENGTH = 12000;

type EvaluationDraftStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

/** Move the retired browser editor's recovery keys once, before publishing workspace rows.
 * Use the migrated saved evaluation only when no newer local evaluation draft exists.
 * Keep either key on storage failure or a concurrent edit instead of losing a draft.
 */
export function migrateOpportunityEvaluationDrafts(owner: string, reviews: readonly Record<string, unknown>[], storage?: EvaluationDraftStorage | null): void {
  if (!owner) return;
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target) return;
    const saved = new Map(reviews.flatMap(review => review.user_id === owner && typeof review.opportunity_id === 'string'
      ? [[review.opportunity_id, typeof review.comment === 'string' ? review.comment : ''] as const] : []));
    const prefix = `CV_SEARCH_FEEDBACK_SUMMARY_DRAFT:${encodeURIComponent(owner)}:`;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index)).filter((key): key is string => !!key?.startsWith(prefix));
    for (const key of keys) {
      try {
        const original = target.getItem(key), parsed: unknown = JSON.parse(original ?? 'null');
        if (!parsed || typeof parsed !== 'object' || !('value' in parsed) || typeof parsed.value !== 'string'
          || Array.from(parsed.value).length > 600) continue;
        const id = key.slice(prefix.length);
        if (!id) continue;
        const currentKey = `CV_OPPORTUNITY_COMMENT_DRAFT:${encodeURIComponent(owner)}:${id}`;
        const currentRaw = target.getItem(currentKey), current: unknown = JSON.parse(currentRaw ?? 'null');
        if (currentRaw !== null && (!current || typeof current !== 'object' || !('value' in current) || typeof current.value !== 'string')) continue;
        const draft = current && typeof current === 'object' && 'value' in current ? String(current.value) : saved.get(decodeURIComponent(id)) ?? '';
        const value = draft.includes(parsed.value) ? draft : parsed.value.includes(draft) ? parsed.value : `${draft}\n\n${parsed.value}`;
        if (target.getItem(currentKey) !== currentRaw || target.getItem(key) !== original) continue;
        target.setItem(currentKey, JSON.stringify({ value }));
        if (target.getItem(currentKey) === JSON.stringify({ value }) && target.getItem(key) === original) target.removeItem(key);
      } catch { /* Preserve source keys when browser recovery storage is unavailable. */ }
    }
  } catch { /* Cloud evaluation saving remains available without browser storage. */ }
}
