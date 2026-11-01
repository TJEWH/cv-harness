# CV Harness

CV Harness is a personal workspace for research, PhD, and job applications. Maintain reusable CVs and letter templates, tailor documents for each application, and assemble PDF packages for submission.

Use **CV Studio** without an account. Connect Supabase to review opportunities, manage applications, and refine documents through ChatGPT. The interface supports English and German on desktop and mobile.

## Run locally

Requires Node.js **22.13 or newer** and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (default: [localhost:5173/cv-harness/](http://localhost:5173/cv-harness/)). You can leave Supabase unconfigured for local CV editing and PDF export.

## Workspaces

| Workspace | Use it to |
| --- | --- |
| **CV Studio** | Edit CV variants, customize layout and typography, manage letter templates, set privacy replacements, and store supporting files. |
| **Opportunities** | Review research, record interest, create applications, and prepare a reusable meta-search prompt. Requires Supabase. |
| **Applications** | Prepare application documents, review refinements, assemble PDF packages, and track progress. Requires Supabase. |

In **Opportunities → Insights → Clusters**, choose **Job clusters** and switch between **Network**, **Hierarchy**, and **Hierarchical edge bundling**. Bundling connects jobs that share topics through their cluster hierarchy. Curve colors range from blue for one shared topic to red for the maximum under the current settings; if every connection shares one topic, all stay blue. All three views use the same date range, current-only filter, minimum interest, cluster count, and topic exclusions. Select a job to inspect its full context; isolated jobs stay available. Hover, keyboard-focus, or tap a curve to see all its shared-topic names nearby; **Escape** dismisses the tooltip. Pinch the bundling chart on a touchscreen or trackpad to zoom, scroll to pan, and use **Reset view** to return. With the chart focused, **+**/**−** zoom and **Home**/**0** reset. Dense charts scroll horizontally, and compact charts use numbered job buttons with full titles available on focus or selection.

The **Meta research** sidebar tab combines one shared profile for job types/sources, alternative research interests and tasks, salary/funding conditions, and regional priorities into English system and user prompts. Committed edits autosave to Supabase. Use **Copy replace prompt** and paste the short instruction into ChatGPT to read the saved definition once and replace the existing meta-search scheduled task. Each scheduled run loads the current search protocol and saved criteria, verifies writes to the existing opportunity catalogue and reports only new or materially changed strong matches. New recommendations require at least 72 hours before the official deadline. Copying a prompt does not create a schedule. See [meta-search behavior and protocol](docs/opportunity-meta-searches.md).

Letter templates use shared meta-search research interests by default, with a checkbox to use custom template interests instead. Each application letter keeps its own saved copy, with the existing privacy preview before sharing.

Salary & funding includes a sourced 0–10.0 living-standard assessment when available, assuming a private room in a shared flat, with a separate salary verdict and a breakdown for affordability, room search, culture, nature, student life and climate. Research uses the university/campus city when the city field is empty, averages stated pay ranges or progression, and identifies provisional institutional funding benchmarks. Company roles without published pay or an applicable scale remain unscored. See the [scoring rubric and research contract](docs/living-standard.md).

### Application workflow

Move between these stages in any order:

| Stage | Actions |
| --- | --- |
| **Preparation** | Choose a saved CV and letter template; review the opportunity and required documents. |
| **Refinement** | Request changes, review the result, edit wording, and approve the CV and letter. |
| **Attachments** | Select supporting files, arrange the package, preview it, and download the PDF. |
| **Tracking** | Record application status and notes; review status history. |

Template selection creates independent application copies. When an application opens, an unchanged working CV or empty letter updates to its selected source's latest revision after checking refinement history. Proposals, manual document edits and approvals protect that document from automatic replacement. Clearing a document's refinement history makes the restored copy eligible again on the next open. Missing sources or unavailable history leave saved copies intact. In Refinement, use **Save as new CV variant** to save the displayed CV, including selected proposal changes, as a complete independent variant. Approval is not required. The saved copy remains available after clearing refinement history or changing the application's source.

For ChatGPT refinement, select **CV** or **Letter** and copy the task into a conversation with access to the project's Supabase MCP `execute_sql` tool. Copying a task does not start ChatGPT. ChatGPT reads the published sources and saves a proposal. Review CV suggestions in the **Changes** and **Questions** tabs, each showing its count. Questions are grouped by application requirements, your experience, follow-ups and other topics; older ToDos and comments remain visible in Questions. Activate or deactivate individual CV changes beside their old and proposed versions. Copying the next task freezes that selection in its source; the matching ChatGPT reply applies the previous active changes and leaves its new suggestions pending. Letter proposals update the working letter directly. Review the result and approve each document before export. See the [refinement guide](supabase/REFINEMENT.md) for the protocol and review rules.

CV and letter requests run independently, with separate feedback, history and draft notes. Letter review shows grouped **Questions** directly, without review tabs; its **Next Refinement** editor retains **Tone / Structure / Content**. Changes to one document do not invalidate the other document’s pending reply. Existing combined rounds remain readable history and cannot be answered, applied or continued.

Both refinement scopes keep the preview visible and share **Previous** / **Current** controls. Previous shows the frozen request snapshot. **Edit manually** starts from Current, including active CV suggestions. Saving a manual CV edit keeps that version in the application; start a new refinement to request further suggestions. Approving the CV also applies its active suggestions, so the approved document matches Current.

Unanswered questions carry into later refinements of the same document until you select **Resolved** or **Ignored**. They remain editable with their original question reference and are included in the next request as pending questions, never as confirmed evidence. Clearing a document's refinement history also clears its carried questions.

Questions offer **Resolved** and **Ignored**; neither is selected while a question is open. Saving a changed nonempty answer resolves it unless it is ignored. Ignored answers remain editable and stay ignored during nonempty edits. Saving an empty answer clears either selection and reopens the question. Ignoring or clearing an answer withdraws its earlier feedback from future refinement.

Package export requires both document approvals and the files for all included attachments. Submit the downloaded package through the institution's portal or email, then update **Tracking**.

## Documents, privacy, and backups

CV and letter PDFs contain selectable text, clickable links, and vector graphics. Adjust sections, fonts, margins, and page breaks in CV Studio. Add supporting PDF, PNG, or JPEG files through **Local attachments**; convert office documents to PDF before attaching them.

Full working CVs, letters, letter templates, and private refinement data stay in browser storage. Supporting files and package archives use IndexedDB. Signing in does not upload a CV. The meta search autosaves committed strategy, professional context, profiles and daily time to the signed-in owner’s Supabase workspace, with local draft recovery. Copying its replacement instruction waits for pending saves; application approvals and submissions remain separate.

Refinement publication sends privacy-filtered sources and feedback to Supabase. Review the outgoing content: masking known fields cannot remove identifying details from all prose. Saving an attachment's metadata while signed in shares its name, description, and identifiers; its file contents stay on the device.

Keep separate backups before changing devices or clearing browser data:

- **CV Studio → Variants**: export content and configuration JSON. Enable **Bypass privacy proxy** for a complete private CV backup; default content exports apply privacy settings.
- **CV Studio → Letter templates**: export the template library.
- **CV Studio → Local attachments → Back up files & packages**: export supporting files, package arrangements, and archived PDFs.

Cloud history cannot restore private working originals or local files. See [JSON formats and import behavior](docs/json-format.md) before editing or restoring a backup.

## Connect Supabase

1. Follow the [Supabase setup guide](supabase/README.md) to prepare the database and provision accounts. Use `schema.sql` for a new database; use targeted migrations for an existing workspace.
2. Copy [`.env.example`](.env.example) to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Restart Vite and sign in with an existing account. The project administrator manages registration and password recovery.

Use a publishable key or a legacy `anon` key in frontend configuration. Keep secret and `service_role` keys out of the frontend. Database grants and row-level security control access to shared research and private application records.

## Development

New autosaving textareas must follow the [shared textarea behavior](docs/textarea-behavior.md): save on blur or Enter, keep typing local, and flush before navigation.

The app uses Vue 3, TypeScript, and Vite. It runs as a static frontend with local tab navigation. PDFKit and Fontkit handle CV and letter exports, pdf-lib assembles application packages, and PDF.js renders package previews.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run typecheck` | Check application, Vue, build, and test types. |
| `npm test` | Run the Node regression suite. |
| `npm run test:refinement` | Run refinement and privacy regressions. |
| `npm run test:refinement-protocol` | Check generated instructions and the connected protocol. |
| `npm run test:e2e:serve` | Serve the synthetic browser test runners. |
| `npm run build` | Typecheck and build into `dist/`. |
| `npm run preview` | Serve the production build for local inspection. |

Browser tests use in-memory data and an isolated Vite configuration. Follow the [testing guide](./test/README.md) to run them. Database tests require a separate run; `npm test` does not verify deployed permissions.

| Path | Contents |
| --- | --- |
| [`src/app/`](src/app) | App shell, workspace coordination, and shared cloud contracts. |
| [`src/features/`](src/features) | CV Studio, opportunities, applications, meta search, refinement, letter-template editing, and attachments. |
| [`src/documents/`](src/documents) | CV and letter models, previews, privacy transformations, layout, and PDF rendering. |
| [`src/shared/`](src/shared) | Shared UI controls, editing behavior, and small browser/text helpers. |
| [`src/platform/`](src/platform) | Supabase configuration, authentication, and transport helpers. |
| [`src/i18n/`](src/i18n) | Shared English and German labels. |
| [`build/`](build) | PDF renderer adapters and build plugins. |
| [`supabase/`](supabase) | Database setup, refinement contracts, and SQL tests. |
| [`test/`](test) | Regression suites and synthetic browser fixtures. |
| [`docs/`](docs) | Architecture, editor behavior, data formats, and protocol guides. |

See the [architecture guide](docs/architecture.md) for folder ownership, naming conventions, and the modules that still span several responsibilities.

The PDF renderer uses build-time adapters for pinned dependencies. After changing those dependencies, check the adapters, run the tests and build, and inspect document previews and exports in the browser.

## Deployment

The [GitHub Actions workflow](.github/workflows/deploy.yml) builds and deploys to GitHub Pages after a push to `main`. Configure Pages to use **GitHub Actions** and supply the public Supabase build variables through the `phd-workflow` GitHub environment.

The build targets `/cv-harness/` and writes to `dist/`. For another static host, run `npm run build` and serve that directory. Change `base` in [`vite.config.ts`](vite.config.ts) to match the hosting path, using `/` for a domain root.

## Documentation

- [Architecture and source ownership](docs/architecture.md)
- [JSON formats and editing workflow](docs/json-format.md)
- [Supabase setup and security model](supabase/README.md)
- [Application refinement contract](supabase/REFINEMENT.md)
- [Test organization and commands](./test/README.md)
- [Application and browser coverage](./test/protocol/refinement/TESTING.md)
- [Refinement protocol tests](./test/protocol/refinement/README.md)
- [Product scope and constraints](PRODUCT.md)
