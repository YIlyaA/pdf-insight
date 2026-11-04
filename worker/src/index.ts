import {
  AnalyzeRequestSchema,
  MAX_BODY_BYTES,
  SummarizeRequestSchema,
  type ApiErrorBody,
  type ErrorCode,
} from '../../src/lib/protocol';
import { sanitizeModelOutput } from '../../src/lib/sanitize';
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
  RATE_LIMITER?: RateLimiter;
}

interface Deps {
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 25_000;

const memoryLimiter = createMemoryLimiter(20, 60_000);

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
};

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
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

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Asks the model, validates the answer, retries once with a repair hint. */
async function generate<T>(
  env: Env,
  fetchImpl: typeof fetch,
  model: string,
  build: (hint?: string) => ModelRequest,
  validate: (raw: unknown) => Validated<T>,
): Promise<T | 'invalid'> {
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let hint: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await callGemini({
      apiKey: env.GEMINI_API_KEY ?? '',
      model,
      request: build(hint),
      timeoutMs,
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
): Promise<{ value: T } | { code: ErrorCode; upstreamStatus?: number }> {
  const models = [
    ...new Set([
      env.GEMINI_MODEL ?? DEFAULT_MODEL,
      env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL,
    ]),
  ];
  let code: ErrorCode = 'upstream_error';
  let upstreamStatus: number | undefined;
  for (const model of models) {
    try {
      const result = await generate(env, fetchImpl, model, build, validate);
      return result === 'invalid' ? { code: 'invalid_response' } : { value: result };
    } catch (error) {
      if (!(error instanceof GeminiError)) throw error;
      if (error.kind === 'quota' || error.kind === 'overloaded') {
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

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const origin = request.headers.get('origin');
  const allowed = origin !== null && allowedOrigins(env).includes(origin);

  if (!allowed) return fail('forbidden_origin', {});
  const cors = { 'access-control-allow-origin': origin, vary: 'Origin' };

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

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limiter = env.RATE_LIMITER ?? memoryLimiter;
  if (!(await limiter.limit({ key: ip })).success)
    return fail('rate_limited', cors, { 'retry-after': '60' });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail('payload_too_large', cors);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail('bad_request', cors);
  }

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
        ? { ok: true, value: summary.trim() }
        : { ok: false, error: 'summary: Required' };
    },
  );
  return 'code' in result ? failUpstream(result, cors) : json({ summary: result.value }, 200, cors);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
