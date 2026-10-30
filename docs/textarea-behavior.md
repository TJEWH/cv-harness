# Textarea autosave

Use this strategy for all textareas, including CV Studio, opportunity evaluations, application notes, letters, templates, refinement feedback, and description drafts.

- Typing updates a local draft. Do not send a save request on input or on a debounce timer.
- Double-click uses native word selection; triple-click selects the complete textarea value. Press-and-drag, touch selection handles, keyboard selection, copy, and paste keep their native behavior. Do not prevent pointer/touch defaults or intercept selection for card navigation or reordering.
- Commit when the textarea loses focus, the window loses focus, or the page becomes hidden. Enter commits without adding a newline; Shift+Enter inserts a newline without committing. Ignore Enter during IME composition.
- Await `flush()` before switching records, opening another workspace, swiping to another item, or performing an action that leaves the editor. If saving fails or newer uncommitted text remains, retain the editor and draft.
- Save a snapshot captured at the commit event. Serialize requests and deduplicate repeated commits of the same pending value. Typing during a request remains unsaved until the next commit.
- Local recovery may update while typing. Keep recovery isolated by account and record; clear only the version that was successfully saved. Browser shutdown cannot guarantee a network request finishes, so retain recovery until success.
- Track unsaved, saving, saved, and error states internally. Use the shared toast system for committed-save progress, success, and errors; do not render inline or hidden save-state text. Do not notify while typing or announce an already-saved record on open. Retain failed drafts and provide retry. Put general editing guidance in an `InfoHint` beside the field label.

Use `src/shared/ui/AutosaveTextarea.vue` for the input behavior. It forwards native attributes such as `id`, `rows`, `maxlength`, and accessible labels to its textarea, and supports `auto-resize`. If changing the bound model already triggers persistence, use `v-model.lazy` so only a commit publishes its internal draft:

```vue
<AutosaveTextarea v-model.lazy="document.text" rows="3" @commit="flushDocument" />
```

Plain `v-model` is reserved for a draft whose setter and watchers do not persist. Connect its `@commit` to the persistence layer:

```vue
<AutosaveTextarea v-model="notes" rows="3" @commit="flushNotes" />
```

`useApplicationNotesAutosave` implements commit-driven saving, serialized snapshots, and local recovery for opportunity evaluations and application notes. Reuse it for comparable per-record notes. Other persistence layers must implement the same contract; binding this component directly to a model with an input-triggered save watcher does not remove that watcher.

Call `commitPendingTextareas()` from `src/shared/editing/textareaCommit.ts` before reading a save/export snapshot or replacing an editor's model. It publishes dirty drafts synchronously and guards nested flushes. Then flush the owning persistence layer; await asynchronous saves before navigating. The component also commits on outside pointer interaction before another control changes the editor. A normal drag within the textarea never commits.

`MarkdownTextarea` applies this behavior to CV content and signals the owning CV/section/privacy persistence layer to flush. Keep PDF preview refreshes separate from storage writes; Shift+Enter must not refresh a deferred preview.

Description fields for attachments or approved privacy context can save private drafts on commit. Existing explicit actions still approve disclosure, upload a file, or publish metadata. Read-only textareas use the same selection behavior and have no persistence callback.
