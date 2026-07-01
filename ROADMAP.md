# Dynasty App Roadmap

## Vision

One app for all your dynasty leagues — football and baseball — with the analytics that used to require 4 separate tools.

---

## Current Status

**Live as of June 2026:** 21 endpoints, 8 pages, 12 DB tables.

Pages live: Roster Viewer, Trade Builder, Proposals, Playoffs (Monte Carlo), Player Profile, Pick Calculator, Team Needs, Exposure (orphaned — no route).

DB tables with data: `players`, `leagues`, `rosters`, `picks`, `alerts`, `player_snapshots`, `trade_history`, `market_calibration`, `manager_profiles`, `sync_log`, `league_settings`. `news_items` is populated but has no serving endpoint.

**Already in AGIOS queue (agios:ready-for-codex):** #44 (value history), #45 (CSV export), #57 (trade calc), #58 (multi-source rankings), #59 (roster news), #63 (player comparison).

---

## Football Roadmap

### Sprint F1 — Quick Wins (this week)

Fix existing gaps and wire up already-built features that are unreachable.

| Issue | Title | Notes |
|-------|-------|-------|
| #109 | fix: wire Exposure page to nav and App.jsx router | 2-line fix — page is built, just orphaned |
| #110 | fix: dynamic current week in playoff simulator | CURRENT_WEEK = 10 is hardcoded |
| #87  | feat: player news & injury feed | news_items table already populated, just needs endpoint |
| #88  | feat: historical roster value chart | player_snapshots table exists; uses recharts (already installed) |
| #89  | feat: value movers activity feed | compares player_snapshots 7 days apart |

### Sprint F2 — Core Analytics

The daily-use tools Marcus reaches for every week.

| Issue | Title | Notes |
|-------|-------|-------|
| #90  | feat: start/sit recommendations | bench vs starter scoring by position |
| #91  | feat: waiver wire ranker | free agents sorted by dynasty value |
| #93  | feat: rookie rankings by draft class | current draft class sorted by dynasty value |
| #94  | feat: lineup optimizer | optimal lineup respecting league roster settings |
| #95  | feat: dynasty power rankings | leaguewide roster value ranking, week-over-week delta |
| #96  | feat: trade database with search | filterable trade_history with value delta |
| #97  | feat: player alerts & push notifications | surface alerts table + browser push via service worker |

### Sprint F3 — Advanced Tools

Higher-effort features that differentiate the app from off-the-shelf tools.

| Issue | Title | Notes |
|-------|-------|-------|
| #92  | feat: mock draft simulator | AI opponents draft by value; snake + auction modes |
| #98  | feat: season outcome predictor | Monte Carlo for all teams' playoff probability |
| #111 | feat: PWA installable mobile app | manifest.json + service worker for iOS/Android install |
| #112 | feat: unified cross-sport dashboard | combined football + baseball summary landing page |

---

## Baseball Roadmap

### Sprint B1 — MLB Foundation (free APIs)

Everything that follows depends on this data layer being in place first.

| Issue | Title | Notes |
|-------|-------|-------|
| #99  | feat: baseball - MLB Stats API integration | statsapi.mlb.com — no auth required; MLB + all MiLB levels |
| #100 | feat: baseball - player universe (MLB + MiLB) | baseball_players DB table; seed from MLB Stats API |
| #102 | feat: baseball - dynasty trade values | scrape FantasyCalc baseball values weekly |
| #103 | feat: baseball - roster manager | manual roster tracking (Sleeper has no baseball support) |

### Sprint B2 — Baseball Analytics

Core tools for managing a baseball dynasty roster.

| Issue | Title | Notes |
|-------|-------|-------|
| #101 | feat: baseball - prospect tracker with level progression | level badges, ETA, stats by level |
| #104 | feat: baseball - trade analyzer | mirrors football trade analyzer UX |
| #106 | feat: baseball - news & injury feed | promotions + IL moves filtered to rostered players |
| #108 | feat: baseball - startup draft helper | draft board with mark-as-drafted and position filters |

### Sprint B3 — Baseball Power Features

Deep analytics that make this better than any dedicated baseball dynasty app.

| Issue | Title | Notes |
|-------|-------|-------|
| #105 | feat: baseball - prospect profile page | full bio, stats by level, Statcast, prospect grade, age curve |
| #107 | feat: baseball - Statcast metrics dashboard | xwOBA, barrel%, exit velocity, sprint speed for rostered players |

---

## Infrastructure

| Issue | Title | Notes |
|-------|-------|-------|
| #109 | fix: wire Exposure page to nav and App.jsx router | orphaned component — add route + nav link |
| #110 | fix: dynamic current week in playoff simulator | hardcoded CURRENT_WEEK = 10 in playoff_simulator.py |
| #111 | feat: PWA installable mobile app | manifest.json + service worker + icons |
| #112 | feat: unified cross-sport dashboard | default landing page combining football + baseball |

---

## Full Issue Index

| # | Code | Title |
|---|------|-------|
| #87  | F01 | feat: player news & injury feed |
| #88  | F02 | feat: historical roster value chart |
| #89  | F03 | feat: value movers activity feed |
| #90  | F04 | feat: start/sit recommendations |
| #91  | F05 | feat: waiver wire ranker |
| #92  | F06 | feat: mock draft simulator |
| #93  | F07 | feat: rookie rankings by draft class |
| #94  | F08 | feat: lineup optimizer |
| #95  | F09 | feat: dynasty power rankings |
| #96  | F10 | feat: trade database with search |
| #97  | F11 | feat: player alerts & push notifications |
| #98  | F12 | feat: season outcome predictor |
| #99  | B01 | feat: baseball - MLB Stats API integration |
| #100 | B02 | feat: baseball - player universe (MLB + MiLB) |
| #101 | B03 | feat: baseball - prospect tracker with level progression |
| #102 | B04 | feat: baseball - dynasty trade values |
| #103 | B05 | feat: baseball - roster manager |
| #104 | B06 | feat: baseball - trade analyzer |
| #105 | B07 | feat: baseball - prospect profile page |
| #106 | B08 | feat: baseball - news & injury feed |
| #107 | B09 | feat: baseball - Statcast metrics dashboard |
| #108 | B10 | feat: baseball - startup draft helper |
| #109 | I01 | fix: wire Exposure page to nav and App.jsx router |
| #110 | I02 | fix: dynamic current week in playoff simulator |
| #111 | I03 | feat: PWA installable mobile app |
| #112 | I04 | feat: unified cross-sport dashboard |

*Already in AGIOS queue: #44 (value history), #45 (CSV export), #57 (trade calc), #58 (multi-source rankings), #59 (roster news), #63 (player comparison)*

---

## Parallel work: git worktrees

When running more than one Claude Code / Cowork session against this repo at
the same time, use a worktree per session instead of separate full clones or
switching branches back and forth in one directory — avoids uncommitted
changes in one session getting clobbered by a checkout in another. (This repo
has accumulated several ad-hoc `-issue-NN` clone directories over time from
doing this manually — worktrees replace that pattern.)

```
scripts/new-worktree.sh <branch-name>
```

Creates `../<repo-name>-<branch-name>/` on a new branch, ready to open as its
own session. `git worktree remove ../<repo-name>-<branch-name>` when done.
