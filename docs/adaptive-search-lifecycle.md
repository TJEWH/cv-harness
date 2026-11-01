# Controlled execution abort — lifecycle contract 1

This feature manages a CV Harness database run. It does not stop or reschedule the recurring automation, and database fencing does not prove that an external model worker stopped. Implementation and verification use repository source, synthetic fixtures and the isolated PostgreSQL test container. No production cancellation, restart, permission change or deployment was performed.

## Existing blocker and the smaller workflow

`begin_adaptive_opportunity_search` serializes acquisition using the owner/search `adaptive-lease` advisory lock. A running legacy execution or a current adaptive lease can return `run_in_progress`. The automation task, provider execution and database run have separate identities. A UUID from an old conversation cannot select the current blocker.

The previous recurring instructions proposed an empty failed-completion manifest for abandoned research. That shortcut has been removed. Normal research stops on a blocker; it never prepares or applies cancellation. Lifecycle actions use a small metadata contract rather than startup pages, criteria, feedback, catalogue snapshots or reconstructed research payloads. Research and lifecycle share the bounded response decoder and failure taxonomy.

## Owner actions

Open **Execution management** in the existing adaptive-search dashboard. Choose **Abort current execution** or **Abort and reserve restart**. Preparation persists one operation UUID before making a parameter-bound owner RPC. The server authenticates the owner, checks the configured project, runner authorization and task binding, and pins the actual blocking run plus its concurrency version. It never selects an arbitrary latest run.

Review the returned target and confirm. Native execution calls apply, then reads the persisted operation in a separate transaction. Alternatively, **Copy exact instructions** supplies a prepared, scoped English handoff with only these statements:

```sql
SELECT private.apply_adaptive_search_lifecycle('<prepared-operation-uuid>'::uuid) AS lifecycle;
SELECT private.read_adaptive_search_lifecycle('<same-operation-uuid>'::uuid) AS lifecycle;
```

These are separate actions, not a chained SQL request. The management helpers accept only an already owner-prepared operation. A supplied owner UUID, copied prompt or operation ID is not authentication. The native equivalents are authenticated `public.apply_adaptive_search_lifecycle` and `public.read_adaptive_search_lifecycle`; preparation is `public.prepare_adaptive_search_lifecycle(search_id, project_ref, mode, operation_id)`.

The two reusable English templates and their identifiers are **synthetic test fixtures**:

- [Abort instruction](adaptive-search-lifecycle-abort.example.md)
- [Abort-and-restart instruction](adaptive-search-lifecycle-abort-and-restart.example.md)
- [Closed request schema](../supabase/contracts/adaptive-search-lifecycle.request.schema.json) and [response schema](../supabase/contracts/adaptive-search-lifecycle.response.schema.json)
- [Abort metadata example](../supabase/contracts/adaptive-search-lifecycle.abort.example.json) and [combined metadata example](../supabase/contracts/adaptive-search-lifecycle.abort_and_restart.example.json)
- [Verified abort and reserved restart receipt](../supabase/contracts/adaptive-search-lifecycle.verified.example.json), showing preserved partial work and no dispatch receipt

## Guarantees and outcomes

- Abort uses the existing `failed` state, partial coverage and structured `owner_cancelled` reason, with a permanent `owner_cancel_operation_id` fence. It releases only the pinned run's lease and preserves accepted batches, catalogue records, sources, reviews and application context.
- Mutation boundaries lock the run and check the cancellation fence. A racing write either commits before abort and is retained, or is rejected afterwards. Already committed batch receipts remain readable without new side effects. A stale worker cannot restart, verify, complete or rewrite the cancelled run.
- Preparation pins the target once. Exact retries keep the original operation, target and mode; a newer run is never substituted. Missing or ambiguous targets, changed binding/version and conflicting inputs produce explicit outcomes. No active run means no abort and no restart, including combined mode.
- Combined mode reserves one restart UUID. Verification must observe the committed abort in a later transaction before the existing startup path can accept that UUID. A competing legitimate start blocks the reserved restart; it is never cancelled to force the restart through. A supported caller uses the current saved definition through the existing startup helper.
- **There is no run-aware worker dispatch adapter in this repository.** Native controls and copied lifecycle instructions report `reserved_not_dispatched`; they do not call startup to imitate dispatch or use automation “run now.” A created startup context is separately labelled `startup_accepted`, with `dispatch_receipt:null`. Research completion is reported only when an independently persisted adaptive completion exists. Cancellation success remains valid when restart cannot be dispatched.
- Local display truncation requires reinspection of the retained response. Unknown failures do not justify replay. Only runtime-confirmed dispatch with no received response permits one identical automatic retry. A structured approval, permission or safety denial stops the operation; the UI durably blocks that saved command. Delivery and external worker termination remain unknown.

The browser stores the operation identity, stop state and bounded raw lifecycle responses privately, scoped by owner, project, search and operation. These captures are metadata rather than research payloads; they are not console logs or uploads. **Inspect saved response** re-decodes a capture locally without a database call. Server persistence is authoritative for the target, counts, cancellation and restart reservation. Storage failure stops further actions rather than inventing another identity. The lifecycle UI does not fetch feedback or research inputs to identify a target.

Fencing applies to the supported run-dependent helper boundaries. It does not turn the privileged management SQL connector into a database sandbox or restrict independent owner operations such as editing preferences. Generated research and lifecycle instructions keep their helper allowlists separate.

The three native owner RPCs are deliberate, narrowly scoped `SECURITY DEFINER` bridges with an empty search path and explicit authenticated, nonanonymous ownership checks. Only `authenticated` receives execution permission; anonymous and service-role callers receive none, and no direct access to lifecycle storage is granted. This avoids granting owners general run/table mutation permissions. Research helpers retain their existing invoker/management boundary. Security regressions enumerate these three exceptions by exact signature and test cross-owner denial.

## Local verification

```sh
npm run test:adaptive-search-recovery
npm run test:adaptive-search-lifecycle
npm run typecheck
npm run db:schema:check
npm run adaptive:release:check
```

Database tests use the existing labelled, network-disabled PostgreSQL 17 fixture; its guard rejects production URLs, exposed ports and bind mounts. Tests cover partial work, no-active/ambiguous outcomes, owner/scope/binding failures, exact retries, stale handoffs, separate-transaction readback, reserved identities, current-definition startup, competing starts and two-session batch/completion races. Browser fixtures use fake RPCs with external requests blocked, checking desktop/mobile controls and denial handling.

Verified locally on November 1, 2026: **103 focused offline tests**, **17/17 final lifecycle/release database cases**, the affected AF-08 batch regressions, typechecking, source/schema fingerprints and both browser gates at 1440px and 390px. A full 115-case database sweep was followed by passing affected-module reruns after aligning the historical-seeding and lifecycle-permission fixtures. The targeted upgrade was separately tested against baseline `5df7039`, including simulated broad owner default grants, preservation of pre-existing records, post-upgrade fencing and safe refusal of a second installation. These results do not establish production or provider behavior.

## Deployment and rollback checklist

1. Review the current schema modules and [versioned targeted upgrade](../supabase/releases/adaptive-search-lifecycle-v1.sql). The upgrade is generated from the recorded repository baseline, adds only lifecycle storage/fencing and replaces the affected function definitions. It does not modify saved search definitions, existing task prompts, schedule bindings or release enablement. It requires the existing adaptive contract and refuses a repeated or partial lifecycle installation.
2. Under separate deployment authorization, verify the installed baseline and apply the upgrade atomically as the existing management database owner. Test the authenticated owner RPCs, closed metadata and role restrictions in staging. Do not grant assistants access to private tables or schema discovery. Existing production state and permissions have not been verified by this implementation task.
3. Deploy the UI only after the database contract is available. Review task handoffs explicitly if desired; installation does not update existing automation prompts, cadence, enabled state, notifications, model or reasoning settings.
4. Before enabling real use, verify staging abort fencing against delayed workers and confirm authoritative post-commit readback. Treat actual provider stopping, exact worker dispatch, notification delivery and production races as unverified until separately exercised. Do not claim that offline success resolves a ChatGPT safety block.
5. For rollback, hide the new UI/preparation entry point and, if required under separate authorization, revoke preparation from authenticated callers. Keep cancellation columns, operation history, mutation guards and protected run triggers installed. Preserve readback for existing receipts. Restoring old mutation functions or clearing cancellation markers would reopen stale-worker writes and is not a safe rollback. Resolve a defect with a reviewed forward fix; never delete accepted work or resurrect an aborted run.
