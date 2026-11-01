# Refinement and workspace regression tests

Fixtures use invented CVs, letters, private fragments, identifiers and proposals. You need no account, private backup or production credentials. The tests cover the connected version-2 refinement workflow. The suite excludes retired manual imports and standalone drafting APIs.

## Node and build checks

Use Node 22+ and the installed repository dependencies:

```sh
npm test
npm run test:refinement
npm run refinement:prompts:check
npm run test:refinement-protocol
npm run build
```

The [test overview](../../README.md) describes the unit, integration, protocol, database and browser tiers. The full offline suite includes workspace, document, privacy, export and storage tests. Use the focused suite for refinement, structured operations, annotations and preview lifecycle. The build typechecks production code and browser fixtures. Generated task/protocol Markdown must match the current implementation; regenerate it with `npm run refinement:prompts` after protocol edits.

See [prompt testing](./README.md) for offline MCP trace validation and optional live agent runs. Set up and clean up fixtures for live runs. Node tests make no production calls.

## Browser checks

```sh
npm run test:e2e:serve
```

Open [the synthetic runner](http://127.0.0.1:5177/cv-harness/test/browser/pages/refinement.html) and click **Run all synthetic flows**. Confirm the result reads **13/13 browser flows passed**. Each run starts fresh in-memory fixtures and leaves the final workspace visible.

| Flow | Behavior |
| --- | --- |
| `pending-questions` | Carry open questions into the next round, answer the original question, ignore another, and retain the remaining question |
| `first-attachments` | Switch from letter refinement to an approved attachment PDF on the first attempt |
| `preview-revisit` | Reuse unchanged previews after scope or stage changes; invalidate previews edited while the workspace is hidden and render the update on return |
| `scope-layout` | Scope selection, visible task controls, scoped preview/editor and preparation settings |
| `scoped-history` | Merged, scoped Questions with legacy ToDos and comments, letter refinement tab icons and a single CV request field, history summaries without redundant scope or prompt details, CV reset before clearing its history, preservation of letter history, and letter clear returning to the selected template across reload |
| `cv` | Publish, preview an operation proposal, toggle active changes, apply the previous selection only on the next reply, compare, reload, save an independent variant before approval |
| `cv-current-editing` | Edit active suggestions in Current CV, compare with Previous and reload committed work |
| `initial-letter` | Publish an empty letter, apply its initial draft, show grouped Questions without review tabs, retain Tone / Structure / Content input tabs, compare and reload |
| `existing-letter` | Publish the complete current letter, apply a refinement, compare and reload |
| `proposal-review` | Automatic application, ignored annotation feedback, keyboard-accessible note tabs sharing one textarea, notes retained on copy and cleared on the next proposal, clear to template, and approved PDF generation |
| `template-questions` | Template groups and default expansion, frozen guidance and formatting, contextual questions, saved answer feedback, the next refinement, manual header size and reset to template defaults |
| `shared-letter-interests` | Commit the shared-interest selection and text, capture letter context and preserve approved application content |
| `cv-selection` | Pending activation toggles, frozen selections in the next prompt, application on the matching reply, Changes/Questions tab counts, question categories, removed article headers and proposal dropdown, keyboard navigation, draft preservation on tab switching, and exclusions retained across reload |

Use `?flow=cv` (or another listed ID) to isolate a flow; `?sidebar=1` exercises the desktop sidebar. A browser driver clicks `#run-tests` and waits for `body[data-result="passed"]` or `body[data-result="failed"]`. Read `#test-status` and `#test-results` for failures. Starting the Vite server does not execute tests.

The dedicated Vite configuration disables cloud configuration, does not load `.env` files, binds to loopback and restricts connections to its origin. It uses production Vue components, styles and vector PDF build plugins.

## Coverage boundaries

Node workflow tests execute the workspace setup and composables with a minimal Vue renderer. The document-round tests cover simultaneous CV/letter requests in either reply order, target-only freshness, frozen CV selections through letter rounds, separate feedback and lineage, legacy read-only history, and pending textarea commits. Other tests cover request generation, privacy projection, reconstruction, current history, approval concurrency, annotation feedback, local persistence, idempotency, stale baselines and failed commits. PDF provenance tests check exact renderer inputs; separate PDF tests inspect the generated bytes.

Browser flows execute complete components, DOM controls, reactive previews, SVG rendering and vector PDFs. Supabase, authentication, clipboard and storage are synthetic. Reload tests remount from fixture memory; they do not prove browser-restart durability. Synthetic proposals do not test model drafting quality. Check native file selection, production Auth/PostgREST and browser downloads in separate tests.

Run `npm run test:database` for current PostgreSQL suites under `test/database/`, backed by [`supabase/tests`](../../../supabase/tests). The isolated helper installs the atomic current schema and uses synthetic users/JWT claims. SQL acceptance fixtures roll back their writes. See the [test overview](../../README.md) for setup and isolation.

## Additional fixtures

- [Attachments](http://127.0.0.1:5177/cv-harness/test/browser/pages/attachments.html): click **Run attachment workflow**. Seven checks cover manual metadata, application selection, actual PDF page order/sizes and missing-file export blocking. Files are synthetic `File`/`DataTransfer` objects; storage and cloud transport are in memory.
- [Job workspace](http://127.0.0.1:5177/cv-harness/test/browser/pages/job-workspace.html): current opportunities/applications and connected proposal simulation. At a viewport no wider than 760px, `?flow=phone-filters` checks touch controls, filtering and navigation; inspect `body.dataset.filterTest`.
- [CV Studio](http://127.0.0.1:5177/cv-harness/test/browser/pages/cv-studio.html): the complete app with synthetic storage and a sample CV. Check template selection, form scrolling, privacy replacements/exclusions and normal/privacy preview switching at desktop and phone widths. `?performance` records preview layout counts; `?stress` supplies a longer German CV.

Local attachment checks also run through `attachmentMetadata`, `localDocuments`, `localAttachmentsWorkflow` and `applicationPackage` Node tests. Opportunity checks cover filters, grouping, score/recency/deadline boundaries, receipts, account changes and private comments. The fixtures never read real browser CVs or cloud sessions.
