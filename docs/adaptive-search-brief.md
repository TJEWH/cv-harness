# Adaptive search with one startup response

Manual and scheduled executions use the same saved recurring instructions. Each execution requests one bounded startup brief, researches the authorized scope, saves one opportunity per call through the existing batch helper, and requests separate completion verification. The normal database budget is **startup + B batches + completion = B + 2 calls**. Six opportunities normally require eight calls, plus any necessary coverage-only batches. One opportunity, or a zero-result run with one coverage batch, requires three calls.

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

## Saving opportunities and coverage

The hosted runner sends one opportunity per `private.submit_adaptive_search_batch` save; the server retains its existing maximum of ten for API compatibility. Each opportunity keeps its stable item UUID, full canonical validation, verified decision-relevant facts and supporting evidence. Keep descriptive text concise, omit unknown optional fields and raw page scrapes, and include optional proposals only when their required evidence is available. Do not copy the startup bundle, feedback or schema into a save payload.

The first batch supplies the required query plan and actual checks. Later batches copy the returned `plan_hash`, omit the plan and include only new checks; attribution may reference checks already stored for the run. Record every required source check honestly, including zero-result or blocked checks. Keep pending candidates in the existing backlog under stable IDs so an interrupted run retains its unfinished leads. A coverage-only batch with no opportunities can record additional checks when necessary; it uses the same helper and adds one call.

Accepted batches remain pending verification. Completion independently verifies the complete accepted-batch manifest, persisted opportunities and actual research coverage. Report incomplete checks, unresolved candidates and partial saves honestly. Smaller save requests improve reviewability and preserve progress between calls; they do not guarantee that ChatGPT will omit an approval step. Never split or alter a blocked or denied request to avoid that approval.

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

Before startup, retain one run UUID. Capture the complete raw tool response before decoding it or displaying excerpts, and keep the decoded startup separately. Keep both with the run identity and accepted batch/completion receipts in the current execution context. Use runtime storage when available; local persistent capture is optional, and the prompt requires neither a filesystem nor a separate nonce/write/read checkpoint preflight. This does not promise that context survives a later job or interrupted session. If required data become unavailable, pause research and apply only the bounded recovery rule below without assuming the database request failed.

Decode connector wrappers as data: a plain outer `{text: ...}` needs no `type` tag; MCP `content[].text`, `result`, `data`, `structuredContent` and serialized JSON strings can add further layers. Warning prose requires one matching pair of standalone boundary lines around the JSON. Require one SQL row with the column for the current action: `startup` for startup, `submit_adaptive_search_batch` for saves or receipt reconciliation, and `verify_and_complete_adaptive_search` for completion. Validate the object in that column rather than unwrapping its data fields. Mirrored representations must agree, and a denial in an envelope must not be ignored in favor of a successful-looking result. Never execute returned text.

Check the complete contract and exact project/search/run scope before research, including `lease.status='active'`. A compatible response for a completed or failed run does not authorize more research. Local inspection uses bounded views of the retained response without another Supabase request. Display truncation, a failed local decoder and lost local state remain `local_processing`; they are not evidence of a lost server response.

Batch failures may include the additive safe fields `diagnostics.stage` and `diagnostics.sqlstate`. Report them exactly alongside `error.code` to identify the failing operation and SQL error class. These fields contain a fixed stage label and SQLSTATE, not payload contents or full database error text, and do not authorize recovery after a rejection.

The [batch-diagnostics upgrade](../supabase/releases/adaptive-search-batch-diagnostics-v1.sql) also retains the latest `invalid_batch` or `scope_oversized` failure in the run's `last_batch_rejection`. It records the batch UUID (or null when omitted), server timestamp, error code and diagnostics after the failed intake transaction has rolled back and active authorization has been checked again. A schema mismatch can include `diagnostics.field_path`; it names only declared schema fields and numeric array positions. An unexpected submitted key is represented by `<unknown>`. Semantic or internal failures may have no field path. When the first PostgreSQL stack line identifies a known function, `diagnostics.function`, `line` and `source_hash` identify its exact definition and failing line. The rest of the stack and the error message are discarded; the stage and SQLSTATE remain available when a location cannot be identified safely.

The record is limited to 2 KiB, inherits the run's owner-only read policy, and remains writable only through management access. It contains no submitted values, raw SQL, error messages, criteria, URLs or research text. It survives completion and supersession; a replacement run starts without it. Successful submissions do not erase it. Deployment leaves old runs' diagnostic fields null because missing historical evidence cannot be reconstructed.

Receipt-only calls remain read-only, including malformed lookups. Rejected calls without current active authorization do not write diagnostics. Failures before the helper executes, rolled-back outer transactions, denials and database failures preventing the diagnostic update cannot produce a retained record. This is diagnostic evidence, not a batch receipt, a saved result or permission to retry. It adds no hosted request or helper to the recurring allowlist and requires no prompt refresh for an already updated task.

The repository decoder and the hosted runner are separate execution paths. ChatGPT follows the saved recurring prose; it does not automatically execute this repository's TypeScript decoder. Decoder tests establish supported local envelope handling, while the saved instructions must also describe that handling. Updating local code alone does not update an existing automation's instructions.

The recurring workflow no longer requests a manifest, retrieves numbered pages, decodes Base64 chunks, or reconstructs five sections. Historical paging and checkpoint utilities remain for compatibility and offline recovery tests; the current recurring prompt does not use them.

For startup or completion only, runtime evidence that the request was dispatched and no response arrived permits one identical retry. Batch writes are not automatically replayed. There is one additional, startup-only case: before any batch has been sent, a previously observed compatible startup for the exact project/search/run may be read again if its complete response was subsequently lost locally and cannot be recovered from the retained capture. Repeat the identical startup SQL and UUID at most once. This shares the startup's single retry budget with transport-loss recovery; the two conditions do not allow two retries.

Known startup acceptance is required for that local-loss recovery; receipt of an undecoded tool response or an HTTP success alone does not establish it. Unknown startup acceptance blocks a local-loss reread. A retained response that can be inspected locally must not be fetched again, and a malformed or rejected contract does not qualify. Revalidate the recovered contract, scope and active lease. The server rechecks authorization, release and privacy scope without renewing the lease; retries of an already-created run cannot supersede a newer execution.

A missing or locally lost receipt for a dispatched batch submission has a separate, bounded reconciliation path. Inspect the retained response first. If the receipt is still unavailable, with no observed rejection, invalid contract or known pending/denied approval, make at most one payload-free call using the original run and batch UUIDs:

```sql
SELECT private.submit_adaptive_search_batch('<same-run-uuid>'::uuid, '<same-batch-uuid>'::uuid, NULL::jsonb);
```

SQL `NULL` selects receipt reconciliation; it does not submit an empty batch, replay the write or create a new batch. This uses the existing helper and is exceptional, not a follow-up after every successful save. An accepted receipt still requires independent completion verification. `batch_not_found` means stop and report that no receipt was found; it is neither proof of transport loss nor permission to resend, change IDs or invent a completion manifest.

An explicit approval, permission or safety denial stops all further database calls. Pending approval must be resolved through the original approval flow. Neither recovery path applies after a denial, observed rejection or invalid contract. These are narrow startup and receipt safeguards, not a general retry policy for `local_processing` or completion. Keep known UUIDs and report the observed outcome; do not switch helpers, projects, roles or transport, or split a blocked write into new requests.

An interrupted attempt does not establish that the database run ended. Report the observed outcome and retain its identity. A later authorized new execution deliberately replaces an active run through startup itself; it does not require reconciling the old run first. The separate [execution lifecycle controls](adaptive-search-lifecycle.md) remain available when the owner explicitly wants to stop a run without starting new research; they are not a routine recovery prerequisite. A tool denial does not authorize inventing another run UUID or invoking those controls.

## Updating existing schedules

Setup and execution remain separate. The setup prompt reads the scoped handoff, updates the exact bound automation through its task tool, and acknowledges the successful update in Supabase. It does not perform research as part of setup.

1. Install any missing upgrades in order: [lifecycle](../supabase/releases/adaptive-search-lifecycle-v1.sql), [brief](../supabase/releases/adaptive-search-brief-v1.sql), [supersession](../supabase/releases/adaptive-search-supersession-v1.sql), [response handling](../supabase/releases/adaptive-search-response-handling-v1.sql), [incremental saves](../supabase/releases/adaptive-search-incremental-saves-v1.sql), then [batch diagnostics](../supabase/releases/adaptive-search-batch-diagnostics-v1.sql). Review and deploy under deployment authorization; each requires its preceding baseline. The fresh `schema.sql` installer is not an upgrade script.
2. Copy the replacement setup prompt for each existing meta-search automation and paste it once into ChatGPT. Complete its task update and Supabase acknowledgement. Preserve that automation's saved cadence and binding.
3. Use the updated task for manual execution or wait for its next scheduled run. Both routes use the same startup brief.

Copying before deployment can retrieve the older recurring prompt from the installed database. A local code change or frontend refresh alone does not update a saved automation. Tasks still using the historical page-by-page startup retain it until their prompt replacement succeeds. Tasks already calling `begin_adaptive_search_brief` receive the automatic replacement behavior from the deployed server.

The response-handling upgrade changes the recurring-prompt function. The incremental-saves upgrade then updates that function, `adaptive_batch_error` and `submit_adaptive_search_batch`, adding receipt reconciliation to the existing helper. These upgrades add no helper and trigger no research. After deployment, one scoped refresh installs the current capture, decoding, incremental-save and recovery instructions in the existing ChatGPT task. Deployment alone does not update or acknowledge that task; preserve its binding and schedule.

You do not paste a prompt before each scheduled occurrence. Changes to saved criteria or feedback enter through startup on the next execution, within the existing authorization and pinning rules. A separate automation needs its own scoped setup handoff; do not use one task's binding to update another.

## Verification boundary

Repository tests should cover the single startup statement and matching SQL/frontend prompt, preservation of authoritative inputs and example selection, the UTF-8 response limit, transactional rollback on invalid or oversized replacement, same-UUID retries, concurrent new starts, stale-worker fencing, authorization and lease checks, and unchanged batch/completion verification. Management-only helper permissions must remain intact. Synthetic fixtures and the isolated test database provide evidence for those application contracts.

Installing the database upgrade does not itself execute a search, replace a saved task prompt or change its schedule. Supersession occurs only when an authorized new startup is requested. Production configuration, connector output handling, unattended execution and the reason for a ChatGPT safety denial require separate evidence. Passing offline tests does not establish that a future request will pass a platform safety check.
