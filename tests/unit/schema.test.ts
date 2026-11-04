import { InsightSchema, extractJson, parseInsight } from '../../src/lib/schema';

const valid = {
  document: {
    fileName: 'umowa.pdf',
    pages: 4,
    language: 'pl',
    type: 'umowa',
    title: 'Umowa serwisowa',
    date: '2026-09-01',
  },
  summary: 'Umowa określa zasady serwisu. Obowiązuje 12 miesięcy. Płatność w 14 dni.',
  keyPoints: ['Okres umowy 12 mies.'],
  entities: { organizations: ['Przykład sp. z o.o.'], people: [] },
  amounts: [{ value: 12500, currency: 'PLN', context: 'wynagrodzenie' }],
  dates: [{ date: '2026-10-01', context: 'termin płatności' }],
  keywords: ['serwis', 'SLA'],
};

describe('InsightSchema', () => {
  it('accepts the example from the brief', () => {
    expect(parseInsight(valid).success).toBe(true);
  });

  it('accepts null date, empty lists and null title', () => {
    const r = parseInsight({
      ...valid,
      document: { ...valid.document, date: null, title: null },
      keyPoints: [],
      amounts: [],
      dates: [],
      keywords: [],
      entities: { organizations: [], people: [] },
    });
    expect(r.success).toBe(true);
  });

  it('keeps extra fields (brief: fields may be added, not removed)', () => {
    const r = parseInsight({ ...valid, extra: 1 });
    expect(r.success && (r.data as Record<string, unknown>)['extra']).toBe(1);
  });

  it.each([
    ['unknown type', { ...valid, document: { ...valid.document, type: 'pismo' } }],
    ['bad date format', { ...valid, document: { ...valid.document, date: '01.09.2026' } }],
    ['impossible date', { ...valid, document: { ...valid.document, date: '2026-02-31' } }],
    ['language not ISO 639-1', { ...valid, document: { ...valid.document, language: 'polish' } }],
    ['zero pages', { ...valid, document: { ...valid.document, pages: 0 } }],
    ['fractional pages', { ...valid, document: { ...valid.document, pages: 1.5 } }],
    ['empty summary', { ...valid, summary: '   ' }],
    [
      'more than 7 key points',
      { ...valid, keyPoints: Array.from({ length: 8 }, (_, i) => `p${i}`) },
    ],
    [
      'amount as string',
      { ...valid, amounts: [{ value: '12500', currency: 'PLN', context: 'x' }] },
    ],
    ['amount NaN', { ...valid, amounts: [{ value: NaN, currency: 'PLN', context: 'x' }] }],
    [
      'amount Infinity',
      { ...valid, amounts: [{ value: Infinity, currency: 'PLN', context: 'x' }] },
    ],
    ['currency symbol', { ...valid, amounts: [{ value: 1, currency: 'zł', context: 'x' }] }],
    ['lowercase currency', { ...valid, amounts: [{ value: 1, currency: 'pln', context: 'x' }] }],
    ['date in list not ISO', { ...valid, dates: [{ date: '2026-10', context: 'x' }] }],
    ['missing entities', { ...valid, entities: undefined }],
    ['missing document', { ...valid, document: undefined }],
    ['null input', null],
    ['array input', []],
    ['string input', 'text'],
  ])('rejects %s', (_name, input) => {
    expect(parseInsight(input).success).toBe(false);
  });

  it('reports a readable error message', () => {
    const r = parseInsight({ ...valid, summary: '' });
    expect(!r.success && r.error.length).toBeGreaterThan(0);
  });

  it('exposes the zod schema', () => {
    expect(InsightSchema.safeParse(valid).success).toBe(true);
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips a markdown json fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('strips a bare fence', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('finds the object inside surrounding prose', () => {
    expect(extractJson('Here you go: {"a":{"b":2}} Hope it helps')).toEqual({ a: { b: 2 } });
  });
  it('handles braces inside strings', () => {
    expect(extractJson('{"a":"x } y"}')).toEqual({ a: 'x } y' });
  });
  it('returns undefined for garbage, empty and truncated JSON', () => {
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
    expect(extractJson('{"a":')).toBeUndefined();
  });
});
