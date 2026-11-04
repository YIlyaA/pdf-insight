import { normalizeCurrency, normalizeDate, parseAmount } from '../../src/lib/normalize';

describe('parseAmount', () => {
  it.each([
    ['12 300,00', 12300],
    ['1 200 000,00', 1200000],
    ['12 300,00', 12300],
    ['12 300,00', 12300],
    ['2 150', 2150],
    ['12500.00', 12500],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['0,2', 0.2],
    ['-5,5', -5.5],
    ['890', 890],
    ['184 500,00 zł', 184500],
    ['250 000,00 PLN', 250000],
  ])('parses %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '--', '1,2,3,4x', 'zł'])('returns null for %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('normalizeCurrency', () => {
  it.each([
    ['zł', 'PLN'],
    ['zl', 'PLN'],
    ['PLN', 'PLN'],
    ['pln', 'PLN'],
    ['złotych', 'PLN'],
    ['€', 'EUR'],
    ['EUR', 'EUR'],
    ['euro', 'EUR'],
    ['$', 'USD'],
    ['USD', 'USD'],
    ['£', 'GBP'],
    ['грн', 'UAH'],
    ['UAH', 'UAH'],
    ['Kč', 'CZK'],
    ['CHF', 'CHF'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeCurrency(input)).toBe(expected);
  });

  it.each(['', 'XYZ', 'abcd', '%', 'punkty'])('returns null for %j', (input) => {
    expect(normalizeCurrency(input)).toBeNull();
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2026-05-07', '2026-05-07'],
    ['2026/05/07', '2026-05-07'],
    ['03.04.2026', '2026-04-03'],
    ['3.4.2026', '2026-04-03'],
    ['12.03.2026 r.', '2026-03-12'],
    ['15 stycznia 2026 r.', '2026-01-15'],
    ['1 kwietnia 2026', '2026-04-01'],
    ['31 marca 2028 r.', '2028-03-31'],
    ['12 października 2026', '2026-10-12'],
    ['1 April 2026', '2026-04-01'],
    ['April 1, 2026', '2026-04-01'],
    ['15. März 2026', '2026-03-15'],
    ['29.02.2028', '2028-02-29'],
  ])('parses %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it.each(['', 'wkrótce', '31.02.2026', '29.02.2026', '2026-13-01', '00.01.2026', '12 2026'])(
    'returns null for %j',
    (input) => {
      expect(normalizeDate(input)).toBeNull();
    },
  );
});
