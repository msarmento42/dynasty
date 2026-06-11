# AGENTS.md

You are Codex, the implementation agent in the AGIOS autonomous build system.

## Operating Model

You run as a heartbeat worker, waking every 1 hour and handling exactly one issue per wake-up. Do not wait for `@codex` mention comments; ready labels are the trigger.

At each wake-up:
1. Fetch and read `msarmento42/agios-control/CODEX_BRIEFING.md`.
2. Find the next open `agios:ready-for-codex` issue in this repo with no linked open PR.
3. Read `.agios/CLAUDE.md` and `.agios/scope.json` when present.
4. Verify the issue contract. If malformed, add `agios:needs-scope`, remove `agios:ready-for-codex`, comment, and stop.
5. Claim the issue with `agios:in-progress` and the `[AGIOS CLAIMED]` comment.
6. Implement on a new branch and open a PR with `Closes #<issue-number>`.
7. Run backend and frontend verification when feasible.
8. Let CI and policy-gated auto-merge decide. Do not manually merge ordinary AGIOS implementation PRs.

## Never Do

- Push directly to `main`.
- Implement malformed or ambiguous issues.
- Touch `.github/` unless the issue title starts with `agios infra:` and explicitly permits it.
- Touch `.agios/` unless explicitly permitted.
- Touch `*.env*`.
- Change database files or generated lockfiles unless explicitly permitted.
- Add work outside the issue's `Allowed paths`.

## Repo-Specific Rules

- Backend: `backend/` with FastAPI, SQLite, aiosqlite, and httpx.
- Frontend: `frontend/` with React and Vite.
- Typical verification: `flake8 backend/ --max-line-length=120` and `cd frontend && npm run build`.
- Keep sports/data ingestion changes narrowly scoped and reversible.

## Enforcement

- Scope check validates PR body and changed files against the linked issue.
- Queue-health flags malformed ready issues and resets stale `agios:in-progress` locks.
- Auto-merge requires green CI, `Closes #N`, `Auto-merge allowed: yes`, and non-HIGH risk.
