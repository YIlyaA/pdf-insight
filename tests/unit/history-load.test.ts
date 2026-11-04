// @vitest-environment node
import {
  HISTORY_KEY,
  HISTORY_MAX_ENTRIES,
  loadHistory,
  type HistoryEntry,
} from '../../src/lib/history';
import { initialState, reducer } from '../../src/hooks/analysisState';
import { makeInsight } from '../independent/helpers';

const NOW = 1_800_000_000_000;
const entry = (id: string, savedAt: number): HistoryEntry => ({
  id,
  fileName: `${id}.pdf`,
  savedAt,
  insight: makeInsight(),
});
const storageWith = (entries: HistoryEntry[]) => ({
  getItem: (key: string) => (key === HISTORY_KEY ? JSON.stringify(entries) : null),
  setItem: () => undefined,
  removeItem: () => undefined,
});

describe('loadHistory hardening', () => {
  it('never returns more than the maximum number of entries', () => {
    const many = Array.from({ length: 15 }, (_, i) => entry(`e${i}`, NOW - i * 1000));
    expect(loadHistory(storageWith(many), NOW)).toHaveLength(HISTORY_MAX_ENTRIES);
  });

  it('drops duplicate ids and entries saved in the future', () => {
    const list = [entry('a', NOW - 2000), entry('a', NOW - 1000), entry('future', NOW + 60_000)];
    const loaded = loadHistory(storageWith(list), NOW);
    expect(loaded.map((e) => e.id)).toEqual(['a']);
  });
});

describe('announcements', () => {
  it('changes the announcement id even when the text repeats', () => {
    const once = reducer(initialState, { type: 'announce', text: 'Skopiowano' });
    const twice = reducer(once, { type: 'announce', text: 'Skopiowano' });
    expect(twice.announcementId).not.toBe(once.announcementId);
  });
});
