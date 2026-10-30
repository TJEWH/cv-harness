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
- In **Opportunities**, review research and requirements, record interest, and create applications. The **Meta research** sidebar tab edits one shared profile with job types/sources, alternative research interests and tasks, funding conditions and regional priorities. Committed edits autosave search intent and the full English prompts to Supabase. **Copy replace prompt** prepares one read of the saved definition for ChatGPT to replace the existing meta-search task. Copying itself does not change a schedule; scheduled executions retain the existing research protocol.
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

The owner chose **CV Harness** as the product name. Existing UI, repository metadata, and documentation still use the legacy name **CV Builder**. This document records the chosen name; it does not rename those references.

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
