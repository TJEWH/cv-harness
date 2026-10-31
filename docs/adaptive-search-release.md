# Adaptive search release

AF-01–AF-11 extend the single shared Meta research editor with owner-scoped feedback, reusable sources, execution history and a separately versioned runner. Installation and task activation are separate operations; source verification alone does not establish unattended execution.

The specification reference is commit `f475d364fb16508b4ef8e1568b9d72fd80e3ddf2`; the complete AF-11 implementation before the breadth upgrade is `fbbe4c2a28a9a776e6040b92a9af2c28876efb21`. Current source hashes and installation order are recorded in [`supabase/adaptive-search-release.json`](../supabase/adaptive-search-release.json). That manifest is source evidence, not a record of production deployment.

## Versions and source verification

| Contract | Version |
| --- | --- |
| Canonical opportunity storage/intake | 6 / `opportunity-search-v1-canonical-6` |
| Existing bootstrap and `meta_search` document | 1 |
| Adaptive startup | 1 |
| Complete runner capability | `adaptive-batch-v1` |
| Interest metric | `opportunity-interest-v1` |
| Example selection | `opportunity-feedback-selection-v2` |
| Query policy | `adaptive-query-v3` (historical v1/v2 retained) |
| Feedback text | `included-unless-excluded-v1` |
| Technical setup and feature rollback | 1 |

`npm run adaptive:release:check` checks the exact migration, runner and schema files against the manifest without connecting to a database. After reviewing an intentional source change, regenerate it with `node --import tsx scripts/adaptiveSearchRelease.ts --write`, inspect the diff, and rerun the gate. Regeneration is never a substitute for reviewing changed SQL.

The preview extraction and final proposal correction also check exact `pg_get_functiondef` SHA-256 prerequisites. The manifest records their actual PostgreSQL 17 fingerprints and the encoding `sha256-utf8-pg_get_functiondef-pg17-v1`. A different definition or server formatter requires review and an explicit new fingerprint. Do not copy a deployed body into an authenticated API to make a fingerprint pass.

## Installation boundaries

### Reproducible local fixture

The isolated driver loads these prerequisites in order:

1. `supabase/schema.sql`, in an empty disposable database.
2. `test/opportunityFeedback/fixtures/legacy-search-bootstrap.sql`, the pinned technical fixture from `supabase/opportunity_search.sql` at commit `3a3abaf2fa3a4dfd94f9bd145555a007e166f0fb`. Its provenance file checks SHA-256 `9baff81fb8a014b8e40bcc212d8264bdb1021027229c1d309f2258694f1b76f5`.
3. `opportunity_merge_v4.sql`, `opportunity_canonical_v5.sql`, then `opportunity_meta_search_autosave.sql`.
4. The ordered additive files under `existing_workspace_upgrade` in the release manifest: AF-01 feedback through AF-10 preview/dashboard, the AF-11 proposal correction, the feature rollback definitions, and the search-breadth upgrade.

The additive `opportunity_search_breadth.sql` runs after all eighteen AF files. It adds the 20% breadth default and a separate revision, derives the per-search v2 planning policy, and extends settings receipts and planning validation without modifying opportunity payloads or scheduled tasks. Existing v1 plan history and already pinned runs remain valid. The dashboard keeps older installations readable, but disables the slider until this upgrade is installed. Installing the upgrade does not enable the release or any owner opt-in. Test its synthetic boundaries with `npm run test:adaptive-search-breadth` as well as the release gate before a separately authorized deployment.

The historical bootstrap is a **local technical fixture**. It contains historical setup/conversion behavior and is excluded from the existing-workspace upgrade list. No captured production records are used. The fixture driver accepts only its fixed, labelled, network-disabled Docker container; it rejects bind mounts, published ports, another database name, and concurrent suites. It has no Supabase URL or connection-string override.

### Existing workspace upgrade

For an authorized deployment, first compare the installed canonical v5 protocol, query/run/receipt/audit structures, autosave contract and PostgreSQL definition fingerprints with the reviewed prerequisites. Apply only missing additive AF files, in manifest order, through the project's migration process. Check migration history before each file; these are ordered upgrades, not repeatable baseline installers.

**Do not replay `schema.sql`, the historical bootstrap, v4/v5 conversion, or a catalogue-normalization/backfill on an existing workspace.** Those files in the manifest describe the local prerequisite history, not permission to migrate existing opportunity data. A fresh production workspace also needs a separately reviewed base protocol installation; a passing disposable fixture does not authorize deploying historical SQL wholesale.

All new runtime functions use invoker permissions, owner checks and RLS. Management startup/intake/completion/setup/rollback helpers remain unavailable to browser and service roles. Existing private-schema usage is preserved; no private helper grant or definer workaround is added. The management connector still has administrative powers beyond this workflow and is not authenticated as a human owner by these helpers.

The release flag, per-search runner authorization, adaptation and successful-source reuse default off. Feedback is included by default unless its opportunity is excluded; the current contract has no search-level sharing opt-in. Installing capabilities does not enable a runner or adaptation, create a task, modify a binding, or fabricate discovery/prediction history. Adaptation and pause controls still govern applying feedback to generated query plans.

## Default inclusion, personal Past status and institutional sources

Append `opportunity_feedback_inclusion.sql` after all nineteen previous additive files. It adds owner-scoped manual Past/technical issue metadata, default text-inclusion proofs and v3 project-level screening guidance. No catalogue records, official deadlines, application statuses or scheduled tasks are rewritten. The seven institution listing defaults are retained only when a new, explicitly authorized run starts; historical retries do not seed them. Existing source settings and disabled paths are preserved. Capacity omissions are reported through `source_retention` and the dashboard.

Append `opportunity_evaluation.sql` after the inclusion migration. It combines distinct saved comment and summary text once, without truncation, into `opportunity_reviews.comment`; `evaluation_revision` replaces the old text revision. Complete evaluations allow 12,000 Unicode codepoints. The browser migrates retired local summary recovery keys once before opening drafts; current edits persist through one comment RPC. Removed summary columns, approval hashes, approval rows and approval RPCs have no current read/write adapter. Existing interest values/revisions, exclusions and application data are preserved.

Append `opportunity_feedback_defaults.sql` after the evaluation upgrade. It removes the search-level sharing column, consent metadata, read/set APIs and consent gates from current definitions. Cached feedback representations migrate once to selection policy v2; reviews and application records remain unchanged.

The one shared opportunity exclusion controls evaluation text and structured feedback. Text is bounded to the first 600 Unicode codepoints and includes source length and truncation metadata. Content safeguards inspect the full source before excerpting. Release and runner authorization remain required for execution. Feedback previews and snapshots include eligible examples independently of adaptation being enabled or paused. No synthetic approval timestamp is generated, and no raw technical note is exported. Tests use only isolated synthetic rows.

## Dashboard interpretation and runtime limits

The dashboard distinguishes the confirmed legacy/adaptive task mode from authorization and adaptation settings. Settings apply to an active adaptive run; changing them does not upgrade a legacy task. Legacy runs can save queries and verified opportunities without creating adaptive query plans, per-check execution records, reusable-source entries or preference suggestions. Empty adaptive tables are not evidence that research did not run. Keep the feedback preview, task setup and actual run history available; hide empty advanced panels while preserving retained drafts and known omissions.

The additive `opportunity_search_adaptive_payload_contract.sql` upgrade runs after the current canonical and feedback-default contracts. It publishes complete batch, execution-report and completion instructions through startup `protocol_text`; the scheduled prompt points to those instructions without duplicating them. Exact PostgreSQL 17 function fingerprints guard installation. Existing pinned bundles and their hashes remain unchanged, and the validator accepts only the previous reviewed protocol or the current one. A scheduled run still needs its own execution verification.

Two optional learning paths remain limited:

- Useful-source retention runs at completion and requires qualifying interest or submission already present; later ratings do not retry that decision. The initial explicit institution listings and feedback-based query priorities work independently.
- Deferred/awaiting proposals do not promote automatically, and source/query proposals have no application path. An inert proposal must not be presented as an active preference.

Authorization requires the management release to be bound to the exact project. An absent binding is an administrator setup prerequisite, not a retryable save failure. The dashboard keeps authorization unavailable for known release/project/capability blockers, preserves revocation, and rechecks configuration on Refresh. Ordinary settings changes remain separate from authorization and task replacement.

A separately verified partial result remains saved even if the run later fails. The dashboard currently receives run counts and coverage, but not the legacy diagnostic notes; an unexplained failed run needs inspection of its recorded summary. Do not infer a database outage from that lifecycle label.

Legacy runs without execution reports show unknown feedback/preference revisions and structured backlog. Their zero failed-check and incomplete-source counts reflect absent execution records, not proven coverage. Deadline counts also require discovery records, and notification delivery has no independent receipt.

Task replacement is a one-time activation step. Each new adaptive run loads current saved feedback and approved preferences; rating an opportunity does not require copying another setup prompt. Future changes to the scheduled task's fixed instructions may require another replacement.

### Activation status on 2026-10-31

The payload-contract upgrade was deployed after isolated database tests, independent review and a rolled-back preflight against the saved search. Project release configuration, owner runner authorization, query adaptation and useful-source retention are enabled.

The setup acknowledgement now records the existing task as `adaptive-batch-v1`, confirmed at 21:08 Europe/Tirane, with no migration request pending. The daily 09:00 schedule, research profile and existing catalogue/run records were preserved; the preflight created no retained research records. This acknowledgement is a task-tool attestation rather than independent scheduler inspection. No adaptive research run had executed at the time of this check, so unattended execution and notification delivery remain unverified. The 09:00 failed run shown in the dashboard predates activation and remains legacy history.

## Local release gate

With installed dependencies and the documented PostgreSQL 17.6 fixture:

```sh
docker run --detach --name cv-adaptive-feedback-test \
  --label cv-builder.test-suite=adaptive-feedback --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=adaptive_feedback_test postgres:17.6
npm run adaptive:release:check
npm run test:adaptive-search-release
npm run test:opportunity-feedback-defaults
npm run test:adaptive-search-payload-contract
npm run test:adaptive-search-dashboard-settings
npm run typecheck
npm test
npm run build
npm run test:opportunity-merge
npm run test:opportunity-canonical
```

Run all database suites sequentially. The merge and canonical runners share the separate `cv-opportunity-merge-test` container; follow their documented setup. Their regression inputs must remain synthetic. The release process does not read the historical `run-1602c633.json` capture or accept a production-capture override.

The release driver seeds canonical records **before AF-01** using the real legacy v5 submit/verify protocol. It hashes every pre-existing column in opportunities, scores/people/requirements/documents, reviews/comments/view receipts, applications/context/checklists, CV and frozen letter configuration, attachment metadata, templates, task bindings, query/run history and canonical receipt/audit state. It compares those hashes after all additive files. New columns are allowed; modifications to original columns are not. It also compares original function definitions, table grants and the private-schema ACL.

Only technical hashes, column names and signatures are written to `/tmp/cv-adaptive-release-preservation.json`; snapshots and private text are never exported. The driver exercises the old caller after installation, exact prerequisite rejection, owner/anonymous boundaries, privacy revocation, deletion, feature rollback and fully installed one-/two-batch runs. One batch uses three runner requests; B batches use `2 + B`, with no per-example/application request. Harness assertions are separate from runner calls. Core, adaptive and exploration checks are recorded as actual execution rows. Canonical writes remain pending until the separate completion call verifies their saved receipts and reads the persisted terminal summary.

Submission-only interest still scores 9 under AF-01. It supplies owner context for an inert suggestion but does not become substantive review evidence for approving a rule. Such a valid proposal is deferred as `needs_reviewed_evidence` while valid canonical results continue. Malformed proposals and cross-owner references still fail before writes.

The focused ticket suites remain required: feedback metrics/sharing/snapshots, source/query plans, attribution/baselines, preferences, startup/concurrency, batch/completion, setup and dashboard. Browser gates cover default text inclusion/exclusion, labelled excerpts, manual Past status and technical notes, source controls, failed-draft recovery, account-switch cancellation, keyboard/mobile operation and unchanged letter-interest linkage. Record the exact commands and results for the final reviewed revision. A successful build may retain the repository's existing bundle-size warning.

## Feature rollback

Feature rollback is separate from guarded catalogue-migration rollback. It preserves canonical results, ratings, reviews, source/query/run history and frozen application documents.

An authorized management operator can call `private.disable_adaptive_search_release(project_ref, expected_release_revision)` to stop adaptive database use. This changes no external task. A bound adaptive task remains recorded as adaptive until a real task-tool update receipt is acknowledged.

A rollback request records intent only. To stop adaptive execution before task restoration, management must explicitly disable the global release, or the owner must explicitly disable that search's runner authorization with its expected revision; the latter leaves other owners active. The request itself does neither.

An explicit owner request uses `public.request_adaptive_search_rollback(search_id, project_ref, expected_runner_revision, expected_rollback_revision, rollback_id, accept_reviewed_fallback)`. Management reads the setup-only handoff with `private.read_adaptive_search_rollback`. Automatic archive recognition requires byte-exact reviewed, project/search-scoped `legacy-dynamic-v1` text, its stored hash and a prior task-tool acknowledgement. Arbitrary historical prose is preserved without being inferred safe. When no recognized archive exists, the owner must separately accept the reviewed `legacy-dynamic-v1` fallback before restoring the exact bound task. No new task is implicitly created. The dedicated `private.ack_adaptive_search_rollback` records the actual normalized task-tool attestation and then updates the confirmed runner mode/technical metadata. The first successful acknowledgement restores only the persisted technical `systemPrompt`/`recurringPrompt` under template CAS, preserving editor/recovery content, `userPrompt`, base criteria and cadence. It carries existing canonical-v5 legacy core queries into the new technical revision. Pending adaptive setup intent must be explicitly reconciled before requesting rollback. Uncertain or failed task outcomes retain the outstanding claim for reconciliation. Ordinary retries do not renew it or authorize another create.

A normalized task-tool acknowledgement is a caller attestation, not cryptographic proof and not evidence of unattended execution. Historical exact retries acknowledge their original operation; they do not assert current scheduler state. Keep the release disabled until its intended operational state has been checked. The rollback migration installs these definitions only; it performs no rollback automatically.

If a recovery archive makes technical republishing exceed the installed storage bound, the real task receipt is still acknowledged and the archive stays intact. The receipt reports `requires_owner_republish: true`; normal setup remains blocked until the owner explicitly republishes a fitting technical prompt. Exact receipt retries recheck that publication state, and never rewrite a subsequently superseded task binding.

## Privacy cleanup and deletion

| Data | Cleanup |
| --- | --- |
| Review feedback columns and text proofs | Existing owner review/account cascade; exclusion and source edits eagerly withhold stale cached text. Default inclusion uses exact source hashes/revisions and a labelled 600-character excerpt. Retired approval proofs are removed once; pinned text is checked against the current evaluation and inclusion proof. Technical notes remain private. |
| Prediction proof cache | Owner-read-only technical metadata; receipt unverify/delete and audit rollback/delete invalidate proof. Owner deletion cascades it. No assessment prose or audit snapshots are cached. |
| Adaptive settings, sources, plans, preferences/actions and dashboard control receipts | Owner/search foreign keys cascade on search/account deletion. Source opt-out remains authoritative; zero/blocked checks do not delete sources. |
| Feedback snapshots | Search/settings cascade removes them. Exclusion and evaluation edits apply deterministic eager redaction; startup/retry rechecks current authorization. |
| Executions, execution receipts, discoveries and original assessments | Owner/search/run cascade. Verified historical attribution stays distinct from saved plans, current catalogue fit and notification delivery. |
| Private startup contexts, batches/items and terminal receipts | Run/search cascade; no browser reads. Retry outputs revalidate live permissions and expose fixed safe receipts. |
| Setup operations/acknowledgements, outstanding claims and rollback requests | Search/account cascade. Claims have no automatic expiry and need explicit reconciliation when external outcomes are uncertain. |
| Global release flag and sequence counters | Technical configuration/counters without owner content; retained across account deletion. |

Revocation removes data from future outgoing packets. Historical query documents can retain owner-readable generated text as immutable history; stale, paused or revoked adaptive/exploration text is withheld from outgoing startup/retry/dashboard projections. Account deletion removes the owned history. Deleting a search/account preserves the shared canonical catalogue and does not perform a catalogue rollback. Existing employer contacts and captured application documents remain governed by their original storage contracts.

## Separately authorized deployment and scheduled smoke test

Repository implementation and local verification do not establish deployed or scheduled status. Before enabling a real project/search:

- Review applied migrations, exact function/source fingerprints, owner binding and the complete `adaptive-batch-v1` capability.
- Confirm that frontend assets use only a publishable/anonymous client key, with no service/secret key.
- Obtain explicit owner authorization for the exact task update/create target. Preserve its task ID and approved superseded IDs; verify the real task-tool acknowledgement.
- In the real scheduled context, check connector availability and allowed writes, the fixed helper allowlist, safe outgoing content, separate receipt verification, error/approval behavior and notification settings.
- Check an unattended scheduled run separately. A successful manual run is insufficient.
- If policy or connector permissions block the workflow, leave it disabled and report that boundary. Do not widen permissions, change roles/transports, or bypass approval. A future scoped connector action needs its own review.

## Recorded local verification

These results use synthetic fixtures and the isolated PostgreSQL 17.6 containers. Browser commands used an already installed Playwright/Chrome runtime against `npm run test:e2e:serve`, whose configuration excludes production environment variables and blocks external requests.

| Command / gate | Result |
| --- | --- |
| `npm test` | 1,378 passed; no failures |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing large-chunk warning remains |
| `npm run test:opportunity-merge` | 76 passed |
| `npm run test:opportunity-canonical` | 10 passed, after merge completed |
| `npm run test:opportunity-feedback`, `test:opportunity-feedback-sharing`, `test:adaptive-feedback-snapshots`, `test:adaptive-search-plans`, `test:adaptive-search-attribution`, `test:adaptive-search-preferences`, `test:adaptive-search-startup`, `test:adaptive-search-batches`, `test:adaptive-search-setup`, `test:adaptive-search-dashboard` | All ten scripts passed sequentially: 32 SQL test groups |
| `npm run test:adaptive-search-release` | 6 passed: additive preservation, security/deletion, rollback, both call budgets and concurrent rollback acknowledgement |
| `npm run adaptive:release:check` | Source hashes and PostgreSQL prerequisite fingerprints match |
| `node test/e2e/opportunityFeedback.mjs` | 2 desktop/mobile privacy cases passed |
| `node test/e2e/adaptiveSearch.mjs` | 3 groups passed: desktop/mobile controls, source retry, exact preview, bilingual keyboard UI and readiness recovery |
| `node test/e2e/letterInterests.mjs` | 4 desktop/mobile shared/custom-interest and frozen-application cases passed |

The release pipelines exercise an explicit owner review between batch intake and final verification, followed by verified source retention and current run-quality statistics. That owner action is outside the runner call budget. A source is absent before verification, retained afterward, and receives no fabricated direct-check timestamp. The concurrent acknowledgement test confirms that both sessions contend and only one technical revision is published.

The preservation report contains matching checksums for all original columns in 17 legacy relations, plus unchanged legacy definitions and grants. The final client-asset scan found no service-role or secret key. No production records were read, migrations deployed, permissions widened in production, or live tasks changed. Production deployment, task migration and an unattended scheduled smoke test remain **unperformed** and require separate authorization.
