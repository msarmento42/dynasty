# Dynasty Decision Engine Plan
*Written 2026-07-02. Supersedes ROADMAP.md's Sprint F1-F3 sequencing (baseball sprints B1-B3 and infra items are unaffected — see "Deferred" below). ROADMAP.md keeps the full issue index; this file governs build order until Phase 2 has run for real weeks.*

## Why this file exists

A commissioned build-vs-buy report recommended dropping the standalone app in favor of a thin data layer + AI reasoning. The decision made instead: keep the app as the delivery surface, but stop expanding its feature surface and build it like a decision engine — snapshot ingestion → validation → a logged recommendation → a weekly cadence — before adding anything else. AGIOS makes shipping code cheap; it does not make bad advice cheap. The validation work below is the point of this plan, not overhead on top of it.

## What changed on read-through (read this before trusting the sequencing)

The brief this plan was written from assumed a small, mostly-open backlog. The actual repo state is different in ways that materially change what Phase 0-2 need to do:

1. **82 open issues, not ~10.** #90 (start/sit), #91 (waiver ranker), #92 (mock draft), #44 (value history), #45 (CSV export) are already **closed as implemented**. The "core weekly decision loop" Phase 2 describes — waiver assistant, start/sit, trade analyzer, trade finder — already exists at the API level: `GET /waiver/{league_id}`, `GET /startsit/{league_id}`, `POST /trade/evaluate`, `GET /proposals/{league_id}`. Phase 2 is therefore mostly a wiring/reasoning/logging pass over existing endpoints, not new construction.
2. **The DB schema has no player-identity mapping at all.** `players` has only `sleeper_id` as a key — no `espn_id`, `yahoo_id`, or `rotowire_id` columns anywhere, and no mapping/override table. `backend/services/espn_news.py` builds an espn_id↔sleeper_id lookup **at request time, in memory, unpersisted** — it's a workaround, not infrastructure. Phase 0 needs to build this from scratch, not extend something partial.
3. **There is no roster/waiver-pool snapshot table and no recommendation log.** `player_snapshots` exists but is per-player value history, not a timestamped full-roster/waiver-pool state. Neither table exists to check "how stale is this" or "what did we recommend and did it work." Both are net-new (Phase 0 and Phase 1 respectively).
4. **The most important finding: the live app's data may not be getting refreshed by anything.** The three `fantasy-*` scheduled tasks (`fantasy-daily-sync`, `fantasy-news-digest`, `fantasy-dynasty-weekly`) all run against `~/Desktop/Claude/life-os`'s SQLAlchemy fantasy module (`models/fantasy.py`, `services/sleeper_sync.py`) — a **parallel, separate implementation that git history shows hasn't been touched since Life OS's initial commit.** The actual standalone Dynasty app (this repo, `backend/fantasy.db`, the 21 live endpoints) has its own sync path (`GET /fantasy/sync`, `backend/scripts/daily_sync.py`) that **nothing currently schedules.** The Sunday report you read is generated from the dead Life OS copy, not the app you use. The `fantasy-daily-sync` task's most recent run (2026-07-02 03:00) also failed on a timeout, and the 2026-07-02 weekly report is marked "(manual backfill)" in its own footer. This is exactly the "confidently recommend something based on stale or wrong inputs" risk the brief was written to prevent, and it's already happening. **I did not touch the scheduled tasks or life-os** — that's explicitly out of scope for this session and the fix requires a decision from you (see "What's left," below). Flagging it is the single highest-priority output of this plan.
5. **Phase 4 (vault exporter) is already built and shipping.** `backend/exporters/vault_export.py` merged in PR #252 (2026-07-02), reads from the real Dynasty DB (not the life-os copy), caps output to ~150 lines/league, and is wired into `fantasy-dynasty-weekly`'s Sunday run as a Tier 2 auto-merge PR into vault `dynasty/`. It hasn't produced its first real PR yet (`vault/dynasty/` only has `.gitkeep` as of this writing) — first real run is 2026-07-05. Nothing to build here; just confirm it lands.
6. **The local checkout at `~/Desktop/Claude/dynasty` is 129 commits behind `origin/main` and has an unrelated half-staged merge sitting in it** (old baseball router files staged as new, `backend/main.py` etc. modified, dozens of untracked pages). I read and wrote against `origin/main` via the GitHub API throughout, not the local working tree — the local tree needs `git status` reviewed and probably reset before anyone works in it directly again.
7. **Baseball tables already exist in schema.sql** (`baseball_players`, `baseball_stats`, `baseball_rosters`) even though Sprint B1-B3 is explicitly deferred below — schema presence, not active use; no action taken.

## Phase 0 — Data trust layer *(filed: #268 player identity mapping, #269 snapshot table, #270 validation gate, #271 sync entrypoint doc)*

Prerequisite for everything downstream to be trustworthy, not just useful.

- **Player identity resolution.** New `player_id_map` table (sleeper_id, espn_id, yahoo_id, rotowire_id, match_confidence, match_method, manual_override, updated_at), backfilled from Sleeper's public player list (already carries `espn_id` in metadata — confirmed live in `espn_news.py`) plus a manual-override path for anything under a confidence threshold.
- **Explicit snapshot table.** A timestamped full roster + waiver-pool snapshot (distinct from the existing per-player `player_snapshots`), so downstream code can answer "how stale is the data behind this recommendation" instead of assuming freshness.
- **Validation gate + graceful degradation.** A `data_trust` check run after sync: roster count matches `league_settings`, waiver pool excludes all rostered IDs (already true in the `/waiver` query's logic, but currently asserted nowhere — needs a real check, not an accident of a correct `NOT IN` clause), freshness under a defined threshold, ID-resolution confidence above a defined threshold. Endpoints that fail the gate return `{"degraded": true, "reason": "..."}` instead of serving silently on bad data.
- **Sync-target audit (repo-scoped only).** Confirm `backend/scripts/daily_sync.py` is directly callable (CLI entrypoint) against the real `backend/fantasy.db`, and update `AGIOS_CONTEXT.md` to state plainly that this — not the life-os module — is the source of truth. This issue does **not** touch the scheduled task definitions themselves (out of scope, see finding 4).

## Phase 1 — Recommendation log

- New `recommendations` table: type, league_id, inputs (snapshot ids used), reasoning summary, confidence, created_at, `acted_on` (nullable bool), `outcome` (nullable text), `outcome_recorded_at`.
- Every recommendation-producing endpoint (waiver, start/sit, trade evaluate, proposals) writes a row on call, from day one — not retrofitted after Phase 2 ships.
- A small `PATCH /recommendations/{id}` to record whether you acted on it and what happened.

Not filed as issues yet — per the brief's own sequencing rule, Phase 1 issues get filed once Phase 0's are confirmed correctly scoped, not in the same pass.

## Phase 2 — Core weekly decision loop *(mostly wiring, not new builds)*

Given finding #1, this phase is smaller than the brief assumed:

| Capability | State | What Phase 2 actually adds |
|---|---|---|
| Waiver assistant | `GET /waiver/{league_id}` live, sorts by value only | Reasoning string per suggestion; Phase 0 gate; Phase 1 logging |
| Start/sit | `GET /startsit/{league_id}` live | Phase 0 gate; Phase 1 logging; confirm injury/news delta framing matches brief's intent |
| Trade analyzer | `POST /trade/evaluate` live | Phase 0 gate; Phase 1 logging |
| Trade finder | `GET /proposals/{league_id}` live (`services/proposals.py`) | Phase 0 gate; Phase 1 logging |
| Alerts (#97) | Backend table + `/alerts/{league_id}` live; issue only asks for UI + push | Re-sequence behind Phase 1 so alerts can reference logged recommendations, not just raw table rows |

## Phase 3 — Automation

Not filed yet — depends on resolving finding #4 first (which system is actually being scheduled). Once that's settled: Monday snapshot refresh + league report, Tuesday waiver plan + lock reminder, Friday start/sit + streaming preview, Sunday final injury delta, per the brief's original sketch — layered onto whichever sync path is the real one.

## Phase 4 — Vault exporter

Done (PR #252). No issue needed. Verify the 2026-07-05 Sunday run produces a real PR into `vault/dynasty/`.

## Deferred — explicitly not scheduled, scoped, or issued this session

Baseball (Sprint B1-B3, #99-108, all `agios:needs-scope`, i.e. already not in the active build lane), mock draft simulator (#92 — already closed/implemented, correcting the brief's assumption it still needed building), live-draft sync, PWA/mobile install (#111), UI polish for its own sake, multi-sport dashboard (#112). All still tracked in ROADMAP.md's Full Issue Index — nothing closed or dropped, just not resequenced ahead of Phase 0-2. Revisit after Phase 2 has run for real weeks.

The 40+ issues labeled `agios:escalate-codex` (analytics/trade-tool/draft-tool expansion filed 2026-06-27, #113-145 and #178-203) are the bigger scope-creep risk, but none currently carry `agios:ready-for-codex` — nothing is actively queued to build. The risk is `agios-issue-generator` (Sun 10am) or `agios-build-out` promoting them later. `AGIOS_CONTEXT.md` gets a scope-boundary paragraph in this PR telling the issue generator to stop generating new expansion/polish/baseball issues until Phase 2 is proven, mirroring the language already applied to other repos' AGIOS docs on 2026-07-02.

## Issue reconciliation (this session)

| # | Title | Action | Why |
|---|---|---|---|
| #44, #45, #90, #91, #92 | value history, CSV export, start/sit, waiver ranker, mock draft | None — already closed `agios:implemented` | Brief assumed open; correcting the record here |
| #57 | standalone trade calculator | Comment: likely superseded by live Trade Builder page + `/trade/evaluate` | Overlap, not core to Phase 0-2 |
| #58 | multi-source rankings (KTC/FC/ECR) | Comment: deferred, maps to old scope doc's Phase 7 | Not core to Phase 0-2 |
| #59 | news + injury feed filtered to rosters | Comment: likely superseded by live `GET /news?league_id=` | Overlap |
| #63 | player comparison tool | Comment: deferred, UI-only | Not core to Phase 0-2 |
| #97 | alerts + push notifications | Comment: re-sequenced behind Phase 1 | Alerts should reference the recommendation log once it exists |
| #111 | PWA installable | Comment: explicitly deferred per brief | — |
| #112 | unified cross-sport dashboard | Comment: explicitly deferred per brief | — |

## What's left before Phase 0 is "done"

1. **Your call on finding #4** (which sync path is real) — this blocks Phase 3 and partly blocks trusting Phase 0's freshness checks in practice, since right now the app you use isn't the thing being synced on a schedule at all.
2. Phase 0 issues below need to actually get built and merged (they're filed, not implemented).
3. Local checkout at `~/Desktop/Claude/dynasty` needs `git status` reviewed/reset before anyone edits there directly — everything in this plan was done against `origin/main`.
4. This PR (plan + `AGIOS_CONTEXT.md` scope note) needs your review/merge.
