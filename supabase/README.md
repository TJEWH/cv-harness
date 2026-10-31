# Supabase workspace

Supabase supplies the shared opportunity catalogue, private applications and [connected document refinement](REFINEMENT.md). Local CV editing and PDF export work without an account. The connected workspace is **phd-workflow** (`ehkfzvjgesomteqpwrwa`).

This repository defines the current database state. Earlier installation chains, catalogue conversions and migration-only rollback helpers are retired; their source remains in Git and deployed migration history remains in Supabase.

## Source layout

| Path | Responsibility |
| --- | --- |
| `schemas/manifest.json` | Ordered SQL source modules. |
| `schemas/*_support.sql` | Current document, opportunity and search functions that do not require composite table arguments. |
| `schemas/*_tables.sql` | Current tables, columns and defaults. |
| `schemas/*_api.sql` | Current APIs with table-shaped arguments or results. |
| `schemas/40_relations.sql` | Keys, indexes and constraints. |
| `schemas/50_triggers.sql` | Current capture, validation and privacy triggers. |
| `schemas/60_security.sql` | RLS policies and explicit grants. |
| `schemas/70_reference_data.sql` | Current protocol and disabled-by-default release configuration. |
| `schema.sql` | Generated atomic fresh-install SQL. |
| `contracts/opportunity.schema.json` | Canonical opportunity schema 6. |
| `releases/current.json` | Current schema, contract and runner fingerprints. |
| `tests/` | Current database contract assertions. |

Edit the owning module. Do not hand-edit `schema.sql` or add another definition of an existing function at its end. Generate and check the installer:

```sh
npm run db:schema:write
npm run db:schema:check
npm run adaptive:release:write
npm run adaptive:release:check
```

The ordered source and generated installer are checked together. The installer uses one transaction and refuses to replace an existing application workspace. Function bodies are retained verbatim from the deployed catalogue, including significant string-literal bytes; cross-function definitions are validated through installation and contract tests.

## Existing and fresh databases

Use `schema.sql` only for an empty database with Supabase Auth available. The isolated test harness provides synthetic Auth roles/functions before installing the complete current workspace. It does not load a historical bootstrap or step through older releases.

For an existing workspace, edit the desired module, inspect the resulting difference and prepare a targeted migration. Preserve records, ownership, foreign keys, RLS, function execution rights and independently captured research. Never substitute the fresh installer for an upgrade. Schema and data changes must be verified against current contracts before deployment.

Obsolete catalogue-format archives and the old `opportunity_history` table are not part of a fresh install. Historical rows in the existing workspace remain preserved; they are not application API dependencies. Current per-run research audit, merge rollback, explicit runner-mode changes and task acknowledgement remain supported operations.

## Data and access boundaries

- The catalogue accepts the closed current canonical contract. Generated frontend types and SQL storage/intake contracts are checked against the same JSON schema.
- Applications own independent research snapshots, checklist completion, status history and document workflow state. Research updates do not replace frozen application material automatically.
- CV rows contain immutable privacy-filtered snapshots. Full private CVs, working letters and supporting file bytes remain local unless explicitly shared through the current workflow.
- Application notes and technical issue text remain private. Feedback derives safe, bounded evaluation excerpts under current per-opportunity exclusion and full-source safeguards.
- RLS stays enabled on all application tables. Browser access uses explicit owner policies and narrow grants; private administrative helpers remain outside the browser API.
- Current document requests use outer `schemaVersion: 2`. Their inner CV/structured-CV version 1 objects are current formats, not retired request payloads.

The initial consolidation was verified against deployed function definitions, table permissions, policies, constraints and triggers, and against an independent PostgreSQL schema reinstall. PostgreSQL 17 control-character constraint literals are represented explicitly so text tools cannot change carriage-return behavior.

## Verification

Start the isolated PostgreSQL fixture if it is not already running:

```sh
docker run --detach --name cv-adaptive-feedback-test \
  --label cv-builder.test-suite=adaptive-feedback --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=adaptive_feedback_test postgres:17.6
```

Then run the current contracts and application checks:

```sh
npm run test:database
npm test
npm run build
```

Database suites use synthetic records in a labelled, network-disabled PostgreSQL 17 container, with no host bind mounts or published ports. The harness checks its target and exclusive lock before resetting the disposable database. Tests install the complete current schema and cover current canonical intake, ownership/privacy, application/refinement actions, feedback, scheduling and adaptive execution.

The database transaction tests also verify that a failed fresh install leaves no partial application tables. Unit and component tests check frontend readers, generated types, prompt contracts and persistence behavior. Read the [testing guide](../test/REFINEMENT_TESTING.md) and [current release contract](../docs/adaptive-search-release.md) for the remaining checks.
