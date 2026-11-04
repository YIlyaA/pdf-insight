import type { DocType, Insight } from './schema';

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

// pl-PL leaves 4-digit numbers ungrouped ("1234,50"); 'always' gives "1 234,50" so amounts line up.
const plainAmount = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
});

/** Currency amount in pl-PL with thousands always grouped; an unknown code falls back to "1 234,50 XYZ". */
export function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      useGrouping: 'always',
    }).format(value);
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

const NBSP = '\u00a0';

/**
 * Display only: keeps "184 500,00 PLN", "nr 14/2026" and "2026 r." on one line.
 * The data itself is never changed; copy and download use the original text.
 */
export function keepNumbersTogether(text: string): string {
  return text
    .replace(/(?<!\d)\d{1,3}(?: \d{3})+(?!\d)/g, (group) => group.replaceAll(' ', NBSP))
    .replace(/(\d) (PLN|EUR|USD|GBP|CHF|zł)(?![\p{L}\d])/gu, `$1${NBSP}$2`)
    .replace(/\b(nr|Nr|NR) (?=\d)/g, `$1${NBSP}`)
    .replace(/(\d{4}) r\./g, `$1${NBSP}r.`);
}

const TEXT_LABELS = {
  summary: 'Podsumowanie',
  keyPoints: 'Najważniejsze punkty',
  entities: 'Podmioty',
  organizations: 'Organizacje',
  people: 'Osoby',
  amounts: 'Kwoty',
  dates: 'Daty',
  keywords: 'Słowa kluczowe',
} as const;

/** "type · language · pages · date" for the result header and the copied text; null parts are left out. */
export function factParts(document: Insight['document']): string[] {
  const parts = [
    docTypeLabel(document.type),
    languageName(document.language),
    pagesLabel(document.pages),
    document.date ? formatDate(document.date) : null,
  ];
  return parts.filter((part): part is string => Boolean(part));
}

function withContext(value: string, context: string): string {
  return context ? `- ${value} — ${context}` : `- ${value}`;
}

/**
 * Plain-text version of an insight for "Kopiuj tekst": no HTML, no Markdown links, empty sections
 * omitted, one blank line between sections, no trailing newline.
 */
export function formatInsightText(insight: Insight): string {
  const { document, entities } = insight;
  const blocks: string[][] = [
    [document.title ?? document.fileName, factParts(document).join(' · ')],
    [TEXT_LABELS.summary, insight.summary],
  ];
  if (insight.keyPoints.length > 0) {
    blocks.push([TEXT_LABELS.keyPoints, ...insight.keyPoints.map((point) => `- ${point}`)]);
  }
  const entityLines = [
    entities.organizations.length > 0
      ? `${TEXT_LABELS.organizations}: ${entities.organizations.join(', ')}`
      : null,
    entities.people.length > 0 ? `${TEXT_LABELS.people}: ${entities.people.join(', ')}` : null,
  ].filter((line): line is string => line !== null);
  if (entityLines.length > 0) blocks.push([TEXT_LABELS.entities, ...entityLines]);
  if (insight.amounts.length > 0) {
    blocks.push([
      TEXT_LABELS.amounts,
      ...insight.amounts.map((a) => withContext(formatAmount(a.value, a.currency), a.context)),
    ]);
  }
  if (insight.dates.length > 0) {
    blocks.push([
      TEXT_LABELS.dates,
      ...insight.dates.map((d) => withContext(formatDate(d.date), d.context)),
    ]);
  }
  if (insight.keywords.length > 0) {
    blocks.push([`${TEXT_LABELS.keywords}: ${insight.keywords.join(', ')}`]);
  }
  return blocks.map((lines) => lines.join('\n')).join('\n\n');
}
