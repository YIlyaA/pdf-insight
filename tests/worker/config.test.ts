// @vitest-environment node
import { readFileSync } from 'node:fs';

/** wrangler.jsonc allows comments and trailing commas; strip them for a plain JSON.parse. */
function readConfig(): { vars: Record<string, string> } {
  const raw = readFileSync('worker/wrangler.jsonc', 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw) as { vars: Record<string, string> };
}

describe('Worker time settings', () => {
  const vars = readConfig().vars;
  const perCall = Number(vars['GEMINI_TIMEOUT_MS']);
  const total = Number(vars['GEMINI_TOTAL_BUDGET_MS']);

  it('finishes before the browser gives up (45 s, minus upload time)', () => {
    expect(total).toBeLessThanOrEqual(40_000);
  });

  it('leaves the fallback model enough time after a primary timeout', () => {
    expect(total - perCall).toBeGreaterThanOrEqual(12_000);
  });
});
