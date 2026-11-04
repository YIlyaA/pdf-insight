import * as pdfjs from 'pdfjs-dist';

// Vite resolves this URL to node_modules in dev and emits the worker as a hashed asset in the build.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { pdfjs };
