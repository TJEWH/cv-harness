import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import type { Component } from 'vue';

export interface CompileSfcOptions {
  id: string;
  mode?: 'setup' | 'rendered';
  /** Resolve explicit mocks here; fallback stays scoped to the actual SFC. */
  require?: (specifier: string, fallback: ReturnType<typeof createRequire>) => unknown;
  transformScript?: (source: string) => string;
  compilerOptions?: ts.CompilerOptions;
}

/** Compile real SFC code while each regression retains its own explicit mocks.
 * The source-scoped require also preserves one CJS editing/commit registry.
 */
export function compileSfc(filename: URL, options: CompileSfcOptions) {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename: fileURLToPath(filename) }).descriptor;
  const compiled = compileScript(descriptor, { id: options.id, inlineTemplate: options.mode === 'rendered' });
  const source = options.transformScript?.(compiled.content) ?? compiled.content;
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, ...options.compilerOptions, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports: { default?: Component; [name: string]: unknown } = {};
  const require = createRequire(filename);
  new Function('require', 'exports', code)(
    (specifier: string) => options.require ? options.require(specifier, require) : require(specifier), exports,
  );
  if (!exports.default) throw new Error(`SFC did not export a component: ${filename.pathname}`);
  const component: Component = options.mode === 'rendered' ? exports.default : { ...exports.default, render: () => null };
  return { component, exports, require };
}
