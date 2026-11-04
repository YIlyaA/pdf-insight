---
id: T-000
title: <one line>
status: draft         # the owner sets ready; the supervisor runs only ready tasks
labels: []            # complexity:high / risk:high -> builder-opus; test-writer runs for any behaviour change; ui -> fill ## Design
size_limit: 250 lines # code only, excluding tests and lock files
external: []          # e.g. anthropic==2.3.0 (version from the lockfile)
scope: []             # globs of paths the task may change, e.g. [src/app/**, scripts/*.py, docs/]; ** crosses directories, * does not, a trailing / covers everything below. Always allowed: this file, tests/independent/, docs/. Protected paths (conftest.py, pytest.ini, tox.ini, setup.cfg, test_guard.py, .github/, .claude/, .mcp.json, pytest lines in pyproject.toml) fail the guard unless listed here
allow_test_changes: false # true only when the task deletes, removes or skips tests on purpose (the guard then skips those findings; protected paths still count)
---

## Goal
<What changes for the user, in one or two sentences.>

## Scope
- <files / modules this task may touch>

## Interface (frozen before code)
```python
# Signatures, typed constants and the first docstring line of every public function the task adds or changes.
def example(arg: str, limit: int = 5) -> list[str]:
    """What it returns, in one line."""
```

## Design (label `ui` only; delete for tasks without a UI)
Follows the `product-design` skill (`~/.claude/skills/product-design/`). Large UI work: link `design/spec.md` and list only what this task adds. Small UI change: fill the lines here.
- Spec: <`design/spec.md` sections this task builds or changes>
- Flows: <user goal → steps → done, plus failure branches>
- States: <screen/component → loading / empty / error / success / offline / overflow / disabled: what each shows>
- Components: <new or changed components → variants and states>
- Tokens: <tokens added or changed; no hardcoded values>
- Accessibility: <keyboard path, focus management, live regions, contrast pairs>
- Responsive: <what changes at each breakpoint (default 640 / 768 / 1024 / 1280); checked from 320 px>
- Copy: <every new string, in the UI language>
- Images: <none; files made or downloaded (source and licence); or ideas added to `design/image-ideas.md`>

## Threats (label `risk:high` only; delete otherwise)
- <what could go wrong: abuse cases, failure cases, bad or hostile input, partial failures; each one a case the tests must cover>

## Acceptance
1. <behaviour, checked by a test>
2. Real-data check: <how it is verified on real data or with a real key, not only mocks>
3. `Docs checked` URLs for every package in `external`, plus an SDK contract test.
4. Lint and tests pass.
5. UI tasks: `product-design/checklist.md` passes; screenshots at 375 and 1440 px in the PR.

## Superseded behaviour
- <earlier behaviour this task changes on purpose, with every earlier test that pins it (path::name) and its new expected value>.
  The coordinator updates those tests in the spec commit (they are read-only for the builder); a task that changes pinned behaviour
  without listing them fails its gates (seen in a real pipeline run).

## Out of scope
- <what not to do>

## Notes
Earlier task specs and the project `CLAUDE.md` still hold. For any task that changes code behaviour the test-writer writes tests from this file before the builder starts; the builder gets them read-only.
