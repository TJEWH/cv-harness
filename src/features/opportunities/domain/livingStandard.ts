import type { OpportunityContextNode } from './opportunityContext';
import { safeWebUrl } from '../../../shared/lib/safeUrl';

/** Personal comparison rubric; scores describe this housing scenario, not a city ranking. */
export const LIVING_STANDARD_FACTORS = [
  { key: 'affordability', weight: 50, en: 'Salary & affordability', de: 'Gehalt & Kaufkraft' },
  { key: 'housing', weight: 15, en: 'Apartment search', de: 'Wohnungssuche' },
  { key: 'culture', weight: 10, en: 'Culture', de: 'Kultur' },
  { key: 'nature', weight: 10, en: 'Nature', de: 'Natur' },
  { key: 'student_life', weight: 10, en: 'Student life', de: 'Studierendenleben' },
  { key: 'climate', weight: 5, en: 'Climate', de: 'Klima' },
] as const;
export type LivingStandardFactor = typeof LIVING_STANDARD_FACTORS[number]['key'];
export interface LivingStandardAssessment {
  version: 1;
  /** Absent only in legacy assessments, which assumed a private apartment. */
  housing_baseline?: 'shared_flat' | 'private_apartment';
  assessed_at: string;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  salary_basis: string;
  budget_basis: string;
  funding_note?: string;
  factors: Record<LivingStandardFactor, { score: number | null; reason: string }>;
  sources: { title: string; url: string }[];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const validScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;

export function readLivingStandard(value: unknown): LivingStandardAssessment | null {
  if (!record(value) || value.version !== 1 || !nonempty(value.assessed_at) || !/^\d{4}-\d{2}-\d{2}$/.test(value.assessed_at)
    || !Number.isFinite(Date.parse(value.assessed_at)) || new Date(value.assessed_at).toISOString().slice(0, 10) !== value.assessed_at
    || !['low', 'medium', 'high'].includes(String(value.confidence))
    || (value.housing_baseline !== undefined && (typeof value.housing_baseline !== 'string' || !['shared_flat', 'private_apartment'].includes(value.housing_baseline)))
    || !nonempty(value.summary) || !nonempty(value.salary_basis) || !nonempty(value.budget_basis) || !record(value.factors)) return null;
  const factors = {} as LivingStandardAssessment['factors'];
  for (const { key } of LIVING_STANDARD_FACTORS) {
    const factor = value.factors[key];
    if (!record(factor) || !nonempty(factor.reason) || !(factor.score === null || validScore(factor.score))) return null;
    factors[key] = { score: factor.score, reason: factor.reason.trim() };
  }
  const sources = Array.isArray(value.sources) ? value.sources.flatMap(source => {
    if (!record(source) || !nonempty(source.title) || typeof source.url !== 'string') return [];
    const url = safeWebUrl(source.url);
    return url ? [{ title: source.title.trim(), url }] : [];
  }) : [];
  if (!sources.length) return null;
  return { version: 1, housing_baseline: value.housing_baseline === 'shared_flat' ? 'shared_flat' : 'private_apartment',
    assessed_at: value.assessed_at, confidence: value.confidence as LivingStandardAssessment['confidence'],
    summary: value.summary.trim(), salary_basis: value.salary_basis.trim(), budget_basis: value.budget_basis.trim(),
    ...(nonempty(value.funding_note) ? { funding_note: value.funding_note.trim() } : {}), factors, sources };
}

export function livingStandardScore(assessment: LivingStandardAssessment): number | undefined {
  if (LIVING_STANDARD_FACTORS.some(({ key }) => !validScore(assessment.factors[key].score))) return;
  const weighted = LIVING_STANDARD_FACTORS.reduce((total, { key, weight }) => total + assessment.factors[key].score! * weight, 0) / 100;
  return Math.round((weighted + Number.EPSILON) * 10) / 10;
}

export function livingStandardVerdict(score: number, lang: string): string {
  const labels = score >= 8 ? ['Very good', 'Sehr gut'] : score >= 6.5 ? ['Good', 'Gut']
    : score >= 5 ? ['Manageable', 'Machbar'] : score >= 3 ? ['Difficult', 'Schwierig'] : ['Poor', 'Schlecht'];
  return labels[lang === 'de' ? 1 : 0];
}

export function livingStandardNode(value: unknown, lang: string): OpportunityContextNode {
  const de = lang === 'de';
  const label = de ? 'Lebensstandard mit Promotionsgehalt' : 'Living standard on a PhD salary';
  const assessment = readLivingStandard(value);
  const id = 'root.living_standard';
  if (!assessment) return { id, label, kind: 'living-standard', missing: true,
    text: de ? 'Noch nicht bewertet. Für einen Vergleich fehlen belegte Gehalts- und Stadtangaben.' : 'Not assessed yet. A comparison needs sourced salary and city information.' };
  const score = livingStandardScore(assessment);
  const shared = assessment.housing_baseline === 'shared_flat';
  const format = (value: number) => `${value.toFixed(1).replace('.', de ? ',' : '.')} / ${de ? '10,0' : '10.0'}`;
  const entry = (key: string, label: string, text: string): OpportunityContextNode => ({ id: `${id}.${key}`, label, text });
  const affordability = assessment.factors.affordability.score;
  const incomplete = de ? 'Unvollständige Bewertung' : 'Incomplete assessment';
  const provisional = assessment.confidence !== 'high' ? de ? ' · vorläufig' : ' · provisional' : '';
  return { id, label, kind: 'living-standard', score,
    text: (score === undefined ? incomplete : `${format(score)} · ${livingStandardVerdict(score, lang)}`) + provisional,
    evidence: assessment.sources.map(source => ({ text: source.title, href: source.url })),
    children: [
      entry('summary', de ? 'Einschätzung' : 'Assessment', assessment.summary),
      entry('salary_verdict', de ? 'Gehaltsbewertung' : 'Salary verdict', affordability === null
        ? de ? 'Unbekannt: Vergütung oder Finanzierung zuerst bestätigen.' : 'Unknown: confirm pay or funding first.'
        : `${format(affordability)} · ${livingStandardVerdict(affordability, lang)}`),
      entry('baseline', de ? 'Annahme' : 'Baseline', shared
        ? de ? 'Eine Person mit eigenem Zimmer in einer WG, geteilter Küche und geteilten Haushaltskosten; keine garantierte Wohnheimunterkunft, unterstellten Studierendenrabatte oder bevorzugte Klimazone.'
          : 'One person with a private room in a shared flat, sharing the kitchen and household costs; no guaranteed student housing, assumed student discounts or preferred climate.'
        : de ? 'Eine Person, bescheidene eigene Mietwohnung, keine unterstellten Studierendenrabatte, keine bevorzugte Klimazone.'
          : 'One person, a modest private apartment, no assumed student discounts, no preferred climate.'),
      entry('salary_basis', de ? 'Gehaltsgrundlage' : 'Pay basis', assessment.salary_basis),
      entry('budget_basis', de ? 'Lebenshaltung & Miete' : 'Living costs & rent', assessment.budget_basis),
      ...(assessment.funding_note ? [entry('funding', de ? 'Finanzierung beachten' : 'Funding conditions', assessment.funding_note)] : []),
      ...LIVING_STANDARD_FACTORS.map(({ key, weight, en, de: german }) => entry(key, `${shared && key === 'housing' ? de ? 'WG-Zimmersuche' : 'Room search' : de ? german : en} (${weight}%)`,
        `${assessment.factors[key].score === null ? de ? 'Nicht bewertet' : 'Not assessed' : format(assessment.factors[key].score!)} · ${assessment.factors[key].reason}`)),
      entry('method', de ? 'Berechnung' : 'Method', de ? 'Gewichteter Mittelwert; höhere Werte sind besser. Fehlende Teilbewertungen zählen nicht als null. Klima bewertet Alltagstauglichkeit, nicht persönliche Vorlieben.'
        : 'Weighted average of comparison judgments, not a measured city ranking; higher is better. Missing factors do not count as zero. Climate reflects everyday comfort, not personal taste.'),
      entry('checked', de ? 'Stand & Sicherheit' : 'Date & confidence', `${assessment.assessed_at} · ${de
        ? { low: 'gering', medium: 'mittel', high: 'hoch' }[assessment.confidence] : assessment.confidence}`),
    ] };
}
