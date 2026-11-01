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

A new run UUID supersedes active executions for the same authorized owner/search within that one startup transaction; the client performs no blocker lookup or abort chain. The old run retains committed results and receives a permanent supersession fence. Same-UUID retries cannot supersede newer runs. If the new startup is invalid or the brief cannot fit its 64-KiB bound, the helper rolls back the replacement as well as its own startup writes, preserving the prior run and lease.

Batch acknowledgement is pending verification; completion independently verifies the sorted full manifest and reads the persisted summary. One run uses `2 + B` calls for B batches: startup, batches and completion. Execution permits at most 32 batches and 10 opportunities per batch. The runner keeps its stable run UUID, complete response and accepted receipts in the execution context; local persistent capture is optional. Only runtime-confirmed dispatch with no received response permits one identical retry. Explicit stopping without a new execution uses the separate [versioned lifecycle operation](adaptive-search-lifecycle.md). It is optional for ordinary startup. Research never invents empty completion manifests as cancellation, and database fencing does not establish external worker termination.

Internal limits remain 30 queries, 64 sources, 128 checks, 64 backlog entries, a 512-KiB report, a 256-KiB bundle and 64-KiB feedback packet. The outward brief has its own 64-KiB bound. New recommendations require at least 72 hours before the verified deadline. Query/source execution claims need actual checks; saved plans do not provide execution credit. Delivery remains unknown. Unchanged or empty runs stay quiet.

The historical paging transport has a separately testable [offline reference implementation and diagnosis](adaptive-search-startup-diagnostics.md). Current hosted instructions do not use its collector, checkpoint adapter or nonce preflight. Source fingerprints and offline tests cannot confirm hosted response retention or resolve an approval, permission or safety denial.

Setup is separate from daily execution. The owner-checked readiness API and exact setup UUID identify the current operation. `private.read_adaptive_search_setup` returns the safe handoff; `private.ack_adaptive_search_setup` records an actual successful task-tool receipt. A lost response may retry the exact acknowledgement. Neither helper belongs to the daily runner allowlist.

Current explicit runner modes and feature rollback remain supported. Changing mode requires the appropriate owner action and a real task acknowledgement. Release enablement, owner runner authorization, adaptation, pause and source reuse are independent controls. Saving intent, generating prompts and installing schema do not acknowledge a task change or enable a run.

For an existing database, review the [lifecycle upgrade](../supabase/releases/adaptive-search-lifecycle-v1.sql) first, then the [brief upgrade](../supabase/releases/adaptive-search-brief-v1.sql), followed by the [supersession upgrade](../supabase/releases/adaptive-search-supersession-v1.sql). Deploy only under deployment authorization. After deployment, replace the saved recurring prompt once per existing automation through its scoped setup handoff. Keep its task binding and cadence. Installing the upgrade does not itself start or supersede a run; that occurs on the next authorized new startup.

## Verification

```sh
npm run test:database
npm test
npm run build
```

Database tests install the current schema directly into a labelled, network-disabled disposable PostgreSQL 17 container. Fixtures contain synthetic users and research. Verification covers current canonical intake, ownership/RLS, private feedback projection, scoped application/refinement actions, scheduling, interest scoring and adaptive execution. Targeted lifecycle, brief and supersession upgrade tests cover their supported preceding baseline, retained records and role restrictions; this is not a general historical migration matrix.
