# Dynasty AGIOS Context

## Purpose

Build a standalone Dynasty fantasy football calculator for Marcus' three Sleeper leagues. The app should combine Sleeper rosters, FantasyCalc values, ESPN news/schedule data, and later KeepTradeCut comparison data into a personalized dynasty decision system.

## Stack

- Backend: FastAPI, Python, SQLite, aiosqlite, httpx
- Frontend: React, Vite, React Router
- Default branch: `main`

## Current Build Path

**Updated 2026-07-02 — the old "#1-13 scaffold" path below is complete and historical.** The app is live (21 endpoints, 8 pages). Build order is now governed by `DECISION-ENGINE-PLAN.md` at repo root — read it before picking up any issue. It supersedes ROADMAP.md's old Sprint F2/F3 ordering.

**Priority order right now: Phase 0 (data trust layer) issues #268, #269, #270 first, in that order** (#268 player identity mapping → #269 snapshot table → #270 validation gate, which depends on the first two). Do not pick up `agios:escalate-codex` expansion/baseball/UI-polish issues ahead of these three, even if they sort lower by issue number — `AGIOS_CONTEXT.md` has the full pause rationale.

<details>
<summary>Historical: original scaffold build path (#1-13, complete)</summary>

- #1: project scaffold
- #2: data services
- #3: value engine and daily sync
- #4: API endpoints
- #5-#13: proposal engine, frontend surfaces, alerts, calibration, manager profiles, in-season features, and KTC divergences

</details>

## Verification Standards

- Backend changes: `flake8 backend/ --max-line-length=120`
- Frontend changes: `npm run build` from `frontend/`
- Scope changes: CI `Validate scope` must pass

## Safety

Product implementation must stay inside allowed product paths. Infrastructure changes require an explicit AGIOS infrastructure issue.
