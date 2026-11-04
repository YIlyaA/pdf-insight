export type IconName = 'document' | 'check' | 'active' | 'pending' | 'alert' | 'chevron' | 'empty';

/** Own inline icons (no licence needed). Always decorative: the text next to them carries the meaning. */
function paths(name: IconName) {
  switch (name) {
    case 'document':
      return (
        <>
          <path d="M5 2.5h6.5L15 6v11.5H5z" />
          <path d="M11.5 2.5V6H15" />
          <path d="M7.5 10h5M7.5 13h5" />
        </>
      );
    case 'check':
      return (
        <>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M6.5 10.2 8.8 12.5 13.5 7.8" />
        </>
      );
    case 'active':
      return (
        <>
          <circle cx="10" cy="10" r="7.5" className="icon-track" />
          <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" className="icon-arc" />
          <circle cx="10" cy="10" r="2.5" className="icon-fill" />
        </>
      );
    case 'pending':
      return <circle cx="10" cy="10" r="7.5" strokeDasharray="2.5 2.5" />;
    case 'alert':
      return (
        <>
          <path d="M10 2.5 18 17H2z" />
          <path d="M10 8v4" />
          <path d="M10 14.25v.5" />
        </>
      );
    case 'chevron':
      return <path d="m6 8 4 4 4-4" />;
    case 'empty':
      return (
        <>
          <path d="M5 2.5h6.5L15 6v11.5H5z" />
          <path d="M11.5 2.5V6H15" />
          <path d="m8 10 4 4M12 10l-4 4" />
        </>
      );
  }
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={['icon', `icon-${name}`, className].filter(Boolean).join(' ')}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths(name)}
    </svg>
  );
}
