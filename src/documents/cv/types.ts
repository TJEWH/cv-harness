export const CV_STATE_VERSION = 7;

/** Shared state contracts for the editor, saved configurations and previews. */
export type ItemState = 'planned' | 'ongoing' | 'complete';
export type SaveStatus = 'saving' | 'saved' | 'error';
export type ContentArea = 'body' | 'sidebar';
export type CustomBodyField = 'title' | 'institution' | 'place' | 'start' | 'end' | 'state' | 'desc';
/** Structured fields that can be replaced with an automatic privacy proxy. */
export const FIELD_PRIVACY_TYPES = ['company', 'institution', 'place', 'dates'] as const;
export type FieldPrivacyType = typeof FIELD_PRIVACY_TYPES[number];
/** Store overrides only for privacy wording that differs from the original CV. */
export type PrivacyFieldOverrides = Record<string, string | number>;
export interface CvItem {
  id: string;
  hidden?: boolean;
  name?: string;
  title?: string;
  company?: string;
  institution?: string;
  sub?: string;
  place?: string;
  start?: string;
  end?: string;
  state?: ItemState;
  bullets?: string;
  desc?: string;
  thesis?: string;
  coursesText?: string;
  level?: string;
  levelValue?: number;
}
export interface CustomSection {
  id: string;
  name: string;
  entryMode?: 'fields' | 'textarea';
  text?: string;
  fields?: CustomBodyField[];
  entries: CvItem[];
}
export interface SidebarSection {
  id: string;
  name: string;
  levelType: 'experience' | 'years' | null;
  items: CvItem[];
}
export interface Contact {
  name: string;
  location: string;
  role: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  github: string;
}
export type ContactField = keyof Contact;
export const CONTACT_FIELDS = ['name', 'role', 'location', 'email', 'phone', 'website', 'linkedin', 'github'] as const satisfies readonly ContactField[];
export type FontSource = 'bunny' | 'google';
export interface CustomFont { name: string; source: FontSource }
export interface CvDesign {
  h1?: string; h2?: string; h3?: string; bullets?: string;
  showTimeline?: boolean;
  ink?: string; graphicOpacity?: number; dateOpacity?: number;
  fontBody?: string; fontHead?: string; hstyle?: string;
  customFonts?: CustomFont[];
  badgeMode?: string; badgeBorderWidth?: string; badgeBorderRadius?: string;
  sectionSpacingBody?: string; sectionSpacingSidebar?: string; itemSpacing?: string;
  sidebarWidth?: string; sidebarAlign?: string; sidebarFillMode?: string; sidebarHeightMode?: string;
  sidebarBottomPadding?: string; headerLayoutStyle?: string; sidebarLayoutStyle?: string;
  contactLayout?: string; contactItemSpacing?: string; separatorWidth?: string;
  letterContactFields?: ContactField[];
  pageMarginTop?: string; pageMarginRight?: string; pageMarginBottom?: string; pageMarginLeft?: string;
  pageMarginHorizontalLinked?: boolean; pageMarginVerticalLinked?: boolean;
  headerPaddingBottom?: string; headerBottomMargin?: string; headerBottomSpacingLinked?: boolean;
  bodySidebarSpacing?: string; favoriteControls?: string[];
}
export interface CvState {
  version: number;
  lang: string;
  disabled: string[];
  completedSections: string[];
  keepTogetherSections: string[];
  design: CvDesign;
  anonymization: { excludedSections: string[]; excludedItems: string[]; proxyFields?: FieldPrivacyType[]; fieldOverrides?: PrivacyFieldOverrides };
  contact: Contact;
  about: { text: string };
  education: CvItem[];
  experience: { jobs: CvItem[] };
  languages: CvItem[];
  hobbies: CvItem[];
  customSections: CustomSection[];
  sidebarSections: SidebarSection[];
  sectionNames: Record<string, string>;
  sectionHeaderSizes: Record<string, string>;
  bodyOrder: string[];
  sidebarOrder: string[];
}
/** Portable CV content; presentation and editor settings live in CvConfig. */
export type CvContentItem = Omit<CvItem, 'hidden'>;
export interface CvContent {
  contact: Contact;
  about: { text: string };
  education: CvContentItem[];
  experience: { jobs: CvContentItem[] };
  languages: CvContentItem[];
  hobbies: CvContentItem[];
  customSections: (Omit<CustomSection, 'entries'> & { entries: CvContentItem[] })[];
  sidebarSections: (Omit<SidebarSection, 'items'> & { items: CvContentItem[] })[];
  sectionNames: Record<string, string>;
}
export type CvConfig = Pick<CvState,
  'lang' | 'design' | 'disabled' | 'completedSections' | 'keepTogetherSections' |
  'anonymization' | 'sectionHeaderSizes' | 'bodyOrder' | 'sidebarOrder'
> & { hiddenItems: string[] };
export type CvJsonKind = 'content' | 'config';
export interface SavedConfiguration {
  id: string; name: string; mtime?: number;
  /** Legacy application/subvariant provenance; only roots can start another application. */
  parentId?: string;
}
export type KeysOfType<T, Value> = { [K in keyof T]-?: NonNullable<T[K]> extends Value ? K : never }[keyof T];
type ItemTextKey = Exclude<KeysOfType<CvItem, string>, 'id' | 'state'>;
interface FieldLabel { label: string; placeholder?: string }
export interface SelectOption<T extends string = string> { label: string; value: T }
export type ItemField = FieldLabel & (
  | { type: 'text'; key: ItemTextKey }
  | { type: 'textarea'; key: ItemTextKey }
  | { type: 'number'; key: KeysOfType<CvItem, number> }
  | { type: 'select'; key: ItemTextKey; options: SelectOption[] }
  | { type: 'select'; key: 'state'; options: SelectOption<ItemState | ''>[] }
);
