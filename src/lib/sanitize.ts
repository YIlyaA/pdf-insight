import { normalizeCurrency, normalizeDate, parseAmount } from './normalize';
import { DOC_TYPES } from './schema';

export interface SanitizeMeta {
  fileName: string;
  totalPages: number;
}

const MAX_KEY_POINTS = 7;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/**
 * Cleans model output before schema validation: facts we already know come from the request,
 * formats are normalised, entries that cannot be normalised are dropped instead of failing everything.
 */
export function sanitizeModelOutput(raw: unknown, meta: SanitizeMeta): unknown {
  if (!isRecord(raw)) return raw;
  const out: Rec = { ...raw };

  if (isRecord(raw['document'])) {
    const doc: Rec = { ...raw['document'] };
    doc['fileName'] = meta.fileName;
    doc['pages'] = meta.totalPages;
    if (typeof doc['language'] === 'string') doc['language'] = doc['language'].trim().toLowerCase();
    if (typeof doc['type'] === 'string') {
      const type = doc['type'].trim().toLowerCase();
      doc['type'] = (DOC_TYPES as readonly string[]).includes(type) ? type : 'inne';
    }
    doc['date'] = typeof doc['date'] === 'string' ? normalizeDate(doc['date']) : null;
    if (typeof doc['title'] !== 'string') doc['title'] = null;
    out['document'] = doc;
  }

  out['keyPoints'] = strings(raw['keyPoints']).slice(0, MAX_KEY_POINTS);
  out['keywords'] = strings(raw['keywords']);
  const entities = isRecord(raw['entities']) ? raw['entities'] : {};
  out['entities'] = {
    ...entities,
    organizations: strings(entities['organizations']),
    people: strings(entities['people']),
  };

  out['amounts'] = (Array.isArray(raw['amounts']) ? raw['amounts'] : []).flatMap(
    (item: unknown) => {
      if (!isRecord(item)) return [];
      const value = typeof item['value'] === 'string' ? parseAmount(item['value']) : item['value'];
      const currency =
        typeof item['currency'] === 'string' ? normalizeCurrency(item['currency']) : null;
      if (typeof value !== 'number' || !Number.isFinite(value) || !currency) return [];
      return [
        {
          ...item,
          value,
          currency,
          context: typeof item['context'] === 'string' ? item['context'] : '',
        },
      ];
    },
  );

  out['dates'] = (Array.isArray(raw['dates']) ? raw['dates'] : []).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item['date'] !== 'string') return [];
    const date = normalizeDate(item['date']);
    if (!date) return [];
    return [{ ...item, date, context: typeof item['context'] === 'string' ? item['context'] : '' }];
  });

  return out;
}
