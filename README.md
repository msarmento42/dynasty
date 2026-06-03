# Dynasty Calculator

A world-class dynasty fantasy football tool personalized to your exact leagues.

## What this replaces

KTC + FantasyCalc + FantasyPros — but tuned to your specific league settings, scoring, 
roster construction, and historical trade data.

## Stack

FastAPI + React/Vite + SQLite (same as Life OS)

## Data sources

- **Sleeper API** — leagues, rosters, injuries, depth charts, trending
- **FantasyCalc API** — dynasty values, 30-day trends
- **ESPN unofficial API** — player news, projections
- **KeepTradeCut** — second-opinion values (Phase 7)

## Build plan

See `dynasty_calculator_scope.md` for the full 8-phase build plan.

## Phases

| Phase | Description |
|-------|-------------|
| 1 | Value engine — league-adjusted player values |
| 2 | Trade evaluator UI |
| 3 | Trade proposal engine |
| 4 | Market calibration (learn your leagues' actual prices) |
| 5 | FantasyPros intelligence layer |
| 6 | Scheduled task system (daily digest, weekly dynasty report) |
| 7 | KTC second-opinion rankings |
| 8 | Manager tendency model |
