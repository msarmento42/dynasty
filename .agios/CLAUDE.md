# Dynasty AGIOS Context

## Purpose

Build a standalone Dynasty fantasy football calculator for Marcus' three Sleeper leagues. The app should combine Sleeper rosters, FantasyCalc values, ESPN news/schedule data, and later KeepTradeCut comparison data into a personalized dynasty decision system.

## Stack

- Backend: FastAPI, Python, SQLite, aiosqlite, httpx
- Frontend: React, Vite, React Router
- Default branch: `main`

## Current Build Path

Issues #1-#13 define the active backlog and must be completed in dependency order.

- #1: project scaffold
- #2: data services
- #3: value engine and daily sync
- #4: API endpoints
- #5-#13: proposal engine, frontend surfaces, alerts, calibration, manager profiles, in-season features, and KTC divergences

## Verification Standards

- Backend changes: `flake8 backend/ --max-line-length=120`
- Frontend changes: `npm run build` from `frontend/`
- Scope changes: CI `Validate scope` must pass

## Safety

Product implementation must stay inside allowed product paths. Infrastructure changes require an explicit AGIOS infrastructure issue.
