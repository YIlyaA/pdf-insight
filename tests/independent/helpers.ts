import { InsightSchema, type Insight } from '../../src/lib/schema';

/** Builds a valid Insight (validated by the real schema). */
export function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return InsightSchema.parse({
    document: {
      fileName: 'doc.pdf',
      pages: 1,
      language: 'pl',
      type: 'umowa',
      title: 'Tytuł',
      date: '2026-09-01',
    },
    summary: 'Krótkie podsumowanie.',
    keyPoints: ['punkt 1'],
    entities: { organizations: ['Acme'], people: ['Jan Nowak'] },
    amounts: [{ value: 100, currency: 'PLN', context: 'opłata' }],
    dates: [{ date: '2026-09-01', context: 'start' }],
    keywords: ['umowa'],
    ...overrides,
  });
}
