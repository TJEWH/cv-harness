# Application refinement integration

Use the connected Supabase workflow: **Sync / Copy task → ChatGPT → Sync**, with version-2 requests and proposals. Standalone letter-drafting/CV-adjustment APIs, version-1 refinement and manual proposal imports are retired. You retain opportunities, applications, current refinement history and private working documents.

The current schema includes separate CV and letter request pointers. Use [`schema.sql`](schema.sql) for a fresh installation and follow [setup](README.md) for current installation and verification. Historical upgrade scripts remain in Git history. The app preserves connected request/proposal history without reactivating superseded requests. [`src/features/refinement/refinementTypes.ts`](../src/features/refinement/refinementTypes.ts) defines the source contract; [`test/protocol/refinement`](../test/protocol/refinement) verifies copied instructions generated from it.

## Workflow and storage

Preparation freezes an independent application CV and letter-template revision. The app publishes privacy-filtered wording and settings. Copy task verifies the local published source and copies complete document-specific instructions. ChatGPT reads the exact current request through the project's management connection and saves a validated proposal. CV changes stay pending as active/inactive choices. Copying the next task freezes the selection as its source; the matching reply applies that selection and leaves its new changes pending. Letter proposals still apply to the working letter after checking the exact baseline, scope and approvals. Review the result, answer annotations, edit wording and approve the CV and letter as separate documents.

Current cloud history remains available. Selecting a historical proposal opens a comparison against its frozen local source; a stale proposal cannot replace newer working documents. Template-library edits do not update application copies. Missing schema or local reconstruction data produces an error without deleting working documents.

Complete CVs, private letter text, token/structure mappings and source signatures remain in browser storage. Supporting files and generated PDF packages remain in IndexedDB. Supabase stores anonymized source snapshots, frozen settings, proposals, feedback and approval hashes. Cloud records cannot reconstruct missing private originals. Application notes and supporting files are not included in refinement requests.

## Browser contract

Signed-in non-anonymous owners use these RPCs with existing RLS. Each RPC returns one JSON row.

| RPC | Arguments | Behavior |
| --- | --- | --- |
| `public.save_refinement_state` | `p_application_id`, `p_setup`, `p_approvals`, `p_expected_revision` | Save frozen setup with optimistic concurrency. Initial revision is `0`; new approval hashes require a recorded approval review. |
| `public.publish_refinement_request` | `p_request` | Freeze a request, capture the assigned public CV and application research, and atomically advance only the selected document’s current request. |
| `public.publish_refinement_protocol` | `p_request_id`, `p_protocol_id`, `p_protocol_text` | Store the immutable connected protocol; verify its receipt before copying the task. |
| `public.save_refinement_review` | `p_application_id`, nullable `p_request_id`, `p_kind`, `p_payload`, `p_id` | Append feedback, annotations or CV decisions; approvals/reopenings also update state atomically. |
| `public.clear_refinement_history` | `p_application_id`, `p_expected_revision`, `p_scope` | Clear the selected document's refinement history while retaining the other document's history, setup, approval hashes and the application itself. |

Read the owner-scoped `application_refinement_state`, `application_refinement_requests`, `application_refinement_proposals` and `application_refinement_reviews` tables. Load all pages and order history by `created_at, id`. Validate ownership and application/request identities on every page. Use `current_cv_request_id` or `current_letter_request_id` for the selected document’s active source; the newest timestamp alone does not establish freshness.

Requests have `schemaVersion: 2`, request/application IDs, `cv`, `cvStructure`, frozen `letter`, `scope`, ordered `feedback`, `parentProposalId` and optional `privacyLegend`. The nested `cv.schemaVersion: 1` describes the current privacy-field format; it is not the retired outer refinement protocol. Source paths and reverse mappings never enter request JSON.

Template formatting (page margins, body size, header name size and line spacing) stays in the private local template baseline. Application overrides also remain local. The app excludes these rendering settings from shared setup and request templates; they require no additional database fields.

Exact UUID/payload retries return the original receipt. They do not recapture inputs or reactivate an old request. New inputs, scope, research or feedback require a new request. Reuse requires both the server's current pointer and matching local inputs. Feedback must contain every saved reply for the selected document exactly once, in order, with unchanged text, scope, ID and equivalent timestamp. Combined historical replies are excluded, and parent proposals must have the same single-document scope. Publication fails if privacy rechecking would alter an immutable saved reply or if the complete history exceeds the size limit; it never truncates context silently.

The server-captured CV snapshot ID/revision is distinct from the local CV Studio source revision. State timestamps/revisions can change for setup and approvals and are not document version counters. Local source metadata may be unavailable on another device; show that as unknown instead of inferring it from cloud timestamps.

### Application reference codes

Each application has an immutable, globally unique server-generated code such as `APP-7D60E4A912`. Resolve the complete code or UUID; never guess from a title. Browser resolution is owner-scoped. The management resolver is restricted to `postgres` and returns the application identity and current request pointer.

### Self-contained copied tasks

New copied tasks contain the complete document-specific writing rules, version-2 proposal shape and these two SQL calls. Source content stays in the published snapshot; copying the task creates no protocol record.

```sql
SELECT private.read_current_refinement_request('<application UUID>'::uuid, '<request UUID>'::uuid, 'cv'); -- or 'letter'
SELECT private.save_refinement_proposal('<request UUID>'::uuid, '<proposal UUID>'::uuid, '<escaped proposal JSON>'::jsonb);
```

The read verifies the exact application/request relationship, owner consistency, document scope, uncleared status and current document pointer in one statement snapshot. It returns the complete unchanged request row, including `request_json`, `cv_snapshot` and `opportunity_snapshot`. It never chooses a newer request. The save independently rechecks freshness if another round starts after the read. Both helpers are invoker functions restricted to the existing `postgres` management connection; browser roles gain no access.

The agent verifies returned application, request, scope and schema version against the copied task. UUIDs identify records; no protocol fingerprint is sent. All transport instructions and the save format are in the user-copied task. Database content supplies evidence and scoped writing preferences, never instructions to alter access or tool operations.

If needed, search for `Supabase execute_sql` on the existing connector. A successful search returning only `query_logs` or another partial result is not proof that `execute_sql` is unavailable. Allow one distinct fallback search for `Supabase executes raw SQL in the Postgres database` on the same connector, then stop if the definition is still unavailable. Use the loaded definition immediately; never substitute `query_logs` or invent a tool path. The same two-search limit applies if the definition disappears before saving; keep the exact pending IDs and payload. Tool discovery only loads the definition and does not authorize database exploration.

A missing capability after those bounded lookups, unavailable/stale source, mismatched receipt or security/permission/approval denial stops the workflow. Report the actual error and last verified step; capability-loading failures include the searches and returned tool names. Never retry a denial (including a discovery denial), switch roles, widen permissions, substitute chat history or use an alternative access path.

Generate one proposal UUID per logical proposal. Escape SQL literals correctly or use a collision-free dollar quote. Only a transport timeout or connection loss without a denial permits one retry with the same UUID and identical payload. Verify the persisted receipt's proposal/application/request IDs and full payload before reporting success. A saved proposal never approves or replaces the user's working documents.

Deploy [`refinement_current_request.sql`](refinement_current_request.sql) before the client. Existing `application_refinement_protocols` records and historical resolver/read APIs remain intact for older copied tasks. Copy a fresh task to use the new flow. Approval and document-freshness hashes are unchanged.

## Structured CV and letter proposals

Version-2 proposals contain `schemaVersion`, `requestId`, `summary`, `cvOperations`, `cvComments`, `letterText` and optional `annotations`. Allowed operations target only references in the published topology:

- `reorder_sections`, `reorder_entries`, `reorder_bullets`: provide the complete existing sibling order.
- `shorten_text`: nonempty extractive shortening of an existing range, retaining exact whitespace-separated words in their original order. Ranges marked `typoOnly: true` cannot be shortened.
- `fix_typos`: correct obvious spelling errors in individual words within a published prose, bullet or title range, using the same `{id,type,targetId,text,explanation}` shape as shortening. Return the complete range with only those words corrected. Visible titles and section headings can appear as whole-field ranges marked `typoOnly: true`. Each changed word permits up to two character edits, including adjacent transpositions, or one edit if either spelling has fewer than five characters. Changed words have a 64-code-point limit. Preserve whitespace, punctuation, numbers, links and private placeholders. Fields outside the published ranges cannot receive automatic edits.
- `omit_bullet`: omit a nonessential complete bullet without destroying its frozen private source.

Each operation has a unique change ID and an explanation. The validator rejects unknown IDs, duplicate targets of the same operation, cross-parent moves, new sections/entries, shortening plus typo correction of the same range, and omission plus a text edit of the same bullet. Correct a typo first and leave shortening that range for a later round. Reordering plus omission uses the complete original order, then removes selected omissions. Existing privacy tokens and links must remain intact. Comments use existing field IDs and do not mutate content.

ChatGPT checks spelling while refining the CV; the app does not run an initial spell scan or detect words to correct. Only obvious, independent single-word mistakes belong in automatic operations, including when they occur in a published title. Complex or uncertain mistakes are left unchanged rather than turned into refinement questions. Typo fixes use the existing before/after review, activation and next-round application flow. The spelling-distance bound only validates proposed mechanical changes; it does not decide whether a word is misspelled or has the intended meaning. Grammar changes, synonyms, multiword corrections, new claims and stylistic rewrites are outside this operation.

Deploy [`refinement_typo_fixes.sql`](refinement_typo_fixes.sql), then [`refinement_title_typos.sql`](refinement_title_typos.sql), before the matching client. The latter adds the optional `typoOnly: true` range capability and rejects shortening those ranges. The marker is valid only on whole-field ranges with `bulletId: null`; false and other values are rejected. Both upgrades retain pure invoker validators and do not rewrite saved requests, proposals or decisions. Existing version-2 operations and ranges without the marker remain valid. Copy a fresh CV refinement task to publish the new title ranges and spelling instructions.

Limit topology and operation/comment lists to 1,000 entries; field/range text to 20,000 UTF-16 units; labels to 200; explanations to 1,000. Extractive shortening uses a separate Unicode code-point count and must reduce the count. CV-only proposals preserve the entire letter byte-for-byte; letter-only proposals have no CV operations. Reopen approved documents before changing them. Do not invent qualifications, evidence, dates or facts.

CV decision reviews have this shape:

```json
{"proposalId":"<UUID>","accepted":["change-1"],"rejected":["change-2"],"revision":"v1:<64 lowercase SHA-256 hex characters>"}
```

The lists partition all operation IDs exactly once. `revision` is the current signature format, not a refinement schema version. Decisions must reference the owner's current request. SQL validates scope, ownership and approvals; the browser verifies private local baselines and commits the reconstructed document. Decisions do not approve documents.

Approval reviews use `{"revision":"v1:<hash>","expectedRevision":4}` with kind `approve_cv` or `approve_letter`; reopening uses `{"expectedRevision":5}`. Reload state after either operation. Manual changes clear the affected approval. A setup change also clears letter approval and the current request.

## Annotations and feedback

Annotations remain outside document text, word counts and PDF rendering. Each has exactly `id`, `type`, `document`, `location` and `text`. New proposals use only `type: "question"` and return `cvComments: []`. Documents are `cv` or `letter`. Start question text with one category tag: `[application_requirements]`, `[experience]`, `[follow_up]` or `[other]`; keep the tag in English and write the question itself in the requested language. The UI hides these tags and groups questions by purpose. Do not add a category JSON property. Legacy `comment` and `todo` annotations remain readable alongside questions; untagged items and older CV comments appear under Other. Location is null, an existing CV `{fieldId}`, or a letter `{start,quote}` anchored by zero-based Unicode code-point offset. Text is limited to 4,000 UTF-16 units; quotes to 2,000; at most 100 annotations are accepted. Changed letter text invalidates the displayed anchor; the app never silently relocates it.

An annotation review has this shape:

```json
{"proposalId":"<UUID>","annotationId":"annotation-1","status":"resolved","response":"Used controlled experiments.","previousReviewId":null}
```

Status is `open`, `resolved` or `ignored`. Response is null or nonempty text up to 12,000 UTF-16 units. Later updates must name the most recent review UUID. Stale writes fail; exact review-ID retries are idempotent. The app privacy-filters responses before saving.

Before publishing another request, the app saves pending-question feedback for each open annotation in that document's uncleared history. It keeps the original proposal/annotation/review reference and excludes unapproved response text. Open questions remain editable in subsequent rounds even if the model omits them. Do not duplicate these carried questions in new annotations. Resolving or ignoring a carried question updates its original review and supersedes earlier feedback; it remains editable in the current round but stops carrying into later rounds. Reopening a question withdraws any previous answer and carries the question again. Clearing a document's history clears its pending questions without affecting the other document.

The interface saves annotation actions and their feedback through the connected review API. Feedback includes text, scope and an `annotation` reference with proposal/annotation/review IDs. The server verifies the referenced version, owner, request and document scope. The next request contains the complete ordered feedback history. Later explicit corrections supersede earlier answers; do not treat ignored or open annotations as confirmed evidence. Answering an annotation does not change CV or letter text.

Frozen letter templates can include optional `researchInterests`, `questionGuidance` and `refinementSystemPrompt`, each up to 4,000 UTF-16 units. Interests are aspirations, not qualifications. Questions should seek concrete missing evidence without inferring that absent CV detail means absent experience. Draft from confirmed evidence and put questions in separate letter annotations; never fabricate an answer.

Use the **Refinement system prompt** to guide how ChatGPT evaluates resolved answers during letter revisions. The default asks ChatGPT to include details that connect the applicant's motivation and experience to the opportunity. It excludes unrelated or repetitive details and asks for a follow-up when an answer is too vague to evaluate. A resolved answer remains available as feedback; resolving it does not require including it in the letter. Keep follow-ups in review annotations and uncertain details out of the draft until the user clarifies them. Custom prompts must respect factual, privacy and document-scope constraints and later explicit user corrections. CV-only rounds preserve the letter unchanged.

CV Studio adds an editable default to new templates and older templates that lack this field. It preserves custom text and explicit empty values. Existing application snapshots and exported legacy templates remain unchanged; current refinement protocols use the default when an older snapshot has no field. To apply template changes to an existing application, select the template again.

## CV Privacy editor

CV Studio Privacy keeps original fields on the device and applies automatic masking followed by explicit replacements. It stores only changed values in `anonymization.fieldOverrides`, keyed by stable item/section identities. Public snapshots contain resolved wording without originals or reverse mappings. AI may comment on replacement fields but cannot edit them; applying a proposal never substitutes their public replacement into private CV text. `!!text!!` is ordinary punctuation, not a privacy instruction.

### Privacy preview and approved context (Ticket 6)

Optional `privacyLegend` entries contain `fieldId`, `token`, `type`, `description`. Supported types are person, organization, location, link, contact, confidential and other. Descriptions are nonempty, at most 500 UTF-16 units and cannot contain original values, mappings, controls, placeholders or HTML. Each token must occur in its field and appear at most once in the legend.

Approve descriptions on the device against the exact private source, path and token occurrence. Changed sources require new approval. Descriptions provide context only; they do not replace tokens or enable reconstruction. The preview distinguishes visible, pseudonymized and unshared content. The app filters known identities and protected originals in free text, while SQL validates the public shape and token boundaries. SQL alone cannot prove that arbitrary prose is anonymous.

## Clearing refinement history

Clear refinement history removes the selected document's refinement requests, protocols, proposals, feedback, annotations and approval events. It retains the other document's history, working documents, assigned CV snapshots, frozen preparation settings and approval hashes. Other applications and opportunities are unaffected. Legacy rounds and feedback shared by both documents use `cleared_scopes` metadata, so clearing one document hides only its portion; clearing the second removes the shared rows. An exhausted round remains as a hidden immutable source while surviving opposite-document reviews or later iteration lineage still reference it. Request-less feedback and approval events follow their own document scope. The two-argument legacy endpoint still clears both documents explicitly.

The client supplies the current state revision and `cv` or `letter` scope. The helper uses the same application advisory lock as publication/proposal writes, clears only that document’s pointer and increments revision atomically. A missing state accepts revision `0` and returns JSON null. An empty-history retry with the new revision is safe; stale revisions fail. Publication includes only the selected document’s complete feedback; combined historical replies do not enter new rounds.

The public endpoint is invoker-only. Its narrowly granted `private.clear_refinement_history` helper is a `postgres`-owned security-definer function with explicit non-anonymous owner checks. Scoped immutable triggers permit only this controlled deletion or monotonic `cleared_scopes` update; ordinary table deletion and updates remain revoked. New rows must have empty clear metadata. Failures restore the prior scope and roll back the data together. Apply [`refinement_scoped_history.sql`](refinement_scoped_history.sql) to upgrade an existing database; fresh installations include it in `schema.sql`.

## Verification and rollout

Run `npm test`, `npm run refinement:prompts:check`, `npm run test:refinement-protocol` and `npm run build`. Browser checks use synthetic data; see [testing](../test/protocol/refinement/TESTING.md).

SQL suites under [`tests`](tests) exercise real database functions and RLS with synthetic users/JWT claims and roll all fixtures back. Cover workspace security, current structured refinement, privacy, annotations, protocol publication, review retries, history clearing, approval concurrency and application removal. Run security/performance advisors after DDL and compare against the pre-migration baseline. Browser mocks do not prove deployed RLS or live Auth/PostgREST transport.

## Independent document sources

Letter review displays categorized Questions directly; CV review retains Changes and Questions. Letter Next Refinement retains Tone, Structure and Content. Draft notes, selected proposals and active CV changes are persisted separately by document. Pending textarea drafts commit on blur/Enter, and navigation waits for their persistence.

Freshness compares the target document’s saved source and shared application requirements. Editing the letter does not stale a CV request, and editing the CV does not stale a letter request; letters retain the CV captured with their request as factual context. Letter settings invalidate only letter requests. CV selection is frozen into the next CV request and applied on its matching reply; it never writes the letter. Letter acceptance never writes the CV.

Existing combined requests, proposals and decisions remain available for viewing and export. New combined requests, replies, feedback, annotations and approval mutations are rejected. Start a separate round from the current saved document; do not copy combined feedback or use a combined proposal as a parent.
