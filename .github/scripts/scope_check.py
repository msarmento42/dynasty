#!/usr/bin/env python3
"""AGIOS scope check for dynasty."""

from __future__ import annotations

import fnmatch
import json
import os
import subprocess
import sys
from pathlib import Path


DEFAULT_BLOCKED = [".github/**", ".agios/**", "*.env*", "*.db", "logs/**", "data/**"]
INFRA_PREFIX = "agios infra:"


def changed_files() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "origin/main...HEAD"],
        capture_output=True,
        check=False,
        text=True,
    )
    return [path.strip() for path in result.stdout.splitlines() if path.strip()]


def pull_request_title() -> str:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return ""
    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return event.get("pull_request", {}).get("title", "")


def is_infra_pr() -> bool:
    return pull_request_title().lower().startswith(INFRA_PREFIX)


def load_blocked_patterns() -> list[str]:
    scope_path = Path(".agios/scope.json")
    if not scope_path.exists():
        return DEFAULT_BLOCKED
    scope = json.loads(scope_path.read_text(encoding="utf-8"))
    return list(scope.get("blocked_paths", DEFAULT_BLOCKED))


def matches_pattern(path: str, pattern: str) -> bool:
    if pattern.startswith("*.") and "/" not in pattern:
        return fnmatch.fnmatch(Path(path).name, pattern)
    return fnmatch.fnmatch(path, pattern)


def main() -> int:
    changed = changed_files()
    blocked = load_blocked_patterns()

    if is_infra_pr():
        print(f"Scope OK — AGIOS infrastructure PR, {len(changed)} file(s) changed.")
        return 0

    violations = []
    for path in changed:
        for pattern in blocked:
            if matches_pattern(path, pattern):
                violations.append(f"BLOCKED: {path} matches rule '{pattern}'")

    if violations:
        for violation in violations:
            print(violation)
        return 1

    print(f"Scope OK — {len(changed)} file(s) changed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
