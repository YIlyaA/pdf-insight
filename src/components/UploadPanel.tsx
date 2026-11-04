import type { Ref } from 'react';
import { DropZone } from './DropZone';

interface UploadPanelProps {
  error: string | null;
  onFile(file: File): void;
  onOpenPicker(): void;
  zoneRef?: Ref<HTMLDivElement>;
}

/** Idle state: the drop zone. Privacy lives in the footer dialog, not here. */
export function UploadPanel({ error, onFile, onOpenPicker, zoneRef }: UploadPanelProps) {
  return (
    <div className="upload">
      <DropZone ref={zoneRef} error={error} onFile={onFile} onOpenPicker={onOpenPicker} />
    </div>
  );
}
