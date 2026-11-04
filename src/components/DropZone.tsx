import { useId, useState, type DragEvent, type KeyboardEvent, type Ref } from 'react';
import { COPY } from './copy';
import { Icon } from './Icon';

interface DropZoneProps {
  /** Smaller variant shown under the progress panel: a drop there replaces the running analysis. */
  compact?: boolean;
  error: string | null;
  /** Extra ids for aria-describedby (the privacy note). */
  describedBy?: string;
  onFile(file: File): void;
  onOpenPicker(): void;
  ref?: Ref<HTMLDivElement>;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** The single control that chooses a PDF: click, Enter/Space or drop. The file input lives in App. */
export function DropZone({
  compact = false,
  error,
  describedBy,
  onFile,
  onOpenPicker,
  ref,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;
  const ctaId = `${id}-cta`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const description = [hintId, describedBy, error ? errorId : null].filter(Boolean).join(' ');

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenPicker();
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  }

  return (
    <div className={compact ? 'dropzone-block dropzone-block-compact' : 'dropzone-block'}>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        className="dropzone"
        data-dragging={dragging || undefined}
        data-invalid={error ? true : undefined}
        aria-labelledby={`${titleId} ${ctaId}`}
        aria-describedby={description}
        onClick={onOpenPicker}
        onKeyDown={onKeyDown}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Icon name="document" className="dropzone-icon" />
        <span className="dropzone-text">
          <span id={titleId} className="dropzone-title">
            {dragging ? COPY.dragOver : COPY.dropIdle}
          </span>
          <span id={hintId} className="dropzone-hint">
            {COPY.dropHint}
          </span>
        </span>
        {/* While a run is in progress the lime accent belongs to the active step, not to this zone. */}
        <span
          id={ctaId}
          className={`btn ${compact ? 'btn-secondary' : 'btn-primary'} dropzone-cta`}
        >
          {COPY.dropButton}
        </span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="field-error">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
