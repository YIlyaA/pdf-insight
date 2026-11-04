import { createWorkerClient, type WorkerClient } from './api/client';
import { AppError } from './lib/errors';
import type { StorageLike } from './lib/history';
import { runPipeline, type Outcome, type Progress, type RunState } from './lib/pipeline';
import { createPageRenderer } from './lib/renderPages';
import { validateFile, type ValidationResult } from './lib/validateFile';

export interface RunContext {
  state: RunState;
  signal: AbortSignal;
  onProgress(p: Progress): void;
  onRateLimitWait(secondsLeft: number): void;
}

export interface AppServices {
  /** Reads the head of the file and calls validateFile. */
  validate(file: File): Promise<ValidationResult>;
  /** Throws PdfError (shown inline under the zone) or AppError (shown in ErrorPanel). */
  analyze(file: File, run: RunContext): Promise<Outcome>;
  storage: StorageLike | null;
  now(): number;
  isOnline(): boolean;
  writeClipboard(text: string): Promise<void>;
}

/** validateFile looks for the PDF signature in the first 1024 bytes. */
const HEAD_BYTES = 1024;

function browserStorage(): StorageLike | null {
  try {
    const storage = window.localStorage;
    const probe = 'pdf-insight.probe';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function createDefaultServices(): AppServices {
  let client: WorkerClient | null = null;
  return {
    async validate(file) {
      const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
      return validateFile(file, head);
    },
    async analyze(file, run) {
      const baseUrl = import.meta.env.VITE_API_URL;
      if (!baseUrl) throw new AppError('not_configured');
      client ??= createWorkerClient({ baseUrl });
      // pdf.js is loaded on first use so the first screen stays light.
      const { pdfjs } = await import('./pdfjs');
      const deps = {
        pdfjs,
        openRenderer: (data: Uint8Array) => createPageRenderer(pdfjs, data),
        client,
      };
      return runPipeline(file, deps, run);
    },
    storage: browserStorage(),
    now: () => Date.now(),
    isOnline: () => navigator.onLine !== false,
    async writeClipboard(text) {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(text);
    },
  };
}
