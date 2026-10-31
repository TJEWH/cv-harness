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

const PRIVATE_KEYS = new Set(['id', 'user_id', 'entity_id', 'source_id', 'researcher_id']);

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

/** Render the current canonical opportunity representation. */
export function buildOpportunityGroups(context: Record<string, unknown>, lang: string): OpportunityContextGroup[] {
  return buildCanonicalOpportunityGroups(context, lang, {
    label: key => opportunityFieldLabel(key, lang),
    checklistKey: (value, path) => `${path}:${JSON.stringify(checklistValue(value))}`,
  });
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

export function opportunityContextMarkdown(context: Record<string, unknown>, lang: string, completedKeys?: string[]): string {
  const title = typeof context.title === 'string' && context.title.trim() ? context.title.trim()
    : phrase('Opportunity context', 'Kontext zur Stelle', lang);
  const completed = completedKeys ? new Set(completedKeys) : undefined;
  const institution = typeof context.institution === 'string' && context.institution.trim()
    ? [escapeMarkdown(context.institution.trim())] : [];
  return [`# ${escapeMarkdown(title)}`, ...institution, ...buildOpportunityGroups(context, lang).map((group) =>
    `## ${group.label}\n\n${group.items.map((item) => nodeMarkdown(item, 0, completed, lang)).join('\n')}`)].join('\n\n');
}
