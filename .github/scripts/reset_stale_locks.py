#!/usr/bin/env python3
"""Reconcile stale AGIOS in-progress issues.

Rules:
- stale lock + linked open PR: move issue to needs-review
- stale lock + merged closing PR: close issue and mark implemented
- stale lock + closed unmerged closing PR: mark blocked for human review
- stale lock + no PR: return to the original queue when known
"""
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone

REPO = os.environ.get("GITHUB_REPOSITORY", "")
STALE_AFTER = timedelta(hours=2)
IN_PROGRESS = "agios:in-progress"
READY = "agios:ready-for-codex"
ESCALATE_CODEX = "agios:escalate-codex"
NEEDS_REVIEW = "agios:needs-review"
BLOCKED = "agios:blocked"
IMPLEMENTED = "agios:implemented"


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def linked_prs(issue_number):
    raw = run(f'gh pr list --repo "{REPO}" --state all --json number,body,state,mergedAt,url --limit 100')
    prs = json.loads(raw or "[]")
    pattern = re.compile(rf"\b(?:[Cc]loses?|[Ff]ixes|[Rr]esolves?)\s+#\s*{issue_number}\b")
    return [pr for pr in prs if pattern.search(pr.get("body") or "")]


def original_queue_label(issue_number):
    raw = run(f'gh issue view {issue_number} --repo "{REPO}" --json labels')
    data = json.loads(raw or "{}")
    labels = {label.get("name") for label in data.get("labels") or []}
    if ESCALATE_CODEX in labels:
        return ESCALATE_CODEX
    if READY in labels:
        return READY

    raw = run(f'gh issue view {issue_number} --repo "{REPO}" --json comments')
    data = json.loads(raw or "{}")
    for comment in reversed(data.get("comments") or []):
        body = comment.get("body") or ""
        if re.search(rf"(?:Original queue|Queue):\s*`?{re.escape(ESCALATE_CODEX)}`?", body, re.I):
            return ESCALATE_CODEX
        if re.search(rf"(?:Original queue|Queue):\s*`?{re.escape(READY)}`?", body, re.I):
            return READY
        if ESCALATE_CODEX in body:
            return ESCALATE_CODEX
        if READY in body:
            return READY
    return READY


def add_label(num, label):
    run(f'gh issue edit {num} --repo "{REPO}" --add-label "{label}"')


def remove_label(num, label):
    run(f'gh issue edit {num} --repo "{REPO}" --remove-label "{label}"')


def comment(num, body):
    run(f'gh issue comment {num} --repo "{REPO}" --body {json.dumps(body)}')


def main():
    if not REPO:
        print("GITHUB_REPOSITORY not set")
        return
    raw = run(f'gh issue list --repo "{REPO}" --label "{IN_PROGRESS}" --state open --json number,title,updatedAt --limit 100')
    issues = json.loads(raw or "[]")
    now = datetime.now(timezone.utc)
    for issue in issues:
        updated = datetime.fromisoformat(issue["updatedAt"].replace("Z", "+00:00"))
        age = now - updated
        if age < STALE_AFTER:
            continue
        num = issue["number"]
        prs = linked_prs(num)
        open_pr = next((pr for pr in prs if pr.get("state") == "OPEN"), None)
        merged_pr = next((pr for pr in prs if pr.get("mergedAt")), None)
        closed_pr = next((pr for pr in prs if pr.get("state") == "CLOSED" and not pr.get("mergedAt")), None)

        remove_label(num, IN_PROGRESS)

        if open_pr:
            add_label(num, NEEDS_REVIEW)
            body = "[AGIOS STALE LOCK RECONCILED] Moved to `agios:needs-review` at {}\n\nReason: linked open PR exists after {} minutes.\n\nLinked PR: {}".format(
                now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                int(age.total_seconds() // 60),
                open_pr.get("url"),
            )
            comment(num, body)
            print(f"RECONCILED #{num} -> PR #{open_pr['number']}")
            continue

        if merged_pr:
            remove_label(num, READY)
            remove_label(num, ESCALATE_CODEX)
            remove_label(num, NEEDS_REVIEW)
            add_label(num, IMPLEMENTED)
            run(f'gh issue close {num} --repo "{REPO}" --reason completed')
            body = "[AGIOS MERGE FOLLOW-THROUGH] Closed and marked `agios:implemented` at {}\n\nReason: linked PR was merged.\n\nLinked PR: {}".format(
                now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                merged_pr.get("url"),
            )
            comment(num, body)
            print(f"IMPLEMENTED #{num} -> PR #{merged_pr['number']}")
            continue

        if closed_pr:
            add_label(num, BLOCKED)
            body = "[AGIOS STALE LOCK BLOCKED] Marked `agios:blocked` at {}\n\nReason: linked PR was closed without merge.\n\nLinked PR: {}".format(
                now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                closed_pr.get("url"),
            )
            comment(num, body)
            print(f"BLOCKED #{num} -> PR #{closed_pr['number']}")
            continue

        queue_label = original_queue_label(num)
        add_label(num, queue_label)
        body = "[AGIOS STALE LOCK RESET] Returned to `{}` at {}\n\nReason: no linked PR after {} minutes.".format(
            queue_label,
            now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            int(age.total_seconds() // 60),
        )
        comment(num, body)
        print(f"RESET #{num} {issue['title']} -> {queue_label}")

if __name__ == "__main__":
    main()
