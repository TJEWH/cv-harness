# Current database and adaptive search contract

The repository describes the current database state. It does not replay retired schema versions or catalogue conversions. Historical implementation and deployment records remain in Git and the database migration history.

## Schema ownership

Edit the ordered SQL modules listed in `supabase/schemas/manifest.json`. Generate the atomic installer and refresh the current source fingerprints:

```sh
npm run db:schema:write
npm run db:schema:check
npm run adaptive:release:write
npm run adaptive:release:check
```

`supabase/schema.sql` installs the complete current workspace into an empty database with Supabase Auth available. The installer includes application/refinement APIs, canonical opportunity storage, search and adaptive search, ownership policies, grants, and current protocol reference data. Each object has one final definition.

The current manifest is [`supabase/releases/current.json`](../supabase/releases/current.json). It fingerprints the installer, ordered source modules, canonical JSON contract, and frontend runner sources. It is source evidence, not proof of a database deployment or a successful scheduled run. Existing database changes require a targeted migration derived from the schema difference; the fresh installer is not an upgrade script.

## Current contracts

- Canonical opportunity schema: 6; protocol: `opportunity-search-v1-canonical-6`.
- Shared meta-search document: 1; adaptive capability: `adaptive-batch-v1`.
- Hosted startup brief: 1, bounded to 65,536 UTF-8 bytes; new-run startup automatically replaces active executions for the same authorized search.
- Current interest metric: `opportunity-interest-v2`.
- Current feedback selection: `opportunity-feedback-selection-v3`; query policy: `adaptive-query-v3`.

Current stored search revisions, verified receipts, immutable packets and application research snapshots remain independent historical records. Their retained readers protect data that exists in the current workspace; they do not enable installing obsolete database layouts.

## Runner and setup

Manual and scheduled adaptive executions use three management helpers: `private.begin_adaptive_search_brief`, `private.submit_adaptive_search_batch`, and `private.verify_and_complete_adaptive_search`. The [startup brief](adaptive-search-brief.md) returns exact current criteria, approved rules/preferences, protected queries, source obligations, complete protocol and canonical schema in one response. It retains approved-basis and non-provisional directional planning priorities, reporting the number of omitted advisory priorities. Selected feedback IDs and order, interest evidence, structured reasons and included shared evaluation text remain intact, along with `summary_inclusion.source_length` and `summary_inclusion.truncated` when present. Research descriptions use a 240-codepoint preview with a truncation flag; verified original predictions contribute their score. Duplicate preferences, raw aggregate groups, example inclusion hashes/proof revisions and prediction provenance are omitted. Whole-set statistics and the full internal bundle/snapshots remain unchanged.

A new run UUID supersedes active executions for the same authorized owner/search within that one startup transaction; the client performs no blocker lookup or abort chain. A separately authorized new execution does not require reconciling the old run first. The old run retains committed results and receives a permanent supersession fence. Retries of an already-created run cannot supersede newer runs. If the new startup is invalid or the brief cannot fit its 64-KiB bound, the helper rolls back the replacement as well as its own startup writes, preserving the prior run and lease.

The hosted runner saves each found opportunity independently through `private.submit_adaptive_search_batch(run_id, item_id, opportunity_json)`. The third argument is one canonical opportunity, with no batch wrapper, query plan, execution checks, attribution or suggestions. Its receipt contains the exact item identity and remains pending independent verification. Validation and canonical merging are unchanged. A confirmed unsaved `invalid_opportunity` with `correction_allowed=true` permits one evidence-based correction under the same item ID; an accepted ID cannot be reused with changed data. Rejected candidates remain in the final unresolved backlog rather than preventing other valid opportunities from being saved.

The final call uses `private.verify_and_complete_adaptive_search` with `schema_version:2`, `action:"finish"`, a stable `completion_id`, requested `status`, and `coverage`. Coverage is the existing first-batch report shape with `opportunities:[]`, the actual plan and checks/backlog. The server records coverage, derives the complete manifest and independently verifies canonical saves before deciding terminal status. An invalid report does not undo opportunities committed by earlier calls. Missing/incomplete coverage cannot become successful research. Normal execution takes `2 + N` calls for N opportunities: startup, N saves and one finish (eight calls for six opportunities; two for an empty search). There is no routine receipt or manifest retrieval chain.

An explicit `action:"verify_item"` with the saved `item_id` can independently verify an accepted opportunity when reporting fails without a denial; this does not close the run. Source/query attribution is not invented for standalone saves. Canonical evidence and original assessment feedback are retained, while verified discoveries without check references remain unattributed. Existing wrapped batches remain supported for clients supplying actual attribution or reusable-listing evidence. Legacy batches retain their 32-batch, 10-item and 512-KiB bounds. Direct items are limited to 256 KiB and the run-wide total remains at most 320 adaptive items.

Only post-found execution instructions change. Startup construction, feedback selection, criteria, protected queries, source obligations, canonical schema and the pinned research protocol stay unchanged. The saved task explicitly overrides the old save/completion payload shapes while preserving their research and coverage rules.

Capture the complete raw response before decoding or displaying excerpts, then retain the decoded result separately with stable UUIDs and accepted receipts. Local persistent capture is optional. Decode plain `{text: ...}` wrappers even without a type tag, as well as MCP text, serialized JSON and result/data/structured-content wrappers. Require exactly one row with the correct column for the action: `startup`, `submit_adaptive_search_batch` or `verify_and_complete_adaptive_search`. Require the full startup contract and active lease before research. Report exact `error.code` and any additive `diagnostics.stage`/`diagnostics.sqlstate` on batch failures; these safe labels locate the failure without exposing payloads or full database error text.

For startup or completion only, one identical retry remains available after runtime-confirmed dispatch with no received response. Batch writes are not automatically replayed. Startup also permits a reread when its compatible acceptance for the exact scope/UUID was observed, the complete response was subsequently lost locally, and no batch has been sent. This uses the same single startup retry budget and identical request, without a new helper, replacement UUID or lease renewal. Inspect retained data locally first. Unknown acceptance blocks local-loss rereads; invalid contracts and approval/permission/safety denials stay stopped; the explicit confirmed-unsaved canonical correction above is the only data-rejection exception; ordinary local decoding failure is not a general retry condition. The [brief response-handling rules](adaptive-search-brief.md#response-handling-and-failures) define this narrow recovery case.

When a dispatched save's receipt is missing or lost locally, one exceptional `private.submit_adaptive_search_batch(run_uuid,item_uuid,NULL::jsonb)` call can reconcile that exact receipt without resending the payload or creating a save. Existing wrapped batches use their exact batch UUID instead. Reinspect retained data first, and do not reconcile after an observed rejection or invalid contract, or while approval is known to be pending or denied. A recovered receipt remains pending independent verification; `batch_not_found` requires stopping, not assuming transport loss or resubmitting. This adds no helper or normal follow-up request. Smaller payloads do not guarantee approval-free execution, and blocked or denied calls must not be retried, split or rerouted to circumvent approval.

Explicit stopping without a new execution uses the separate [versioned lifecycle operation](adaptive-search-lifecycle.md). It is optional for ordinary startup. Research never invents empty completion manifests as cancellation, and database fencing does not establish external worker termination.

Internal limits remain 30 queries, 64 sources, 128 checks, 64 backlog entries, a 512-KiB report, a 256-KiB bundle and 64-KiB feedback packet. The outward brief has its own 64-KiB bound. New recommendations require at least 72 hours before the verified deadline. Query/source execution claims need actual checks; saved plans do not provide execution credit. Delivery remains unknown. Unchanged or empty runs stay quiet.

The historical paging transport has a separately testable [offline reference implementation and diagnosis](adaptive-search-startup-diagnostics.md). Current hosted instructions do not use its collector, checkpoint adapter or nonce preflight. ChatGPT follows its saved recurring prose rather than automatically running the repository's TypeScript decoder; changing that decoder alone does not update hosted instructions. Source fingerprints and offline tests cannot confirm hosted response retention or resolve an approval, permission or safety denial.

Setup is separate from daily execution. The owner-checked readiness API and exact setup UUID identify the current operation. `private.read_adaptive_search_setup` returns the safe handoff; `private.ack_adaptive_search_setup` records an actual successful task-tool receipt. A lost response may retry the exact acknowledgement. Neither helper belongs to the daily runner allowlist.

Current explicit runner modes and feature rollback remain supported. Changing mode requires the appropriate owner action and a real task acknowledgement. Release enablement, owner runner authorization, adaptation, pause and source reuse are independent controls. Saving intent, generating prompts and installing schema do not acknowledge a task change or enable a run.

For an existing database, install missing upgrades in order: [lifecycle](../supabase/releases/adaptive-search-lifecycle-v1.sql), [brief](../supabase/releases/adaptive-search-brief-v1.sql), [supersession](../supabase/releases/adaptive-search-supersession-v1.sql), [response handling](../supabase/releases/adaptive-search-response-handling-v1.sql), [incremental saves](../supabase/releases/adaptive-search-incremental-saves-v1.sql), then [batch diagnostics](../supabase/releases/adaptive-search-batch-diagnostics-v1.sql). Review and deploy under deployment authorization. The incremental-saves upgrade replaces the recurring prompt, batch-error formatter and batch helper. It adds no helper, changes no saved task or run data, and triggers no research. Run supersession occurs only on an authorized new startup.

The batch-diagnostics upgrade adds one nullable run metadata column and an internal schema-path locator, and updates batch rejection handling. It retains bounded stage/SQLSTATE and known field paths on authorized active-run validation failures. It stores no rejected payloads, backfills no failures and changes no run status or schedule. Existing owner-read and management-write restrictions remain in force. This server-only upgrade needs no new recurring prompt or extra research request.

The subsequent [evidence-field guidance upgrade](../supabase/releases/adaptive-search-evidence-fields-v1.sql) changes only the hosted brief function. It appends the accepted canonical roots for `sources[].supports`, matching the existing validator, to the returned protocol text. The internal pinned protocol, schema, validation rules, saved recurring prompt and access remain unchanged. Existing tasks need no prompt refresh. The guarded upgrade is tested with a pre-existing active run and identical startup recovery.

The [standalone-save upgrade](../supabase/releases/adaptive-search-standalone-saves-v1.sql) follows evidence-field guidance. It changes only opportunity intake, receipt verification, completion and the technical save instructions. Its guarded schema change allows adaptive items without an execution batch and adds a direct cascading run foreign key. Immutable accepted items, old batch receipts and historical manifest hashes remain valid. It adds private internal helpers without granting them to application roles, triggers no research and changes no schedule.

After deploying a changed recurring prompt, refresh it once per existing ChatGPT automation through its scoped setup handoff, then confirm the task update and Supabase acknowledgement. Response handling, incremental saves and standalone saves require this refresh even when the task already uses the brief helper. Deployment does not rewrite an already-saved task. Keep the same task binding and cadence. Automatic replacement remains server behavior; capture, decoding, one-opportunity saves and recovery depend on the saved instructions.

## Verification

```sh
npm run test:database
npm test
npm run build
```

Database tests install the current schema directly into a labelled, network-disabled disposable PostgreSQL 17 container. Fixtures contain synthetic users and research. Verification covers current canonical intake, ownership/RLS, private feedback projection, scoped application/refinement actions, scheduling, interest scoring and adaptive execution. Targeted lifecycle, brief and supersession upgrade tests cover their supported preceding baseline, retained records and role restrictions; this is not a general historical migration matrix.
