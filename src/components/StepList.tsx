import { motion } from 'motion/react';
import type { Progress } from '../lib/pipeline';
import { COPY } from './copy';
import { Icon } from './Icon';

type StepState = 'done' | 'active' | 'pending';

/** Index of the step a pipeline phase belongs to (Gotowe is never active while running). */
export function activeStep(progress: Progress): number {
  switch (progress.phase) {
    case 'loading':
      return 0;
    case 'reading':
    case 'scanning':
      return 1;
    case 'analyzing':
    case 'summarizing':
      return 2;
  }
}

/** The name announced in the polite live region: step name only, no counters or seconds. */
export function stepName(progress: Progress): string {
  return COPY.steps[activeStep(progress)] ?? COPY.steps[0];
}

function label(index: number, progress: Progress): string {
  const name = COPY.steps[index] ?? '';
  if (index === 2 && progress.phase === 'analyzing' && progress.total > 1) {
    return `${name} ${progress.done}/${progress.total}`;
  }
  return name;
}

function detail(index: number, progress: Progress): string | null {
  if (index === 1 && progress.phase === 'scanning') {
    return COPY.scanStep(progress.page, progress.total);
  }
  return null;
}

const ICONS = { done: 'check', active: 'active', pending: 'pending' } as const;

export function StepList({ progress }: { progress: Progress }) {
  const current = activeStep(progress);
  return (
    <ol className="steps">
      {COPY.steps.map((name, index) => {
        const state: StepState =
          index < current ? 'done' : index === current ? 'active' : 'pending';
        const extra = detail(index, progress);
        return (
          <li
            key={name}
            className="step"
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <motion.span
              key={state}
              className="step-icon"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Icon name={ICONS[state]} />
            </motion.span>
            <span className="step-text">
              <span className="step-label">{label(index, progress)}</span>
              {extra && <span className="step-detail">{extra}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
