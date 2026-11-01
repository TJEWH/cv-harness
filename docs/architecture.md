# Architecture and source ownership

Organize source by the workflow or document capability it belongs to. Names distinguish editor screens, document renderers, preview controllers, and storage adapters. Folder and naming changes preserve application behavior, persistence formats, and protocol contracts; modules that still mix responsibilities are listed below.

## Source map

| Folder | Ownership |
| --- | --- |
| `src/app/` | `App.vue`, the combined `CloudWorkspace` screen, workspace state coordination, and `cloudTypes.ts`. |
| `src/features/cv-studio/` | CV editing, variants and backups, section versions, and design controls. |
| `src/features/opportunities/` | Opportunity presentation, deadlines, evaluations, feedback, disposition, and card interactions. |
| `src/features/applications/` | Application preparation and tracking, working CV copies, document packages, and the deadline calendar. |
| `src/features/meta-search/` | Shared search intent, local/cloud search persistence, adaptive planning, runner contracts, and the dashboard. |
| `src/features/refinement/` | Refinement publication, proposals, privacy projection, change review, annotations, and history. |
| `src/features/letter-templates/` | The letter-template editor. Letter models and persistence remain under `documents/letter/`. |
| `src/features/attachments/` | Attachment editing, metadata transport, local file storage, and attachment contracts. |
| `src/documents/cv/` | CV contracts, defaults, validation, rendering components, design application, and CV session storage. |
| `src/documents/letter/` | Letter contracts, templates and revisions, contact/formatting rules, previews, and captured search interests. |
| `src/documents/privacy/` | Document anonymization, field replacements, privacy editor context, and cloud privacy snapshots. |
| `src/documents/layout/` | Content ordering, timeline layout, and font loading shared by document rendering. |
| `src/documents/pdf/` | Layout capture, vector rendering, PDF.js integration, preview controllers, and preview surfaces. |
| `src/shared/ui/` | Shared controls, toasts, sidebar portals, and responsive action placement. |
| `src/shared/editing/` | Editor publication/flush coordination, textarea drafts, and recoverable per-record text drafts. |
| `src/shared/lib/` | Markdown text, safe URL, and clipboard helpers. |
| `src/platform/` | Supabase client/configuration, authentication, and paginated transport helpers. |
| `src/i18n/` | The shared translation dictionary. |

`src/main.ts` registers Vue, PrimeVue, icons, and global styles, then mounts the app. Global CSS and the favicon remain in `src/assets/`; bundled fonts remain in `public/fonts/`.

## File and subfolder conventions

Place a module with its owning feature or document capability. Put a shared module under `shared/` when several owners need the same behavior. Keep third-party client setup and authentication under `platform/`.

Use these subfolders where they help distinguish responsibilities:

- `components/`: Vue components for that owner.
- `composables/`: Vue state, lifecycle, and reactive integration.
- `domain/`: calculations, validation, transformations, and protocol rules.
- `data/`: repositories, persistence, and remote transport.
- `interaction/`: DOM interaction controllers such as opportunity-card swiping and scroll tracking.

Keep PascalCase for Vue component filenames and descriptive camelCase for TypeScript modules. Reserve `use…` for Vue composables. Name persistence modules for the data they own, such as `data/searchTemplateRepository.ts` and `data/cvStorage.ts`.

Name components for their role:

| Name | Role |
| --- | --- |
| `CvContentEditor` | CV content fields, sections, and editor controls. |
| `CvVariantManager` | Saved CV variants, selection, JSON import, and backup export. |
| `MetaSearchEditor` | The shared meta-search profile and its persistence. |
| `LetterTemplateEditor` | Reusable letter-template editing. |
| `CloudWorkspace` / `useCloudWorkspace` | The combined opportunities/applications screen and its account-scoped data coordination. |
| `CvDocument` | CV HTML rendering, including the source used for PDF export. |
| `CvDocumentPreview` / `LetterDocumentPreview` | Document-specific source, preview lifecycle, and export integration. |
| `InlineDocumentPreview` / `FullDocumentPreview` | Shared inline and full-size presentation shells. |
| `PdfPageViewer` | The selected rendered page, including zoom and page gestures. |
| `PdfCanvasPage` | PDF.js canvas, text layer, and links for an existing PDF page. |

Keep domain types beside their owner. `opportunityTypes.ts` contains generated catalogue types; update its schema and generator together. Keep declaration files such as `env.d.ts`, `vendor.d.ts`, and `components.d.ts` at the source root.

Use explicit imports to the owning module. The current structure has no import-boundary enforcement or feature-wide barrel exports.

## Current cross-boundaries

CV content editors share `features/cv-studio/components/CvSectionFrame.vue` for the section shell, collapse target, visibility, title editing, heading size, completion, and keep-together controls. `SectionList` supplies item editing; `CvContentEditor` supplies custom body/sidebar fields. Privacy headings, version selectors, and section-specific actions use slots. The callers own editor state, IDs, focus restoration, and persistence; the frame only emits control actions.

`features/meta-search/composables/useSharedSearchSource.ts` owns the shared search-profile read policy, local/cloud precedence, cached hydration, and account-scoped stale-result protection. Letter templates request a fresh cloud preview when no local source exists; applications can explicitly refresh an acknowledged local source. Application actions still decide when to capture or replace the independent `letter.searchProfile` snapshot. Loading the shared source performs no storage or cloud writes.

The folders describe ownership. Several modules still combine responsibilities, and existing imports cross those folders:

- `app/App.vue` coordinates navigation, local CV persistence, and previews. `app/components/CloudWorkspace.vue` coordinates both opportunities and applications. `app/composables/useCloudWorkspace.ts` owns their shared account lifecycle, cancellation, and ordered cloud mutations. Keep that coordination intact when extracting repositories in a later pass.
- `app/cloudTypes.ts` contains application, opportunity-review, and CV-snapshot contracts. Other features and document modules still import those contracts.
- `features/applications/applicationCv.ts` combines application CV persistence with copy/difference helpers. `features/refinement/applicationRefinement.ts` combines protocol validation, request/proposal operations, prompt construction, and cloud persistence. Both remain at their feature root until their responsibilities can be separated.
- `documents/letter/motivationLetters.ts` combines template defaults, validation, local persistence, compatibility upgrades, and document revisions. `documents/letter/searchLetterContext.ts` imports meta-search contracts and content-key calculation to capture research interests for a letter.
- `features/meta-search/data/searchTemplateRepository.ts` combines defaults, compatibility conversion, validation, and the local repository. The search and letter repositories share the pure field merge in `shared/lib/mergeRecordChanges.ts`; each repository owns validation, conflict errors, metadata, revision and no-op rules, and writes.
- `documents/cv/data/cvStorage.ts` owns CV session storage and also exports a debounce helper used elsewhere. `documents/layout/webFonts.ts` includes browser font-loading behavior.
- `features/opportunities/domain/opportunityContext.ts` imports presentation builders that refer back to its node types through type-only imports. The structural pass preserved those type relationships.

CV Studio, application CVs, and letters share `documents/pdf/composables/useDocumentPdfPreview.ts` for render scheduling, stale-work cancellation, completed-page caching, input commit deferral, export coordination, and cleanup. Studio uses independent normal/privacy controllers with its existing timing and page-retention policies; it owns the shared export-error surface and renderer resource cleanup. Document source selection, signatures, render options, and visibility remain with each caller.

Keep live-document rendering and existing-PDF parsing separate: `useDocumentPdfPreview` owns DOM rendering and export invalidation; `usePdfBlobPreview` owns PDF.js parsing and worker cleanup. Shared preview controls consume their results.

`shared/lib/mergeRecordChanges.ts` applies a three-way field merge to the editor baseline, incoming editor value, and current saved value. It preserves concurrent changes in untouched fields and reports conflicting field names without mutating inputs or writing storage. Equality retains the repositories’ existing JSON serialization semantics.

## Editing and persistence contracts

Follow the [textarea behavior](textarea-behavior.md). Use `shared/ui/AutosaveTextarea.vue` or the CV-specific `documents/cv/components/MarkdownTextarea.vue`, keep typing in a local draft, and commit on blur or Enter. Publish pending textareas through `shared/editing/textareaCommit.ts`, then await the relevant persistence flush before navigation or replacing an editor. A text commit must keep disclosure, upload, and workflow submission as separate actions.

`shared/editing/editorSession.ts` defines the runtime `flush()` contract and its synchronous counterpart for local stores. A session publishes textarea drafts, drains ordered persistence steps, and returns an explicit safe-to-leave result. Owners capture their account/record lifecycle and child editors; the coordinator checks that scope, composition readiness, and the native draft revision before and after each step. New typing during an asynchronous save stays unpublished and prevents navigation. Existing method names remain compatibility aliases.

CV Studio, opportunities/applications workspaces, search templates, CV sections, refinement annotations, and opportunity feedback/status controls use that coordination while retaining their own queues, snapshots, validation, recovery, and retries. Letter templates expose local-save flush; attachments expose private text-recovery flush only. A successful attachment flush does not save a file, share metadata, or approve disclosure. Failed local library drafts remain scoped to their account; forced account changes retain an in-memory recovery snapshot for that owner to revisit. Native library editor instances are keyed by account so an unfinished composition cannot cross into the incoming owner’s draft.

`shared/editing/useApplicationNotesAutosave.ts` supports application notes and opportunity text drafts. Keep its account/record scoping, queued snapshots, recovery, and retries when reusing it.

Use `shared/ui/useToasts.ts` for operation updates and `InfoHint.vue` for helper information. Preserve toast behavior at the mobile breakpoint. See [AGENTS.md](../AGENTS.md) for the full interface rules.

## Supporting directories and path-sensitive tooling

- `build/` contains PDF renderer adapters and Vite support for pinned dependencies.
- `supabase/schemas/` contains ordered current SQL modules; `schema.sql` is their generated atomic installer. `supabase/contracts/` owns current JSON schemas, `supabase/releases/` fingerprints current source, and database SQL assertions live under `supabase/tests/` and are exercised by `test/database/` suites. Historical upgrades and conversion fixtures remain in Git rather than the current install path.
- `test/unit/` and `test/integration/` group offline regressions by product area. `test/database/` owns current PostgreSQL suites, `test/protocol/` owns prompt/trace contracts, and `test/browser/` separates pages, flows and interaction specs. Shared harnesses and fixtures live under `test/support/`; compile-time contracts live under `test/types/`.
- `scripts/` contains database schema assembly, schema type generation, and current release fingerprint checks.

Source paths also appear in test harnesses, documentation, build configuration, and the adaptive-search release manifest. When moving a module, update those references and use the existing release tooling to refresh affected artifact hashes. Keep generated protocol fixtures and schema references consistent with their source modules. Follow the [testing guide](../test/README.md) for commands, isolation and validation.
