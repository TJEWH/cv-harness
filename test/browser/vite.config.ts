import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import responsivePdfRenderer from '../../build/responsivePdfRenderer';
import vectorFontDecompression from '../../build/vectorFontDecompression';
import pdfPreviewAssets from '../../build/pdfPreviewAssets';

// Deliberately independent of the app's .env and production Supabase configuration.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)), base: '/cv-harness/', envDir: false, envPrefix: [],
  cacheDir: 'node_modules/.vite-browser-tests',
  optimizeDeps: { entries: ['test/browser/pages/*.html'] },
  define: { __SUPABASE_CONFIGURATION__: JSON.stringify({ status: 'missing' }) },
  plugins: [vue(), responsivePdfRenderer(), vectorFontDecompression(), pdfPreviewAssets()],
  resolve: { alias: [{ find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' }] },
  server: { host: '127.0.0.1', port: 5177, strictPort: true, headers: {
    'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:5177; img-src 'self' data: blob:; font-src 'self' data: blob:; form-action 'none'",
  } },
});
