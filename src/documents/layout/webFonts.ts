import type { CustomFont, CvDesign, FontSource, SelectOption } from '../cv/types';
import { parseVectorFontFaces } from '../pdf/pdfVectorFonts';

export const BODY_FONTS = ['Inter', 'Source Sans 3', 'IBM Plex Sans', 'Noto Sans', 'Work Sans', 'Nunito Sans', 'Rubik', 'Merriweather Sans', 'Hind'];
export const HEADING_FONTS = ['Browallia New', 'Century Gothic', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Space Grotesk'];
export const BUNDLED_FONT_FAMILIES = new Set(['Inter', 'Montserrat', 'Poppins', 'Raleway', 'Noto Sans', 'Rubik', 'IBM Plex Sans'].map((name) => name.toLowerCase()));
const bunnyFamilies = new Set([...BODY_FONTS, ...HEADING_FONTS]
  .filter((name) => !['Browallia New', 'Century Gothic'].includes(name)).map((name) => name.toLowerCase()));
const bundledStylesheetUrl = `${import.meta.env?.BASE_URL || '/'}fonts/bundled-fonts.css`;

export function isBundledFont(name: string) {
  return BUNDLED_FONT_FAMILIES.has(name.trim().toLowerCase());
}

export function selectedFont(name: string, design: CvDesign): CustomFont {
  return design.customFonts?.find((font) => font.name.toLowerCase() === name.toLowerCase())
    || { name, source: bunnyFamilies.has(name.toLowerCase()) ? 'bunny' : 'google' };
}

export function fontStylesheetUrl({ name, source }: CustomFont): string {
  if (isBundledFont(name)) return bundledStylesheetUrl;
  const family = source === 'bunny'
    ? encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
    : encodeURIComponent(name).replace(/%20/g, '+');
  const origin = source === 'bunny' ? 'https://fonts.bunny.net' : 'https://fonts.googleapis.com';
  // Both providers support CSS v1, which returns available requested weights.
  return `${origin}/css?family=${family}:300,400,600,700&display=swap`;
}

export function fontOptions(names: string[], design: CvDesign, selected = ''): SelectOption[] {
  const fonts = new Map<string, CustomFont>();
  for (const name of [...names, ...(design.customFonts?.map((font) => font.name) || []), selected].filter(Boolean)) {
    const font = selectedFont(name, design);
    fonts.set(font.name.toLowerCase(), font);
  }
  return [...fonts.values()].map(({ name, source }) => ({
    value: name, label: `${name} (${isBundledFont(name) ? 'Bundled' : source === 'bunny' ? 'Bunny' : 'Google'})`,
  }));
}

export function storeCustomFont(fonts: CustomFont[] = [], font: CustomFont): CustomFont[] {
  return [...fonts.filter((entry) => entry.name.toLowerCase() !== font.name.toLowerCase()), font];
}

export type FontImportErrorCode = 'invalid-name' | 'not-found' | 'network' | 'timeout' | 'http' | 'invalid-css' | 'decode' | 'cancelled';
export class FontImportError extends Error {
  constructor(public readonly code: FontImportErrorCode, public readonly source?: FontSource, public readonly status?: number) {
    super(code);
    this.name = 'FontImportError';
  }
}

interface ImportOptions {
  fetch?: typeof fetch;
  decode?: (name: string, data: ArrayBuffer) => Promise<unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Verify the provider response and a real font file before saving the family. */
export async function importWebFont(name: string, source: FontSource, options: ImportOptions = {}): Promise<CustomFont> {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f|:]/.test(name)) throw new FontImportError('invalid-name');
  const fetchFont = options.fetch || globalThis.fetch;
  const decode = options.decode || ((family, data) => new FontFace(family, data).load());
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, options.timeoutMs ?? 20000);
  const abortError = () => new FontImportError(timedOut ? 'timeout' : 'cancelled', source);
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(abortError());
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });

  async function request(url: string): Promise<Response> {
    try {
      return await fetchFont(url, { signal: controller.signal });
    } catch {
      throw controller.signal.aborted ? abortError() : new FontImportError('network', source);
    }
  }

  async function load(): Promise<CustomFont> {
    if (controller.signal.aborted) throw abortError();
    const url = fontStylesheetUrl({ name, source });
    const response = await request(url);
    const css = await response.text();
    const missing = (response.status === 400 && /(?:font family not found|missing font family)/i.test(css))
      || (response.ok && /please specify a valid (?:icon )?font/i.test(css));
    if (response.status === 404 || missing) throw new FontImportError('not-found', source, response.status);
    if (!response.ok) throw new FontImportError('http', source, response.status);
    let faces;
    try {
      faces = parseVectorFontFaces(css, url).filter((face) => face.family.toLowerCase() === name.toLowerCase());
    } catch {
      throw new FontImportError('invalid-css', source);
    }
    if (!faces.length) throw new FontImportError('invalid-css', source);
    // Prefer a Latin regular face; script-only fonts can use their first subset.
    const face = faces.find((entry) => entry.weight[0] <= 400 && entry.weight[1] >= 400
      && entry.ranges.some(([start, end]) => start <= 65 && end >= 65)) || faces[0];
    const fontResponse = await request(face.url);
    if (!fontResponse.ok) throw new FontImportError('http', source, fontResponse.status);
    const bytes = await fontResponse.arrayBuffer();
    try {
      await decode(face.family, bytes);
    } catch {
      throw new FontImportError('decode', source);
    }
    return { name: face.family, source };
  }

  try {
    return await Promise.race([load().catch(async (error: unknown) => {
      if (source !== 'bunny' || !(error instanceof FontImportError) || error.code !== 'not-found') throw error;
      source = 'google';
      return load();
    }), aborted]);
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    if (error instanceof FontImportError) throw error;
    throw new FontImportError('network', source);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
