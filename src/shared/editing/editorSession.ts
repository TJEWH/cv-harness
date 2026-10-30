import { canCommitTextareas, commitPendingTextareas, getTextareaDraftRevision } from './textareaCommit';

export interface EditorSession { flush(): boolean | Promise<boolean> }
export interface SyncEditorSession { flush(): boolean }
export type EditorFlushStep = () => boolean | Promise<boolean>;
interface SessionOptions<Step> {
  steps: readonly Step[];
  /** Capture the owner/record lifecycle when constructing this predicate. */
  current(): boolean;
  /** Owner-specific safe-to-leave check, evaluated after all flush steps. */
  settled?: () => boolean;
}
export type EditorSessionOptions = SessionOptions<EditorFlushStep>;
export type SyncEditorSessionOptions = SessionOptions<() => boolean>;

/** Publish drafts, then drain owning persistence without accepting newer typing. */
export async function flushEditorSession(options: EditorSessionOptions): Promise<boolean> {
  try {
    if (!options.current() || !commitPendingTextareas()) return false;
    const revision = getTextareaDraftRevision();
    const current = () => options.current() && canCommitTextareas() && getTextareaDraftRevision() === revision;
    for (const step of [...options.steps]) {
      if (!current()) return false;
      const saved = await step();
      if (saved !== true || !current()) return false;
    }
    if (!current() || (options.settled ? options.settled() : true) !== true) return false;
    return current();
  } catch { return false; }
}

/** Synchronous counterpart for local stores and before-replacement callbacks. */
export function flushEditorSessionSync(options: SyncEditorSessionOptions): boolean {
  try {
    if (!options.current() || !commitPendingTextareas()) return false;
    const revision = getTextareaDraftRevision();
    const current = () => options.current() && canCommitTextareas() && getTextareaDraftRevision() === revision;
    for (const step of [...options.steps]) {
      if (!current() || step() !== true || !current()) return false;
    }
    if (!current() || (options.settled ? options.settled() : true) !== true) return false;
    return current();
  } catch { return false; }
}
