/** All user-facing strings (Polish). Copy is defined in design/spec.md section 9. */
export const MESSAGES = {
  errNotPdf: 'To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.',
  errEmpty: 'Plik jest pusty.',
  errCorrupt: 'Nie udało się odczytać pliku. Może być uszkodzony.',
  errPassword: 'Plik jest chroniony hasłem. Zdejmij zabezpieczenie i spróbuj ponownie.',
  errTooLarge: (sizeBytes: number, maxBytes: number): string => {
    const mb = (n: number) => n / (1024 * 1024);
    const format = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 1 });
    // Round the file size up: a file over the limit must never read as "10 MB, maks. 10 MB".
    return `Plik jest za duży (${format(Math.ceil(mb(sizeBytes) * 10) / 10)} MB, maks. ${format(mb(maxBytes))} MB).`;
  },
} as const;
