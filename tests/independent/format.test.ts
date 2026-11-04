// @vitest-environment node
import {
  coverageLabel,
  docTypeLabel,
  downloadFileName,
  formatAmount,
  formatDate,
  formatFileSize,
  languageName,
  pagesLabel,
} from '../../src/lib/format';

describe('docTypeLabel', () => {
  it.each(['faktura', 'umowa', 'oferta', 'raport', 'inne'] as const)('keeps %s', (type) => {
    expect(docTypeLabel(type)).toBe(type);
  });
});

describe('formatDate', () => {
  it('formats an ISO date in pl-PL', () => {
    expect(formatDate('2026-09-01')).toBe('1 września 2026');
  });
  it.each(['not-a-date', '', '31/12/2026'])('returns invalid input %j as is', (input) => {
    expect(formatDate(input)).toBe(input);
  });
});

describe('formatAmount', () => {
  it('formats a known currency in pl-PL', () => {
    const text = formatAmount(1234.5, 'PLN');
    expect(text).toMatch(/^1[\s  ]?234,50[\s ]*(zł|PLN)$/);
  });
  it('falls back to "1 234,50 XYZ" for an unknown currency code', () => {
    expect(formatAmount(1234.5, 'XYZ')).toMatch(/^1[\s  ]?234,50[\s ]XYZ$/);
  });
});

describe('languageName', () => {
  it('returns the Polish name of a language', () => {
    expect(languageName('en')).toBe('angielski');
  });
  it('returns the code for an unknown language', () => {
    expect(languageName('zz')).toBe('zz');
  });
});

describe('pagesLabel', () => {
  it.each([
    [1, '1 strona'],
    [2, '2 strony'],
    [4, '4 strony'],
    [5, '5 stron'],
    [12, '12 stron'],
    [22, '22 strony'],
    [0, '0 stron'],
  ])('pagesLabel(%i) = %s', (n, expected) => {
    expect(pagesLabel(n)).toBe(expected);
  });
});

describe('coverageLabel', () => {
  it('matches the spec example', () => {
    expect(coverageLabel(12, 40)).toBe('Przeanalizowano strony 1-12 z 40');
  });
});

describe('downloadFileName', () => {
  it.each([
    ['umowa.pdf', 'umowa.insight.json'],
    ['Faktura 2026.pdf', 'Faktura_2026.insight.json'],
    ['Zażółć gęślą.pdf', 'Zażółć_gęślą.insight.json'],
    ['Raport.PDF', 'Raport.insight.json'],
    ['a.b.pdf', 'a_b.insight.json'],
    ['x/y?z.pdf', 'x_y_z.insight.json'],
    ['keep-this_name.pdf', 'keep-this_name.insight.json'],
    ['bez rozszerzenia', 'bez_rozszerzenia.insight.json'],
    ['.pdf', 'wynik.insight.json'],
    ['', 'wynik.insight.json'],
  ])('downloadFileName(%j) = %s', (input, expected) => {
    expect(downloadFileName(input)).toBe(expected);
  });
});

describe('formatFileSize', () => {
  it('formats megabytes with a decimal comma', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
  it('formats kilobytes', () => {
    expect(formatFileSize(320 * 1024)).toBe('320 KB');
  });
});
