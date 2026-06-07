#!/usr/bin/env python3
"""
AGIOS reset_stale_locks.py
For each open agios:in-progress issue updated >2h ago with no linked open PR:
  - Remove agios:in-progress
  - Re-apply agios:ready-for-codex
  - Post [AGIOS STALE LOCK RESET] comment
"""
import json, os, re, subprocess
from datetime import datetime, timezone, timedelta

REPO = os.environ.get("GITHUB_REPOSITORY", "")
STALE_THRESHOLD = timedelta(hours=2)


def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()


def get_in_progress():
    out = run(f'gh issue list --repo "{REPO}" --label "agios:in-progress" --state open --json number,title,updatedAt --limit 100')
    try:
        return json.loads(out)
    except Exception:
        return []


def get_open_pr_for_issue(num):
    """Check if any open PR body references this issue number."""
    prs = run(f'gh pr list --repo "{REPO}" --state open --json number,body --limit 50')
    try:
        pr_list = json.loads(prs)
    except Exception:
        return None
    pattern = re.compile(rf"[Cc]loses?\s+#\s*{num}\b")
    for pr in pr_list:
        if pattern.search(pr.get("body") or ""):
            return pr["number"]
    return None


def reset_lock(num, title, reason):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run(f'gh issue edit {num} --repo "{REPO}" --remove-label "agios:in-progress"')
    run(f'gh issue edit {num} --repo "{REPO}" --add-label "agios:ready-for-codex"')
    comment = f"[AGIOS STALE LOCK RESET] — returned to `agios:ready-for-codex` at {now}\n\nReason: {reason}"
    run(f'gh issue comment {num} --repo "{REPO}" --body {json.dumps(comment)}')


def main():
    if not REPO:
        print("GITHUB_REPOSITORY not set — skipping stale lock check")
        return

    issues = get_in_progress()
    print(f"Checking {len(issues)} in-progress issue(s) for stale locks...")

    now = datetime.now(timezone.utc)
    reset_count = 0

    for issue in issues:
        num        = issue["number"]
        title      = issue["title"]
        updated_at = issue.get("updatedAt", "")

        try:
            updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except Exception:
            print(f"  SKIP #{num}: could not parse updatedAt ({updated_at})")
            continue

        age = now - updated
        if age < STALE_THRESHOLD:
            print(f"  ✓ #{num} {title} — active ({int(age.total_seconds() // 60)}m old)")
            continue

        # Check for linked open PR
        pr = get_open_pr_for_issue(num)
        if pr:
            print(f"  ✓ #{num} {title} — stale timestamp but has open PR #{pr}")
            continue

        # Stale and no PR — reset
        reason = f"No linked open PR found after {int(age.total_seconds() // 3600)}h {int((age.total_seconds() % 3600) // 60)}m"
        print(f"  ⚠ #{num} {title} — RESETTING ({reason})")
        reset_lock(num, title, reason)
        reset_count += 1

    print(f"\nStale lock check complete: {reset_count}/{len(issues)} lock(s) reset")


if __name__ == "__main__":
    main()
