# PDF Insight: plan

Deadline: 2026-11-05 11:30 (Europe/Warsaw). Demo must stay up 14+ days.

## Architecture

```
Browser (React SPA, GitHub Pages, base /pdf-insight/)
  validate file (type, size, magic bytes)
  pdf.js (worker bundled, BASE_URL path) -> text per page
  page text < 30 chars -> render page to JPEG (scan) -> sent as image
  split into chunks (long docs) -> N requests
        |  POST /analyze   (CORS: demo origin only)
        v
Cloudflare Worker (key in secrets, never in repo)
  origin check, body size cap, rate limit per IP
  prompt: PDF content = data, never instructions
  LLM call with JSON schema output
        |
        v
LLM API (Gemini Flash, vision + JSON mode)

Browser: merge chunk results -> Zod validate -> 1 retry on invalid -> UI
```

Folders: `src/components/`, `src/lib/` (pdf, chunking, merge, schema, history), `src/api/` (client), `worker/` (proxy), `tests/`, `design/`, `docs/`.

## Stages

| # | Stage | Output | Needs from owner |
|---|---|---|---|
| 0 | Analysis, plan | this file | done |
| 1 | Design (product-design) | `design/spec.md`: flows, states, components, tokens, copy | no |
| 2 | Scaffold | Vite + React + TS strict, ESLint, Prettier, Vitest, CI lint > build > deploy | `gh auth login` for push |
| 3 | Schema and merge (TDD) | Zod schema, normalizers (dates ISO, currency ISO 4217, amounts), chunk merge, tests | no |
| 4 | PDF pipeline | validation, pdf.js text, scan detection, page render, chunking | no |
| 5 | Worker | proxy, prompt, CORS, limits, retry, tests with mocked LLM | Cloudflare account, Gemini key |
| 6 | UI | upload, progress, result view, JSON preview and download, history, all states | no |
| 7 | Hardening | edge-case fixtures, injection test, a11y pass, 360 px pass | no |
| 8 | Docs | README (PL), AI_LOG.md (PL, real entries), screenshot | no |
| 9 | Review and ship | fresh-subagent review, PR, merge, Pages live, test as outsider | explicit OK to deploy |

## Edge-case matrix (each gets a test or a manual check)

| Area | Case | Expected |
|---|---|---|
| File | not PDF (renamed .txt/.png), 0 bytes, >10 MB, exactly 10 MB | clear PL error, no request |
| File | corrupt PDF, password-protected, 1 page, 200 pages | error / works / chunks |
| File | filename with diacritics, spaces, very long name | shown intact, truncated in UI |
| Text | scan only, mixed text+scan (test PDF p.11), blank pages, 2-column, rotated | OCR via vision for scans only |
| Text | huge text over chunk limit, weird unicode, RTL, emoji | chunks merge, no crash |
| Language | pl, en, uk, de, mixed (EN summary inside PL doc) | `language` = dominant, summary in that language |
| Type | faktura, umowa, oferta, raport, other, annex inside contract | enum only, rule: main document wins |
| Data | no dates, no amounts, no people | `null` / `[]`, nothing invented |
| Data | PLN, EUR, USD, `12 300,00`, `1 200 000,00 zł`, percent, ranges | ISO currency, numeric value, % excluded |
| Data | people in genitive ("Annę Kowalczyk") | nominative |
| Data | duplicates across chunks | deduplicated |
| AI | invalid JSON, markdown fence, extra/missing fields, wrong types | 1 retry, then error with retry button |
| AI | prompt injection in PDF text | ignored, test fixture |
| AI | LLM 429, 5xx, timeout | PL message, retry button |
| Net | offline, slow >30 s, request aborted, new file mid-analysis | state shown, abort works |
| Abuse | rate limit hit, wrong origin, oversize body, bad JSON body | 429 / 403 / 413 / 400 |
| UI | 360 px, zoom 200%, keyboard only, reduced motion, dark mode | usable |
| Pages | refresh, deep link, wrong base, worker path | works under /pdf-insight/ |
| Privacy | file leaves the browser | notice before first analysis |
| History | localStorage full or disabled, corrupted entry | app still works |
| Security | no key in repo/history, no dangerouslySetInnerHTML, no console.log, no any | CI gate |

## Test fixtures (not only one PDF)

Generated in `tests/fixtures/`: the supplied contract, plus own PDFs: invoice (EN), offer (UK), report (DE), empty text, scan-only, injection, 60-page long, tiny 1-page, mixed, corrupt, encrypted.

## Risks

1. Free LLM tier limits or changes in 14 days: keep provider behind one `worker/llm.ts` function.
2. `gh` token invalid: blocks push and Pages.
3. 30-second target: parallel chunk requests, progress shown, scans only when needed.
