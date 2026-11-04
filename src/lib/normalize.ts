const isGrouped = (groups: string[]): boolean =>
  groups.length > 1 &&
  /^\d{1,3}$/.test(groups[0] ?? '') &&
  groups.slice(1).every((g) => /^\d{3}$/.test(g));

/**
 * Parses an amount written in Polish, English or mixed notation. Returns null if it is ambiguous
 * or malformed: a wrong number is worse than a missing one. A single separator followed by exactly
 * three digits ("1.234", "1,234") could be a decimal or a thousands mark, so it is rejected.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');
  if (cleaned.slice(1).includes('-')) return null;

  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    const [whole = '', fraction = '', ...rest] = body.split(decimalSep);
    if (rest.length > 0 || !/^\d+$/.test(fraction)) return null;
    const groups = whole.split(thousandsSep);
    if (!isGrouped(groups)) return null;
    normalized = `${groups.join('')}.${fraction}`;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const groups = body.split(lastComma !== -1 ? ',' : '.');
    if (
      groups.some((g) => !/^\d*$/.test(g)) ||
      groups.some((g, i) => i < groups.length - 1 && g === '')
    )
      return null;
    if (groups.length === 2) {
      const [whole = '', fraction = ''] = groups;
      if (fraction === '') return null;
      if (fraction.length === 3 && whole !== '0' && whole.length <= 3) return null;
      normalized = `${whole || '0'}.${fraction}`;
    } else if (isGrouped(groups)) normalized = groups.join('');
    else return null;
  } else {
    normalized = body;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const CURRENCY_ALIASES: Record<string, string> = {
  zł: 'PLN',
  zl: 'PLN',
  złotych: 'PLN',
  złoty: 'PLN',
  zlotych: 'PLN',
  '€': 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  $: 'USD',
  '£': 'GBP',
  грн: 'UAH',
  '₴': 'UAH',
  kč: 'CZK',
};

function isKnownCurrency(code: string): boolean {
  try {
    return Intl.supportedValuesOf('currency').includes(code);
  } catch {
    return false;
  }
}

/** Maps a symbol, name or code to an ISO 4217 code, or null if unknown. */
export function normalizeCurrency(text: string): string | null {
  const key = text.trim().toLocaleLowerCase('pl');
  const alias = CURRENCY_ALIASES[key];
  if (alias) return alias;
  if (/^[a-z]{3}$/.test(key) && isKnownCurrency(key.toUpperCase())) return key.toUpperCase();
  return null;
}

const MONTHS: Record<string, number> = {
  // Polish (genitive and nominative)
  stycznia: 1,
  styczeń: 1,
  styczen: 1,
  lutego: 2,
  luty: 2,
  marca: 3,
  marzec: 3,
  kwietnia: 4,
  kwiecień: 4,
  kwiecien: 4,
  maja: 5,
  maj: 5,
  czerwca: 6,
  czerwiec: 6,
  lipca: 7,
  lipiec: 7,
  sierpnia: 8,
  sierpień: 8,
  sierpien: 8,
  września: 9,
  wrzesień: 9,
  wrzesnia: 9,
  października: 10,
  październik: 10,
  pazdziernika: 10,
  listopada: 11,
  listopad: 11,
  grudnia: 12,
  grudzień: 12,
  grudzien: 12,
  // English
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  // German (april, august, september, november are shared with English)
  januar: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  mai: 5,
  juni: 6,
  juli: 7,
  oktober: 10,
  dezember: 12,
};

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Parses a date written in common numeric or Polish/English/German textual forms to ISO 8601. */
export function normalizeDate(text: string): string | null {
  const s = text.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?: ?r\.?)?$/.exec(s);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\.? (\p{L}+) (\d{4})(?: ?r\.?)?$/u.exec(s);
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLocaleLowerCase('pl')];
    return month ? toIso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = /^(\p{L}+) (\d{1,2}),? (\d{4})$/u.exec(s);
  if (m) {
    const month = MONTHS[(m[1] ?? '').toLocaleLowerCase('pl')];
    return month ? toIso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}
