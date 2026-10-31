# CV Harness

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The project owner uses CV Harness to prepare their own research, PhD, and career applications. Design for that workflow; the owner has not requested support for a broader applicant audience.

## Product Purpose

Use CV Harness to review opportunity research, reuse career material, tailor CVs and motivation letters, assemble PDF packages, and track applications.

The owner should be able to reuse accurate career material, choose what to share and approve, and produce complete documents for submission.

## Positioning

The owner starts each application with copies from a reusable document library and the opportunity's research. They can ask ChatGPT to propose CV and letter changes, review and edit the results, and approve each document. Do not claim that CV Harness outperforms competitors or improves application outcomes without evidence.

## Operating Context

- In **CV Studio**, edit career variants, CV content, document design, privacy settings, letter templates, and local attachments. You do not need an account.
- In **Opportunities**, review research and requirements, record interest, and create applications. The **Meta research** sidebar tab edits one shared profile with job types/sources, alternative research interests and tasks, funding conditions and regional priorities. Optional additional search instructions sit at the bottom of **Shared search profile**. Committed edits autosave search intent and the full English prompts to Supabase. **Copy replace prompt** prepares one read of the saved definition for ChatGPT to replace the existing meta-search task. Copying itself does not change a schedule; scheduled executions retain the existing research protocol. **Adaptive search** groups feedback, policy and ChatGPT task setup in a collapsible above **Search schedule**. The schedule offers an interval in hours or calendar days with local time and timezone; imported cadences stay intact until an explicit edit. Ratings and profile edits take effect on the next adaptive run, while cadence changes require a copied task update in ChatGPT.
- **Insights** explores current account feedback independently of Results filters. **Trends** is the initial body; **Clusters** and **Interest patterns** provide topic/job exploration and feedback/place breakdowns. The same labels appear on desktop and mobile. Only the active heavy view is mounted. One compact bottom brush shares an inclusive local-date range across views, starts at All history, previews locally, commits on release, and supports pointer/keyboard selection, resizing, translation, and cancellation. Starting a gesture invalidates prepared copies. Every chart uses catalogue **Added** time (`Opportunity.created_at`), not rating/save/update time. Missing Added dates remain in All history but outside dated trends; excluded, other-account, and future-added records do not contribute.
- Trends’ fixed **Outcomes**, **Topics**, and **Alignment** row controls added/reviewed/high-interest/misalignment trends, up to five topic trends, and alignment measures with samples and statistical gaps. Alignment offers a 95% Wilson high-fit hit-rate interval, absolute score gap, and Spearman rank agreement. Auto groups daily through 31 days, weekly through 180, then monthly; explicit grouping remains available. Requests beyond 4,096 periods retain their requested range/grouping and explain recovery. Keyboard-accessible bucket inspection, readouts, and compact summary remain; the Period data table and separate detailed statistics are removed. Feedback drivers, interest distribution, institutions, and countries live in Interest patterns. These are current feedback values grouped by addition date, not historical ratings or proof of model improvement.
- Topic formatting normalizes underscores, case, whitespace, and NFKC duplicates into readable sentence case with technical acronyms preserved. Initial research prompts request this format. Stored records and the recurring/SQL protocol remain unchanged, and raw/normalized/canonical text each retain privacy checks. Topic filters default to **At or above 8**, including after account changes; All topics and At or below remain available. All and At or above offer minimum matching jobs, initially 3 (clamped to the available maximum after loading), with the maximum set by the largest topic count at the current interest threshold and Added-date range. Tightening the cohort clamps the selected minimum to that maximum; an empty cohort disables the control. At or below exposes only maximum interest, initially 4: a topic needs an eligible recorded interest score at/below that maximum and none above it. Review choices, applications and confirmed submissions provide scores; unknown interest does not. Only explicit negative topic reasons mark avoidance. An unchecked **Current opportunities only** checkbox is shared by Topic clusters and Job clusters. It excludes passed deadlines and the owner’s manually archived opportunities from those views, using Results’ rules; unknown/invalid deadlines remain included. Topic/job graphs, counts, and matching lists use that filtered cohort, while timelines and overall statistics retain the full selected-time cohort. The checkbox resets per account.
- **Job clusters** is the default explorer mode and appears before **Topic clusters**; both provide a default 2D network with panning, optional controlled 3D, and an accessible SVG dendrogram. The topic dendrogram shows the full hierarchy without a relationship-strength slider or cutoff. Topic relationships distinguish observed shared jobs from sparse local word-family hints; recorded preferences and sample support weight supported links without inventing unrelated ones. No external AI service or verified semantic-similarity claim is involved. Selecting topics links trends and matching jobs; selected/direct-neighbor topics remain prominent while unrelated ones stay selectable and muted. **Matching jobs** follows the visual, with topic search/list beside it on desktop and afterward on mobile. Complete selected-job topics/reasons and list-based recovery remain available. Open opportunity jumps from the selected job to its catalogue detail after pending editor saves complete, even when Results filters hide the record. Network/group legends, shared-job/wording disclosure panels, and visible zoom buttons are removed; view/reset, keyboard controls, plot bands/branches, and leaf labels remain.
- Job clusters use explicit interest ≥8.0 initially, with a 0–10 minimum-interest slider in 0.5 steps committing on release. A shared **Clusters** control requests 1–10 groups, initially 5 and limited by the eligible job count, in both network and hierarchy views. Deterministic size-balanced k-means partitions normalized topic and recorded-feedback vectors, with group sizes differing by at most one job. Related word-family/acronym groups reduce naming differences while exact labels remain distinct from inferred groups. **Exclude topics** is a separate searchable checkbox multiselect ordered by cohort frequency; checked topics are removed before inference in both views, with coverage counts and a clear action. Exclusions reset per owner and retain every eligible job, full context, matching jobs, and full-cohort statistics. Aliases count once, and local topic-group inference cannot spread through generic words or transitive chains. Targeted topic reasons outweigh weak whole-job sentiment, and equal sentiment alone creates no supported relationship. Balance quotas may group weakly related or topicless jobs without establishing common topics or positive evidence. Both views use the same partition. Both job network and hierarchy span the full content width; their job search and topic exclusions sit beside Matching jobs below the visualization. Job and topic sliders sit beside their section title, wrapping on narrow screens. Cluster-mode buttons occupy the desktop sidebar major action area, with Network/Hierarchy beneath them. The minor area places 2D/3D/Reset above Current opportunities only; camera controls disappear in Hierarchy. Shared sidebar portals keep controls inline on mobile and scope them to the active workspace. Network canvases use a taller responsive height. Job titles receive a larger label column and wrap to two lines on narrow screens. The job dendrogram has one separate root per k-means group; average-link branches display relative similarity only within that group. Its percentage axis is relationship strength, not a k-means probability. Colored groups/branches and selectable leaf labels remain, without a shared-topic threshold, intergroup merge, or cutoff line. Dense networks render each job's strongest links while retaining complete evidence for focus and within-group relationships.
- **Copy analysis prompt** prepares English, privacy-filtered `opportunity-insights-v4` for manual ChatGPT use. It labels the exact Added-date range, coverage, available preceding-period comparison, and view-only topic/job filters including requested job cluster count; canonical high-interest statistics remain ≥8 and quantitative trends/examples retain the full eligible cohort. Bound safe topic/exclusion metadata, observed edges, timeline buckets, qualitative examples, and excerpts with omission counts; no raw graph jobs or inferred-as-observed edges are copied. Without a saved search, copy aggregates only. With saved search context, the final job-clustering appendix includes the actual balanced groups and within-group hierarchy for the job filters, computed over the complete eligible cohort in a cancellable worker. Bound it to 128 original nodes with explicit collapsed subtrees, 8 safe topic labels per record, and job details drawn only from the existing at most 16 selected qualitative examples. Without saved search context, retain aggregate-only copying and mark the hierarchy unavailable. Copy sends nothing automatically or changes schedules. See the [Insights surface contract](.impeccable/surfaces/nities-components-opportunityinsights-vue-ab8e9354.md) for exact filter, evidence, copy-limit, and resilience rules.
- In **Applications**, move between Preparation, Refinement, Attachments, and Tracking in any order.
- Select CV and letter templates to create independent application copies. On opening an application, untouched copies refresh from changed sources after checking refinement history. Proposals, manual document edits and approvals protect each document; clearing its refinement history makes the restored copy eligible again on the next open.
- In Refinement, share privacy-filtered sources with ChatGPT through the connected Supabase workflow. Letter proposals update the working letter; CV suggestions appear in Current for review. Review the result, answer annotations, edit wording, and approve the CV and letter separately.
- CV and letter previews share **Previous** / **Current** controls. The CV preview stays visible, and manual editing starts from Current with its active suggestions. Saving an edit or approving the CV keeps that version as the application copy; Previous stays unchanged.
- In Attachments, order the CV, letter, and selected supporting documents, then preview and download the PDF package. Submit it through the institution's portal or email and update the application status yourself.

## Capabilities and Constraints

- The app is a static Vue 3 and TypeScript frontend built with Vite, using local tab navigation and a GitHub Pages-compatible base path. Local CV work does not require an application server.
- The optional Supabase workspace provides signed-in opportunity and application features. Signing in does not automatically upload a CV.
- CV and letter editing data uses browser-local storage. Supporting PDF, PNG, and JPEG files and archived packages use IndexedDB. Only explicitly saved attachment names and descriptions, plus their identifiers, are shared with the connected workspace; file contents remain local.
- Back up private local documents and supporting files before moving devices or clearing browser data. Cloud records cannot restore all of them.
- Explicit sharing uses privacy-filtered sources. Contact substitution, excluded content, and marked redactions help protect personal data, but unmarked prose can still identify the applicant. Do not promise anonymity.
- Content and configuration have separate JSON backup formats. Privacy-aware content export/import is the default; full private content transfer requires the explicit bypass setting.
- CVs support configurable sections, ordering, document layout, typography, and reusable variants. Motivation letters use application CV styling and retain revision history.
- SVG previews and vector PDF exports share rendering data. Selectable text, supported fonts, safe clickable links, pagination, and agreement between preview and download are functional requirements.
- The interface and document content support German and English. Desktop and mobile layouts exist; the owner has not named an exclusive device priority.
- Keep opportunity interest, document approval, and application status separate. Research refreshes and template changes must preserve application work unless the user chooses to replace it.
- Research interests, example letters, and AI suggestions do not establish applicant qualifications. Missing evidence and missing research scores must remain distinguishable from verified information.
- Letter templates use meta-search research interests by default; the owner can turn off that source and keep custom template interests. The application keeps an independent local copy and shares it through the existing privacy-filtered refinement workflow. New opportunity recommendations require at least 72 hours before a verified official deadline, with confirmed rolling vacancies also eligible.

## Brand Commitments

The product name is **CV Harness**, with the repository and published path `cv-harness`. Active UI, exports, package metadata and documentation use this name. Historical protocol artifacts and persistent storage identifiers retain compatibility names so saved files, sessions and existing calendar events keep working.

The initial product brief specified no voice, visual identity, or other aesthetic constraints.

## Evidence on Hand

- `README.md` documents existing capabilities, workflows, storage boundaries, and export behavior.
- `src/app/App.vue` and `src/features/applications/components/ApplicationWorkspace.vue` implement the main workspaces and application stages.
- `src/i18n/dict.ts` contains existing German/English interface terminology and privacy explanations.
- `docs/json-format.md` documents content/configuration backups and privacy-aware editing.
- `test/browser/job-workspace.html` and `test/fixtures/` contain synthetic development scenarios. Do not cite them as evidence of applicant outcomes.
- `public/fonts/` includes bundled font assets and license information. Preserve the licensing boundaries documented in the repository.

The initial product brief supplied no testimonials, acceptance-rate evidence, ATS certification, customer counts, or evidence for commercial positioning claims. Do not invent them.

## Product Principles

1. **Reuse accurate career material.** Keep source variants reusable and each application's documents independent.
2. **Let the owner choose what to share.** Keep personal data on the device until the owner shares it. Show what will leave the browser.
3. **Require review of AI changes.** Base proposals on source facts and keep approval separate for each document.
4. **Check final PDFs.** Match previews to exports, include the selected documents, and preserve local copies for recovery.
5. **Allow iteration.** Let the owner move between research, preparation, refinement, review, and tracking. Keep application status separate from document progress.

## Open Decisions

- Device priority and usage frequency beyond the confirmed personal workflow.
- Product-specific accessibility requirements and a formal conformance target. The initial product brief set neither, and this document makes no conformance claim.
- Any future expansion beyond the owner's research, PhD, and career applications.
