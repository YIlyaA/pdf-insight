import { useId, type Ref } from 'react';
import { COPY } from './copy';
import { DropZone } from './DropZone';

interface UploadPanelProps {
  error: string | null;
  onFile(file: File): void;
  onOpenPicker(): void;
  /** Opens the "Prywatność i dane" dialog; the opener gets focus back when it closes. */
  onPrivacy(opener: HTMLElement): void;
  zoneRef?: Ref<HTMLDivElement>;
}

/** Idle state: the drop zone, then one line saying where the file goes, with a details button. */
export function UploadPanel({ error, onFile, onOpenPicker, onPrivacy, zoneRef }: UploadPanelProps) {
  const noticeId = useId();
  return (
    <div className="upload">
      <DropZone
        ref={zoneRef}
        error={error}
        describedBy={noticeId}
        onFile={onFile}
        onOpenPicker={onOpenPicker}
      />
      <p className="notice">
        <span id={noticeId}>{COPY.privacyNotice}</span>{' '}
        <button
          type="button"
          className="link-button"
          onClick={(event) => onPrivacy(event.currentTarget)}
        >
          {COPY.privacyMore}
        </button>
      </p>
    </div>
  );
}
