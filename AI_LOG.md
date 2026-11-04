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
| Added a Claude co-author trailer to commits | owner's request | local history rewritten before the first push |

## What I understand and can explain

Every file in `src/lib/` is covered by tests and described in the README. Before submitting I will go through the code line by line.
