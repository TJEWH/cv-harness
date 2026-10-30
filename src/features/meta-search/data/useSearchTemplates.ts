import type { SearchTemplate } from '../searchTypes';

interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const SEARCH_TEMPLATE_TEXT_MAX_LENGTH = 12000;
export const SEARCH_TEMPLATES_UPDATED_EVENT = 'cv-search-templates-updated';
export const DEFAULT_SEARCH_USER_PROMPT = '';
export const DEFAULT_SEARCH_OPPORTUNITY_DESCRIPTION = 'Currently open funded PhDs and doctorates; Industrial PhDs; relevant applied research positions; official vacancy listings and institution or laboratory career pages; linked graduate-school and application requirements';
export const DEFAULT_SEARCH_RESEARCH_INTERESTS = 'Acoustic and physical sensing; acoustics; signal processing and audio; speech, voice and audio; machine listening; robot audition; sensor and multisensor fusion; robotics and human–robot interaction; embodied AI; embedded and edge AI; brain–computer interfaces; audio interfaces; vocal biomarkers; preferred tasks and methods: prototyping, machine learning, technical evaluation, real hardware, intelligent physical systems and interdisciplinary research';
export const DEFAULT_SEARCH_FUNDING_CONDITIONS = 'Solid funding; intended start around early 2027; verify salary or stipend, contract type, duration and eligibility; no additional salary floor or software-only exclusion unless explicitly requested';
export const DEFAULT_SEARCH_LOCATION_PREFERENCES = 'Prioritize Scandinavia, followed by Europe, especially Germany and the United Kingdom. Also consider Japan, Australia and New Zealand, and interesting cooler locations in Southeast Asia or emerging countries. The working language should be English or German.';
const LEGACY_DEFAULT_STRATEGY = 'Find currently open, funded PhDs and doctorates, Industrial PhDs and relevant applied research positions with solid funding and a start around early 2027. Verify funding, salary, contract, duration, eligibility and requirements from official vacancy listings and linked graduate-school rules. Research evidenced supervision and contact roles, required/optional/conditional application documents, research content and methods, teaching load, deadlines and sources. Prioritize strong technical fit, practical research, hands-on prototyping and a useful academic or industrial R&D career direction. Report only new or materially changed strong matches; remain quiet after a successful run with no such matches. Do not add a salary floor, minimum fit score or software-only exclusion that I have not requested.';

function defaultTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Tirane'; }
  catch { return 'Europe/Tirane'; }
}
export function createSearchTemplate(name = 'Meta search', timezone = defaultTimezone()): SearchTemplate {
  return { id: crypto.randomUUID(), name, revision: 1, updatedAt: new Date().toISOString(), active: true,
    opportunityDescription: DEFAULT_SEARCH_OPPORTUNITY_DESCRIPTION, researchInterests: DEFAULT_SEARCH_RESEARCH_INTERESTS,
    fundingConditions: DEFAULT_SEARCH_FUNDING_CONDITIONS, locationPreferences: DEFAULT_SEARCH_LOCATION_PREFERENCES,
    userPrompt: DEFAULT_SEARCH_USER_PROMPT, dailyTime: '09:00', timezone };
}
export const DEFAULT_SEARCH_TEMPLATES: SearchTemplate[] = [{
  ...createSearchTemplate('Funded research opportunities', 'Europe/Tirane'),
  id: 'funded-european-phds', updatedAt: '2026-10-29T00:00:00.000Z',
}];

function textField(value: Record<string, unknown>, key: string, maximum = SEARCH_TEMPLATE_TEXT_MAX_LENGTH) {
  const text = value[key];
  if (typeof text !== 'string' || text.length > maximum || text.includes('\0')) throw new Error(`Invalid search ${key}; use text of at most ${maximum} characters.`);
  return text;
}
function joinText(values: string[], separator = ';\n') { return [...new Set(values.map(value => value.trim()).filter(Boolean))].join(separator); }
export function isSharedSearchTemplate(value: unknown): value is SearchTemplate {
  return isObject(value) && !('profiles' in value) && !('professionalContext' in value) && typeof value.active === 'boolean'
    && ['opportunityDescription', 'researchInterests', 'fundingConditions'].every(key => typeof value[key] === 'string');
}

/** Retired profile data is read once into shared intent; removed/private context stays recoverable, never executable. */
function normalizeSharedFields(value: Record<string, unknown>): Record<string, unknown> {
  if (!('profiles' in value) && !('professionalContext' in value)) return value;
  if (!Array.isArray(value.profiles) || value.profiles.length > 30) throw new Error('Invalid legacy meta-search profiles.');
  const profiles = value.profiles.map(profile => {
    if (!isObject(profile) || typeof profile.enabled !== 'boolean') throw new Error('Invalid legacy professional profile.');
    const id = textField(profile, 'id', 200); const name = textField(profile, 'name', 200);
    if (!id.trim() || !name.trim()) throw new Error('A legacy professional profile needs a name and identifier.');
    return { id, name, enabled: profile.enabled, professionalContext: textField(profile, 'professionalContext'),
      researchInterests: textField(profile, 'researchInterests'), userPrompt: textField(profile, 'userPrompt') };
  });
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Legacy professional profile identifiers must be unique.');
  const enabled = profiles.filter(profile => profile.enabled);
  textField(value, 'professionalContext');
  const strategy = textField(value, 'userPrompt');
  const wasDefault = strategy === LEGACY_DEFAULT_STRATEGY;
  const { cloud: _cloud, ...archived } = value;
  return { ...value, active: typeof value.active === 'boolean' ? value.active : enabled.length > 0,
    opportunityDescription: value.opportunityDescription ?? (wasDefault ? DEFAULT_SEARCH_OPPORTUNITY_DESCRIPTION : strategy),
    researchInterests: joinText([textField(value, 'researchInterests'), ...enabled.map(profile => profile.researchInterests)]),
    fundingConditions: value.fundingConditions ?? (wasDefault ? DEFAULT_SEARCH_FUNDING_CONDITIONS : ''),
    userPrompt: joinText(enabled.map(profile => `${profile.name}: ${profile.userPrompt}`).filter((_, index) => enabled[index]!.userPrompt.trim()), '\n\n'),
    legacySearchArchive: value.legacySearchArchive ?? JSON.stringify(archived),
  };
}
export function readSearchTemplate(input: unknown): SearchTemplate {
  if (!isObject(input)) throw new Error('Invalid meta-search template.');
  const value = normalizeSharedFields(input);
  if (typeof value.active !== 'boolean' || !Number.isInteger(value.revision) || Number(value.revision) < 1) throw new Error('Invalid meta-search template.');
  const id = textField(value, 'id', 200); const name = textField(value, 'name', 200);
  if (!id.trim() || !name.trim()) throw new Error('A meta search needs a name and identifier.');
  const dailyTime = textField(value, 'dailyTime', 5); const timezone = textField(value, 'timezone', 100);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error('Choose a valid daily time.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('Choose a valid IANA timezone.'); }
  const updatedAt = textField(value, 'updatedAt', 100);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid meta-search update date.');
  let cloud: SearchTemplate['cloud'];
  if (value.cloud !== undefined) {
    if (!isObject(value.cloud) || typeof value.cloud.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.cloud.id)
      || !Number.isInteger(value.cloud.revision) || Number(value.cloud.revision) < 1 || typeof value.cloud.contentKey !== 'string') throw new Error('Invalid saved search reference.');
    cloud = { id: value.cloud.id, revision: Number(value.cloud.revision), contentKey: value.cloud.contentKey };
  }
  return { id, name: name.trim(), revision: Number(value.revision), updatedAt, active: value.active,
    opportunityDescription: textField(value, 'opportunityDescription'), researchInterests: textField(value, 'researchInterests'),
    fundingConditions: textField(value, 'fundingConditions'), locationPreferences: value.locationPreferences === undefined ? '' : textField(value, 'locationPreferences'),
    userPrompt: textField(value, 'userPrompt'), dailyTime, timezone, ...(cloud ? { cloud } : {}),
    ...(value.legacySearchArchive !== undefined ? { legacySearchArchive: textField(value, 'legacySearchArchive', 2000000) } : {}) };
}

export function searchTemplateContentKey(input: SearchTemplate): string {
  const { id: _id, revision: _revision, updatedAt: _updatedAt, cloud: _cloud, ...content } = readSearchTemplate(input);
  return JSON.stringify(content);
}
function notifyChanged() { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(SEARCH_TEMPLATES_UPDATED_EVENT)); }

/** Older libraries become shared search alternatives, not a hidden collection of active profiles. */
export function mergeMetaSearches(templates: SearchTemplate[]): SearchTemplate {
  if (!templates.length) return clone(DEFAULT_SEARCH_TEMPLATES[0]!);
  const normalized = templates.map(readSearchTemplate);
  const [first, ...others] = normalized;
  const primary = clone(first!);
  if (!others.length) return primary;
  const active = normalized.filter(template => template.active);
  if (active.length) for (const field of ['opportunityDescription', 'researchInterests', 'fundingConditions', 'locationPreferences', 'userPrompt'] as const) {
    primary[field] = joinText(active.map(template => template[field]));
  }
  primary.active = active.length > 0;
  primary.legacySearchArchive = JSON.stringify(normalized.map(({ cloud: _cloud, ...template }) => template));
  return readSearchTemplate(primary);
}

/** Synchronous commit-driven storage; failures leave the caller's editor intact. */
export function createSearchTemplateRepository(storage: StorageAdapter, userId: string) {
  const key = `cv.search-templates.v1:${encodeURIComponent(userId || 'local')}`;
  function listTemplates(): SearchTemplate[] {
    const raw = storage.getItem(key);
    if (!raw) return clone(DEFAULT_SEARCH_TEMPLATES);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Stored meta searches could not be read. Restore their backup before editing.');
    const templates = parsed.map(readSearchTemplate);
    if (new Set(templates.map(item => item.id)).size !== templates.length) throw new Error('Stored meta searches contain duplicate identifiers.');
    return [mergeMetaSearches(templates)];
  }
  function write(templates: SearchTemplate[]) {
    const previous = storage.getItem(key);
    if (previous) {
      const parsed: unknown = JSON.parse(previous);
      const oldShape = Array.isArray(parsed) && (parsed.length > 1 || parsed.some(value => !isSharedSearchTemplate(value)));
      if (oldShape && !storage.getItem(`${key}:legacy-library`)) storage.setItem(`${key}:legacy-library`, previous);
    }
    storage.setItem(key, JSON.stringify(templates)); notifyChanged();
  }
  return {
    listTemplates,
    saveTemplate(input: SearchTemplate, baseline?: SearchTemplate | null) {
      let template = readSearchTemplate({ ...input, active: true });
      const templates = listTemplates();
      const previous = templates.find(item => item.id === template.id);
      if (baseline) {
        const original = readSearchTemplate(baseline);
        if (original.id !== template.id || !previous) throw new Error('This meta search is no longer saved. Your edits remain in the editor.');
        const merged: Record<string, unknown> = { ...previous };
        for (const field of Object.keys({ ...original, ...template }) as (keyof SearchTemplate)[]) {
          if (['id', 'revision', 'updatedAt'].includes(field)) continue;
          const before = JSON.stringify(original[field]); const incoming = JSON.stringify(template[field]); const current = JSON.stringify(previous[field]);
          if (before === incoming) continue;
          if (current !== before && current !== incoming) throw new Error('This meta search changed in another tab. Your edits remain here; copy them before reloading.');
          merged[field] = template[field];
        }
        template = readSearchTemplate(merged);
      }
      if (previous && JSON.stringify({ ...template, revision: previous.revision, updatedAt: previous.updatedAt }) === JSON.stringify(previous)) return clone(previous);
      const saved = { ...template, revision: previous ? previous.revision + 1 : 1, updatedAt: new Date().toISOString() };
      write([saved]);
      return clone(saved);
    },
    deleteTemplate(id: string, expectedRevision?: number) {
      const templates = listTemplates(); const previous = templates.find(item => item.id === id);
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision) throw new Error('This meta search changed in another tab. Reload before removing it.');
      if (previous) write(clone(DEFAULT_SEARCH_TEMPLATES));
    },
    exportTemplates() { return JSON.stringify({ format: 'cv-search-templates', version: 1, templates: listTemplates() }, null, 2); },
    importTemplates(json: string) {
      const data: unknown = JSON.parse(json);
      if (!isObject(data) || data.format !== 'cv-search-templates' || data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 100) throw new Error('Invalid meta-search backup.');
      if (!data.templates.length) throw new Error('The backup must contain a meta search.');
      const current = listTemplates()[0]!;
      const imported = mergeMetaSearches(data.templates.map(readSearchTemplate));
      const saved = { ...imported, id: current.id, revision: current.revision + 1, cloud: current.cloud, updatedAt: new Date().toISOString() };
      write([saved]);
      return [clone(saved)];
    },
  };
}
