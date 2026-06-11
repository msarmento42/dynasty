# Dynasty Calculator

A local-first dynasty fantasy football tool personalized to Marcus's leagues.

## What this replaces

KTC + FantasyCalc + FantasyPros, but tuned to specific league settings, roster construction, and historical trade behavior.

## Stack

FastAPI + React/Vite + SQLite.

## Local setup

The app is designed to run locally first. Sleeper and FantasyCalc data comes from public APIs, so no `.env` file is required for the current MVP workflow.

1. Install backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

3. Seed or refresh the local fantasy database:

```bash
python3 -m backend.scripts.daily_sync
```

4. Run the app:

```bash
./start.sh
```

Open the frontend at `http://localhost:5173`. The backend runs on `http://localhost:8001` by default.

## Local data controls

The app shell includes a Local Data panel that checks the SQLite database, shows row counts for the core tables, and can run a manual sync from the browser.

Useful local endpoints:

```bash
curl http://localhost:8001/health
curl http://localhost:8001/fantasy/sync-status
curl -X POST http://localhost:8001/fantasy/sync
```

The startup script reads `API_PORT` for the backend port and passes it through to Vite as `VITE_API_PORT`:

```bash
API_PORT=9000 ./start.sh
```

## Current MVP focus

The near-term product order is:

1. Trade finder and decision support
2. League power rankings
3. Roster strength and portfolio view
4. Rookie player research

## Data sources

- **Sleeper API** - leagues, rosters, picks, transactions, trending players
- **FantasyCalc API** - dynasty values and rookie rankings
- **ESPN unofficial API** - player news and projections when enabled
- **KeepTradeCut** - second-opinion values in a later phase

## Build plan

See `dynasty_calculator_scope.md` for the full build plan.
