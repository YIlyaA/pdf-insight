import { useEffect, useId, useRef, useState, type Ref } from 'react';
import type { HistoryEntry } from '../lib/history';
import { docTypeLabel } from '../lib/format';
import { Button } from './Button';
import { COPY } from './copy';

const savedAtFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

interface HistoryListProps {
  entries: HistoryEntry[];
  onOpen(entry: HistoryEntry): void;
  onRemove(id: string): void;
  onClear(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function HistoryList({ entries, onOpen, onRemove, onClear, headingRef }: HistoryListProps) {
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();
  const questionId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) clearRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <section className="history" aria-labelledby={headingId}>
      <div className="history-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="history-title">
          {COPY.historyTitle}
        </h2>
        {!confirming && (
          <Button ref={clearRef} variant="ghost" onClick={() => setConfirming(true)}>
            {COPY.clear}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="confirm" role="group" aria-labelledby={questionId}>
          <p id={questionId} className="confirm-question">
            {COPY.clearQuestion}
          </p>
          <div className="actions">
            <Button variant="secondary" className="btn-danger" onClick={onClear}>
              {COPY.clearConfirm}
            </Button>
            <Button ref={keepRef} variant="ghost" onClick={() => setConfirming(false)}>
              {COPY.cancel}
            </Button>
          </div>
        </div>
      )}
      <ul className="history-list">
        {entries.map((entry) => (
          <li key={entry.id} className="history-item">
            <button type="button" className="history-open" onClick={() => onOpen(entry)}>
              <span className="history-name" title={entry.fileName} dir="auto">
                {entry.fileName}
              </span>
              <span className="history-meta">
                <span>{savedAtFormat.format(entry.savedAt)}</span>
                <span>{docTypeLabel(entry.insight.document.type)}</span>
              </span>
            </button>
            <Button
              variant="ghost"
              aria-label={COPY.removeLabel(entry.fileName)}
              onClick={() => onRemove(entry.id)}
            >
              {COPY.remove}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
