import { normalizeCurrency, normalizeDate, parseAmount } from './normalize';
import { DOC_TYPES } from './schema';

export interface SanitizeMeta {
  fileName: string;
  totalPages: number;
}

/** Caps for untrusted model output: anything longer or longer-listed is cut, never passed on. */
export const LIMITS = {
  summary: 2000,
  title: 300,
  keyPoint: 300,
  keyPoints: 7,
  keyword: 100,
  keywords: 15,
  entity: 200,
  entities: 50,
  context: 300,
  amounts: 100,
  dates: 100,
  maxAmount: 1e15,
} as const;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const cut = (s: string, max: number): string => s.slice(0, max);

const strings = (v: unknown, maxItems: number, maxLength: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string')
        .map((s) => cut(s.trim(), maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

const context = (v: unknown): string => (typeof v === 'string' ? cut(v, LIMITS.context) : '');

/**
 * Cleans model output before schema validation. Only known keys are copied (the model may not
 * add fields), facts we already know come from the request, formats are normalised, and entries
 * that cannot be normalised are dropped instead of failing everything.
 */
export function sanitizeModelOutput(raw: unknown, meta: SanitizeMeta): unknown {
  if (!isRecord(raw)) return raw;
  const out: Rec = {};

  if (isRecord(raw['document'])) {
    const source = raw['document'];
    const type = typeof source['type'] === 'string' ? source['type'].trim().toLowerCase() : '';
    out['document'] = {
      fileName: meta.fileName,
      pages: meta.totalPages,
      language:
        typeof source['language'] === 'string'
          ? source['language'].trim().toLowerCase()
          : source['language'],
      type: (DOC_TYPES as readonly string[]).includes(type) ? type : 'inne',
      title: typeof source['title'] === 'string' ? cut(source['title'], LIMITS.title) : null,
      date: typeof source['date'] === 'string' ? normalizeDate(source['date']) : null,
    };
  }

  if (typeof raw['summary'] === 'string')
    out['summary'] = cut(raw['summary'].trim(), LIMITS.summary);

  const entities = isRecord(raw['entities']) ? raw['entities'] : {};
  out['keyPoints'] = strings(raw['keyPoints'], LIMITS.keyPoints, LIMITS.keyPoint);
  out['keywords'] = strings(raw['keywords'], LIMITS.keywords, LIMITS.keyword);
  out['entities'] = {
    organizations: strings(entities['organizations'], LIMITS.entities, LIMITS.entity),
    people: strings(entities['people'], LIMITS.entities, LIMITS.entity),
  };

  const amounts: Rec[] = [];
  for (const item of Array.isArray(raw['amounts']) ? raw['amounts'] : []) {
    if (amounts.length >= LIMITS.amounts) break;
    if (!isRecord(item)) continue;
    const value = typeof item['value'] === 'string' ? parseAmount(item['value']) : item['value'];
    const currency =
      typeof item['currency'] === 'string' ? normalizeCurrency(item['currency']) : null;
    if (typeof value !== 'number' || !Number.isFinite(value) || !currency) continue;
    if (Math.abs(value) > LIMITS.maxAmount) continue;
    amounts.push({ value, currency, context: context(item['context']) });
  }
  out['amounts'] = amounts;

  const dates: Rec[] = [];
  for (const item of Array.isArray(raw['dates']) ? raw['dates'] : []) {
    if (dates.length >= LIMITS.dates) break;
    if (!isRecord(item) || typeof item['date'] !== 'string') continue;
    const date = normalizeDate(item['date']);
    if (date) dates.push({ date, context: context(item['context']) });
  }
  out['dates'] = dates;

  return out;
}
