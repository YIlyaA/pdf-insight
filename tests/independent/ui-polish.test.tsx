import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App';
import { formatInsightText } from '../../src/lib/format';
import { baseServices, makeInsight, pdfFile, pick, resultOutcome } from './ui-helpers';

const ITEMS = [
  'Treść pliku (tekst albo obrazy stron) jest wysyłana do Google Gemini przez nasz serwer pośredniczący, żeby wykonać analizę.',
  'Dostawca może ją przechowywać zgodnie z własnymi zasadami.',
  'Wynik zapisujemy tylko w tej przeglądarce: do 10 analiz przez 30 dni. Możesz je usunąć w historii.',
  'Nie wgrywaj dokumentów, których nie możesz udostępniać.',
];

// jsdom lacks showModal/close; emulate the native behaviour (open attribute, close event).
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function toResult(overrides = {}, insight = makeInsight()) {
  const utils = render(
    <App services={baseServices({ analyze: async () => resultOutcome(insight), ...overrides })} />,
  );
  pick(utils.container, pdfFile('Raport 2026.pdf'));
  await screen.findByRole('tab', { name: 'Podgląd' });
  return utils;
}

describe('privacy notice', () => {
  it('has no notice line or Szczegóły button on the idle screen', () => {
    render(<App services={baseServices()} />);
    expect(screen.queryByText(/Plik zostanie wysłany/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Szczegóły' })).not.toBeInTheDocument();
  });

  it('footer has a Prywatność button', () => {
    render(<App services={baseServices()} />);
    expect(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Prywatność' }),
    ).toBeInTheDocument();
  });
});

describe('privacy dialog', () => {
  it('opens from the footer button with the exact content', async () => {
    render(<App services={baseServices()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prywatność' }));
    const dialog = screen.getByRole('dialog', { name: 'Prywatność i dane' });
    expect(
      within(dialog).getByRole('heading', { level: 2, name: 'Prywatność i dane' }),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(ITEMS);
    expect(within(dialog).getByRole('button', { name: 'Zamknij' })).toBeInTheDocument();
  });

  it('closes with Zamknij and refocuses the footer button', async () => {
    render(<App services={baseServices()} />);
    const button = screen.getByRole('button', { name: 'Prywatność' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes with Escape (native cancel then close) and refocuses the opener', async () => {
    render(<App services={baseServices()} />);
    const button = screen.getByRole('button', { name: 'Prywatność' });
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog');
    act(() => {
      const cancel = new Event('cancel', { cancelable: true });
      dialog.dispatchEvent(cancel);
      if (!cancel.defaultPrevented) (dialog as HTMLDialogElement).close();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe('result actions', () => {
  it('lists the four actions', async () => {
    await toResult();
    for (const name of ['Pobierz JSON', 'Kopiuj tekst', 'Kopiuj JSON', 'Analizuj kolejny plik']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Kopiuj tekst copies formatInsightText once and announces success', async () => {
    const writeClipboard = vi.fn(async () => undefined);
    const insight = makeInsight();
    await toResult({ writeClipboard }, insight);
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj tekst' }));
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard).toHaveBeenCalledWith(formatInsightText(insight));
    expect(await screen.findByText('Skopiowano')).toBeInTheDocument();
  });

  it('Kopiuj tekst announces a failure', async () => {
    await toResult({
      writeClipboard: async () => {
        throw new Error('denied');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj tekst' }));
    expect(await screen.findByText('Nie udało się skopiować')).toBeInTheDocument();
  });

  it('announces in a polite live region', async () => {
    const { container } = await toResult();
    await userEvent.click(screen.getByRole('button', { name: 'Kopiuj tekst' }));
    await screen.findByText('Skopiowano');
    const polite = Array.from(container.querySelectorAll('[aria-live="polite"],[role="status"]'));
    expect(polite.some((e) => e.textContent?.includes('Skopiowano'))).toBe(true);
  });
});

describe('result header and logo', () => {
  it('shows fact chips with type, language, pages and date near the title', async () => {
    await toResult();
    const h2 = screen.getByRole('heading', { level: 2 });
    const header = h2.closest('header') ?? (h2.parentElement as HTMLElement);
    for (const chip of ['raport', 'angielski', '3 strony', '1 września 2026']) {
      expect(header).toHaveTextContent(chip);
    }
  });

  it('logo mark next to the h1 is aria-hidden and not in the accessibility tree', () => {
    render(<App services={baseServices()} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    const scope = h1.parentElement as HTMLElement;
    const svg = scope.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(scope).queryByRole('img')).toBeNull();
    expect(h1).toHaveAccessibleName('PDF Insight');
  });
});

void fireEvent;
