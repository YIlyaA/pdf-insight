import { AppError, type ClientErrorCode } from '../lib/errors';
import {
  ERROR_CODES,
  type AnalyzeRequest,
  type ErrorCode,
  type SummarizeRequest,
} from '../lib/protocol';
import { InsightSchema, type Insight } from '../lib/schema';

export interface CallContext {
  signal: AbortSignal;
  /** Called every second while waiting after a 429 (secondsLeft counts down to 0). */
  onRateLimitWait?: (secondsLeft: number) => void;
}

export interface ClientOptions {
  /** VITE_API_URL; undefined or '' -> AppError('not_configured') before any fetch. */
  baseUrl: string | undefined;
  fetchImpl?: typeof fetch;
  /** Rejects when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Default: navigator.onLine !== false. */
  isOnline?: () => boolean;
  /** Default 6000, between the START of two requests. */
  minGapMs?: number;
  /** Default 45000 per request -> AppError('client_timeout'). */
  timeoutMs?: number;
  /** Default 3 per call, then AppError('rate_limited'). */
  maxRateLimitRetries?: number;
  /** Default 60, used when Retry-After is missing or invalid. */
  fallbackRetryAfterSec?: number;
}

export interface WorkerClient {
  analyze(request: AnalyzeRequest, ctx: CallContext): Promise<Insight>;
  summarize(request: SummarizeRequest, ctx: CallContext): Promise<string>;
}

interface RawResponse {
  status: number;
  retryAfter: string | null;
  body: unknown;
}

/** Pause before the single retry after a provider overload. */
const OVERLOAD_RETRY_DELAY_MS = 2000;

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AppError('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppError('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

const defaultIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads `key` from a JSON object body; undefined for anything else. */
function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

/** Worker code from `{error:{code}}`, else a fallback from the status. */
function errorCodeOf(response: RawResponse): ErrorCode {
  const code = field(field(response.body, 'error'), 'code');
  if (isErrorCode(code)) return code;
  if (response.status === 429) return 'rate_limited';
  return response.status >= 500 ? 'upstream_error' : 'bad_request';
}

function retryAfterSeconds(header: string | null, fallback: number): number {
  const value = header?.trim() ?? '';
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : fallback;
}

/** Talks to the Worker one request at a time, paced and with 429 handling (spec 11.2). */
export function createWorkerClient(options: ClientOptions): WorkerClient {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const minGapMs = options.minGapMs ?? 6000;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxRetries = options.maxRateLimitRetries ?? 3;
  const fallbackSec = options.fallbackRetryAfterSec ?? 60;
  let lastStart: number | undefined;

  const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw new AppError('aborted');
  };

  /** Sleeps; an abort (in the sleep or before it) becomes AppError('aborted'). */
  async function wait(ms: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    try {
      await sleep(ms, signal);
    } catch (error) {
      if (signal.aborted || (error instanceof AppError && error.code === 'aborted')) {
        throw new AppError('aborted');
      }
      throw error;
    }
  }

  async function pace(signal: AbortSignal): Promise<void> {
    const gap = lastStart === undefined ? 0 : lastStart + minGapMs - now();
    if (gap > 0) await wait(gap, signal);
  }

  async function countdown(seconds: number, ctx: CallContext): Promise<void> {
    for (let left = seconds; left > 0; left -= 1) {
      ctx.onRateLimitWait?.(left);
      await wait(1000, ctx.signal);
    }
    ctx.onRateLimitWait?.(0);
  }

  /** One HTTP exchange including the body read, under the per-request timeout. */
  async function send(url: string, body: string, signal: AbortSignal): Promise<RawResponse> {
    await pace(signal);
    throwIfAborted(signal);
    if (!isOnline()) throw new AppError('offline');
    lastStart = now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
        body: parseJson(text),
      };
    } catch {
      const code: ClientErrorCode = signal.aborted
        ? 'aborted'
        : timedOut
          ? 'client_timeout'
          : isOnline()
            ? 'network'
            : 'offline';
      throw new AppError(code);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Sends until a 2xx body arrives; waits out `rate_limited` 429s up to maxRetries. */
  async function post(path: string, payload: unknown, ctx: CallContext): Promise<unknown> {
    const baseUrl = options.baseUrl?.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new AppError('not_configured');
    throwIfAborted(ctx.signal);
    if (!isOnline()) throw new AppError('offline');
    const url = `${baseUrl}${path}`;
    const body = JSON.stringify(payload);
    let overloadRetried = false;
    for (let attempt = 0; ; attempt += 1) {
      const response = await send(url, body, ctx.signal);
      if (response.status >= 200 && response.status < 300) return response.body;
      const code = errorCodeOf(response);
      // The provider was overloaded for a moment: one short second try before showing an error.
      if (response.status === 502 && code === 'upstream_error' && !overloadRetried) {
        overloadRetried = true;
        await wait(OVERLOAD_RETRY_DELAY_MS, ctx.signal);
        continue;
      }
      const waitable = response.status === 429 && code === 'rate_limited';
      if (!waitable || attempt >= maxRetries) throw new AppError(code);
      await countdown(retryAfterSeconds(response.retryAfter, fallbackSec), ctx);
    }
  }

  return {
    async analyze(request, ctx) {
      const parsed = InsightSchema.safeParse(
        field(await post('/analyze', request, ctx), 'insight'),
      );
      if (!parsed.success) throw new AppError('invalid_response');
      return parsed.data;
    },
    async summarize(request, ctx) {
      const summary = field(await post('/summarize', request, ctx), 'summary');
      if (typeof summary !== 'string' || summary.trim() === '') {
        throw new AppError('invalid_response');
      }
      return summary;
    },
  };
}
