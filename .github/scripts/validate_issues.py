#!/usr/bin/env python3
"""
AGIOS validate_issues.py
For each open agios:ready-for-codex issue, checks required fields and flags contradictions.
On failure: removes agios:ready-for-codex, applies agios:needs-scope, posts comment.
"""
import json, os, re, subprocess, sys
from datetime import datetime

REPO = os.environ.get("GITHUB_REPOSITORY", "")
GH_TOKEN = os.environ.get("GH_TOKEN", "")

REQUIRED_FIELDS = [
    ("Type",                  r"\*\*Type:\*\*\s*(\S+)"),
    ("Objective",             r"\*\*Objective:\*\*\s*(.+)"),
    ("Allowed paths",         r"\*\*Allowed paths:\*\*"),
    ("Blocked paths",         r"\*\*Blocked paths:\*\*"),
    ("Implementation instructions", r"\*\*Implementation instructions:\*\*"),
    ("Acceptance criteria",   r"- \[ \]"),
    ("Verification command",  r"```"),
    ("Rollback plan",         r"\*\*Rollback plan:\*\*\s*(.+)"),
    ("Risk level",            r"\*\*Risk level:\*\*\s*(LOW|MEDIUM|HIGH)"),
    ("Auto-merge allowed",    r"\*\*Auto-merge allowed:\*\*\s*(yes|no)"),
    ("Success metric",        r"\*\*Success metric:\*\*\s*(.+)"),
]

VALID_TYPES = {"IMPROVEMENT", "MAINTENANCE", "RESEARCH", "EXPERIMENT"}


def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()


def get_issues():
    out = run(f'gh issue list --repo "{REPO}" --label "agios:ready-for-codex" --state open --json number,title,body --limit 100')
    try:
        return json.loads(out)
    except Exception:
        return []


def validate(issue):
    body = issue.get("body") or ""
    problems = []

    # Check required fields
    for name, pattern in REQUIRED_FIELDS:
        if not re.search(pattern, body, re.IGNORECASE | re.MULTILINE):
            problems.append(f"Missing or empty: `**{name}:**`")

    # Validate Type value
    m = re.search(r"\*\*Type:\*\*\s*(\S+)", body, re.IGNORECASE)
    if m and m.group(1).upper() not in VALID_TYPES:
        problems.append(f"Invalid Type `{m.group(1)}` — must be one of: IMPROVEMENT, MAINTENANCE, RESEARCH, EXPERIMENT")

    # Contradiction: Risk HIGH + Auto-merge yes
    risk_high = bool(re.search(r"\*\*Risk level:\*\*\s*HIGH", body, re.IGNORECASE))
    auto_yes  = bool(re.search(r"\*\*Auto-merge allowed:\*\*\s*yes", body, re.IGNORECASE))
    if risk_high and auto_yes:
        problems.append("Contradiction: `Risk level: HIGH` + `Auto-merge allowed: yes`")

    # Contradiction: Allowed paths contains protected dirs
    allowed_section = re.search(r"\*\*Allowed paths:\*\*(.*?)(\*\*|\Z)", body, re.DOTALL)
    if allowed_section:
        section_text = allowed_section.group(1)
        for protected in [".github/", ".agios/", ".env"]:
            if protected in section_text:
                problems.append(f"Contradiction: Allowed paths contains protected path `{protected}`")

    # Flag placeholder content
    if re.search(r"\bTBD\b|\[placeholder\]", body, re.IGNORECASE):
        problems.append("Body contains placeholder text (`TBD` or `[placeholder]`)")

    return problems


def flag_issue(num, problems):
    # Remove ready-for-codex, add needs-scope
    run(f'gh issue edit {num} --repo "{REPO}" --remove-label "agios:ready-for-codex"')
    run(f'gh issue edit {num} --repo "{REPO}" --add-label "agios:needs-scope"')

    # Post comment
    problem_list = "\n".join(f"- {p}" for p in problems)
    comment = f"""[AGIOS QUEUE HEALTH] Issue failed schema validation at {datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}

**Problems found:**
{problem_list}

Label changed: `agios:ready-for-codex` → `agios:needs-scope`
Fix the issues above and re-apply `agios:ready-for-codex` to re-queue."""
    run(f'gh issue comment {num} --repo "{REPO}" --body {json.dumps(comment)}')


def main():
    if not REPO:
        print("GITHUB_REPOSITORY not set — skipping validation")
        return

    issues = get_issues()
    print(f"Validating {len(issues)} ready-for-codex issue(s)...")

    flagged = 0
    for issue in issues:
        num   = issue["number"]
        title = issue["title"]
        problems = validate(issue)
        if problems:
            print(f"  ⚠ #{num} {title} — {len(problems)} problem(s)")
            for p in problems:
                print(f"      {p}")
            flag_issue(num, problems)
            flagged += 1
        else:
            print(f"  ✓ #{num} {title}")

    print(f"\nValidation complete: {flagged}/{len(issues)} issue(s) flagged")


if __name__ == "__main__":
    main()
