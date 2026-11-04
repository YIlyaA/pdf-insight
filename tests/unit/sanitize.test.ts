import { sanitizeModelOutput } from '../../src/lib/sanitize';
import { parseInsight } from '../../src/lib/schema';

const meta = { fileName: 'real.pdf', totalPages: 7 };
const base = () => ({
  document: {
    fileName: 'model-invented.pdf',
    pages: 99,
    language: 'pl',
    type: 'umowa',
    title: 'T',
    date: '2026-03-12',
  },
  summary: 'Jedno. Dwa. Trzy.',
  keyPoints: ['a'],
  entities: { organizations: [], people: [] },
  amounts: [],
  dates: [],
  keywords: [],
});
const run = (over: Record<string, unknown> = {}) =>
  sanitizeModelOutput({ ...base(), ...over }, meta) as ReturnType<typeof base>;

describe('sanitizeModelOutput', () => {
  it('takes fileName and pages from the request, not from the model', () => {
    const out = run();
    expect(out.document.fileName).toBe('real.pdf');
    expect(out.document.pages).toBe(7);
  });

  it('normalises currencies and drops unknown ones', () => {
    const out = run({
      amounts: [
        { value: 1, currency: 'zł', context: 'a' },
        { value: 2, currency: '€', context: 'b' },
        { value: 3, currency: 'XYZ', context: 'c' },
      ],
    });
    expect(out.amounts.map((a: { currency: string }) => a.currency)).toEqual(['PLN', 'EUR']);
  });

  it('parses string amounts in Polish notation and drops unparseable ones', () => {
    const out = run({
      amounts: [
        { value: '12 300,00', currency: 'PLN', context: 'a' },
        { value: 'dużo', currency: 'PLN', context: 'b' },
        { value: null, currency: 'PLN', context: 'c' },
      ],
    });
    expect(out.amounts).toEqual([{ value: 12300, currency: 'PLN', context: 'a' }]);
  });

  it('normalises list dates and drops invalid ones', () => {
    const out = run({
      dates: [
        { date: '15 stycznia 2026 r.', context: 'a' },
        { date: 'wkrótce', context: 'b' },
        { date: '2026-10-12', context: 'c' },
      ],
    });
    expect(out.dates.map((d: { date: string }) => d.date)).toEqual(['2026-01-15', '2026-10-12']);
  });

  it('sets an unparseable document date to null instead of failing', () => {
    expect(run({ document: { ...base().document, date: 'niedawno' } }).document.date).toBeNull();
    expect(run({ document: { ...base().document, date: '12.03.2026' } }).document.date).toBe(
      '2026-03-12',
    );
  });

  it('maps an unknown document type to "inne" and lowercases known ones', () => {
    expect(run({ document: { ...base().document, type: 'contract' } }).document.type).toBe('inne');
    expect(run({ document: { ...base().document, type: 'Umowa' } }).document.type).toBe('umowa');
  });

  it('caps key points at 7', () => {
    const out = run({ keyPoints: Array.from({ length: 12 }, (_, i) => `p${i}`) });
    expect(out.keyPoints).toHaveLength(7);
  });

  it('fills missing list fields with empty lists ("no information = []")', () => {
    const raw = base() as Record<string, unknown>;
    delete raw['keywords'];
    delete raw['amounts'];
    delete raw['dates'];
    raw['entities'] = {};
    const out = sanitizeModelOutput(raw, meta) as ReturnType<typeof base>;
    expect(out.keywords).toEqual([]);
    expect(out.amounts).toEqual([]);
    expect(out.dates).toEqual([]);
    expect(out.entities).toEqual({ organizations: [], people: [] });
  });

  it('lowercases the language code', () => {
    expect(run({ document: { ...base().document, language: 'PL' } }).document.language).toBe('pl');
  });

  it('drops fields the model added: output is an allowlist (see sanitize-hardening tests)', () => {
    expect((run({ extra: 5 }) as unknown as Record<string, unknown>)['extra']).toBeUndefined();
  });

  it('passes non-objects through so that validation reports them', () => {
    expect(sanitizeModelOutput('text', meta)).toBe('text');
    expect(sanitizeModelOutput(null, meta)).toBeNull();
    expect(sanitizeModelOutput([], meta)).toEqual([]);
  });

  it('produces output that passes the schema', () => {
    expect(parseInsight(run()).success).toBe(true);
  });
});
