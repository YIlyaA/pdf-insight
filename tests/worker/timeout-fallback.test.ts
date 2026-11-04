// @vitest-environment node
import { handle, type Env } from '../../worker/src/index';

const ORIGIN = 'https://yilyaa.github.io';

const env = (over: Partial<Env> = {}): Env => ({
  GEMINI_API_KEY: 'test-secret-key-123',
  ALLOWED_ORIGINS: ORIGIN,
  GEMINI_MODEL: 'primary-model',
  GEMINI_FALLBACK_MODEL: 'fallback-model',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  ...over,
});

const request = () =>
  new Request('https://api.example/analyze', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
    body: JSON.stringify({
      fileName: 'umowa.pdf',
      totalPages: 1,
      chunk: { index: 0, total: 1, pages: [1, 1], text: 'Treść umowy' },
      images: [],
    }),
  });

const answer = {
  document: { fileName: 'x', pages: 1, language: 'pl', type: 'umowa', title: 'U', date: null },
  summary: 'Jedno. Dwa. Trzy.',
  keyPoints: ['a'],
  entities: { organizations: [], people: [] },
  amounts: [],
  dates: [],
  keywords: ['k'],
};

describe('slow primary model', () => {
  it('tries the fallback model when the primary one times out', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url.includes('primary-model')) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' },
            ],
          }),
        ),
      );
    });
    const res = await handle(request(), env({ GEMINI_TIMEOUT_MS: '20' }), { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('fallback-model');
  });
});
