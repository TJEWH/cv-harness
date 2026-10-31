import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ADAPTIVE_RELEASE_ID = 'adaptive-search-inclusion-v1';
export const ADAPTIVE_RELEASE_MANIFEST = 'supabase/adaptive-search-release.json';
export const ADAPTIVE_RELEASE_MIGRATIONS = [
  'opportunity_feedback_signals.sql', 'opportunity_feedback_sharing.sql', 'opportunity_feedback_projection.sql',
  'opportunity_feedback_snapshots.sql', 'opportunity_search_plans.sql', 'opportunity_search_attribution.sql',
  'opportunity_search_prediction_baselines.sql', 'opportunity_search_quality_metrics.sql', 'opportunity_search_preferences.sql',
  'opportunity_search_adaptation_sources.sql', 'opportunity_search_adaptive_startup.sql', 'opportunity_search_adaptive_batches.sql',
  'opportunity_search_adaptive_completion.sql', 'opportunity_search_adaptive_setup.sql',
  'opportunity_search_feedback_preview.sql', 'opportunity_search_dashboard.sql',
  'opportunity_search_adaptive_release_fixes.sql', 'opportunity_search_adaptive_rollback.sql',
  'opportunity_search_breadth.sql',
  'opportunity_feedback_inclusion.sql',
] as const;
export const ADAPTIVE_RELEASE_PREREQUISITES = [
  'supabase/schema.sql', 'test/opportunityFeedback/fixtures/legacy-search-bootstrap.sql',
  'supabase/opportunity_merge_v4.sql', 'supabase/opportunity_canonical_v5.sql',
  'supabase/opportunity_meta_search_autosave.sql',
] as const;
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const artifact = (path: string) => ({ path, sha256: sha256(read(path)) });

/** Filesystem-only release review. This script cannot connect to a database,
 * apply SQL, change a task, enable a feature, or read a production capture. */
export function buildAdaptiveSearchReleaseManifest() {
  const bootstrap = JSON.parse(read('test/opportunityFeedback/fixtures/legacy-search-bootstrap.json'));
  if (sha256(read(ADAPTIVE_RELEASE_PREREQUISITES[1])) !== bootstrap.sha256) throw new Error('Reviewed local bootstrap provenance differs.');
  const preview = read('supabase/opportunity_search_feedback_preview.sql');
  const prerequisites = [...preview.slice(0, preview.indexOf('-- During account deletion')).matchAll(/\('([^']+)','([0-9a-f]{64})'\)/gu)]
    .map(match => ({ signature: match[1]!, sha256: match[2]!, required_before: 'supabase/opportunity_search_feedback_preview.sql' }));
  const fix = read('supabase/opportunity_search_adaptive_release_fixes.sql');
  const correctionHash = /actual is distinct from '([0-9a-f]{64})'/u.exec(fix)?.[1];
  if (!correctionHash || prerequisites.length !== 7) throw new Error('Reviewed PostgreSQL prerequisite fingerprints are incomplete.');
  prerequisites.push({ signature: 'private.validate_adaptive_proposals(jsonb,jsonb)', sha256: correctionHash,
    required_before: 'supabase/opportunity_search_adaptive_release_fixes.sql' });
  return {
    release_id: ADAPTIVE_RELEASE_ID,
    manifest_version: 1,
    reviewed_package_commit: 'f475d364fb16508b4ef8e1568b9d72fd80e3ddf2',
    preceding_implementation_commit: 'fbbe4c2a28a9a776e6040b92a9af2c28876efb21',
    versions: { canonical_schema: 6, canonical_protocol: 'opportunity-search-v1-canonical-6', legacy_bootstrap_contract: 1,
      meta_search: 1, adaptive_contract: 1, capability: 'adaptive-batch-v1', metric: 'opportunity-interest-v2',
      selection_policy: 'opportunity-feedback-selection-v2', query_policy: 'adaptive-query-v3', summary_inclusion: 'included-unless-excluded-v1', setup_contract: 1, rollback_contract: 1 },
    defaults: { adaptive_release_enabled: false, owner_runner_authorized: false, feedback_excluded: false,
      adaptation_enabled: false, adaptation_paused: false, successful_source_reuse_enabled: false, search_breadth_percent: 20, scheduler_operations: false },
    execution_contract: { maximum_queries:30, maximum_sources:64, maximum_checks:128, maximum_backlog:64,
      maximum_report_bytes:524288, maximum_bundle_bytes:262144, maximum_feedback_bytes:65536, minimum_deadline_hours:72,
      maximum_batch_opportunities:10, maximum_batch_bytes:524288, maximum_opportunity_bytes:262144, maximum_run_batches:32 },
    local_prerequisites_only: ADAPTIVE_RELEASE_PREREQUISITES.map((path, index) => ({ ...artifact(path),
      stage: index === 0 ? 'fresh_schema' : index === 1 ? 'reviewed_local_protocol_fixture' : index === 4 ? 'autosave_prerequisite' : 'canonical_conversion_prerequisite',
      replay_on_existing_workspace: false })),
    bootstrap_provenance: bootstrap,
    existing_workspace_upgrade: ADAPTIVE_RELEASE_MIGRATIONS.map((name, index) => ({ order: index + 1, ...artifact(`supabase/${name}`),
      migration_only: true, scheduler_operations: false })),
    current_contract_upgrades: ['opportunity_description.sql', 'application_removal_review.sql', 'opportunity_evaluation.sql', 'opportunity_feedback_defaults.sql', 'opportunity_search_adaptive_payload_contract.sql', 'opportunity_search_schedule_intervals.sql', 'opportunity_interest_v2.sql']
      .map(name => ({ ...artifact(`supabase/${name}`), migration_only: true, scheduler_operations: false })),
    installed_definition_prerequisites: { encoding: 'sha256-utf8-pg_get_functiondef-pg17-v1', tested_postgres_major: 17, functions: prerequisites },
    runner_artifacts: ['src/features/meta-search/domain/adaptiveSearchProtocol.ts','src/features/meta-search/domain/adaptiveSearchTask.ts',
      'src/features/meta-search/domain/adaptiveSearchStartup.ts','src/features/meta-search/domain/searchSchedule.ts','src/features/meta-search/domain/searchPrompts.ts','src/features/meta-search/searchTypes.ts','src/features/meta-search/data/useSearchTemplates.ts','src/features/opportunities/domain/opportunityResultSchema.ts','supabase/opportunity_schema_v6.json',
      'src/features/opportunities/domain/opportunityFeedback.ts','src/features/opportunities/domain/opportunityFeedbackPrivacy.ts','src/features/opportunities/domain/opportunityTopics.ts','src/features/meta-search/domain/adaptiveFeedbackSnapshots.ts',
      'src/features/meta-search/domain/adaptiveSearchPlans.ts','src/features/meta-search/domain/adaptiveSearchPlanner.ts','src/features/meta-search/domain/adaptiveSearchSources.ts',
      'src/features/meta-search/domain/adaptiveSearchQuality.ts','src/features/meta-search/composables/adaptiveSearchDashboard.ts','src/features/meta-search/data/searchTemplateCloud.ts',
      'src/documents/letter/searchLetterContext.ts','src/features/meta-search/components/AdaptiveSearchDashboard.vue','src/features/meta-search/components/AdaptiveSearchPolicyHint.vue','src/features/meta-search/components/SearchTemplates.vue',
      'src/app/components/JobWorkspace.vue','src/features/opportunities/components/OpportunityFeedbackControls.vue','src/features/opportunities/components/OpportunityDispositionControls.vue',
      'src/features/opportunities/domain/opportunityDisposition.ts',
      'src/features/opportunities/domain/opportunityEvaluation.ts','src/shared/editing/useApplicationNotesAutosave.ts'].map(artifact),
    release_gate: { isolated_database_suite: 'test/opportunityFeedback/release.test.ts',
      container: 'cv-adaptive-feedback-test', database: 'adaptive_feedback_test', network: 'none',
      one_batch_calls: 3, batches_calls_formula: '2 + B', production_deployed: false, scheduled_smoke_tested: false },
  };
}
export function checkAdaptiveSearchReleaseManifest(): void {
  const expected = JSON.stringify(buildAdaptiveSearchReleaseManifest(), null, 2) + '\n';
  if (read(ADAPTIVE_RELEASE_MANIFEST) !== expected) throw new Error('Adaptive release manifest differs. Review changed sources, then regenerate with --write.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && !['--check', '--write'].includes(args[0]!)) throw new Error('Use --check or --write. No database operation is available.');
  if (args[0] === '--write') {
    writeFileSync(resolve(root, ADAPTIVE_RELEASE_MANIFEST), JSON.stringify(buildAdaptiveSearchReleaseManifest(), null, 2) + '\n');
    process.stdout.write('Wrote reviewed-source manifest; review its diff before release. No database or task operation occurred.\n');
  } else {
    checkAdaptiveSearchReleaseManifest();
    process.stdout.write('Adaptive release source hashes and prerequisite fingerprints match.\n');
  }
}
