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
- Hosted startup brief: 1, bounded to 98,304 UTF-8 bytes; new-run startup automatically replaces active executions for the same authorized search.
- Current interest metric: `opportunity-interest-v2`.
- Current feedback selection: `opportunity-feedback-selection-v3`; query policy: `adaptive-query-v3`.

Current stored search revisions, verified receipts, immutable packets and application research snapshots remain independent historical records. Their retained readers protect data that exists in the current workspace; they do not enable installing obsolete database layouts.

## Runner and setup

Manual and scheduled adaptive executions use four management helpers: `private.begin_adaptive_search_brief`, `private.save_adaptive_search_item`, `private.verify_adaptive_search_item`, and `private.finish_adaptive_search`. The [startup brief](adaptive-search-brief.md) returns exact current criteria, approved rules/preferences, protected queries, source obligations, complete protocol and canonical schema in one response. It retains approved-basis and non-provisional directional planning priorities, reporting the number of omitted advisory priorities. Selected feedback IDs and order, interest evidence, structured reasons and included shared evaluation text remain intact, along with `summary_inclusion.source_length` and `summary_inclusion.truncated` when present. Research descriptions use a 240-codepoint preview with a truncation flag; verified original predictions contribute their score. Duplicate preferences, raw aggregate groups, example inclusion hashes/proof revisions and prediction provenance are omitted. Whole-set statistics and the full internal bundle/snapshots remain unchanged.

A new run UUID supersedes active executions for the same authorized owner/search within that one startup transaction; the client performs no blocker lookup or abort chain. A separately authorized new execution does not require reconciling the old run first. The old run retains committed results and receives a permanent supersession fence. Retries of an already-created run cannot supersede newer runs. If the new startup is invalid or the brief cannot fit its 96-KiB bound, the helper rolls back the replacement as well as its own startup writes, preserving the prior run and lease.

The current protocol saves one canonical opportunity with `save_adaptive_search_item(run_id,item_id,opportunity_json)`, then independently verifies that exact item with `verify_adaptive_search_item(run_id,item_id)`. The shared canonical writer, evidence validation, identity matching and merge rules remain authoritative. Saving accepts no batch wrapper, plan or checks. Stable item identities prevent duplicate writes; a validation error for a later item cannot undo earlier committed saves. Adaptive privacy boundaries and assessment provenance remain enforced.

`finish_adaptive_search(run_id,report_json)` accepts one flat report: `completion_id`, `status`, actual `query_plan`/`plan_hash`, `execution`, and optional evidence-backed suggestions. It derives the saved manifest server-side and checks persisted results and coverage before deciding the terminal status. Missing or incomplete coverage stays incomplete. The exact full report must be preserved for a permitted identical retry. Normal execution takes `2 + 2N` calls: startup, N save/verify pairs, then finish. Empty research uses startup and finish.

The outward startup protocol is the single authoritative current execution contract. Saved task text no longer overrides another protocol. The old `submit_adaptive_search_batch` and version-dispatch `verify_and_complete_adaptive_search` entrypoints reject calls with `retired_contract`; they cannot save or complete runs. Historical receipts and audit records remain readable. The internal capability identifier is retained for existing task bindings, not as an alternate saving protocol.

Criteria, feedback selection, approved planning priorities, protected queries, source obligations and the canonical schema are preserved. The new outward protocol retains their research and coverage rules. Only the instructions and helper interface for executing, saving, verifying and finishing change.

Hosted instructions use the Supabase connector directly and read the complete returned JSON as data. They do not require executable code embedded in the prompt, a particular JavaScript runtime, a storage adapter or a preflight. The local decoder remains available to repository callers and tests. Wrapper handling and local failures do not authorize broader database access, request replay or bypassing a denial.

A missing response after a dispatched save is reconciled by the normal verification call with the same run/item IDs, without resending the opportunity. Rejection, invalid contracts, pending approval and denials remain stopped. Startup and final reporting retain only their explicitly bounded identical recovery rules. The [brief response-handling rules](adaptive-search-brief.md#response-handling-and-failures) explain the distinction between local processing, missing transport and application rejection. Smaller requests cannot guarantee approval-free hosted execution.

Explicit stopping without a new execution uses the separate [versioned lifecycle operation](adaptive-search-lifecycle.md). It is optional for ordinary startup. Research never invents empty completion manifests as cancellation, and database fencing does not establish external worker termination.

Internal limits remain 30 queries, 64 sources, 128 checks, 64 backlog entries, a 512-KiB report, a 256-KiB bundle and 64-KiB feedback packet. The outward brief has its own 96-KiB bound. New recommendations require at least 72 hours before the verified deadline. Query/source execution claims need actual checks; saved plans do not provide execution credit. Delivery remains unknown. Unchanged or empty runs stay quiet.

The historical paging transport has a separately testable [offline reference implementation and diagnosis](adaptive-search-startup-diagnostics.md). Current hosted instructions do not use its collector, checkpoint adapter or nonce preflight. Current saved instructions no longer embed or require that codec. Existing tasks must receive a fresh setup update to use the direct connector workflow and current helpers. Source fingerprints and offline tests cannot confirm hosted response retention or resolve an approval, permission or safety denial.

Setup is separate from daily execution. The owner-checked readiness API and exact setup UUID identify the current operation. `private.read_adaptive_search_setup` returns the safe handoff; `private.ack_adaptive_search_setup` records an actual successful task-tool receipt. A lost response may retry the exact acknowledgement. Neither helper belongs to the daily runner allowlist.

Current explicit runner modes and feature rollback remain supported. Changing mode requires the appropriate owner action and a real task acknowledgement. Release enablement, owner runner authorization, adaptation, pause and source reuse are independent controls. Saving intent, generating prompts and installing schema do not acknowledge a task change or enable a run.

For the reviewed existing database, deploy the guarded [current save-protocol upgrade](../supabase/releases/adaptive-search-current-saves-v1.sql) from the inline-codec predecessor. It installs one save/verify/finish protocol, retires the previous saving/completion entrypoints, and replaces mandatory hosted code with direct connector instructions. The guard rejects an unexpected baseline. It preserves saved opportunities, feedback, criteria, pinned contexts and schedules; the fresh installer must not be used as an upgrade.

After deployment, refresh the existing ChatGPT task once through its scoped setup handoff, then confirm the task update and Supabase acknowledgement. Deployment does not rewrite the saved task. Keep its binding and cadence. An old prompt will receive a retired-contract rejection; there is no automatic historical write fallback.

Earlier release files are immutable deployment history. They document lifecycle fencing, the single brief, supersession, diagnostics, standalone saves, the 96-KiB bound and the hosted/inline codec iterations. Their obsolete writing instructions are not current contracts. Historical database tests restore predecessor functions only inside explicit isolated fixtures.

The [startup logging upgrade](../supabase/releases/adaptive-search-startup-logging-v1.sql) remains relevant diagnostic history. [Startup logs](adaptive-search-brief.md#startup-logs) explains how to correlate a run UUID, distinguish a returned result from a commit, and inspect local decoder console records when that decoder actually executes.

The [deferred-receipt correction](../supabase/releases/adaptive-search-deferred-receipts-v1.sql) follows the current save-protocol upgrade. It clarifies saved versus unresolved receipts in the startup-loaded protocol and stops misclassifying unrelated check constraints as insufficient evidence. It changes neither the recurring task text nor the criteria, feedback, planning, schema or privileges. An already-updated task receives this clarification at its next startup without another setup paste.

## Verification

```sh
npm run test:database
npm test
npm run build
```

Database tests install the current schema directly into a labelled, network-disabled disposable PostgreSQL 17 container. Fixtures contain synthetic users and research. Verification covers current canonical intake, ownership/RLS, private feedback projection, scoped application/refinement actions, scheduling, interest scoring and adaptive execution. Targeted lifecycle, brief and supersession upgrade tests cover their supported preceding baseline, retained records and role restrictions; this is not a general historical migration matrix.
