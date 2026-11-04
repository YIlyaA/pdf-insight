// @vitest-environment node
import { formatAmount, formatDate, formatInsightText } from '../../src/lib/format';
import { makeInsight } from './helpers';

const doc = (over: Record<string, unknown>) => ({
  fileName: 'plik.pdf',
  pages: 2,
  language: 'en',
  type: 'raport',
  title: 'Quarterly report',
  date: '2026-09-01',
  ...over,
});

describe('formatInsightText', () => {
  it('renders the full insight in the specified layout', () => {
    const insight = makeInsight({
      document: doc({}) as never,
      summary: 'The company grew.',
      keyPoints: ['Revenue up', 'Costs down'],
      entities: { organizations: ['Acme', 'Beta'], people: ['Jane', 'John'] },
      amounts: [{ value: 1234.5, currency: 'PLN', context: 'Total revenue' }],
      dates: [{ date: '2026-09-30', context: 'Quarter end' }],
      keywords: ['growth', 'revenue'],
    });
    const expected = [
      'Quarterly report',
      `raport · angielski · 2 strony · ${formatDate('2026-09-01')}`,
      '',
      'Podsumowanie',
      'The company grew.',
      '',
      'Najważniejsze punkty',
      '- Revenue up',
      '- Costs down',
      '',
      'Podmioty',
      'Organizacje: Acme, Beta',
      'Osoby: Jane, John',
      '',
      'Kwoty',
      `- ${formatAmount(1234.5, 'PLN')} — Total revenue`,
      '',
      'Daty',
      `- ${formatDate('2026-09-30')} — Quarter end`,
      '',
      'Słowa kluczowe: growth, revenue',
    ].join('\n');
    expect(formatInsightText(insight)).toBe(expected);
  });

  it('falls back to the file name when the title is null', () => {
    const text = formatInsightText(makeInsight({ document: doc({ title: null }) as never }));
    expect(text.split('\n')[0]).toBe('plik.pdf');
  });

  it('leaves out a null date from the facts line', () => {
    const text = formatInsightText(makeInsight({ document: doc({ date: null }) as never }));
    expect(text.split('\n')[1]).toBe('raport · angielski · 2 strony');
  });

  it('omits sections with no data and never prints "Brak danych"', () => {
    const text = formatInsightText(
      makeInsight({
        keyPoints: [],
        entities: { organizations: [], people: [] },
        amounts: [],
        dates: [],
        keywords: [],
      }),
    );
    for (const label of ['Najważniejsze punkty', 'Podmioty', 'Kwoty', 'Daty', 'Słowa kluczowe']) {
      expect(text).not.toContain(label);
    }
    expect(text).not.toContain('Brak danych');
    expect(text).toContain('Podsumowanie\nKrótkie podsumowanie.');
  });

  it('omits only the empty entity line', () => {
    const text = formatInsightText(
      makeInsight({ entities: { organizations: ['Acme'], people: [] } }),
    );
    expect(text).toContain('Podmioty\nOrganizacje: Acme');
    expect(text).not.toContain('Osoby');
  });

  it('has no trailing newline and no triple newlines', () => {
    const text = formatInsightText(makeInsight());
    expect(text.endsWith('\n')).toBe(false);
    expect(text).not.toContain('\n\n\n');
  });

  it('keeps markup in model text literal', () => {
    const text = formatInsightText(makeInsight({ summary: '<b>x</b>' }));
    expect(text).toContain('Podsumowanie\n<b>x</b>');
  });
});
