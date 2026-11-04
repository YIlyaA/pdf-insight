"""Tell CI whether a change needs the code checks or touches docs only.

Usage (CI or locally):
    git diff --name-only BASE HEAD | python ci_changes.py --skip 'docs/**' --skip '*.md' >> "$GITHUB_OUTPUT"

Prints `code=false` only when every changed path matches a --skip glob, otherwise `code=true`.
An empty list (e.g. git could not diff) or no globs also gives `code=true`: when unsure, test.
Globs: `*` and `?` stay inside one path segment, `**` crosses segments, `**/` may match nothing.
Stdlib only; macOS, Linux, Windows.

Docs-only pull requests then run the cheap Linux jobs only, and the macOS (10x) and Windows (2x)
runners stay off. Jobs skipped this way report success, so `main` rulesets need no change.
"""

import argparse
import re
import sys


def _regex(glob: str) -> re.Pattern[str]:
    out, i = [], 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out))


def matches(path: str, glob: str) -> bool:
    return _regex(glob).fullmatch(path) is not None


def needs_code_checks(paths: list[str], skip: list[str]) -> bool:
    clean = [p.strip().replace("\\", "/") for p in paths]
    clean = [p for p in clean if p]
    if not clean or not skip:
        return True
    return any(not any(matches(p, g) for g in skip) for p in clean)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip", action="append", default=[], help="glob of docs-only paths (repeatable)")
    args = parser.parse_args(argv)
    code = needs_code_checks(sys.stdin.read().splitlines(), args.skip)
    print(f"code={'true' if code else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
