import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const WASM_DIR = 'node_modules/pdfjs-dist/wasm';
const WASM_FILES = [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
];

/** pdf.js decodes JPX and JBIG2 scans with these files; they must be served next to the app. */
function pdfjsWasm(): Plugin {
  return {
    name: 'pdfjs-wasm',
    generateBundle() {
      for (const name of WASM_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/wasm/${name}`,
          source: readFileSync(`${WASM_DIR}/${name}`),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdf-insight/pdfjs/wasm/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        if (!WASM_FILES.includes(name)) return next();
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        res.end(readFileSync(`${WASM_DIR}/${name}`));
      });
    },
  };
}

// GitHub Pages serves the site under /<repo>/, so assets need this base.
export default defineConfig(({ mode }) => {
  // Without VITE_API_URL Vite folds the analysis code away and every upload fails at run time.
  if (mode === 'production' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL) {
    throw new Error(
      'VITE_API_URL is required for a production build (the proxy address, not a secret).',
    );
  }
  return {
    base: '/pdf-insight/',
    plugins: [react(), pdfjsWasm()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  };
});
