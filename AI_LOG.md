# AI_LOG

Working draft, updated as the work goes on. Entries describe what really happened.

## Tools

- **Claude Code** (model Claude Sonnet 5.5) in VS Code: task analysis, design, code, tests, commits.
- **Claude Code subagent**: generated a set of 13 PDF files for edge-case tests.
- **Gemini** (through our own proxy): analysis of the PDF content inside the app (in progress).

## Key prompts

1. The starting prompt: I pasted the recruitment email and asked for "analysis first: conditions, traps, edge cases, then build". Result: `docs/plan.md` with an edge-case matrix.
2. "Do not rely on a single test PDF, invent your own edge cases". Result: `scripts/make_fixtures.py` and 13 files (scan, mixed, prompt injection, 60 pages, corrupt, encrypted).
3. Interface design before code: flows, every state, tokens, Polish copy, contrast computed by a script (`design/spec.md`).
4. Tests before code for the schema, date/amount/currency normalisation, chunking and merging (110 tests, first red, then green).

## Where the AI was wrong and how I fixed it

| Mistake | How it was found | Fix |
|---|---|---|
| Picked ESLint 10, incompatible with `eslint-plugin-jsx-a11y` | `npm install` reported a dependency conflict | pinned ESLint 9, no `--force` |
| The template `.gitignore` did not contain `node_modules` | review before the first commit | added `node_modules/`, `dist/`, `.env` and others |
| Called `doc.destroy()` on a PDF.js document, but in version 6 the method is on the loading task | 11 tests failed with `doc.destroy is not a function` | switched to `task.destroy()` |
| A test expected currency "UAH" in the Ukrainian offer, but the document uses "грн" | test was red with correct code | fixed the test, not the code |
| Copied the recruiter's sample PDF into the repository | owner's remark before publishing | file removed from the whole history, rules added to `.gitignore` |
| Wrote Worker tests that reused one `Response` object for several fetch calls | 3 tests failed with `upstream_error` although the code was right; a response body can be read only once | mocks now create a fresh `Response` per call, like the real `fetch` |
| Chose Gemini model names `gemini-2.5-*` from memory | first live call returned HTTP 404 from Google | read the official model list, switched to `gemini-3.6-flash` with `gemini-3.5-flash-lite` as fallback |
| Treated only quota errors (429) as a reason to switch model | live calls returned HTTP 503 (overloaded) 3 times in a row | added a test first, then fallback on 503 too; 2 live calls then returned 200 |
| Hid provider errors completely, so the 404 was impossible to diagnose | debugging the live call | added only the numeric status in an `x-upstream-status` header, never the provider message |
| Read the whole request body with `request.text()` and checked its length in characters | review session: a chunked body without `content-length` was read fully (live probe: 9 MB, 4.6 s, then 413) and 5M `ą` (10 MB) passed the 8 MB cap | stream the body with a byte counter, test with a chunked stream and with multi-byte text |
| Set the timeout only for the first part of the Gemini call | reviewer subagent: a response that sends headers and stalls was never cut | the timer now covers reading the body; test with a stalled stream |
| Allowed 2 models x 2 attempts x 25 s per request | reviewer: worst case 100 s against a 30 s goal | one 28 s budget per request, retries skipped when too little is left |
| `parseAmount('1.234')` returned 1.234 and a lookup `CURRENCY_ALIASES['constructor']` returned a function | reviewer probes | ambiguous amounts return null; lookups use `Object.hasOwn`; both have tests |
| Escaped only the exact `</document>` tag and put the file name into the prompt unfiltered | review: a file name with a line break or a fullwidth tag got through | tolerant tag escaping, one-line file name, 20 new tests |
| Believed "CORS limits the API to my site" | live probe: `curl` with a fake `Origin` gets 200 | documented in README, added a global limiter and stricter per-client limit |
| CI never ran the tests (the test job was a comment in the template) | reviewer | added a `tests` job and pinned the actions to commit hashes |
| Added a Claude co-author trailer to commits | owner's request | local history rewritten before the first push |
| Builder agents with worktree isolation could not write into the project folder; their code ended up in other worktrees | the project folder had no new files after the agents reported success | files copied by hand from each worktree, then checked in the main folder |
| The test-writer wrote tests that did not pass `noUncheckedIndexedAccess` (`buttons[0]`, `runs[0]`), used non-breaking spaces in regular expressions and left unused parameters | `typecheck` and `lint` were red | fixed after the first run; `first()` helper added |
| The first UI preview used an invented (mock) result, not a real one | owner asked whether it matched reality | ran the real 12-page contract through the live Worker (17.6 s) and checked sums and dates against the PDF text |
| Replaced `onPrivacy={openPrivacy}` in the wrong component (MainPanel instead of Footer) when removing the notice line | `typecheck` failed | corrected the occurrence |
| The spec said "no toast, status only in a live region", so the copy confirmation was invisible to sighted users | owner's question while looking at the result | added a visible status plate for 3 s with `role="status"` |
| Rendered and JPEG-encoded every scan page before applying the 12-request cap | review in a fresh context (prosecutor agent) | test first (300-page scan must render at most 96 pages), then rendering stops at the cap |
| Production build without `VITE_API_URL` succeeded and shipped an app that rejected every file | prosecutor agent built it without the variable | the build now fails with a clear message; CI sets the variable |
| Did not pass `wasmUrl` to pdf.js, so black-and-white (CCITT/JBIG2) scans would not decode | defender agent ran a CCITT test file through pdf.js and saw the warning | build copies the wasm files, `wasmUrl` is passed; a generated black-and-white scan now renders |
| Error text for a file just over the limit read "10 MB, maks. 10 MB" | real run through the UI with a file of 10 MB + 10 bytes | file size is rounded up (`10,1 MB`), test added |
| Any error while `navigator.onLine` was false turned into "Brak połączenia", even a refused file | prosecutor agent | only network errors and client timeouts map to offline; test added |
| Coverage line could claim pages that were never sent when a scan chunk started inside a text chunk | prosecutor and defender agents | `analyzedUpTo()` stops before the first unsent chunk; test added |
| Pinned a GitHub Pages workflow with placeholder hashes in the first commit (a `sed` command failed silently) | defender agent noticed the placeholders | replaced with real commit hashes and amended the unpushed commit |
| `npm install` failed with EPERM (root-owned `~/.npm`) | install output | not an AI mistake; worked around with `--cache` |

## What I understand and can explain

Every file in `src/lib/` is covered by tests and described in the README. Before submitting I will go through the code line by line.
