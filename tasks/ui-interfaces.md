---
id: T-ui
title: PDF Insight UI, Worker client and pipeline
status: ready
labels: [ui]
size_limit: 2500 lines
external: [motion@14]
scope: [src/**, tests/**, design/**, index.html, README.md, AI_LOG.md]
allow_test_changes: false
---

## Goal
Build the interface from `design/spec.md` (incl. section 11) on top of `src/lib/*`. Never edit `src/lib/protocol.ts` or `worker/`.

## Frozen interfaces

### `src/lib/errors.ts`
```ts
import type { ErrorCode } from './protocol';
export type ClientErrorCode = ErrorCode | 'offline' | 'network' | 'client_timeout' | 'not_configured' | 'aborted';
export interface ErrorView { title: string; cause: string; retry: boolean }
/** Spec 11.1 table. client_timeout == timeout. not_found, method_not_allowed, forbidden_origin, bad_request -> "Błąd aplikacji". */
export function describeError(code: ClientErrorCode): ErrorView;
export class AppError extends Error { readonly code: ClientErrorCode; constructor(code: ClientErrorCode) }
```
Extra rows: `offline` -> title "Brak połączenia", cause "Brak połączenia z internetem.", retry yes. `network` -> "Nie udało się połączyć z serwerem" / "Sprawdź połączenie i spróbuj ponownie.", retry yes. `not_configured` -> "Aplikacja nie jest skonfigurowana" / "Brakuje adresu serwera analizy.", retry no. `aborted` -> never shown (title "Anulowano"), retry no.

### `src/api/client.ts`
```ts
import type { AnalyzeRequest, SummarizeRequest } from '../lib/protocol';
import type { Insight } from '../lib/schema';
export interface CallContext {
  signal: AbortSignal;
  /** Called every second while waiting after a 429 (secondsLeft counts down to 0). */
  onRateLimitWait?: (secondsLeft: number) => void;
}
export interface ClientOptions {
  baseUrl: string | undefined;           // VITE_API_URL; undefined or '' -> AppError('not_configured') before any fetch
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;   // rejects when the signal aborts
  now?: () => number;
  isOnline?: () => boolean;              // default: navigator.onLine !== false
  minGapMs?: number;                     // default 6000, between the START of two requests
  timeoutMs?: number;                    // default 45000 per request -> AppError('client_timeout')
  maxRateLimitRetries?: number;          // default 3 per call, then AppError('rate_limited')
  fallbackRetryAfterSec?: number;        // default 60, used when Retry-After is missing or invalid
}
export interface WorkerClient {
  analyze(request: AnalyzeRequest, ctx: CallContext): Promise<Insight>;
  summarize(request: SummarizeRequest, ctx: CallContext): Promise<string>;
}
export function createWorkerClient(options: ClientOptions): WorkerClient;
```
Rules: POST `${baseUrl}/analyze|/summarize` (trailing slash of baseUrl stripped), JSON, `cache: 'no-store'`, `credentials: 'omit'`. Offline before sending -> `offline`. A fetch rejection: `offline` if `isOnline()` is false, else `network`. Caller abort -> `aborted` (also during pacing sleep and countdown). 429 body `rate_limited`: wait `Retry-After` seconds (positive integer header, else fallback) with countdown, then resend the same request (counts against the gap rule). 429 `quota_exceeded`: throw at once. Other non-2xx: code from `{error:{code}}` if it is in `ERROR_CODES`, else `upstream_error` for 5xx and `bad_request` for 4xx. 2xx `/analyze`: `{insight}` must pass `InsightSchema`, else `invalid_response`. 2xx `/summarize`: `{summary: non-empty string}`, else `invalid_response`.

### `src/lib/history.ts`
```ts
import type { Insight } from './schema';
export const HISTORY_MAX_ENTRIES = 10;
export const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const HISTORY_KEY = 'pdf-insight.history.v1';
export interface HistoryEntry { id: string; fileName: string; savedAt: number; insight: Insight }
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Newest first. Drops expired, corrupt (InsightSchema fails) and malformed entries. Never throws; null storage -> []. */
export function loadHistory(storage: StorageLike | null, now: number): HistoryEntry[];
/** Reads, adds the entry on top (same id replaced), trims to 10, writes. Returns the new list. Never throws (quota/disabled -> returns the in-memory list). */
export function addHistoryEntry(storage: StorageLike | null, entry: HistoryEntry, now: number): HistoryEntry[];
export function removeHistoryEntry(storage: StorageLike | null, id: string, now: number): HistoryEntry[];
export function clearHistory(storage: StorageLike | null): void;
```

### `src/lib/format.ts`
```ts
export function docTypeLabel(type: DocType): string;            // faktura, umowa, oferta, raport, inne
export function formatDate(iso: string): string;                // Intl pl-PL, e.g. "1 września 2026"; invalid input returned as is
export function formatAmount(value: number, currency: string): string; // Intl pl-PL currency; unknown currency code falls back to "1 234,50 XYZ"
export function languageName(code: string): string;             // Intl.DisplayNames pl-PL ("angielski"); unknown -> code
export function pagesLabel(n: number): string;                  // "1 strona", "3 strony", "5 stron" via Intl.PluralRules pl-PL
export function coverageLabel(analyzedTo: number, total: number): string; // "Przeanalizowano strony 1-12 z 40" (pl plural of "strona" after the number rule from spec 11.2)
export function downloadFileName(fileName: string): string;     // spec section 9: strip .pdf, [^\p{L}\p{N}_-] -> "_", + ".insight.json"; empty base -> "wynik"
export function formatFileSize(bytes: number): string;          // "1,5 MB", "320 KB"
```

### `src/lib/renderPages.ts` (browser-only parts are thin; pure helpers are tested)
```ts
export interface RenderedPage { page: number; mimeType: 'image/jpeg'; dataBase64: string; blank: boolean }
export interface PageRenderer { render(page: number): Promise<RenderedPage>; destroy(): Promise<void> }
export const MAX_IMAGE_BASE64 = 700_000;
/** True when pixels are almost uniform (max channel spread of a sampled grid <= tolerance). RGBA input. */
export function isBlankPixels(rgba: Uint8ClampedArray, tolerance?: number): boolean;
/** Lowers JPEG quality (start 0.85, step 0.1, floor 0.3), then the scale, until encode() output fits maxChars. Throws AppError-free Error('too_large') when nothing fits. */
export function fitImage(encode: (quality: number, scale: number) => string, maxChars?: number): string;
/** Browser implementation over pdf.js + canvas. Not unit-tested (needs canvas); exercised manually. */
export function createPageRenderer(pdfjs: RenderCapablePdfJs, data: Uint8Array): Promise<PageRenderer>;
```

### `src/lib/pipeline.ts`
```ts
export const MAX_REQUESTS_PER_RUN = 12;   // analyse chunks + the summary call
export type Progress =
  | { phase: 'loading' }
  | { phase: 'reading' }
  | { phase: 'scanning'; page: number; total: number }    // rendering scan pages
  | { phase: 'analyzing'; done: number; total: number }   // chunks finished / planned (after the cap)
  | { phase: 'summarizing' };
export interface Coverage { analyzedTo: number; totalPages: number }
export type Outcome =
  | { kind: 'result'; insight: Insight; coverage: Coverage | null }  // coverage set only when the cap cut the document
  | { kind: 'empty' };
/** Kept by the caller between a failed run and its retry: finished chunks and the summary are never requested again. */
export interface RunState { plan?: unknown; insights: Map<number, Insight>; summary?: string }
export function createRunState(): RunState;
export interface PipelineDeps {
  pdfjs: PdfJsLike;                                           // from pdfText.ts
  openRenderer: (data: Uint8Array) => Promise<PageRenderer>;  // only called when scan pages exist
  client: WorkerClient;
}
export interface RunOptions {
  signal: AbortSignal;
  state: RunState;
  onProgress: (p: Progress) => void;
  onRateLimitWait: (secondsLeft: number) => void;
}
/** file is already validated. Throws PdfError (password, corrupt) or AppError. */
export function runPipeline(file: File, deps: PipelineDeps, options: RunOptions): Promise<Outcome>;
```
Rules: `extractPages` -> text chunks via `splitIntoChunks(pages, MAX_CHUNK_CHARS)`; scan pages (text < 30 chars) rendered through the renderer, batches of at most 8 consecutive scan pages become extra chunks with `text: ''` and `images`. Chunks are merged into one list sorted by first page and re-indexed 0..n-1, `total` = n. All pages scan-blank (renderer says `blank` for every one) and no text -> `{kind:'empty'}` with no request. Blank scan pages are not sent. One chunk -> one `/analyze` request, no summary call. More than one chunk -> `/analyze` per chunk, one at a time, then `mergeInsights`, then `/summarize` with every chunk summary and the merged language; the merged insight's summary is replaced by the returned one. Cap: if chunks > 1, at most `MAX_REQUESTS_PER_RUN - 1` chunks are analysed (first ones); `coverage` = `{analyzedTo: last page of the last analysed chunk, totalPages}`. `fileName` of the request is `file.name`; `document.pages` of the final insight is the real page count. A chunk whose result is already in `state.insights` is skipped; a stored `state.summary` skips the summary call. Abort -> `AppError('aborted')`. If the final insight summary is blank (scan path) -> `{kind:'empty'}`.

### `src/App.tsx` and services
```ts
export interface RunContext { state: RunState; signal: AbortSignal; onProgress(p: Progress): void; onRateLimitWait(secondsLeft: number): void }
export interface AppServices {
  /** Reads the head of the file and calls validateFile. */
  validate(file: File): Promise<ValidationResult>;
  /** Throws PdfError (shown inline under the zone) or AppError (shown in ErrorPanel). */
  analyze(file: File, run: RunContext): Promise<Outcome>;
  storage: StorageLike | null;
  now(): number;
  isOnline(): boolean;
  writeClipboard(text: string): Promise<void>;
}
export function App(props: { services?: Partial<AppServices> }): JSX.Element;
```
Default services use the real modules and `import.meta.env.VITE_API_URL`; with no URL, `analyze` throws `AppError('not_configured')` (ErrorPanel, no retry), never a blank page.

## UI behaviour (details in design/spec.md; this list is what tests check)
- Idle: h1 "PDF Insight", tagline, one drop zone (`role="button"`, `tabindex=0`, Enter/Space opens the hidden file input, `aria-describedby` = hint + privacy note + error), privacy note visible, history under it when non-empty (title "Ostatnie analizy").
- Validation error: inline `role="alert"` text under the zone, no analyze call. PdfError (password/corrupt) during analysis: back to idle with the same inline error.
- Drag-over: zone text "Upuść plik, aby rozpocząć".
- Running: ProgressPanel h2 gets focus; `<ol>` with 4 steps (Wczytywanie pliku, Odczyt tekstu, Analiza AI, Gotowe), active one `aria-current="step"`, "Analiza AI 2/5" for chunk progress, "Skany: strona n z m" for scans; elapsed seconds outside the live region (`aria-live="off"`), current step name in an `aria-live="polite"` region; after 15 s "To trwa dłużej niż zwykle. Nadal pracujemy."; countdown "Spróbuj za 42 s" during a rate-limit wait; "Anuluj" always enabled: aborts, returns to idle, focus to the zone heading, polite announcement "Anulowano analizę".
- New file during a run: abort, start the new run, polite announcement.
- Error: ErrorPanel `role="alert"`, h2 gets focus, title + cause from `describeError`, "Spróbuj ponownie" only when `retry` is true (disabled during a countdown), "Wybierz inny plik" always. Retry reuses the same `RunState`. Offline (`isOnline()` false at failure) shows "Brak połączenia".
- Result: h2 gets focus; sections Podsumowanie, Najważniejsze punkty, Dokument (Język, Typ, Tytuł, Data, Strony), Podmioty, Kwoty (grouped by currency), Daty, Słowa kluczowe; null / [] -> "Brak danych"; lists collapse after 8 with a `aria-expanded` button "Pokaż wszystkie (n)"; blocks carry `lang` = document language and `dir="auto"`; tabs Podgląd / JSON (WAI-ARIA tabs, arrows, Home, End); buttons "Pobierz JSON", "Kopiuj JSON" (announces "Skopiowano" / "Nie udało się skopiować"), "Analizuj kolejny plik"; coverage line when `coverage` is set; model and file-name text only as text nodes, no links.
- Empty outcome: panel "Nie znaleziono tekstu w tym pliku." with "Wybierz inny plik".
- History: saved on a finished result (not for empty); item = button (name truncated with `title`, date, type) + separate "Usuń" button with `aria-label` "Usuń analizę pliku <name>"; "Wyczyść historię" asks inline confirmation; opening an entry shows the result without any analyze call.
- Footer: repo link and "Dane przetwarzane przez Google Gemini".
