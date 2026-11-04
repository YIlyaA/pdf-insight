// @vitest-environment node
import {
  HISTORY_KEY,
  HISTORY_MAX_ENTRIES,
  HISTORY_TTL_MS,
  addHistoryEntry,
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  type HistoryEntry,
  type StorageLike,
} from '../../src/lib/history';
import { makeInsight } from './helpers';

const NOW = 1_800_000_000_000;

const entry = (id: string, savedAt: number, fileName = `${id}.pdf`): HistoryEntry => ({
  id,
  fileName,
  savedAt,
  insight: makeInsight(),
});

function memoryStorage(initial?: unknown): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) {
    data.set(HISTORY_KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
  }
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const stored = (s: { data: Map<string, string> }): unknown =>
  JSON.parse(s.data.get(HISTORY_KEY) ?? 'null');

describe('constants', () => {
  it('match the spec', () => {
    expect(HISTORY_MAX_ENTRIES).toBe(10);
    expect(HISTORY_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(HISTORY_KEY).toBe('pdf-insight.history.v1');
  });
});

describe('loadHistory', () => {
  it('returns [] for null storage', () => {
    expect(loadHistory(null, NOW)).toEqual([]);
  });

  it('returns [] for an empty storage', () => {
    expect(loadHistory(memoryStorage(), NOW)).toEqual([]);
  });

  it('keeps an entry just inside the 30 day window and drops one just outside', () => {
    const s = memoryStorage([
      entry('fresh', NOW - HISTORY_TTL_MS + 1),
      entry('stale', NOW - HISTORY_TTL_MS - 1),
    ]);
    expect(loadHistory(s, NOW).map((e) => e.id)).toEqual(['fresh']);
  });

  it.each(['not json{', '{"a":1}', '"text"', 'null'])('treats corrupt storage %j as empty', (raw) => {
    expect(loadHistory(memoryStorage(raw), NOW)).toEqual([]);
  });

  it('skips an entry whose insight fails InsightSchema while keeping the others', () => {
    const good = entry('good', NOW - 1000);
    const s = memoryStorage([
      good,
      { id: 'bad', fileName: 'bad.pdf', savedAt: NOW - 500, insight: { summary: '' } },
      42,
      null,
      { id: 'nofile', savedAt: NOW, insight: makeInsight() },
    ]);
    expect(loadHistory(s, NOW).map((e) => e.id)).toEqual(['good']);
  });

  it('never throws when getItem throws', () => {
    const s: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadHistory(s, NOW)).toEqual([]);
  });
});

describe('addHistoryEntry', () => {
  it('puts the newest entry first and persists the list', () => {
    const s = memoryStorage();
    addHistoryEntry(s, entry('a', NOW - 2000), NOW);
    const list = addHistoryEntry(s, entry('b', NOW - 1000), NOW);
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
    expect(loadHistory(s, NOW).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('keeps at most 10 entries and drops the oldest', () => {
    const s = memoryStorage();
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 12; i += 1) list = addHistoryEntry(s, entry(`e${i}`, NOW - 100_000 + i), NOW);
    expect(list).toHaveLength(10);
    expect(list[0]?.id).toBe('e11');
    expect(list[9]?.id).toBe('e2');
    expect(stored(s)).toHaveLength(10);
  });

  it('replaces an entry with the same id and moves it to the top', () => {
    const s = memoryStorage();
    addHistoryEntry(s, entry('a', NOW - 3000, 'old.pdf'), NOW);
    addHistoryEntry(s, entry('b', NOW - 2000), NOW);
    const list = addHistoryEntry(s, entry('a', NOW - 1000, 'new.pdf'), NOW);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]?.fileName).toBe('new.pdf');
  });

  it('drops expired entries already in storage', () => {
    const s = memoryStorage([entry('stale', NOW - HISTORY_TTL_MS - 5)]);
    const list = addHistoryEntry(s, entry('new', NOW), NOW);
    expect(list.map((e) => e.id)).toEqual(['new']);
  });

  it('recovers from corrupt storage', () => {
    const list = addHistoryEntry(memoryStorage('garbage{'), entry('a', NOW), NOW);
    expect(list.map((e) => e.id)).toEqual(['a']);
  });

  it('returns the in-memory list when setItem throws (quota)', () => {
    const base = memoryStorage([entry('old', NOW - 1000)]);
    const s: StorageLike = {
      getItem: base.getItem,
      removeItem: base.removeItem,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const list = addHistoryEntry(s, entry('new', NOW), NOW);
    expect(list.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('returns [entry] for null storage and when getItem throws', () => {
    expect(addHistoryEntry(null, entry('a', NOW), NOW).map((e) => e.id)).toEqual(['a']);
    const s: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(addHistoryEntry(s, entry('b', NOW), NOW).map((e) => e.id)).toEqual(['b']);
  });
});

describe('removeHistoryEntry', () => {
  it('removes one entry and persists', () => {
    const s = memoryStorage([entry('a', NOW - 2), entry('b', NOW - 1)]);
    expect(removeHistoryEntry(s, 'a', NOW).map((e) => e.id)).toEqual(['b']);
    expect(loadHistory(s, NOW).map((e) => e.id)).toEqual(['b']);
  });

  it('leaves the list unchanged for an unknown id', () => {
    const s = memoryStorage([entry('a', NOW - 1)]);
    expect(removeHistoryEntry(s, 'zzz', NOW).map((e) => e.id)).toEqual(['a']);
  });

  it('does not throw with null storage', () => {
    expect(removeHistoryEntry(null, 'a', NOW)).toEqual([]);
  });
});

describe('clearHistory', () => {
  it('empties the history', () => {
    const s = memoryStorage([entry('a', NOW - 1)]);
    clearHistory(s);
    expect(loadHistory(s, NOW)).toEqual([]);
  });

  it('does not throw for null storage or a throwing storage', () => {
    expect(() => clearHistory(null)).not.toThrow();
    const s: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => {
        throw new Error('x');
      },
    };
    expect(() => clearHistory(s)).not.toThrow();
  });
});
