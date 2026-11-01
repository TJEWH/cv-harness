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

## Contents and size limit

The brief includes the complete batch/completion protocol and canonical opportunity schema. It preserves the saved criteria, query plan or valid null value, legacy core queries, approved rules and preferences, blocked core queries, all planning priorities, due sources and source context. Scope, version pins, capability flags, refresh state and lease information remain available.

The server removes duplicate planning rules/preferences because they already appear in the top-level preferences. It also removes duplicate feedback preferences, feedback-level fingerprint fields, and raw aggregate groups whose derived priorities already appear in planning. The full internal startup bundle and feedback snapshot remain available to server-side validation.

The brief keeps the snapshot's selected examples, up to 16, with their existing order and full retained example content. It does not introduce another example selection policy, shorten their text, drop provisional priorities, or trim source obligations to fit. Existing snapshot inclusion and privacy rules still apply.

The server limits the serialized JSON brief to **65,536 UTF-8 bytes**. If the brief exceeds that limit, it returns the typed `scope_oversized` outcome and rolls back startup changes made by that request. It does not leave a newly created run or lease behind after that rejection. An existing run's earlier committed work remains intact. A larger configuration requires a reviewed change to its inputs or transport; the recurring prompt provides no paging fallback.

An oversized brief also returns bounded numeric `size_diagnostics`: total response, context, planning, protocol, schema and feedback byte counts. Those numbers identify growth without returning the oversized content or requiring another database read. They are null when the internal startup rejected its own size limit before producing a brief. Report the numbers when present; they do not authorize another request.

This byte limit bounds the application response. It does not establish a guaranteed output limit for every connector or ChatGPT execution environment.

## Response handling and failures

Before startup, retain one run UUID. Keep that identity, the complete response and accepted batch/completion receipts in the current execution context. Local persistent capture is optional when the runtime supports it; the prompt requires neither a filesystem nor a separate nonce/write/read checkpoint preflight. This does not promise that context survives a later job or interrupted session. If required data become unavailable, stop and report the known run identity without assuming the database request failed.

The runner decodes the connector envelope as data and checks its contract and exact scope before research. It does not execute returned text. Local inspection can use bounded views of the retained response without another Supabase request. If the runtime cannot inspect the complete response, report `local_processing` and stop.

The recurring workflow no longer requests a manifest, retrieves numbered pages, decodes Base64 chunks, or reconstructs five sections. Historical paging and checkpoint utilities remain for compatibility and offline recovery tests; the current recurring prompt does not use them.

An explicit approval, permission or safety denial stops the execution. A local display truncation remains a local processing issue. Only runtime evidence that a request was dispatched and no response arrived permits one identical retry with the same run UUID and arguments. An unknown failure does not authorize a replay, a replacement UUID, an alternate helper or another transport.

An interrupted attempt does not establish that the database run ended. Report the observed outcome and retain its identity. Use the separate [execution lifecycle controls](adaptive-search-lifecycle.md) for an owner-authorized abort; research instructions do not cancel another run or change a schedule.

## Updating existing schedules

Setup and execution remain separate. The setup prompt reads the scoped handoff, updates the exact bound automation through its task tool, and acknowledges the successful update in Supabase. It does not perform research as part of setup.

1. Review the [lifecycle upgrade](../supabase/releases/adaptive-search-lifecycle-v1.sql) and install it first if the database does not already have that baseline. Then review and deploy the [brief upgrade](../supabase/releases/adaptive-search-brief-v1.sql) under deployment authorization. The brief upgrade requires the lifecycle baseline; the fresh `schema.sql` installer is not an upgrade script. Confirm readiness for the brief helper before installing recurring instructions that call it.
2. Copy the replacement setup prompt for each existing meta-search automation and paste it once into ChatGPT. Complete its task update and Supabase acknowledgement. Preserve that automation's saved cadence and binding.
3. Use the updated task for manual execution or wait for its next scheduled run. Both routes use the same startup brief.

Copying before deployment can retrieve the older recurring prompt from the installed database. A local code change or frontend refresh alone does not update a saved automation. Existing tasks retain their previous page-by-page instructions until their prompt replacement succeeds.

You do not paste a prompt before each scheduled occurrence. Changes to saved criteria or feedback enter through startup on the next execution, within the existing authorization and pinning rules. A separate automation needs its own scoped setup handoff; do not use one task's binding to update another.

## Verification boundary

Repository tests should cover the single startup statement and matching SQL/frontend prompt, preservation of authoritative inputs and example selection, the UTF-8 response limit, transactional rollback on oversize, exact retries, authorization and lease checks, and unchanged batch/completion behavior. Management-only helper permissions must remain intact. Synthetic fixtures and the isolated test database provide evidence for those application contracts.

This implementation work does not deploy to production, replace task prompts, change schedules, or recover an interrupted production run. Production configuration, connector output handling, unattended execution and the reason for a ChatGPT safety denial require separate evidence. Passing offline tests does not establish that a future request will pass a platform safety check.
