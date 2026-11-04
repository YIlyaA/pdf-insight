---
id: T-ui-polish
title: Owner feedback after the first design review
status: ready
labels: [ui]
size_limit: 600 lines
external: []
scope: [src/**, public/**, index.html, tests/**, design/**]
allow_test_changes: true  # the owner changed the privacy copy; the old privacy assertions in tests/independent/ui-app.test.tsx are replaced
---

## Goal
Less text on screen, one-click copy of readable text, a logo and favicon, a bit more polish. The brief still requires a visible notice that the file goes to an AI API ("Informacja, że plik trafia do API AI"), so the notice stays, but it is one short line plus a details dialog.

## Frozen interface and copy
- `src/lib/format.ts`: `export function formatInsightText(insight: Insight): string` returns plain text (no HTML, no Markdown links):
  ```
  <title, or fileName when title is null>
  <type label> · <language name> · <pagesLabel> · <formatDate(date)>     (parts that are null are left out)

  Podsumowanie
  <summary>

  Najważniejsze punkty
  - <point>

  Podmioty
  Organizacje: a, b
  Osoby: c, d

  Kwoty
  - <formatAmount> — <context>

  Daty
  - <formatDate> — <context>

  Słowa kluczowe: a, b
  ```
  A section with no data is omitted (no "Brak danych" in the copied text). Sections are separated by one blank line. No trailing newline.
- Result actions row: "Pobierz JSON" (primary), "Kopiuj tekst" (new, copies `formatInsightText`, announces "Skopiowano" or "Nie udało się skopiować" in the same polite region as JSON copy), "Kopiuj JSON", "Analizuj kolejny plik".
- Idle screen: the long privacy paragraph above the drop zone is REMOVED. Under the drop zone one line: "Plik zostanie wysłany do Google Gemini." followed by a button "Szczegóły". The drop zone `aria-describedby` points to its hint and to this line (and to the inline error when present).
- Footer: repo link and a button "Prywatność". The text "Dane przetwarzane przez Google Gemini" is removed from the footer.
- "Szczegóły" and "Prywatność" open the same native `<dialog>` (accessible name "Prywatność i dane") with h2 "Prywatność i dane", a list of exactly these four items and a "Zamknij" button:
  1. "Treść pliku (tekst albo obrazy stron) jest wysyłana do Google Gemini przez nasz serwer pośredniczący, żeby wykonać analizę."
  2. "Dostawca może ją przechowywać zgodnie z własnymi zasadami."
  3. "Wynik zapisujemy tylko w tej przeglądarce: do 10 analiz przez 30 dni. Możesz je usunąć w historii."
  4. "Nie wgrywaj dokumentów, których nie możesz udostępniać."
  Esc and "Zamknij" close it, focus returns to the button that opened it, the page behind is inert while it is open (native modal behaviour). jsdom lacks `showModal`: tests may polyfill `HTMLDialogElement.prototype.showModal/close` in the test file; the component must work with both the native method and, when missing, fall back to setting the `open` attribute.
- Logo: inline SVG mark (own design: a document outline with the four lime scan-corner brackets echoing the drop zone) shown left of the h1 (`aria-hidden`), plus `public/favicon.svg` linked from `index.html` with `%BASE_URL%favicon.svg` and a `theme-color` meta.
- History: unchanged (max 10, 30 days, no pagination). The history title may show the limit as muted text only if it fits on one line at 360 px; otherwise leave it.
- Visual polish, same tokens and palette (owner likes them): more air in the idle screen (a taller, centred drop zone with a bigger icon, one primary button), a very low-opacity lime glow behind the zone in dark theme only (no gradients elsewhere), result header with the title and a row of small fact chips (type, language, pages, date), the summary as the first and largest block, quieter section labels. Nothing decorative that needs reading. Keep motion to transform/opacity and respect reduced motion.
