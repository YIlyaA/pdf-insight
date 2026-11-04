// @vitest-environment node
import type { WorkerClient } from '../../src/api/client';
import type { PdfJsLike } from '../../src/lib/pdfText';
import { MAX_REQUESTS_PER_RUN, createRunState, runPipeline } from '../../src/lib/pipeline';
import type { PageRenderer } from '../../src/lib/renderPages';
import { makeInsight } from '../independent/helpers';

const PAGES = 300;

const scanOnlyPdfJs: PdfJsLike = {
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: PAGES,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: '', hasEOL: false }] }),
      }),
    }),
    destroy: async () => undefined,
  }),
};

describe('scan documents longer than the request cap', () => {
  it('renders only as many pages as the cap can ever send, and reports partial coverage', async () => {
    const rendered: number[] = [];
    const renderer: PageRenderer = {
      render: async (page) => {
        rendered.push(page);
        return { page, mimeType: 'image/jpeg', dataBase64: '/9j/4AAQ', blank: false };
      },
      destroy: async () => undefined,
    };
    let analyzeCalls = 0;
    const client: WorkerClient = {
      analyze: async (request) => {
        analyzeCalls += 1;
        const base = makeInsight();
        return { ...base, summary: `s${request.chunk.index}` };
      },
      summarize: async () => 'FINAL',
    };

    const outcome = await runPipeline(
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'scan.pdf'),
      { pdfjs: scanOnlyPdfJs, openRenderer: async () => renderer, client },
      {
        signal: new AbortController().signal,
        state: createRunState(),
        onProgress: () => undefined,
        onRateLimitWait: () => undefined,
      },
    );

    expect(rendered.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_RUN * 8);
    expect(analyzeCalls).toBe(MAX_REQUESTS_PER_RUN - 1);
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.coverage).not.toBeNull();
    expect(outcome.coverage?.totalPages).toBe(PAGES);
  });
});
