import type { Woff2Runtime } from '../../vendor';
let runtimePromise: Promise<Woff2Runtime> | undefined;
const decodedFonts = new WeakMap<Uint8Array, Promise<Uint8Array>>();

async function decompressionRuntime() {
  if (!runtimePromise) {
    // The Vite adapter exposes this pinned Emscripten module in browsers too.
    // Import only for WOFF2: TTF exports do not download or initialize the WASM.
    runtimePromise = import('wawoff2/build/decompress_binding.js').then(async ({ default: runtime }) => {
      if (typeof runtime?.run !== 'function') throw new Error('The WOFF2 browser decoder adapter is unavailable');
      if (!runtime.calledRun) {
        await new Promise<void>((resolve, reject) => {
          runtime.onRuntimeInitialized = resolve;
          runtime.onAbort = (reason) => reject(new Error(`WOFF2 decoder initialization failed: ${reason}`));
        });
      }
      return runtime;
    }).catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

/** Fontkit's variable/subset paths require a real SFNT stream, not WOFF2. */
export async function decompressVectorFont(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) return bytes;
  if (!decodedFonts.has(bytes)) {
    decodedFonts.set(bytes, decompressionRuntime().then((runtime) => {
      const result = runtime.decompress(bytes);
      if (result === false) throw new Error('The WOFF2 font could not be decoded for PDF embedding');
      // Own the output rather than retaining a view into reusable WASM memory.
      return new Uint8Array(result);
    }).catch((error) => {
      decodedFonts.delete(bytes);
      throw error;
    }));
  }
  return decodedFonts.get(bytes)!;
}
