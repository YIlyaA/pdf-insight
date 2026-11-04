import type { DocType } from './schema';

const LOCALE = 'pl-PL';

const DOC_TYPE_LABELS: Record<DocType, string> = {
  faktura: 'faktura',
  umowa: 'umowa',
  oferta: 'oferta',
  raport: 'raport',
  inne: 'inne',
};

export function docTypeLabel(type: DocType): string {
  return DOC_TYPE_LABELS[type];
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-09-01" -> "1 września 2026"; anything that is not a real ISO date is returned as is. */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return iso;
  return dateFormat.format(date);
}

const plainAmount = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Currency amount in pl-PL; a code Intl rejects falls back to "1234,50 XYZ". */
export function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(value);
  } catch {
    return `${plainAmount.format(value)} ${currency}`;
  }
}

/** Polish name of an ISO 639-1 code ("en" -> "angielski"); unknown codes are returned as is. */
export function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(LOCALE, { type: 'language', fallback: 'none' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

const pluralRules = new Intl.PluralRules(LOCALE);

/** "strona" / "strony" / "stron" for a count. */
function pageWord(n: number): string {
  const category = pluralRules.select(n);
  if (category === 'one') return 'strona';
  if (category === 'few' || category === 'other') return 'strony';
  return 'stron';
}

/** "1 strona", "3 strony", "5 stron". */
export function pagesLabel(n: number): string {
  return `${n} ${pageWord(n)}`;
}

/** "Przeanalizowano strony 1-12 z 40". */
export function coverageLabel(analyzedTo: number, total: number): string {
  if (analyzedTo <= 1) return `Przeanalizowano stronę 1 z ${total}`;
  return `Przeanalizowano strony 1-${analyzedTo} z ${total}`;
}

/** Spec section 9: name without ".pdf", characters other than letters, digits, "-" and "_" -> "_". */
export function downloadFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}_-]/gu, '_');
  return `${base || 'wynik'}.insight.json`;
}

const sizeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const KB = 1024;
const MB = KB * KB;

/** "1,5 MB", "320 KB", "900 B". */
export function formatFileSize(bytes: number): string {
  if (bytes >= MB) return `${sizeFormat.format(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}
