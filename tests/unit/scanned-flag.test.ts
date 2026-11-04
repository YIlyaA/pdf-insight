// @vitest-environment node
import type { WorkerClient } from '../../src/api/client';
import type { PdfJsLike } from '../../src/lib/pdfText';
import { createRunState, runPipeline } from '../../src/lib/pipeline';
import type { PageRenderer } from '../../src/lib/renderPages';
import { makeInsight } from '../independent/helpers';

const pdfjsOf = (pages: string[]): PdfJsLike => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: [{ str: pages[n - 1] ?? '', hasEOL: false }] }),
      }),
    }),
    destroy: async () => undefined,
  }),
});
const renderer: PageRenderer = {
  render: async (page) => ({ page, mimeType: 'image/jpeg', dataBase64: '/9j/4AAQ', blank: false }),
  destroy: async () => undefined,
};
const client: WorkerClient = {
  analyze: async () => makeInsight(),
  summarize: async () => 'FINAL',
};
const run = (pages: string[]) =>
  runPipeline(
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf'),
    { pdfjs: pdfjsOf(pages), openRenderer: async () => renderer, client },
    {
      signal: new AbortController().signal,
      state: createRunState(),
      onProgress: () => undefined,
      onRateLimitWait: () => undefined,
    },
  );

describe('Outcome.scanned', () => {
  it('is true when a scan page was sent', async () => {
    const outcome = await run(['', '']);
    expect(outcome).toMatchObject({ kind: 'result', scanned: true });
  });

  it('is absent for a text-only document', async () => {
    const outcome = await run(['To jest strona z wystarczającą ilością tekstu do analizy.']);
    expect(outcome.kind).toBe('result');
    expect('scanned' in outcome).toBe(false);
  });
});
