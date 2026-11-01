import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DATABASE_MODULE_MANIFEST, DATABASE_SCHEMA_PATH, databaseSchemaFiles, checkDatabaseSchema } from './databaseSchema';
import { ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION } from '../src/features/meta-search/domain/adaptiveFeedbackSnapshots';

export const ADAPTIVE_RELEASE_ID = 'adaptive-search-inclusion-v1';
export const ADAPTIVE_RELEASE_MANIFEST = 'supabase/releases/current.json';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const artifact = (path: string) => ({ path, sha256: createHash('sha256').update(read(path), 'utf8').digest('hex') });

/** Fingerprints current source only. No database connection or deployment occurs. */
export function buildAdaptiveSearchReleaseManifest() {
  checkDatabaseSchema();
  return {
    release_id: ADAPTIVE_RELEASE_ID,
    manifest_version: 2,
    schema_source: 'current-state',
    postgres_major: 17,
    database: {
      installer: artifact(DATABASE_SCHEMA_PATH),
      module_manifest: artifact(DATABASE_MODULE_MANIFEST),
      modules: databaseSchemaFiles().map(artifact),
      contract: artifact('supabase/contracts/opportunity.schema.json'),
    },
    versions: { canonical_schema: 6, canonical_protocol: 'opportunity-search-v1-canonical-6',
      meta_search: 1, adaptive_contract: 1, capability: 'adaptive-batch-v1', metric: 'opportunity-interest-v2',
      selection_policy: ADAPTIVE_FEEDBACK_SELECTION_POLICY_VERSION, query_policy: 'adaptive-query-v3', summary_inclusion: 'included-unless-excluded-v1', setup_contract: 1, rollback_contract: 1 },
    defaults: { adaptive_release_enabled: false, owner_runner_authorized: false, feedback_excluded: false,
      adaptation_enabled: false, adaptation_paused: false, successful_source_reuse_enabled: false, search_breadth_percent: 20, scheduler_operations: false },
    execution_contract: { maximum_queries:30, maximum_sources:64, maximum_checks:128, maximum_backlog:64,
      maximum_report_bytes:524288, maximum_bundle_bytes:262144, maximum_feedback_bytes:65536, minimum_deadline_hours:72,
      maximum_batch_opportunities:10, maximum_batch_bytes:524288, maximum_opportunity_bytes:262144, maximum_run_batches:32 },
    runner_artifacts: ['src/features/meta-search/domain/adaptiveSearchProtocol.ts','src/features/meta-search/domain/adaptiveSearchTransport.ts',
      'src/features/meta-search/domain/adaptiveSearchCheckpoint.ts','src/features/meta-search/domain/adaptiveSearchDiagnostics.ts','scripts/lib/adaptiveSearchCheckpointFile.ts','src/features/meta-search/domain/adaptiveSearchTask.ts',
      'src/features/meta-search/domain/adaptiveSearchStartup.ts','src/features/meta-search/domain/searchSchedule.ts','src/features/meta-search/domain/searchPrompts.ts','src/features/meta-search/searchTypes.ts','src/features/meta-search/data/searchTemplateRepository.ts','src/features/opportunities/domain/opportunityResultSchema.ts','supabase/contracts/opportunity.schema.json',
      'src/features/opportunities/domain/opportunityFeedback.ts','src/features/opportunities/domain/opportunityFeedbackPrivacy.ts','src/features/opportunities/domain/opportunityTopics.ts','src/features/meta-search/domain/adaptiveFeedbackSnapshots.ts',
      'src/features/meta-search/domain/adaptiveSearchPlans.ts','src/features/meta-search/domain/adaptiveSearchPlanner.ts','src/features/meta-search/domain/adaptiveSearchSources.ts',
      'src/features/meta-search/domain/adaptiveSearchQuality.ts','src/features/meta-search/composables/adaptiveSearchDashboard.ts','src/features/meta-search/data/searchTemplateCloud.ts',
      'src/documents/letter/searchLetterContext.ts','src/features/meta-search/components/AdaptiveSearchDashboard.vue','src/features/meta-search/components/AdaptiveSearchPolicyHint.vue','src/features/meta-search/components/MetaSearchEditor.vue',
      'src/app/components/CloudWorkspace.vue','src/features/opportunities/components/OpportunityFeedbackControls.vue','src/features/opportunities/components/OpportunityDispositionControls.vue',
      'src/features/opportunities/domain/opportunityDisposition.ts',
      'src/features/opportunities/domain/opportunityEvaluation.ts','src/shared/editing/useApplicationNotesAutosave.ts'].map(artifact),
  };
}

export function checkAdaptiveSearchReleaseManifest(): void {
  const expected = JSON.stringify(buildAdaptiveSearchReleaseManifest(), null, 2) + '\n';
  if (read(ADAPTIVE_RELEASE_MANIFEST) !== expected) throw new Error('Current database release manifest differs. Review sources, then regenerate with --write.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && !['--check', '--write'].includes(args[0]!)) throw new Error('Use --check or --write. No database operation is available.');
  if (args[0] === '--write') {
    writeFileSync(resolve(root, ADAPTIVE_RELEASE_MANIFEST), JSON.stringify(buildAdaptiveSearchReleaseManifest(), null, 2) + '\n');
    process.stdout.write('Wrote current schema and runner source fingerprints.\n');
  } else {
    checkAdaptiveSearchReleaseManifest();
    process.stdout.write('Current schema, contract and runner fingerprints match.\n');
  }
}
