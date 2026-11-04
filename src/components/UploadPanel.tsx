import { useId, type Ref } from 'react';
import { COPY } from './copy';
import { DropZone } from './DropZone';

interface UploadPanelProps {
  error: string | null;
  onFile(file: File): void;
  onOpenPicker(): void;
  zoneRef?: Ref<HTMLDivElement>;
}

/** Idle state: privacy note first (it must be read before upload), then the drop zone. */
export function UploadPanel({ error, onFile, onOpenPicker, zoneRef }: UploadPanelProps) {
  const privacyId = useId();
  return (
    <div className="upload">
      <p id={privacyId} className="privacy">
        {COPY.privacy}
      </p>
      <DropZone
        ref={zoneRef}
        error={error}
        describedBy={privacyId}
        onFile={onFile}
        onOpenPicker={onOpenPicker}
      />
    </div>
  );
}
