import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { AppError } from '../../src/lib/errors';
import { PdfError } from '../../src/lib/pdfText';
import { HISTORY_KEY, HISTORY_TTL_MS, loadHistory } from '../../src/lib/history';
import { downloadFileName } from '../../src/lib/format';
import {
  NOW,
  baseServices,
  deferred,
  first,
  flush,
  makeInsight,
  memoryStorage,
  pdfFile,
  pendingAnalyze,
  pick,
  resultOutcome,
} from './ui-helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function toResult(
  insight = makeInsight(),
  overrides = {},
  coverage: { analyzedTo: number; totalPages: number } | null = null,
) {
  const services = baseServices({
    analyze: async () => resultOutcome(insight, coverage),
    ...overrides,
  });
  const utils = render(<App services={services} />);
  pick(utils.container, pdfFile('Raport 2026.pdf'));
  await screen.findByRole('heading', { level: 2, name: 'Podsumowanie' }).catch(() => undefined);
  await screen.findByRole('tab', { name: 'Podgląd' });
  return { ...utils, services };
}

function seedEntry(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${i}`,
    fileName: `plik-${i}.pdf`,
    savedAt: NOW - i * 1000,
    insight: makeInsight({ summary: `Summary ${i}` }),
    ...extra,
  };
}

function dropZone(): HTMLElement {
  return screen.getByRole('button', { name: /Wybierz plik|Przeciągnij/ });
}

describe('idle screen', () => {
  it('shows h1, tagline, a single drop zone and no notice paragraph', () => {
    render(<App services={baseServices()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'PDF Insight' })).toBeInTheDocument();
    expect(
      screen.getByText('Wgraj PDF, a dostaniesz krótkie podsumowanie i dane w formacie JSON.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Treść pliku zostanie wysłana/)).not.toBeInTheDocument();
    expect(dropZone()).toHaveAttribute('tabindex', '0');
    const ids = (dropZone().getAttribute('aria-describedby') ?? '').split(/\s+/);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toContain('Tylko PDF, maks. 10 MB.');
    expect(screen.queryByText(/Plik zostanie wysłany/)).not.toBeInTheDocument();
  });

  it('hides history when empty', () => {
    render(<App services={baseServices()} />);
    expect(screen.queryByText('Ostatnie analizy')).not.toBeInTheDocument();
  });

  it('shows footer link and the privacy button without the old provider note', () => {
    render(<App services={baseServices()} />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link')).toHaveAttribute('href');
    expect(within(footer).getByRole('button', { name: 'Prywatność' })).toBeInTheDocument();
    expect(screen.queryByText('Dane przetwarzane przez Google Gemini')).not.toBeInTheDocument();
  });

  it.each(['{Enter}', ' '])('opens the file picker from the keyboard with %j', async (key) => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App services={baseServices()} />);
    await user.tab();
    expect(dropZone()).toHaveFocus();
    await user.keyboard(key);
    expect(click).toHaveBeenCalled();
  });

  it('shows drag-over text', () => {
    render(<App services={baseServices()} />);
    fireEvent.dragEnter(dropZone(), {
      dataTransfer: { files: [], types: ['Files'] },
    });
    expect(screen.getByText('Upuść plik, aby rozpocząć')).toBeInTheDocument();
  });
});

describe('validation and pdf errors', () => {
  it('shows validation error inline with role alert and does not call analyze', async () => {
    const analyze = vi.fn();
    const message = 'To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.';
    const { container } = render(
      <App
        services={baseServices({
          analyze,
          validate: async () => ({ ok: false, code: 'not_pdf', message }),
        })}
      />,
    );
    pick(container, new File(['x'], 'a.txt', { type: 'text/plain' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(analyze).not.toHaveBeenCalled();
    const ids = (dropZone().getAttribute('aria-describedby') ?? '').split(/\s+/);
    expect(ids).toContain(alert.id);
  });

  it.each([
    ['password', 'Plik jest chroniony hasłem. Zdejmij zabezpieczenie i spróbuj ponownie.'],
    ['corrupt', 'Nie udało się odczytać pliku. Może być uszkodzony.'],
  ] as const)('shows PdfError %s inline and returns to idle', async (code, text) => {
    const { container } = render(
      <App
        services={baseServices({
          analyze: async () => {
            throw new PdfError(code);
          },
        })}
      />,
    );
    pick(container, pdfFile());
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(dropZone()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anuluj' })).not.toBeInTheDocument();
  });
});

describe('progress panel', () => {
  it('focuses the heading, lists 4 steps and marks the current one', async () => {
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    act(() => first(runs).run.onProgress({ phase: 'reading' }));
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('ol'));
    expect(items).toHaveLength(4);
    const current = items.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Odczyt tekstu');
    expect(items.map((li) => li.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Wczytywanie pliku'),
        expect.stringContaining('Analiza AI'),
        expect.stringContaining('Gotowe'),
      ]),
    );
  });

  it('shows chunk and scan counters', async () => {
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => first(runs).run.onProgress({ phase: 'analyzing', done: 2, total: 5 }));
    expect(screen.getByText(/Analiza AI 2\/5/)).toBeInTheDocument();
    act(() => first(runs).run.onProgress({ phase: 'scanning', page: 2, total: 5 }));
    expect(screen.getByText(/Skany: strona 2 z 5/)).toBeInTheDocument();
  });

  it('keeps elapsed seconds out of the polite live region', async () => {
    vi.useFakeTimers();
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(
      <App services={baseServices({ analyze, now: () => Date.now() })} />,
    );
    pick(container, pdfFile());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => first(runs).run.onProgress({ phase: 'reading' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    const polite = container.querySelectorAll('[aria-live="polite"]');
    expect(polite.length).toBeGreaterThan(0);
    const text = Array.from(polite)
      .map((e) => e.textContent)
      .join(' ');
    expect(text).toContain('Odczyt tekstu');
    expect(text).not.toMatch(/\d+\s*s\b/);
    expect(container.querySelector('[aria-live="off"]')).not.toBeNull();
  });

  it('shows the slow message only after 15 seconds', async () => {
    vi.useFakeTimers();
    const { analyze } = pendingAnalyze();
    const { container } = render(
      <App services={baseServices({ analyze, now: () => Date.now() })} />,
    );
    pick(container, pdfFile());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14000);
    });
    expect(screen.queryByText(/To trwa dłużej niż zwykle/)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(/To trwa dłużej niż zwykle\. Nadal pracujemy\./)).toBeInTheDocument();
  });

  it('shows the rate-limit countdown', async () => {
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => first(runs).run.onRateLimitWait(42));
    expect(screen.getByText(/Spróbuj za 42 s/)).toBeInTheDocument();
  });
});

describe('cancel and new file', () => {
  it('cancel aborts, returns to idle, focuses a heading and announces', async () => {
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile());
    await waitFor(() => expect(runs).toHaveLength(1));
    first(runs).run.signal.addEventListener('abort', () =>
      first(runs).d.reject(new AppError('aborted')),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(first(runs).run.signal.aborted).toBe(true);
    expect(await screen.findByText('Anulowano analizę')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wybierz plik|Przeciągnij/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.activeElement?.closest('h1,h2,h3,[role="heading"]')).not.toBeNull();
  });

  it('a new file mid-run aborts the first run and starts a second', async () => {
    const { analyze, runs } = pendingAnalyze();
    const { container } = render(<App services={baseServices({ analyze })} />);
    pick(container, pdfFile('a.pdf'));
    await waitFor(() => expect(runs).toHaveLength(1));
    first(runs).run.signal.addEventListener('abort', () =>
      first(runs).d.reject(new AppError('aborted')),
    );
    pick(container, pdfFile('b.pdf'));
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(first(runs).run.signal.aborted).toBe(true);
    expect(runs.at(1)?.run.signal.aborted).toBe(false);
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('error panel', () => {
  const table: [string, string, string, boolean][] = [
    ['rate_limited', 'Za dużo zapytań', 'Spróbuj ponownie za minutę.', true],
    [
      'quota_exceeded',
      'Limit usługi wyczerpany',
      'Analiza jest chwilowo niedostępna. Wróć później.',
      false,
    ],
    ['upstream_error', 'Usługa AI jest przeciążona', 'Spróbuj ponownie za chwilę.', true],
    [
      'timeout',
      'Serwer nie odpowiedział',
      'Analiza trwała zbyt długo. Spróbuj z krótszym plikiem.',
      true,
    ],
    [
      'client_timeout',
      'Serwer nie odpowiedział',
      'Analiza trwała zbyt długo. Spróbuj z krótszym plikiem.',
      true,
    ],
    [
      'invalid_response',
      'Nie udało się odczytać odpowiedzi',
      'Model zwrócił niepoprawny wynik mimo ponownej próby. Spróbuj jeszcze raz.',
      true,
    ],
    ['content_blocked', 'Treść zablokowana', 'Dostawca AI odmówił analizy tego pliku.', false],
    [
      'payload_too_large',
      'Plik jest za duży do analizy',
      'Wybierz mniejszy lub krótszy plik.',
      false,
    ],
    ['bad_request', 'Błąd aplikacji', 'Coś poszło nie tak po naszej stronie.', false],
    ['forbidden_origin', 'Błąd aplikacji', 'Coś poszło nie tak po naszej stronie.', false],
    ['misconfigured', 'Usługa chwilowo niedostępna', 'Spróbuj ponownie później.', false],
    ['internal_error', 'Usługa chwilowo niedostępna', 'Spróbuj ponownie później.', false],
    [
      'not_configured',
      'Aplikacja nie jest skonfigurowana',
      'Brakuje adresu serwera analizy.',
      false,
    ],
  ];

  it.each(table)(
    'renders %s with title, cause and correct retry availability',
    async (code, title, cause, retry) => {
      const { container } = render(
        <App
          services={baseServices({
            analyze: async () => {
              throw new AppError(code as never);
            },
          })}
        />,
      );
      pick(container, pdfFile());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(title);
      expect(alert).toHaveTextContent(cause);
      expect(screen.getByRole('heading', { level: 2, name: title })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Wybierz inny plik' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' }) !== null).toBe(retry);
    },
  );

  it('shows "Brak połączenia" when offline at failure', async () => {
    const { container } = render(
      <App
        services={baseServices({
          isOnline: () => false,
          analyze: async () => {
            throw new AppError('network');
          },
        })}
      />,
    );
    pick(container, pdfFile());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Brak połączenia' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
  });

  it('shows the server-connection title when online', async () => {
    const { container } = render(
      <App
        services={baseServices({
          isOnline: () => true,
          analyze: async () => {
            throw new AppError('network');
          },
        })}
      />,
    );
    pick(container, pdfFile());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nie udało się połączyć z serwerem' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Brak połączenia')).not.toBeInTheDocument();
  });

  it('retry reuses the same RunState object', async () => {
    const states: unknown[] = [];
    let n = 0;
    const analyze = vi.fn(async (_f: File, run: { state: unknown }) => {
      states.push(run.state);
      n += 1;
      if (n === 1) throw new AppError('upstream_error');
      return resultOutcome();
    });
    const { container } = render(<App services={baseServices({ analyze: analyze as never })} />);
    pick(container, pdfFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByRole('tab', { name: 'Podgląd' });
    expect(states).toHaveLength(2);
    expect(states[1]).toBe(states[0]);
  });
});

describe('result view', () => {
  it('shows sections, focuses the h2 and the document labels', async () => {
    await toResult();
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    for (const name of [
      'Podsumowanie',
      'Najważniejsze punkty',
      'Dokument',
      'Podmioty',
      'Kwoty',
      'Daty',
      'Słowa kluczowe',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    for (const label of ['Język', 'Typ', 'Tytuł', 'Data', 'Strony']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('angielski')).toBeInTheDocument();
    expect(screen.getByText('The company grew in the third quarter.')).toBeInTheDocument();
  });

  it('shows "Brak danych" for null and empty fields', async () => {
    await toResult(
      makeInsight({
        document: {
          fileName: 'x.pdf',
          pages: 1,
          language: 'en',
          type: 'inne',
          title: null,
          date: null,
        },
        keyPoints: [],
        amounts: [],
        dates: [],
        keywords: [],
        entities: { organizations: [], people: [] },
      }),
    );
    expect(screen.getAllByText('Brak danych').length).toBeGreaterThanOrEqual(5);
  });

  it('collapses long lists after 8 items with an aria-expanded toggle', async () => {
    const keywords = Array.from({ length: 12 }, (_, i) => `kw-${i}`);
    await toResult(makeInsight({ keywords }));
    expect(screen.getByText('kw-7')).toBeInTheDocument();
    expect(screen.queryByText('kw-8')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Pokaż wszystkie (12)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('kw-11')).toBeInTheDocument();
  });

  it('groups amounts by currency', async () => {
    await toResult(
      makeInsight({
        amounts: [
          { value: 100, currency: 'PLN', context: 'first' },
          { value: 50, currency: 'EUR', context: 'second' },
          { value: 20, currency: 'PLN', context: 'third' },
        ],
      }),
    );
    expect(screen.getAllByText('PLN')).toHaveLength(1);
    expect(screen.getAllByText('EUR')).toHaveLength(1);
  });

  it('puts the document language and dir=auto on result blocks', async () => {
    await toResult();
    const summary = screen.getByText('The company grew in the third quarter.');
    expect(summary.closest('[lang]')).toHaveAttribute('lang', 'en');
    expect(summary.closest('[dir="auto"]')).not.toBeNull();
  });

  it('switches tabs with arrows, Home and End', async () => {
    const user = userEvent.setup();
    await toResult();
    const preview = screen.getByRole('tab', { name: 'Podgląd' });
    const json = screen.getByRole('tab', { name: 'JSON' });
    expect(preview).toHaveAttribute('aria-selected', 'true');
    preview.focus();
    await user.keyboard('{ArrowRight}');
    expect(json).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(preview).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(json).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(preview).toHaveAttribute('aria-selected', 'true');
  });

  it('JSON tab shows the pretty JSON of the insight', async () => {
    const insight = makeInsight();
    await toResult(insight);
    await userEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(screen.getByRole('tabpanel').textContent).toContain(JSON.stringify(insight, null, 2));
  });

  it('downloads a blob named by downloadFileName', async () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    await toResult();
    await userEvent.click(screen.getByRole('button', { name: 'Pobierz JSON' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(names).toEqual([downloadFileName('Raport 2026.pdf')]);
    expect(names[0]).toBe('Raport_2026.insight.json');
  });

  it('copies the JSON and announces success', async () => {
    const writeClipboard = vi.fn(async () => undefined);
    const insight = makeInsight();
    await toResult(insight, { writeClipboard });
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj JSON' }));
    expect(writeClipboard).toHaveBeenCalledWith(JSON.stringify(insight, null, 2));
    expect(await screen.findByText('Skopiowano')).toBeInTheDocument();
  });

  it('announces a copy failure', async () => {
    await toResult(makeInsight(), {
      writeClipboard: async () => {
        throw new Error('denied');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj JSON' }));
    expect(await screen.findByText('Nie udało się skopiować')).toBeInTheDocument();
  });

  it('"Analizuj kolejny plik" returns to idle', async () => {
    await toResult();
    await userEvent.click(screen.getByRole('button', { name: 'Analizuj kolejny plik' }));
    expect(screen.getByText('Przeciągnij plik PDF tutaj')).toBeInTheDocument();
  });

  it('shows the coverage line when the run was capped', async () => {
    await toResult(makeInsight(), {}, { analyzedTo: 12, totalPages: 40 });
    expect(screen.getByText(/Przeanalizowano strony 1.12 z 40/)).toBeInTheDocument();
  });

  it('renders model text as plain text, never as markup or links', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = await toResult(
      makeInsight({
        summary: evil,
        keyPoints: ['https://evil.example'],
        document: {
          fileName: evil,
          pages: 1,
          language: 'en',
          type: 'inne',
          title: evil,
          date: null,
        },
      }),
    );
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
    expect(screen.getByText('https://evil.example')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(within(screen.getByRole('main')).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('empty outcome', () => {
  it('shows the empty message with a way to pick another file', async () => {
    const storage = memoryStorage();
    const { container } = render(
      <App services={baseServices({ storage, analyze: async () => ({ kind: 'empty' }) })} />,
    );
    pick(container, pdfFile());
    expect(await screen.findByText('Nie znaleziono tekstu w tym pliku.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wybierz inny plik' })).toBeInTheDocument();
    expect(loadHistory(storage, NOW)).toHaveLength(0);
  });
});

describe('history', () => {
  it('saves a finished result', async () => {
    const storage = memoryStorage();
    await toResult(makeInsight(), { storage });
    const list = loadHistory(storage, NOW);
    expect(list).toHaveLength(1);
    expect(first(list).fileName).toBe('Raport 2026.pdf');
  });

  it('lists entries and opens one without calling analyze', async () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify([seedEntry(1), seedEntry(2)]) });
    const analyze = vi.fn(async () => resultOutcome());
    render(<App services={baseServices({ storage, analyze })} />);
    expect(screen.getByText('Ostatnie analizy')).toBeInTheDocument();
    const open = screen
      .getAllByRole('button')
      .find(
        (b) =>
          (b.textContent ?? '').includes('plik-2.pdf') &&
          !(b.getAttribute('aria-label') ?? '').startsWith('Usuń'),
      );
    expect(open).toBeDefined();
    await userEvent.click(open as HTMLElement);
    expect(await screen.findByText('Summary 2')).toBeInTheDocument();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('deletes one entry via the labelled button', async () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify([seedEntry(1), seedEntry(2)]) });
    render(<App services={baseServices({ storage })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usuń analizę pliku plik-1.pdf' }));
    expect(
      screen.queryByRole('button', { name: 'Usuń analizę pliku plik-1.pdf' }),
    ).not.toBeInTheDocument();
    expect(loadHistory(storage, NOW).map((e) => e.id)).toEqual(['id-2']);
  });

  it('clears history only after an inline confirmation', async () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify([seedEntry(1), seedEntry(2)]) });
    render(<App services={baseServices({ storage })} />);
    const before = new Set(screen.getAllByRole('button').map((b) => b.textContent));
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść historię' }));
    expect(loadHistory(storage, NOW)).toHaveLength(2);
    const confirm = screen
      .getAllByRole('button')
      .find((b) => !before.has(b.textContent) && !/anuluj|^nie\b/i.test(b.textContent ?? ''));
    expect(confirm).toBeDefined();
    await userEvent.click(confirm as HTMLElement);
    expect(loadHistory(storage, NOW)).toHaveLength(0);
  });

  it('keeps at most 10 entries', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => seedEntry(i + 1));
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify(entries) });
    await toResult(makeInsight(), { storage });
    await userEvent.click(screen.getByRole('button', { name: 'Analizuj kolejny plik' }));
    expect(screen.getAllByRole('button', { name: /^Usuń analizę pliku/ })).toHaveLength(10);
    expect(loadHistory(storage, NOW)).toHaveLength(10);
  });

  it('skips expired and corrupt entries', () => {
    const expired = seedEntry(1, { savedAt: NOW - HISTORY_TTL_MS - 1000 });
    const corrupt = seedEntry(2, { insight: { summary: 'nope' } });
    const good = seedEntry(3);
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify([expired, corrupt, good]) });
    render(<App services={baseServices({ storage })} />);
    expect(screen.getAllByRole('button', { name: /^Usuń analizę pliku/ })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Usuń analizę pliku plik-3.pdf' }),
    ).toBeInTheDocument();
  });

  it('works with null storage', async () => {
    await toResult(makeInsight(), { storage: null });
    expect(screen.getByRole('tab', { name: 'JSON' })).toBeInTheDocument();
  });

  it('works when storage throws', async () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    const storage = { getItem: boom, setItem: boom, removeItem: boom };
    await toResult(makeInsight(), { storage });
    expect(screen.getByRole('tab', { name: 'JSON' })).toBeInTheDocument();
  });
});

describe('default services', () => {
  it('without VITE_API_URL shows the not_configured error panel', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const bytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const file = new File([bytes], 'doc.pdf', { type: 'application/pdf' });
    const { container } = render(<App />);
    pick(container, file);
    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent('Aplikacja nie jest skonfigurowana');
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).not.toBeInTheDocument();
    void deferred;
  });
});
