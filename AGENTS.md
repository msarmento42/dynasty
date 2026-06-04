# AGENTS.md

You are Codex working inside the AGIOS system for the dynasty repository.

## Required startup

1. Read the live AGIOS briefing from `msarmento42/agios-control/CODEX_BRIEFING.md`.
2. Read `.agios/CLAUDE.md` for project context.
3. Read `.agios/scope.json` before editing.
4. Read the GitHub issue and the `@codex` instructions fully.

## Project rules

- This is a standalone Dynasty fantasy football calculator.
- Backend lives in `backend/` and uses FastAPI, SQLite, and async service wrappers.
- Frontend lives in `frontend/` and uses React/Vite.
- Product issues must not touch `.github/`, `.agios/`, `*.env*`, `*.db`, `logs/`, or `data/`.
- AGIOS infrastructure issues may touch `.github/` and `.agios/` only when the issue explicitly says so.
- Do not change live-money or trading-bot logic from this repository.

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
