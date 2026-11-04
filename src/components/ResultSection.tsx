import { useId, useState, type ReactNode } from 'react';
import { COLLAPSE_AFTER, COPY } from './copy';
import { keepNumbersTogether } from '../lib/format';
import { Icon } from './Icon';

interface ResultSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function ResultSection({ title, children, className }: ResultSectionProps) {
  const id = useId();
  return (
    <section
      className={['result-section', className].filter(Boolean).join(' ')}
      aria-labelledby={id}
    >
      <h3 id={id} className="result-section-title">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function NoData() {
  return <p className="no-data">{COPY.noData}</p>;
}

/** Collapsing for long lists: the first 8 items, then a "Pokaż wszystkie (n)" toggle. */
export function useCollapse<T>(items: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? items : items.slice(0, COLLAPSE_AFTER);
  const toggle =
    items.length > COLLAPSE_AFTER ? (
      <button
        type="button"
        className="btn btn-ghost show-all"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        {COPY.showAll(items.length)}
        <Icon name="chevron" />
      </button>
    ) : null;
  return { visible, listId, toggle };
}

interface TextListProps {
  items: readonly string[];
  /** Document language: model text is tagged so screen readers pick the right voice. */
  lang: string;
  variant?: 'bullets' | 'tags';
}

export function TextList({ items, lang, variant = 'bullets' }: TextListProps) {
  const { visible, listId, toggle } = useCollapse(items);
  if (items.length === 0) return <NoData />;
  return (
    <>
      <ul id={listId} className={`text-list text-list-${variant}`} lang={lang} dir="auto">
        {visible.map((item, index) => (
          <li key={index}>{keepNumbersTogether(item)}</li>
        ))}
      </ul>
      {toggle}
    </>
  );
}
