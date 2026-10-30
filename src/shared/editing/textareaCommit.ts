type TextareaCommit = () => void;

const pendingTextareas = new Set<TextareaCommit>();
let committing = false;

/** Register a draft flusher, not a persistence callback. Safe during nested saves. */
export function registerTextareaCommit(commit: TextareaCommit) {
  pendingTextareas.add(commit);
  return () => { pendingTextareas.delete(commit); };
}

/** Publish drafts synchronously before an owner snapshots, saves, or replaces them. */
export function commitPendingTextareas() {
  if (committing) return;
  committing = true;
  try { for (const commit of [...pendingTextareas]) commit(); }
  finally { committing = false; }
}
