import { render, screen } from '@testing-library/react';
import { App } from '../../src/App';
import { sanitizeModelOutput } from '../../src/lib/sanitize';
import { parseInsight } from '../../src/lib/schema';
import { SYSTEM_PROMPT } from '../../worker/src/prompt';
import { baseServices, makeInsight, pdfFile, pick } from '../independent/ui-helpers';

const NOTE = 'Część treści odczytano ze skanu. Sprawdź nazwy i kwoty.';

describe('note for results read from scans', () => {
  it('is shown when the run used scanned pages', async () => {
    const { container } = render(
      <App
        services={baseServices({
          analyze: async () => ({
            kind: 'result',
            insight: makeInsight(),
            coverage: null,
            scanned: true,
          }),
        })}
      />,
    );
    pick(container, pdfFile());
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
  });

  it('is not shown for a text-only document', async () => {
    const { container } = render(
      <App
        services={baseServices({
          analyze: async () => ({ kind: 'result', insight: makeInsight(), coverage: null }),
        })}
      />,
    );
    pick(container, pdfFile());
    await screen.findByRole('tab', { name: 'JSON' });
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('list sizes from one model answer', () => {
  it('keeps at most 15 amounts and 15 dates', () => {
    const many = Array.from({ length: 60 }, (_, i) => i);
    const raw = {
      document: { language: 'pl', type: 'umowa', title: 'T', date: null },
      summary: 'Ala ma kota.',
      keyPoints: ['a'],
      entities: { organizations: [], people: [] },
      amounts: many.map((i) => ({ value: i + 1, currency: 'PLN', context: `c${i}` })),
      dates: many.map((i) => ({
        date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        context: `d${i}`,
      })),
      keywords: ['k'],
    };
    const parsed = parseInsight(sanitizeModelOutput(raw, { fileName: 'a.pdf', totalPages: 1 }));
    if (!parsed.success) throw new Error(parsed.error);
    expect(parsed.data.amounts.length).toBeLessThanOrEqual(15);
    expect(parsed.data.dates.length).toBeLessThanOrEqual(15);
  });
});

describe('prompt: noise amounts', () => {
  it('tells the model to skip share capital and publishing fees', () => {
    expect(SYSTEM_PROMPT).toMatch(/share capital/i);
    expect(SYSTEM_PROMPT).toMatch(/copyright|page fee|publication fee/i);
  });
});
