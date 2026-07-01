#!/usr/bin/env python3
"""Validate AGIOS queue issues and move malformed items to needs-scope."""
import json
import os
import re
import subprocess
from datetime import datetime, timezone

REPO = os.environ.get("GITHUB_REPOSITORY", "")
QUEUE_LABELS = ["agios:ready-for-codex", "agios:escalate-codex"]

REQUIRED = [
    ("Type", r"\*\*Type:\*\*\s*(RESEARCH|MAINTENANCE|IMPROVEMENT|EXPERIMENT)"),
    ("Objective", r"\*\*Objective:\*\*\s*\S"),
    ("Allowed paths", r"\*\*Allowed paths:\*\*"),
    ("Blocked paths", r"\*\*Blocked paths:\*\*"),
    ("Implementation instructions", r"\*\*Implementation instructions:\*\*"),
    ("Acceptance criteria", r"- \[ \]\s*\S"),
    ("Verification command", r"\*\*Verification command:\*\*\s*```(?:bash|shell|sh)?\s*\n\s*\S[\s\S]*?\n```"),
    ("Rollback plan", r"\*\*Rollback plan:\*\*\s*\S"),
    ("Risk level", r"\*\*Risk level:\*\*\s*(LOW|MEDIUM|HIGH)"),
    ("Auto-merge allowed", r"\*\*Auto-merge allowed:\*\*\s*(yes|no)"),
]


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def section(body, heading):
    match = re.search(
        rf"\*\*{re.escape(heading)}:\*\*\s*(.*?)(?=\n\*\*[^*\n]+:\*\*|\Z)",
        body or "",
        re.I | re.S,
    )
    return match.group(1).strip() if match else ""


def list_section(body, heading):
    raw = section(body, heading)
    values = []
    for line in raw.splitlines():
        cleaned = line.strip().lstrip("-").strip()
        if cleaned and not cleaned.startswith("```"):
            values.append(cleaned)
    return values


def verification_command(body):
    raw = section(body, "Verification command")
    match = re.search(r"```(?:bash|shell|sh)?\s*\n(.*?)\n```", raw, re.I | re.S)
    return (match.group(1) if match else raw).strip()


def problems_for(title, body):
    problems = []
    for name, pattern in REQUIRED:
        if not re.search(pattern, body or "", re.I | re.M):
            problems.append(f"Missing or empty: **{name}:**")
    if re.search(r"\*\*Risk level:\*\*\s*HIGH", body or "", re.I) and re.search(r"\*\*Auto-merge allowed:\*\*\s*yes", body or "", re.I):
        problems.append("Contradiction: HIGH risk cannot auto-merge")
    if re.search(r"\bTBD\b|\[placeholder\]", body or "", re.I):
        problems.append("Contains placeholder text")

    title_starts_infra = title.lower().startswith("agios infra:")
    allowed_paths = list_section(body, "Allowed paths")
    blocked_paths = list_section(body, "Blocked paths")
    verification = verification_command(body)

    forbidden_allowed = []
    for path in allowed_paths:
        if re.search(r"(^|/)\.github(/|$)|(^|/)\.agios(/|$)|(^|/)\.env$|\.env", path):
            forbidden_allowed.append(path)
    if forbidden_allowed and not title_starts_infra:
        problems.append("Allowed paths include blocked infrastructure or secret paths: " + ", ".join(forbidden_allowed))

    blocked_normalized = {item.rstrip("/") for item in blocked_paths}
    for path in allowed_paths:
        normalized = path.rstrip("/")
        if normalized in blocked_normalized:
            problems.append(f"Allowed path also appears in blocked paths: {path}")

    if re.search(r"(?<![\w.-])python(?![\w.-])", verification):
        problems.append("Verification command must use python3, not python")
    if "/workspace" in verification:
        problems.append("Verification command must run from the repository root, not /workspace")
    if re.search(r"\|\s*tail\b", verification):
        problems.append("Verification command must not hide failures with tail-truncated output")

    return problems


def main():
    if not REPO:
        print("GITHUB_REPOSITORY not set")
        return
    seen = set()
    for queue_label in QUEUE_LABELS:
        raw = run(f'gh issue list --repo "{REPO}" --label "{queue_label}" --state open --json number,title,body --limit 100')
        issues = json.loads(raw or "[]")
        for issue in issues:
            num = issue["number"]
            if num in seen:
                continue
            seen.add(num)
            problems = problems_for(issue.get("title") or "", issue.get("body") or "")
            if not problems:
                print(f"OK #{num} {issue['title']}")
                continue
            run(f'gh issue edit {num} --repo "{REPO}" --remove-label "{queue_label}"')
            run(f'gh issue edit {num} --repo "{REPO}" --add-label "agios:needs-scope"')
            body = "[AGIOS QUEUE HEALTH] Issue failed schema validation at {}\n\n{}".format(
                datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "\n".join(f"- {p}" for p in problems),
            )
            run(f'gh issue comment {num} --repo "{REPO}" --body {json.dumps(body)}')
            print(f"FLAGGED #{num} {issue['title']}")

if __name__ == "__main__":
    main()
