export interface CvStructure {
  schemaVersion: 1;
  areas: { id: 'body' | 'sidebar'; sectionIds: string[] }[];
  sections: { id: string; label: string; area: 'body' | 'sidebar'; entryIds: string[] }[];
  entries: { id: string; sectionId: string; label: string; bulletIds: string[] }[];
  bullets: { id: string; entryId: string; fieldId: string; text: string }[];
  ranges: { id: string; fieldId: string; bulletId: string | null; text: string; label: string; typoOnly?: true }[];
  unsupported: { fieldId: string; reason: string }[];
}

interface CvOperationBase { id: string; targetId: string; explanation: string }
export type CvOperation = CvOperationBase & (
  | { type: 'reorder_sections' | 'reorder_entries' | 'reorder_bullets'; order: string[] }
  | { type: 'shorten_text'; text: string }
  | { type: 'fix_typos'; text: string }
  | { type: 'omit_bullet' }
);
export interface CvComment { id: string; fieldId: string; explanation: string }

/** Local reconstruction metadata. These paths and source identities must never enter the public request. */
export interface CvStructureBindings {
  sections: { id: string; sourceId: string; area: 'body' | 'sidebar'; entriesPath: (string | number)[] | null }[];
  entries: { id: string; path: (string | number)[] }[];
  bulletFields: {
    entryId: string; fieldId: string; path: (string | number)[];
    lines: { bulletId: string; prefix: string; suffix: string }[];
    separators: string[]; trailing: string;
  }[];
  ranges: { id: string; fieldId: string; path: (string | number)[]; bulletId: string | null }[];
}
