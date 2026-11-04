import {
  AnalyzeRequestSchema,
  MAX_BODY_BYTES,
  SummarizeRequestSchema,
  type ApiErrorBody,
  type ErrorCode,
} from '../../src/lib/protocol';
import { LIMITS, sanitizeModelOutput } from '../../src/lib/sanitize';
import { extractJson, parseInsight } from '../../src/lib/schema';
import { callGemini, GeminiError } from './gemini';
import { createMemoryLimiter, type RateLimiter } from './limiter';
import { buildAnalyzeRequest, buildSummarizeRequest, type ModelRequest } from './prompt';

export interface Env {
  GEMINI_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
  GEMINI_TIMEOUT_MS?: string;
  /** Total time for all model calls of one request, in ms. Keeps the whole answer near the 30 s goal. */
  GEMINI_TOTAL_BUDGET_MS?: string;
  /** Per-IP limiter (Cloudflare rate limit binding). */
  RATE_LIMITER?: RateLimiter;
  /** One shared bucket for all callers: caps what a spread-out abuser can take from the free quota. */
  GLOBAL_LIMITER?: RateLimiter;
}

interface Deps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_TOTAL_BUDGET_MS = 28_000;
/** A model call with less time than this left is not worth starting. */
const MIN_ATTEMPT_MS = 1_000;

const memoryLimiter = createMemoryLimiter(10, 60_000);
const memoryGlobalLimiter = createMemoryLimiter(60, 60_000);

const STATUS: Record<ErrorCode, number> = {
  forbidden_origin: 403,
  bad_request: 400,
  payload_too_large: 413,
  rate_limited: 429,
  quota_exceeded: 429,
  upstream_error: 502,
  timeout: 504,
  invalid_response: 502,
  content_blocked: 422,
  misconfigured: 500,
  not_found: 404,
  method_not_allowed: 405,
  internal_error: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  forbidden_origin: 'Origin not allowed',
  bad_request: 'Invalid request',
  payload_too_large: 'Request body too large',
  rate_limited: 'Too many requests',
  quota_exceeded: 'AI provider quota exhausted',
  upstream_error: 'AI provider error',
  timeout: 'AI provider timed out',
  invalid_response: 'AI answer did not match the schema',
  content_blocked: 'Content blocked by the AI provider',
  misconfigured: 'Service misconfigured',
  not_found: 'Not found',
  method_not_allowed: 'Method not allowed',
  internal_error: 'Internal error',
};

/** Configured origins in the exact form browsers send (lowercase host, no path or trailing slash). */
function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '').split(',').flatMap((entry) => {
    try {
      const url = new URL(entry.trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? [url.origin] : [];
    } catch {
      return [];
    }
  });
}

/** Rate-limit key: IPv4 as is; IPv6 reduced to its /64 so one client cannot rotate through a whole block. */
function limiterKey(ip: string | null): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head = '', tail] = ip.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  if (front.length + back.length > (tail === undefined ? 8 : 7)) return ip;
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back];
  return `v6:${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}`;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function fail(
  code: ErrorCode,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { error: { code, message: MESSAGES[code] } };
  return json(body, STATUS[code], { ...cors, ...extra });
}

function failUpstream(
  result: { code: ErrorCode; upstreamStatus?: number },
  cors: Record<string, string>,
): Response {
  const extra: Record<string, string> =
    result.upstreamStatus === undefined
      ? {}
      : {
          'x-upstream-status': String(result.upstreamStatus),
          'access-control-expose-headers': 'x-upstream-status',
        };
  return fail(result.code, cors, extra);
}

interface Clock {
  now: () => number;
  /** Absolute time (same scale as now) after which no new model call starts. */
  deadline: number;
}

/** 429 with Retry-After, which the browser may read only if it is listed as exposed. */
function rateLimited(cors: Record<string, string>): Response {
  return fail('rate_limited', cors, {
    'retry-after': '60',
    'access-control-expose-headers': 'retry-after',
  });
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Asks the model, validates the answer, retries once with a repair hint. */
async function generate<T>(
  env: Env,
  fetchImpl: typeof fetch,
  model: string,
  build: (hint?: string) => ModelRequest,
  validate: (raw: unknown) => Validated<T>,
  clock: Clock,
): Promise<T | 'invalid'> {
  const callTimeout = Number(env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let hint: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = clock.deadline - clock.now();
    if (remaining < MIN_ATTEMPT_MS) throw new GeminiError('budget');
    const text = await callGemini({
      apiKey: env.GEMINI_API_KEY ?? '',
      model,
      request: build(hint),
      timeoutMs: Math.min(callTimeout, remaining),
      fetchImpl,
    });
    const result =
      text === null ? ({ ok: false, error: 'empty answer' } as const) : validate(extractJson(text));
    if (result.ok) return result.value;
    hint = result.error;
  }
  return 'invalid';
}

async function runWithFallback<T>(
  env: Env,
  fetchImpl: typeof fetch,
  build: (hint?: string) => ModelRequest,
  validate: (raw: unknown) => Validated<T>,
  clock: Clock,
): Promise<{ value: T } | { code: ErrorCode; upstreamStatus?: number }> {
  const models = [
    ...new Set([
      env.GEMINI_MODEL ?? DEFAULT_MODEL,
      env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL,
    ]),
  ];
  let code: ErrorCode = 'upstream_error';
  let upstreamStatus: number | undefined;
  let seen = false;
  for (const model of models) {
    try {
      const result = await generate(env, fetchImpl, model, build, validate, clock);
      return result === 'invalid' ? { code: 'invalid_response' } : { value: result };
    } catch (error) {
      if (!(error instanceof GeminiError)) throw error;
      if (error.kind === 'budget') return seen ? { code, upstreamStatus } : { code: 'timeout' };
      if (error.kind === 'quota' || error.kind === 'overloaded') {
        seen = true;
        code = error.kind === 'quota' ? 'quota_exceeded' : 'upstream_error';
        upstreamStatus = error.status;
        continue;
      }
      const map = {
        upstream: 'upstream_error',
        auth: 'misconfigured',
        timeout: 'timeout',
        blocked: 'content_blocked',
      } as const;
      return { code: map[error.kind as keyof typeof map], upstreamStatus: error.status };
    }
  }
  return { code, upstreamStatus };
}

/** Reads the body as UTF-8 text, stopping as soon as it passes the cap. Returns null when too large. */
async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Never lets a limiter outage take the service down: falls back to the in-memory limiter. */
async function allow(
  limiter: RateLimiter | undefined,
  fallback: RateLimiter,
  key: string,
): Promise<boolean> {
  try {
    return (await (limiter ?? fallback).limit({ key })).success;
  } catch {
    return (await fallback.limit({ key })).success;
  }
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowed = origin !== null && allowedOrigins(env).includes(origin);

  if (!allowed) return fail('forbidden_origin', {});
  const cors = { 'access-control-allow-origin': origin, vary: 'Origin' };
  try {
    return await route(request, env, deps, cors);
  } catch {
    return fail('internal_error', cors);
  }
}

async function route(
  request: Request,
  env: Env,
  deps: Deps,
  cors: Record<string, string>,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }

  const path = new URL(request.url).pathname;
  if (path !== '/analyze' && path !== '/summarize') return fail('not_found', cors);
  if (request.method !== 'POST')
    return fail('method_not_allowed', cors, { allow: 'POST, OPTIONS' });

  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    return fail('payload_too_large', cors);
  if (!env.GEMINI_API_KEY) return fail('misconfigured', cors);

  const ip = limiterKey(request.headers.get('cf-connecting-ip'));
  if (!(await allow(env.RATE_LIMITER, memoryLimiter, ip))) return rateLimited(cors);
  if (!(await allow(env.GLOBAL_LIMITER, memoryGlobalLimiter, 'global'))) return rateLimited(cors);

  const text = await readBodyCapped(request, MAX_BODY_BYTES);
  if (text === null) return fail('payload_too_large', cors);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail('bad_request', cors);
  }

  const budget = Number(env.GEMINI_TOTAL_BUDGET_MS) || DEFAULT_TOTAL_BUDGET_MS;
  const clock: Clock = { now, deadline: now() + budget };

  if (path === '/analyze') {
    const parsed = AnalyzeRequestSchema.safeParse(payload);
    if (!parsed.success) return fail('bad_request', cors);
    const req = parsed.data;
    const meta = { fileName: req.fileName, totalPages: req.totalPages };
    const result = await runWithFallback(
      env,
      fetchImpl,
      (hint) => buildAnalyzeRequest(req, hint),
      (raw): Validated<unknown> => {
        const checked = parseInsight(sanitizeModelOutput(raw, meta));
        return checked.success
          ? { ok: true, value: checked.data }
          : { ok: false, error: checked.error };
      },
      clock,
    );
    return 'code' in result
      ? failUpstream(result, cors)
      : json({ insight: result.value }, 200, cors);
  }

  const parsed = SummarizeRequestSchema.safeParse(payload);
  if (!parsed.success) return fail('bad_request', cors);
  const req = parsed.data;
  const result = await runWithFallback(
    env,
    fetchImpl,
    (hint) => buildSummarizeRequest(req, hint),
    (raw): Validated<string> => {
      const summary =
        typeof raw === 'object' && raw !== null
          ? (raw as { summary?: unknown }).summary
          : undefined;
      return typeof summary === 'string' && summary.trim()
        ? { ok: true, value: summary.trim().slice(0, LIMITS.summary) }
        : { ok: false, error: 'summary: Required' };
    },
    clock,
  );
  return 'code' in result ? failUpstream(result, cors) : json({ summary: result.value }, 200, cors);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
