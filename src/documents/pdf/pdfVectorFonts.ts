import type { Font, FontCollection } from 'fontkit';
import type { FontRun, LoadedFace } from './pdfTypes';
interface FontFaceDescriptor { family: string; style: string; weight: number[]; ranges: number[][]; url: string }
interface FontResolverOptions {
  document?: Document; stylesheetUrls?: string[]; loadedFaces?: LoadedFace[]; fetch?: typeof fetch;
  createFont?(bytes: Uint8Array): Font | FontCollection | Promise<Font | FontCollection>;
}
import { decompressVectorFont } from './pdfFontDecompression.ts';

const resourceCaches = new WeakMap<typeof fetch, Map<string, Promise<string | Uint8Array>>>();
let fontSerial = 0;
const cleanFamily = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
const fontError = (detail: string) => new Error(`PDF: ${detail}. Choose a downloadable font in Design and ensure its webfont has loaded.`);

function descriptor(block: string, name: string) {
  return block.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim() || '';
}

function weightRange(value = '400') {
  const values = value.replace('normal', '400').replace('bold', '700').match(/\d+/g)?.map(Number) || [400];
  return [values[0], values[1] || values[0]];
}

function unicodeRanges(value = '') {
  const ranges = [...value.matchAll(/U\+([\dA-F?]+)(?:-([\dA-F]+))?/gi)]
    .map(([, start, end]) => [parseInt(start.replace(/\?/g, '0'), 16), parseInt(end || start.replace(/\?/g, 'F'), 16)])
    .sort((left, right) => left[0] - right[0]);
  const merged: number[][] = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged.length ? merged : [[0, 0x10ffff]];
}

function faceKey(face: Omit<FontFaceDescriptor, 'url'>) {
  return JSON.stringify([face.family.toLowerCase(), face.style, face.weight, face.ranges]);
}

/** Parse the @font-face declarations returned to this browser. */
export function parseVectorFontFaces(css: string, stylesheetUrl: string): FontFaceDescriptor[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^}]+)}/gi)].flatMap(([, block]) => {
    const family = cleanFamily(descriptor(block, 'font-family'));
    const source = descriptor(block, 'src').match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2];
    if (!family || !source) return [];
    return [{
      family,
      style: descriptor(block, 'font-style').split(/\s+/)[0] || 'normal',
      weight: weightRange(descriptor(block, 'font-weight')),
      url: new URL(source, stylesheetUrl).href,
      ranges: unicodeRanges(descriptor(block, 'unicode-range')),
    }];
  });
}

export function parseVectorCanvasFont(value: string) {
  const match = String(value).match(/^(.*?)\s*(\d*\.?\d+)(px|pt)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i);
  if (!match) throw fontError(`cannot interpret the rendered font ${JSON.stringify(value)}`);
  const [, modifiers, size, unit, families] = match;
  const weight = modifiers.match(/(?:^|\s)([1-9]\d{0,2}|1000)(?=\s|$)/)?.[1];
  return {
    fontSize: Number(size) * (unit.toLowerCase() === 'pt' ? 96 / 72 : 1),
    weight: weight ? Number(weight) : /\bbold\b/i.test(modifiers) ? 700 : 400,
    style: /\bitalic\b/i.test(modifiers) ? 'italic' : /\boblique\b/i.test(modifiers) ? 'oblique' : 'normal',
    families: (families.match(/(?:'[^']*'|"[^"]*"|[^,])+/g) || []).map(cleanFamily),
  };
}

// CSS searches weights directionally, not by absolute numerical distance.
function weightRank([minimum, maximum]: number[], requested: number) {
  if (minimum <= requested && maximum >= requested) return [0, 0];
  if (requested >= 400 && requested <= 500) {
    if (minimum > requested && minimum <= 500) return [0, minimum - requested];
    if (maximum < requested) return [1, requested - maximum];
    return [2, minimum - 500];
  }
  if (requested < 400) return maximum < requested ? [0, requested - maximum] : [1, minimum - requested];
  return minimum > requested ? [0, minimum - requested] : [1, requested - maximum];
}

function matchingFaces(faces: FontFaceDescriptor[], family: string, request: ReturnType<typeof parseVectorCanvasFont>, codePoint: number) {
  const styles = request.style === 'normal' ? ['normal', 'oblique', 'italic']
    : request.style === 'italic' ? ['italic', 'oblique', 'normal'] : ['oblique', 'italic', 'normal'];
  const matches = faces.filter((face) => face.family.toLowerCase() === family.toLowerCase())
    .map((face, index) => ({ face, rank: [styles.indexOf(face.style), ...weightRank(face.weight, request.weight), -index] }))
    .sort((left, right) => {
      for (let index = 0; index < left.rank.length; index += 1) {
        if (left.rank[index] !== right.rank[index]) return left.rank[index] - right.rank[index];
      }
      return 0;
    });
  // Match the style/weight first, then its composite Unicode subsets.
  // Do not substitute another weight for a missing glyph.
  return matches.filter(({ face, rank }) => rank.slice(0, 3).every((value, index) => value === matches[0].rank[index])
    && face.ranges.some(([start, end]) => codePoint >= start && codePoint <= end));
}

function resource(url: string, type: 'css', fetchImpl: typeof fetch): Promise<string>;
function resource(url: string, type: 'font', fetchImpl: typeof fetch): Promise<Uint8Array>;
function resource(url: string, type: 'css' | 'font', fetchImpl: typeof fetch) {
  let cache = resourceCaches.get(fetchImpl);
  if (!cache) resourceCaches.set(fetchImpl, cache = new Map());
  const key = `${type}:${url}`;
  if (!cache.has(key)) {
    const promise = Promise.resolve().then(() => fetchImpl(url)).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return type === 'css' ? response.text() : new Uint8Array(await response.arrayBuffer());
    }).catch((error) => {
      cache!.delete(key);
      throw fontError(`could not load the font ${type === 'css' ? 'stylesheet' : 'file'} (${error.message})`);
    });
    cache.set(key, promise);
  }
  return cache.get(key)!;
}

/**
 * Resolve canvas text to the same downloadable faces used by the CV. Pass
 * fontkit.create from the renderer so PDFKit receives its own compatible fonts.
 * Stylesheet URLs are captured before the first await, isolating an export from
 * later changes to the design's font selections.
 */
export async function createVectorFontResolver({ document: documentRef = globalThis.document, stylesheetUrls, loadedFaces, fetch: fetchImpl = globalThis.fetch, createFont }: FontResolverOptions = {}) {
  if (typeof createFont !== 'function') throw new TypeError('Vector font resolution requires fontkit.create');
  const urls = [...new Set(stylesheetUrls ?? ['cv-font-body', 'cv-font-head'].map((id) => (documentRef?.getElementById(id) as HTMLLinkElement | null)?.href).filter((url): url is string => Boolean(url)))];
  const availableFaces = loadedFaces === undefined ? null : new Set(loadedFaces
    .filter((face) => face.status === 'loaded')
    .map((face) => faceKey({
      family: cleanFamily(face.family),
      style: (face.style || 'normal').split(/\s+/)[0],
      weight: weightRange(face.weight),
      ranges: unicodeRanges(face.unicodeRange),
    })));
  const fontReady = documentRef?.fonts?.ready;
  const faces = (await Promise.all(urls.map(async (url) => parseVectorFontFaces(await resource(url, 'css', fetchImpl), url)))).flat();
  await fontReady;
  const fonts = new Map<string, Promise<Font>>();

  async function loadFace(face: FontFaceDescriptor, requestedWeight: number) {
    const weight = Math.min(face.weight[1], Math.max(face.weight[0], requestedWeight));
    const id = `${face.url}#${weight}`;
    if (!fonts.has(id)) {
      fonts.set(id, resource(face.url, 'font', fetchImpl).then(async (bytes) => {
        const sourceFont = await createFont!(await decompressVectorFont(bytes));
        if ('fonts' in sourceFont) throw new Error('Font collections are not supported');
        const font = sourceFont.variationAxes?.wght && typeof sourceFont.getVariation === 'function'
          ? sourceFont.getVariation({ wght: weight }) : sourceFont;
        // Variations and Unicode subsets may share a PostScript name. PDFKit
        // otherwise deduplicates distinct weights into the first embedded font.
        Object.defineProperty(font, 'postscriptName', {
          value: `${font.postscriptName || 'CVVector'}-CV${++fontSerial}`,
          configurable: true,
        });
        return font;
      }).catch((error) => {
        fonts.delete(id);
        throw fontError(`could not embed ${face.family} (${error.message})`);
      }));
    }
    return { font: (await fonts.get(id))!, id, weight };
  }

  return {
    async resolve(canvasFont: string, text: string): Promise<FontRun[]> {
      if (!text) return [];
      const request = parseVectorCanvasFont(canvasFont);
      const runs: FontRun[] = [];
      for (const character of text) {
        const codePoint = character.codePointAt(0)!;
        let resolved: Omit<FontRun, 'text'> | undefined;
        for (const family of request.families) {
          for (const { face } of matchingFaces(faces, family, request, codePoint)) {
            // Validate after CSS matching: filtering unavailable faces first
            // could silently replace a failed font with another style/weight.
            if (availableFaces && !availableFaces.has(faceKey(face))) {
              throw fontError(`${face.family} was not loaded when the page was rendered; let its fonts load and try again`);
            }
            const loaded = await loadFace(face, request.weight);
            if (!loaded.font.hasGlyphForCodePoint(codePoint)) continue;
            resolved = {
              ...loaded,
              family: face.family,
              fontSize: request.fontSize,
              syntheticBold: request.weight >= 600 && loaded.weight < 600,
              syntheticItalic: request.style !== 'normal' && face.style === 'normal',
            };
            break;
          }
          if (resolved) break;
        }
        if (!resolved) throw fontError(`no embeddable font covers ${JSON.stringify(character)} in ${request.families.join(', ')}`);
        const previous = runs.at(-1);
        if (previous?.id === resolved.id) previous.text += character;
        else runs.push({ ...resolved, text: character });
      }
      return runs;
    },
  };
}
