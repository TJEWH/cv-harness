# Opportunity feedback

Current feedback combines the owner's interest choice, application progress, personal evaluation, explicit reasons and per-opportunity exclusion. It never replaces canonical research assessments.

## Interest and evaluation

`opportunity-interest-v2` derives score and origin in this order: confirmed submission 9.5; existing application 9; Very high 9 / High 8 / Medium 6 / Low 2; otherwise unassessed. Removing an application reveals the saved opportunity choice again. Current scoring ignores the retired numeric override; immutable historical packets retain their original evidence.

The complete personal evaluation lives in `opportunity_reviews.comment`, with a server-maintained `evaluation_revision`. It permits 12,000 Unicode codepoints and saves through the current comment RPC. There is no second summary field, summary approval API or search-level sharing setting.

The per-opportunity exclusion controls text and structured feedback together. Technical outcomes and the manual Past marker remain separate from interest, official deadlines and application status. Technical note text stays private.

## Privacy and evidence

Search feedback uses at most the first 600 Unicode codepoints of an eligible evaluation, with exact source hashes, revision, source length and truncation metadata. Safeguards inspect the complete source before producing an excerpt. Contact information, private application notes, CV content and attachment files never belong in feedback packets. Editing or excluding a source cannot revive cached private text.

Prediction proofs require matching owner/opportunity identities and verified historical receipt evidence. A prediction must predate the meaningful owner outcome; missing or unverifiable history leaves the gap unassessed. Current catalogue scores cannot rebase historical predictions. Institution cohorts are diagnostics, not qualifications or automatic preferences.

Adaptation, pause, source reuse, runner authorization and release enablement remain independent. Pausing adaptation does not withhold otherwise included raw feedback. A pending suggestion does not execute a preference, source or query change.

## Verification

Run the current database contracts against the isolated fixture:

```sh
npm run test:database
npm test
npm run build
```

The database harness checks its container label, disabled network, absent host bind mounts/ports, fixed database and exclusive lock before resetting synthetic schemas. It installs `supabase/schema.sql` directly. Current tests exercise owner isolation, anonymous access, full-source redaction, exact excerpts, interest/application precedence, current dashboard actions and scheduling. Retired approval, old-column and migration-preservation tests are not installation prerequisites.
