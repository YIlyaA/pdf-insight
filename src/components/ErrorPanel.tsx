import { useId, type Ref } from 'react';
import { describeError, type ClientErrorCode } from '../lib/errors';
import { useCountdown } from '../hooks/useTimers';
import { Button } from './Button';
import { COPY } from './copy';
import { Icon } from './Icon';

/** The Worker's limit window: after `rate_limited` the retry waits one minute (spec 11.1). */
const RATE_LIMIT_COOLDOWN_SECONDS = 60;

interface ErrorPanelProps {
  fileName: string;
  code: ClientErrorCode;
  onRetry(): void;
  onPickOther(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function ErrorPanel({ fileName, code, onRetry, onPickOther, headingRef }: ErrorPanelProps) {
  const { title, cause, retry } = describeError(code);
  const headingId = useId();
  const cooldown = useCountdown(code === 'rate_limited' ? RATE_LIMIT_COOLDOWN_SECONDS : 0);

  return (
    <section className="panel error-panel" aria-labelledby={headingId}>
      <p className="panel-meta file-name" title={fileName}>
        {fileName}
      </p>
      <div role="alert" className="error-body">
        <Icon name="alert" className="error-icon" />
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="panel-title">
            {title}
          </h2>
          <p className="error-cause">{cause}</p>
        </div>
      </div>
      {retry && cooldown > 0 && <p className="countdown">{COPY.waitFor(cooldown)}</p>}
      <div className="actions">
        {retry && (
          <Button variant="primary" disabled={cooldown > 0} onClick={onRetry}>
            {COPY.retry}
          </Button>
        )}
        <Button variant={retry ? 'secondary' : 'primary'} onClick={onPickOther}>
          {COPY.otherFile}
        </Button>
      </div>
    </section>
  );
}
