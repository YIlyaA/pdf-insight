import { useCallback, useEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import { AppError } from '../lib/errors';
import { MESSAGES } from '../lib/messages';
import { PdfError } from '../lib/pdfText';
import { createRunState, type RunState } from '../lib/pipeline';
import type { Insight } from '../lib/schema';
import type { AppServices } from '../services';
import { initialState, reducer, type FocusTarget } from './analysisState';

/**
 * The analysis state machine: idle -> running -> result | empty | error, with cancel,
 * retry (same RunState, so finished chunks are not requested again) and replacement by a new file.
 */
export function useAnalysis(
  services: AppServices,
  onResult: (fileName: string, insight: Insight) => void,
) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controller = useRef<AbortController | null>(null);
  const file = useRef<File | null>(null);
  const runState = useRef<RunState | null>(null);
  /** Bumped on every start or cancel; a settled run with an old token is ignored. */
  const runToken = useRef(0);
  const pickToken = useRef(0);

  const stop = useCallback(() => {
    runToken.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const execute = useCallback(
    async (target: File, run: RunState, replaced: boolean) => {
      stop();
      const own = new AbortController();
      controller.current = own;
      const token = runToken.current;
      const current = () => token === runToken.current;
      // Commit the progress panel (and focus its heading) before any work starts.
      flushSync(() =>
        dispatch({
          type: 'start',
          fileName: target.name,
          fileSize: target.size,
          startedAt: services.now(),
          replaced,
        }),
      );
      try {
        const outcome = await services.analyze(target, {
          state: run,
          signal: own.signal,
          onProgress: (progress) => {
            if (current()) dispatch({ type: 'progress', progress });
          },
          onRateLimitWait: (seconds) => {
            if (current()) dispatch({ type: 'wait', seconds });
          },
        });
        if (!current()) return;
        controller.current = null;
        if (outcome.kind === 'result') onResult(target.name, outcome.insight);
        dispatch({ type: 'finish', fileName: target.name, outcome });
      } catch (error) {
        if (!current()) return;
        controller.current = null;
        if (error instanceof PdfError) {
          dispatch({ type: 'pdfError', message: error.message });
          return;
        }
        const code = error instanceof AppError ? error.code : 'internal_error';
        if (code === 'aborted') {
          dispatch({ type: 'reset', focus: 'title' });
          return;
        }
        dispatch({
          type: 'fail',
          fileName: target.name,
          code: services.isOnline() ? code : 'offline',
        });
      }
    },
    [services, onResult, stop],
  );

  const selectFile = useCallback(
    async (picked: File) => {
      const token = ++pickToken.current;
      let message: string | null = null;
      try {
        const result = await services.validate(picked);
        if (!result.ok) message = result.message;
      } catch {
        message = MESSAGES.errCorrupt;
      }
      if (token !== pickToken.current) return;
      if (message !== null) {
        dispatch({ type: 'invalid', message });
        return;
      }
      const replaced = controller.current !== null;
      file.current = picked;
      runState.current = createRunState();
      await execute(picked, runState.current, replaced);
    },
    [services, execute],
  );

  const cancel = useCallback(() => {
    stop();
    dispatch({ type: 'cancel' });
  }, [stop]);

  const retry = useCallback(() => {
    if (file.current && runState.current) void execute(file.current, runState.current, false);
  }, [execute]);

  const reset = useCallback(
    (focus: FocusTarget | null = 'title') => {
      stop();
      dispatch({ type: 'reset', focus });
    },
    [stop],
  );

  const show = useCallback(
    (fileName: string, insight: Insight) => {
      stop();
      file.current = null;
      runState.current = null;
      dispatch({ type: 'show', fileName, insight });
    },
    [stop],
  );

  const announce = useCallback((text: string) => dispatch({ type: 'announce', text }), []);

  return { state, selectFile, cancel, retry, reset, show, announce };
}
