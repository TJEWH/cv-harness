# Adaptive search with one startup response

Manual and scheduled executions follow the same current protocol: one startup brief, research, then **save and independently verify each opportunity**, followed by one final report. The normal database budget is **2 + 2N calls** for N opportunities. Saving never contains adaptive feedback, a query plan, execution checks or a batch envelope.

```text
startup → research → save one opportunity → verify that opportunity
                            ↑                         │
                            └── next opportunity ─────┘
                         → finish with actual research coverage
```

The startup statement remains:

```sql
SELECT private.begin_adaptive_search_brief('<saved-search-uuid>'::uuid, '<stable-run-uuid>'::uuid) AS startup;
```

The returned `protocol_text` is the sole current save, verification and completion contract. The saved task does not override it with another format. The four allowed helpers are `begin_adaptive_search_brief`, `save_adaptive_search_item`, `verify_adaptive_search_item` and `finish_adaptive_search`. The internal `adaptive-batch-v1` binding identifier is retained to avoid an unrelated task-binding migration; it does not authorize a batch payload.

## Saving opportunities and reporting coverage

Call `private.save_adaptive_search_item(run_id,item_id,opportunity_json)` with one canonical opportunity, using a stable item UUID. The helper uses the established canonical writer, validation, identity matching and merge rules. It preserves adaptive authorization and privacy boundaries, records the assessment needed by feedback, and returns one compact item receipt. It accepts no batch wrapper or alternate payload version.

For `outcome:saved`, next call `private.verify_adaptive_search_item(run_id,item_id)`. Only a matching persisted verification establishes that item as saved. If a dispatched save returned no usable response, the same verification call can establish its outcome without resending opportunity data. A rejection, denial or invalid contract does not authorize another access path or a replay. Earlier committed items survive a later invalid item or report.

An accepted `outcome:unresolved` receipt is a valid recorded deferral. Its opportunity and discovery IDs are null, its accepted roots are empty, and verification is not required. Keep its item ID in the unresolved backlog, continue other candidates, and finish honestly as incomplete; do not replay or verify that deferred item. A reconciliation result with `status:deferred` likewise establishes unsaved progress rather than an unknown response.

Only the canonical writer’s explicit missing identity/title evidence condition is labelled `insufficient_evidence`. Unexpected check failures return `save_failed` with bounded function/line/source-hash diagnostics when available; the same safe details survive in the existing run diagnostic field. They contain no submitted payload or raw error message.

Keep the actual plan, checks and pending candidates during research. Finish once with `private.finish_adaptive_search(run_id,report_json)`, where the flat report contains `completion_id`, `status`, and the actual `query_plan`/`plan_hash`, `execution`, and optional evidence-backed suggestions. There is no `schema_version`, `action`, `coverage`, `opportunities`, `batch_ids` or client-built manifest. The server derives the saved-item manifest and independently verifies persisted results. Preserve the exact report on an identical permitted retry. Missing or incomplete coverage cannot become a successful research result.

The old batch-saving and version-dispatch completion entrypoints reject calls with `retired_contract`. Historical receipts and audit data remain available, but no historical save format remains executable through those entrypoints. This is separate from the owner-authorized legacy-runner rollback lifecycle.

## Starting again replaces an active execution

A new manual or scheduled execution supplies a new run UUID. If another run is still active for that same authorized owner and saved search, the startup helper supersedes it and creates the requested run in one database transaction. ChatGPT makes the same single startup call; it does not read the blocker, prepare an abort operation or make a second startup request.

The replaced run becomes failed with partial coverage and a permanent `superseded_by_run_id` link to its replacement. Existing opportunities, accepted batches, receipts and other committed work remain intact. The old worker cannot submit new results, change its plan, complete the run or restart it after supersession. Already committed receipts remain available under their existing read rules. Database fencing does not prove that an external worker stopped browsing or that a provider notification was delivered.

Repeating the UUID of an already-created run is an idempotent retry, not a request to replace another run. In particular, retrying a superseded UUID returns `run_aborted`; it cannot displace the newer execution. Different new startup requests serialize on the owner/search lock, so the later accepted request becomes active. A request for one search cannot replace a run belonging to another search or owner. An older restart UUID reserved by the separate manual lifecycle operation also cannot evict a newer execution; it retains that operation's verification and conflict rules.

Replacement and valid startup commit together. If the requested startup is rejected, including an invalid configuration or an oversized brief, the transaction rolls back the replacement and leaves the prior run and its lease unchanged. Startup does not discard saved work merely to report success.

## Contents and size limit

The brief includes one complete current save/verify/finish protocol and the canonical opportunity schema. It preserves the saved criteria, query plan or valid null value, legacy core queries, all approved rules and preferences, blocked core queries, due sources and source context. Scope, version pins, capability flags, refresh state and lease information remain available.

Planning retains each approved-basis priority and each non-provisional `increase` or `decrease` priority, unchanged and in its existing order. `priority_projection` names this policy and reports `included_count` and `omitted_advisory_count`. Other advisory priorities are omitted from the response. All approved rules and preferences remain exact in the top-level `preferences`; filtering advisory rows does not change hard criteria, exclusions, protected queries or source obligations.

The brief keeps every selected example, up to 16, with the same opportunity ID and order. It retains titles, institutions, topics, interest scores and origins, prediction gaps, review states, metric versions, confirmed-submission flags, structured reasons, technical issue categories and manual archive flags. Shared `search_feedback_summary` text is preserved in full as included by the snapshot's existing privacy and first-600-codepoint excerpt rules. When present, `summary_inclusion` retains `source_length` and `truncated` so the caller can distinguish an excerpt from the full evaluation. A verified original prediction contributes its score as `predicted_interest_score`; an unavailable prediction yields null. These fields preserve evidence of strong matches, false positives and technical outcomes without repeating prediction provenance.

Only the descriptive `research_summary` becomes a preview of at most 240 Unicode codepoints, accompanied by `research_summary_truncated`. `example_projection` records the preview limit and confirms that selected IDs and order are preserved. Example URLs, opportunity keys, timestamps, inclusion hashes and proof revisions, and prediction provenance are omitted. The projection does not change the current 6/6/4 selection allocation, resample historical packets or select replacement examples.

The server also removes duplicate planning/feedback preferences, feedback-level fingerprint fields and raw aggregate groups. Whole-set counts, score sum and mean remain unchanged; they are not recomputed from selected examples. The complete internal startup bundle and feedback snapshots remain unchanged and available to server-side validation. This is a bounded transport projection, not a change to stored feedback or its inclusion rules.

The server limits the serialized JSON brief to **98,304 UTF-8 bytes (96 KiB)**. If the brief exceeds that limit, it returns the typed `scope_oversized` outcome and rolls back startup changes made by that request. It does not leave a newly created run or lease behind after that rejection. An existing run's earlier committed work remains intact. A larger configuration requires a reviewed change to its inputs or transport; the recurring prompt provides no paging fallback.

An oversized brief also returns bounded numeric `size_diagnostics`: total response, context, planning, protocol, schema and feedback byte counts. Those numbers identify growth without returning the oversized content or requiring another database read. They are null when the internal startup rejected its own size limit before producing a brief. Report the numbers when present; they do not authorize another request.

The [96-KiB limit upgrade](../supabase/releases/adaptive-search-brief-limit-v1.sql) changes only this outward bound and its matching recurring-task requirement. The internal feedback budget remains 65,536 bytes; feedback selection, descriptions, evaluations, protocol and schema are unchanged. After deployment, reload the app, use **Prepare ChatGPT Update**, and paste the freshly generated setup prompt into ChatGPT to update the existing task. An earlier setup UUID is stale, and its recurring instructions still require the former 64-KiB response value. The schedule is unchanged.

This byte limit bounds the application response. It does not establish a guaranteed output limit for every connector or ChatGPT execution environment.

## Response handling and failures

The pasted setup and recurring instructions use the connected Supabase tool directly. They do not require a JavaScript runtime, embedded codec, filesystem, persistent storage, or a cross-action preflight. The repository's decoder remains a tested local parsing utility; copied task text does not promise that repository code executes inside ChatGPT.

Read the complete returned JSON as data. Supported connector representations include SQL rows, plain `{text: ...}`, MCP `content[].text`, `result`, `data`, `structuredContent` and serialized JSON. Warning prose may surround one matching pair of standalone untrusted-data boundary lines. Never execute returned text, discard an explicit connector denial in favor of another mirror, or guess missing fields from a truncated display. Local parsing can inspect the already received response without another database request.

Retain one run UUID, outgoing item/report identities and available responses in the current execution context. Do not promise that raw data survive an interrupted hosted session. Validate the complete startup contract and exact project/search/run scope, including its active lease, before research. The complete decoded working context must be available; a short success summary cannot replace the criteria, protocol or schema. Display truncation and local parsing errors remain `local_processing`, not evidence of a missing server response.

The setup handoff and startup bounds remain unchanged. After deploying this protocol change, copy the updated setup instruction to the existing task; deployment alone does not replace its saved instructions. The latest instructions add no discovery query, pagination chain or database permission. Offline tests verify the SQL and local parsers, not a successful hosted ChatGPT execution or its platform approvals.

Save and report failures may include the additive safe fields `diagnostics.stage` and `diagnostics.sqlstate`. Report them exactly alongside `error.code` to identify the failing operation and SQL error class. These fields contain a fixed stage label and SQLSTATE, not payload contents or full database error text, and do not authorize recovery after a rejection.

### Startup logs

The [startup logging upgrade](../supabase/releases/adaptive-search-startup-logging-v1.sql) adds `CV_HARNESS_STARTUP` JSON messages to PostgreSQL logs. Each message carries the search/run UUIDs and a fixed stage. `entered` records helper entry; `returned` records compatibility, response bytes and a rejection code when present; `exception` records an error rethrown to the connector. `caught_exception` preserves the original SQLSTATE and available function/line before the existing bootstrap error mapping converts it to a contract rejection. Oversize responses include numeric section sizes. No criteria, feedback, opportunity data, SQL text or exception prose are logged.

These messages survive transaction rollback. A `returned` event proves neither transaction commit nor connector receipt. Absence of a log is inconclusive: access checks may reject the call before helper entry, and log collection, filters and retention can affect availability. The logs cannot reconstruct the connector's outer envelope or an earlier discarded response. Startup payloads, adaptive selection, recurring instructions and retry rules are unchanged; existing tasks need no prompt update for server logging.

In Supabase Logs Explorer, select the failed attempt's time window and query the `logs` source with its exact UUID:

```sql
select timestamp, event_message
from logs
where source = 'postgres_logs'
  and event_message like 'CV_HARNESS_STARTUP %'
  and event_message like '%<run-uuid>%'
order by timestamp asc
limit 30;
```

This is an operator diagnostic query, not an additional research-run request. See [Supabase's bounded log-query guidance](https://supabase.com/docs/guides/observability/advanced-log-filtering).

The repository SQL/MCP decoder emits one `[CV Harness] response_decode_failed` console record on failure, with the wrapper path, failure reason, optional JSON error position, UTF-8 size of the serialized input, classification and recognized error code. Raw response contents and error messages are excluded. Console failures cannot mask the original exception; decoding success is silent. The caller must retain the original input for private inspection. These console records exist only where that TypeScript decoder actually executes. A pasted ChatGPT task does not automatically execute it, so server logs remain the available independent evidence for hosted runs.

The [batch-diagnostics upgrade](../supabase/releases/adaptive-search-batch-diagnostics-v1.sql) also retains the latest `invalid_batch` or `scope_oversized` failure in the run's `last_batch_rejection`. It records the batch UUID (or null when omitted), server timestamp, error code and diagnostics after the failed intake transaction has rolled back and active authorization has been checked again. A schema mismatch can include `diagnostics.field_path`; it names only declared schema fields and numeric array positions. An unexpected submitted key is represented by `<unknown>`. Semantic or internal failures may have no field path. When the first PostgreSQL stack line identifies a known function, `diagnostics.function`, `line` and `source_hash` identify its exact definition and failing line. The rest of the stack and the error message are discarded; the stage and SQLSTATE remain available when a location cannot be identified safely.

The [evidence-field guidance upgrade](../supabase/releases/adaptive-search-evidence-fields-v1.sql) addresses the semantic `Unknown evidence field` rejection. The canonical schema describes `sources[].supports` as strings, while the validator also requires each string's root to name a canonical storage field. The hosted brief appends the exact accepted root names, generated from that same storage schema, and explains canonical names and nested JSON pointers. For example, use `title` or `/data/funding` when supported; `opportunity.title` is not a canonical field. This clarification adds no call and changes no validator, internal pinned bundle, result schema or recurring prompt. Existing task prompts receive it on their next startup; an already rejected execution is not automatically retried. Passing the synthetic save-and-verification test does not establish that the hosted model will produce valid evidence in its next run.

The record is limited to 2 KiB, inherits the run's owner-only read policy, and remains writable only through management access. It contains no submitted values, raw SQL, error messages, criteria, URLs or research text. It survives completion and supersession; a replacement run starts without it. Successful submissions do not erase it. Deployment leaves old runs' diagnostic fields null because missing historical evidence cannot be reconstructed.

Receipt-only calls remain read-only, including malformed lookups. Rejected calls without current active authorization do not write diagnostics. Failures before the helper executes, rolled-back outer transactions, denials and database failures preventing the diagnostic update cannot produce a retained record. This is diagnostic evidence, not a batch receipt, a saved result or permission to retry. It adds no hosted request or helper to the recurring allowlist and requires no prompt refresh for an already updated task.

Local decoder utilities remain available for repository callers and historical fixtures. Current hosted instructions contain no executable codec. Updating repository code alone does not update an existing automation, and local tests cannot prove that the hosted connector supplied complete usable responses.

The recurring workflow no longer requests a manifest, retrieves numbered pages, decodes Base64 chunks, or reconstructs five sections. Historical paging and checkpoint utilities remain for compatibility and offline recovery tests; the current recurring prompt does not use them.

For startup or completion only, runtime evidence that the request was dispatched and no response arrived permits one identical retry. Opportunity writes are not automatically replayed. There is one additional, startup-only case: before any opportunity has been submitted, a previously observed compatible startup for the exact project/search/run may be read again if its complete response was subsequently lost locally and cannot be recovered from the retained capture. Repeat the identical startup SQL and UUID at most once. This shares the startup's single retry budget with transport-loss recovery; the two conditions do not allow two retries.

Known startup acceptance is required for that local-loss recovery; receipt of an undecoded tool response or an HTTP success alone does not establish it. Unknown startup acceptance blocks a local-loss reread. A retained response that can be inspected locally must not be fetched again, and a malformed or rejected contract does not qualify. Revalidate the recovered contract, scope and active lease. The server rechecks authorization, release and privacy scope without renewing the lease; retries of an already-created run cannot supersede a newer execution.

A missing save response is reconciled through the ordinary independent verification call with the original run and item UUIDs. Never resend the opportunity to find out whether it saved. A missing item or unavailable verification remains unresolved and must not be reported as saved. Do not verify after a known rejection, denial, invalid contract or pending approval.

Historical deployment artifacts document earlier response handling, batch intake and completion contracts. They are immutable upgrade history, not additional formats supported by the current saving workflow.

## Updating existing schedules

Setup and execution remain separate. The setup prompt reads the scoped handoff, updates the exact bound automation through its task tool, and acknowledges the successful update in Supabase. It does not perform research as part of setup.

1. Deploy the guarded [current save-protocol upgrade](../supabase/releases/adaptive-search-current-saves-v1.sql) from its reviewed inline-codec predecessor, together with the frontend changes. Its guards reject an unexpected installation; inspect an older baseline before choosing earlier upgrades. The fresh `schema.sql` installer is not an upgrade script.
2. Copy the replacement setup prompt for each existing meta-search automation and paste it once into ChatGPT. Complete its task update and Supabase acknowledgement. Preserve that automation's saved cadence and binding.
3. Use the updated task for manual execution or wait for its next scheduled run. Both routes use the same startup brief.

Copying before deployment can retrieve the older recurring prompt from the installed database. A local code change or frontend refresh alone does not update a saved automation. Tasks still using the historical page-by-page startup retain it until their prompt replacement succeeds. Tasks already calling `begin_adaptive_search_brief` receive the automatic replacement behavior from the deployed server.

The current upgrade retires the previous batch and versioned completion helpers. Refresh the existing task before running it; an old saved prompt will be rejected rather than silently translated. Preserve its task binding and schedule.

You do not paste a prompt before each scheduled occurrence. Changes to saved criteria or feedback enter through startup on the next execution, within the existing authorization and pinning rules. A separate automation needs its own scoped setup handoff; do not use one task's binding to update another.

## Verification boundary

Repository tests should cover the single startup statement and matching SQL/frontend prompt, preservation of authoritative inputs and example selection, the UTF-8 response limit, transactional rollback on invalid or oversized replacement, same-UUID retries, concurrent new starts, stale-worker fencing, authorization and lease checks, direct canonical saving, independent verification and flat completion. Management-only helper permissions must remain intact. Synthetic fixtures and the isolated test database provide evidence for those application contracts.

Installing the database upgrade does not itself execute a search, replace a saved task prompt or change its schedule. Supersession occurs only when an authorized new startup is requested. Production configuration, connector output handling, unattended execution and the reason for a ChatGPT safety denial require separate evidence. Passing offline tests does not establish that a future request will pass a platform safety check.
