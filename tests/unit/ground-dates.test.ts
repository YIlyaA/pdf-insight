// @vitest-environment node
import type { WorkerClient } from '../../src/api/client';
import { groundDates } from '../../src/lib/groundDates';
import type { PdfJsLike } from '../../src/lib/pdfText';
import { createRunState, runPipeline } from '../../src/lib/pipeline';
import type { PageRenderer } from '../../src/lib/renderPages';
import { makeInsight } from '../independent/helpers';

const withDates = (dates: string[], documentDate: string | null = null) => {
  const base = makeInsight();
  return makeInsight({
    document: { ...base.document, date: documentDate },
    dates: dates.map((date) => ({ date, context: 'x' })),
  });
};
const kept = (dates: string[], text: string, documentDate: string | null = null) =>
  groundDates(withDates(dates, documentDate), text).dates.map((d) => d.date);

describe('groundDates', () => {
  it('keeps dates written in full in the common formats', () => {
    const text = [
      'zawarta w dniu 12.03.2026 r.',
      'Termin: 15 stycznia 2026 r.',
      'Issued March 7, 2027.',
      'Fällig am 2026-05-07.',
      '1 kwietnia 2027 r.',
    ].join('\n');
    expect(
      kept(['2026-03-12', '2026-01-15', '2027-03-07', '2026-05-07', '2027-04-01'], text),
    ).toEqual(['2026-03-12', '2026-01-15', '2027-03-07', '2026-05-07', '2027-04-01']);
  });

  it('drops a date whose day is not in the text (month and year only)', () => {
    expect(kept(['2024-03-01'], 'Form W-9 (Rev. March 2024)\nCat. No. 10231X')).toEqual([]);
  });

  it('does not take a day from the end of a longer number cut by the search window', () => {
    const text = 'Cat. No. 10231X Form W-9 (Rev. 3-2024)\nForm W-9 (Rev. 3-2024) Page 2';
    expect(kept(['2024-03-01'], text)).toEqual([]);
  });

  it('keeps a day written before the longest Polish month name', () => {
    expect(kept(['2026-10-12'], 'Go-live: 12 października 2026 r.')).toEqual(['2026-10-12']);
  });

  it('drops a date that comes from a lone year', () => {
    const text = 'accounts opened before 1984 and broker accounts active during 1983.';
    expect(kept(['1984-01-01', '1983-01-01'], text)).toEqual([]);
  });

  it('drops a date whose year does not appear at all', () => {
    expect(kept(['2030-05-05'], 'termin 5 maja 2026')).toEqual([]);
  });

  it('accepts a day split from its month across a line break', () => {
    expect(kept(['2026-03-20'], 'w dniu 20\nmarca 2026 r.')).toEqual(['2026-03-20']);
  });

  it('clears the document date the same way', () => {
    const grounded = groundDates(withDates([], '2024-03-01'), 'Rev. March 2024');
    expect(grounded.document.date).toBeNull();
    const ok = groundDates(withDates([], '2026-03-12'), 'Umowa z dnia 12 marca 2026');
    expect(ok.document.date).toBe('2026-03-12');
  });

  it('does not change amounts or other fields', () => {
    const insight = withDates(['2024-03-01']);
    const grounded = groundDates(insight, 'Rev. March 2024');
    expect(grounded.amounts).toEqual(insight.amounts);
    expect(grounded.summary).toBe(insight.summary);
  });
});

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
const run = (pages: string[], insight: ReturnType<typeof withDates>) => {
  const client: WorkerClient = { analyze: async () => insight, summarize: async () => 'S' };
  return runPipeline(
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf'),
    { pdfjs: pdfjsOf(pages), openRenderer: async () => renderer, client },
    {
      signal: new AbortController().signal,
      state: createRunState(),
      onProgress: () => undefined,
      onRateLimitWait: () => undefined,
    },
  );
};

describe('pipeline date grounding', () => {
  it('removes an invented date from a text chunk', async () => {
    const outcome = await run(
      ['Dokument obowiązuje od marca 2026. Strona z wystarczającą ilością tekstu do analizy.'],
      withDates(['2026-03-01'], '2026-03-01'),
    );
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.insight.dates).toEqual([]);
    expect(outcome.insight.document.date).toBeNull();
  });

  it('leaves dates from scanned pages alone: the text layer cannot confirm them', async () => {
    const outcome = await run(['', ''], withDates(['2026-03-01']));
    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.insight.dates.map((d) => d.date)).toEqual(['2026-03-01']);
  });
});
