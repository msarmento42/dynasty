# AGENTS.md

You are Codex working inside the AGIOS system for the dynasty repository.

## Session start protocol (run this at the start of every session)

1. Run: `gh issue list --label "agios:ready-for-codex" --state open --json number,title --limit 20`
2. Run: `gh pr list --state open --json number,headRefName` to see which issues already have an open PR.
3. Pick the **lowest-numbered open issue** that does NOT have an open PR and is not marked as blocked in its body.
4. Implement it following the rules below, then open a PR.

If no `agios:ready-for-codex` issues exist, stop and post a comment on the most recently closed issue:
`@msarmento42 — no ready issues in dynasty. Please queue the next item.`

---

## Required startup (before implementing any issue)

1. Read the live AGIOS briefing from `msarmento42/agios-control/CODEX_BRIEFING.md`.
2. Read `.agios/CLAUDE.md` for project context.
3. Read `.agios/scope.json` before editing.
4. Read the GitHub issue and the `@codex` instructions fully.

---

## Project rules

- This is a standalone Dynasty fantasy football calculator.
- Backend lives in `backend/` and uses FastAPI, SQLite, and async service wrappers.
- Frontend lives in `frontend/` and uses React/Vite.
- Product issues must not touch `.github/`, `.agios/`, `*.env*`, `*.db`, `logs/`, or `data/`.
- AGIOS infrastructure issues may touch `.github/` and `.agios/` only when the issue explicitly says so.
- Do not change live-money or trading-bot logic from this repository.

---

## Verification

For backend work, run:

```bash
flake8 backend/ --max-line-length=120
```

For frontend work, run from `frontend/`:

```bash
npm run build
```

Open one PR per issue and include `Closes #<issue-number>` in the PR body.
