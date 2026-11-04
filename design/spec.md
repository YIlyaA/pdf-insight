# Design spec: PDF Insight

UI language: Polish. Code and spec: English.

## 1. Context
- Users: a recruiter or colleague opening the demo link cold, on desktop or phone, with their own PDF. No instructions given.
- Main job: drop a PDF, get a short summary and structured JSON within 30 s, download the JSON.
- UI language(s): Polish UI strings, `<html lang="pl">`. Result text follows the document language.
- Existing system: none.
- Visual direction: "document under inspection". Dark, near-black canvas with one lime accent used only for the primary action and the active pipeline step; monospace labels for data (fields, JSON, numbers) echo the brief's own look. Everything else quiet.

## 2. Flows
### F1. Analyse a PDF (happy path)
1. Open page: header with logo, drop zone, history (if any). The privacy notice is the footer button "Prywatność" (owner decision 2026-11-04: no duplicate line under the zone).
2. Drop a file or activate the drop zone (it is the only control; "Wybierz plik" is its visible label, not a second button).
3. Client validation passes (PDF magic bytes, size ≤ 10 MB).
4. Progress shows 4 steps: Wczytywanie > Odczyt tekstu > Analiza AI > Gotowe (long docs: "Analiza AI 2/5"; scans: "Rozpoznawanie stron skanowanych").
5. Result: summary, key points, document facts, entities, amounts, dates, keywords; tabs "Podgląd" / "JSON"; buttons "Pobierz JSON", "Kopiuj tekst" (plain text, `formatInsightText`), "Kopiuj JSON", "Analizuj kolejny plik".
- Fails when:
  - wrong type / empty / >10 MB / unreadable / password-protected: inline error under the zone, no request sent, zone stays usable.
  - request failure: error panel with title, cause and next step. Which codes allow a retry, and the copy, are in section 11. Retry reruns only the chunks that did not finish.
  - offline (`navigator.onLine` is false): error panel "Brak połączenia", retry available. A fetch error while online is "Nie udało się połączyć z serwerem", never "offline".
  - no second file can be added while an analysis runs: the drop zone is hidden until it finishes or is cancelled.
  - refresh during analysis: back to idle (result is in history only if finished).
  - no readable content: empty state "Nie znaleziono tekstu w tym pliku." (one string, section 9). It shows when every page is below the text threshold and a rendered page is blank (almost uniform pixels, checked on the client before upload), or when the model answers with an empty summary on the scan path.
- Keyboard: Tab > drop zone (one tab stop; Enter/Space opens the picker) > history items. After analysis, focus moves to the result heading; on error, to the error heading.

### F2. Open from history
1. History list shows up to 10 recent analyses (file name, date, type).
2. Select one: result view opens from localStorage, no request.
3. History is stored in this browser only, for 30 days, max 10 entries; the privacy dialog says so. Every entry is re-validated with `InsightSchema` when read; invalid or expired entries are dropped. "Usuń" removes one entry; "Wyczyść historię" removes all (confirm inline, undo not needed: data is local and cheap).
- Fails when: localStorage disabled or entry corrupted: history hidden / entry skipped silently, app unaffected.

## 3. Information architecture
```
/pdf-insight/   (single screen, no router: avoids Pages 404 problem)
  header: name, short tagline
  main
    UploadPanel (idle: drop area) | ProgressPanel (running) | ErrorPanel | ResultPanel
    HistoryList
  footer: link to repo, "Prywatność" button
  PrivacyDialog (native modal, opened from the footer button "Prywatność")
```
| Screen | URL | Main job | Primary action | Content in priority order |
|---|---|---|---|---|
| App | `/pdf-insight/` | analyse a PDF | Wybierz plik | status of current job, result, history |

## 4. Screen × state matrix
| Component | Loading | Empty | Partial | Success | Error | Offline / slow | Overflow | Disabled |
|---|---|---|---|---|---|---|---|---|
| UploadPanel | drag-over highlight | idle: instruction + limits | n/a | n/a | inline validation message | n/a | long file name truncated with title | hidden while analysing (owner decision 2026-11-04): the only controls are "Anuluj"; a file dropped outside a zone is ignored (page-level `dragover`/`drop` are cancelled) |
| ProgressPanel | 4 steps, current marked, elapsed seconds (outside the live region, `aria-live="off"`) | n/a | "Analiza AI 2/5" for chunks | n/a | moves to ErrorPanel | after 15 s: "To trwa dłużej niż zwykle."; after 45 s without progress: client timeout, error `timeout` | n/a | cancel always enabled: aborts requests, returns to idle, focus goes to the zone heading, announced "Anulowano analizę" |
| ErrorPanel | retry shows progress | n/a | n/a | n/a | title, cause, next step, 2 actions (retry only when section 11 allows it) | "Brak połączenia" | long message wraps | retry disabled while running and during a rate-limit countdown ("Spróbuj za 42 s") |
| ResultPanel | skeleton never shown (result appears whole) | "Nie znaleziono treści w pliku" | missing fields shown as "Brak danych" | all sections | n/a | n/a | long lists collapse after 8 items with "Pokaż wszystkie (n)"; JSON scrolls in a bordered box | n/a |
| HistoryList | n/a | hidden | n/a | list | corrupted entry skipped | n/a | 10 max, oldest dropped | n/a |

Edge cases: 0/1/many amounts; 60 entities; 200-character file name; missing title/date (`null` shown as "Brak danych"); zoom 200%; 360 px; two tabs (history read on open, written on finish); amounts in several currencies shown grouped by currency.

## 5. Component inventory
| Component | Purpose | Variants | States | Content limits | Keyboard / ARIA | Tokens |
|---|---|---|---|---|---|---|
| Button | actions | primary (lime), secondary (outline), ghost | default, hover, focus-visible, active, disabled, loading | label ≤ 24 chars | native button | `--accent`, `--border`, `--focus` |
| DropZone | choose/drop PDF | idle (tall, centred, 48 px icon, the screen's one primary button), drag-over, error | + disabled | hint text 2 lines | one focusable control (`role="button"`, tabindex 0, Enter/Space), `aria-describedby` hint + error, hidden `<input type=file accept=application/pdf>` (not focusable) | `--surface`, `--border-strong`; dark theme only: faint lime glow (`box-shadow`, `--accent` at 9 %), the only glow in the app |
| StepList | pipeline progress | 4 steps | pending, active, done, failed | step label ≤ 24 chars; counter counts requests of the current phase | `<ol>`, `aria-current="step"`, live region polite for step name | `--accent`, `--muted` |
| ErrorPanel | explain failure | validation (inline), request failure (panel) | default | message ≤ 160 chars | `role="alert"`, heading receives focus | `--error` |
| ResultHeader | file name (muted, only when a title exists), h2 = title or file name, fact chips | n/a | n/a | chips: type, "język <name>", pages, date (null date left out); wrap | `<header>` inside the result `<section>`; chips are a `<ul>` | `--border`, `--muted`, `--mono` 12 px |
| ResultSection | titled block; Podsumowanie first and largest (20 px) | text, list, table | collapsed/expanded | lists collapse > 8 | `<section aria-labelledby>`; quiet label (12 px muted mono caps, no rule); toggle is a button with `aria-expanded` | `--surface` |
| FactsTable | document fields, amounts, dates | n/a | n/a | amount and date values right-aligned from 640 px, tabular; "Dokument" values (incl. Strony) all left-aligned; amounts grouped (`1 234,50 zł`) | `<table>` with `<th scope>` | `--mono` |
| Tabs | Podgląd / JSON | 2 tabs | selected | n/a | WAI-ARIA tabs, arrows, Home/End | `--accent` underline |
| JsonView | pretty JSON | n/a | n/a | scroll box, max-height 60vh | `<pre tabindex=0>` + label; text only, never HTML | `--mono` |
| HistoryItem | past result | n/a | hover, focus | name truncated | button + separate delete button with `aria-label` containing file name | `--surface` |
| PrivacyDialog | privacy details | n/a | open, closed | h2 + 4 items + "Zamknij"; fits 360 px, scrolls when taller than the viewport | native `<dialog>` with `showModal` (page inert, Esc closes); fallback when `showModal` is missing: `open` attribute + own Esc handling; accessible name from the h2; focus to "Zamknij" on open, back to the opener on close | `--surface`, `--border-strong`, `::backdrop` = `--bg` at 82 %; fade + 8 px rise (opacity/transform, off under reduced motion) |
| Logo | brand mark left of the h1 | n/a | n/a | 32 px (40 px from 640) | inline SVG in an `aria-hidden` wrapper; the h1 text is the name; same drawing in `public/favicon.svg` | document outline `--text`, four scan-corner brackets `--accent-text` (lime in dark) |
| Toast | one visible status plate at the bottom (copy, download, cancel), also the polite live region; clears after 3 s | | | | `role="status"` | `--surface`, `--border-strong` |

## 6. Tokens
| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | #F6F7F4 | #0E0F0E | page background |
| `--surface` | #FFFFFF | #161816 | panels |
| `--border` | #D5D9D0 | #2A2D2A | dividers |
| `--border-strong` | #7C8478 | #6A706A | controls, drop zone outline (UI 3:1) |
| `--text` | #141612 | #ECEFEA | body text |
| `--muted` | #4B5247 | #A3A9A0 | secondary text |
| `--accent` | #C6F432 | #C6F432 | primary button fill; active step fill (light theme: also `--accent-text` label and a 2 px `--accent-text` outline, because lime on the light bg is 1.19:1) |
| `--on-accent` | #141612 | #0E0F0E | text on accent |
| `--accent-text` | #3F5A00 | #C6F432 | accent-coloured text and links |
| `--error` | #B3261E | #FF8A80 | errors |
| `--focus` | #3F5A00 | #C6F432 | focus ring (2 px, 2 px offset) |

Theme follows `prefers-color-scheme`; dark is the primary design. No manual toggle (cut: not in brief).

Fonts (self-hosted, OFL, latin + latin-ext via @fontsource): Manrope (headings and UI, 500/700), JetBrains Mono (data, JSON, labels, 400). Fallback `system-ui`. Body 16 px / 1.5. Scale 12, 14, 16, 20, 24, 32. Max text line 70ch.
Spacing: 4, 8, 12, 16, 24, 32, 48. Radius: 6 (controls), 10 (panels). Elevation: none, borders only. Motion: 150 ms ease-out for state changes; progress step change 200 ms; none under `prefers-reduced-motion`. Breakpoints: 640, 1024. Content max-width 960 px.

Contrast checked (computed with a script, WCAG formula):
| Pair | Ratio | Needed | Pass |
|---|---|---|---|
| dark text / bg | 16.56 | 4.5 | yes |
| dark muted / surface | 7.43 | 4.5 | yes |
| dark accent / bg | 14.99 | 4.5 | yes |
| dark on-accent / accent | 14.99 | 4.5 | yes |
| dark error / surface | 7.82 | 4.5 | yes |
| light text / bg | 16.93 | 4.5 | yes |
| light muted / surface | 8.09 | 4.5 | yes |
| light accent-text / bg | 7.30 | 4.5 | yes |
| light on-accent / accent | 14.21 | 4.5 | yes |
| light error / bg | 6.08 | 4.5 | yes |
| light border-strong / bg | 3.60 | 3 | yes |
| dark border-strong #6A706A / bg | 3.79 | 3 | yes |
| dark border-strong / surface | 3.52 | 3 | yes |
| light accent fill / bg | 1.19 | 3 | no: never the only signal, see `--accent` |

## 7. Responsive
| Width | Layout changes |
|---|---|
| 320-639 (default) | single column; result sections stacked; tables become label/value lists; buttons full width; JSON box scrolls horizontally |
| 640-1023 | single column, 24 px gutters, buttons inline |
| 1024+ | result in 2 columns: summary + key points left, facts/entities right; history under the upload zone |

360 px is the tested minimum; 320 must not break (no horizontal page scroll).

## 8. Accessibility
- Landmarks: `header`, `main`, `footer`. One `h1`; panel titles `h2`; result sections `h3`.
- Focus: after state change, move focus to the new panel heading (`tabindex=-1`). Visible ring on every control.
- Live regions: step name `aria-live="polite"`; errors `role="alert"`.
- Drag and drop never required: picker always available.
- Reduced motion: no transitions, progress shown as text only.
- Colour is never the only signal: steps have text + icon, errors have text + icon.
- Zoom 200% and text spacing 1.5: no clipped text.

## 9. Microcopy (Polish)
| Where | Text | Notes |
|---|---|---|
| h1 | PDF Insight | |
| tagline | Wgraj PDF, a dostaniesz krótkie podsumowanie i dane w formacie JSON. | |
| drop idle | Przeciągnij plik PDF tutaj | |
| drop hint | lub wybierz go z dysku. Tylko PDF, maks. 10 MB. | |
| button | Wybierz plik | |
| drag-over | Upuść plik, aby rozpocząć | |
| footer button | Prywatność | opens the same dialog; replaces the old "Dane przetwarzane przez Google Gemini" |
| dialog title | Prywatność i dane | h2 and accessible name |
| dialog items | 1. Treść pliku (tekst albo obrazy stron) jest wysyłana do Google Gemini przez nasz serwer pośredniczący, żeby wykonać analizę. 2. Dostawca może ją przechowywać zgodnie z własnymi zasadami. 3. Wynik zapisujemy tylko w tej przeglądarce: do 10 analiz przez 30 dni. Możesz je usunąć w historii. 4. Nie wgrywaj dokumentów, których nie możesz udostępniać. | a list, exactly these four |
| dialog close | Zamknij | |
| err type | To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf. | |
| err size | Plik jest za duży (maks. 10 MB). | show actual size |
| err empty | Plik jest pusty. | |
| err corrupt | Nie udało się odczytać pliku. Może być uszkodzony. | |
| err password | Plik jest chroniony hasłem. Zdejmij zabezpieczenie i spróbuj ponownie. | |
| steps | Wczytywanie pliku / Odczyt tekstu / Analiza AI / Gotowe | |
| scan step | Skany: strona n z m | counts pages of the scan batch |
| slow | To trwa dłużej niż zwykle. Nadal pracujemy. | after 15 s; does not guess the cause |
| cancel | Anuluj | |
| err api | Analiza nie powiodła się. Spróbuj ponownie za chwilę. | |
| err limit | Przekroczono limit zapytań. Spróbuj ponownie za minutę. | 429 |
| err invalid | Odpowiedź AI miała nieprawidłowy format, mimo ponownej próby. | |
| err offline | Brak połączenia z internetem. | |
| err timeout | Serwer nie odpowiedział na czas. | |
| retry | Spróbuj ponownie | |
| other file | Wybierz inny plik | |
| empty result | Nie znaleziono tekstu w tym pliku. | |
| no data | Brak danych | for null / [] |
| result tabs | Podgląd / JSON | |
| download | Pobierz JSON | filename: name without `.pdf`, characters outside letters, digits, `-`, `_` replaced by `_`, then `.insight.json` |
| copy | Kopiuj tekst / Kopiuj JSON / Skopiowano / Nie udało się skopiować | success and failure announced politely in one region; "Kopiuj tekst" copies the plain-text layout of `formatInsightText` (empty sections left out) |
| language chip | język <name> | result header, e.g. "język angielski" |
| next | Analizuj kolejny plik | |
| history title | Ostatnie analizy | |
| delete | Usuń | `aria-label`: "Usuń analizę pliku <name>" |
| clear | Wyczyść historię | |
| sections | Podsumowanie / Najważniejsze punkty / Dokument / Podmioty / Kwoty / Daty / Słowa kluczowe | |
| type labels | faktura, umowa, oferta, raport, inne | mapped from enum |

Plural forms (pl-PL): strony (1 strona, 2-4 strony, 5+ stron) through `Intl.PluralRules`.
Dates, amounts via `Intl` with `pl-PL`; amounts always group thousands (`useGrouping: 'always'`, so 4 digits read "1 234,50 zł"). Glossary: "analiza" = whole run; "wynik" = result; "plik" = uploaded PDF.

## 10. Images
None. Logo is an own inline SVG mark next to the text name (document outline in four scan-corner brackets), also `public/favicon.svg`; icons are inline SVG (own, no licence issue). No `design/image-ideas.md` entries.

## 11. Verdict amendments (design trial, 2026-11-04)

Prosecutor: 15 charges. Defender conceded 6 in full and 9 in part. Judgement: all upheld except the parts below.
- Rejected: "Retry-After cannot be hard-coded" (it is always 60 s, but the Worker now exposes it, PR #5; the client reads the header and falls back to 60). "Timer is read aloud" (step name only is live; made explicit above). "Model text may be HTML" (React escapes; kept as a rule: all model and file-name text is plain text, no auto-links).
- Result blocks carry `lang={document.language}` and `dir="auto"`. The language code is shown through `Intl.DisplayNames` (pl-PL). Field labels in "Dokument": Język, Typ, Tytuł, Data, Strony.

### 11.1 Error map (every Worker code has a state)
| Code (HTTP) | Title | Cause text | Retry |
|---|---|---|---|
| `rate_limited` (429) | Za dużo zapytań | Spróbuj ponownie za minutę. | yes, after the countdown |
| `quota_exceeded` (429) | Limit darmowego API wyczerpany | Dzienny limit analiz został wykorzystany. Wróć później. | no |
| `upstream_error` (502) | Usługa AI jest przeciążona | Spróbuj ponownie za chwilę. | yes |
| `timeout` (504) and client timeout | Serwer nie odpowiedział | Analiza trwała zbyt długo. Spróbuj z krótszym plikiem. | yes |
| `invalid_response` (502) | Nie udało się odczytać odpowiedzi | Model zwrócił niepoprawny wynik mimo ponownej próby. Spróbuj jeszcze raz. | yes |
| `content_blocked` (422) | Treść zablokowana | Dostawca AI odmówił analizy tego pliku. | no |
| `payload_too_large` (413) | Plik jest za duży do analizy | Wybierz mniejszy lub krótszy plik. | no |
| `bad_request` (400), `forbidden_origin` (403) | Błąd aplikacji | Coś poszło nie tak po naszej stronie. | no |
| `misconfigured`, `internal_error` (500) | Usługa chwilowo niedostępna | Spróbuj ponownie później. | no |
| fetch error while online | Nie udało się połączyć z serwerem | Sprawdź połączenie i spróbuj ponownie. | yes |

### 11.2 Long documents and the 10 requests/min limit
- Requests are sent one at a time (no parallel calls), spaced at least 6 s apart. On 429 the client waits `Retry-After` (60 s), shows the countdown, and continues; finished chunks are kept and never sent again.
- A run is capped at 12 requests (analysis chunks plus the summary call). A document that needs more is analysed up to the cap and the result says "Przeanalizowano strony 1-N z M" (pl-PL plurals).
- Scan pages: the client renders JPEG so that one image is at most 700 000 base64 characters, 4 pages per request (an 8-image call took 37-40 s against the Worker budget); quality is lowered until it fits. The Worker's per-image limit (1 500 000) stays as a safety net.
- Slow runs: 38 s Worker budget per request (22 s per model call) plus the summary call can exceed 30 s on long files; the 30 s goal applies to a single-chunk text document.
