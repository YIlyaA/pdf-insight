import type { ErrorCode } from './protocol';

/** Worker error codes plus the failures that only the browser can see. */
export type ClientErrorCode =
  ErrorCode | 'offline' | 'network' | 'client_timeout' | 'not_configured' | 'aborted';

export interface ErrorView {
  title: string;
  cause: string;
  retry: boolean;
}

const APP_ERROR: ErrorView = {
  title: 'Błąd aplikacji',
  cause: 'Coś poszło nie tak po naszej stronie.',
  retry: false,
};
const UNAVAILABLE: ErrorView = {
  title: 'Usługa chwilowo niedostępna',
  cause: 'Spróbuj ponownie później.',
  retry: false,
};
const TIMEOUT: ErrorView = {
  title: 'Serwer nie odpowiedział',
  cause: 'Analiza trwała zbyt długo. Spróbuj z krótszym plikiem.',
  retry: true,
};

const VIEWS: Record<ClientErrorCode, ErrorView> = {
  rate_limited: { title: 'Za dużo zapytań', cause: 'Spróbuj ponownie za minutę.', retry: true },
  quota_exceeded: {
    title: 'Limit usługi wyczerpany',
    cause: 'Analiza jest chwilowo niedostępna. Wróć później.',
    retry: false,
  },
  upstream_error: {
    title: 'Usługa AI jest przeciążona',
    cause: 'Spróbuj ponownie za chwilę.',
    retry: true,
  },
  timeout: TIMEOUT,
  client_timeout: TIMEOUT,
  invalid_response: {
    title: 'Nie udało się odczytać odpowiedzi',
    cause: 'Model zwrócił niepoprawny wynik mimo ponownej próby. Spróbuj jeszcze raz.',
    retry: true,
  },
  content_blocked: {
    title: 'Treść zablokowana',
    cause: 'Dostawca AI odmówił analizy tego pliku.',
    retry: false,
  },
  payload_too_large: {
    title: 'Plik jest za duży do analizy',
    cause: 'Wybierz mniejszy lub krótszy plik.',
    retry: false,
  },
  bad_request: APP_ERROR,
  forbidden_origin: APP_ERROR,
  not_found: APP_ERROR,
  method_not_allowed: APP_ERROR,
  misconfigured: UNAVAILABLE,
  internal_error: UNAVAILABLE,
  offline: { title: 'Brak połączenia', cause: 'Brak połączenia z internetem.', retry: true },
  network: {
    title: 'Nie udało się połączyć z serwerem',
    cause: 'Sprawdź połączenie i spróbuj ponownie.',
    retry: true,
  },
  not_configured: {
    title: 'Aplikacja nie jest skonfigurowana',
    cause: 'Brakuje adresu serwera analizy.',
    retry: false,
  },
  // Never shown: a cancelled run goes back to idle.
  aborted: { title: 'Anulowano', cause: 'Analiza została anulowana.', retry: false },
};

/** Spec 11.1 table. client_timeout == timeout. not_found, method_not_allowed, forbidden_origin, bad_request -> "Błąd aplikacji". */
export function describeError(code: ClientErrorCode): ErrorView {
  return { ...VIEWS[code] };
}

/** A failure shown in the error panel; `code` selects the copy. */
export class AppError extends Error {
  readonly code: ClientErrorCode;
  constructor(code: ClientErrorCode) {
    super(code);
    this.name = 'AppError';
    this.code = code;
  }
}
