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
1. Open page: header, drop zone, privacy notice, history (if any).
2. Drop a file or press "Wybierz plik" (Enter/Space on the zone opens the picker).
3. Client validation passes (PDF magic bytes, size ≤ 10 MB).
4. Progress shows 4 steps: Wczytywanie > Odczyt tekstu > Analiza AI > Gotowe (long docs: "Analiza AI 2/5"; scans: "Rozpoznawanie stron skanowanych").
5. Result: summary, key points, document facts, entities, amounts, dates, keywords; tabs "Podgląd" / "JSON"; buttons "Pobierz JSON", "Kopiuj JSON", "Analizuj kolejny plik".
- Fails when:
  - wrong type / empty / >10 MB / unreadable / password-protected: inline error under the zone, no request sent, zone stays usable.
  - API error, timeout, rate limit, invalid AI output after 1 retry: error panel with cause and "Spróbuj ponownie" (reruns with the same file) and "Wybierz inny plik".
  - offline: error panel "Brak połączenia", retry available.
  - new file dropped during analysis: current request is aborted, new run starts.
  - refresh during analysis: back to idle (result is in history only if finished).
  - no text and no scan content found: empty state "Nie znaleziono treści".
- Keyboard: Tab > drop zone (Enter opens picker) > history items > theme. After analysis, focus moves to the result heading; on error, to the error heading.

### F2. Open from history
1. History list shows up to 10 recent analyses (file name, date, type).
2. Select one: result view opens from localStorage, no request.
3. "Usuń" removes one entry; "Wyczyść historię" removes all (confirm inline, undo not needed: data is local and cheap).
- Fails when: localStorage disabled or entry corrupted: history hidden / entry skipped silently, app unaffected.

## 3. Information architecture
```
/pdf-insight/   (single screen, no router: avoids Pages 404 problem)
  header: name, short tagline
  main
    UploadPanel (idle) | ProgressPanel (running) | ErrorPanel | ResultPanel
    PrivacyNote
    HistoryList
  footer: link to repo, "Dane przetwarzane przez API AI"
```
| Screen | URL | Main job | Primary action | Content in priority order |
|---|---|---|---|---|
| App | `/pdf-insight/` | analyse a PDF | Wybierz plik | status of current job, result, history |

## 4. Screen × state matrix
| Component | Loading | Empty | Partial | Success | Error | Offline / slow | Overflow | Disabled |
|---|---|---|---|---|---|---|---|---|
| UploadPanel | drag-over highlight | idle: instruction + limits | n/a | n/a | inline validation message | n/a | long file name truncated with title | disabled while analysing (replace by drop = abort + restart, announced) |
| ProgressPanel | 4 steps, current marked, elapsed seconds | n/a | "Analiza AI 2/5" for chunks | n/a | moves to ErrorPanel | after 15 s: "To trwa dłużej niż zwykle…" | n/a | cancel button always enabled |
| ErrorPanel | retry shows progress | n/a | n/a | n/a | title, cause, 2 actions | "Brak połączenia" | long message wraps | retry disabled while running |
| ResultPanel | skeleton never shown (result appears whole) | "Nie znaleziono treści w pliku" | missing fields shown as "Brak danych" | all sections | n/a | n/a | long lists collapse after 8 items with "Pokaż wszystkie (n)"; JSON scrolls in a bordered box | n/a |
| HistoryList | n/a | hidden | n/a | list | corrupted entry skipped | n/a | 10 max, oldest dropped | n/a |

Edge cases: 0/1/many amounts; 60 entities; 200-character file name; missing title/date (`null` shown as "Brak danych"); zoom 200%; 360 px; two tabs (history read on open, written on finish); amounts in several currencies shown grouped by currency.

## 5. Component inventory
| Component | Purpose | Variants | States | Content limits | Keyboard / ARIA | Tokens |
|---|---|---|---|---|---|---|
| Button | actions | primary (lime), secondary (outline), ghost | default, hover, focus-visible, active, disabled, loading | label ≤ 24 chars | native button | `--accent`, `--border`, `--focus` |
| DropZone | choose/drop PDF | idle, drag-over, error | + disabled | hint text 2 lines | `role="button"`, tabindex 0, Enter/Space, `aria-describedby` hint+error, hidden `<input type=file accept=application/pdf>` | `--surface`, `--border-strong` |
| StepList | pipeline progress | 4 steps | pending, active, done, failed | step label ≤ 28 chars | `<ol>`, `aria-current="step"`, live region polite for step name | `--accent`, `--muted` |
| ErrorPanel | explain failure | validation (inline), request failure (panel) | default | message ≤ 160 chars | `role="alert"`, heading receives focus | `--error` |
| ResultSection | titled block | text, list, table | collapsed/expanded | lists collapse > 8 | `<section aria-labelledby>`; toggle is a button with `aria-expanded` | `--surface` |
| FactsTable | document fields, amounts, dates | n/a | n/a | numbers right-aligned, tabular | `<table>` with `<th scope>` | `--mono` |
| Tabs | Podgląd / JSON | 2 tabs | selected | n/a | WAI-ARIA tabs, arrows, Home/End | `--accent` underline |
| JsonView | pretty JSON | n/a | n/a | scroll box, max-height 60vh | `<pre tabindex=0>` + label; text only, never HTML | `--mono` |
| HistoryItem | past result | n/a | hover, focus | name truncated | button + separate delete button with `aria-label` containing file name | `--surface` |
| PrivacyNote | disclosure | n/a | n/a | 2 lines | plain text, visible before upload | `--muted` |
| Toast-free | none; status uses live regions | | | | | |

## 6. Tokens
| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | #F6F7F4 | #0E0F0E | page background |
| `--surface` | #FFFFFF | #161816 | panels |
| `--border` | #D5D9D0 | #2A2D2A | dividers |
| `--border-strong` | #7C8478 | #6A706A | controls, drop zone outline (UI 3:1) |
| `--text` | #141612 | #ECEFEA | body text |
| `--muted` | #4B5247 | #A3A9A0 | secondary text |
| `--accent` | #C6F432 | #C6F432 | primary button fill, active step |
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
| dark border-strong #6A706A / bg | to verify in code test | 3 | pending |

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
| privacy | Treść pliku zostanie wysłana do zewnętrznego API AI w celu analizy. Nie wgrywaj dokumentów, których nie możesz udostępniać. | required by brief |
| err type | To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf. | |
| err size | Plik jest za duży (maks. 10 MB). | show actual size |
| err empty | Plik jest pusty. | |
| err corrupt | Nie udało się odczytać pliku. Może być uszkodzony. | |
| err password | Plik jest chroniony hasłem. Zdejmij zabezpieczenie i spróbuj ponownie. | |
| steps | Wczytywanie pliku / Odczyt tekstu / Analiza AI / Gotowe | |
| scan step | Rozpoznawanie stron skanowanych (n z m) | |
| slow | To trwa dłużej niż zwykle. Analizujemy dłuższy dokument. | after 15 s |
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
| download | Pobierz JSON | filename `<name>.insight.json` |
| copy | Kopiuj JSON / Skopiowano | |
| next | Analizuj kolejny plik | |
| history title | Ostatnie analizy | |
| delete | Usuń | `aria-label`: "Usuń analizę pliku <name>" |
| clear | Wyczyść historię | |
| sections | Podsumowanie / Najważniejsze punkty / Dokument / Podmioty / Kwoty / Daty / Słowa kluczowe | |
| type labels | faktura, umowa, oferta, raport, inne | mapped from enum |

Plural forms (pl-PL): strony (1 strona, 2-4 strony, 5+ stron) through `Intl.PluralRules`.
Dates, amounts via `Intl` with `pl-PL`. Glossary: "analiza" = whole run; "wynik" = result; "plik" = uploaded PDF.

## 10. Images
None. Logo is text; icons are inline SVG (own, no licence issue). No `design/image-ideas.md` entries.
