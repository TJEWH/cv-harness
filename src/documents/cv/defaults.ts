import type { Contact, ContactField, CvDesign } from './types';

/** Shared header examples for placeholders, sample CVs, and anonymized output. */
export const SAMPLE_CONTACT: Readonly<Contact> = Object.freeze({
  name: 'Alex Muster',
  location: 'Neustadt',
  role: 'Software Engineer',
  email: 'muster-ex@mp.le',
  phone: '+49 123 456789',
  website: 'https://alexmuster.dev',
  linkedin: 'https://link.com/in/alexmuster',
  github: 'https://git.com/musterlex',
});

/** The only source of initial CV settings. Saved values always take precedence. */
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_SECTION_HEADER_SIZE = 'h2';
export const SUPPORTED_LANGUAGES = ['de', 'en'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];
export const DEFAULT_DESIGN: Readonly<Required<CvDesign>> = Object.freeze({
  h1: '24pt', h2: '12pt', h3: '10pt', bullets: '10.5pt',
  showTimeline: true,
  ink: '#111827', graphicOpacity: 100, dateOpacity: 100,
  fontBody: 'Inter', fontHead: 'Inter', hstyle: 'clean',
  badgeMode: 'border', badgeBorderWidth: '2.5px', badgeBorderRadius: '8px',
  sectionSpacingBody: '10mm', sectionSpacingSidebar: '6mm', itemSpacing: '3.5mm',
  sidebarWidth: '0.7fr', sidebarAlign: 'right', sidebarFillMode: 'after-cover', sidebarHeightMode: 'content', sidebarBottomPadding: '0mm',
  headerLayoutStyle: 'boxed', sidebarLayoutStyle: 'separator', contactLayout: 'side', contactItemSpacing: '2mm', separatorWidth: '3px',
  letterContactFields: ['name', 'location', 'email', 'phone'] satisfies ContactField[],
  pageMarginTop: '12mm', pageMarginRight: '12mm', pageMarginBottom: '12mm', pageMarginLeft: '12mm',
  pageMarginHorizontalLinked: true, pageMarginVerticalLinked: true,
  headerPaddingBottom: '0mm', headerBottomMargin: '2mm', headerBottomSpacingLinked: false,
  bodySidebarSpacing: '10mm', favoriteControls: [],
  customFonts: [],
});

// Full-page sidebars keep their fixed inset; content-sized sidebars use the editable padding.
export const FULL_PAGE_SIDEBAR_PADDING = '6mm';
export const SYSTEM_FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

export function designValue<K extends keyof CvDesign>(design: CvDesign, key: K): Required<CvDesign>[K] {
  const value = design[key];
  if (value !== undefined && value !== null) return value as Required<CvDesign>[K];
  const initial = DEFAULT_DESIGN[key];
  return (Array.isArray(initial) ? structuredClone(initial) : initial) as Required<CvDesign>[K];
}

export function designNumber(design: CvDesign, key: keyof CvDesign): number {
  const parsed = Number.parseFloat(String(designValue(design, key)));
  return Number.isFinite(parsed) ? parsed : Number.parseFloat(String(DEFAULT_DESIGN[key]));
}

export function resolveDesign(design: CvDesign = {}): Required<CvDesign> {
  return Object.fromEntries(Object.keys(DEFAULT_DESIGN).map((key) => [key, designValue(design, key as keyof CvDesign)])) as Required<CvDesign>;
}

export function createDefaultDesign(): Required<CvDesign> {
  return structuredClone(DEFAULT_DESIGN);
}
