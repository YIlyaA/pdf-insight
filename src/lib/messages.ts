/** All user-facing strings (Polish). Copy is defined in design/spec.md section 9. */
export const MESSAGES = {
  errNotPdf: 'To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.',
  errEmpty: 'Plik jest pusty.',
  errCorrupt: 'Nie udało się odczytać pliku. Może być uszkodzony.',
  errPassword: 'Plik jest chroniony hasłem. Zdejmij zabezpieczenie i spróbuj ponownie.',
  errTooLarge: (sizeBytes: number, maxBytes: number): string => {
    const toMb = (n: number) =>
      (n / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
    return `Plik jest za duży (${toMb(sizeBytes)} MB, maks. ${toMb(maxBytes)} MB).`;
  },
} as const;
