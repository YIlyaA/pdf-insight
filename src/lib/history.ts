import { InsightSchema, type Insight } from './schema';

export const HISTORY_MAX_ENTRIES = 10;
export const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const HISTORY_KEY = 'pdf-insight.history.v1';

export interface HistoryEntry {
  id: string;
  fileName: string;
  savedAt: number;
  insight: Insight;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Returns a valid entry or null for anything malformed. */
function toEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, fileName, savedAt, insight } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof fileName !== 'string') return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
  const parsed = InsightSchema.safeParse(insight);
  return parsed.success ? { id, fileName, savedAt, insight: parsed.data } : null;
}

/** Not older than the TTL and not from the future (a moved clock would keep it forever). */
const isFresh = (entry: HistoryEntry, now: number) =>
  entry.savedAt <= now && now - entry.savedAt <= HISTORY_TTL_MS;

function readRaw(storage: StorageLike): unknown {
  try {
    const text = storage.getItem(HISTORY_KEY);
    return text === null ? [] : JSON.parse(text);
  } catch {
    return [];
  }
}

function write(storage: StorageLike | null, entries: HistoryEntry[]): void {
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Quota or disabled storage: the in-memory list still works for this session.
  }
}

/** Newest first. Drops expired, corrupt (InsightSchema fails) and malformed entries. Never throws; null storage -> []. */
export function loadHistory(storage: StorageLike | null, now: number): HistoryEntry[] {
  if (!storage) return [];
  const raw = readRaw(storage);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map(toEntry)
    .filter((entry): entry is HistoryEntry => entry !== null && isFresh(entry, now))
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)))
    .slice(0, HISTORY_MAX_ENTRIES);
}

/** Reads, adds the entry on top (same id replaced), trims to 10, writes. Returns the new list. Never throws (quota/disabled -> returns the in-memory list). */
export function addHistoryEntry(
  storage: StorageLike | null,
  entry: HistoryEntry,
  now: number,
): HistoryEntry[] {
  const rest = loadHistory(storage, now).filter((e) => e.id !== entry.id);
  const list = [entry, ...rest].slice(0, HISTORY_MAX_ENTRIES);
  write(storage, list);
  return list;
}

export function removeHistoryEntry(
  storage: StorageLike | null,
  id: string,
  now: number,
): HistoryEntry[] {
  const list = loadHistory(storage, now).filter((e) => e.id !== id);
  write(storage, list);
  return list;
}

export function clearHistory(storage: StorageLike | null): void {
  try {
    storage?.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
