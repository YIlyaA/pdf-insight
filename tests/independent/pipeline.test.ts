// @vitest-environment node
import type { WorkerClient, CallContext } from '../../src/api/client';
import { AppError } from '../../src/lib/errors';
import type { PdfJsLike } from '../../src/lib/pdfText';
import {
  MAX_REQUESTS_PER_RUN,
  createRunState,
  runPipeline,
  type Outcome,
  type PipelineDeps,
  type Progress,
  type RunState,
} from '../../src/lib/pipeline';
import type { AnalyzeRequest, SummarizeRequest } from '../../src/lib/protocol';
import type { PageRenderer, RenderedPage } from '../../src/lib/renderPages';
import type { Insight } from '../../src/lib/schema';
import { makeInsight } from './helpers';

const SHORT = 'To jest strona z wystarczającą ilością tekstu do analizy.';
const LONG = 'słowo '.repeat(6500).trim(); // ~39 000 chars: two such pages never share a 60 000 chunk
const SCAN = '';

function fakePdfJs(pageTexts: string[]): PdfJsLike {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageTexts.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({
            items: [{ str: pageTexts[n - 1] ?? '', hasEOL: false }],
          }),
        }),
      }),
      destroy: async () => undefined,
    }),
  };
}

function failingPdfJs(error: Error): PdfJsLike {
  return {
    getDocument: () => ({ promise: Promise.reject(error), destroy: async () => undefined }),
  };
}

function fakeRenderer(blankPages: number[] = []) {
  const rendered: number[] = [];
  const renderer: PageRenderer = {
    render: async (page: number): Promise<RenderedPage> => {
      rendered.push(page);
      return { page, mimeType: 'image/jpeg', dataBase64: '/9j/4AAQ', blank: blankPages.includes(page) };
    },
    destroy: async () => undefined,
  };
  return { renderer, rendered, openRenderer: vi.fn(async () => renderer) };
}

interface FakeClient {
  client: WorkerClient;
  analyzeCalls: Array<{ request: AnalyzeRequest; ctx: CallContext }>;
  summarizeCalls: SummarizeRequest[];
  maxConcurrent: () => number;
}

function fakeClient(
  hooks: {
    onAnalyze?: (request: AnalyzeRequest, ctx: CallContext) => void;
    analyzeSummary?: (request: AnalyzeRequest) => string;
    onSummarize?: () => void;
  } = {},
): FakeClient {
  const analyzeCalls: FakeClient['analyzeCalls'] = [];
  const summarizeCalls: SummarizeRequest[] = [];
  let inFlight = 0;
  let max = 0;
  const client: WorkerClient = {
    analyze: async (request, ctx): Promise<Insight> => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      analyzeCalls.push({ request, ctx });
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      hooks.onAnalyze?.(request, ctx);
      const base = makeInsight();
      return {
        ...base,
        document: { ...base.document, fileName: request.fileName, pages: 1 },
        summary: hooks.analyzeSummary?.(request) ?? `sum-${request.chunk.index}`,
        keywords: [`k${request.chunk.index}`],
      };
    },
    summarize: async (request): Promise<string> => {
      summarizeCalls.push(request);
      hooks.onSummarize?.();
      return 'FINAL';
    },
  };
  return { client, analyzeCalls, summarizeCalls, maxConcurrent: () => max };
}

const makeFile = (name = 'raport.pdf'): File =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

interface RunResult {
  outcome: Outcome;
  progress: Progress[];
  waits: number[];
}

async function run(
  pdfjs: PdfJsLike,
  fake: FakeClient,
  rendererFake = fakeRenderer(),
  extra: { state?: RunState; signal?: AbortSignal; file?: File } = {},
): Promise<RunResult> {
  const progress: Progress[] = [];
  const waits: number[] = [];
  const deps: PipelineDeps = { pdfjs, openRenderer: rendererFake.openRenderer, client: fake.client };
  const outcome = await runPipeline(extra.file ?? makeFile(), deps, {
    signal: extra.signal ?? new AbortController().signal,
    state: extra.state ?? createRunState(),
    onProgress: (p) => progress.push(p),
    onRateLimitWait: (s) => waits.push(s),
  });
  return { outcome, progress, waits };
}

const insightOf = (outcome: Outcome): Insight => {
  if (outcome.kind !== 'result') throw new Error('expected a result');
  return outcome.insight;
};

describe('constants', () => {
  it('caps a run at 12 requests', () => {
    expect(MAX_REQUESTS_PER_RUN).toBe(12);
  });
});

describe('single chunk text document', () => {
  it('sends one /analyze request with no summary call and no renderer', async () => {
    const fake = fakeClient();
    const rf = fakeRenderer();
    const { outcome } = await run(fakePdfJs([SHORT, SHORT]), fake, rf);
    expect(fake.analyzeCalls).toHaveLength(1);
    expect(fake.summarizeCalls).toHaveLength(0);
    expect(rf.openRenderer).not.toHaveBeenCalled();
    const request = fake.analyzeCalls[0]?.request;
    expect(request?.fileName).toBe('raport.pdf');
    expect(request?.totalPages).toBe(2);
    expect(request?.chunk).toMatchObject({ index: 0, total: 1, pages: [1, 2] });
    expect(request?.chunk.text).toContain('[[Strona 1]]');
    expect(outcome).toMatchObject({ kind: 'result', coverage: null });
    expect(insightOf(outcome).summary).toBe('sum-0');
  });

  it('puts the real page count into document.pages', async () => {
    const { outcome } = await run(fakePdfJs([SHORT, SHORT, SHORT]), fakeClient());
    expect(insightOf(outcome).document.pages).toBe(3);
  });

  it('forwards the rate-limit countdown and the run signal to the client', async () => {
    const controller = new AbortController();
    const fake = fakeClient({ onAnalyze: (_r, ctx) => ctx.onRateLimitWait?.(5) });
    const { waits } = await run(fakePdfJs([SHORT]), fake, fakeRenderer(), { signal: controller.signal });
    expect(waits).toEqual([5]);
  });
});

describe('multi-chunk text document', () => {
  it('analyses chunks one at a time in order, merges, and replaces the summary', async () => {
    const fake = fakeClient();
    const { outcome } = await run(fakePdfJs([LONG, LONG, LONG]), fake);
    expect(fake.analyzeCalls.map((c) => c.request.chunk.index)).toEqual([0, 1, 2]);
    expect(fake.analyzeCalls.every((c) => c.request.chunk.total === 3)).toBe(true);
    expect(fake.maxConcurrent()).toBe(1);
    expect(fake.summarizeCalls).toHaveLength(1);
    expect(fake.summarizeCalls[0]).toEqual({ language: 'pl', summaries: ['sum-0', 'sum-1', 'sum-2'] });
    const insight = insightOf(outcome);
    expect(insight.summary).toBe('FINAL');
    expect(insight.keywords).toEqual(['k0', 'k1', 'k2']);
    expect(insight.document.pages).toBe(3);
    expect(outcome).toMatchObject({ coverage: null });
  });
});

describe('request cap', () => {
  it('analyses all 11 chunks plus the summary (12 requests) without coverage', async () => {
    const fake = fakeClient();
    const { outcome } = await run(fakePdfJs(Array.from({ length: 11 }, () => LONG)), fake);
    expect(fake.analyzeCalls).toHaveLength(11);
    expect(fake.summarizeCalls).toHaveLength(1);
    expect(outcome).toMatchObject({ kind: 'result', coverage: null });
  });

  it('analyses only the first 11 of 13 chunks and reports coverage', async () => {
    const fake = fakeClient();
    const { outcome, progress } = await run(fakePdfJs(Array.from({ length: 13 }, () => LONG)), fake);
    expect(fake.analyzeCalls).toHaveLength(11);
    expect(fake.summarizeCalls).toHaveLength(1);
    expect(fake.summarizeCalls[0]?.summaries).toHaveLength(11);
    expect(outcome).toMatchObject({ kind: 'result', coverage: { analyzedTo: 11, totalPages: 13 } });
    expect(insightOf(outcome).document.pages).toBe(13);
    const analyzing = progress.filter((p) => p.phase === 'analyzing');
    expect(analyzing[analyzing.length - 1]).toEqual({ phase: 'analyzing', done: 11, total: 11 });
  });
});

describe('scan pages', () => {
  it('batches scan pages by 8 as chunks with empty text and images', async () => {
    const fake = fakeClient();
    const rf = fakeRenderer();
    const { outcome } = await run(fakePdfJs(Array.from({ length: 10 }, () => SCAN)), fake, rf);
    const [a, b] = fake.analyzeCalls.map((c) => c.request);
    expect(fake.analyzeCalls).toHaveLength(2);
    expect(a?.chunk).toMatchObject({ index: 0, total: 2, pages: [1, 8], text: '' });
    expect(a?.images.map((i) => i.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b?.chunk).toMatchObject({ index: 1, total: 2, pages: [9, 10], text: '' });
    expect(b?.images.map((i) => i.page)).toEqual([9, 10]);
    expect(a?.totalPages).toBe(10);
    expect(fake.summarizeCalls).toHaveLength(1);
    expect(insightOf(outcome).document.pages).toBe(10);
  });

  it('sorts mixed chunks by first page and reindexes them (scan first)', async () => {
    const fake = fakeClient();
    await run(fakePdfJs([SCAN, SHORT]), fake);
    const requests = fake.analyzeCalls.map((c) => c.request);
    expect(requests.map((r) => r.chunk.index)).toEqual([0, 1]);
    expect(requests.every((r) => r.chunk.total === 2)).toBe(true);
    expect(requests[0]?.chunk.text).toBe('');
    expect(requests[0]?.images.map((i) => i.page)).toEqual([1]);
    expect(requests[1]?.chunk.text).toContain('[[Strona 2]]');
    expect(requests[1]?.images).toEqual([]);
  });

  it('keeps a text chunk that starts earlier ahead of a later scan chunk', async () => {
    const fake = fakeClient();
    await run(fakePdfJs([SHORT, SCAN, SHORT]), fake);
    const requests = fake.analyzeCalls.map((c) => c.request);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.chunk.text).not.toBe('');
    expect(requests[0]?.chunk.pages[0]).toBe(1);
    expect(requests[1]?.chunk.text).toBe('');
    expect(requests[1]?.images.map((i) => i.page)).toEqual([2]);
  });

  it('returns empty without any request when every scan page is blank', async () => {
    const fake = fakeClient();
    const rf = fakeRenderer([1, 2, 3]);
    const { outcome } = await run(fakePdfJs([SCAN, SCAN, SCAN]), fake, rf);
    expect(outcome).toEqual({ kind: 'empty' });
    expect(fake.analyzeCalls).toHaveLength(0);
    expect(fake.summarizeCalls).toHaveLength(0);
  });

  it('does not send blank scan pages', async () => {
    const fake = fakeClient();
    await run(fakePdfJs([SCAN, SCAN, SCAN]), fake, fakeRenderer([2]));
    expect(fake.analyzeCalls).toHaveLength(1);
    expect(fake.analyzeCalls[0]?.request.images.map((i) => i.page)).toEqual([1, 3]);
  });

  it('returns empty when the final summary of the scan path is blank', async () => {
    const fake = fakeClient({ analyzeSummary: () => '' });
    const { outcome } = await run(fakePdfJs([SCAN]), fake);
    expect(outcome).toEqual({ kind: 'empty' });
  });

  it('reports scanning progress for rendered pages', async () => {
    const { progress } = await run(fakePdfJs([SCAN, SCAN, SCAN]), fakeClient());
    const scanning = progress.filter((p) => p.phase === 'scanning');
    expect(scanning.length).toBeGreaterThan(0);
    expect(scanning.every((p) => p.phase === 'scanning' && p.total === 3)).toBe(true);
    const last = scanning[scanning.length - 1];
    expect(last).toMatchObject({ page: 3 });
  });
});

describe('retry with the same RunState', () => {
  it('re-requests only the chunks that did not finish', async () => {
    const state = createRunState();
    let fail = true;
    const fake = fakeClient({
      onAnalyze: (request) => {
        if (fail && request.chunk.index === 2) throw new AppError('network');
      },
    });
    const pdfjs = fakePdfJs([LONG, LONG, LONG]);
    await expect(run(pdfjs, fake, fakeRenderer(), { state })).rejects.toMatchObject({ code: 'network' });
    expect(fake.analyzeCalls.map((c) => c.request.chunk.index)).toEqual([0, 1, 2]);
    fail = false;
    const { outcome } = await run(pdfjs, fake, fakeRenderer(), { state });
    expect(fake.analyzeCalls.map((c) => c.request.chunk.index)).toEqual([0, 1, 2, 2]);
    expect(fake.summarizeCalls).toHaveLength(1);
    expect(fake.summarizeCalls[0]?.summaries).toEqual(['sum-0', 'sum-1', 'sum-2']);
    expect(insightOf(outcome).summary).toBe('FINAL');
  });

  it('does not re-request finished chunks when only the summary failed, and keeps the stored summary', async () => {
    const state = createRunState();
    let fail = true;
    const fake = fakeClient({
      onSummarize: () => {
        if (fail) throw new AppError('upstream_error');
      },
    });
    const pdfjs = fakePdfJs([LONG, LONG]);
    await expect(run(pdfjs, fake, fakeRenderer(), { state })).rejects.toMatchObject({
      code: 'upstream_error',
    });
    fail = false;
    const retried = await run(pdfjs, fake, fakeRenderer(), { state });
    expect(fake.analyzeCalls).toHaveLength(2);
    expect(fake.summarizeCalls).toHaveLength(2);
    expect(insightOf(retried.outcome).summary).toBe('FINAL');
    const again = await run(pdfjs, fake, fakeRenderer(), { state });
    expect(fake.analyzeCalls).toHaveLength(2);
    expect(fake.summarizeCalls).toHaveLength(2);
    expect(insightOf(again.outcome).summary).toBe('FINAL');
  });
});

describe('abort and errors', () => {
  it('throws aborted without any request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeClient();
    await expect(
      run(fakePdfJs([SHORT]), fake, fakeRenderer(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fake.analyzeCalls).toHaveLength(0);
  });

  it('stops with aborted when the signal fires between chunks', async () => {
    const controller = new AbortController();
    const fake = fakeClient({ onAnalyze: () => controller.abort() });
    await expect(
      run(fakePdfJs([LONG, LONG, LONG]), fake, fakeRenderer(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fake.analyzeCalls).toHaveLength(1);
    expect(fake.summarizeCalls).toHaveLength(0);
  });

  it('lets a password PdfError through untouched', async () => {
    const error = Object.assign(new Error('pw'), { name: 'PasswordException' });
    const fake = fakeClient();
    await expect(run(failingPdfJs(error), fake)).rejects.toMatchObject({
      name: 'PdfError',
      code: 'password',
    });
    expect(fake.analyzeCalls).toHaveLength(0);
  });

  it('lets a corrupt PdfError through untouched', async () => {
    await expect(run(failingPdfJs(new Error('bad')), fakeClient())).rejects.toMatchObject({
      name: 'PdfError',
      code: 'corrupt',
    });
  });

  it('passes a client AppError through', async () => {
    const fake = fakeClient({
      onAnalyze: () => {
        throw new AppError('quota_exceeded');
      },
    });
    await expect(run(fakePdfJs([SHORT]), fake)).rejects.toMatchObject({ code: 'quota_exceeded' });
  });
});

describe('progress events', () => {
  it('emits loading, reading, analyzing and summarizing in order with a done counter', async () => {
    const { progress } = await run(fakePdfJs([LONG, LONG, LONG]), fakeClient());
    const firstIndex = (phase: Progress['phase']) => progress.findIndex((p) => p.phase === phase);
    expect(firstIndex('loading')).toBe(0);
    expect(firstIndex('loading')).toBeLessThan(firstIndex('reading'));
    expect(firstIndex('reading')).toBeLessThan(firstIndex('analyzing'));
    expect(firstIndex('analyzing')).toBeLessThan(firstIndex('summarizing'));
    const analyzing = progress.filter(
      (p): p is Extract<Progress, { phase: 'analyzing' }> => p.phase === 'analyzing',
    );
    expect(analyzing.every((p) => p.total === 3 && p.done >= 0 && p.done <= 3)).toBe(true);
    expect(analyzing.map((p) => p.done)).toEqual([...analyzing.map((p) => p.done)].sort((a, b) => a - b));
    expect(analyzing[analyzing.length - 1]?.done).toBe(3);
  });

  it('does not emit summarizing for a single chunk', async () => {
    const { progress } = await run(fakePdfJs([SHORT]), fakeClient());
    expect(progress.some((p) => p.phase === 'summarizing')).toBe(false);
  });
});
