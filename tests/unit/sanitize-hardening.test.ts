import { sanitizeModelOutput } from '../../src/lib/sanitize';
import { parseInsight } from '../../src/lib/schema';

const meta = { fileName: 'a.pdf', totalPages: 3 };

const good = () => ({
  document: { language: 'pl', type: 'umowa', title: 'T', date: '2026-01-02' },
  summary: 'Ala ma kota.',
  keyPoints: ['a'],
  entities: { organizations: ['X'], people: ['Y'] },
  amounts: [{ value: 10, currency: 'PLN', context: 'c' }],
  dates: [{ date: '2026-01-02', context: 'c' }],
  keywords: ['k'],
});

const clean = (raw: unknown) => {
  const result = parseInsight(sanitizeModelOutput(raw, meta));
  if (!result.success) throw new Error(result.error);
  return result.data;
};

describe('sanitizeModelOutput allowlist', () => {
  it('drops keys the model invented at every level', () => {
    const raw = {
      ...good(),
      systemPrompt: 'leak',
      document: { ...good().document, secret: 1 },
      entities: { organizations: [], people: [], extra: ['x'] },
      amounts: [{ value: 1, currency: 'EUR', context: '', note: 'x' }],
      dates: [{ date: '2026-01-02', context: '', note: 'x' }],
    };
    const out = clean(raw) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ['amounts', 'dates', 'document', 'entities', 'keyPoints', 'keywords', 'summary'].sort(),
    );
    expect(Object.keys(out['document'] as object).sort()).toEqual(
      ['date', 'fileName', 'language', 'pages', 'title', 'type'].sort(),
    );
    expect(Object.keys(out['entities'] as object).sort()).toEqual(['organizations', 'people']);
    expect(Object.keys((out['amounts'] as object[])[0] as object).sort()).toEqual([
      'context',
      'currency',
      'value',
    ]);
  });

  it('does not let a __proto__ key through', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"constructor":1}') as object;
    const out = sanitizeModelOutput({ ...good(), ...raw }, meta) as Record<string, unknown>;
    expect(Object.hasOwn(out, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('truncates huge strings', () => {
    const big = 'x'.repeat(100_000);
    const out = clean({
      ...good(),
      summary: big,
      keyPoints: [big],
      keywords: [big],
      document: { ...good().document, title: big },
      amounts: [{ value: 1, currency: 'PLN', context: big }],
      dates: [{ date: '2026-01-02', context: big }],
      entities: { organizations: [big], people: [big] },
    });
    expect(out.summary.length).toBeLessThanOrEqual(2000);
    expect(out.keyPoints[0]?.length).toBeLessThanOrEqual(300);
    expect(out.keywords[0]?.length).toBeLessThanOrEqual(100);
    expect(out.document.title?.length).toBeLessThanOrEqual(300);
    expect(out.amounts[0]?.context.length).toBeLessThanOrEqual(300);
    expect(out.dates[0]?.context.length).toBeLessThanOrEqual(300);
    expect(out.entities.organizations[0]?.length).toBeLessThanOrEqual(200);
    expect(out.entities.people[0]?.length).toBeLessThanOrEqual(200);
  });

  it('caps list sizes', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `k${i}`);
    const out = clean({
      ...good(),
      keywords: many,
      entities: { organizations: many, people: many },
      amounts: many.map((_, i) => ({ value: i, currency: 'PLN', context: '' })),
      dates: many.map(() => ({ date: '2026-01-02', context: '' })),
    });
    expect(out.keywords.length).toBeLessThanOrEqual(15);
    expect(out.entities.organizations.length).toBeLessThanOrEqual(50);
    expect(out.entities.people.length).toBeLessThanOrEqual(50);
    expect(out.amounts.length).toBeLessThanOrEqual(100);
    expect(out.dates.length).toBeLessThanOrEqual(100);
  });

  it('drops amounts with an unreasonable magnitude', () => {
    const out = clean({
      ...good(),
      amounts: [
        { value: 1e300, currency: 'PLN', context: '' },
        { value: 5, currency: 'PLN', context: '' },
      ],
    });
    expect(out.amounts.map((a) => a.value)).toEqual([5]);
  });

  it('drops string amounts that are ambiguous', () => {
    const out = clean({
      ...good(),
      amounts: [{ value: '1.234', currency: 'PLN', context: '' }],
    });
    expect(out.amounts).toEqual([]);
  });
});

describe('sanitizeModelOutput fuzz', () => {
  // Small deterministic generator (mulberry32) so a failure is reproducible.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const KEYS = ['document', 'summary', 'keyPoints', 'entities', 'amounts', 'dates', 'keywords'];
  const make = (r: () => number, depth: number): unknown => {
    const pick = Math.floor(r() * (depth > 3 ? 6 : 9));
    switch (pick) {
      case 0:
        return null;
      case 1:
        return r() < 0.5;
      case 2:
        return (r() - 0.5) * 10 ** Math.floor(r() * 400 - 50);
      case 3:
        return ['', '1.234', '12 345,67', '2026-02-30', 'pl', 'PLN', '\u0000', '😀'.repeat(3)][
          Math.floor(r() * 8)
        ];
      case 4:
        return 'x'.repeat(Math.floor(r() * 3000));
      case 5:
        return undefined;
      case 6:
        return Array.from({ length: Math.floor(r() * 5) }, () => make(r, depth + 1));
      default: {
        const o: Record<string, unknown> = {};
        const n = Math.floor(r() * 6);
        for (let i = 0; i < n; i += 1) {
          const key = r() < 0.7 ? (KEYS[Math.floor(r() * KEYS.length)] as string) : `k${i}`;
          o[key] = make(r, depth + 1);
        }
        return o;
      }
    }
  };

  it('never throws and yields either a schema-valid object or a rejection', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const raw = make(rng(seed), 0);
      let result: ReturnType<typeof parseInsight> | undefined;
      expect(() => {
        result = parseInsight(sanitizeModelOutput(raw, meta));
      }, `seed ${seed}`).not.toThrow();
      expect(result).toBeDefined();
    }
  });
});
