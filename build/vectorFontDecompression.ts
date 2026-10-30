import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const decoderId = '\0virtual:vector-woff2-decompress';
const fontkitId = '\0virtual:vector-fontkit';

function replaceOnce(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) {
    throw new Error(`Vector font dependency changed; review its browser adapter: ${before}`);
  }
  return source.replace(before, after);
}

/** wawoff2 2.0.1 exports its runtime only in Node; publish it as browser ESM. */
export function makeWoff2DecoderModule(source: string) {
  source = replaceOnce(source,
    'var ENVIRONMENT_IS_NODE=typeof process==="object"&&typeof process.versions==="object"&&typeof process.versions.node==="string";',
    'var ENVIRONMENT_IS_NODE=false;');
  const start = 'if(ENVIRONMENT_IS_NODE){if(ENVIRONMENT_IS_WORKER){';
  const end = '}else if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error('WOFF2 browser adapter could not locate the pinned Node-only filesystem branch');
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex < startIndex) throw new Error('WOFF2 browser adapter found an invalid runtime branch');
  source = source.slice(0, startIndex) + 'if(ENVIRONMENT_IS_WEB||ENVIRONMENT_IS_WORKER){' + source.slice(endIndex + end.length);
  return `${source}\nexport default Module;\n`;
}

/** Correct the pinned Fontkit 2.0.4 variable-outline subset encoder. */
export function makeFontkitVariableSubsetsCompatible(source: string) {
  source = replaceOnce(source, 'new $6uUbQ$EncodeStream(size + tail)',
    'new $6uUbQ$EncodeStream(new Uint8Array(size + tail))');
  source = replaceOnce(source,
    "if (path.commands.length > 1 && path.commands[path.commands.length - 1].command !== 'closePath') endPtsOfContours.push(pointCount - 1);\n        let bbox = path.bbox;",
    "if (path.commands.length > 1 && path.commands[path.commands.length - 1].command !== 'closePath') endPtsOfContours.push(pointCount - 1);\n        if (same > 0) flags.push(same);\n        let bbox = path.bbox;");
  // Resolve variable compound glyphs to their final outlines too; copying the
  // original component offsets loses their variation positioning. Old hinting
  // instructions address the original point indices, not the re-encoded path.
  source = replaceOnce(source,
    'if (glyf && glyf.numberOfContours < 0) {\n            buffer = new Uint8Array(buffer);',
    'if (glyf && this.font._variationProcessor) {\n            buffer = this.glyphEncoder.encodeSimple(glyph.path);\n        } else if (glyf && glyf.numberOfContours < 0) {\n            buffer = new Uint8Array(buffer);');
  source = replaceOnce(source,
    '} else if (glyf && this.font._variationProcessor) // If this is a TrueType variation glyph, re-encode the path\n        buffer = this.glyphEncoder.encodeSimple(glyph.path, glyf.instructions);',
    '}');
  source = replaceOnce(source,
    'maxp.numGlyphs = this.glyf.length;',
    `maxp.numGlyphs = this.glyf.length;
        if (this.font._variationProcessor) {
            maxp.maxPoints = Math.max(maxp.maxPoints, maxp.maxComponentPoints);
            maxp.maxContours = Math.max(maxp.maxContours, maxp.maxComponentContours);
        }`);
  return source;
}

export default function vectorFontDecompression() {
  return {
    name: 'vector-font-decompression',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      if (id === 'wawoff2/build/decompress_binding.js') return decoderId;
      if (id === 'virtual:vector-fontkit') return fontkitId;
      if (id === 'fontkit' && importer?.split('?')[0].endsWith('/src/documents/pdf/pdfVectorExport.ts')) return fontkitId;
    },
    load(id: string) {
      if (id === decoderId) {
        return makeWoff2DecoderModule(readFileSync(require.resolve('wawoff2/build/decompress_binding.js'), 'utf8'));
      }
      if (id === fontkitId) {
        const sourcePath = join(dirname(require.resolve('fontkit')), 'browser-module.mjs');
        return makeFontkitVariableSubsetsCompatible(readFileSync(sourcePath, 'utf8'));
      }
    },
  };
}
