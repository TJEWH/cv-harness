import type { SupabaseClient } from '@supabase/supabase-js';
import { SEARCH_CRITERIA_KEYS } from '../searchTypes';
import type { SearchCloudSchedule, SearchCloudTemplate, SearchCriteria, SearchTemplate, SearchMetaSearchDocument } from '../searchTypes';
import { isSharedSearchTemplate, readSearchTemplate, searchTemplateContentKey } from './searchTemplateRepository';
import { SEARCH_DEADLINE_RULE, buildSearchSystemPrompt, buildSearchUserPrompt, buildRecurringSearchPrompt } from '../domain/searchPrompts';
import type { SearchPromptOptions } from '../domain/searchPrompts';
import { readAdaptiveSearchRunnerState } from '../domain/adaptiveSearchTask';
export { isSearchTemplateSaved } from '../domain/searchPrompts';
export type { SearchCloudTemplate } from '../searchTypes';

const LEGACY_PAYLOAD_MARKER = 'CV Harness meta-search context v1\n';
const SHARED_PAYLOAD_MARKER = 'CV Harness shared-search intent v2\n';
export const SEARCH_META_SEARCH_PAYLOAD_MAX_BYTES = 512 * 1024;
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
function matchesPayload(row: SearchCloudTemplate, name: string, criteria: SearchCriteria, schedule: SearchCloudSchedule) {
  return row.name === name && stable(row.criteria) === stable(criteria) && stable(row.schedule) === stable(schedule);
}
function criterion(value: string, label: string) {
  if ([...value].length > 12000) throw new Error(`The saved ${label} exceeds 12,000 characters. Shorten it before saving; your local draft is retained.`);
  return value;
}
export function searchTemplateCloudCriteria(input: SearchTemplate): SearchCriteria {
  const template = readSearchTemplate(input);
  return {
    opportunityTypes: criterion(template.opportunityDescription, 'opportunity and job sources'),
    topicsAndMethods: criterion(template.researchInterests, 'research interests and tasks'),
    locationsAndLanguages: criterion(template.locationPreferences, 'location and language preferences'),
    fundingAndConditions: criterion(template.fundingConditions, 'salary, funding and conditions'),
    fitAndExclusions: SHARED_PAYLOAD_MARKER + JSON.stringify({ version: 2, active: true }) + '\n'
      + 'Semicolons separate entries. Research directions are alternatives; a role may match one or several, without fulfilling them all. Preferred and avoided tasks affect ranking unless explicitly specified as hard exclusions. Interests do not establish qualifications.\n' + SEARCH_DEADLINE_RULE,
    sourcesAndQueries: 'Use the job-source descriptions in opportunityTypes. Prefer official vacancy listings, institutions/labs, graduate-school rules and linked application pages. Generate focused queries for alternative research directions; preserve explicit manual queries and exclusions and the installed immutable query-revision contract.',
    researchAndReporting: criterion(template.userPrompt, 'additional instructions'),
  };
}

export function searchTemplateCloudSchedule(input: SearchTemplate): SearchCloudSchedule {
  const template = readSearchTemplate(input);
  return { frequency: 'daily', intervalHours: 1, weekdays: [], time: template.dailyTime, timezone: template.timezone, runImmediately: true };
}
function asCloudTemplate(value: unknown, userId: string): SearchCloudTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved search response is invalid.');
  const row = value as SearchCloudTemplate;
  if (row.user_id !== userId || typeof row.id !== 'string' || typeof row.name !== 'string' || !Number.isInteger(row.revision) || row.revision < 1
    || !row.criteria || typeof row.criteria !== 'object' || !row.schedule || typeof row.schedule !== 'object'
    || SEARCH_CRITERIA_KEYS.some(key => row.criteria[key] !== undefined && typeof row.criteria[key] !== 'string')) throw new Error('The saved search does not match the signed-in owner.');
  return row;
}
export async function listCloudSearchTemplates(client: SupabaseClient, userId: string): Promise<SearchCloudTemplate[]> {
  const { data, error } = await client.from('opportunity_search_templates').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('The saved search list could not be read.');
  return data.map(item => asCloudTemplate(item, userId));
}
export function importCloudSearchTemplate(row: SearchCloudTemplate): SearchTemplate {
  if (row.meta_search?.version === 1) {
    const editor = row.meta_search.editor;
    const template = readSearchTemplate({ ...editor, name: row.name, dailyTime: row.schedule.time, timezone: row.schedule.timezone, cloud: undefined });
    const currentShape = isSharedSearchTemplate(editor) && row.meta_search.active === true && template.active === true;
    // A converted profile document needs a committed save so the complete prompts
    // and criteria match its new shared representation before schedule replacement.
    return { ...template, active: true, cloud: { id: row.id, revision: row.revision, contentKey: currentShape ? searchTemplateContentKey(template) : '' } };
  }
  let context: Record<string, unknown> | null = null;
  let sharedActive: boolean | undefined;
  if (row.criteria.fitAndExclusions?.startsWith(SHARED_PAYLOAD_MARKER)) {
    const marker = JSON.parse(row.criteria.fitAndExclusions.slice(SHARED_PAYLOAD_MARKER.length).split('\n')[0]!);
    if (marker.version !== 2 || typeof marker.active !== 'boolean') throw new Error('This saved shared-search intent is unsupported.');
    sharedActive = marker.active;
  }
  if (row.criteria.fitAndExclusions?.startsWith(LEGACY_PAYLOAD_MARKER)) {
    const parsed = JSON.parse(row.criteria.fitAndExclusions.slice(LEGACY_PAYLOAD_MARKER.length));
    if (parsed.version !== 1) throw new Error('This saved meta-search context version is unsupported.');
    context = parsed;
  }
  const common = { id: row.id, name: row.name, revision: row.revision, updatedAt: row.updated_at,
    locationPreferences: row.criteria.locationsAndLanguages || '', dailyTime: row.schedule.time, timezone: row.schedule.timezone };
  const template = context ? readSearchTemplate({ ...common, professionalContext: context.professionalContext ?? '',
    researchInterests: context.researchInterests ?? '', profiles: context.profiles ?? [], userPrompt: row.criteria.researchAndReporting || '' })
    : readSearchTemplate({ ...common, active: true,
      opportunityDescription: ['No professional profiles are enabled. Do not run this search or recommend opportunities.', 'This shared meta search is inactive. Do not run a search or recommend opportunities.'].includes(row.criteria.opportunityTypes) ? '' : row.criteria.opportunityTypes || '', researchInterests: row.criteria.topicsAndMethods || '', fundingConditions: row.criteria.fundingAndConditions || '',
      userPrompt: [row.criteria.researchAndReporting, row.criteria.sourcesAndQueries, sharedActive === undefined ? row.criteria.fitAndExclusions : row.criteria.fitAndExclusions.slice(SHARED_PAYLOAD_MARKER.length).split('\n').slice(1).join('\n')].filter(Boolean).join('\n\n'),
      legacySearchArchive: JSON.stringify({ criteria: row.criteria, schedule: row.schedule }) });
  return { ...template, active: true, cloud: { id: row.id, revision: row.revision, contentKey: '' } };
}

async function stableCloudId(userId: string, localId: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cv-search-template-v1:${userId}:${localId}`))).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** One atomic save returns the acknowledged row; no preflight/read-back chain. */
export async function saveSearchTemplate(client: SupabaseClient, userId: string, input: SearchTemplate, options: SearchPromptOptions = {}): Promise<SearchTemplate> {
  const template = readSearchTemplate({ ...input, active: true });
  const criteria = searchTemplateCloudCriteria(template); const schedule = searchTemplateCloudSchedule(template);
  const id = template.cloud?.id || await stableCloudId(userId, template.id);
  if (options.runner) readAdaptiveSearchRunnerState(options.runner, userId, id, options.projectId || options.runner.project_ref);
  const expectedRevision = template.cloud?.revision || 0;
  const bound = { ...template, cloud: { id, revision: Math.max(1, expectedRevision), contentKey: searchTemplateContentKey(template) } };
  const { cloud: _cloud, ...editor } = template;
  const metaSearch: SearchMetaSearchDocument = { version: 1, active: template.active, editor,
    systemPrompt: buildSearchSystemPrompt(bound, options), userPrompt: buildSearchUserPrompt(bound, options), recurringPrompt: buildRecurringSearchPrompt(bound, options) };
  if (new TextEncoder().encode(JSON.stringify({ criteria, schedule, metaSearch })).length > SEARCH_META_SEARCH_PAYLOAD_MAX_BYTES) throw new Error('The complete meta-search snapshot exceeds 512 KiB. Export its backup and shorten the search before saving; the current saved prompt is unchanged.');
  const { data, error } = await client.rpc('save_opportunity_meta_search', { p_id: id, p_expected_revision: expectedRevision,
    p_name: template.name, p_criteria: criteria, p_schedule: schedule, p_meta_search: metaSearch });
  if (error) throw error;
  const saved = asCloudTemplate(Array.isArray(data) ? data[0] : data, userId);
  if (saved.id !== id || saved.revision !== expectedRevision + 1 || !matchesPayload(saved, template.name, criteria, schedule)
    || stable(saved.meta_search) !== stable(metaSearch)) throw new Error('The server did not acknowledge this exact meta-search snapshot. Your draft is retained.');
  return { ...template, cloud: { id, revision: saved.revision, contentKey: searchTemplateContentKey(template) } };
}
