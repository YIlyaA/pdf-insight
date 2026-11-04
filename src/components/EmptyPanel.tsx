import { useId, type Ref } from 'react';
import { Button } from './Button';
import { COPY } from './copy';
import { Icon } from './Icon';

interface EmptyPanelProps {
  fileName: string;
  onPickOther(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** No readable content: every page was blank, or the scan path returned an empty summary. */
export function EmptyPanel({ fileName, onPickOther, headingRef }: EmptyPanelProps) {
  const headingId = useId();
  return (
    <section className="panel empty-panel" aria-labelledby={headingId}>
      <p className="panel-meta file-name" title={fileName}>
        {fileName}
      </p>
      <div className="empty-body">
        <Icon name="empty" className="empty-icon" />
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="panel-title">
          {COPY.empty}
        </h2>
      </div>
      <div className="actions">
        <Button variant="primary" onClick={onPickOther}>
          {COPY.otherFile}
        </Button>
      </div>
    </section>
  );
}
