import { act, fireEvent } from '@testing-library/react';
import type { AppServices, RunContext } from '../../src/App';
import type { Insight } from '../../src/lib/schema';
import type { Outcome } from '../../src/lib/pipeline';
import type { StorageLike } from '../../src/lib/history';

export const NOW = 1_800_000_000_000;

export function makeInsight(overrides: Record<string, unknown> = {}): Insight {
  return {
    document: {
      fileName: 'raport.pdf',
      pages: 3,
      language: 'en',
      type: 'raport',
      title: 'Quarterly report',
      date: '2026-09-01',
    },
    summary: 'The company grew in the third quarter.',
    keyPoints: ['Revenue up', 'Costs down'],
    entities: { organizations: ['Acme Corp'], people: ['Jane Doe'] },
    amounts: [{ value: 1234.5, currency: 'PLN', context: 'Total revenue' }],
    dates: [{ date: '2026-09-30', context: 'Quarter end' }],
    keywords: ['growth', 'revenue'],
    ...overrides,
  } as Insight;
}

export function resultOutcome(insight: Insight = makeInsight(), coverage: { analyzedTo: number; totalPages: number } | null = null): Outcome {
  return { kind: 'result', insight, coverage };
}

export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

export function pdfFile(name = 'raport.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], name, {
    type: 'application/pdf',
  });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function baseServices(overrides: Partial<AppServices> = {}): AppServices {
  return {
    validate: async () => ({ ok: true }),
    analyze: async () => resultOutcome(),
    storage: memoryStorage(),
    now: () => NOW,
    isOnline: () => true,
    writeClipboard: async () => undefined,
    ...overrides,
  };
}

/** An analyze fake that stays pending and records each run context. */
export function pendingAnalyze() {
  const runs: { run: RunContext; d: Deferred<Outcome> }[] = [];
  const analyze = vi.fn((_file: File, run: RunContext) => {
    const d = deferred<Outcome>();
    runs.push({ run, d });
    return d.promise;
  });
  return { analyze, runs };
}

export function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error('no file input');
  return el as HTMLInputElement;
}

export function pick(container: HTMLElement, file: File): void {
  fireEvent.change(fileInput(container), { target: { files: [file] } });
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
