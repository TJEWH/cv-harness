import type { SavedConfiguration } from '../../../documents/cv/types';

/** Keep legacy provenance so internal refinements cannot become application templates. */
export function normalizeVariantIndex(value: unknown): SavedConfiguration[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name,
      ...(typeof item.mtime === 'number' ? { mtime: item.mtime } : {}),
      ...(typeof item.parentId === 'string' && item.parentId.trim() ? { parentId: item.parentId } : {}) }];
  });
}

export function isMainCvVariant(variant: SavedConfiguration): boolean {
  return !variant.parentId;
}

/** Old acceptance receipts can recover provenance erased by a flattened library save. */
export function applicationRefinementParents(storage: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'length' | 'key'>>): Map<string, string> {
  const parents = new Map<string, string>();
  if (typeof storage.key !== 'function') return parents;
  for (let index = 0; index < (storage.length || 0); index++) {
    const key = storage.key(index);
    const match = key?.match(/^CV_REFINEMENT:1:([^:]+):([^:]+)$/);
    if (!key || !match) continue;
    try {
      const backup = JSON.parse(storage.getItem(key) || 'null');
      if (backup?.version !== 1 || !backup.requests || typeof backup.requests !== 'object') continue;
      for (const [requestId, source] of Object.entries(backup.requests)) {
        const local = source as { request?: { applicationId?: unknown; requestId?: unknown }; cv?: { sourceVariantId?: unknown }; acceptances?: { variantId?: unknown }[] } | null;
        if (local?.request?.applicationId !== match[2] || local.request.requestId !== requestId
          || typeof local.cv?.sourceVariantId !== 'string' || !local.cv.sourceVariantId || !Array.isArray(local.acceptances)) continue;
        for (const receipt of local.acceptances) {
          if (receipt && typeof receipt.variantId === 'string' && receipt.variantId) parents.set(receipt.variantId, local.cv.sourceVariantId);
        }
      }
    } catch { /* A damaged application's backup must not affect another application. */ }
  }
  return parents;
}
