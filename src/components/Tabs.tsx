import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  panel: ReactNode;
  panelClassName?: string;
}

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move and select. */
export function Tabs({ tabs, labelledBy }: { tabs: TabDef[]; labelledBy?: string }) {
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  function select(index: number) {
    setSelected(index);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = tabs.length;
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  }

  return (
    <div className="tabs">
      <div role="tablist" className="tablist" aria-labelledby={labelledBy}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${tab.id}-tab`}
            className="tab"
            aria-selected={index === selected}
            aria-controls={`${base}-${tab.id}-panel`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}-panel`}
          aria-labelledby={`${base}-${tab.id}-tab`}
          className={['tabpanel', tab.panelClassName].filter(Boolean).join(' ')}
          hidden={index !== selected}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
