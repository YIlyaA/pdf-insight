import { motion } from 'motion/react';
import type { Ref } from 'react';
import type { useAnalysis } from '../hooks/useAnalysis';
import { DropZone } from './DropZone';
import { EmptyPanel } from './EmptyPanel';
import { ErrorPanel } from './ErrorPanel';
import { ProgressPanel } from './ProgressPanel';
import { ResultPanel } from './ResultPanel';
import { UploadPanel } from './UploadPanel';

interface MainPanelProps {
  analysis: ReturnType<typeof useAnalysis>;
  now: () => number;
  headingRef: Ref<HTMLHeadingElement>;
  zoneRef: Ref<HTMLDivElement>;
  onFile(file: File): void;
  onOpenPicker(): void;
  onCopy(text: string): void;
  /** Shows and announces a short confirmation (for example after a download). */
  onNotify(text: string): void;
}

/** Exactly one panel per state; a state change fades the new panel in (150 ms, opacity/transform). */
export function MainPanel(props: MainPanelProps) {
  const { analysis, now, headingRef, zoneRef, onFile, onOpenPicker, onCopy, onNotify } = props;
  const { view, zoneError } = analysis.state;

  function panel() {
    switch (view.kind) {
      case 'idle':
        return (
          <UploadPanel
            error={zoneError}
            zoneRef={zoneRef}
            onFile={onFile}
            onOpenPicker={onOpenPicker}
          />
        );
      case 'running':
        return (
          <>
            <ProgressPanel
              fileName={view.fileName}
              fileSize={view.fileSize}
              startedAt={view.startedAt}
              progress={view.progress}
              waitSeconds={view.waitSeconds}
              now={now}
              headingRef={headingRef}
              onCancel={analysis.cancel}
            />
            <DropZone
              compact
              ref={zoneRef}
              error={zoneError}
              onFile={onFile}
              onOpenPicker={onOpenPicker}
            />
          </>
        );
      case 'error':
        return (
          <ErrorPanel
            fileName={view.fileName}
            code={view.code}
            headingRef={headingRef}
            onRetry={analysis.retry}
            onPickOther={onOpenPicker}
          />
        );
      case 'empty':
        return (
          <EmptyPanel fileName={view.fileName} headingRef={headingRef} onPickOther={onOpenPicker} />
        );
      case 'result':
        return (
          <ResultPanel
            fileName={view.fileName}
            insight={view.insight}
            coverage={view.coverage}
            headingRef={headingRef}
            onCopy={onCopy}
            onNotify={onNotify}
            onNext={() => analysis.reset('title')}
          />
        );
    }
  }

  return (
    <motion.div
      key={view.kind}
      className="stage"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {panel()}
    </motion.div>
  );
}
