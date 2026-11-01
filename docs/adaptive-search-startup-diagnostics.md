# Historical paged startup: offline recovery diagnosis

This document records the earlier paged transport and its offline reference implementation. The current manual and scheduled workflow uses the [single-response startup brief](adaptive-search-brief.md). It does not fetch a manifest or numbered pages, assemble sections, or require a filesystem/nonce checkpoint preflight. The historical collector and tests remain for compatibility. The failure classifications below still apply, but page counts and checkpoint records describe that earlier transport.

This review used synthetic data and repository source only. It made no production connection, read no private production captures, changed no permissions or schedules, deployed nothing, and created or closed no research run. The interrupted run remains outside the scope of this patch.

## Findings and evidence

1. **The hosted instructions and tested code are separate.** `adaptiveSearchTask.ts` embeds SQL templates and prose in a task prompt. It does not invoke `AdaptiveStartupCollector`, `AdaptiveStartupCheckpointSession` or the local file adapter. Before this patch, persistence was a prompt requirement without a repository checkpoint implementation. A hosted runner can therefore describe successful decoding while losing the criteria or plans between actions. This is a supported implementation gap, not proof of what happened in the reported execution.
2. **The decoder previously erased useful failure distinctions.** The old `isError` branch emitted generic `connector_error`. The patch preserves structured approval, permission, safety and SQL/application error evidence. Prose containing words such as “denied” does not establish a cause. A returned malformed payload and a truncated local display are local processing problems; neither proves a response was lost.
3. **The generated startup queries are bounded.** Each builder permits only fixed project/search/run identities, five section names and bounded integer page indices. Each projection contains one `MATERIALIZED` invocation of `private.begin_adaptive_opportunity_search`. It does not discover schemas or read arbitrary tables. The SQL arguments identify search/run; the actual connector's `project_id` must also be checked before a call. A matching template is local evidence, not permission to execute it.
4. **The claimed safety-block cause remains unknown.** No redacted platform denial receipt or exact blocked-request fingerprint was provided for this offline review. The user's observation about broad or undefined searches is a useful hypothesis. Source inspection cannot establish that it caused this platform decision. No retry or broader access follows from that hypothesis.

## Patch

- `adaptiveSearchTransport.ts`: bounded MCP `content`/`text`/`result`/`data` decoding, standalone matching untrusted-data boundaries, rejection of ambiguous representations, and evidence-based failure categories. Returned text is parsed as data, never evaluated.
- `adaptiveSearchCheckpoint.ts`: separate nonce-write and later readback actions; owner/project/search/run binding; context-first missing-page planning; complete manifest/page retention; fresh-collector reconstruction; lease checks with an injected clock. An in-flight request and its SQL fingerprint are durably recorded before a caller could dispatch it. An unresolved dispatch blocks another request. Only a positively observed missing response can make one identical retry eligible, and that budget survives restoration. Every mutation requires atomic compare-and-swap against the exact durable snapshot, so a stale session cannot overwrite a newer denial.
- `scripts/lib/adaptiveSearchCheckpointFile.ts`: optional local atomic file storage. It creates new private files/directories, refuses unsafe existing permissions or symlinks, and does not change existing permissions. Typed denials and integrity faults leave a payload-free blocked checkpoint instead of a fresh-run fallback. An exclusive local lock serializes compare-and-swap; an interrupted lock fails closed without automatic takeover.
- `adaptiveSearchDiagnostics.ts`: pure local request inspection and bounded failure records for the historical page templates. The earlier recurring prompt carried these diagnostic requirements and explicit project routing. This module does not call a connector or grant authorization; the current brief prompt uses smaller stage/helper/response/error records without page or checkpoint requirements.

Local display truncation preserves verified pages and requires handling the retained response locally before another request. It does not consume or create a server retry. Valid `query_plan:null`, `legacy_core_queries:null`, empty lists and absent optional criteria remain valid and survive reconstruction.

## Failure classification

| Category | Required evidence | Retry behavior |
| --- | --- | --- |
| `local_processing` | Decoder, checkpoint or observed local display failure | No server retry |
| `lost_transport` | Runtime confirms dispatch and that no response was received | At most one identical persisted request |
| `sql_application_rejection` | Returned contract rejection or structured SQLSTATE | Stop; retain the classified cause |
| `approval_denial` | Explicit structured/runtime approval denial | Stop; no retry or cleanup |
| `permission_denial` | Explicit permission code, SQLSTATE `42501`, or structured 401/403 | Stop; no broader access |
| `safety_denial` | Explicit structured/runtime safety denial | Stop; no retry, cleanup or replacement UUID |
| `connector_unclassified` | Connector failure without sufficient cause evidence | Stop; leave cause unknown |

For example, server `scope_unavailable` is an application rejection, not proof of a permission denial. Server `lease_expired` is distinct from the local `checkpoint_lease_expired` guard. An error message mentioning safety without structured evidence remains unclassified. Denial metadata takes precedence over a contradictory missing-response observation.

## Historical paged diagnostics for an authorized recovery

Record the stage, fixed helper, expected scope, request kind, section/index, attempt, exact SQL SHA-256, template match, actual connector-project match, page counts and checkpoint write/readback result. Record category, evidence origin and known structured error code on failure. An unknown provider code is redacted; a full error message is never copied into the record.

Do not log SQL, response bodies, criteria, preferences, opportunity feedback, Base64, source URLs, credentials or returned instructions. A representative synthetic failure record is:

```json
{
  "diagnostic_version": 1,
  "event": "startup_failure",
  "stage": "context",
  "category": "safety_denial",
  "code": "safety_blocked",
  "evidence": "structured_metadata",
  "retry_eligible": false,
  "verified_pages": 2,
  "expected_pages": 27,
  "missing_pages": 25,
  "checkpoint_readback": "verified"
}
```

The emitted record also contains the sanitized request preflight: the fingerprint and booleans allow comparison with the exact reviewed template without exposing its contents. `runtime_authorization:"not_observed"` prevents a successful local preflight from claiming platform approval. Under a separately authorized future execution, an existing redacted denial receipt and this fingerprint can distinguish a tool approval failure, SQL rejection and local decoder failure. This patch does not authorize that execution or access to additional database objects.

## Automated evidence

Run the offline suite with:

```sh
npm run test:adaptive-search-recovery
npm run typecheck
npm run db:schema:check
npm run adaptive:release:check
```

On November 1, 2026, the offline recovery suite passed **90/90 tests**. Typechecking, local schema consistency, release fingerprints and `git diff --check` also passed.

The recovery suite uses synthetic fixtures only. The reported 27-page shape is represented as context/planning/protocol/schema/feedback counts `[3,4,4,4,12]`. A second fixture uses six pages, so 27 is not an execution requirement. Tests restore after individual actions and in three separate Node processes, retain interrupted request identity, and reconstruct all five sections with null plans and source obligations intact.

Other cases include nested JSON/MCP wrappers, warning blocks and standalone boundaries, returned code as inert text, malformed/ambiguous rows, exact byte lengths, canonical Base64, SHA-256 corruption, UTF-8 characters split across pages, separately identified invalid UTF-8/JSON, missing/conflicting/mixed-hash pages, lease expiry, failed readback, identical duplicates, a single identical retry, denial tombstones and redaction canaries. Stale-session, competing-process and retained-lock tests verify that another action cannot overwrite a persisted denial. These tests do not execute SQL or research.

## What remains unverified

- The actual blocked request, returned denial metadata, missing-field event and ChatGPT safety decision.
- Hosted tool availability, action-to-action persistence, and whether the saved task contains or follows the revised instructions. No hosted bridge to this reference implementation was added.
- Actual database state, permissions, lease, production page layout, schedule state, catalogue writes or terminal run status.
- Any store implementation outside the tested local adapter. It must implement atomic compare-and-swap, not a read followed by an unconditional write. Interrupted file locks require an explicitly reviewed local recovery; no automatic takeover is implemented. If storage itself fails, a durable blocked checkpoint cannot be guaranteed. The library does not coordinate external connector dispatches or host actions.
- Live SQL projection behavior and database integration. This review ran no database tests or deployments; local schema/prompt parity checks only verify source consistency.

Passing this suite does not resolve a ChatGPT platform safety block. A denial remains a stop condition and cannot be bypassed by changing SQL, permissions, project or run UUID.
