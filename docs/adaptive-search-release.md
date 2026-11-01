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
- Current interest metric: `opportunity-interest-v2`.
- Current feedback selection: `opportunity-feedback-selection-v3`; query policy: `adaptive-query-v3`.

Current stored search revisions, verified receipts, immutable packets and application research snapshots remain independent historical records. Their retained readers protect data that exists in the current workspace; they do not enable installing obsolete database layouts.

## Runner and setup

The daily adaptive runner uses three management helpers: `private.begin_adaptive_opportunity_search`, `private.submit_adaptive_search_batch`, and `private.verify_and_complete_adaptive_search`. Fixed projections of the startup helper return a manifest and bounded pages of the complete current bundle under one run UUID. The context section is assembled first and includes current criteria, protected queries and source obligations. Planning, protocol, schema and feedback follow. Each page contains at most 4,096 UTF-8 bytes encoded as Base64, and all pages carry the same bundle hash plus their section hash, byte length and page identity. The caller verifies and retains all five sections before research. A missing, corrupt or changed page cannot silently become a partial startup.

Batch acknowledgement is pending verification; completion independently verifies the sorted full manifest and reads the persisted summary. One run uses `2 + N + B` calls for N startup pages and B batches: manifest, pages, batches and completion. Startup permits at most 70 pages, and execution permits at most 32 batches and 10 opportunities per batch. Ordinary page reads remain separate from the one identical retry allowed after a genuinely lost response. Local checkpoint preflight happens before creating a run; a verified compatible manifest establishes the exact scope for closing an abandoned run as failed before any batch request, through the same completion helper with an empty manifest.

Limits remain 30 queries, 64 sources, 128 checks, 64 backlog entries, a 512-KiB report, a 256-KiB bundle and 64-KiB feedback packet. New recommendations require at least 72 hours before the verified deadline. Query/source execution claims need actual checks; saved plans do not provide execution credit. Delivery remains unknown. Unchanged or empty runs stay quiet.

Startup recovery has a separately testable [offline reference implementation and diagnosis](adaptive-search-startup-diagnostics.md). The hosted task receives instructions and SQL templates; it does not automatically execute the repository's TypeScript collector or checkpoint adapter. Source fingerprints and offline tests cannot confirm hosted checkpoint retention or resolve an approval, permission or safety denial.

Setup is separate from daily execution. The owner-checked readiness API and exact setup UUID identify the current operation. `private.read_adaptive_search_setup` returns the safe handoff; `private.ack_adaptive_search_setup` records an actual successful task-tool receipt. A lost response may retry the exact acknowledgement. Neither helper belongs to the daily runner allowlist.

Current explicit runner modes and feature rollback remain supported. Changing mode requires the appropriate owner action and a real task acknowledgement. Release enablement, owner runner authorization, adaptation, pause and source reuse are independent controls. Saving intent, generating prompts and installing schema do not acknowledge a task change or enable a run.

## Verification

```sh
npm run test:database
npm test
npm run build
```

Database tests install the current schema directly into a labelled, network-disabled disposable PostgreSQL 17 container. Fixtures contain synthetic users and research. Verification covers current canonical intake, ownership/RLS, private feedback projection, scoped application/refinement actions, scheduling, interest scoring and adaptive execution. There is no historical bootstrap or migration-prefix test matrix.
