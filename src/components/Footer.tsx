import { COPY } from './copy';

export function Footer() {
  return (
    <footer className="site-footer">
      <a href={COPY.repoUrl} className="footer-link">
        {COPY.repoLabel}
      </a>
      <p>{COPY.providerNote}</p>
    </footer>
  );
}
