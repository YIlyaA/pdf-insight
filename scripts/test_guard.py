"""Fail when a branch weakens tests: deleted test files, removed test functions, new skips or focus markers.

Usage (CI or locally):  python test_guard.py [--base origin/main] [--spec tasks/<ID>-<slug>.md] [--strict]
Exit 1 with a list of findings, 0 when clean, 2 when the spec file cannot be read. Stdlib only; macOS, Linux, Windows.

Agents under pressure tend to make tests pass by deleting or skipping them. This check runs
outside the agent, against the merge-base with the base branch, so the agent cannot argue with it.
A deliberate removal is fine: mention it in the PR and the human merges with the failing check
waived, or adds `test-guard: allow` to a commit message on the branch.
`--strict` ignores that waiver: the supervisor's gate uses it, since a builder could write the
waiver into its own commit message.

`--spec <task file>` (the supervisor's mode) also ignores the commit-message waiver; only the spec's
frontmatter `allow_test_changes: true` skips the test-weakening findings. The policy fields come from a
trusted copy of the spec (the merge-base version, else the branch's first commit that added it); a branch
that changes them gets the blocking finding `spec policy changed`. It adds blocking findings for
protected paths (test config, CI, agent settings, this guard) unless the spec's `scope` lists them, and
prints warn-only heuristics (`test-guard: WARN <kind>: ...`) that never change the exit code: scope, size,
exit-hack, assert-drop, dependency.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys

TEST_FILE = re.compile(r"(^|/)(tests?/|__tests__/)|(^|/)test_[^/]+\.py$|_test\.py$|\.(test|spec)\.[jt]sx?$")
TEST_DEF = re.compile(r"^\s*(?:async\s+)?def\s+(test_\w+)|^\s*(?:it|test)\s*\(\s*['\"`]([^'\"`]+)")
WEAKENING = [
    (re.compile(r"@pytest\.mark\.(skip|skipif|xfail)\b|\bpytest\.skip\(|@unittest\.skip"), "new skip/xfail"),
    (re.compile(r"\b(it|test|describe)\.(skip|todo)\s*\(|\bx(it|describe|test)\s*\("), "new skipped JS test"),
    (re.compile(r"\b(it|test|describe)\.only\s*\(|\bf(it|describe)\s*\("), "focused JS test (.only)"),
]
ALLOW = "test-guard: allow"

PROTECTED_BASENAMES: frozenset[str] = frozenset({"conftest.py", "pytest.ini", ".pytest.ini", "pytest.toml", "tox.ini",
                                                 "setup.cfg", "test_guard.py"})  # compared lowercase
PROTECTED_PREFIXES: tuple[str, ...] = (".github/", ".claude/")
PROTECTED_FILES = (".mcp.json",)
INDEPENDENT = "tests/independent/"
DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".adoc")
LOCK_FILES = ("package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "go.sum")
EXIT_CALL = re.compile(r"\bsys\.exit\(|\bos\._exit\(")
PYTEST_DETECT = re.compile("PYTEST_" + r"CURRENT_TEST|[\"']pytest[\"']\s+in\s+sys\.modules")  # split: no self-match
MAIN_GUARD = re.compile(r"^\s*if\s+__name__\s*==\s*[\"']__main__[\"']\s*:", re.M)
ASSERT_LINE = re.compile(r"^\s*assert\b|self\.assert\w+\(")
PKG_NAME = re.compile(r"\s*((?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9][A-Za-z0-9._-]*)")
REQUIREMENT = re.compile(r"(@?[A-Za-z0-9][A-Za-z0-9._/-]*)\s*(\[[^\]]*\])?\s*((?:[<>=!~]=?=?|@)\s*[^;]*)?\s*(;.*)?")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
NPM_SECTIONS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def git(*args: str) -> str:
    # quotepath off: non-ASCII paths come out raw; errors="replace": a cp1252 file must not crash the guard
    return subprocess.run(["git", "-c", "core.quotepath=off", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=True).stdout


def _unquote(token: str) -> str:
    """A C-style quoted git path ("a/x\\"y", octal escapes for raw bytes) as text; other tokens unchanged."""
    if len(token) < 2 or token[0] != '"' or token[-1] != '"':
        return token
    body, out, i = token[1:-1], bytearray(), 0
    simple = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 34, "\\": 92}
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            if body[i + 1] in "01234567":
                j = i + 1
                while j < min(i + 4, len(body)) and body[j] in "01234567":
                    j += 1
                out.append(int(body[i + 1:j], 8) & 0xFF)
                i = j
                continue
            out.append(simple.get(body[i + 1], ord("?")))
            i += 2
            continue
        out += ch.encode("utf-8")
        i += 1
    return out.decode("utf-8", errors="replace")


def _strip_side(path: str) -> str:
    path = _unquote(path.rstrip("\t"))
    return path[2:] if path.startswith(("a/", "b/")) else path


def _header_paths(line: str) -> tuple[str, str]:
    """(old, new) path of a `diff --git` header, with C-quoted tokens unquoted."""
    rest = line[len("diff --git "):]
    if rest.startswith('"'):
        j = 1
        while j < len(rest) and rest[j] != '"':
            j += 2 if rest[j] == "\\" else 1
        return _strip_side(rest[:j + 1]), _strip_side(rest[j + 1:].lstrip(" "))
    if rest.endswith('"') and ' "' in rest:
        k = rest.rfind(' "b/')
        k = k if k >= 0 else rest.rfind(' "')
        return _strip_side(rest[:k]), _strip_side(rest[k + 1:])
    n = (len(rest) - 5) // 2  # unquoted "a/X b/X": split in the middle when both halves agree
    if len(rest) >= 5 and rest[:2] == "a/" and rest[2:2 + n] == rest[5 + n:] and rest[2 + n:5 + n] == " b/":
        return rest[2:2 + n], rest[2:2 + n]
    old, sep, new = rest.partition(" b/")  # a rename with spaces; the ---/+++/rename lines correct it
    return (_strip_side(old), new) if sep else (_strip_side(old), _strip_side(old))


def findings(diff: str) -> list[str]:
    found: list[str] = []
    path = ""
    removed: dict[str, set[str]] = {}
    added: dict[str, set[str]] = {}
    for line in diff.splitlines():
        if line.startswith("diff --git"):
            path = _header_paths(line)[1]
        elif line.startswith("deleted file mode") and TEST_FILE.search(path):
            found.append(f"{path}: test file deleted")
        elif not TEST_FILE.search(path) or line.startswith(("+++", "---")):
            continue
        elif line.startswith(("+", "-")):
            body = line[1:]
            match = TEST_DEF.match(body)
            if match:
                name = match.group(1) or match.group(2)
                (added if line[0] == "+" else removed).setdefault(path, set()).add(name)
            if line[0] == "+":
                found += [f"{path}: {label}: {body.strip()}" for rx, label in WEAKENING if rx.search(body)]
    for file, names in removed.items():
        found += [f"{file}: test removed: {name}" for name in sorted(names - added.get(file, set()))]
    return found


# ---------- --spec mode ----------

def _posix(path: str) -> str:
    path = path.strip().replace("\\", "/")
    return path[2:] if path.startswith("./") else path


def _glob_rx(pattern: str) -> re.Pattern:
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        else:
            out.append({"*": "[^/]*", "?": "[^/]"}.get(pattern[i], re.escape(pattern[i])))
            i += 1
    return re.compile("".join(out) + r"\Z")


def scope_match(path: str, patterns: list[str]) -> bool:
    """True when a posix path matches any glob; ** crosses directories, * does not; a pattern ending in / matches everything below it."""
    path = _posix(path)
    for pattern in (_posix(p) for p in patterns):
        if not pattern:
            continue
        if pattern.endswith("/") and path.startswith(pattern):
            return True
        if _glob_rx(pattern).match(path):
            return True
    return False


def _norm_pkg(spec: str) -> str:
    """Lowercase package name with extras and version specifiers stripped; - _ . runs become one -."""
    m = PKG_NAME.match(spec.strip().strip("\"'"))
    return re.sub(r"[-_.]+", "-", m.group(1).lower()) if m else ""


def _inline_list(value: str) -> list[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [v.strip().strip("\"'") for v in value.split(",") if v.strip().strip("\"'")]


def parse_spec(text: str) -> dict:
    """Frontmatter fields the guard needs: scope (list[str]), allow_test_changes (bool), size_limit (int | None), external (list[str], lowercase names)."""
    fields: dict[str, object] = {}
    lines = text.lstrip(chr(0xFEFF)).splitlines()
    if lines and lines[0].strip() == "---":
        key = None
        for line in lines[1:]:
            if line.strip() == "---":
                break
            stripped = re.sub(r"(^|\s)#.*$", "", line).rstrip()
            item = re.match(r"\s+-\s+(.+)$", stripped)
            if item and key and isinstance(fields.get(key), list):  # block list under an empty key
                fields[key].append(item.group(1).strip().strip("\"'"))
                continue
            m = re.match(r"([A-Za-z_][\w-]*)\s*:(.*)$", stripped)
            if m:
                key, value = m.group(1), m.group(2).strip()
                fields[key] = [] if value == "" else value
    scope, external = fields.get("scope", []), fields.get("external", [])
    size = re.match(r"\s*(\d+)", fields["size_limit"]) if isinstance(fields.get("size_limit"), str) else None
    allow = fields.get("allow_test_changes", "")
    return {
        "scope": [_posix(p) for p in (scope if isinstance(scope, list) else _inline_list(scope))],
        "allow_test_changes": isinstance(allow, str) and allow.strip("\"'").lower() == "true",
        "size_limit": int(size.group(1)) if size else None,
        "external": [n for n in (_norm_pkg(e) for e in (external if isinstance(external, list)
                                                        else _inline_list(external))) if n],
    }


def _files(diff: str) -> list[dict]:
    """Per-file records of a unified diff: path, old path, added (lineno, text), removed texts, new, deleted."""
    files: list[dict] = []
    cur: dict | None = None
    in_hunk, lineno = False, 0
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            old, path = (_posix(p) for p in _header_paths(line))
            cur = {"path": path, "old": old, "added": [], "removed": [], "new": False, "deleted": False}
            files.append(cur)
            in_hunk = False
        elif cur is None:
            continue
        elif not in_hunk:  # the ---/+++/rename lines are authoritative over the header split
            if line.startswith("new file mode"):
                cur["new"] = True
            elif line.startswith("deleted file mode"):
                cur["deleted"] = True
            elif line.startswith("rename from "):
                cur["old"] = _posix(_unquote(line[len("rename from "):]))
            elif line.startswith("rename to "):
                cur["path"] = _posix(_unquote(line[len("rename to "):]))
            elif line.startswith("--- ") and line[4:].rstrip("\t") != "/dev/null":
                cur["old"] = _posix(_strip_side(line[4:]))
            elif line.startswith("+++ ") and line[4:].rstrip("\t") != "/dev/null":
                cur["path"] = _posix(_strip_side(line[4:]))
        if line.startswith("@@"):
            m = HUNK.match(line)
            in_hunk, lineno = True, int(m.group(1)) if m else 0
        elif in_hunk and line.startswith("+"):
            cur["added"].append((lineno, line[1:]))
            lineno += 1
        elif in_hunk and line.startswith("-"):
            cur["removed"].append(line[1:])
        elif in_hunk and line.startswith(" "):
            lineno += 1
    return files


def _changed_paths(f: dict) -> list[str]:
    return [f["path"]] + ([f["old"]] if f["old"] != f["path"] else [])


def protected_findings(diff: str, scope: list[str]) -> list[str]:
    """Blocking findings 'protected path: <path>' from a unified diff."""
    found: list[str] = []
    for f in _files(diff):
        lines = [t for _, t in f["added"]] + f["removed"]
        for path in _changed_paths(f):
            if path.startswith(INDEPENDENT) or scope_match(path, scope):
                continue
            low = path.lower()  # macOS and Windows file systems ignore case: .GitHub/ is .github/
            base = low.rsplit("/", 1)[-1]
            if (base in PROTECTED_BASENAMES or low.startswith(PROTECTED_PREFIXES) or low in PROTECTED_FILES
                    or (base == "pyproject.toml" and any("pytest" in t.lower() for t in lines))):
                if f"protected path: {path}" not in found:
                    found.append(f"protected path: {path}")
    return found


def _is_doc(path: str) -> bool:
    return path.startswith("docs/") or path.lower().endswith(DOC_SUFFIXES)


def _is_lock(path: str) -> bool:
    return path.endswith(".lock") or path.rsplit("/", 1)[-1] in LOCK_FILES


def _is_code(path: str) -> bool:
    return not (TEST_FILE.search(path) or _is_doc(path) or _is_lock(path))


def _toml_context(lines: list[str], idx: int) -> tuple[str, str | None]:
    """(table name, nearest `key =` at or above line idx inside that table) for a 0-based line index."""
    key = None
    for j in range(min(idx, len(lines) - 1), -1, -1):
        s = lines[j].strip()
        table = re.match(r"\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$", s)
        if table:
            return table.group(1), key
        km = re.match(r"([A-Za-z0-9_.-]+|\"[^\"]+\")\s*=(?!=)", s)
        if km and key is None:
            key = km.group(1).strip("\"")
    return "", key


def _pyproject_deps(f: dict, head: str | None) -> list[str]:
    names: list[str] = []
    lines = head.splitlines() if head is not None else []
    for lineno, text in f["added"]:
        body = re.sub(r"\s#.*$", "", text)
        quoted = re.findall(r"[\"']([^\"']+)[\"']", body)
        if lines:
            table, key = _toml_context(lines, lineno - 1)
            if re.fullmatch(r"tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies", table):
                own = re.match(r"\s*([A-Za-z0-9_.-]+|\"[^\"]+\")\s*=", body)
                names += [own.group(1).strip("\"")] if own and own.group(1).strip("\"") != "python" else []
                continue
            in_deps = ((table == "project" and key == "dependencies") or table == "project.optional-dependencies"
                       or table == "dependency-groups" or (table == "build-system" and key == "requires"))
            if not in_deps:
                continue
            candidates = quoted
        else:  # no HEAD content: only strings that look like a requirement with a specifier or extras
            candidates = [q for q in quoted if re.search(r"[<>=!~\[]", q)]
        names += [m.group(1) for m in (REQUIREMENT.fullmatch(q.strip()) for q in candidates) if m]
    return names


def _package_json_deps(f: dict, head: str | None) -> list[str]:
    declared: set[str] = set()
    try:
        data = json.loads(head) if head else None
    except ValueError:
        data = None
    if isinstance(data, dict):
        declared = {n for s in NPM_SECTIONS if isinstance(data.get(s), dict) for n in data[s]}
    names = []
    for _, text in f["added"]:
        m = re.match(r"\s*\"([^\"]+)\"\s*:\s*\"([^\"]*)\"", text)
        if not m:
            continue
        if data is not None:
            if m.group(1) in declared:
                names.append(m.group(1))
        elif re.match(r"[\^~<>=*]|\d|latest$|npm:|workspace:|file:|git", m.group(2)) \
                and m.group(1) not in ("name", "version", "node", "npm"):
            names.append(m.group(1))
    return names


def _requirement_names(lines: list[str]) -> list[str]:
    names = []
    for text in lines:
        body = re.sub(r"(^|\s)#.*$", "", text).strip()
        if body and not body.lower().startswith(("-", "git+", "http:", "https:", "file:")):  # -e, -r, URLs
            m = PKG_NAME.match(body)
            names += [m.group(1)] if m else []
    return names


def _removed_names(f: dict, kind: str) -> set[str]:
    """Normalised package names on removed lines: an add with the same name is a bump or a re-sort."""
    if kind == "requirements":
        return {_norm_pkg(n) for n in _requirement_names(f["removed"])}
    names = set()
    for text in f["removed"]:
        names |= {_norm_pkg(q) for q in re.findall(r"[\"']([^\"']+)[\"']", text)}
        own = re.match(r"\s*([A-Za-z0-9_.@/-]+)\s*=", text)  # poetry `name = "^1"`
        names |= {_norm_pkg(own.group(1))} if own else set()
    return names - {""}


def warnings(diff: str, spec: dict, spec_path: str, read_head=None, read_base=None) -> list[str]:
    """Warning texts 'scope: ...', 'size: ...', 'exit-hack: ...', 'assert-drop: ...', 'dependency: ...' (without the WARN prefix); read_head(path) -> str | None supplies the HEAD content of a file."""
    # read_base(path): the merge-base content; the __main__ guard is judged there when the file existed, so a
    # builder cannot add a guard to an old module to cover its own exit call
    read_head = read_head or (lambda path: None)
    read_base = read_base or (lambda path: None)
    spec_path = _posix(spec_path)
    scope, limit = list(spec.get("scope") or []), spec.get("size_limit")
    external = {_norm_pkg(e) for e in spec.get("external") or []}
    out: dict[str, list[str]] = {k: [] for k in ("scope", "size", "exit-hack", "assert-drop", "dependency")}
    code_lines = 0
    for f in _files(diff):
        path, added = f["path"], [t for _, t in f["added"]]
        if scope:
            for p in _changed_paths(f):
                if p != spec_path and not p.startswith((INDEPENDENT, "docs/")) and not scope_match(p, scope):
                    out["scope"].append(f"scope: {p} is outside the spec's scope")
        if _is_code(path) and not f["deleted"]:
            code_lines += len(added)
            exits = [t for t in added if EXIT_CALL.search(t)]
            before = read_base(f["old"]) if not f["new"] else None
            if exits and not MAIN_GUARD.search((before if before is not None else read_head(path)) or ""):
                out["exit-hack"].append(f"exit-hack: {path}: exit call added: {exits[0].strip()}")
            out["exit-hack"] += [f"exit-hack: {path}: pytest detection added: {t.strip()}"
                                 for t in added if PYTEST_DETECT.search(t)]
        if TEST_FILE.search(path) and not f["new"] and not f["deleted"]:
            gone = sum(1 for t in f["removed"] if ASSERT_LINE.search(t))
            kept = sum(1 for t in added if ASSERT_LINE.search(t))
            if gone > kept:
                out["assert-drop"].append(f"assert-drop: {path}: {gone} assert line(s) removed, {kept} added")
        base = path.rsplit("/", 1)[-1]
        deps, kind = [], ""
        if f["deleted"]:
            pass
        elif re.fullmatch(r"requirements[^/]*\.txt", base):
            deps, kind = _requirement_names([t for _, t in f["added"]]), "requirements"
        elif base == "pyproject.toml":
            deps, kind = _pyproject_deps(f, read_head(path)), "pyproject"
        elif base == "package.json":
            deps, kind = _package_json_deps(f, read_head(path)), "package"
        removed = _removed_names(f, kind) if deps else set()
        for name in dict.fromkeys(deps):
            if _norm_pkg(name) and _norm_pkg(name) not in external and _norm_pkg(name) not in removed:
                out["dependency"].append(f"dependency: {name} added in {path} is not in the spec's external list")
    if limit is not None and code_lines > limit:
        out["size"].append(f"size: {code_lines} added line(s) in code files exceed size_limit {limit}")
    return [w for kind in out.values() for w in kind]


def _show(rev: str, path: str) -> str | None:
    """Content of a repo-root-relative path at a revision, or None when it is not there."""
    r = subprocess.run(["git", "-c", "core.quotepath=off", "show", f"{rev}:{path}"], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return r.stdout if r.returncode == 0 else None


def _repo_relative(spec_file: str) -> str | None:
    from pathlib import Path
    try:
        top = Path(git("rev-parse", "--show-toplevel").strip()).resolve()
        return Path(spec_file).resolve().relative_to(top).as_posix()
    except (ValueError, OSError, subprocess.CalledProcessError):
        return None


def _trusted_spec(merge_base: str, rel: str | None) -> str | None:
    """The spec as the base branch has it, else as the branch's first commit that added it (the supervisor
    commits the spec before any agent runs); None when git does not track it."""
    if rel is None:
        return None
    text = _show(merge_base, rel)
    if text is None:
        added = git("log", "--diff-filter=A", "--format=%H", f"{merge_base}..HEAD", "--", f":(top,literal){rel}").split()
        text = _show(added[-1], rel) if added else None  # git log lists newest first
    return text


def _policy(spec: dict) -> tuple:
    return spec["scope"], spec["allow_test_changes"], spec["external"], spec["size_limit"]


def _spec_mode(base: str, merge_base: str, spec_file: str) -> int:
    from pathlib import Path
    rel = _repo_relative(spec_file)
    trusted = _trusted_spec(merge_base, rel)
    try:
        spec = parse_spec(trusted if trusted is not None else Path(spec_file).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        print(f"test-guard: cannot read spec {spec_file}: {exc}")
        return 2
    diff = git("diff", "--no-color", "-U0", merge_base, "HEAD")
    problems: list[str] = []
    if spec["allow_test_changes"]:  # the only waiver in --spec mode; commit messages are ignored
        print(f"test-guard: test changes allowed by {spec_file}")
    else:
        problems += findings(diff)
    problems += protected_findings(diff, spec["scope"])
    head = _show("HEAD", rel) if trusted is not None else None
    if head is not None and _policy(parse_spec(head)) != _policy(spec):  # the trusted values stay in force
        problems.append(f"spec policy changed: {rel}")
    warns = warnings(diff, spec, rel or _posix(spec_file), lambda p: _show("HEAD", p),
                     lambda p: _show(merge_base, p))
    for p in problems:
        print(f"test-guard: {p}")
    for w in warns:
        print(f"test-guard: WARN {w}")
    print(f"test-guard: {len(problems)} finding(s), {len(warns)} warning(s) against {base}")
    return 1 if problems else 0


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows pipes default to the ANSI code page; paths in findings may not fit it
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")
    base = argv[argv.index("--base") + 1] if "--base" in argv else "origin/main"
    if "--spec" in argv and argv.index("--spec") + 1 >= len(argv):
        print("test-guard: --spec needs a task file")
        return 2
    merge_base = git("merge-base", base, "HEAD").strip()
    if "--spec" in argv:
        return _spec_mode(base, merge_base, argv[argv.index("--spec") + 1])
    # --strict (the supervisor's gate): a builder could write the waiver into its own commit message
    if "--strict" not in argv and ALLOW in git("log", "--format=%B", f"{merge_base}..HEAD"):
        print(f"test-guard: skipped ({ALLOW!r} in a commit message)")
        return 0
    problems = findings(git("diff", "--no-color", "-U0", merge_base, "HEAD"))
    for p in problems:
        print(f"test-guard: {p}")
    print(f"test-guard: {len(problems)} finding(s) against {base}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
