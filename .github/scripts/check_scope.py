#!/usr/bin/env python3
"""
AGIOS check_scope.py
Issue-level scope enforcement for PRs.

Checks:
1. PR body must contain 'Closes #N'
2. Changed files must be within issue's Allowed paths
3. Changed files must not be in issue's Blocked paths or always-blocked paths

Exit 0 = pass, Exit 1 = violation
If PR_NUMBER is not set, exits 0 (no PR context, skip check).
"""
import json, os, re, subprocess, sys

REPO = os.environ.get("GITHUB_REPOSITORY", "")
PR_NUMBER = os.environ.get("PR_NUMBER", "")

# Always-blocked regardless of issue config
ALWAYS_BLOCKED = [".github/", ".agios/", ".env"]


def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode


def file_matches(filepath, patterns):
    """Return True if filepath matches any of the patterns (prefix or glob-style)."""
    for p in patterns:
        p = p.strip().strip("- ").strip()
        if not p:
            continue
        # Normalize: strip leading ./
        p = p.lstrip("./")
        fp = filepath.lstrip("./")
        # Exact match, prefix match (directory), or wildcard
        if p.endswith("*"):
            prefix = p[:-1]
            if fp.startswith(prefix):
                return True
        elif p.endswith("/"):
            if fp.startswith(p) or fp == p.rstrip("/"):
                return True
        else:
            if fp == p or fp.startswith(p + "/"):
                return True
    return False


def parse_paths_section(body, field_name):
    """Extract bullet list items from a **Field:** section."""
    pattern = rf"\*\*{re.escape(field_name)}:\*\*\s*(.*?)(?=\n\*\*|\Z)"
    m = re.search(pattern, body, re.DOTALL | re.IGNORECASE)
    if not m:
        return []
    section = m.group(1)
    paths = []
    for line in section.splitlines():
        line = line.strip()
        if line.startswith("-"):
            p = line.lstrip("- ").strip().strip("`")
            if p:
                paths.append(p)
    return paths


def main():
    if not PR_NUMBER:
        print("PR_NUMBER not set — skipping scope check (not a PR context)")
        sys.exit(0)

    if not REPO:
        print("GITHUB_REPOSITORY not set — skipping scope check")
        sys.exit(0)

    print(f"Checking scope for PR #{PR_NUMBER} in {REPO}...")

    # Get PR body + changed files
    out, rc = run(f'gh pr view {PR_NUMBER} --repo "{REPO}" --json body,files')
    if rc != 0:
        print(f"Could not read PR #{PR_NUMBER} — skipping scope check")
        sys.exit(0)

    try:
        pr_data = json.loads(out)
    except Exception:
        print("Could not parse PR data — skipping scope check")
        sys.exit(0)

    pr_body = pr_data.get("body") or ""
    changed_files = [f["path"] for f in pr_data.get("files", [])]

    # Gate 1: PR must contain Closes #N
    closes_match = re.search(r"[Cc]loses?\s+#(\d+)", pr_body)
    if not closes_match:
        print("FAIL: PR body must contain 'Closes #N' for scope enforcement.")
        print("      Add a 'Closes #<issue-number>' line to the PR description.")
        sys.exit(1)

    issue_number = closes_match.group(1)
    print(f"  Linked issue: #{issue_number}")

    # Get issue body
    out, rc = run(f'gh issue view {issue_number} --repo "{REPO}" --json body')
    if rc != 0:
        print(f"Could not read issue #{issue_number} — skipping scope check")
        sys.exit(0)

    try:
        issue_data = json.loads(out)
    except Exception:
        print("Could not parse issue data — skipping scope check")
        sys.exit(0)

    issue_body = issue_data.get("body") or ""

    # Parse allowed and blocked paths from issue
    issue_allowed = parse_paths_section(issue_body, "Allowed paths")
    issue_blocked = parse_paths_section(issue_body, "Blocked paths")

    effective_blocked = ALWAYS_BLOCKED + issue_blocked
    effective_allowed = issue_allowed  # empty = all non-blocked files allowed

    print(f"  Allowed paths ({len(effective_allowed)}): {effective_allowed or ['(any non-blocked)']}")
    print(f"  Blocked paths ({len(effective_blocked)}): {effective_blocked}")
    print(f"  Changed files ({len(changed_files)}): {changed_files}")

    violations = []
    for filepath in changed_files:
        # Check blocked first (takes priority)
        if file_matches(filepath, effective_blocked):
            violations.append((filepath, "in blocked paths"))
            continue
        # Check allowed (if list is non-empty, file must match)
        if effective_allowed and not file_matches(filepath, effective_allowed):
            violations.append((filepath, "not in allowed paths"))

    if violations:
        print(f"\nSCOPE VIOLATION — {len(violations)} file(s) out of bounds:")
        for filepath, reason in violations:
            print(f"  ✗ {filepath}  ({reason})")
        print(f"\nIssue #{issue_number} defines the allowed scope for this PR.")
        print("Update the issue's Allowed paths or adjust your changes.")
        sys.exit(1)

    print(f"\n✓ All {len(changed_files)} changed file(s) are within scope")
    sys.exit(0)


if __name__ == "__main__":
    main()
