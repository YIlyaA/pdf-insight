// @vitest-environment node
import { createWorkerClient } from '../../src/api/client';
import type { AnalyzeRequest } from '../../src/lib/protocol';
import { makeInsight } from '../independent/helpers';

const request: AnalyzeRequest = {
  fileName: 'a.pdf',
  totalPages: 1,
  chunk: { index: 0, total: 1, pages: [1, 1], text: 'Treść dokumentu' },
  images: [],
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: string) => json(status, { error: { code, message: 'm' } });

function setup(responses: Response[]) {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (!next) throw new Error('no response');
    return next.clone();
  };
  const client = createWorkerClient({
    baseUrl: 'https://worker.example',
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
    isOnline: () => true,
    minGapMs: 0,
  });
  return { client, calls: () => calls };
}
const ctx = () => ({ signal: new AbortController().signal });

describe('one retry after a provider overload', () => {
  it('repeats the request once when the Worker says upstream_error, and succeeds', async () => {
    const { client, calls } = setup([
      failure(502, 'upstream_error'),
      json(200, { insight: makeInsight() }),
    ]);
    await expect(client.analyze(request, ctx())).resolves.toBeTruthy();
    expect(calls()).toBe(2);
  });

  it('gives up after that single retry', async () => {
    const { client, calls } = setup([failure(502, 'upstream_error')]);
    await expect(client.analyze(request, ctx())).rejects.toMatchObject({ code: 'upstream_error' });
    expect(calls()).toBe(2);
  });

  it.each([
    [502, 'invalid_response'],
    [504, 'timeout'],
    [429, 'quota_exceeded'],
  ])('does not repeat %i %s', async (status, code) => {
    const { client, calls } = setup([failure(status, code)]);
    await expect(client.analyze(request, ctx())).rejects.toMatchObject({ code });
    expect(calls()).toBe(1);
  });
});
