#!/usr/bin/env python3
"""AGIOS PR scope enforcement template."""
import json
import os
import re
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY", "")
PR_NUMBER = os.environ.get("PR_NUMBER", "")
ALWAYS_BLOCKED = [".env", "*.env*"]
GITHUB_META_BLOCKED = [".github/", ".agios/"]

# Paths the repo owner can touch directly, without a linked AGIOS issue --
# these are pipeline/infra files, never application code. Anything outside
# this list (or authored by anyone but the owner) still needs a linked
# issue with matching Allowed paths, same as before.
TRUSTED_INFRA_PATHS = [
    ".github/workflows/",
    ".github/scripts/",
    "scripts/",
    "tools/",
    "builder-policy.json",
    ".gitignore",
    "CODEX_BRIEFING.md",
    "AGIOS_CONTEXT.md",
]


def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout.strip(), result.returncode


def parse_paths(body, field):
    match = re.search(rf"\*\*{re.escape(field)}:\*\*\s*(.*?)(?=\n\*\*|\Z)", body or "", re.S | re.I)
    if not match:
        return []
    paths = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if line.startswith("-"):
            paths.append(line.lstrip("- ").strip().strip("`"))
    return [p for p in paths if p]


def matches(path, patterns):
    path = path.lstrip("./")
    for raw in patterns:
        pattern = raw.strip().lstrip("./")
        if not pattern:
            continue
        if pattern.endswith("*") and path.startswith(pattern[:-1]):
            return True
        if pattern.endswith("/") and path.startswith(pattern):
            return True
        if path == pattern or path.startswith(pattern + "/"):
            return True
    return False


def main():
    if not REPO or not PR_NUMBER:
        print("No PR context; skipping scope check")
        return
    raw, rc = run(f'gh pr view {PR_NUMBER} --repo "{REPO}" --json body,files,author')
    if rc:
        print("Could not read PR; skipping scope check")
        return
    pr = json.loads(raw)
    changed = [f["path"] for f in pr.get("files", [])]
    author = ((pr.get("author") or {}).get("login") or "").lower()
    owner = REPO.split("/", 1)[0].lower() if "/" in REPO else ""

    # Env files are always blocked, no exceptions, checked first.
    env_hits = [p for p in changed if matches(p, ALWAYS_BLOCKED)]
    if env_hits:
        for path in env_hits:
            print(f"SCOPE VIOLATION: {path} (blocked -- env file)")
        sys.exit(1)

    # Owner fast path: repo owner touching only recognized infra/pipeline
    # paths doesn't need a linked issue at all.
    if author and author == owner and changed and all(matches(p, TRUSTED_INFRA_PATHS) for p in changed):
        print(f"Owner-authored infra PR ({author}) touching only trusted infra paths -- scope check passed")
        return

    close = re.search(r"[Cc]loses?\s+#(\d+)", pr.get("body") or "")
    if not close:
        print("FAIL: PR body must contain Closes #N")
        sys.exit(1)
    issue_number = close.group(1)
    raw, rc = run(f'gh issue view {issue_number} --repo "{REPO}" --json body,title')
    if rc:
        print("Could not read linked issue; skipping scope check")
        return
    issue = json.loads(raw)
    is_infra_issue = (issue.get("title") or "").lower().startswith("agios infra:")
    allowed = parse_paths(issue.get("body") or "", "Allowed paths")
    blocked = GITHUB_META_BLOCKED + parse_paths(issue.get("body") or "", "Blocked paths")
    violations = []
    for path in changed:
        if is_infra_issue and allowed and matches(path, allowed):
            continue
        elif matches(path, blocked):
            violations.append((path, "blocked"))
        elif allowed and not matches(path, allowed):
            violations.append((path, "not allowed"))
    if violations:
        for path, reason in violations:
            print(f"SCOPE VIOLATION: {path} ({reason})")
        sys.exit(1)
    print("Scope check passed")

if __name__ == "__main__":
    main()
