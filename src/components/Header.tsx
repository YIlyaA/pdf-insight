import type { Ref } from 'react';
import { COPY } from './copy';

/** The h1 doubles as the idle screen's heading: focus returns here after cancel. */
export function Header({ titleRef }: { titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <header className="site-header">
      <h1 ref={titleRef} tabIndex={-1} className="site-title">
        {COPY.title}
      </h1>
      <p className="tagline">{COPY.tagline}</p>
    </header>
  );
}
