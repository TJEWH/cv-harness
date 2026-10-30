import { safeEmailUrl, safeLinkUrl, safeWebUrl } from '../../../shared/lib/safeUrl';
import { livingStandardNode } from './livingStandard';
import { isOpportunityInternalFact, isOpportunityInternalField } from './opportunityPresentation';
import { buildCanonicalOpportunityGroups } from './canonicalOpportunityContext';

export interface OpportunityContextNode {
  id: string;
  label: string | null;
  text?: string;
  href?: string;
  children?: OpportunityContextNode[];
  missing?: boolean;
  kind?: 'summary' | 'main-link' | 'fit' | 'living-standard' | 'person' | 'requirement' | 'prose';
  score?: number;
  checklistKey?: string;
  requirementStatus?: 'required' | 'optional' | 'conditional' | 'beneficial' | 'preferred' | 'recommended' | 'desired' | 'unspecified';
  requirementStatusFields?: string[];
  requirementStage?: string;
  evidence?: { text: string; href: string }[];
}

export type OpportunityContextGroupId = 'overview' | 'links' | 'advisor' | 'salary' | 'requirements' | 'documents' | 'metadata';
export interface OpportunityContextGroup {
  id: OpportunityContextGroupId;
  label: string;
  items: OpportunityContextNode[];
}

const GROUPS: [OpportunityContextGroupId, string, string][] = [
  ['overview', 'Research overview & fit', 'Forschungsüberblick & Passung'],
  ['requirements', 'Requirements', 'Anforderungen'],
  ['documents', 'Application documents', 'Bewerbungsunterlagen'],
  ['salary', 'Salary & funding', 'Gehalt & Finanzierung'],
  ['advisor', 'Advisor & lab context', 'Betreuung & Forschungsgruppe'],
  ['links', 'Links & contacts', 'Links & Kontakte'],
  ['metadata', 'Metadata', 'Metadaten'],
];

const FIELD_GROUPS: Record<OpportunityContextGroupId, string[]> = {
  links: ['official_url', 'application_url', 'source_url', 'sources', 'links', 'contacts', 'contact', 'contact_email', 'email', 'website'],
  overview: ['research_summary', 'project_summary', 'project_description', 'personal_fit', 'research_fit',
    'research_career_potential', 'rd_career_potential', 'hardware_software_profile', 'hardware_software_balance', 'cv_track'],
  advisor: ['supervisor_research_focus', 'supervisor_top_papers', 'supervisors', 'supervisor', 'supervisor_reputation',
    'research_context', 'research_focus',
    'lab', 'lab_context', 'lab_research', 'research_group', 'unit'],
  salary: ['salary', 'salary_text', 'funding', 'compensation', 'stipend', 'scholarship', 'benefits',
    'duration_months', 'duration_details', 'duration', 'duration_years', 'contract_duration', 'contract_length', 'start_date'],
  requirements: ['requirements', 'eligibility', 'qualifications', 'required_skills', 'desired_skills', 'language_requirements'],
  documents: ['required_documents', 'application_documents', 'documents', 'submission_documents', 'application_process'],
  metadata: ['topics', 'keywords', 'research_topics', 'research_areas', 'research_track'],
};

const LABELS: Record<string, [string, string]> = {
  official_url: ['Official listing', 'Offizielle Ausschreibung'], application_url: ['Application portal', 'Bewerbungsportal'],
  source_url: ['Source', 'Quelle'], sources: ['Sources', 'Quellen'], links: ['Links', 'Links'],
  contact: ['Contacts', 'Kontakte'], contacts: ['Contacts', 'Kontakte'], contact_email: ['Contact email', 'Kontakt-E-Mail'],
  email: ['Email', 'E-Mail'], website: ['Website', 'Website'], url: ['Link', 'Link'], href: ['Link', 'Link'],
  supervisor_research_focus: ['Advisor research focus', 'Forschungsschwerpunkte der Betreuung'],
  supervisor_top_papers: ['Representative papers', 'Repräsentative Publikationen'],
  supervisor: ['Advisors', 'Betreuung'], supervisors: ['Advisors', 'Betreuung'],
  supervisor_reputation: ['Advisor background', 'Hintergrund der Betreuung'],
  research_career_potential: ['Academic career potential', 'Akademische Karrierechancen'],
  rd_career_potential: ['R&D career potential', 'Karrierechancen in Forschung & Entwicklung'],
  hardware_software_balance: ['Hardware / software balance', 'Hardware- / Software-Anteil'],
  hardware_software_profile: ['Hardware / software profile', 'Hardware- / Software-Profil'],
  research_fit: ['Research fit', 'Forschungspassung'],
  personal_fit: ['Personal fit', 'Persönliche Passung'],
  research_context: ['Research context', 'Forschungskontext'], research_track: ['Research track', 'Forschungsschwerpunkt'],
  cv_track: ['CV track', 'CV-Schwerpunkt'], research_summary: ['Research summary', 'Forschungsüberblick'],
  project_description: ['Project description', 'Projektbeschreibung'], project_summary: ['Project summary', 'Projektüberblick'],
  research_focus: ['Research focus', 'Forschungsschwerpunkt'], focus_summary: ['Focus summary', 'Überblick der Schwerpunkte'],
  focus: ['Focus', 'Schwerpunkt'], summary: ['Summary', 'Überblick'], description: ['Description', 'Beschreibung'],
  keywords: ['Keywords', 'Schlagwörter'], topics: ['Topics', 'Themen'], research_topics: ['Research topics', 'Forschungsthemen'],
  research_areas: ['Research areas', 'Forschungsgebiete'], evidence: ['Evidence', 'Belege'], evidence_urls: ['Evidence links', 'Beleglinks'],
  limitations: ['Limitations', 'Einschränkungen'], papers: ['Papers', 'Publikationen'], publications: ['Publications', 'Publikationen'],
  title: ['Title', 'Titel'], year: ['Year', 'Jahr'], venue: ['Venue', 'Publikationsort'], journal: ['Journal', 'Fachzeitschrift'],
  authors: ['Authors', 'Autorinnen und Autoren'], doi: ['DOI', 'DOI'], selection_basis: ['Selection basis', 'Auswahlgrundlage'],
  why_relevant: ['Relevance to the opportunity', 'Bezug zur Stelle'], citations: ['Citations', 'Zitationen'],
  citation_count: ['Citation count', 'Anzahl Zitationen'], name: ['Name', 'Name'], role: ['Role', 'Rolle'],
  scientific_contact: ['Scientific contact', 'Wissenschaftlicher Kontakt'], administrative_contact: ['Administrative contact', 'Administrativer Kontakt'],
  main_supervisor: ['Main advisor', 'Hauptbetreuung'], co_supervisor: ['Co-advisor', 'Mitbetreuung'],
  assessment: ['Assessment', 'Einschätzung'], reason: ['Rationale', 'Begründung'], details: ['Details', 'Details'],
  salary: ['Salary', 'Gehalt'], salary_text: ['Salary', 'Gehalt'], funding: ['Funding', 'Finanzierung'],
  compensation: ['Compensation', 'Vergütung'], stipend: ['Stipend', 'Stipendium'], scholarship: ['Scholarship', 'Stipendium'],
  benefits: ['Benefits', 'Zusatzleistungen'], model: ['Pay model', 'Vergütungsmodell'], amount: ['Amount', 'Betrag'],
  min: ['Minimum', 'Minimum'], max: ['Maximum', 'Maximum'], currency: ['Currency', 'Währung'], period: ['Period', 'Zeitraum'],
  gross: ['Gross', 'Brutto'], net: ['Net', 'Netto'], monthly: ['Monthly', 'Monatlich'], annually: ['Annually', 'Jährlich'],
  requirements: ['Requirements', 'Anforderungen'], eligibility: ['Eligibility', 'Zulassungsvoraussetzungen'],
  qualifications: ['Qualifications', 'Qualifikationen'], required_skills: ['Required skills', 'Erforderliche Kenntnisse'],
  desired_skills: ['Desired skills', 'Gewünschte Kenntnisse'], language_requirements: ['Language requirements', 'Sprachkenntnisse'],
  required: ['Required', 'Erforderlich'], optional: ['Optional', 'Optional'],
  conditional: ['Conditional', 'Bedingt erforderlich'], advantageous: ['Beneficial', 'Von Vorteil'],
  beneficial: ['Beneficial', 'Von Vorteil'],
  recruitment: ['Recruitment', 'Stellenbewerbung'], doctoral_admission: ['Doctoral admission', 'Promotionszulassung'],
  after_selection: ['After selection', 'Nach der Auswahl'], interview: ['Interview', 'Gespräch'],
  offer: ['Offer', 'Angebot'], enrolment: ['Enrolment', 'Einschreibung'], unspecified: ['Not specified', 'Nicht angegeben'],
  required_documents: ['Required documents', 'Erforderliche Unterlagen'], application_documents: ['Application documents', 'Bewerbungsunterlagen'],
  documents: ['Documents', 'Unterlagen'], submission_documents: ['Submission documents', 'Einzureichende Unterlagen'],
  institution: ['Institution', 'Einrichtung'], university: ['Institution', 'Einrichtung'], unit: ['Department / group', 'Fachbereich / Gruppe'],
  country: ['Country', 'Land'], city: ['City', 'Stadt'], position_type: ['Position type', 'Art der Stelle'],
  duration_months: ['Duration (months)', 'Dauer (Monate)'], duration_details: ['Duration details', 'Angaben zur Dauer'],
  deadline: ['Application deadline', 'Bewerbungsfrist'], deadline_time_local: ['Deadline time', 'Uhrzeit der Frist'],
  deadline_timezone: ['Deadline timezone', 'Zeitzone der Frist'], deadline_original_text: ['Original deadline wording', 'Frist im Original'],
  start_date: ['Start date', 'Beginn'], availability: ['Availability', 'Verfügbarkeit'], opportunity_key: ['Reference', 'Referenz'],
  vacancy_id: ['Vacancy reference', 'Ausschreibungsnummer'], record_type: ['Record type', 'Art des Eintrags'],
  verification_level: ['Verification', 'Verifizierungsstand'], historical_match_status: ['Historical match', 'Historische Zuordnung'],
  source_context: ['Source context', 'Quellenkontext'], open_questions: ['Open questions', 'Offene Fragen'],
  metadata_schema_version: ['Record format version', 'Version des Datensatzformats'], created_at: ['Added', 'Hinzugefügt'],
  updated_at: ['Updated', 'Aktualisiert'], last_checked_at: ['Last checked', 'Zuletzt geprüft'],
  type: ['Type', 'Typ'], supports: ['Supports', 'Belegt'],
  checked_at: ['Checked', 'Geprüft'], context_captured_at: ['Context captured', 'Kontext gespeichert'],
  historical_context: ['Historical context', 'Historischer Kontext'], official_listing: ['Official listing', 'Offizielle Ausschreibung'],
  open: ['Open', 'Offen'], closed: ['Closed', 'Geschlossen'], unknown: ['Unknown', 'Unbekannt'],
  matched: ['Matched', 'Zugeordnet'], probable: ['Probable', 'Wahrscheinlich'], unresolved: ['Unresolved', 'Ungeklärt'],
};

const ALIASES: Record<string, string> = { university: 'institution', supervisor: 'supervisors', contact: 'contacts',
  salary_text: 'salary', application_documents: 'required_documents', documents: 'required_documents' };
// Frozen application snapshots retain their historical field names; live catalogue
// payloads use the canonical schema. Internal identities are never display copy.
const PRIVATE_KEYS = new Set(['id', 'user_id', 'entity_id', 'source_id', 'researcher_id']);
const FIT_FIELDS = new Set(['personal_fit', 'research_fit', 'research_career_potential', 'rd_career_potential']);
const SUMMARY_FIELDS = new Set(['research_summary', 'project_summary', 'project_description']);
const PRIMARY_LINK_FIELDS = ['official_url', 'application_url', 'source_url'];
const SOURCE_METADATA_FIELDS = new Set(['kind', 'precision', 'type', 'supports', 'supported_fields', 'checked_at']);
const SOURCE_REFERENCE_FIELDS = new Set(['sources', 'source_urls', 'evidence_urls', 'evidence_links', 'evidence']);
const ENUM_KEYS = new Set(['role', 'status', 'stage', 'availability', 'verification_level', 'historical_match_status', 'period']);

function keyName(value: string) { return value.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().replace(/[ -]+/g, '_'); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function phrase(en: string, de: string, lang: string) { return lang === 'de' ? de : en; }

/** Read an explicit 0–10 score without inferring one from the assessment text. */
export function personalFitScore(value: unknown): number | undefined {
  const raw = isRecord(value) ? value.score : value;
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()))) return;
  const score = Number(raw);
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : undefined;
}

/** Shared thresholds for opportunity badges and research assessment scores. */
export function fitScoreTone(score: number | undefined): 'red' | 'yellow' | undefined {
  return score !== undefined && score >= 9.6 ? 'red' : score !== undefined && score >= 9.1 ? 'yellow' : undefined;
}

export function opportunityFieldLabel(key: string, lang: string): string {
  const known = LABELS[keyName(key)];
  if (known) return known[lang === 'de' ? 1 : 0];
  const words = key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1))
    .replace(/\b(?:url|doi|cv|ai|id|orcid|isbn)\b/gi, (value) => value.toUpperCase());
}

function humanText(value: string | number | boolean, key: string, lang: string): string {
  if (typeof value === 'boolean') return phrase(value ? 'Yes' : 'No', value ? 'Ja' : 'Nein', lang);
  if (typeof value === 'number') return key === 'year' ? String(value) : new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB').format(value);
  if (ENUM_KEYS.has(key) && LABELS[keyName(value)]) return opportunityFieldLabel(value, lang);
  if ((key.endsWith('_at') || key === 'start_date' || key === 'deadline') && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', value.length === 10
        ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
  }
  return value.trim();
}

function safeHref(value: string, key: string): string | null {
  const web = safeWebUrl(value);
  if (web) return web;
  if (/^mailto:/i.test(value)) return safeLinkUrl(value);
  const email = safeEmailUrl(value);
  if (email) return email;
  if (key === 'doi' && /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/.test(value)) {
    return safeWebUrl(`https://doi.org/${encodeURIComponent(value).replace(/%2F/g, '/')}`);
  }
  return null;
}

function buildNode(value: unknown, key: string, id: string, lang: string, ancestors: Set<object>, label: string | null): OpportunityContextNode | null {
  if (isOpportunityInternalFact(value)) return null;
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = humanText(value, keyName(key), lang);
    if (!text) return null;
    const href = typeof value === 'string' ? safeHref(value.trim(), keyName(key)) : null;
    return { id, label, text, ...(href ? { href } : {}) };
  }
  if (typeof value !== 'object' || ancestors.has(value)) return null;
  const nextAncestors = new Set(ancestors).add(value);
  const children = Array.isArray(value)
    ? value.map((item, index) => {
      if (isOpportunityInternalFact(item)) return null;
      if (isRecord(item)) {
        const headingKey = ['name', 'title', 'label', 'text', 'document', 'requirement', 'item'].find((candidate) => typeof item[candidate] === 'string' && String(item[candidate]).trim());
        if (headingKey) {
          const heading = String(item[headingKey]).trim();
          const detail = Object.fromEntries(Object.entries(item).filter(([childKey]) => childKey !== headingKey));
          const node = buildNode(detail, key, `${id}.${index}`, lang, nextAncestors, heading)
            || buildNode(heading, key, `${id}.${index}`, lang, nextAncestors, null);
          if (node && ['contacts', 'supervisors'].includes(keyName(key)) && typeof item.entity_id === 'string' && Array.isArray(item.roles)) node.kind = 'person';
          return node;
        }
      }
      return buildNode(item, key, `${id}.${index}`, lang, nextAncestors, null);
    }).filter((item): item is OpportunityContextNode => item !== null)
    : Object.entries(value).filter(([childKey]) => !isOpportunityInternalField(childKey))
      .map(([childKey, item]) => buildNode(item, childKey, `${id}.${childKey}`, lang, nextAncestors, opportunityFieldLabel(childKey, lang)))
      .filter((item): item is OpportunityContextNode => item !== null);
  return children.length ? { id, label, children } : null;
}

function fieldGroup(key: string): OpportunityContextGroupId {
  const normalized = keyName(key);
  for (const [group, keys] of Object.entries(FIELD_GROUPS)) {
    if (keys.includes(normalized)) return group as OpportunityContextGroupId;
  }
  if (/(?:^|_)(?:url|urls|link|links|email)$/.test(normalized)) return 'links';
  return 'metadata';
}

function checklistValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return null;
  const next = new Set(ancestors).add(value);
  return Array.isArray(value) ? value.map((item) => checklistValue(item, next))
    : Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, checklistValue(item, next)]));
}

function requirementGroupStatus(key: string): OpportunityContextNode['requirementStatus'] {
  const normalized = keyName(key);
  if (['required', 'mandatory', 'essential', 'required_skills', 'required_documents'].includes(normalized)) return 'required';
  if (normalized === 'optional') return 'optional';
  if (normalized === 'conditional') return 'conditional';
  if (normalized === 'unspecified') return 'unspecified';
  if (['beneficial', 'benefitial', 'advantageous'].includes(normalized)) return 'beneficial';
  if (normalized === 'preferred') return 'preferred';
  if (normalized === 'recommended') return 'recommended';
  if (['desired', 'desirable', 'desired_skills'].includes(normalized)) return 'desired';
}

function explicitRequirementStatus(key: string, value: unknown): OpportunityContextNode['requirementStatus'] {
  const normalized = keyName(key);
  if (typeof value === 'boolean' && ['required', 'mandatory', 'optional'].includes(normalized)) {
    return (normalized === 'optional' ? !value : value) ? 'required' : 'optional';
  }
  if (value === true) return requirementGroupStatus(normalized);
  if (['required', 'optional', 'status', 'type', 'category', 'level', 'priority', 'importance', 'requirement_type'].includes(normalized) && typeof value === 'string') {
    return requirementGroupStatus(value);
  }
}

/** Content identities survive list reordering and language changes; changed requirements start unchecked. */
function attachChecklistKeys(node: OpportunityContextNode, value: unknown, path: string, arrayItem = false,
  status?: OpportunityContextNode['requirementStatus']) {
  if (status) node.requirementStatus = status;
  if (Array.isArray(value)) {
    for (const child of node.children || []) attachChecklistKeys(child, value[Number(child.id.split('.').at(-1))], path, true, status);
  } else if (isRecord(value) && !arrayItem && !['name', 'title', 'label', 'text', 'document', 'requirement', 'item'].some((key) => typeof value[key] === 'string')) {
    for (const child of node.children || []) {
      const key = child.id.slice(node.id.length + 1);
      attachChecklistKeys(child, value[key], `${path}.${key}`, false, requirementGroupStatus(key) || status);
    }
  } else {
    node.checklistKey = `${path}:${JSON.stringify(checklistValue(value))}`;
    if (isRecord(value)) {
      const fields = Object.entries(value).filter(([key, item]) => explicitRequirementStatus(key, item));
      const statuses = new Set(fields.map(([key, item]) => explicitRequirementStatus(key, item)));
      // A beneficial/preferred flag adds detail to required:false rather than contradicting it.
      if (statuses.size > 1 && !statuses.has('required')) statuses.delete('optional');
      // Conflicting source flags stay visible in the details instead of choosing one.
      if (statuses.size === 1) {
        node.requirementStatus = [...statuses][0];
        node.requirementStatusFields = fields.map(([key]) => `${node.id}.${key}`);
      } else if (statuses.size > 1) {
        delete node.requirementStatus;
      }
    }
  }
}

/** Project checklist entries into rows without changing their saved content identities. */
export function requirementTableRows(root: OpportunityContextNode): OpportunityContextNode[] {
  function visit(node: OpportunityContextNode, labels: string[], includeLabel = true): OpportunityContextNode[] {
    if (node.kind === 'requirement' || node.kind === 'prose') return [node];
    const field = keyName(node.id.split('.').at(-1)!);
    const redundant = ['requirements', 'required_documents', 'application_documents', 'documents', 'submission_documents'].includes(field);
    const label = includeLabel && node.label && !redundant && !requirementGroupStatus(field) ? node.label : null;
    const path = [...labels, ...(label ? [label] : [])];
    if (node.checklistKey || !node.children?.length) {
      return [{ ...node, label: path.join(' · ') || null,
        children: node.children?.filter(child => !node.requirementStatusFields?.includes(child.id)) }];
    }
    return node.children.flatMap(child => visit(child, path));
  }
  return visit(root, [], false);
}

export function checklistKeys(nodes: OpportunityContextNode[]): string[] {
  return [...new Set(nodes.flatMap((node) => node.checklistKey ? [node.checklistKey] : checklistKeys(node.children || [])))];
}

/** One destination per source, with all of its evidence and contact context retained. */
function consolidateSourceLinks(items: OpportunityContextNode[], lang: string): OpportunityContextNode[] {
  const sources = new Map<string, OpportunityContextNode>();
  const genericLabels = new Set(['url', 'href', 'links', 'sources', 'source_url', 'contacts', 'email', 'contact_email']
    .map((key) => opportunityFieldLabel(key, lang)));
  const hasLink = (node: OpportunityContextNode): boolean => Boolean(node.href || node.children?.some(hasLink));
  const signature = (node: OpportunityContextNode): string => JSON.stringify(node, (key, value) => key === 'id' ? undefined : value);
  function mergeDetails(existing: OpportunityContextNode[], incoming: OpportunityContextNode[]): OpportunityContextNode[] {
    const result = [...existing];
    for (const node of incoming) {
      if (result.some((candidate) => signature(candidate) === signature(node))) continue;
      const index = result.findIndex((candidate) => candidate.label === node.label && node.label !== null
        && candidate.children && node.children && !candidate.href && !node.href);
      if (index >= 0) result[index] = { ...result[index], children: mergeDetails(result[index].children!, node.children!) };
      else result.push(node);
    }
    return result;
  }
  function labelsFor(node: OpportunityContextNode, parents: string[]): string[] {
    const label = node.label?.replace(/ \((?:additional detail|ergänzende Angaben)\)$/, '');
    return label && !genericLabels.has(label) ? [...new Set([...parents, label])] : parents;
  }
  const sourceLabels = new Map<string, string[]>();
  function register(node: OpportunityContextNode, labels: string[], details: OpportunityContextNode[], evidence: OpportunityContextNode['evidence'] = []) {
    const href = node.href!; // Already validated by safeHref; never turn raw values into links here.
    const previous = sources.get(href);
    const allLabels = [...new Set([...(sourceLabels.get(href) || []), ...labels])];
    sourceLabels.set(href, allLabels);
    const children = mergeDetails(previous?.children || [], details);
    const references = [...new Map([...(previous?.evidence ?? []), ...(node.evidence ?? []), ...(evidence ?? [])].map(reference => [reference.href, reference])).values()];
    sources.set(href, {
      id: previous?.id || `links.destination.${sources.size}`, label: allLabels.join(' · ') || phrase('Source', 'Quelle', lang),
      href, text: previous?.text || node.text, ...(children.length ? { children } : {}), ...(references.length ? { evidence: references } : {}),
    });
  }
  function visit(node: OpportunityContextNode, parents: string[] = []): OpportunityContextNode | null {
    // A canonical person stays one entry, with their email and evidence links
    // nested inside it rather than becoming several apparent contacts.
    if (node.kind === 'person') return node;
    const labels = labelsFor(node, parents);
    if (node.href) { register(node, labels, node.children || []); return null; }
    if (!node.children?.length) return node;
    const directLinks = node.children.filter((child) => child.href);
    if (directLinks.length) {
      const details = node.children.filter((child) => !hasLink(child));
      directLinks.forEach((child) => register(child, labelsFor(child, labels), details, node.evidence));
      const remainder = node.children.filter((child) => !child.href && hasLink(child))
        .map((child) => visit(child, labels)).filter((child): child is OpportunityContextNode => child !== null);
      return remainder.length ? { ...node, children: remainder } : null;
    }
    const children = node.children.map((child) => visit(child, labels)).filter((child): child is OpportunityContextNode => child !== null);
    return children.length ? { ...node, children } : null;
  }
  const unlinked = items.map((node) => visit(node)).filter((node): node is OpportunityContextNode => node !== null);
  return [...sources.values(), ...unlinked];
}

/** Flatten references in already-built historical views; keep their saved content identities. */
function flattenLegacySourceReferences(groups: OpportunityContextGroup[], lang: string): { text: string; href: string }[] {
  type Reference = { text: string; href: string };
  const globalReferences = new Map<string, Reference>();
  const field = (node: OpportunityContextNode) => keyName(node.id.split('.').at(-1)!);
  const genericLabels = new Set([...SOURCE_REFERENCE_FIELDS, 'url', 'href', 'notes'].map(key => opportunityFieldLabel(key, lang)));
  function collect(node: OpportunityContextNode, references: Map<string, Reference>, parents: string[] = []): OpportunityContextNode[] {
    if (SOURCE_METADATA_FIELDS.has(field(node))) return [];
    const labels = node.label && !genericLabels.has(node.label) ? [...parents, node.label] : parents;
    const href = safeWebUrl(node.href);
    if (href) {
      const url = new URL(href);
      references.set(href, { text: labels.join(' · ') || `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`, href });
    }
    if (node.children) return node.children.flatMap(child => collect(child, references, labels));
    if (href || !node.text) return [];
    return [{ ...node, label: labels.join(' · ') || null }];
  }
  function project(node: OpportunityContextNode): OpportunityContextNode {
    const references = new Map((node.evidence ?? []).map(entry => [entry.href, entry]));
    const children = node.children?.flatMap(child => SOURCE_REFERENCE_FIELDS.has(field(child))
      ? collect(child, references) : [project(child)]);
    return { ...node, ...(children ? { children } : {}), ...(references.size ? { evidence: [...references.values()] } : {}) };
  }
  for (const group of groups) group.items = group.items.flatMap(node => SOURCE_REFERENCE_FIELDS.has(field(node))
    ? collect(node, globalReferences) : [project(node)]);
  return [...globalReferences.values()];
}

/** Canonical catalogue rows have a deliberate view; old frozen snapshots retain their original reader until migration. */
export function buildOpportunityGroups(context: Record<string, unknown>, lang: string): OpportunityContextGroup[] {
  if (typeof context.metadata_schema_version === 'number' && context.metadata_schema_version >= 5) {
    return buildCanonicalOpportunityGroups(context, lang, {
      label: key => opportunityFieldLabel(key, lang),
      checklistKey: (value, path) => `${path}:${JSON.stringify(checklistValue(value))}`,
    });
  }
  return buildLegacyOpportunityGroups(context, lang);
}

function buildLegacyOpportunityGroups(context: Record<string, unknown>, lang: string): OpportunityContextGroup[] {
  const groups = GROUPS.map(([id, en, de]) => ({ id, label: phrase(en, de, lang), items: [] as OpportunityContextNode[] }));
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  const seen = new Map<string, string[]>();
  const primaryLinks = new Map<string, string>();
  const visitedWrappers = new Set<object>();
  let livingStandard: unknown;
  const add = (rawKey: string, value: unknown, source: string) => {
    const key = keyName(rawKey);
    if (isOpportunityInternalField(key) || key === 'title') return;
    if (key === 'living_standard') { livingStandard ??= value; return; }
    if ((key === 'data' || key === 'details') && isRecord(value)) {
      if (visitedWrappers.has(value)) return;
      visitedWrappers.add(value);
      Object.entries(value).forEach(([nestedKey, nestedValue]) => add(nestedKey, nestedValue, `${source}.${key}`));
      return;
    }
    const node = buildNode(value, key, `${source}.${rawKey}`, lang, new Set(), opportunityFieldLabel(rawKey, lang));
    if (!node) return;
    if (PRIMARY_LINK_FIELDS.includes(key) && node.href?.startsWith('http') && (source === 'root' || !primaryLinks.has(key))) {
      primaryLinks.set(key, node.href);
    }
    if (SUMMARY_FIELDS.has(key)) node.kind = 'summary';
    if (FIT_FIELDS.has(key)) {
      node.kind = 'fit';
      const score = personalFitScore(value);
      if (score !== undefined) {
        node.score = score;
        node.text = `${humanText(score, 'score', lang)} / 10`;
        // Keep the rationale while avoiding a second, unformatted copy of the score.
        node.children = node.children?.filter((child) => !['score', 'scale_min', 'scale_max'].some(key => child.id === `${node.id}.${key}`));
      }
    }
    const canonicalKey = ALIASES[key] || key;
    const signature = JSON.stringify(node, (name, item) => name === 'id' ? undefined : item);
    const previous = seen.get(canonicalKey) || [];
    if (previous.includes(signature)) return;
    if (previous.length) node.label += phrase(' (additional detail)', ' (ergänzende Angaben)', lang);
    seen.set(canonicalKey, [...previous, signature]);
    const group = fieldGroup(key);
    if ((group === 'requirements' || group === 'documents') && key !== 'application_process') attachChecklistKeys(node, value, `${group}:${canonicalKey}`, false, requirementGroupStatus(key));
    byGroup.get(group)!.items.push(node);
  };
  // Only explain missing advisor research when the snapshot actually identifies a person or lab.
  const hasAdvisor = [context, isRecord(context.data) ? context.data : {}].some(value => FIELD_GROUPS.advisor
    .some(key => key !== 'supervisor_top_papers' && !!buildNode(value[key], key, key, lang, new Set(), null)));
  for (const [key, en, de] of (hasAdvisor ? [
    ['supervisor_research_focus', 'Advisor research focus not recorded.', 'Forschungsschwerpunkte der Betreuung nicht erfasst.'],
    ['supervisor_top_papers', 'Representative papers not recorded.', 'Repräsentative Publikationen nicht erfasst.'],
  ] : [])) {
    const candidates = [context[key], isRecord(context.data) ? context.data[key] : undefined];
    const value = candidates.find((candidate) => buildNode(candidate, key, `root.${key}`, lang, new Set(), opportunityFieldLabel(key, lang)));
    const node = buildNode(value, key, `root.${key}`, lang, new Set(), opportunityFieldLabel(key, lang));
    if (node) add(key, value, 'root');
    else byGroup.get('advisor')!.items.push({ id: `root.${key}`, label: opportunityFieldLabel(key, lang), text: phrase(en, de, lang), missing: true });
  }
  Object.entries(context).forEach(([key, value]) => add(key, value, 'root'));
  const sourceReferences = flattenLegacySourceReferences(groups, lang);
  const salary = byGroup.get('salary')!;
  if (salary.items.length || livingStandard !== undefined || context.city) salary.items.unshift(livingStandardNode(livingStandard, lang));
  const links = byGroup.get('links')!;
  links.items = consolidateSourceLinks(links.items, lang);
  const primaryHref = PRIMARY_LINK_FIELDS.map((key) => primaryLinks.get(key)).find(Boolean);
  const primaryLink = primaryHref ? links.items.find((node) => node.href === primaryHref) : undefined;
  const overview = byGroup.get('overview')!;
  if (primaryLink) {
    overview.items.push({ ...primaryLink, kind: 'main-link' });
    links.items = links.items.filter((node) => node !== primaryLink);
  }
  const displayedLinks = new Set<string>();
  function rememberLinks(node: OpportunityContextNode) {
    if (node.href) displayedLinks.add(node.href);
    node.evidence?.forEach(reference => displayedLinks.add(reference.href));
    node.children?.forEach(rememberLinks);
  }
  groups.forEach(group => group.items.forEach(rememberLinks));
  const unassigned = sourceReferences.filter(reference => !displayedLinks.has(reference.href));
  if (unassigned.length) links.items.push({ id: 'root.sources', label: opportunityFieldLabel('sources', lang), evidence: unassigned });
  // Stable reading order, independent of the database column order or JSON wrappers.
  const priority = (node: OpportunityContextNode) => node.kind === 'summary' ? 0 : node.kind === 'main-link' ? 1
    : node.kind === 'fit' ? 2 + [...FIT_FIELDS].indexOf(keyName(node.id.split('.').at(-1)!)) / 10 : 3;
  overview.items.sort((a, b) => priority(a) - priority(b));
  return groups.filter((group) => group.items.length);
}

function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([`*_[\]])/g, '\\$1').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^(\s*)([#>+\-])(?=\s)/gm, '$1\\$2');
}

function nodeMarkdown(node: OpportunityContextNode, depth = 0, completed?: Set<string>, lang = 'en'): string {
  const indentation = '  '.repeat(depth);
  const label = node.label ? `**${escapeMarkdown(node.label)}:**` : '';
  const text = node.text ? escapeMarkdown(node.text) : '';
  const value = node.href ? `[${text}](<${node.href}>)` : text;
  const checkbox = completed && node.checklistKey ? `[${completed.has(node.checklistKey) ? 'x' : ' '}] ` : '';
  const line = `${indentation}- ${checkbox}${[label, value].filter(Boolean).join(' ')}`;
  const status = node.kind === 'requirement' ? [node.requirementStatus ? opportunityFieldLabel(node.requirementStatus, lang) : '', node.requirementStage].filter(Boolean).join(' · ') : '';
  return [line.replace(/\n/g, `\n${indentation}  `) + (status ? ` — ${escapeMarkdown(status)}` : ''),
    ...(node.children || []).map((child) => nodeMarkdown(child, depth + 1, completed, lang)),
    ...(node.evidence || []).map(source => `${indentation}  - [${escapeMarkdown(source.text)}](<${source.href}>)`)].join('\n');
}

/** Human-readable context suitable for copy/download; contains no raw JSON or executable HTML. */
export function opportunityContextMarkdown(context: Record<string, unknown>, lang: string, completedKeys?: string[]): string {
  const title = typeof context.title === 'string' && context.title.trim() ? context.title.trim()
    : phrase('Opportunity context', 'Kontext zur Stelle', lang);
  const completed = completedKeys ? new Set(completedKeys) : undefined;
  const institution = typeof context.metadata_schema_version === 'number' && context.metadata_schema_version >= 5 && typeof context.institution === 'string' && context.institution.trim()
    ? [escapeMarkdown(context.institution.trim())] : [];
  return [`# ${escapeMarkdown(title)}`, ...institution, ...buildOpportunityGroups(context, lang).map((group) =>
    `## ${group.label}\n\n${group.items.map((item) => nodeMarkdown(item, 0, completed, lang)).join('\n')}`)].join('\n\n');
}
