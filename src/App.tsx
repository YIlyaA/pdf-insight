import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HistoryList } from './components/HistoryList';
import { MainPanel } from './components/MainPanel';
import { PrivacyDialog } from './components/PrivacyDialog';
import { COPY } from './components/copy';
import { useAnalysis } from './hooks/useAnalysis';
import {
  addHistoryEntry,
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  type HistoryEntry,
} from './lib/history';
import type { Insight } from './lib/schema';
import { createDefaultServices, type AppServices } from './services';

export type { AppServices, RunContext } from './services';

const TOAST_MS = 3000;

function newId(now: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${now}-${Math.random().toString(36).slice(2)}`;
}

export function App({ services: overrides }: { services?: Partial<AppServices> }) {
  const services = useMemo(() => ({ ...createDefaultServices(), ...overrides }), [overrides]);
  const [history, setHistory] = useState(() => loadHistory(services.storage, services.now()));

  const onResult = useCallback(
    (fileName: string, insight: Insight) => {
      const now = services.now();
      const entry: HistoryEntry = { id: newId(now), fileName, savedAt: now, insight };
      setHistory(addHistoryEntry(services.storage, entry, now));
    },
    [services],
  );

  const analysis = useAnalysis(services, onResult);
  const { state, selectFile, announce } = analysis;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const privacyOpener = useRef<HTMLElement | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const openPrivacy = useCallback((opener: HTMLElement) => {
    privacyOpener.current = opener;
    setPrivacyOpen(true);
  }, []);

  const closePrivacy = useCallback(() => {
    setPrivacyOpen(false);
    privacyOpener.current?.focus();
  }, []);

  // Move focus after a state change, once the new panel is in the DOM.
  useLayoutEffect(() => {
    if (!state.focus) return;
    const targets = { heading: headingRef, title: titleRef, zone: zoneRef };
    targets[state.focus.target].current?.focus();
  }, [state.focus]);

  // The confirmation is visible for a moment, then cleared so the same text can be announced again.
  useEffect(() => {
    if (!state.announcement) return;
    const timer = setTimeout(() => announce(''), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.announcement, announce]);

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const onFile = useCallback((file: File) => void selectFile(file), [selectFile]);

  const copy = useCallback(
    async (text: string) => {
      try {
        await services.writeClipboard(text);
        announce(COPY.copied);
      } catch {
        announce(COPY.copyFailed);
      }
    },
    [services, announce],
  );

  function removeEntry(id: string) {
    const next = removeHistoryEntry(services.storage, id, services.now());
    setHistory(next);
    (next.length > 0 ? historyHeadingRef : zoneRef).current?.focus();
  }

  function clearAll() {
    clearHistory(services.storage);
    setHistory([]);
    zoneRef.current?.focus();
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Header titleRef={titleRef} />
        <main className="main">
          <MainPanel
            analysis={analysis}
            now={services.now}
            headingRef={headingRef}
            zoneRef={zoneRef}
            onFile={onFile}
            onOpenPicker={openPicker}
            onCopy={(text) => void copy(text)}
            onNotify={announce}
          />
          {state.view.kind === 'idle' && history.length > 0 && (
            <HistoryList
              entries={history}
              headingRef={historyHeadingRef}
              onOpen={(entry) => analysis.show(entry.fileName, entry.insight)}
              onRemove={removeEntry}
              onClear={clearAll}
            />
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onFile(file);
            }}
          />
          <p className="toast" role="status" aria-live="polite">
            {state.announcement}
          </p>
        </main>
        <Footer onPrivacy={openPrivacy} />
        <PrivacyDialog open={privacyOpen} onClose={closePrivacy} />
      </div>
    </MotionConfig>
  );
}
