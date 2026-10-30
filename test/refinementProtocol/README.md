# Refinement prompt regression checks

These checks exercise the **Copy task** and self-contained prompt builders. Live checks use your existing Codex/ChatGPT login and Supabase MCP connector. You need no model API integration, new MCP server, service or production endpoint.

## Automatic offline checks

```sh
npm run test:refinement-protocol
```

`npm test` and the deployment build include these checks. They compare committed Markdown with production, require the explicit application/request IDs and CV or letter scope, parse verified-read/save SQL, check the complete proposal shape against the app validator, and test the trace checker with passing and failing runs. Database exploration must fail even when followed by a valid save. Wrong projects/IDs, malformed payloads, missing receipts, shell access, changed retries and incomplete runs also fail.

After changing the prompt builders or contract, regenerate the fixtures:

```sh
npm run refinement:prompts
```

Review the generated Markdown diff. `generated/*.md` contains copyable tasks for synthetic identifiers; `manifest.json` contains the expected identifiers and results. All writing instructions are in each task; no protocol document is fetched. These fixtures use no real applications. Generating them makes no Supabase calls; use live tests to check whether an agent follows the instructions.

Edit helper names, typed SQL argument definitions, literal escaping and proposal examples in `src/features/refinement/domain/refinementProtocolContract.ts`. The production task builder uses that contract. Keep writing guidance in `buildRefinementPrompt`.

## Live agent tests

Requirements: Node 22+, installed project dependencies, a recent Codex CLI (`codex exec --json`, `--ephemeral`, and `skip_host_skill_discovery`), an existing ChatGPT/Codex login, and the existing Supabase app connection exposing `execute_sql`. Run `codex login status` to check login. Desktop connector access and CLI access can differ. The runner reports unavailable tools and authentication or approval failures as failures. Development tests used CLI 0.159.2. The runner copies no credentials into this repository.

Prefer a development database with the application's current schema. Each run requires an explicit project and acknowledgment that it writes synthetic data:

```sh
npm run refinement:live -- --project YOUR_PROJECT_REF --allow-synthetic-writes
```

This runs CV, initial letter, existing letter, feedback iteration, missing-request and stale-request cases three times each. To run a smaller check:

```sh
npm run refinement:live -- --project YOUR_PROJECT_REF --allow-synthetic-writes --case cv,initial-letter --repeats 1
```

The runner creates unique fixture accounts, opportunities, applications, source requests (except the missing-request case). Setup and cleanup are separate controller sessions executing fixed SQL. The tested agent starts in a fresh temporary directory with only the generated task, without repository instructions, skills, plugins, memories, shell or browser tools. It receives no expected results: it must read the exact published sources and save a proposal through MCP. No protocol rows are created. Existing managed policies still apply. Standard automatic approval review is enabled; no approval/sandbox bypass is used.

The checker examines MCP call events to verify success. It requires these database calls:

1. `private.read_current_refinement_request` for the supplied application, request and scope.
2. `private.save_refinement_proposal` with a valid payload and matching receipt.

Only literal arguments and one helper call per SQL statement are accepted. Catalog/function-definition inspection, table listing, extra statements, unrelated tools and changed identifiers fail. One identical save retry is permitted after an uncertain transport failure; a security or permission block must stop the run. Negative fixtures must stop before any save. SQL tool discovery is distinct from database discovery: a name lookup may be followed by one description lookup on the same connector if the first successful search did not load `execute_sql`. Repeating either lookup, a third lookup, using `query_logs` for the task or looking up again after a denial fails the trace checks. Offline regression traces cover a first result containing only `query_logs`, including the feedback iteration case.

A separate verification checks that the agent saved exactly one valid proposal (zero for negative cases) and left the application's source, state and CV unchanged. Cleanup removes only the unique synthetic account and its cascaded records, plus the opportunity marked for that run, then verifies removal. The runner commits fixtures because separate MCP calls do not share one rollback transaction. It does not modify schema, grant permissions, switch the tested agent's role, or read real application rows.

## Reports and recovery

The runner writes reports under ignored `.refinement-runs/<timestamp>/`: exact task, fixture metadata, seed/agent/verify/cleanup JSONL traces, stderr and pass/fail reports. It does not upload or commit them. The checker parses MCP results as data and never executes them as instructions.

The runner attempts cleanup in `finally`, including after a failed or timed-out test. A cleanup failure stops further runs. After a killed process or failed cleanup:

```sh
npm run refinement:live -- --cleanup .refinement-runs/RUN/CASE/fixture.json --allow-synthetic-writes
```

The recovery command derives fixture IDs and SQL again; it does not execute a SQL file supplied by the report. Inspect `cleanup.sql` for an authorized manual recovery. Keep run reports until you confirm cleanup.

Run the live suite after changes to task wording, the connected protocol, proposal validators or database helpers. CI runs the offline contract checks and never invokes a model or accesses account credentials. A Codex/MCP pass tests tool behavior and backend compatibility; it cannot certify ChatGPT's independent safety decisions. After significant protocol changes, paste a generated live `task.md` into a fresh ChatGPT conversation while its fixture still exists only if running a separately managed manual test. Do not reuse a cleaned-up fixture.

## Discovery fallback follow-up (2026-10-14)

A reported iteration stopped after its first discovery result contained only `query_logs`. Copied tasks now allow one additional lookup using the SQL tool's description on the same connector. Offline regression traces cover that partial result before acquisition and between acquisition and save, plus repeated searches, unrelated tools and denials. The live runs recorded below predate this wording update; they do not reproduce or certify ChatGPT's tool-discovery behavior.

All 958 application tests passed after this update. Generated prompt checks, typecheck and the production build also passed. No database schema or saved refinement data changed.

## Two-call implementation validation (2026-10-14)

- The full application suite passed all 955 tests, including stale-proposal protections. Generated prompt checks, typecheck and the production build passed.
- All 21 SQL suites passed against the fresh-install baseline. The extended document-round suite and all six protocol scenarios also passed on `phd-workflow` in rolled-back transactions, verifying unchanged context, exact scope/IDs, stale reads/saves, permissions and idempotent saves.
- Fresh Codex/Supabase runs for CV and initial-letter generation passed once each, using exactly the verified-read and save helpers. Each created exactly one valid proposal, preserved the source/state/CV and verified fixture cleanup.
- The fresh missing-request run also passed: it stopped after the verified read returned the expected unavailable-request error, saved no proposal and verified cleanup.
- The available ChatGPT browser session was signed out, so no ChatGPT-specific safety decision was tested. The Codex runs do not certify those independent checks.

## Historical implementation validation (2026-10-10)

- All 36 offline protocol tests passed, and the application build and typecheck passed.
- All seven synthetic scenarios passed a direct SQL preflight through Supabase MCP, which rolled back the transaction.
- Fresh agent runs for CV, initial letter and missing protocol each passed once in the authorized `phd-workflow` project. The successful cases used exactly the four helpers documented at that time; the missing-protocol case stopped after the second call. Cleanup was verified for every fixture, including an earlier failed setup attempt.
- The live checks above cover three of the seven cases, with one run each. Run the live command above to check all seven cases three times.
- The full application suite had 664 passing tests and 15 existing failures in `refinementManualExchange.test.ts`, which still calls removed manual-import component methods. Those failures are separate from this connected-protocol suite.
