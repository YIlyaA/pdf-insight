import { useId, type Ref } from 'react';
import { formatFileSize } from '../lib/format';
import type { Progress } from '../lib/pipeline';
import { useElapsedSeconds } from '../hooks/useTimers';
import { Button } from './Button';
import { COPY } from './copy';
import { StepList, stepName } from './StepList';

/** After this many seconds the panel says the run is slower than usual (spec section 9). */
const SLOW_AFTER_SECONDS = 15;

interface ProgressPanelProps {
  fileName: string;
  fileSize: number;
  startedAt: number;
  progress: Progress;
  waitSeconds: number | null;
  now: () => number;
  onCancel(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function ProgressPanel(props: ProgressPanelProps) {
  const { fileName, fileSize, startedAt, progress, waitSeconds, now, onCancel, headingRef } = props;
  const headingId = useId();
  const elapsed = useElapsedSeconds(startedAt, now);
  const slow = elapsed >= SLOW_AFTER_SECONDS;

  return (
    <section className="panel progress" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="panel-title file-name"
          title={fileName}
        >
          {fileName}
        </h2>
        <p className="panel-meta">
          <span>{formatFileSize(fileSize)}</span>
          {/* Elapsed time is visible but never read aloud. */}
          <span aria-live="off" className="elapsed">
            {COPY.seconds(elapsed)}
          </span>
        </p>
      </div>
      <div className="progress-body">
        <StepList progress={progress} />
        {/* Live regions stay mounted (and in the accessibility tree) so changes are announced. */}
        <p className="visually-hidden" aria-live="polite">
          {stepName(progress)}
        </p>
        {waitSeconds !== null && <p className="countdown">{COPY.waitFor(waitSeconds)}</p>}
        <p className="slow" aria-live="polite">
          {slow ? COPY.slow : ''}
        </p>
      </div>
      <div className="actions">
        <Button onClick={onCancel}>{COPY.cancel}</Button>
      </div>
    </section>
  );
}
