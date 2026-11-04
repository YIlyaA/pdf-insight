import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { COPY } from './copy';

interface PrivacyDialogProps {
  open: boolean;
  /** Called once the dialog has closed (Zamknij, Esc); the caller moves focus back to the opener. */
  onClose(): void;
}

/**
 * "Prywatność i dane": a native modal <dialog> (top layer, page behind inert, Esc closes).
 * Where showModal is missing it falls back to the `open` attribute and handles Esc itself.
 */
export function PrivacyDialog({ open, onClose }: PrivacyDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fallback = useRef(false);
  const headingId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog || dialog.hasAttribute('open')) return;
    fallback.current = typeof dialog.showModal !== 'function';
    if (fallback.current) {
      dialog.setAttribute('open', '');
      dialog.setAttribute('data-fallback', '');
    } else {
      dialog.showModal();
    }
    if (!dialog.contains(document.activeElement)) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function close() {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === 'function' && dialog.hasAttribute('open')) {
      dialog.close(); // fires "close", which calls onClose
    } else {
      onClose();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // A native modal turns Esc into cancel + close by itself; only the fallback needs this.
    if (event.key !== 'Escape' || !fallback.current) return;
    event.preventDefault();
    close();
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={headingId}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      <h2 id={headingId} className="dialog-title">
        {COPY.privacyTitle}
      </h2>
      <ul className="dialog-list">
        {COPY.privacyItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="dialog-actions">
        <Button ref={closeRef} onClick={close}>
          {COPY.close}
        </Button>
      </div>
    </dialog>
  );
}
