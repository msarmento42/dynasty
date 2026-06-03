#!/usr/bin/env python3
"""
AGIOS Codex Dispatch
Runs after every merge to main. Finds the next unblocked agios:ready-for-codex
issue and invokes Claude Code CLI to implement it autonomously.
"""
import os
import re
import sys
import json
import subprocess
import urllib.request
import urllib.parse

REPO = "msarmento42/dynasty"
GH_TOKEN = os.environ.get("GH_TOKEN", "")
LABEL = "agios:ready-for-codex"
BRIEFING_URL = (
    "https://raw.githubusercontent.com/msarmento42/agios-control/main/CODEX_BRIEFING.md"
)


def gh_api(path, method="GET", data=None):
    url = f"https://api.github.com{path}"
    headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, headers=headers, method=method, data=body)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def get_ready_issues():
    issues = gh_api(
        f"/repos/{REPO}/issues"
        f"?labels={urllib.parse.quote(LABEL)}&state=open&per_page=30"
    )
    return sorted(issues, key=lambda x: x["number"])


def get_closed_issue_numbers():
    closed = gh_api(f"/repos/{REPO}/issues?state=closed&per_page=100")
    return {str(i["number"]) for i in closed}


def extract_deps(body):
    """Extract issue numbers from 'Depends on Issue #X' lines."""
    deps = []
    for line in (body or "").split("\n"):
        if "depends on" in line.lower():
            deps.extend(re.findall(r"#(\d+)", line))
    return deps


def has_open_pr(issue_number):
    prs = gh_api(f"/repos/{REPO}/pulls?state=open&per_page=50")
    for pr in prs:
        body = pr.get("body", "") or ""
        title = pr.get("title", "") or ""
        if f"#{issue_number}" in body or f"#{issue_number}" in title:
            return True
    return False


def fetch_briefing():
    req = urllib.request.Request(BRIEFING_URL, headers={"User-Agent": "agios/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode()


def post_comment(issue_number, message):
    gh_api(
        f"/repos/{REPO}/issues/{issue_number}/comments",
        method="POST",
        data={"body": message},
    )


def main():
    print("🔍 AGIOS Dispatch: scanning for unblocked issues...")

    ready_issues = get_ready_issues()
    if not ready_issues:
        print("No agios:ready-for-codex issues found. Nothing to do.")
        return 0

    closed = get_closed_issue_numbers()

    target = None
    for issue in ready_issues:
        num = str(issue["number"])
        deps = extract_deps(issue.get("body", ""))
        unmet = [d for d in deps if d not in closed]

        if unmet:
            print(f"  #{num}: blocked on {unmet}")
            continue
        if has_open_pr(int(num)):
            print(f"  #{num}: PR already open — skipping")
            continue

        target = issue
        break

    if not target:
        print("All ready issues are blocked or already have PRs.")
        return 0

    issue_num = target["number"]
    issue_title = target["title"]
    issue_body = target.get("body", "")

    print(f"\n✅ Dispatching: #{issue_num} — {issue_title}")

    briefing = fetch_briefing()

    prompt = f"""You are Codex, the AGIOS implementation agent. Read the briefing, then implement the issue exactly as specified.

--- CODEX_BRIEFING (from agios-control) ---
{briefing}
--- END BRIEFING ---

--- ISSUE #{issue_num}: {issue_title} ---
{issue_body}
--- END ISSUE ---

Steps to complete:
1. Run: git checkout -b codex/issue-{issue_num}
2. Implement every file and change specified in the issue
3. Run the verification steps from the issue
4. Run: git add -A && git commit -m "{issue_title} (closes #{issue_num})"
5. Run: git push -u origin codex/issue-{issue_num}
6. Open a PR using gh CLI:
   gh pr create --title "{issue_title}" --body "Closes #{issue_num}

## What changed
[2-4 sentences describing the implementation]

## Files changed
[bullet list of files]

## Verification
- [ ] CI passes (lint + scope check)
- [ ] All checklist items from the issue verified" --base main

Do NOT modify .github/ or .agios/ directories.
Start now.
"""

    post_comment(issue_num, "🤖 **AGIOS Dispatch**: Codex is implementing this issue now via automated dispatch.")  # noqa: E501

    result = subprocess.run(
        [
            "claude",
            "--dangerouslySkipPermissions",
            "-p", prompt,
        ],
        timeout=900,  # 15 min max
    )

    if result.returncode == 0:
        print(f"\n✅ Issue #{issue_num} — implementation complete.")
        return 0
    else:
        msg = f"❌ Claude Code exited with code {result.returncode} on issue #{issue_num}."
        print(msg)
        post_comment(issue_num, f"[BLOCKED] Automated dispatch failed (exit code {result.returncode}). Manual review needed.")  # noqa: E501
        return 1


if __name__ == "__main__":
    sys.exit(main())
