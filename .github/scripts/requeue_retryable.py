#!/usr/bin/env python3
"""
AGIOS requeue_retryable.py
For each open agios:ready-for-codex issue that also carries agios:fail-count-1
or agios:fail-count-2 (i.e. it failed before but hasn't hit the 3-strike
dead-letter yet) and is NOT currently agios:in-progress, and has been idle
>3h: remove + re-apply agios:ready-for-codex to fire a fresh router run.

Why this exists: the router only runs when a `labeled` webhook event fires.
A retryable failure (bump_failure_count) leaves agios:ready-for-codex
attached but does not itself relabel anything, so without this nudge an
issue sitting at fail-count 1 or 2 would never be retried again until it
happened to accumulate a 3rd failure some other way -- which also never
happens automatically. This closes that gap.
"""
import json, os, subprocess
from datetime import datetime, timezone, timedelta

REPO = os.environ.get("GITHUB_REPOSITORY", "")
IDLE_THRESHOLD = timedelta(hours=3)
FAIL_COUNT_LABELS = {"agios:fail-count-1", "agios:fail-count-2"}


def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()


def get_candidates():
    out = run(
        f'gh issue list --repo "{REPO}" --label "agios:ready-for-codex" '
        f'--state open --json number,title,labels,updatedAt --limit 100'
    )
    try:
        return json.loads(out)
    except Exception:
        return []


def requeue(num, title, reason):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run(f'gh issue edit {num} --repo "{REPO}" --remove-label "agios:ready-for-codex"')
    run(f'gh issue edit {num} --repo "{REPO}" --add-label "agios:ready-for-codex"')
    comment = (
        f"[AGIOS RETRY NUDGE] — re-queued for another free-builder attempt at {now}\n\n"
        f"Reason: {reason}"
    )
    run(f'gh issue comment {num} --repo "{REPO}" --body {json.dumps(comment)}')


def main():
    if not REPO:
        print("GITHUB_REPOSITORY not set — skipping retry nudge")
        return

    issues = get_candidates()
    now = datetime.now(timezone.utc)
    nudged = 0
    checked = 0

    for issue in issues:
        labels = {l["name"] for l in issue.get("labels", [])}
        if "agios:in-progress" in labels:
            continue  # actively running, leave it alone
        if not (labels & FAIL_COUNT_LABELS):
            continue  # never failed, or already dead-lettered past this point
        checked += 1

        num = issue["number"]
        title = issue["title"]
        try:
            updated = datetime.fromisoformat(issue.get("updatedAt", "").replace("Z", "+00:00"))
        except Exception:
            continue
        age = now - updated
        if age < IDLE_THRESHOLD:
            print(f"  ✓ #{num} {title} — recently touched ({int(age.total_seconds() // 60)}m ago), leaving it")
            continue

        which = sorted(labels & FAIL_COUNT_LABELS)[0]
        reason = f"idle {int(age.total_seconds() // 3600)}h with `{which}`, still under the 3-strike dead-letter limit"
        print(f"  ⚠ #{num} {title} — NUDGING ({reason})")
        requeue(num, title, reason)
        nudged += 1

    print(f"\nRetry nudge complete: {nudged}/{checked} eligible issue(s) requeued (of {len(issues)} ready-for-codex total)")


if __name__ == "__main__":
    main()
