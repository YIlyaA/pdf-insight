// @vitest-environment node
import { handle, type Env } from '../../worker/src/index';
import { createMemoryLimiter } from '../../worker/src/limiter';

const ORIGIN = 'https://yilyaa.github.io';
const KEY = 'test-secret-key-123';

const validModelOutput = {
  document: {
    fileName: 'x',
    pages: 1,
    language: 'pl',
    type: 'umowa',
    title: 'Umowa',
    date: '2026-03-12',
  },
  summary: 'Jedno. Dwa. Trzy.',
  keyPoints: ['a'],
  entities: { organizations: ['Firma sp. z o.o.'], people: [] },
  amounts: [{ value: 12300, currency: 'PLN', context: 'abonament' }],
  dates: [{ date: '2026-10-12', context: 'go-live' }],
  keywords: ['crm'],
};

const geminiOk = (payload: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
          },
          finishReason: 'STOP',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
const geminiStatus = (status: number, apiStatus = 'ERROR') =>
  new Response(JSON.stringify({ error: { code: status, status: apiStatus, message: 'x' } }), {
    status,
  });

const body = (over: Record<string, unknown> = {}) => ({
  fileName: 'umowa.pdf',
  totalPages: 4,
  chunk: { index: 0, total: 1, pages: [1, 4], text: 'Treść umowy' },
  images: [],
  ...over,
});

const post = (payload: unknown, headers: Record<string, string> = {}, path = '/analyze') =>
  new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'cf-connecting-ip': '1.2.3.4',
      ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const env = (over: Partial<Env> = {}): Env => ({
  GEMINI_API_KEY: KEY,
  ALLOWED_ORIGINS: ORIGIN,
  GEMINI_MODEL: 'primary-model',
  GEMINI_FALLBACK_MODEL: 'fallback-model',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  ...over,
});

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe('CORS and routing', () => {
  it('answers a preflight from the allowed origin', async () => {
    const res = await handle(
      new Request('https://api.example/analyze', {
        method: 'OPTIONS',
        headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
      }),
      env(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('rejects a preflight from another origin', async () => {
    const res = await handle(
      new Request('https://api.example/analyze', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
      env(),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each([
    'https://evil.example',
    'https://yilyaa.github.io.evil.example',
    'http://yilyaa.github.io',
    'null',
  ])('rejects origin %s without calling the model', async (origin) => {
    const fetchImpl = vi.fn();
    const res = await handle(post(body(), { origin }), env(), { fetchImpl });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('forbidden_origin');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a request without an Origin header', async () => {
    const req = new Request('https://api.example/analyze', {
      method: 'POST',
      body: JSON.stringify(body()),
    });
    expect((await handle(req, env())).status).toBe(403);
  });

  it('allows several configured origins', async () => {
    const e = env({ ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:5173` });
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk(validModelOutput));
    const res = await handle(post(body(), { origin: 'http://localhost:5173' }), e, { fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('returns 404 for unknown paths and 405 for wrong methods', async () => {
    expect((await handle(post(body(), {}, '/nope'), env())).status).toBe(404);
    const get = new Request('https://api.example/analyze', { headers: { origin: ORIGIN } });
    expect((await handle(get, env())).status).toBe(405);
  });

  it('includes CORS headers on error responses so the browser can read them', async () => {
    const res = await handle(post('not json'), env());
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});

describe('request validation and limits', () => {
  it.each([
    ['invalid JSON', 'not json'],
    ['missing chunk', { fileName: 'a.pdf', totalPages: 1 }],
    ['negative pages', body({ totalPages: -1 })],
    [
      'empty text and no images',
      body({ chunk: { index: 0, total: 1, pages: [1, 1], text: '  ' } }),
    ],
    [
      'wrong image type',
      body({ images: [{ page: 1, mimeType: 'image/gif', dataBase64: 'QQ==' }] }),
    ],
    ['empty file name', body({ fileName: '' })],
  ])('returns 400 bad_request for %s', async (_n, payload) => {
    const fetchImpl = vi.fn();
    const res = await handle(post(payload), env(), { fetchImpl });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('bad_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a chunk with only scanned images', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk(validModelOutput));
    const payload = body({
      chunk: { index: 0, total: 1, pages: [1, 1], text: '' },
      images: [{ page: 1, mimeType: 'image/jpeg', dataBase64: 'QUJD' }],
    });
    expect((await handle(post(payload), env(), { fetchImpl })).status).toBe(200);
  });

  it('returns 413 when the declared body is too large', async () => {
    const res = await handle(post(body(), { 'content-length': String(50 * 1024 * 1024) }), env());
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toBe('payload_too_large');
  });

  it('returns 413 when the actual body is too large', async () => {
    const big = body({
      chunk: { index: 0, total: 1, pages: [1, 1], text: 'a'.repeat(9 * 1024 * 1024) },
    });
    expect((await handle(post(big), env())).status).toBe(413);
  });

  it('returns 429 rate_limited with Retry-After when the limiter says no', async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const fetchImpl = vi.fn();
    const res = await handle(post(body()), env({ RATE_LIMITER: limiter }), { fetchImpl });
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(limiter.limit).toHaveBeenCalledWith({ key: '1.2.3.4' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports misconfiguration without calling the model when the key is missing', async () => {
    const fetchImpl = vi.fn();
    const res = await handle(post(body()), env({ GEMINI_API_KEY: undefined }), { fetchImpl });
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe('misconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('analyze', () => {
  it('returns a validated insight and overrides fileName and pages from the request', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk(validModelOutput));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      insight: { document: { fileName: string; pages: number } };
    };
    expect(json.insight.document.fileName).toBe('umowa.pdf');
    expect(json.insight.document.pages).toBe(4);
  });

  it('sends the key in a header, never in the URL, and never returns it', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk(validModelOutput));
    const res = await handle(post(body()), env(), { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect(url).toContain('primary-model:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(await res.text()).not.toContain(KEY);
  });

  it('requests JSON output with temperature 0', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk(validModelOutput));
    await handle(post(body()), env(), { fetchImpl });
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      generationConfig: { responseMimeType: string; temperature: number };
    };
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.temperature).toBe(0);
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => geminiOk('```json\n' + JSON.stringify(validModelOutput) + '\n```'));
    expect((await handle(post(body()), env(), { fetchImpl })).status).toBe(200);
  });

  it('retries once with a repair hint when the first answer is invalid', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(geminiOk('{"summary": ""}'))
      .mockResolvedValueOnce(geminiOk(validModelOutput));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string;
    expect(second).toMatch(/previous answer was invalid/i);
  });

  it('gives up after exactly one retry with invalid_response', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk('not json at all'));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe('invalid_response');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats an empty candidate list as an invalid answer', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(await errorOf(res)).toBe('invalid_response');
  });

  it('reports content blocked by the model safety filter', async () => {
    const blocked = new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), {
      status: 200,
    });
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockImplementation(() => blocked),
    });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toBe('content_blocked');
  });

  it('falls back to the second model when the first hits its quota', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(geminiStatus(429, 'RESOURCE_EXHAUSTED'))
      .mockResolvedValueOnce(geminiOk(validModelOutput));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(200);
    expect((fetchImpl.mock.calls[1] as [string])[0]).toContain('fallback-model');
  });

  it('falls back to the second model when the first is overloaded (503)', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => geminiStatus(503, 'UNAVAILABLE'))
      .mockImplementationOnce(() => geminiOk(validModelOutput));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(200);
    expect((fetchImpl.mock.calls[1] as [string])[0]).toContain('fallback-model');
  });

  it('returns upstream_error with the status when every model is overloaded', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiStatus(503, 'UNAVAILABLE'));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(await errorOf(res)).toBe('upstream_error');
    expect(res.headers.get('x-upstream-status')).toBe('503');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns quota_exceeded when every model is out of quota', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiStatus(429, 'RESOURCE_EXHAUSTED'));
    const res = await handle(post(body()), env(), { fetchImpl });
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe('quota_exceeded');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns upstream_error for server errors from the provider', async () => {
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockImplementation(() => geminiStatus(500)),
    });
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toBe('upstream_error');
  });

  it('exposes only the numeric provider status in a header for diagnostics', async () => {
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockImplementation(() => geminiStatus(404, 'NOT_FOUND')),
    });
    expect(await errorOf(res)).toBe('upstream_error');
    expect(res.headers.get('x-upstream-status')).toBe('404');
    expect(res.headers.get('access-control-expose-headers')).toMatch(/x-upstream-status/i);
  });

  it('returns misconfigured when the provider rejects the key', async () => {
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockImplementation(() => geminiStatus(403, 'PERMISSION_DENIED')),
    });
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe('misconfigured');
  });

  it('returns timeout when the provider does not answer in time', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const res = await handle(post(body()), env({ GEMINI_TIMEOUT_MS: '20' }), { fetchImpl });
    expect(res.status).toBe(504);
    expect(await errorOf(res)).toBe('timeout');
  });

  it('returns upstream_error when the network call itself throws', async () => {
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('network')),
    });
    expect(await errorOf(res)).toBe('upstream_error');
  });

  it('does not leak provider error details to the client', async () => {
    const leaky = new Response(JSON.stringify({ error: { message: `secret detail ${KEY}` } }), {
      status: 500,
    });
    const res = await handle(post(body()), env(), {
      fetchImpl: vi.fn().mockImplementation(() => leaky),
    });
    expect(await res.text()).not.toMatch(/secret detail/);
  });
});

describe('summarize', () => {
  it('merges partial summaries into one summary', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk({ summary: 'Jedno. Dwa. Trzy.' }));
    const res = await handle(
      post({ language: 'pl', summaries: ['A.', 'B.'] }, {}, '/summarize'),
      env(),
      { fetchImpl },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: string }).summary).toBe('Jedno. Dwa. Trzy.');
  });

  it.each([
    ['bad language', { language: 'polish', summaries: ['A.'] }],
    ['no summaries', { language: 'pl', summaries: [] }],
    ['too many', { language: 'pl', summaries: Array.from({ length: 51 }, () => 'a') }],
  ])('rejects %s', async (_n, payload) => {
    expect((await handle(post(payload, {}, '/summarize'), env())).status).toBe(400);
  });

  it('returns invalid_response when the model gives no summary', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => geminiOk({ nope: 1 }));
    const res = await handle(post({ language: 'pl', summaries: ['A.'] }, {}, '/summarize'), env(), {
      fetchImpl,
    });
    expect(await errorOf(res)).toBe('invalid_response');
  });
});

describe('createMemoryLimiter', () => {
  it('allows up to the limit per key within the window, then blocks', async () => {
    let now = 0;
    const limiter = createMemoryLimiter(3, 60_000, () => now);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push((await limiter.limit({ key: 'a' })).success);
    expect(results).toEqual([true, true, true, false]);
    expect((await limiter.limit({ key: 'b' })).success).toBe(true);
    now = 60_001;
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
  });

  it('does not grow without bound', async () => {
    let now = 0;
    const limiter = createMemoryLimiter(1, 1000, () => now, 100);
    for (let i = 0; i < 500; i += 1) {
      now += 2000;
      await limiter.limit({ key: `k${i}` });
    }
    expect(limiter.size()).toBeLessThanOrEqual(100);
  });
});
