import type { LetterFormatting } from '../letterTypes';

/** Bump when the letter's rendering changes enough to require a fresh layout review. */
export const LETTER_LAYOUT_VERSION = 2;
export const DEFAULT_LETTER_FORMATTING: Readonly<Required<LetterFormatting>> = Object.freeze({ marginMm: 20, fontSizePt: 11, lineHeight: 1.2, headerNameSizePt: 16 });
export const LETTER_FORMATTING_LIMITS = {
  marginMm: { min: 10, max: 30, step: 0.1 },
  fontSizePt: { min: 10, max: 14, step: 0.5 },
  lineHeight: { min: 1, max: 2, step: 0.1 },
  headerNameSizePt: { min: 10, max: 32, step: 0.5 },
} as const;

export function readLetterFormatting(value: unknown): LetterFormatting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid letter formatting.');
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(LETTER_FORMATTING_LIMITS) as (keyof LetterFormatting)[]) {
    const number = input[key];
    if (key === 'headerNameSizePt' && number === undefined) continue;
    const { min, max } = LETTER_FORMATTING_LIMITS[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
      throw new Error(`Letter formatting ${key} must be between ${min} and ${max}.`);
    }
  }
  return { marginMm: input.marginMm as number, fontSizePt: input.fontSizePt as number, lineHeight: input.lineHeight as number,
    ...(input.headerNameSizePt === undefined ? {} : { headerNameSizePt: input.headerNameSizePt as number }) };
}

export function resolveLetterFormatting(formatting?: LetterFormatting, templateFormatting?: LetterFormatting): Required<LetterFormatting> {
  const chosen = formatting ?? templateFormatting;
  return { ...DEFAULT_LETTER_FORMATTING, ...(chosen === undefined ? {} : readLetterFormatting(chosen)) };
}
