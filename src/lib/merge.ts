import type { DocType, Insight } from './schema';

const MAX_KEY_POINTS = 7;
const MAX_KEYWORDS = 15;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

const uniqueStrings = (items: string[]) => unique(items.map((s) => s.trim()).filter(Boolean), norm);

function mostCommon<T extends string>(values: T[], skip?: T): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  for (const [value, count] of counts) {
    const bestCount = best === undefined ? 0 : (counts.get(best) ?? 0);
    const beatsOnTie = count === bestCount && best === skip && value !== skip;
    if (best === undefined || count > bestCount || beatsOnTie) best = value;
  }
  if (best === undefined) throw new Error('No values');
  return best;
}

/** Merges per-chunk results. Summary is a plain concatenation; the caller may reduce it. */
export function mergeInsights(parts: Insight[]): Insight {
  const first = parts[0];
  if (!first) throw new Error('Nothing to merge');

  return {
    ...first,
    document: {
      ...first.document,
      language: mostCommon(parts.map((p) => p.document.language)),
      type: mostCommon<DocType>(
        parts.map((p) => p.document.type),
        'inne',
      ),
      title: parts.find((p) => p.document.title)?.document.title ?? null,
      date: parts.find((p) => p.document.date)?.document.date ?? null,
    },
    summary: parts
      .map((p) => p.summary.trim())
      .filter(Boolean)
      .join(' '),
    keyPoints: uniqueStrings(parts.flatMap((p) => p.keyPoints)).slice(0, MAX_KEY_POINTS),
    entities: {
      organizations: uniqueStrings(parts.flatMap((p) => p.entities.organizations)),
      people: uniqueStrings(parts.flatMap((p) => p.entities.people)),
    },
    amounts: unique(
      parts.flatMap((p) => p.amounts),
      (a) => `${a.value}|${a.currency}|${norm(a.context)}`,
    ),
    dates: unique(
      parts.flatMap((p) => p.dates),
      (d) => `${d.date}|${norm(d.context)}`,
    ),
    keywords: uniqueStrings(parts.flatMap((p) => p.keywords)).slice(0, MAX_KEYWORDS),
  };
}
