# Optional Supabase workspace

The app is a static frontend. Supabase supplies the shared opportunity catalogue, private applications and [connected CV/letter
refinement](REFINEMENT.md). Local CV editing and PDF export work without an account.

Deploy to **phd-workflow** (`ehkfzvjgesomteqpwrwa`) with the matching GitHub Pages environment.
The user authorized deletion of the unused **Test** project (`vhkfrseocgiqxshrbevd`). Deletion awaits browser login; the project still exists.

## Opportunity merge protocol

The current catalogue uses [canonical schema 6](opportunity_schema_v6.json) and protocol `opportunity-search-v1-canonical-6`. Apply [`opportunity_description.sql`](opportunity_description.sql) once after the canonical v5 and adaptive-search upgrades. It removes redundant suitability fields and moves useful existing reasons/features into “Unique selling points” at the end of `research_summary`, including frozen application descriptions. It preserves IDs, timestamps, reviews and application workflow state, and privately archives before/after representations. See [the contract and isolated upgrade tests](../docs/opportunity-merge.md).

The earlier [`opportunity_canonical_v5.sql`](opportunity_canonical_v5.sql) conversion remains an installation prerequisite and historical test fixture. Do not replay historical conversions over the current catalogue.

Apply [`application_removal_review.sql`](application_removal_review.sql) before rolling out the delete-only application action. Removal preserves the opportunity's review state, rating, reasons and evaluation; it remains owner-scoped and safe to retry.

Then apply [`opportunity_evaluation.sql`](opportunity_evaluation.sql) before rolling out the single-field evaluation editor. It merges existing comment/summary text once without truncation, removes the second backing field and approval APIs, and keeps the complete evaluation in `comment` with a server-maintained `evaluation_revision`. Search excerpts are derived from that value under the current exclusion and content-safety rules. The limit is 12,000 Unicode codepoints; pending browser drafts migrate once into the current recovery key.

Apply [`opportunity_feedback_defaults.sql`](opportunity_feedback_defaults.sql) after the evaluation upgrade. It includes feedback by default, with one per-opportunity exclusion control, and removes the retired search-level sharing setting, consent metadata and APIs. It preserves saved reviews and independent adaptation, pause, source-reuse and runner controls.

Apply [`opportunity_interest_v2.sql`](opportunity_interest_v2.sql) after the current feedback/defaults, payload and schedule upgrades, before rolling out the Very high interest choice. It adds the choice and evaluation reasons, derives current feedback as Low 2, Medium 6, High 8, Very high/application 9 and confirmed submission 9.5, and retires numeric overrides from current scoring. Existing reviews, application records and historical packets remain intact; deleting an application reveals its saved opportunity choice again. The upgrade preserves owner permissions and marks current feedback/plans for refresh at the next authorized run. This upgrade was installed in **phd-workflow** on **2026-10-31** as migration `20261031222038` (`opportunity_interest_v2`). Live verification found zero scoring or origin mismatches across all 202 review/application outcomes; all 202 reviews and 32 applications, historical snapshots and function permissions retained identical checksums. Security advisors introduced no new findings.

Run `node --import tsx --test test/opportunityFeedback/interestV2.test.ts` against the labelled, network-disabled fixture described in [the feedback test guide](../docs/opportunity-feedback-signals.md). It verifies the upgrade preserves records, snapshots and grants; application creation/submission/removal restores the saved choice; both current implementations emit identical packet content; and dashboard/quality scores use the same convention.

These upgrades were installed in **phd-workflow** on **2026-10-30**:

| Upgrade | Installed migration |
| --- | --- |
| Preserve reviews on application removal | `20261030102407` (`application_removal_preserve_review`) |
| Canonical description and schema 6 | `20261030112942` (`opportunity_description_v6`) |
| One evaluation backing field | `20261030120800` (`opportunity_evaluation`) |
| Default feedback with opportunity exclusion | `20261030141421` (`opportunity_feedback_defaults`) |

Production verification found 199 valid schema-6 opportunities, no missing migrated reasons/features, and unchanged workflow state for all 31 applications. All 195 evaluations exactly match the expected lossless merge; review states, ratings, revisions and unrelated fields are unchanged. The deployed storage and intake schemas exactly match the current frontend, and authenticated owner readiness passes.

The connector received the schema, evaluation and feedback-default upgrades in postgres-only staging parts. Both original-source and executed-body SHA-256 checks passed before each atomic application; the staging tables were removed on success. Do not replay these installed one-time migrations.

The feedback-default cutover removed all three retired settings columns, both consent RPCs and every current function reference to the old contract. Its transaction guards verified unchanged reviews, applications and independent control state. The application checksum still matches all 31 existing records. Security advisors introduced no new findings.

## Adaptive search release (AF-01–AF-11)

The adaptive feedback system is prepared as additive, owner-scoped upgrades. It has **not been deployed or scheduled** by this implementation. Use the [release guide](../docs/adaptive-search-release.md) and [ordered SHA-256 manifest](adaptive-search-release.json) for prerequisites, verification, privacy cleanup and feature rollback.

Existing canonical v5 workspaces apply only the manifest's `existing_workspace_upgrade` files after prerequisite review. Do not replay `schema.sql`, historical bootstrap, v4/v5 conversion or catalogue backfills. The pinned bootstrap under `test/` is a local synthetic-fixture prerequisite, not a production upgrade. Release enablement, owner runner authorization, adaptation and source reuse start off; eligible feedback is included unless its opportunity is excluded; task mode changes only after an explicit real task-tool acknowledgement.

Run `npm run adaptive:release:check` for source verification and `npm run test:adaptive-search-release` for the labelled, network-disabled PostgreSQL 17 fixture. The integration gate checks original-column preservation, invoker/RLS boundaries, revocation/deletion, old/new callers and the three-call / `2 + B` workflow. Real deployment and an unattended scheduled smoke test require separate authorization.

## Storage and workflow boundaries

**CV Studio** maintains CV variants, letter templates and attachments. Applications have Preparation, Refinement, Attachments and
Tracking stages. Selecting templates freezes independent working copies. Save the displayed CV in Refinement as a new independent variant, including selected proposal changes, before or after approval.

Complete CVs, letters and private reconstruction data stay in LocalStorage. Attachment files, package arrangements and
archived PDFs use IndexedDB. Cloud records cannot restore private originals on another device. CV, template and file/package backups
are separate.

Refinement publishes privacy-filtered sources for the selected document. **Copy task** / **Copy feedback** prepares a connected ChatGPT
handoff; **Sync** applies a valid current-snapshot proposal. You can correct wording, resolve annotations and approve each document.
Reopen approved documents before editing. In Attachments, assemble local PDFs, then submit and track the application by hand.

The attachment library shares explicitly saved names, descriptions and attachment/owner IDs. File bytes and file-derived metadata stay
local. There is no Storage bucket or cloud application-attachment table. To export a metadata-only entry, add its file on this device.

## Setup

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, using
   the root [`.env.example`](../.env.example). Use a publishable key, never a secret
   or `service_role` key. Restart Vite after changes. You can also use the existing `NEXT_PUBLIC_*`
   equivalents. Configure the same values in the deployment environment.
2. For a **new database**, apply [`schema.sql`](schema.sql) once. It contains the
   current table baseline and excludes retired standalone drafting APIs. Search protocol functions/settings require their separate protocol installation, followed by the reviewed v4 and canonical v5 upgrades. Never replay this setup over an existing workspace.
3. For an **existing database**, inspect its applied migrations and deployed
   definitions before applying missing changes. Follow the schema maintenance guidance below.
   The document-scoped history UI requires [`refinement_scoped_history.sql`](refinement_scoped_history.sql)
   before frontend rollout. This additive upgrade adds clear metadata and the
   three-argument `clear_refinement_history` RPC while preserving the legacy endpoint.
   Separate CV and letter rounds require [`refinement_document_rounds.sql`](refinement_document_rounds.sql)
   before frontend rollout. It adds independent current-request pointers and scoped
   protocol resolution. Without it, the client cannot verify loaded refinement state.
   Self-contained refinement tasks require [`refinement_current_request.sql`](refinement_current_request.sql)
   before frontend rollout. This adds a management-only verified read without changing saved data.
   The Tracking tab's Reset history button requires
   [`application_history_reset.sql`](application_history_reset.sql) before frontend rollout.
   Installing it leaves existing history intact; an owner's explicit reset retains
   only the current status and its original recorded time.
   [`application_tracking_navigation.sql`](application_tracking_navigation.sql) keeps
   Tracking navigation and history resets from automatically assigning Ready.
   [`refinement_typo_fixes.sql`](refinement_typo_fixes.sql) enables bounded spelling
   corrections in automatic CV operations; apply it before the matching client.
   [`refinement_title_typos.sql`](refinement_title_typos.sql) adds spelling-only
   ranges for visible titles and section headings. Apply it after the typo-fix
   upgrade and before the matching client; existing range shapes remain valid.
   Meta-research autosave requires [`opportunity_meta_search_autosave.sql`](opportunity_meta_search_autosave.sql)
   on the existing search-protocol installation. It adds the complete prompt JSONB and an owner-only atomic save RPC.
   Schedule replacement reads the saved prompt once and uses ChatGPT task tools; it does not create a research run.
4. Provision existing email/password users through Supabase Authentication. The
   app has no signup or recovery flow. For this restricted workspace, keep public
   signup disabled and configure recovery, rate limits and password protection.
5. Maintain `public.opportunities` through trusted administrative tooling. The
   frontend reads shared research and changes only the signed-in owner's records.

## Schema maintenance

Migration `20261016105328` (`revert_refinement_history_checkpoints`) rolled back
the unsuccessful `20261016101949` history-restoration upgrade on **phd-workflow**
on 2026-10-16. It restored the previous refinement functions and removed the
checkpoint RPCs, event table and metadata columns. No restores or suffix replacements
had been committed. Checksums confirmed that existing refinement state, request,
proposal and review records were unchanged, excluding removed feature metadata.
Document-round, history-clear and annotation ownership/concurrency SQL suites passed
both during the rollback rehearsal and against the restored backend. The frontend
and fresh-install schema had already been reverted. The one-time rollback is retained
in [`revert_refinement_history_checkpoints.sql`](revert_refinement_history_checkpoints.sql);
do not apply it to a fresh database or rerun it after a successful rollback.

Migration `20261015204852` (`refinement_title_typos`) was applied to **phd-workflow**
on 2026-10-15 (Europe/Tirane). Checks inside the transaction verified title spelling
corrections, shortening rejection, legacy range compatibility and validator
permissions. The title, spelling and structured-refinement SQL suites passed after
deployment; synthetic records were rolled back. Security advisors reported no new
findings.

Migration `20261015192133` (`refinement_typo_fixes`) was applied to **phd-workflow**
on 2026-10-15 (Europe/Tirane). Checks inside the migration verified spelling limits,
Unicode, protected content, conflicting operations and helper permissions before
commit. The live structured-refinement suite also verified persistence of a typo
proposal and rolled back its synthetic records. No stored documents were rewritten;
security and performance advisors reported no new findings.

Migration `20261013231626` (`refinement_current_request`) was applied to
**phd-workflow** on 2026-10-14 (Europe/Tirane). Live rollback tests verified exact
application/request/scope matching, unchanged source context, management-only
access, superseded requests, save-time freshness and independent document reads.
Existing protocol records and document acceptance behavior remain unchanged.

Migration `20261013212905` (`refinement_document_rounds`) was applied to
**phd-workflow** on 2026-10-13. The live rollback suite passed independent CV/letter
publication, scoped protocol resolution, stale approvals, feedback isolation,
history clearing and ownership checks. Before/after checksums confirmed unchanged
applications, CV snapshots, requests, proposals, reviews and refinement settings;
only the intended request pointers changed, matching the expected backfill.

[`schema.sql`](schema.sql) is the current fresh-install baseline. Find historical upgrade scripts in Git and deployed migration history
in Supabase. Migration `20261013122212` (`application_history_reset`) was applied to
**phd-workflow** on 2026-10-13 (Europe/Tirane). Owner-only reset, timestamp and note
preservation, repeated resets, later status changes and access checks passed using
temporary records in a rolled-back transaction. Existing application rows were unchanged.

Migration `20261013124138` (`application_tracking_navigation`) was applied to
**phd-workflow** on 2026-10-13. The live rollback test confirmed that entering
Tracking, saving notes and resetting history preserve the preceding status;
explicit Ready and subsequent status changes still work. Existing application rows were unchanged.

Migration `20261011122600` (`letter_refinement_system_prompt`) adds the optional `refinementSystemPrompt` template field to the
existing validator, with a 4,000 UTF-16-unit limit. Use the targeted [`refinement_system_prompt.sql`](refinement_system_prompt.sql) upgrade
for other existing databases. The live template-guidance suite passed after deployment and rolled back its synthetic records.

The confirmed cleanup migrations are `20261010231056` (`retire_legacy_drafting`), `20261010231602`
(`retire_legacy_refinement_formats`), `20261010231941` (`current_refinement_privacy`) and `20261010232812`
(`retire_legacy_application_creation`). They retired the standalone APIs, storage and outer version-1 protocol while preserving
opportunities, applications and current history. Application creation and CV assignment use separate current APIs.

For future schema changes, compare the deployed definitions with the desired baseline and prepare a targeted, reviewed migration.
Preserve data, ownership, grants and RLS; apply and verify the migration, then update the fresh-install schema. Never replay the baseline
or historical scripts over an existing workspace.

The baseline installs atomically, with one definition per function and no historical data backfills. Its consolidated definitions,
constraints, permissions, policies, triggers and indexes were checked against the pre-cleanup baseline.

## Current data contract

| Table | Access and purpose |
| --- | --- |
| `opportunities` | Shared read-only research for authenticated, non-anonymous users. |
| `opportunity_reviews` | Owner-only interest, optional private comment and viewed-source receipt. |
| `cv_variants` | Owner-only immutable privacy-filtered CV/configuration snapshots. |
| `applications` | Owner-only captured research, CV reference, notes, checklist, saved stage and status history. |
| `application_refinement_state` | Owner-only settings, independent current CV/letter requests, approval hashes and optimistic revision. |
| `application_refinement_requests` | Immutable public CV/letter source context, scope and accumulated feedback. |
| `application_refinement_protocols` | Immutable connected instructions bound to an exact request and protocol hash. |
| `application_refinement_proposals` | Owner-readable, management-appended v2 operations, comments, annotations and letter text. |
| `application_refinement_reviews` | Append-only feedback, annotation responses, CV decisions and approval/reopen records. |
| `local_attachment_metadata` | Owner-only attachment `id`, `user_id`, manually entered `name` and `description`. |

One owner can have one application per opportunity. Server-assigned application codes are immutable; exact codes or complete UUIDs
resolve without title guessing. Captured research stays stable until an explicit context refresh. Composite foreign keys prevent
cross-owner references. Removing an application retains shared research and CV snapshots while cascading its refinement state/history;
account deletion removes the owner's private records. Backend-only `opportunity_history` is outside frontend access and is not part of
this cleanup.

## Active APIs and security model

Browser RPCs use `SECURITY INVOKER`, owner RLS and non-anonymous account checks. `create_job_application(uuid,uuid)` creates without a
CV and returns the existing application on repeated creation. `assign_job_application_cv` atomically publishes a privacy snapshot and
applies permitted edits. Authoritative capture rejects forged research context.

`review_job_opportunity` records interest/source receipts; `save_opportunity_comment` changes private reasoning. `strong_interest` is
independent of fit scores. Checklist, stage, context-refresh and removal RPCs retain their scoped contracts. Saved stages and explicit
tracking are separate. Before an explicit tracking choice, Preparation, Refinement and Attachments set the matching status.
Opening Tracking preserves the status and history; Ready is an explicit dropdown choice. Reset history also preserves the current
status. Server-maintained status history leaves unknown historical times unrecorded.

Refinement uses `save_refinement_state`, `publish_refinement_request`, `publish_refinement_protocol`, `save_refinement_review` and
`clear_refinement_history`. Private management helpers resolve an exact reference, read its request/protocol and append a proposal with
a stable retry UUID and verified receipt. They require `postgres` without JWT impersonation or wider browser grants. The MCP
has administrative access beyond this supported workflow.

History clearing uses a separate owner-checked private definer helper behind its public invoker wrapper, with revision and document-scope
checks. Shared historical rounds retain the other document's history and any immutable sources its reviews or later rounds still need.
It grants no access to management read/save helpers. See [the complete refinement contract](REFINEMENT.md).

The active helpers `job_drafting_redact_samples`, `cv_adjustment_validate_request` and `cv_adjustment_validate_response` keep their
earlier names. Current structured shortening still uses them. Inner `cv.schemaVersion` and `cvStructure.schemaVersion` remain **1**;
only the retired outer request/proposal format was version 1. Private reverse mappings stay local. Database validation cannot detect
every identity inside arbitrary prose, so every publication must retain the frontend privacy projection.

## Verification

Run each complete [`tests/*.sql`](tests) file as the administrative SQL role. Suites create synthetic users and records, exercise
authenticated/anonymous boundaries, and roll back their fixtures. An exception fails the run; a final PASS confirms it. The retired
standalone API suites were removed; current suites cover their surviving application, privacy, access-control and deletion
responsibilities.

Cleanup verification completed locally: fresh schema plus **18 SQL suites**, **770 Node tests**, the production build, and **six
browser flows across verification runs**. All **16 live SQL suites** also passed with their synthetic fixtures rolled back.

The updated workspace-security and retirement suites passed again after the fourth migration, including absence of the old creation
signature and availability of both current APIs.

Postflight retained **150 opportunities** with the unchanged catalogue checksum `f710bf0b6d1b763555df48991bbeb21a` and **8
applications**. Concurrent owner activity created a CV snapshot and v2 request during deployment; totals are **15 CV snapshots** and
**10 refinement requests**. Application-field checksums changed alongside that activity. The scoped migrations preserved application
and opportunity records.

The original **14 CV snapshots** and **9 refinement requests** retain their exact checksums
`47dc553d28f6a757f1505bba5d12040a` and `98137e9ad01658c3d0b34fdb8ca0dbec` respectively; the later records are additional activity.
