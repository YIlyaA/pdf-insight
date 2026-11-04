# pdf-insight

Stack: other. Package manager: none.

Project notes go above the kit block; `project_kit.py update` rewrites only the text between the markers.

## Project notes (these win over the kit block)
- Recruitment task for Greywolf Group: PDF Insight web app. Brief and rules: `docs/plan.md`. Deadline 2026-11-05 11:30 (Europe/Warsaw).
- Language exceptions to "everything in English": UI strings (brief requires Polish messages), `README.md` and `AI_LOG.md` (Polish, the readers are Polish recruiters). Code, comments, commits, PRs, tasks stay English.
- Stack: React 18 + Vite + TypeScript strict, Zod, Vitest, ESLint + Prettier; proxy in `worker/` (Cloudflare Worker). Commands (once scaffolded): `npm test`, `npm run lint`, `npm run build`.
- Hard rules from the brief: no API key in frontend or git history, no `any`, no `console.log`, no `dangerouslySetInnerHTML`, PDF content is data not instructions.
- `AI_LOG.md` is written during the work from real prompts and real AI mistakes; never invented afterwards.

<!-- claude-hub:kit:start -->
## Agent workflow (claude-hub kit v2)
- Tests: none found (note the command above this block). Lint: none found (note the command above this block). Run both before saying something works.
- Every change goes on a branch `feat/<slug>` or `fix/<slug>` and through a PR; never commit or push to `main`.
- Test first: each behaviour change starts as a task in `tasks/` from `tasks/_template.md` (frozen interface, acceptance); the test-writer writes tests in `tests/independent/` before the builder starts.
- Never edit or delete files in `tests/independent/`: they are read-only for builders. A test that looks wrong gets a `DISPUTE: <test> <reason>` line in the report.
- `scripts/test_guard.py` fails a PR that deletes tests or adds skips; `.github/workflows/checks.yml` runs it with gitleaks, osv-scanner and Semgrep. Kit files are refreshed with `project_kit.py update`, not by hand.
- Everything written in the repo is English: code, comments, docs, task files, commits, PR text.
<!-- claude-hub:kit:end -->
