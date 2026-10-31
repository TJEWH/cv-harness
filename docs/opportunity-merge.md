# Canonical opportunity storage and intake

The current contract is [`supabase/contracts/opportunity.schema.json`](../supabase/contracts/opportunity.schema.json). Catalogue records use `metadata_schema_version: 6`, and intake uses `opportunity-search-v1-canonical-6`. Storage and intake enforce the closed current schema. Obsolete aliases and historical catalogue conversion are unsupported.

The JSON schema generates [`opportunityTypes.ts`](../src/features/opportunities/opportunityTypes.ts). After editing the contract, regenerate and check the types:

```sh
node scripts/generateOpportunityTypes.mjs
node scripts/generateOpportunityTypes.mjs --check
```

Current PostgreSQL definitions live in the opportunity and search modules listed in [`supabase/schemas/manifest.json`](../supabase/schemas/manifest.json). The atomic installer includes these definitions directly; it does not upgrade through earlier canonical versions.

## Evidence and identity

Opportunity identity uses stable keys and verified official vacancy URLs. Intake keeps separate source observations and effective evidence. Rejected incoming evidence cannot affect later decisions. Corrections require the matching previous value and evidence; research refreshes preserve owner feedback and application work.

Per-run merge audit and rollback are current research controls. They are distinct from retired catalogue-format migrations. A rollback must verify its run and reject subsequent conflicting edits. Current historical query revisions and verified receipts remain immutable evidence.

## Application research

An application captures an independent research snapshot. Later catalogue edits do not replace that frozen research automatically. Context refresh remains an explicit action. Document refinements and checklist completion use the application's own snapshot and stable identity.

## Verification

`npm run test:database` installs the complete current schema with synthetic fixtures. Current contract assertions cover strict payloads and unsafe URLs, stable identity, evidence isolation, correction checks, owner permissions and application snapshots. Earlier schema conversion and migration rollback fixtures have been removed; their historical implementations remain in Git.
