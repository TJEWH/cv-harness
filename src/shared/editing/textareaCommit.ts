type TextareaCommit = () => void;
type TextareaReadiness = () => boolean;

const pendingTextareas = new Map<TextareaCommit, TextareaReadiness>();
let committing = false;
let draftRevision = 0;

/** Native draft edits only; publication and model acknowledgements do not advance it. */
export function markTextareaDraftChanged() { draftRevision++; }
export function getTextareaDraftRevision() { return draftRevision; }

/** Composition readiness is independent of whether a textarea is dirty. */
export function canCommitTextareas() {
  for (const ready of pendingTextareas.values()) if (ready() !== true) return false;
  return true;
}

/** Register a draft flusher, not a persistence callback. Safe during nested saves. */
export function registerTextareaCommit(commit: TextareaCommit, ready: TextareaReadiness = () => true) {
  pendingTextareas.set(commit, ready);
  return () => { pendingTextareas.delete(commit); };
}

/** Publish drafts synchronously before an owner snapshots, saves, or replaces them. */
export function commitPendingTextareas(): boolean {
  if (committing) return canCommitTextareas();
  if (!canCommitTextareas()) return false;
  committing = true;
  try {
    for (const commit of [...pendingTextareas.keys()]) commit();
    return canCommitTextareas();
  }
  finally { committing = false; }
}
