import * as pdfjsLib from 'pdfjs-dist';

// Vite resolves this URL to node_modules in dev and emits the worker as a hashed asset in the build.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// JPX and JBIG2/CCITT scans decode through wasm files that vite.config.ts serves under this path.
const WASM_URL = `${import.meta.env.BASE_URL}pdfjs/wasm/`;

export const pdfjs = {
  getDocument: (source: Parameters<typeof pdfjsLib.getDocument>[0] & object) =>
    pdfjsLib.getDocument({ ...source, wasmUrl: WASM_URL }),
};
