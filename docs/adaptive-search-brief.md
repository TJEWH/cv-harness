# Adaptive search with one startup response

Manual and scheduled executions use the same saved recurring instructions. Each execution requests one bounded startup brief, researches the authorized scope, submits result batches, and requests separate completion verification. The normal database budget is **startup + B batches + completion = B + 2 calls**. One batch, including a zero-result coverage batch, requires three calls.

```text
Scheduled time ────────────────┐
Manual execution of task ─────┼─ saved recurring instructions
                             │          │
Direct execution prompt ──────┘          ▼
                             one startup brief
                                      │
                                  research
                                      │
                              B result batches
                                      │
                           completion verification
```

The recurring prompt supplies one fixed startup statement:

```sql
SELECT private.begin_adaptive_search_brief('<saved-search-uuid>'::uuid, '<stable-run-uuid>'::uuid) AS startup;
```

Use the project bound to the saved search and retain the run UUID across a permitted identical retry. The brief helper uses the existing startup authorization, locking, pinned context and lease machinery. Batch intake and completion retain their existing helpers and independent persisted verification.

## Starting again replaces an active execution

A new manual or scheduled execution supplies a new run UUID. If another run is still active for that same authorized owner and saved search, the startup helper supersedes it and creates the requested run in one database transaction. ChatGPT makes the same single startup call; it does not read the blocker, prepare an abort operation or make a second startup request.

The replaced run becomes failed with partial coverage and a permanent `superseded_by_run_id` link to its replacement. Existing opportunities, accepted batches, receipts and other committed work remain intact. The old worker cannot submit new results, change its plan, complete the run or restart it after supersession. Already committed receipts remain available under their existing read rules. Database fencing does not prove that an external worker stopped browsing or that a provider notification was delivered.

Repeating the UUID of an already-created run is an idempotent retry, not a request to replace another run. In particular, retrying a superseded UUID returns `run_aborted`; it cannot displace the newer execution. Different new startup requests serialize on the owner/search lock, so the later accepted request becomes active. A request for one search cannot replace a run belonging to another search or owner. An older restart UUID reserved by the separate manual lifecycle operation also cannot evict a newer execution; it retains that operation's verification and conflict rules.

Replacement and valid startup commit together. If the requested startup is rejected, including an invalid configuration or an oversized brief, the transaction rolls back the replacement and leaves the prior run and its lease unchanged. Startup does not discard saved work merely to report success.

## Contents and size limit

The brief includes the complete batch/completion protocol and canonical opportunity schema. It preserves the saved criteria, query plan or valid null value, legacy core queries, all approved rules and preferences, blocked core queries, due sources and source context. Scope, version pins, capability flags, refresh state and lease information remain available.

Planning retains each approved-basis priority and each non-provisional `increase` or `decrease` priority, unchanged and in its existing order. `priority_projection` names this policy and reports `included_count` and `omitted_advisory_count`. Other advisory priorities are omitted from the response. All approved rules and preferences remain exact in the top-level `preferences`; filtering advisory rows does not change hard criteria, exclusions, protected queries or source obligations.

The brief keeps every selected example, up to 16, with the same opportunity ID and order. It retains titles, institutions, topics, interest scores and origins, prediction gaps, review states, metric versions, confirmed-submission flags, structured reasons, technical issue categories and manual archive flags. Shared `search_feedback_summary` text is preserved in full as included by the snapshot's existing privacy and first-600-codepoint excerpt rules. When present, `summary_inclusion` retains `source_length` and `truncated` so the caller can distinguish an excerpt from the full evaluation. A verified original prediction contributes its score as `predicted_interest_score`; an unavailable prediction yields null. These fields preserve evidence of strong matches, false positives and technical outcomes without repeating prediction provenance.

Only the descriptive `research_summary` becomes a preview of at most 240 Unicode codepoints, accompanied by `research_summary_truncated`. `example_projection` records the preview limit and confirms that selected IDs and order are preserved. Example URLs, opportunity keys, timestamps, inclusion hashes and proof revisions, and prediction provenance are omitted. The projection does not change the current 6/6/4 selection allocation, resample historical packets or select replacement examples.

The server also removes duplicate planning/feedback preferences, feedback-level fingerprint fields and raw aggregate groups. Whole-set counts, score sum and mean remain unchanged; they are not recomputed from selected examples. The complete internal startup bundle and feedback snapshots remain unchanged and available to server-side validation. This is a bounded transport projection, not a change to stored feedback or its inclusion rules.

The server limits the serialized JSON brief to **65,536 UTF-8 bytes**. If the brief exceeds that limit, it returns the typed `scope_oversized` outcome and rolls back startup changes made by that request. It does not leave a newly created run or lease behind after that rejection. An existing run's earlier committed work remains intact. A larger configuration requires a reviewed change to its inputs or transport; the recurring prompt provides no paging fallback.

An oversized brief also returns bounded numeric `size_diagnostics`: total response, context, planning, protocol, schema and feedback byte counts. Those numbers identify growth without returning the oversized content or requiring another database read. They are null when the internal startup rejected its own size limit before producing a brief. Report the numbers when present; they do not authorize another request.

This byte limit bounds the application response. It does not establish a guaranteed output limit for every connector or ChatGPT execution environment.

## Response handling and failures

Before startup, retain one run UUID. Keep that identity, the complete response and accepted batch/completion receipts in the current execution context. Local persistent capture is optional when the runtime supports it; the prompt requires neither a filesystem nor a separate nonce/write/read checkpoint preflight. This does not promise that context survives a later job or interrupted session. If required data become unavailable, stop and report the known run identity without assuming the database request failed.

The runner decodes the connector envelope as data and checks its contract and exact scope before research. It does not execute returned text. Local inspection can use bounded views of the retained response without another Supabase request. If the runtime cannot inspect the complete response, report `local_processing` and stop.

The recurring workflow no longer requests a manifest, retrieves numbered pages, decodes Base64 chunks, or reconstructs five sections. Historical paging and checkpoint utilities remain for compatibility and offline recovery tests; the current recurring prompt does not use them.

An explicit approval, permission or safety denial stops the execution. A local display truncation remains a local processing issue. Only runtime evidence that a request was dispatched and no response arrived permits one identical retry with the same run UUID and arguments. An unknown failure does not authorize a replay, a replacement UUID, an alternate helper or another transport.

An interrupted attempt does not establish that the database run ended. Report the observed outcome and retain its identity. A later authorized new execution replaces an active run through startup itself. The separate [execution lifecycle controls](adaptive-search-lifecycle.md) remain available when the owner explicitly wants to stop a run without starting new research; they are not a routine recovery prerequisite. A tool denial does not authorize inventing another run UUID or invoking those controls.

## Updating existing schedules

Setup and execution remain separate. The setup prompt reads the scoped handoff, updates the exact bound automation through its task tool, and acknowledges the successful update in Supabase. It does not perform research as part of setup.

1. Review the [lifecycle upgrade](../supabase/releases/adaptive-search-lifecycle-v1.sql) and install it first if the database does not already have that baseline. Then review and deploy the [brief upgrade](../supabase/releases/adaptive-search-brief-v1.sql) and the [supersession upgrade](../supabase/releases/adaptive-search-supersession-v1.sql) under deployment authorization. Supersession requires the brief baseline; the fresh `schema.sql` installer is not an upgrade script. Confirm readiness for the brief helper before installing recurring instructions that call it.
2. Copy the replacement setup prompt for each existing meta-search automation and paste it once into ChatGPT. Complete its task update and Supabase acknowledgement. Preserve that automation's saved cadence and binding.
3. Use the updated task for manual execution or wait for its next scheduled run. Both routes use the same startup brief.

Copying before deployment can retrieve the older recurring prompt from the installed database. A local code change or frontend refresh alone does not update a saved automation. Tasks still using the historical page-by-page startup retain it until their prompt replacement succeeds. Tasks already calling `begin_adaptive_search_brief` receive the automatic replacement behavior from the deployed server; refreshing their saved instructions aligns the explanation with that behavior.

You do not paste a prompt before each scheduled occurrence. Changes to saved criteria or feedback enter through startup on the next execution, within the existing authorization and pinning rules. A separate automation needs its own scoped setup handoff; do not use one task's binding to update another.

## Verification boundary

Repository tests should cover the single startup statement and matching SQL/frontend prompt, preservation of authoritative inputs and example selection, the UTF-8 response limit, transactional rollback on invalid or oversized replacement, same-UUID retries, concurrent new starts, stale-worker fencing, authorization and lease checks, and unchanged batch/completion verification. Management-only helper permissions must remain intact. Synthetic fixtures and the isolated test database provide evidence for those application contracts.

Installing the database upgrade does not itself execute a search, replace a saved task prompt or change its schedule. Supersession occurs only when an authorized new startup is requested. Production configuration, connector output handling, unattended execution and the reason for a ChatGPT safety denial require separate evidence. Passing offline tests does not establish that a future request will pass a platform safety check.
