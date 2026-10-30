import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import responsivePdfRenderer from './build/responsivePdfRenderer.ts';
import vectorFontDecompression from './build/vectorFontDecompression.ts';
import pdfPreviewAssets from './build/pdfPreviewAssets.ts';
import { parseSupabaseConfiguration } from './src/platform/supabase/supabaseConfig.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_SUPABASE_', 'NEXT_PUBLIC_SUPABASE_']);
  const configuration = parseSupabaseConfiguration(
    env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    mode === 'development',
  );
  return {
    plugins: [responsivePdfRenderer(), vectorFontDecompression(), pdfPreviewAssets(), vue()],
    // Vite compiles the templates, including draggable's render functions.
    // Its CommonJS Vue import otherwise pulls the browser template compiler in.
    resolve: { alias: [{ find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' }] },
    // Allowlist validated public configuration. Do not inline privileged keys.
    envPrefix: [],
    define: { __SUPABASE_CONFIGURATION__: JSON.stringify(configuration) },
    // GitHub Pages serves project sites below the repository name.
    base: '/cv-builder/',
  };
});
