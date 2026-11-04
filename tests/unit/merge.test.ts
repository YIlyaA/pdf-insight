import { mergeInsights } from '../../src/lib/merge';
import type { Insight } from '../../src/lib/schema';

const base = (over: Partial<Insight> = {}): Insight => ({
  document: {
    fileName: 'a.pdf',
    pages: 10,
    language: 'pl',
    type: 'umowa',
    title: null,
    date: null,
  },
  summary: 'Pierwsze zdanie. Drugie zdanie. Trzecie zdanie.',
  keyPoints: [],
  entities: { organizations: [], people: [] },
  amounts: [],
  dates: [],
  keywords: [],
  ...over,
});

describe('mergeInsights', () => {
  it('throws on empty input', () => {
    expect(() => mergeInsights([])).toThrow();
  });

  it('returns an equal result for a single part', () => {
    const one = base({ keywords: ['a'] });
    expect(mergeInsights([one])).toEqual(one);
  });

  it('takes the first non-null title and date', () => {
    const m = mergeInsights([
      base(),
      base({ document: { ...base().document, title: 'Tytuł', date: '2026-03-12' } }),
      base({ document: { ...base().document, title: 'Inny', date: '2027-01-01' } }),
    ]);
    expect(m.document.title).toBe('Tytuł');
    expect(m.document.date).toBe('2026-03-12');
  });

  it('chooses the most common type, preferring a specific one over "inne" on ties', () => {
    const t = (type: Insight['document']['type']) =>
      base({ document: { ...base().document, type } });
    expect(mergeInsights([t('faktura'), t('umowa'), t('umowa')]).document.type).toBe('umowa');
    expect(mergeInsights([t('inne'), t('raport')]).document.type).toBe('raport');
  });

  it('chooses the most common language', () => {
    const l = (language: string) => base({ document: { ...base().document, language } });
    expect(mergeInsights([l('en'), l('pl'), l('pl')]).document.language).toBe('pl');
  });

  it('deduplicates keywords, key points and entities case-insensitively and trims', () => {
    const m = mergeInsights([
      base({
        keywords: ['SLA', 'serwis'],
        keyPoints: ['Okres 12 mies.'],
        entities: { organizations: ['Kwadrat Software S.A.'], people: ['Anna Kowalczyk'] },
      }),
      base({
        keywords: ['sla ', 'CRM'],
        keyPoints: ['okres 12 mies.', 'Kary umowne'],
        entities: {
          organizations: ['kwadrat software s.a.'],
          people: ['Anna Kowalczyk', 'Marek Zieliński'],
        },
      }),
    ]);
    expect(m.keywords).toEqual(['SLA', 'serwis', 'CRM']);
    expect(m.keyPoints).toEqual(['Okres 12 mies.', 'Kary umowne']);
    expect(m.entities.organizations).toEqual(['Kwadrat Software S.A.']);
    expect(m.entities.people).toEqual(['Anna Kowalczyk', 'Marek Zieliński']);
  });

  it('deduplicates amounts by value, currency and context', () => {
    const a = { value: 12300, currency: 'PLN', context: 'abonament' };
    const m = mergeInsights([
      base({ amounts: [a] }),
      base({
        amounts: [
          { ...a, context: 'Abonament' },
          { ...a, currency: 'EUR' },
          { ...a, value: 1 },
        ],
      }),
    ]);
    expect(m.amounts).toHaveLength(3);
  });

  it('deduplicates dates by date and context', () => {
    const d = { date: '2026-10-12', context: 'go-live' };
    const m = mergeInsights([
      base({ dates: [d] }),
      base({ dates: [d, { ...d, context: 'inne' }] }),
    ]);
    expect(m.dates).toHaveLength(2);
  });

  it('caps key points at 7 and keywords at 15', () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const m = mergeInsights([
      base({ keyPoints: many(7, 'k'), keywords: many(10, 'w') }),
      base({ keyPoints: many(7, 'z'), keywords: many(10, 'v') }),
    ]);
    expect(m.keyPoints).toHaveLength(7);
    expect(m.keywords).toHaveLength(15);
  });

  it('takes key points and keywords from every part, not only the first', () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const parts = ['a', 'b', 'c', 'd'].map((p) =>
      base({ keyPoints: many(7, p), keywords: many(15, p) }),
    );
    const m = mergeInsights(parts);
    expect(m.keyPoints).toEqual(['a0', 'b0', 'c0', 'd0', 'a1', 'b1', 'c1']);
    expect(new Set(m.keywords.map((k) => k[0]))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('keeps fileName and pages from the first part', () => {
    const m = mergeInsights([
      base(),
      base({ document: { ...base().document, fileName: 'b.pdf', pages: 3 } }),
    ]);
    expect(m.document.fileName).toBe('a.pdf');
    expect(m.document.pages).toBe(10);
  });

  it('concatenates partial summaries so the caller can reduce them', () => {
    const m = mergeInsights([base({ summary: 'Część A.' }), base({ summary: 'Część B.' })]);
    expect(m.summary).toBe('Część A. Część B.');
  });
});
