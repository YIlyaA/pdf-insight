import type { WorkerClient } from '../api/client';
import { splitIntoChunks } from './chunk';
import { AppError } from './errors';
import { mergeInsights } from './merge';
import { PdfError, extractPages, type PdfJsLike } from './pdfText';
import { MAX_CHUNK_CHARS, MAX_IMAGES_PER_REQUEST, type AnalyzeRequest } from './protocol';
import type { PageRenderer } from './renderPages';
import type { Insight } from './schema';

/** Analyse chunks plus the summary call (spec 11.2). */
export const MAX_REQUESTS_PER_RUN = 12;

/** Worker limit for one summary passed to /summarize. */
const MAX_SUMMARY_CHARS = 4000;

export type Progress =
  | { phase: 'loading' }
  | { phase: 'reading' }
  | { phase: 'scanning'; page: number; total: number }
  | { phase: 'analyzing'; done: number; total: number }
  | { phase: 'summarizing' };

export interface Coverage {
  analyzedTo: number;
  totalPages: number;
}

export type Outcome =
  { kind: 'result'; insight: Insight; coverage: Coverage | null } | { kind: 'empty' };

/** Kept by the caller between a failed run and its retry: finished chunks and the summary are never requested again. */
export interface RunState {
  plan?: unknown;
  insights: Map<number, Insight>;
  summary?: string;
}

export function createRunState(): RunState {
  return { insights: new Map() };
}

export interface PipelineDeps {
  pdfjs: PdfJsLike;
  /** Only called when scan pages exist. */
  openRenderer: (data: Uint8Array) => Promise<PageRenderer>;
  client: WorkerClient;
}

export interface RunOptions {
  signal: AbortSignal;
  state: RunState;
  onProgress: (p: Progress) => void;
  onRateLimitWait: (secondsLeft: number) => void;
}

type ChunkImage = AnalyzeRequest['images'][number];

interface PlannedChunk {
  pages: [number, number];
  text: string;
  images: ChunkImage[];
}

/** Built once per file and stored in `RunState.plan`, so a retry never re-reads or re-renders. */
class Plan {
  constructor(
    readonly numPages: number,
    readonly chunks: PlannedChunk[],
  ) {}
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError('aborted');
}

/** Renders one scan page; a page that cannot be made small enough maps to payload_too_large. */
async function renderPage(renderer: PageRenderer, page: number) {
  try {
    return await renderer.render(page);
  } catch (error) {
    if (error instanceof AppError || error instanceof PdfError) throw error;
    if (error instanceof Error && error.message === 'too_large') {
      throw new AppError('payload_too_large');
    }
    throw new PdfError('corrupt');
  }
}

function scanChunk(images: ChunkImage[]): PlannedChunk {
  const first = images[0]?.page ?? 1;
  const last = images[images.length - 1]?.page ?? first;
  return { pages: [first, last], text: '', images };
}

/** Runs of consecutive scan pages, at most 8 non-blank images each; blank pages are dropped. */
async function renderScanChunks(
  data: Uint8Array,
  scanPages: number[],
  deps: PipelineDeps,
  options: RunOptions,
): Promise<PlannedChunk[]> {
  const renderer = await deps.openRenderer(data);
  try {
    const chunks: PlannedChunk[] = [];
    let batch: ChunkImage[] = [];
    let previous = Number.NaN;
    const flush = () => {
      if (batch.length > 0) chunks.push(scanChunk(batch));
      batch = [];
    };
    for (const [i, page] of scanPages.entries()) {
      throwIfAborted(options.signal);
      options.onProgress({ phase: 'scanning', page: i + 1, total: scanPages.length });
      const rendered = await renderPage(renderer, page);
      if (page !== previous + 1 || batch.length === MAX_IMAGES_PER_REQUEST) flush();
      previous = page;
      if (!rendered.blank) {
        batch.push({ page, mimeType: rendered.mimeType, dataBase64: rendered.dataBase64 });
      }
    }
    flush();
    return chunks;
  } finally {
    await renderer.destroy();
  }
}

async function buildPlan(file: File, deps: PipelineDeps, options: RunOptions): Promise<Plan> {
  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new PdfError('corrupt');
  }
  throwIfAborted(options.signal);
  options.onProgress({ phase: 'reading' });
  const { numPages, pages, scanPages } = await extractPages(deps.pdfjs, data);
  throwIfAborted(options.signal);

  const scans = new Set(scanPages);
  const textChunks: PlannedChunk[] = splitIntoChunks(
    pages.filter((p) => !scans.has(p.page)),
    MAX_CHUNK_CHARS,
  ).map((chunk) => ({ pages: chunk.pages, text: chunk.text, images: [] }));
  const scanChunks =
    scanPages.length > 0 ? await renderScanChunks(data, scanPages, deps, options) : [];
  // Stable sort: pieces of one long page keep their order.
  const chunks = [...textChunks, ...scanChunks].sort((a, b) => a.pages[0] - b.pages[0]);
  return new Plan(numPages, chunks);
}

/** Analyses the chunks not yet in `state.insights`, one at a time, in order. */
async function analyseChunks(
  file: File,
  plan: Plan,
  count: number,
  deps: PipelineDeps,
  options: RunOptions,
): Promise<Insight[]> {
  const { state, signal } = options;
  let done = plan.chunks.slice(0, count).filter((_, i) => state.insights.has(i)).length;
  options.onProgress({ phase: 'analyzing', done, total: count });
  for (const [index, chunk] of plan.chunks.slice(0, count).entries()) {
    if (state.insights.has(index)) continue;
    throwIfAborted(signal);
    const request: AnalyzeRequest = {
      fileName: file.name,
      totalPages: plan.numPages,
      chunk: { index, total: plan.chunks.length, pages: chunk.pages, text: chunk.text },
      images: chunk.images,
    };
    const insight = await deps.client.analyze(request, {
      signal,
      onRateLimitWait: options.onRateLimitWait,
    });
    state.insights.set(index, insight);
    throwIfAborted(signal);
    done += 1;
    options.onProgress({ phase: 'analyzing', done, total: count });
  }
  return plan.chunks.slice(0, count).map((_, i) => {
    const insight = state.insights.get(i);
    if (!insight) throw new AppError('internal_error');
    return insight;
  });
}

/** Merges chunk results and replaces the concatenated summary with one from /summarize. */
async function combine(
  parts: Insight[],
  deps: PipelineDeps,
  options: RunOptions,
): Promise<Insight> {
  const merged = mergeInsights(parts);
  const { state, signal } = options;
  const summaries = parts
    .map((p) => p.summary.trim().slice(0, MAX_SUMMARY_CHARS))
    .filter((s) => s.length > 0);
  if (state.summary === undefined && summaries.length > 0) {
    throwIfAborted(signal);
    options.onProgress({ phase: 'summarizing' });
    state.summary = await deps.client.summarize(
      { language: merged.document.language, summaries },
      { signal, onRateLimitWait: options.onRateLimitWait },
    );
    throwIfAborted(signal);
  }
  return { ...merged, summary: state.summary ?? merged.summary };
}

async function run(file: File, deps: PipelineDeps, options: RunOptions): Promise<Outcome> {
  const { state, signal } = options;
  throwIfAborted(signal);
  options.onProgress({ phase: 'loading' });
  const plan = state.plan instanceof Plan ? state.plan : await buildPlan(file, deps, options);
  state.plan = plan;
  if (plan.chunks.length === 0) return { kind: 'empty' };

  const total = plan.chunks.length;
  const count = total > 1 ? Math.min(total, MAX_REQUESTS_PER_RUN - 1) : 1;
  const parts = await analyseChunks(file, plan, count, deps, options);
  const combined = total > 1 ? await combine(parts, deps, options) : parts[0];
  if (!combined || combined.summary.trim() === '') return { kind: 'empty' };

  const insight: Insight = {
    ...combined,
    document: { ...combined.document, fileName: file.name, pages: plan.numPages },
  };
  const analyzedTo = Math.max(...plan.chunks.slice(0, count).map((c) => c.pages[1]));
  const coverage = count < total ? { analyzedTo, totalPages: plan.numPages } : null;
  return { kind: 'result', insight, coverage };
}

/** file is already validated. Throws PdfError (password, corrupt) or AppError. */
export async function runPipeline(
  file: File,
  deps: PipelineDeps,
  options: RunOptions,
): Promise<Outcome> {
  try {
    return await run(file, deps, options);
  } catch (error) {
    if (options.signal.aborted) throw new AppError('aborted');
    throw error;
  }
}
