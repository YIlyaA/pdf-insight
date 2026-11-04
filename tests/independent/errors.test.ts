// @vitest-environment node
import { AppError, describeError, type ClientErrorCode } from '../../src/lib/errors';

const APP_ERROR = { title: 'Błąd aplikacji', cause: 'Coś poszło nie tak po naszej stronie.', retry: false };

const TABLE: Array<[ClientErrorCode, { title: string; cause: string; retry: boolean }]> = [
  ['rate_limited', { title: 'Za dużo zapytań', cause: 'Spróbuj ponownie za minutę.', retry: true }],
  [
    'quota_exceeded',
    {
      title: 'Limit darmowego API wyczerpany',
      cause: 'Dzienny limit analiz został wykorzystany. Wróć później.',
      retry: false,
    },
  ],
  [
    'upstream_error',
    { title: 'Usługa AI jest przeciążona', cause: 'Spróbuj ponownie za chwilę.', retry: true },
  ],
  [
    'timeout',
    {
      title: 'Serwer nie odpowiedział',
      cause: 'Analiza trwała zbyt długo. Spróbuj z krótszym plikiem.',
      retry: true,
    },
  ],
  [
    'client_timeout',
    {
      title: 'Serwer nie odpowiedział',
      cause: 'Analiza trwała zbyt długo. Spróbuj z krótszym plikiem.',
      retry: true,
    },
  ],
  [
    'invalid_response',
    {
      title: 'Nie udało się odczytać odpowiedzi',
      cause: 'Model zwrócił niepoprawny wynik mimo ponownej próby. Spróbuj jeszcze raz.',
      retry: true,
    },
  ],
  [
    'content_blocked',
    { title: 'Treść zablokowana', cause: 'Dostawca AI odmówił analizy tego pliku.', retry: false },
  ],
  [
    'payload_too_large',
    {
      title: 'Plik jest za duży do analizy',
      cause: 'Wybierz mniejszy lub krótszy plik.',
      retry: false,
    },
  ],
  ['bad_request', APP_ERROR],
  ['forbidden_origin', APP_ERROR],
  ['not_found', APP_ERROR],
  ['method_not_allowed', APP_ERROR],
  [
    'misconfigured',
    { title: 'Usługa chwilowo niedostępna', cause: 'Spróbuj ponownie później.', retry: false },
  ],
  [
    'internal_error',
    { title: 'Usługa chwilowo niedostępna', cause: 'Spróbuj ponownie później.', retry: false },
  ],
  [
    'offline',
    { title: 'Brak połączenia', cause: 'Brak połączenia z internetem.', retry: true },
  ],
  [
    'network',
    {
      title: 'Nie udało się połączyć z serwerem',
      cause: 'Sprawdź połączenie i spróbuj ponownie.',
      retry: true,
    },
  ],
  [
    'not_configured',
    {
      title: 'Aplikacja nie jest skonfigurowana',
      cause: 'Brakuje adresu serwera analizy.',
      retry: false,
    },
  ],
];

describe('describeError', () => {
  it.each(TABLE)('maps %s to the spec 11.1 copy and retry flag', (code, expected) => {
    expect(describeError(code)).toEqual(expected);
  });

  it('describes aborted as "Anulowano" without retry', () => {
    const view = describeError('aborted');
    expect(view.title).toBe('Anulowano');
    expect(view.retry).toBe(false);
  });
});

describe('AppError', () => {
  it('is an Error carrying its code', () => {
    const error = new AppError('rate_limited');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('rate_limited');
  });
});
