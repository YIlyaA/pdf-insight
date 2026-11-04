/**
 * Own logo mark: a document outline inside four scan-corner brackets (the drop zone motif).
 * Decorative only: the h1 next to it carries the name. Same drawing as public/favicon.svg.
 */
export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg
        viewBox="0 0 32 32"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path className="logo-corners" d="M3 9V3h6M23 3h6v6M29 23v6h-6M9 29H3v-6" />
        <path className="logo-doc" d="M10.5 7.5h7.5l4.5 4.5v12.5h-12z" />
        <path className="logo-doc" d="M18 7.5V12h4.5" />
        <path className="logo-doc" d="M13.5 16.5h5M13.5 20h5" />
      </svg>
    </span>
  );
}
