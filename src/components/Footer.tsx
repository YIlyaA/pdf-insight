import { COPY } from './copy';

export function Footer({ onPrivacy }: { onPrivacy(opener: HTMLElement): void }) {
  return (
    <footer className="site-footer">
      <a href={COPY.repoUrl} className="footer-link">
        {COPY.repoLabel}
      </a>
      <button
        type="button"
        className="link-button"
        onClick={(event) => onPrivacy(event.currentTarget)}
      >
        {COPY.privacyOpen}
      </button>
    </footer>
  );
}
