// @vitest-environment node
import { readFileSync } from 'node:fs';

interface Ratelimit {
  name: string;
  simple: { limit: number; period: number };
}

function readLimits(): Ratelimit[] {
  const raw = readFileSync('worker/wrangler.jsonc', 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return (JSON.parse(raw) as { ratelimits: Ratelimit[] }).ratelimits;
}

describe('Worker request limits', () => {
  const limit = (name: string) => readLimits().find((l) => l.name === name)?.simple;

  it('allows one visitor a full run (12 requests, 6 s apart) per minute', () => {
    expect(limit('RATE_LIMITER')).toEqual({ limit: 10, period: 60 });
  });

  it('caps all visitors together at 30 requests a minute (one request can cost up to 4 model calls)', () => {
    expect(limit('GLOBAL_LIMITER')).toEqual({ limit: 30, period: 60 });
  });
});
