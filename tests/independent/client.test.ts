// @vitest-environment node
import { createWorkerClient, type ClientOptions } from '../../src/api/client';
import { AppError } from '../../src/lib/errors';
import type { AnalyzeRequest, SummarizeRequest } from '../../src/lib/protocol';
import { makeInsight } from './helpers';

const BASE = 'https://worker.example';

const analyzeRequest: AnalyzeRequest = {
  fileName: 'a.pdf',
  totalPages: 1,
  chunk: { index: 0, total: 1, pages: [1, 1], text: 'Treść dokumentu' },
  images: [],
};
const summarizeRequest: SummarizeRequest = { language: 'pl', summaries: ['a', 'b'] };

type Handler = (init: RequestInit) => Response | Promise<Response>;
interface FetchCall {
  url: string;
  init: RequestInit;
  at: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const ok = (): Response => json(200, { insight: makeInsight() });
const errorBody = (code: string) => ({ error: { code, message: 'm' } });

function setup(handlers: Handler[], extra: Partial<ClientOptions> = {}) {
  const clock = { now: 1000 };
  const calls: FetchCall[] = [];
  const sleeps: number[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const requestInit = init ?? {};
    calls.push({ url: String(input), init: requestInit, at: clock.now });
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    if (!handler) throw new Error('no handler');
    return handler(requestInit);
  };
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      sleeps.push(ms);
      clock.now += ms;
      resolve();
    });
  const options: ClientOptions = {
    baseUrl: BASE,
    fetchImpl,
    sleep,
    now: () => clock.now,
    isOnline: () => true,
    ...extra,
  };
  return { client: createWorkerClient(options), calls, sleeps, clock, options };
}

const ctx = () => ({ signal: new AbortController().signal });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('configuration and connectivity', () => {
  it.each([undefined, ''])(
    'rejects not_configured before any fetch (baseUrl %j)',
    async (baseUrl) => {
      const { client, calls } = setup([ok], { baseUrl });
      await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({
        code: 'not_configured',
      });
      await expect(client.summarize(summarizeRequest, ctx())).rejects.toMatchObject({
        code: 'not_configured',
      });
      expect(calls).toHaveLength(0);
    },
  );

  it('rejects offline before sending when isOnline() is false', async () => {
    const { client, calls } = setup([ok], { isOnline: () => false });
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({ code: 'offline' });
    expect(calls).toHaveLength(0);
  });

  it('maps a fetch rejection while online to network', async () => {
    const { client } = setup([() => Promise.reject(new TypeError('Failed to fetch'))]);
    const error = await client.analyze(analyzeRequest, ctx()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'network' });
  });

  it('maps a fetch rejection to offline when the browser went offline meanwhile', async () => {
    let online = true;
    const { client } = setup(
      [
        () => {
          online = false;
          return Promise.reject(new TypeError('Failed to fetch'));
        },
      ],
      { isOnline: () => online },
    );
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('request shape', () => {
  it('POSTs JSON to /analyze with no-store and omitted credentials', async () => {
    const { client, calls } = setup([ok]);
    await client.analyze(analyzeRequest, ctx());
    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/analyze`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.cache).toBe('no-store');
    expect(call?.init.credentials).toBe('omit');
    expect(new Headers(call?.init.headers).get('content-type')).toMatch(/application\/json/);
    expect(JSON.parse(String(call?.init.body))).toEqual(analyzeRequest);
  });

  it('POSTs to /summarize with the summarize body', async () => {
    const { client, calls } = setup([() => json(200, { summary: 'razem' })]);
    await client.summarize(summarizeRequest, ctx());
    expect(calls[0]?.url).toBe(`${BASE}/summarize`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(summarizeRequest);
  });

  it('strips the trailing slash of baseUrl', async () => {
    const { client, calls } = setup([ok], { baseUrl: `${BASE}/` });
    await client.analyze(analyzeRequest, ctx());
    expect(calls[0]?.url).toBe(`${BASE}/analyze`);
  });
});

describe('responses', () => {
  it('returns the validated insight on 200', async () => {
    const { client } = setup([ok]);
    await expect(client.analyze(analyzeRequest, ctx())).resolves.toEqual(makeInsight());
  });

  it.each([
    ['empty insight object', { insight: {} }],
    ['missing insight', {}],
    [
      'insight with invalid date',
      {
        insight: { ...makeInsight(), document: { ...makeInsight().document, date: '2026-02-30' } },
      },
    ],
  ])('maps a 200 with %s to invalid_response', async (_name, body) => {
    const { client } = setup([() => json(200, body)]);
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps a 200 with a non-JSON body to invalid_response', async () => {
    const { client } = setup([() => new Response('<html>', { status: 200 })]);
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('returns the summary string', async () => {
    const { client } = setup([() => json(200, { summary: 'Całość.' })]);
    await expect(client.summarize(summarizeRequest, ctx())).resolves.toBe('Całość.');
  });

  it.each([[{ summary: '' }], [{ summary: 5 }], [{}]])(
    'maps summarize body %j to invalid_response',
    async (body) => {
      const { client } = setup([() => json(200, body)]);
      await expect(client.summarize(summarizeRequest, ctx())).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );
});

describe('error mapping', () => {
  it.each([
    [502, 'upstream_error'],
    [504, 'timeout'],
    [422, 'content_blocked'],
    [413, 'payload_too_large'],
    [403, 'forbidden_origin'],
    [400, 'bad_request'],
    [500, 'misconfigured'],
    [500, 'internal_error'],
  ])('uses the body code for status %i (%s)', async (status, code) => {
    const { client } = setup([() => json(status, errorBody(code))]);
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({ code });
  });

  it.each([
    [500, errorBody('something_new'), 'upstream_error'],
    [503, 'html page', 'upstream_error'],
    [400, errorBody('something_new'), 'bad_request'],
    [404, 'not json', 'bad_request'],
  ])('maps status %i with unknown/absent code to %s', async (status, body, expected) => {
    const handler = () =>
      typeof body === 'string' ? new Response(body, { status }) : json(status, body);
    const { client } = setup([handler]);
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({ code: expected });
  });
});

describe('pacing', () => {
  it('keeps 6 s between the starts of two requests', async () => {
    const { client, calls, sleeps } = setup([ok]);
    await client.analyze(analyzeRequest, ctx());
    expect(sleeps).toEqual([]);
    await client.analyze(analyzeRequest, ctx());
    expect(calls[1] && calls[0] ? calls[1].at - calls[0].at : 0).toBeGreaterThanOrEqual(6000);
    expect(sum(sleeps)).toBe(6000);
  });

  it('does not wait when the gap has already passed', async () => {
    const { client, clock, sleeps } = setup([ok]);
    await client.analyze(analyzeRequest, ctx());
    clock.now += 10_000;
    await client.analyze(analyzeRequest, ctx());
    expect(sleeps).toEqual([]);
  });

  it('honours a custom minGapMs', async () => {
    const { client, sleeps } = setup([ok], { minGapMs: 2000 });
    await client.analyze(analyzeRequest, ctx());
    await client.analyze(analyzeRequest, ctx());
    expect(sum(sleeps)).toBe(2000);
  });
});

describe('timeout', () => {
  it('maps a request that exceeds timeoutMs to client_timeout', async () => {
    const hang: Handler = (init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      });
    const { client } = setup([hang], { timeoutMs: 20 });
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({
      code: 'client_timeout',
    });
  });
});

describe('caller abort', () => {
  it('maps an abort during fetch to aborted (not network)', async () => {
    const controller = new AbortController();
    const { client } = setup([
      () => {
        controller.abort();
        return Promise.reject(new TypeError('Failed to fetch'));
      },
    ]);
    await expect(
      client.analyze(analyzeRequest, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'aborted',
    });
  });

  it('maps an abort during the pacing sleep to aborted without sending', async () => {
    const controller = new AbortController();
    const { client, calls } = setup([ok], {
      sleep: () => {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      },
    });
    await client.analyze(analyzeRequest, ctx());
    await expect(
      client.analyze(analyzeRequest, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(calls).toHaveLength(1);
  });

  it('maps an abort during the 429 countdown to aborted', async () => {
    const controller = new AbortController();
    const { client, calls } = setup([
      () => json(429, errorBody('rate_limited'), { 'Retry-After': '30' }),
      ok,
    ]);
    await expect(
      client.analyze(analyzeRequest, {
        signal: controller.signal,
        onRateLimitWait: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toHaveLength(1);
  });
});

describe('429 handling', () => {
  const limited =
    (retryAfter?: string): Handler =>
    () =>
      json(
        429,
        errorBody('rate_limited'),
        retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
      );

  it('waits Retry-After with a per-second countdown to 0, then retries once and succeeds', async () => {
    const { client, calls } = setup([limited('3'), ok]);
    const seen: number[] = [];
    const result = await client.analyze(analyzeRequest, {
      signal: new AbortController().signal,
      onRateLimitWait: (s) => seen.push(s),
    });
    expect(result).toEqual(makeInsight());
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual(analyzeRequest);
  });

  it('counts the resend against the 6 s gap rule', async () => {
    const { client, calls } = setup([limited('1'), ok]);
    await client.analyze(analyzeRequest, ctx());
    expect(calls[1] && calls[0] ? calls[1].at - calls[0].at : 0).toBeGreaterThanOrEqual(6000);
  });

  it.each([undefined, 'abc', '0', '-5'])(
    'falls back to 60 s when Retry-After is %j',
    async (header) => {
      const { client, sleeps } = setup([limited(header), ok]);
      const seen: number[] = [];
      await client.analyze(analyzeRequest, {
        signal: new AbortController().signal,
        onRateLimitWait: (s) => seen.push(s),
      });
      expect(seen[0]).toBe(60);
      expect(seen[seen.length - 1]).toBe(0);
      expect(sum(sleeps)).toBeGreaterThanOrEqual(60_000);
    },
  );

  it('uses fallbackRetryAfterSec when configured', async () => {
    const { client } = setup([limited(), ok], { fallbackRetryAfterSec: 7 });
    const seen: number[] = [];
    await client.analyze(analyzeRequest, {
      signal: new AbortController().signal,
      onRateLimitWait: (s) => seen.push(s),
    });
    expect(seen[0]).toBe(7);
  });

  it('gives up with rate_limited after maxRateLimitRetries retries', async () => {
    const { client, calls } = setup([limited('1')], { maxRateLimitRetries: 2 });
    await expect(client.analyze(analyzeRequest, ctx())).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(calls).toHaveLength(3);
  });

  it('throws quota_exceeded at once, without waiting or a countdown', async () => {
    const { client, calls, sleeps } = setup([
      () => json(429, errorBody('quota_exceeded'), { 'Retry-After': '5' }),
    ]);
    const onRateLimitWait = vi.fn();
    await expect(
      client.analyze(analyzeRequest, { signal: new AbortController().signal, onRateLimitWait }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(onRateLimitWait).not.toHaveBeenCalled();
  });
});
