# AGIOS_CONTEXT.md — Dynasty App Context for Issue Generation

This file provides context to the AGIOS issue generator (agios-issue-generator) about what kind of issues to create for the `msarmento42/dynasty` repository.

---

## What This App Is

A standalone dynasty fantasy sports tool built by Marcus Sarmento. It replaces subscriptions to KTC, DynastyNerds, FantasyCalc, and similar tools with a personal, locally-hosted app that Marcus controls completely.

**Stack:** FastAPI (Python) backend + React/Vite frontend + SQLite database. Single-port deployment. No external paid APIs.

**Primary user:** Marcus only. This is a personal tool, not a SaaS product. Features should optimize for Marcus's specific workflow and leagues.

---

## Sports Coverage

This app covers two sports:

### Fantasy Football (Dynasty)
- Sleeper API integration for leagues, rosters, picks, trades
- KTC-equivalent dynasty player values stored locally
- 21 API endpoints covering: roster, trade builder, proposals, playoff sim, player profiles, pick calculator, team needs, exposure, news, value movers, start/sit, waiver wire

### Fantasy Baseball (Dynasty)
- MLB Stats API integration (free, no auth: statsapi.mlb.com)
- Covers MLB + all MiLB levels (AAA through Rookie)
- 7 API endpoints covering: player search, player profiles, prospect tracker, roster manager
- Sport IDs: MLB=1, AAA=11, AA=12, A+=13, A=14, Rookie=16

---

## Issue Generation Guidelines

When generating new issues for this repo, focus on:

**Football ideas:**
- Analytics features: value trends, breakout scores, age curves, schedule analysis
- Trade tools: partner finder, multi-team trades, startup mode
- Draft tools: mock simulators, ADP tracking, devy prospects
- UX: alerts, digests, exports, saved views

**Baseball ideas:**
- Player stats: advanced metrics (Statcast xwOBA, barrel%, exit velocity from Baseball Savant)
- Prospect tools: ETA calculator, level progression, scouting grades
- Trade tools: baseball dynasty value comparisons
- Roster tools: taxi squad, FAAB tracker, auction values

**Avoid:**
- League hosting features (Sleeper handles this)
- Live scoring (Sleeper handles this)
- Issues that require paid APIs or non-free data
- Issues touching .env files, secrets, or production credentials

**Decision-engine-first pause (added 2026-07-02, see `DECISION-ENGINE-PLAN.md`):** Do not generate new football analytics/trade-tool/draft-tool expansion issues, baseball issues (Sprint B1-B3), or UI-polish-for-its-own-sake issues until Phase 2 of the decision engine plan (waiver assistant, start/sit, trade analyzer, trade finder — all gated on Phase 0's data-trust layer and logged via Phase 1) has run for real weeks. This does not mean close or ignore the existing backlog — it means stop adding to it. Data-trust-layer issues (player identity mapping, snapshot freshness, validation gating, recommendation logging) are in scope and should be prioritized above everything else in this file.

---

## Allowed Paths (for AGIOS builder)

Football:
- `backend/routers/fantasy.py` — add new endpoints here
- `backend/routers/pick_calculator.py` — pick-related endpoints
- `backend/routers/playoff_simulator.py` — playoff/simulation endpoints
- `frontend/src/pages/*.jsx` — new pages
- `frontend/src/components/*.jsx` — reusable components
- `frontend/src/App.jsx` — add routes and nav links
- `backend/db/schema.sql` — add new tables

Baseball:
- `backend/routers/baseball.py` — add new baseball endpoints
- `backend/services/mlb_stats.py` — extend MLB Stats API client
- `frontend/src/pages/baseball/*.jsx` — new baseball pages

**Never touch:**
- `backend/main.py` startup order (only add import + include_router at the end)
- Production secrets or .env files
- SQLite WAL or backup scripts
- `.agios/` or `.github/` unless the issue explicitly says so

---

## Issue Quality Bar

Each generated issue should:
1. Be implementable in a single PR by a capable AI coding agent
2. Fit entirely within the allowed paths above
3. Have a clear What / Why / Notes structure
4. Reference specific file paths where implementation goes
5. Not duplicate an existing open issue

Issues that are too large (e.g., require rewriting multiple major subsystems) should be broken into smaller sub-issues.

---

## Backlog Context (as of 2026-06-27)

The backlog currently includes 33+ football feature issues (#113-#145) covering:
- Analytics: value trend charts, age curves, breakout scores, target share, SOS analyzer, dynasty grade, career comps
- Trade tools: partner finder, trade value history, startup mode, conditional trades, trade block/wishlist, multi-team trades
- Draft tools: mock simulator, rookie ADP tracker, draft optimizer, devy tracker, combine scores
- Roster: IR/taxi manager, roster construction grade, FAAB tracker, tiered player board
- News/Intel: digest, sentiment analysis, value alerts, league activity feed, weekly recap
- UX: global search, saved filter presets, comparison bookmarks, CSV export, settings page

**Superseded 2026-07-02:** do not act on this preference (baseball / deeper analytics) until the decision-engine-first pause above is lifted. See `DECISION-ENGINE-PLAN.md`.

## Marcus OS boundary

Dynasty is a standalone decision engine and stays that way. One integration exists: an exporter that writes strategy/review summaries (trade rationale, season reviews, league strategy) as Markdown for Marcus's private vault. Do not generate issues that move dynasty features into life-os or duplicate vault content here. Exports are summaries — never full roster/valuation dumps.

---
