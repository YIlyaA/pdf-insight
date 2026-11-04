import type { ClientErrorCode } from '../lib/errors';
import type { Coverage, Outcome, Progress } from '../lib/pipeline';
import type { Insight } from '../lib/schema';
import { COPY } from '../components/copy';

export type View =
  | { kind: 'idle' }
  | {
      kind: 'running';
      fileName: string;
      fileSize: number;
      startedAt: number;
      progress: Progress;
      /** Seconds left in a rate-limit wait, null when not waiting. */
      waitSeconds: number | null;
    }
  | { kind: 'error'; fileName: string; code: ClientErrorCode }
  | {
      kind: 'result';
      fileName: string;
      insight: Insight;
      coverage: Coverage | null;
      scanned: boolean;
    }
  | { kind: 'empty'; fileName: string };

/** Where focus goes after a state change: the panel h2, the page h1 or the drop zone. */
export type FocusTarget = 'heading' | 'title' | 'zone';

export interface AnalysisState {
  view: View;
  /** Inline message under the drop zone (validation or PdfError). */
  zoneError: string | null;
  /** Text of the polite live region. */
  announcement: string;
  /** Bumped on every announce action so repeated text restarts the visible timer. */
  announcementId: number;
  focus: { target: FocusTarget; seq: number } | null;
}

export type Action =
  | { type: 'start'; fileName: string; fileSize: number; startedAt: number; replaced: boolean }
  | { type: 'progress'; progress: Progress }
  | { type: 'wait'; seconds: number }
  | { type: 'invalid'; message: string }
  | { type: 'pdfError'; message: string }
  | { type: 'fail'; fileName: string; code: ClientErrorCode }
  | { type: 'finish'; fileName: string; outcome: Outcome }
  | { type: 'cancel' }
  | { type: 'reset'; focus: FocusTarget | null }
  | { type: 'show'; fileName: string; insight: Insight }
  | { type: 'announce'; text: string };

export const initialState: AnalysisState = {
  view: { kind: 'idle' },
  zoneError: null,
  announcement: '',
  announcementId: 0,
  focus: null,
};

function focusOn(state: AnalysisState, target: FocusTarget): AnalysisState['focus'] {
  return { target, seq: (state.focus?.seq ?? 0) + 1 };
}

export function reducer(state: AnalysisState, action: Action): AnalysisState {
  switch (action.type) {
    case 'start':
      return {
        view: {
          kind: 'running',
          fileName: action.fileName,
          fileSize: action.fileSize,
          startedAt: action.startedAt,
          progress: { phase: 'loading' },
          waitSeconds: null,
        },
        zoneError: null,
        announcement: action.replaced ? COPY.cancelled : '',
        announcementId: state.announcementId,
        focus: focusOn(state, 'heading'),
      };
    case 'progress':
      if (state.view.kind !== 'running') return state;
      return { ...state, view: { ...state.view, progress: action.progress, waitSeconds: null } };
    case 'wait':
      if (state.view.kind !== 'running') return state;
      return {
        ...state,
        view: { ...state.view, waitSeconds: action.seconds > 0 ? action.seconds : null },
      };
    case 'invalid':
      // While running the compact zone shows the message and the run goes on.
      if (state.view.kind === 'running' || state.view.kind === 'idle') {
        return { ...state, zoneError: action.message };
      }
      return {
        ...state,
        view: { kind: 'idle' },
        zoneError: action.message,
        focus: focusOn(state, 'zone'),
      };
    case 'pdfError':
      return {
        ...state,
        view: { kind: 'idle' },
        zoneError: action.message,
        focus: focusOn(state, 'zone'),
      };
    case 'fail':
      return {
        ...state,
        view: { kind: 'error', fileName: action.fileName, code: action.code },
        focus: focusOn(state, 'heading'),
      };
    case 'finish':
      return {
        ...state,
        view:
          action.outcome.kind === 'result'
            ? {
                kind: 'result',
                fileName: action.fileName,
                insight: action.outcome.insight,
                coverage: action.outcome.coverage,
                scanned: action.outcome.scanned === true,
              }
            : { kind: 'empty', fileName: action.fileName },
        focus: focusOn(state, 'heading'),
      };
    case 'cancel':
      return {
        view: { kind: 'idle' },
        zoneError: null,
        announcement: COPY.cancelled,
        announcementId: state.announcementId,
        focus: focusOn(state, 'title'),
      };
    case 'reset':
      return {
        ...state,
        view: { kind: 'idle' },
        zoneError: null,
        focus: action.focus ? focusOn(state, action.focus) : state.focus,
      };
    case 'show':
      return {
        ...state,
        view: {
          kind: 'result',
          fileName: action.fileName,
          insight: action.insight,
          coverage: null,
          scanned: false,
        },
        zoneError: null,
        focus: focusOn(state, 'heading'),
      };
    case 'announce':
      return { ...state, announcement: action.text, announcementId: state.announcementId + 1 };
  }
}
