# AF-01: owner-scoped opportunity feedback

This implements only AF-01 against reviewed commit `f475d364fb16508b4ef8e1568b9d72fd80e3ddf2`. The supplied package has no standalone AF-01 file; the specification used is the AF-01 section of `docs/codex_adaptive_search_tickets/Adaptive_Search_Feedback_Codex_Tickets.md`, with SIG-01–08 and PRIV-07 from its test matrix.

## Contract

The additive migration is `supabase/opportunity_feedback_signals.sql`. It extends the existing owner/opportunity review primary key with:

| Field | Meaning |
| --- | --- |
| `interest_rating` | Optional finite 0–10 numeric user rating, including zero and decimals |
| `interest_reasons` | At most 16 explicit structured reason tags; defaults to `[]` |
| `feedback_excluded` | Suppresses the adaptive score and gap; defaults to false |
| `feedback_revision` | Server-maintained meaningful explicit feedback revision; legacy rows start at 0 |
| `feedback_updated_at` | Server-maintained meaningful explicit feedback time; legacy time stays unknown |
| `prediction_baseline` | Optional frozen, independently proven historical prediction |

Reason categories are `topic`, `method`, `hardware`, `location`, `funding`, `timing`, and `other`, with `positive` or `negative` polarity. Only topic/method tags may carry an explicit target of 1–120 Unicode code points. Targets trim surrounding ASCII spaces and reject control characters. Tags form a normalized, deterministically ordered set. Private comments are neither parsed for targets nor included in metric outputs.

`opportunity-interest-v1` returns both score and origin: explicit rating first, then strong interest 8 / interested 6 / not interested 2, then confirmed submission 9, otherwise null. These are product conventions. They never replace canonical AI assessments. An excluded item has no score or gap.

Confirmed submission requires a valid `submitted_at`, exact current `submitted` status, or exact `submitted` history entry. Later employer statuses alone do not establish submission. An explicit submitted status with an unknown time still confirms submission, while its time remains null. Removing or correcting actual evidence recomputes the fallback. The existing UI grouping helper remains unchanged.

Only state, rating, normalized reasons, and exclusion changes advance the feedback revision/time. View receipts (`p_state=null`), comments, same-value retries and reordered/duplicate tags do not. The metric uses meaningful feedback time rather than the review's general `updated_at` for priority. Existing historical feedback remains usable without fabricating its original time.

## Historical baselines

A baseline uses structured `score`, `scale_min=0`, `scale_max=10`, owner/opportunity IDs, `predicted_at`, `source_kind=historical_snapshot`, and `source_ref=opportunity-search-receipt:<run UUID>:<item UUID>`.

The database requires an exact owner/opportunity-matched verified receipt, its matching search run, and a non-rolled-back merge audit snapshot with that exact structured score and timestamp. The prediction must predate the known meaningful outcome time. Unknown history or today's catalogue score gives `interest_gap=null` and `baseline_status=unavailable`. A later catalogue change cannot rebase the gap. Revoked verification or a rolled-back source makes its proof unavailable.

Runtime roles cannot write a baseline or forge revision/time. A reviewed management operation can attach a proven baseline only alongside a meaningful feedback change; it cannot replace one during a view, comment or retry. No baseline backfill is performed. The pure TypeScript metric also requires independently verified evidence alongside the stored baseline; a client-asserted JSON object alone is insufficient. AF-05's future prediction attribution is not implemented here.

## Existing integration and privacy

The optional TypeScript fields support clients awaiting the additive migration. Existing review/comment/view RPCs remain intact. Stale view replies preserve newer explicit feedback. Application removal keeps its existing category-reset behavior and, on upgraded databases, reads back the resulting owner-scoped review revision. If that read fails, deletion still succeeds and the stale cached outcome is withheld until refresh.

Existing review grants and RLS policies are unchanged. New helpers use `security invoker`, fixed empty search paths, and have no runtime-role EXECUTE grant. `private.opportunity_interest_metric(owner, opportunity)` is an internal reference implementation, not a new runner or public feedback API. No UI, approved text sharing, compiler, adaptive search plan, scheduled task or deployment is included. Canonical opportunity v5 JSON, private application snapshots and CVs are unchanged.

## Isolated synthetic tests

Prerequisites: installed npm dependencies, Node compatible with the repository, Docker, and a local PostgreSQL image. The tests were developed with PostgreSQL 17.6. This fixture has no external network, exposed port, bind mount, Supabase URL or connection-string override.

```sh
docker run --detach --name cv-adaptive-feedback-test \
  --label cv-builder.test-suite=adaptive-feedback --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=adaptive_feedback_test postgres:17.6
npm run test:opportunity-feedback
node --import tsx --test test/opportunityFeedback.test.ts test/useJobWorkspace.test.ts
npm run typecheck
npm test
npm run build
docker rm --force --volumes cv-adaptive-feedback-test
```

If the `tsx` launcher cannot open its local IPC socket in a sandbox, the equivalent database command is `node --import tsx --test test/opportunityFeedback/database.test.ts`.

The database runner verifies its container label, disabled network, absent bind mounts/ports, fixed database name and exclusive suite lock before resetting its disposable schemas. It loads the actual current `supabase/schema.sql`, synthetic Auth/search evidence structures, then the AF-01 migration. It never reads captured historical opportunity fixtures. SQL acceptance assertions run in a rollback transaction; separate tests verify additive preservation and concurrent writes. The root TypeScript suite covers all SIG cases, malformed values, owner scoping, bounded reasons and high-precision timestamp comparisons. No browser suite is needed because AF-01 adds no interface.

## Deployment prerequisites

No production installation is authorized or performed. After review and separate authorization, confirm the deployed review/application schema and existing search-run, receipt and merge-audit relations match the prerequisites in the migration. Apply the additive file once through the project's migration process; no historical opportunity or review backfill is required. Preserve the existing owner policies/grants and keep internal helpers private. AF-02+ must separately implement controls, disclosure approval and runner integration before adaptive feedback is used in searches.

## Verification on 2026-10-29

| Command actually run | Result |
| --- | --- |
| `node --import tsx --test test/opportunityFeedback.test.ts test/useJobWorkspace.test.ts test/applicationTracking.test.ts` | 73 passed, 0 failed on final source |
| `npm run test:opportunity-feedback` | 3 passed, 0 failed in isolated PostgreSQL 17.6, including the transactional SQL assertions |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing Vite chunk-size warning |
| `npm test` | 1,183 passed, 4 failed, 1,187 total in that run |
| `git diff --check` | Passed |

All four full-suite failures reproduce with identical assertions in a temporary source-only archive of the untouched reviewed commit. No captured opportunity fixtures were copied or read for this baseline check:

```sh
node --import tsx --test \
  --test-name-pattern='a new device reads saved owner-scoped interests|copying the next iteration closes comparison|connected resolved contextual question automatically|selected notes are privacy-filtered and published' \
  test/applicationSearchProfile.test.ts test/refinementIteration.test.ts \
  test/refinementQuestionLoop.test.ts test/refinementUserFeedback.test.ts
```

The baseline failures concern shared-interest revision 1 versus 7, iteration review count 2 versus 1, missing resolved question text, and feedback count 3 versus 2. They are outside AF-01 and remain unchanged. The broad suite started before the final account-switch regression was added; the final focused run includes that regression. Existing merge/canonical database suites were not run because AF-01 does not change their contract and those suites reference historical captured fixtures; this ticket uses synthetic data only.

Changed files: `package.json`; `src/app/cloudTypes.ts`; `src/features/opportunities/domain/opportunityFeedback.ts`; `src/app/composables/useJobWorkspace.ts`; `supabase/opportunity_feedback_signals.sql`; `supabase/tests/opportunity_feedback_signals.sql`; `test/opportunityFeedback.test.ts`; `test/useJobWorkspace.test.ts`; `test/opportunityFeedback/database.test.ts`; `test/opportunityFeedback/db.ts`; `test/opportunityFeedback/fixtures/prerequisites.sql`; this document. The supplied untracked ticket package was left unchanged.
