import type { Ref } from 'react';
import { COPY } from './copy';
import { Logo } from './Logo';

/** The h1 doubles as the idle screen's heading: focus returns here after cancel. */
export function Header({ titleRef }: { titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <header className="site-header">
      <div className="brand">
        <Logo />
        <h1 ref={titleRef} tabIndex={-1} className="site-title">
          {COPY.title}
        </h1>
      </div>
      <p className="tagline">{COPY.tagline}</p>
    </header>
  );
}
