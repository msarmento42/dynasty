# World-Class Dynasty Calculator — Scope & Build Plan
*Living doc — updated as we build*

---

## What makes this "world class" vs. KTC / FantasyCalc / FantasyPros

| Feature | KTC / FantasyCalc / FantasyPros | This tool |
|---------|--------------------------------|-----------|
| Values | Generic SF or 1QB | Tuned to your exact scoring + roster slots + team count |
| TE valuation | Assumes TE starter slot | Discounts correctly when TE is FLEX-only |
| Trade proposals | You enter players manually | Auto-generates proposals with picks across all your leagues |
| Picks | Shown but not league-tuned | Round + year + league-context valuation |
| Roster context | Generic | "What do my starters look like after this trade?" |
| Market calibration | Global crowd | Your leagues' actual trade history |
| Manager tendencies | None | Who in each league overpays for what position |
| Player news | Generic feed (FantasyPros) | Filtered to YOUR roster players across all 3 leagues |
| Injury alerts | Manual check | Auto-flags depth chart + injury status changes on your roster |
| Projections | Aggregated from analysts | ESPN data + Claude synthesis, personalized to your lineups |
| Start/sit | Generic weekly advice | Your specific starters, your specific matchups |
| Waiver wire | Generic | Filtered to availability in each of your leagues |
| Dynasty rankings | Static tiers | Live composite: FantasyCalc + trend data + league adjustments |
| Integration | Three separate websites | Life OS module — one dashboard for everything |

---

## Architecture

**Stack:** Life OS (FastAPI + React + SQLite) — same as existing modules.

**New backend:** `life-os/backend/routers/fantasy.py`
**New frontend:** `life-os/frontend/src/pages/Fantasy.jsx` (and sub-components)
**New DB tables:** `fantasy_players`, `fantasy_leagues`, `fantasy_rosters`, `fantasy_trades`, `fantasy_pick_values`, `fantasy_news`, `fantasy_injuries`

**Confirmed live data sources (tested 2026-05-29):**
- **Sleeper API** (free, public) — leagues, rosters, transactions, injury status, depth chart order, practice participation, trending adds/drops
- **FantasyCalc API** (free, public) — dynasty values, 30-day trends, positional rankings
- **ESPN unofficial API** (free, public) — player-tagged news feed, scoreboard/schedule, bye weeks
- **ESPN fantasy projections** (free, unofficial) — weekly stat projections (in-season)
- **KeepTradeCut** — second-opinion dynasty values (requires Claude in Chrome for JS rendering)

---

## Phase 1 — Value Engine (Foundation)

**Goal:** Accurate, league-adjusted player values for all 3 leagues.

### 1A — Base value ingestion
- Daily cron hits FantasyCalc SF + 1QB endpoints
- Stores in SQLite: player_id, name, position, team, age, value_sf, value_1qb, trend_30d
- Maps Sleeper player IDs → FantasyCalc player IDs

### 1B — League-specific value adjustment
Per-league config stored in DB:

```python
LEAGUE_CONFIG = {
    "odin": {
        "te_discount": 0.60,        # No required TE slot — TEs compete for FLEX only
        "eff_starters": {"QB":2, "RB":3, "WR":4, "TE":1},  # Approx flex allocation
        "scoring_bonuses": {"bonus_rec_te": 0.75, "bonus_rec_rb": 0.25},
        "n_teams": 12,
        "base_format": "sf",
    },
    "fh_vol8": {
        "te_discount": 1.0,          # 4 required TE starters
        "eff_starters": {"QB":4, "RB":8, "WR":10, "TE":6},
        "scoring_bonuses": {"pass_cmp": 0.5, "pass_inc": -1.0, "rec_fd": 1.0, "rush_fd": 1.0, ...},
        "n_teams": 4,
        "base_format": "sf",
    },
    "fh_allstars": { ... same as vol8 + kickers ... }
}
```

**Adjustments applied:**
1. TE discount (0.6x for Odin, 1.0x for Four Horsemen)
2. Scoring impact multipliers (first-down bonuses in FH significantly boost volume players)
3. VORP (value over replacement at each starter slot, adjusted for team count — replacement level is very different at 4-team vs. 12-team)

### 1C — Age/trajectory module
Classify each player into a career stage:

```python
AGE_CURVES = {
    "QB":  {"rising": (0, 27), "prime": (27, 31), "declining": (31, 99)},
    "RB":  {"rising": (0, 24), "prime": (24, 27), "declining": (27, 99)},
    "WR":  {"rising": (0, 25), "prime": (25, 29), "declining": (29, 99)},
    "TE":  {"rising": (0, 26), "prime": (26, 30), "declining": (30, 99)},
}
```

Output per player: `career_stage`, `years_in_prime_remaining`, `trajectory` (↑/→/↓)

### 1D — Pick valuation model
Rough value by round and year, calibrated by league size:

```python
def pick_value(round, years_away, n_teams):
    base = {1: 4000, 2: 2500, 3: 1500, 4: 800}[round]
    year_discount = 0.85 ** years_away      # Each additional year = 15% discount
    scarcity = (n_teams / 12) ** 0.5        # 4-team pick worth less in absolute terms
    return int(base * year_discount * scarcity)
```

2027 R1 in Odin ≈ **3,400**
2027 R1 in Four Horsemen (4-team) ≈ **1,970**
2028 R1 in Odin ≈ **2,890**

---

## Phase 2 — Trade Evaluator UI

**Goal:** Interactive tool where you can build a proposed trade and see exactly what you're giving up, getting back, and what your roster looks like after.

### Features
- **League selector** — pick which league you're evaluating
- **Trade builder** — pick players + picks from any two teams
- **Value comparison panel:**
  - Side A total value vs. Side B total value
  - Age delta per position
  - Position need delta (are you improving your weakest positions?)
  - Career stage breakdown (how many rising/prime/declining players on each side)
- **Post-trade roster projection** — shows your new starters after the trade executes
- **Verdict chip:** 🟢 WIN / 🟡 FAIR / 🔴 LOSS (based on value delta + position need)

### API endpoints
```
GET /fantasy/leagues               → all 3 leagues with current standings
GET /fantasy/league/{id}/roster    → my roster with adjusted values
GET /fantasy/league/{id}/all-rosters → all teams' rosters + values
POST /fantasy/trade/evaluate       → { side_a: [...players+picks], side_b: [...] } → verdict
GET /fantasy/proposals/{league_id} → auto-generated trade proposals
```

---

## Phase 3 — Trade Proposal Engine

**Goal:** Fully automated "here's what you should be doing" surface per league.

### Algorithm
1. Score my position surplus/deficit vs. league average (per league config)
2. For each other team: find inverse needs (their surplus = my deficit, their deficit = my surplus)
3. Rank trade pairs by: value balance × position need improvement × age delta improvement
4. For each trade pair: generate 2–3 specific player + pick proposals
5. Filter out proposals where I give up too much value (> 10% loss)
6. Return ranked list with full justification

### Pick integration
- When a player-only deal is unbalanced, auto-add picks to close the gap
- Shows: "Add your 2027 R2 to make this offer fair" or "Ask for their 2028 R1 to balance this"

---

## Phase 4 — Market Calibration (Intelligence Layer)

**Goal:** Learn what your leagues actually pay for players, not just what FantasyCalc says.

### Historical trade ingestion
- Pull all transactions of type `trade` from Sleeper API for all 3 leagues
- For each completed trade: extract players + picks on each side
- Build dataset: player A (value X) was traded for player B (value Y) on date Z
- Compute `observed_value_ratio` = what this league actually paid vs. FantasyCalc

### Manager tendency model
After enough trades (~30+ per league):
- Which managers consistently overpay for QBs?
- Which managers always sell picks early?
- Which managers are most likely to accept a trade offer?
- Surface this as "Manager X tends to overpay for WRs — good sell target"

### Calibrated values
`adjusted_value = fc_value × league_calibration_factor`
Where `league_calibration_factor` is derived from observed trade history.

---

## Phase 5 — FantasyPros Intelligence Layer

**Goal:** Everything FantasyPros does, but filtered to your specific rosters and leagues. Uses ESPN API + Sleeper + FantasyCalc + Claude as the synthesizing analyst.

### What FantasyPros does → how we replicate it

**Player news**
- FantasyPros: aggregates beat reporter articles
- Ours: ESPN news API, player-tagged. Confirmed working — articles include athlete names. We filter to ~170 unique players across your 3 rosters and surface only news about your guys.

**Injury reports**
- FantasyPros: shows weekly injury designations
- Ours: Sleeper stores `injury_status`, `injury_body_part`, `injury_start_date`, `practice_participation`, `practice_description` per player. We poll for changes daily and alert when a player on your roster moves from Healthy → Questionable/Out or loses depth chart position.

**Depth chart updates**
- FantasyPros: tracks beat reporter depth charts
- Ours: Sleeper's `depth_chart_order` per player. Track changes day-over-day. If Bucky Irving drops from depth_chart_order=1 to 2, you get an alert.

**Dynasty rankings**
- FantasyPros: aggregates ~20 dynasty analysts
- Ours: FantasyCalc values (primary) + league-specific adjustments + 30-day trend data. Phase 7 adds KTC scrape for second opinion.

**ADP tracking**
- FantasyPros: tracks ADP across platforms
- Ours: Sleeper trending adds/drops as a real-time proxy. If a player is being added 10,000x/day, the market is moving. Phase 7 adds actual ADP endpoint when FantasyCalc enables it.

**Weekly projections** (in-season)
- FantasyPros: aggregated from 20+ projection systems
- Ours: ESPN unofficial projections API + Claude synthesis. ESPN has per-player projections in-season accessible without auth. Claude compares projection to dynasty value to flag "great value start this week."

**Start/sit recommendations** (in-season)
- FantasyPros: matchup grades + expert consensus
- Ours: pull this week's NFL schedule from ESPN → get matchup data → score each starter's matchup quality → Claude generates start/sit with reasoning specific to your actual lineup.

**Waiver wire** (in-season)
- FantasyPros: weekly FAAB targets by position
- Ours: Sleeper trending + available players in YOUR specific leagues → ranked by position need + dynasty value. Each league has different player availability so this is meaningfully personalized.

**Trade values**
- FantasyPros: weekly generic trade value chart
- Ours: FantasyCalc 30-day trend + league-adjusted value + post-trade roster projection. Better than a generic chart because it factors in your specific roster needs.

---

## Phase 6 — Scheduled Task System (Full Suite)

All tasks write to `~/Documents/Claude/trading-bot/logs/` style pattern but at `~/Desktop/Claude/life-os/logs/fantasy-*.md`.

### Year-round tasks

**`fantasy-daily-sync`** — Daily 6:30am
```
- Sync Sleeper rosters + injury data → SQLite
- Refresh FantasyCalc dynasty values
- Detect changes: new injuries, depth chart drops, value moves > 200
- Write: logs/fantasy-daily-YYYY-MM-DD.md
```

**`fantasy-news-digest`** — Daily 7:00am
```
- Pull ESPN news from last 24h
- Filter to players on your 3 rosters (union of ~170 players)
- For each relevant article: extract fantasy impact, flag severity (🔴 urgent / 🟡 notable / 🟢 fyi)
- Append injury/depth chart alerts from daily-sync
- Write: logs/fantasy-news-YYYY-MM-DD.md
```

**`fantasy-dynasty-weekly`** — Sunday 9:00am
```
- Full trade proposal refresh for all 3 leagues
- Dynasty value movers this week (biggest rises + falls on your roster)
- Trending adds across the platform (Sleeper trending API)
- KTC vs FantasyCalc divergences > 20% (buy-low signals)
- Carry-forward from last week: did you send those trade offers? Any responses?
- Write: logs/fantasy-dynasty-YYYY-MM-DD.md
```

### In-season tasks (activate Week 1 through playoffs)

**`fantasy-waiver-wire`** — Wednesday 8:00am
```
- Per league: identify available players (not on any roster)
- Rank by: dynasty value + trending adds + injury situation of starter they back up
- Top 5 pickups per league with FAAB bid suggestion
- Write: logs/fantasy-waiver-YYYY-MM-DD.md
```

**`fantasy-start-sit`** — Thursday 6:00pm
```
- Pull this week's matchup schedule from ESPN
- Score each matchup: opponent defensive rank vs. position
- For each of your 3 lineups: flag any start/sit decisions
- Flag injury question marks that could affect starts
- Write: logs/fantasy-startsit-YYYY-MM-DD.md
```

**`fantasy-matchup-preview`** — Saturday 10:00am
```
- Your projected score this week vs. opponent
- Key players to watch (highest projected + injury risk)
- Last-minute injury updates
- Suggested lineup if any changes needed
- Write: logs/fantasy-matchup-YYYY-MM-DD.md
```

**`fantasy-postgame-recap`** — Monday 9:00am
```
- Actual vs. projected scores for your starters
- Players who massively over/underperformed
- Dynasty value implications of big performances
- Waiver wire opportunities created by this week's games
- Write: logs/fantasy-recap-YYYY-MM-DD.md
```

### Sample daily news digest output
```
Fantasy News Digest — 2026-05-29

🔴 URGENT (roster impact):
  Bucky Irving (TB, RB) — practice limited, knee. depth_chart_order unchanged (1).
  Monitor for game status update Thu.
  [Four Horsemen Vol. 8 + All-Stars]

🟡 NOTABLE:
  DeVonta Smith (PHI, WR) — ESPN: "Is DeVonta Smith ready to step up as WR1?"
  Steve Smith Sr. bullish on his role. Positive for dynasty value.
  [Odin — your WR2]

  Kyler Murray (MIN, QB) — OTA report: "looking sharp with new weapons."
  Dynasty value holding steady.
  [Four Horsemen All-Stars — your QB depth]

🟢 FYI:
  Patrick Mahomes — concerns raised about supporting cast depth.
  Dynasty value watch: down 288 pts over 30 days.
  [Four Horsemen All-Stars — your QB1]

Value movers on your rosters (30-day):
  ↑ Bijan Robinson +503 | ↑ Derrick Henry +399 | ↑ David Njoku +451
  ↓ Lamar Jackson -288 | ↓ Jayden Daniels -288 | ↓ Justin Jefferson -345
```

---

## Phase 7 — Second-Opinion Rankings (KTC)

FantasyPros aggregates multiple sources. We do the same.

- Use Claude in Chrome to scrape KTC dynasty rankings weekly
- Store KTC values alongside FantasyCalc values in SQLite
- Surface divergences: if FantasyCalc says 6,000 and KTC says 3,500, that's a signal
- "Buy-low candidates": players KTC rates higher than FantasyCalc (or vice versa)
- Over time, track which source is more accurate in your leagues (using trade history)

---

## Phase 8 — Market Calibration (Intelligence Layer)

**Goal:** Learn what your leagues actually pay for players, not just what FantasyCalc says.

### Historical trade ingestion
- Pull all transactions of type `trade` from Sleeper API for all 3 leagues
- For each completed trade: extract players + picks on each side
- Build dataset: player A (value X) was traded for player B (value Y) on date Z
- Compute `observed_value_ratio` = what this league actually paid vs. FantasyCalc

### Manager tendency model
After enough trades (~30+ per league):
- Which managers consistently overpay for QBs?
- Which managers always sell picks early?
- Which managers are most likely to accept a trade offer?
- Surface this as "Manager X tends to overpay for WRs — good sell target"

### Calibrated values
`adjusted_value = fc_value × league_calibration_factor`
Where `league_calibration_factor` is derived from observed trade history.

---

## Full Build Order

| Sprint | Deliverable | Est. sessions |
|--------|-------------|---------------|
| S1 | Backend: value engine + league configs + SQLite schema | 1 |
| S2 | Backend: trade evaluator endpoint + proposal generator | 1 |
| S3 | Frontend: roster overview + trade builder UI | 1–2 |
| S4 | Frontend: proposal dashboard + pick builder | 1 |
| S5 | Pick valuation model + pick-inclusive proposals | 1 |
| S6 | `fantasy-daily-sync` + `fantasy-news-digest` scheduled tasks | 1 |
| S7 | `fantasy-dynasty-weekly` report + value movers | 0.5 |
| S8 | In-season tasks: waiver wire + start/sit + matchup preview | 1 |
| S9 | KTC second-opinion scrape + divergence alerts | 1 |
| S10 | Historical trade ingestion + market calibration | 1–2 |
| S11 | Manager tendency model | 1 |

**Total estimate:** 10–13 sessions to full FantasyPros + KTC + FantasyCalc replacement, personalized to your leagues.

---

## What to build first (next session)

Start with **S1 + S2** — the backend engine. Once the value logic is solid and the API is working, everything else (UI, scheduled tasks, news digest) builds on top of it.

Key files to create:
- `life-os/backend/routers/fantasy.py` — API endpoints
- `life-os/backend/services/fantasy_engine.py` — value calculations + league adjustments
- `life-os/backend/services/sleeper_sync.py` — Sleeper API wrapper (rosters, injuries, depth charts, trending)
- `life-os/backend/services/espn_news.py` — ESPN news API wrapper + player filtering
- `life-os/backend/db/fantasy_schema.sql` — SQLite tables
- `life-os/backend/scripts/seed_fantasy.py` — initial data load

The `dynasty_analyzer.py` already on your Desktop is the prototype for the engine logic.
