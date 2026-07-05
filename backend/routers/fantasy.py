"""Fantasy API endpoints - leagues, rosters, trade evaluation, picks."""

from __future__ import annotations

import asyncio
import json
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.database import DB_PATH  # noqa: E402
from backend.scripts import daily_sync  # noqa: E402
from backend.services.fantasy_engine import (  # noqa: E402
    LEAGUE_CONFIG,
    aggregate_confidence,
    compute_schedule_sos,
    compute_player_comps,
    enrich_player,
    find_trade_partner_buyers,
    pick_value,
    player_value_trend,
    positional_scarcity_index,
    project_age_curve_values,
    startup_adjusted_value,
    startup_pick_value,
    trade_positional_impact,
)
from backend.services.recommendations import generate_football_recommendations  # noqa: E402
from backend.services.proposals import generate_proposals  # noqa: E402
from backend.services.trade_history import trade_leaderboard, trade_value_analysis  # noqa: E402
from backend.services import data_trust  # noqa: E402
from backend.services.espn_news import classify_news_sentiment  # noqa: E402
from backend.services import sleeper as sleeper_svc  # noqa: E402

router = APIRouter()
PLAYER_VALUE_CACHE_CONTROL = "public, max-age=3600"
PLAYER_VALUE_REFRESH_COOLDOWN_SECONDS = 60
LAST_PLAYER_VALUE_REFRESH_AT = None


class PickRequest(BaseModel):
    round: int
    year: int


class TradeSide(BaseModel):
    player_ids: List[str] = []
    picks: List[PickRequest] = []


class TradeRequest(BaseModel):
    league_id: str
    side_a: TradeSide
    side_b: TradeSide
    mode: str = "in-season"
    draft_position: Optional[int] = None


class SimulationAction(BaseModel):
    action_type: str
    label: str = ""
    send_player_ids: List[str] = []
    receive_player_ids: List[str] = []
    drop_player_ids: List[str] = []
    add_player_ids: List[str] = []
    picks_added: List[PickRequest] = []
    picks_removed: List[PickRequest] = []
    lineup_player_ids: List[str] = []
    baseball_add_values: List[int] = []
    baseball_remove_values: List[int] = []


class SimulationRequest(BaseModel):
    league_id: str
    name: str = "Untitled scenario"
    actions: List[SimulationAction] = []
    save: bool = False
    linked_decision_id: Optional[int] = None
    linked_trade_idea_id: Optional[str] = None


async def get_league_row(db: aiosqlite.Connection, league_id: str) -> dict:
    async with db.execute(
        "SELECT league_id, name, n_teams, format, my_roster_id, config_json "
        "FROM leagues WHERE league_id = ?",
        (league_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"League {league_id} not found. Run daily sync first.")
    return {
        "league_id": row[0], "name": row[1], "n_teams": row[2],
        "format": row[3], "my_roster_id": row[4],
        "config": json.loads(row[5] or "{}"),
    }


async def get_players_for_ids(
    db: aiosqlite.Connection, player_ids: list, league_id: str
) -> list:
    if not player_ids:
        return []
    placeholders = ",".join("?" * len(player_ids))
    async with db.execute(
        f"SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status, updated_at "
        f"FROM players WHERE sleeper_id IN ({placeholders})",
        player_ids,
    ) as cur:
        rows = await cur.fetchall()
    players = []
    for r in rows:
        p = {
            "sleeper_id": r[0], "name": r[1], "position": r[2], "team": r[3],
            "age": r[4], "value_sf": r[5] or 0, "value_1qb": r[6] or 0,
            "trend_30d": r[7] or 0, "injury_status": r[8], "updated_at": r[9],
        }
        players.append(enrich_player(p, league_id))
    return players


async def player_usage_table_exists(db: aiosqlite.Connection) -> bool:
    async with db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='player_usage_snapshots'"
    ) as cur:
        return await cur.fetchone() is not None


def usage_trend_payload(rows: list[tuple]) -> dict:
    history = [
        {
            "season": row[0],
            "week": row[1],
            "team": row[2],
            "targets": row[3],
            "target_share": row[4],
            "snap_pct": row[5],
            "offensive_snaps": row[6],
            "synced_at": row[7],
        }
        for row in rows
    ]
    target_points = [point for point in history if point["target_share"] is not None]
    latest = target_points[-1] if target_points else None
    previous_points = target_points[-5:-1] if len(target_points) > 1 else []
    previous_avg = (
        sum(float(point["target_share"]) for point in previous_points) / len(previous_points)
        if previous_points else None
    )
    latest_target_share = float(latest["target_share"]) if latest else None
    rolling_delta = (
        round(latest_target_share - previous_avg, 4)
        if latest_target_share is not None and previous_avg is not None
        else None
    )

    return {
        "history": history,
        "latest": latest,
        "rolling_4_week_avg_target_share": (
            round(sum(float(point["target_share"]) for point in target_points[-4:]) / len(target_points[-4:]), 4)
            if target_points else None
        ),
        "rolling_delta": rolling_delta,
        "rising_target_share": rolling_delta is not None and rolling_delta >= 0.02,
    }


async def get_usage_for_player(db: aiosqlite.Connection, player_id: str, limit: int = 8) -> dict:
    if not await player_usage_table_exists(db):
        return usage_trend_payload([])

    async with db.execute(
        """
        SELECT season, week, team, targets, target_share, snap_pct, offensive_snaps, synced_at
        FROM player_usage_snapshots
        WHERE sleeper_id=?
        ORDER BY season DESC, week DESC
        LIMIT ?
        """,
        (player_id, limit),
    ) as cur:
        rows = await cur.fetchall()
    return usage_trend_payload(list(reversed(rows)))


async def attach_usage_summaries(db: aiosqlite.Connection, players: list[dict]) -> None:
    if not players or not await player_usage_table_exists(db):
        return

    player_ids = [str(player["sleeper_id"]) for player in players if player.get("sleeper_id")]
    if not player_ids:
        return
    placeholders = ",".join("?" * len(player_ids))
    async with db.execute(
        f"""
        SELECT sleeper_id, season, week, team, targets, target_share, snap_pct, offensive_snaps, synced_at
        FROM player_usage_snapshots
        WHERE sleeper_id IN ({placeholders})
        ORDER BY sleeper_id, season DESC, week DESC
        """,
        player_ids,
    ) as cur:
        rows = await cur.fetchall()

    by_player: dict[str, list[tuple]] = {}
    for row in rows:
        by_player.setdefault(str(row[0]), []).append(row[1:])

    for player in players:
        usage_rows = list(reversed(by_player.get(str(player.get("sleeper_id")), [])[:4]))
        player["usage_trend"] = usage_trend_payload(usage_rows)


async def build_schedule_sos(player: dict, weeks: int = 4) -> dict:
    """Return an SOS payload for one player without failing the caller on missing Sleeper data."""
    try:
        state = await sleeper_svc.fetch_nfl_state()
        season = int(state.get("season") or datetime.now(timezone.utc).year)
        current_week = int(state.get("week") or 1)
        defensive_allowed = await sleeper_svc.fetch_defensive_points_allowed_by_position(
            season=season,
            through_week=current_week,
        )
        opponents = await sleeper_svc.fetch_upcoming_opponents(player.get("team"), weeks=max(weeks, 8))
    except Exception as exc:  # pragma: no cover - network/service availability guard
        return {
            "available": False,
            "reason": f"Sleeper schedule data unavailable: {exc}",
            "sos_score": None,
            "sos_label": "Unavailable",
            "opponents": [],
        }
    return compute_schedule_sos(player, opponents, defensive_allowed, weeks=weeks)


async def attach_schedule_sos_summaries(players: list[dict], weeks: int = 4) -> None:
    """Attach compact schedule SOS data to roster players."""
    if not players:
        return

    try:
        state = await sleeper_svc.fetch_nfl_state()
        season = int(state.get("season") or datetime.now(timezone.utc).year)
        current_week = int(state.get("week") or 1)
        defensive_allowed = await sleeper_svc.fetch_defensive_points_allowed_by_position(
            season=season,
            through_week=current_week,
        )
        teams = sorted({str(player.get("team")).upper() for player in players if player.get("team")})
        team_opponents = await asyncio.gather(*[
            sleeper_svc.fetch_upcoming_opponents(team, weeks=max(weeks, 8))
            for team in teams
        ])
        opponents_by_team = dict(zip(teams, team_opponents))
    except Exception:
        for player in players:
            player["schedule_sos"] = {
                "available": False,
                "sos_score": None,
                "sos_label": "Unavailable",
                "opponents": [],
            }
        return

    for player in players:
        team = str(player.get("team") or "").upper()
        payload = compute_schedule_sos(
            player,
            opponents_by_team.get(team, []),
            defensive_allowed,
            weeks=weeks,
        )
        player["schedule_sos"] = {
            "available": payload.get("available", False),
            "sos_score": payload.get("sos_score"),
            "sos_label": payload.get("sos_label"),
            "opponents": [
                {
                    "week": item.get("week"),
                    "opponent": item.get("opponent"),
                    "matchup_score": item.get("matchup_score"),
                    "matchup_label": item.get("matchup_label"),
                }
                for item in payload.get("opponents", [])[:weeks]
            ],
        }


async def ensure_player_comps_table(db: aiosqlite.Connection) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS player_comps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sleeper_id TEXT NOT NULL,
            comp_sleeper_id TEXT NOT NULL,
            similarity_score REAL NOT NULL,
            factors_json TEXT,
            computed_at TEXT NOT NULL,
            UNIQUE(sleeper_id, comp_sleeper_id)
        )
        """
    )
    await db.commit()


async def player_value_history(db: aiosqlite.Connection, sleeper_id: str) -> list[dict]:
    async with db.execute(
        "SELECT snapshot_date, value_sf FROM player_snapshots "
        "WHERE sleeper_id = ? AND value_sf IS NOT NULL "
        "ORDER BY snapshot_date ASC",
        (sleeper_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [{"date": row[0], "value": row[1]} for row in rows]


def player_value(player: dict) -> float:
    return float(player.get("adjusted_value") or player.get("value_sf") or player.get("value_1qb") or 0)


def pick_request_value(pick: PickRequest, n_teams: int) -> int:
    current_year = datetime.now(timezone.utc).year
    return pick_value(pick.round, pick.year - current_year, n_teams)


def trade_player_value(player: dict, mode: str) -> float:
    if mode == "startup":
        return float(player.get("startup_trade_value") or player.get("startup_adjusted_value") or 0)
    return player_value(player)


def apply_trade_mode_values(players: list[dict], league_id: str, mode: str, draft_position: int = None) -> list[dict]:
    if mode != "startup":
        for player in players:
            player["trade_value"] = player_value(player)
        return players

    for index, player in enumerate(players):
        position_context = (draft_position or 1) + index
        startup_details = startup_adjusted_value(player, league_id, draft_position=position_context)
        player["startup_trade_value"] = startup_details["startup_value"]
        player["startup_delta"] = startup_details["startup_delta"]
        player["startup_multiplier"] = startup_details["startup_multiplier"]
        player["startup_context"] = startup_details["startup_context"]
        player["trade_value"] = startup_details["startup_value"]
    return players


def position_totals(players: list[dict]) -> dict:
    totals = {"QB": 0, "RB": 0, "WR": 0, "TE": 0}
    for player in players:
        position = player.get("position") or "FLEX"
        value = player_value(player)
        if position in totals:
            totals[position] += value
        else:
            totals["FLEX"] = totals.get("FLEX", 0) + value
    return {position: round(value) for position, value in totals.items()}


def roster_age(players: list[dict]) -> float:
    ages = [float(p["age"]) for p in players if p.get("age")]
    return round(sum(ages) / len(ages), 1) if ages else 0


def playoff_odds_from_rank(rank: int, team_count: int) -> int:
    if team_count <= 1:
        return 100
    percentile = 1 - ((rank - 1) / max(team_count - 1, 1))
    return max(5, min(95, round(20 + percentile * 70)))


def scenario_summary(
    baseline_value: float,
    scenario_value: float,
    baseline_rank: int,
    scenario_rank: int,
    team_count: int,
    action_count: int,
) -> dict:
    value_delta = round(scenario_value - baseline_value)
    return {
        "value_delta": value_delta,
        "value_delta_pct": round((value_delta / baseline_value * 100) if baseline_value else 0, 1),
        "rank_delta": baseline_rank - scenario_rank,
        "playoff_odds_delta": (
            playoff_odds_from_rank(scenario_rank, team_count)
            - playoff_odds_from_rank(baseline_rank, team_count)
        ),
        "long_term_cost": max(0, -value_delta),
        "win_now_impact": "positive" if value_delta > 500 else ("negative" if value_delta < -500 else "neutral"),
        "action_count": action_count,
    }


def manager_payload(row: tuple, my_roster_id: int) -> dict:
    profile = json.loads(row[10] or "{}")
    return {
        "roster_id": row[0],
        "owner_name": row[1],
        "is_mine": row[0] == my_roster_id,
        "trades_analyzed": row[2],
        "tendencies": {
            "qb_premium": row[3],
            "rb_premium": row[4],
            "wr_premium": row[5],
            "te_premium": row[6],
            "pick_sell_bias": row[7],
        },
        "accept_rate": row[8],
        "summary": profile.get("summary", "Not enough tendency detail yet."),
        "target_signal": profile.get("target_signal", "NEUTRAL"),
    }


@router.get("/status")
async def status():
    return {"status": "dynasty engine online"}


def parse_cache_timestamp(value: str) -> Optional[datetime]:
    """Parse SQLite snapshot dates and ISO timestamps into UTC datetimes."""
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def freshness_payload(updated_at: str, source: str, stale_after_hours: int = 36) -> dict:
    parsed = parse_cache_timestamp(updated_at)
    if parsed is None:
        return {
            "source": source,
            "updated_at": updated_at,
            "age_hours": None,
            "status": "missing",
            "message": f"{source} has no successful sync timestamp.",
        }

    age_hours = max(0, round((datetime.now(timezone.utc) - parsed).total_seconds() / 3600, 1))
    status = "fresh" if age_hours <= stale_after_hours else "stale"
    return {
        "source": source,
        "updated_at": parsed.isoformat(),
        "age_hours": age_hours,
        "status": status,
        "message": f"{source} is {age_hours} hours old.",
    }


async def table_count(db: aiosqlite.Connection, table_name: str) -> int:
    async with db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)) as cur:
        exists = await cur.fetchone()
    if not exists:
        return 0
    async with db.execute(f"SELECT COUNT(*) FROM {table_name}") as cur:
        row = await cur.fetchone()
    return row[0] if row else 0


async def latest_value(db: aiosqlite.Connection, table_name: str, column_name: str):
    async with db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)) as cur:
        exists = await cur.fetchone()
    if not exists:
        return None
    async with db.execute(f"SELECT MAX({column_name}) FROM {table_name}") as cur:
        row = await cur.fetchone()
    return row[0] if row else None


def issue_status(status: str) -> str:
    if status == "fresh":
        return "ok"
    if status == "stale":
        return "warning"
    return "critical"


@router.get("/cache-status")
async def get_cache_status():
    """Return the latest known player value cache timestamp and age."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT MAX(snapshot_date) FROM player_snapshots") as cur:
            row = await cur.fetchone()

    cached_at = parse_cache_timestamp(row[0] if row else None)
    if cached_at is None:
        return {"cached_at": None, "cache_age_seconds": None}

    age_seconds = max(0, int((datetime.now(timezone.utc) - cached_at).total_seconds()))
    return {"cached_at": cached_at.isoformat(), "cache_age_seconds": age_seconds}


@router.get("/data-doctor")
async def get_data_doctor():
    """Return data quality checks and suggested sync/import fixes."""
    async with aiosqlite.connect(DB_PATH) as db:
        players_count = await table_count(db, "players")
        rosters_count = await table_count(db, "rosters")
        baseball_players_count = await table_count(db, "baseball_players")
        baseball_rosters_count = await table_count(db, "baseball_rosters")
        baseball_stats_count = await table_count(db, "baseball_stats")
        zero_value_count = 0
        stale_player_count = 0

        if players_count:
            async with db.execute(
                "SELECT COUNT(*) FROM players WHERE COALESCE(value_sf, 0) = 0 AND COALESCE(value_1qb, 0) = 0"
            ) as cur:
                zero_value_count = (await cur.fetchone())[0]
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
            async with db.execute(
                "SELECT COUNT(*) FROM players WHERE updated_at IS NULL OR updated_at < ?",
                (cutoff,),
            ) as cur:
                stale_player_count = (await cur.fetchone())[0]

        latest_player_sync = await latest_value(db, "players", "updated_at")
        latest_roster_sync = await latest_value(db, "rosters", "updated_at")
        latest_news = await latest_value(db, "news_items", "published_at")
        latest_snapshot = await latest_value(db, "player_snapshots", "snapshot_date")
        latest_baseball = await latest_value(db, "baseball_players", "updated_at")

    freshness = [
        freshness_payload(latest_player_sync or latest_snapshot, "Player values"),
        freshness_payload(latest_roster_sync, "Roster syncs", stale_after_hours=24),
        freshness_payload(latest_news, "News feed", stale_after_hours=12),
        freshness_payload(latest_baseball, "Baseball player cache", stale_after_hours=168),
    ]

    checks = [
        {
            "name": "Player value coverage",
            "status": "critical" if players_count == 0 or zero_value_count > 0 else "ok",
            "detail": f"{zero_value_count} of {players_count} football players have no usable value.",
            "action": "Run value refresh",
            "action_url": "/",
        },
        {
            "name": "Stale football imports",
            "status": "warning" if stale_player_count > 0 else "ok",
            "detail": f"{stale_player_count} football players are older than 36 hours or missing timestamps.",
            "action": "Refresh values",
            "action_url": "/",
        },
        {
            "name": "Roster sync coverage",
            "status": "critical" if rosters_count == 0 else "ok",
            "detail": f"{rosters_count} synced roster rows are available.",
            "action": "Run sync",
            "action_url": "/",
        },
        {
            "name": "Baseball manual values",
            "status": "warning" if baseball_rosters_count > 0 and baseball_players_count == 0 else "ok",
            "detail": f"{baseball_players_count} cached baseball players and {baseball_stats_count} stats rows.",
            "action": "Open baseball roster",
            "action_url": "/baseball/roster",
        },
        {
            "name": "Recommendation confidence",
            "status": "critical" if players_count == 0 or rosters_count == 0 else "ok",
            "detail": "Trade recommendations inherit the lowest confidence from included player values.",
            "action": "Generate proposals",
            "action_url": "/proposals",
        },
    ]

    for item in freshness:
        checks.append({
            "name": item["source"],
            "status": issue_status(item["status"]),
            "detail": item["message"],
            "action": "Inspect source",
            "action_url": "/data-doctor",
        })

    worst = "ok"
    if any(check["status"] == "critical" for check in checks):
        worst = "critical"
    elif any(check["status"] == "warning" for check in checks):
        worst = "warning"

    return {
        "status": worst,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "freshness": freshness,
        "checks": checks,
    }


@router.post("/refresh-cache")
async def refresh_cache():
    """Record a manual player value cache refresh request with cooldown protection."""
    global LAST_PLAYER_VALUE_REFRESH_AT

    now = datetime.now(timezone.utc)
    if LAST_PLAYER_VALUE_REFRESH_AT is not None:
        elapsed = int((now - LAST_PLAYER_VALUE_REFRESH_AT).total_seconds())
        if elapsed < PLAYER_VALUE_REFRESH_COOLDOWN_SECONDS:
            retry_after = PLAYER_VALUE_REFRESH_COOLDOWN_SECONDS - elapsed
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Refresh cooldown active",
                    "retry_after_seconds": retry_after,
                },
            )

    LAST_PLAYER_VALUE_REFRESH_AT = now
    return {"cleared_at": now.isoformat()}


@router.get("/leagues")
async def get_leagues():
    """Return all synced leagues."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT league_id, name, n_teams, format, my_roster_id, config_json FROM leagues"
        ) as cur:
            rows = await cur.fetchall()

    if not rows:
        return [
            {
                "league_id": lid,
                "name": cfg["name"],
                "n_teams": cfg["n_teams"],
                "format": cfg["base_format"].upper(),
                "my_roster_id": cfg.get("my_roster_id", 1),
            }
            for lid, cfg in LEAGUE_CONFIG.items()
        ]

    return [
        {
            "league_id": r[0], "name": r[1], "n_teams": r[2],
            "format": r[3],
            "my_roster_id": json.loads(r[5] or "{}").get("my_roster_id", r[4]),
        }
        for r in rows
    ]


async def _activity_leagues(db: aiosqlite.Connection, league_id: str | None) -> list[dict]:
    if league_id:
        return [await get_league_row(db, league_id)]

    async with db.execute(
        "SELECT league_id, name, n_teams, format, my_roster_id, config_json FROM leagues"
    ) as cur:
        rows = await cur.fetchall()

    if rows:
        return [
            {
                "league_id": row[0],
                "name": row[1],
                "n_teams": row[2],
                "format": row[3],
                "my_roster_id": row[4],
                "config": json.loads(row[5] or "{}"),
            }
            for row in rows
        ]

    return [
        {
            "league_id": lid,
            "name": cfg["name"],
            "n_teams": cfg["n_teams"],
            "format": cfg.get("base_format", cfg.get("format")),
            "my_roster_id": cfg.get("my_roster_id", 1),
            "config": cfg,
        }
        for lid, cfg in LEAGUE_CONFIG.items()
    ]


async def _activity_roster_names(db: aiosqlite.Connection, league_id: str) -> dict[int, str]:
    async with db.execute(
        "SELECT roster_id, owner_display_name FROM rosters WHERE league_id=?",
        (league_id,),
    ) as cur:
        rows = await cur.fetchall()
    return {int(row[0]): row[1] or f"Team {row[0]}" for row in rows if row[0] is not None}


async def _activity_player_names(db: aiosqlite.Connection, player_ids: set[str]) -> dict[str, str]:
    if not player_ids:
        return {}

    placeholders = ",".join("?" * len(player_ids))
    async with db.execute(
        f"SELECT sleeper_id, name FROM players WHERE sleeper_id IN ({placeholders})",
        list(player_ids),
    ) as cur:
        rows = await cur.fetchall()
    return {str(row[0]): row[1] for row in rows if row[0] and row[1]}


async def _digest_roster_players(db: aiosqlite.Connection, league: dict) -> list[dict]:
    my_roster_id = league.get("config", {}).get("my_roster_id", league.get("my_roster_id"))
    async with db.execute(
        "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
        (league["league_id"], my_roster_id),
    ) as cur:
        row = await cur.fetchone()

    if not row:
        return []
    player_ids = json.loads(row[0] or "[]")
    return await get_players_for_ids(db, player_ids, str(league["league_id"]))


async def _digest_upcoming_byes(db: aiosqlite.Connection, league: dict, weeks: int = 4) -> list[dict]:
    players = await _digest_roster_players(db, league)
    if not players:
        return []

    await attach_schedule_sos_summaries(players, weeks=weeks)
    byes = []
    for player in players:
        for matchup in player.get("schedule_sos", {}).get("opponents", []):
            if matchup.get("opponent"):
                continue
            byes.append({
                "week": matchup.get("week"),
                "sleeper_id": player.get("sleeper_id"),
                "name": player.get("name"),
                "position": player.get("position"),
                "team": player.get("team"),
            })
    return sorted(byes, key=lambda item: (item.get("week") or 99, item.get("name") or ""))


@router.get("/digest")
async def get_digest(league_id: Optional[str] = None):
    """Return a weekly action digest assembled from existing computed sources."""
    warnings = []
    async with aiosqlite.connect(DB_PATH) as db:
        leagues = await _activity_leagues(db, league_id)
        try:
            movers = await get_value_movers()
        except Exception as exc:
            movers = {"gainers": [], "losers": []}
            warnings.append({"section": "movers", "detail": str(exc)})

        league_payloads = []
        for league in leagues:
            lid = str(league["league_id"])
            league_name = league.get("name") or lid

            try:
                proposals = await generate_proposals(lid)
            except Exception as exc:
                proposals = []
                warnings.append({"league_id": lid, "section": "trade_opportunities", "detail": str(exc)})

            try:
                waiver_payload = await get_waiver_wire(lid)
                waiver_targets = waiver_payload.get("free_agents", [])[:8]
            except Exception as exc:
                waiver_targets = []
                warnings.append({"league_id": lid, "section": "waiver_targets", "detail": str(exc)})

            try:
                upcoming_byes = await _digest_upcoming_byes(db, league)
            except Exception as exc:
                upcoming_byes = []
                warnings.append({"league_id": lid, "section": "upcoming_byes", "detail": str(exc)})

            league_payloads.append({
                "league_id": lid,
                "name": league_name,
                "trade_opportunities": proposals[:5],
                "waiver_targets": waiver_targets,
                "upcoming_byes": upcoming_byes[:12],
            })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "movers": movers,
        "leagues": league_payloads,
        "warnings": warnings,
    }


@router.get("/activity")
async def get_activity(
    league_id: Optional[str] = None,
    activity_type: Optional[str] = None,
    weeks: int = 4,
):
    """Return normalized trade, waiver, and roster activity across Marcus's leagues."""
    weeks = max(1, min(int(weeks or 4), 8))
    activity_filter = activity_type.lower() if activity_type else None
    if activity_filter and activity_filter not in {"trade", "waiver", "roster_move"}:
        raise HTTPException(status_code=400, detail="activity_type must be trade, waiver, or roster_move")

    items: list[dict] = []
    warnings: list[dict] = []
    async with aiosqlite.connect(DB_PATH) as db:
        leagues = await _activity_leagues(db, league_id)
        for league in leagues:
            lid = str(league["league_id"])
            league_name = league.get("name") or lid
            roster_names = await _activity_roster_names(db, lid)
            try:
                raw_transactions = []
                state = await sleeper_svc.fetch_nfl_state()
                current_week = int(state.get("week") or 1)
                start_week = max(1, current_week - weeks + 1)
                for week in range(start_week, current_week + 1):
                    raw_transactions.extend(await sleeper_svc.fetch_transactions(lid, week))
            except Exception as exc:  # pragma: no cover - external Sleeper availability guard
                warnings.append({"league_id": lid, "league_name": league_name, "detail": str(exc)})
                continue

            player_ids = set()
            for transaction in raw_transactions:
                for key in ("adds", "drops"):
                    player_map = transaction.get(key)
                    if isinstance(player_map, dict):
                        player_ids.update(str(player_id) for player_id in player_map)
            player_names = await _activity_player_names(db, player_ids)
            league_items = sleeper_svc.normalize_transactions(
                lid,
                league_name,
                raw_transactions,
                roster_names=roster_names,
                player_names=player_names,
            )
            if activity_filter:
                league_items = [
                    item for item in league_items
                    if item.get("activity_type") == activity_filter
                ]
            items.extend(league_items)

    items.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
    return {
        "items": items,
        "leagues": [
            {"league_id": league["league_id"], "name": league.get("name") or league["league_id"]}
            for league in leagues
        ],
        "filters": {"league_id": league_id, "activity_type": activity_filter, "weeks": weeks},
        "warnings": warnings,
    }


@router.get("/league/{league_id}/roster")
async def get_my_roster(league_id: str):
    """Return my enriched roster for a league."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
            (league_id, my_roster_id),
        ) as cur:
            row = await cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Roster not found. Run daily sync first.")

        player_ids = json.loads(row[0] or "[]")
        players = await get_players_for_ids(db, player_ids, league_id)
        await attach_usage_summaries(db, players)

    await attach_schedule_sos_summaries(players, weeks=4)
    players.sort(key=lambda p: p.get("adjusted_value", 0), reverse=True)
    total = sum(p.get("adjusted_value", 0) for p in players)

    return {
        "league_id": league_id,
        "league_name": league["name"],
        "my_roster_id": my_roster_id,
        "players": players,
        "total_adjusted_value": total,
        "data_confidence": aggregate_confidence(players),
    }


@router.get("/recommendations/{league_id}")
async def get_recommendations(league_id: str, limit: int = 12):
    """Return unified, explainable football recommendations for dashboard cards."""
    return await generate_football_recommendations(league_id, limit=max(1, min(limit, 24)))


@router.get("/league/{league_id}/roster-value-history")
async def get_roster_value_history(league_id: str):
    """Return the last 30 roster value snapshots for Marcus's roster."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            """
            SELECT total_value, synced_at
            FROM roster_snapshots
            WHERE league_id=? AND roster_id=?
            ORDER BY synced_at DESC
            LIMIT 30
            """,
            (league_id, my_roster_id),
        ) as cur:
            rows = await cur.fetchall()

    history = [
        {
            "league_id": league_id,
            "roster_id": my_roster_id,
            "total_value": round(row[0] or 0, 2),
            "synced_at": row[1],
        }
        for row in reversed(rows)
    ]
    return {"league_id": league_id, "roster_id": my_roster_id, "history": history}


@router.get("/league/{league_id}/all-rosters")
async def get_all_rosters(league_id: str):
    """Return all teams' rosters with total values."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

        result = []
        for r in rows:
            roster_id, owner, pid_json = r[0], r[1], r[2]
            player_ids = json.loads(pid_json or "[]")
            players = await get_players_for_ids(db, player_ids, league_id)
            players.sort(key=lambda p: p.get("adjusted_value", 0), reverse=True)
            total = sum(p.get("adjusted_value", 0) for p in players)
            result.append({
                "roster_id": roster_id,
                "owner": owner or f"Team {roster_id}",
                "is_mine": roster_id == my_roster_id,
                "total_adjusted_value": total,
                "players": players,
                "data_confidence": aggregate_confidence(players),
            })

    result.sort(key=lambda r: r["total_adjusted_value"], reverse=True)
    return result


@router.get("/league/{league_id}/positional-scarcity")
async def get_positional_scarcity(league_id: str):
    """Return per-position scarcity scores based on rostered league value."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

        teams = []
        for roster_id, owner, pid_json in rows:
            players = await get_players_for_ids(db, json.loads(pid_json or "[]"), league_id)
            teams.append({
                "roster_id": roster_id,
                "team_name": owner or f"Team {roster_id}",
                "is_mine": roster_id == my_roster_id,
                "players": players,
            })

    scarcity = positional_scarcity_index(teams)
    return {
        "league_id": league_id,
        "league_name": league["name"],
        "positions": scarcity,
    }


@router.post("/trade/evaluate")
async def evaluate_trade(req: TradeRequest):
    """Evaluate a proposed trade - returns values, delta, and verdict."""
    league_id = req.league_id
    mode = (req.mode or "in-season").lower()
    if mode not in {"in-season", "startup"}:
        raise HTTPException(status_code=400, detail="mode must be 'in-season' or 'startup'")

    cfg = LEAGUE_CONFIG.get(league_id, {})
    n_teams = cfg.get("n_teams", 12)
    current_year = datetime.now(timezone.utc).year
    draft_position = max(1, int(req.draft_position or 1))

    async with aiosqlite.connect(DB_PATH) as db:
        trust = await data_trust.get_trust_status(db, league_id)
        side_a_players = await get_players_for_ids(db, req.side_a.player_ids, league_id)
        side_b_players = await get_players_for_ids(db, req.side_b.player_ids, league_id)

    apply_trade_mode_values(side_a_players, league_id, mode, draft_position=draft_position)
    apply_trade_mode_values(side_b_players, league_id, mode, draft_position=draft_position + len(side_a_players))

    side_a_picks = []
    for pk in req.side_a.picks:
        years_away = pk.year - current_year
        val = (
            startup_pick_value(pk.round, years_away, n_teams, draft_position=draft_position)
            if mode == "startup"
            else pick_value(pk.round, years_away, n_teams)
        )
        side_a_picks.append({"round": pk.round, "year": pk.year, "value": val, "mode": mode})

    side_b_picks = []
    for pk in req.side_b.picks:
        years_away = pk.year - current_year
        val = (
            startup_pick_value(pk.round, years_away, n_teams, draft_position=draft_position)
            if mode == "startup"
            else pick_value(pk.round, years_away, n_teams)
        )
        side_b_picks.append({"round": pk.round, "year": pk.year, "value": val, "mode": mode})

    side_a_value = (
        sum(trade_player_value(p, mode) for p in side_a_players)
        + sum(p["value"] for p in side_a_picks)
    )
    side_b_value = (
        sum(trade_player_value(p, mode) for p in side_b_players)
        + sum(p["value"] for p in side_b_picks)
    )

    delta = side_b_value - side_a_value
    delta_pct = round((delta / side_a_value * 100) if side_a_value else 0, 1)

    if delta_pct > 10:
        verdict = "WIN"
    elif delta_pct < -10:
        verdict = "LOSS"
    else:
        verdict = "FAIR"

    result = {
        "mode": mode,
        "draft_position": draft_position if mode == "startup" else None,
        "side_a_value": side_a_value,
        "side_b_value": side_b_value,
        "delta": delta,
        "delta_pct": delta_pct,
        "verdict": verdict,
        "side_a_players": side_a_players,
        "side_b_players": side_b_players,
        "side_a_picks": side_a_picks,
        "side_b_picks": side_b_picks,
        "positional_impact": trade_positional_impact(side_a_players, side_b_players),
        "data_confidence": aggregate_confidence([*side_a_players, *side_b_players]),
    }
    if not trust["ok"]:
        result["degraded"] = True
        result["degraded_reasons"] = trust["reasons"]
    return result


async def build_simulation_baseline(db: aiosqlite.Connection, league_id: str) -> dict:
    league = await get_league_row(db, league_id)
    my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
    n_teams = league["n_teams"] or LEAGUE_CONFIG.get(league_id, {}).get("n_teams", 12)

    async with db.execute(
        "SELECT roster_id, owner_display_name, player_ids_json FROM rosters WHERE league_id=? ORDER BY roster_id",
        (league_id,),
    ) as cur:
        roster_rows = await cur.fetchall()

    async with db.execute(
        "SELECT current_owner_id, season, round FROM picks WHERE league_id=?",
        (league_id,),
    ) as cur:
        pick_rows = await cur.fetchall()

    teams = []
    my_players: list[dict] = []
    pick_assets: dict[int, list[dict]] = {}
    for owner_id, season, round_number in pick_rows:
        value = pick_request_value(PickRequest(year=season, round=round_number), n_teams)
        pick_assets.setdefault(owner_id, []).append({"year": season, "round": round_number, "value": value})

    for roster_id, owner, player_ids_json in roster_rows:
        players = await get_players_for_ids(db, json.loads(player_ids_json or "[]"), league_id)
        roster_value = sum(player_value(player) for player in players)
        pick_value_total = sum(pick["value"] for pick in pick_assets.get(roster_id, []))
        total_value = roster_value + pick_value_total
        team = {
            "roster_id": roster_id,
            "owner": owner or f"Team {roster_id}",
            "is_mine": roster_id == my_roster_id,
            "roster_value": round(roster_value),
            "pick_value": round(pick_value_total),
            "total_value": round(total_value),
            "position_totals": position_totals(players),
            "average_age": roster_age(players),
            "players": players,
            "picks": pick_assets.get(roster_id, []),
        }
        teams.append(team)
        if roster_id == my_roster_id:
            my_players = players

    teams.sort(key=lambda t: t["total_value"], reverse=True)
    for index, team in enumerate(teams, 1):
        team["rank"] = index
        team["playoff_odds"] = playoff_odds_from_rank(index, len(teams))

    my_team = next((team for team in teams if team["is_mine"]), None)
    if not my_team:
        raise HTTPException(status_code=404, detail="Marcus roster not found. Run daily sync first.")

    async with db.execute(
        """
        SELECT mlb_id, name, position, team, level, dynasty_value
        FROM baseball_players
        WHERE mlb_id IN (SELECT mlb_id FROM baseball_rosters)
        ORDER BY dynasty_value DESC, name
        """
    ) as cur:
        baseball_rows = await cur.fetchall()

    baseball_players = [
        {
            "mlb_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "level": row[4],
            "value": row[5] or 0,
        }
        for row in baseball_rows
    ]

    return {
        "league_id": league_id,
        "league_name": league["name"],
        "my_roster_id": my_roster_id,
        "my_team": my_team,
        "teams": teams,
        "available_players": sorted(my_players, key=player_value, reverse=True),
        "baseball_players": baseball_players,
    }


async def evaluate_simulation(db: aiosqlite.Connection, req: SimulationRequest) -> dict:
    baseline = await build_simulation_baseline(db, req.league_id)
    n_teams = len(baseline["teams"]) or 12
    scenario_players = {player["sleeper_id"]: dict(player) for player in baseline["my_team"]["players"]}
    action_results = []
    scenario_value = float(baseline["my_team"]["total_value"])
    pick_delta = 0
    baseball_delta = 0

    for action in req.actions:
        sent_players = await get_players_for_ids(db, action.send_player_ids + action.drop_player_ids, req.league_id)
        received_players = await get_players_for_ids(
            db,
            action.receive_player_ids + action.add_player_ids + action.lineup_player_ids,
            req.league_id,
        )
        sent_value = sum(player_value(player) for player in sent_players)
        received_value = sum(player_value(player) for player in received_players)
        added_pick_value = sum(pick_request_value(pick, n_teams) for pick in action.picks_added)
        removed_pick_value = sum(pick_request_value(pick, n_teams) for pick in action.picks_removed)
        action_baseball_delta = sum(action.baseball_add_values) - sum(action.baseball_remove_values)
        action_delta = received_value - sent_value + added_pick_value - removed_pick_value + action_baseball_delta

        for player in sent_players:
            scenario_players.pop(player["sleeper_id"], None)
        for player in received_players:
            scenario_players[player["sleeper_id"]] = player

        pick_delta += added_pick_value - removed_pick_value
        baseball_delta += action_baseball_delta
        action_results.append({
            "action_type": action.action_type,
            "label": action.label or action.action_type.replace("_", " ").title(),
            "delta": round(action_delta),
            "sent_value": round(sent_value),
            "received_value": round(received_value),
            "pick_delta": round(added_pick_value - removed_pick_value),
            "baseball_delta": round(action_baseball_delta),
        })

    scenario_roster_value = sum(player_value(player) for player in scenario_players.values())
    scenario_value = scenario_roster_value + baseline["my_team"]["pick_value"] + pick_delta + baseball_delta
    comparison_teams = [
        {
            "roster_id": team["roster_id"],
            "owner": team["owner"],
            "total_value": scenario_value if team["is_mine"] else team["total_value"],
            "is_mine": team["is_mine"],
        }
        for team in baseline["teams"]
    ]
    comparison_teams.sort(key=lambda t: t["total_value"], reverse=True)
    scenario_rank = next(i for i, team in enumerate(comparison_teams, 1) if team["is_mine"])
    baseline_rank = baseline["my_team"]["rank"]
    scenario_snapshot = {
        "total_value": round(scenario_value),
        "roster_value": round(scenario_roster_value),
        "pick_value": round(baseline["my_team"]["pick_value"] + pick_delta),
        "baseball_value_delta": round(baseball_delta),
        "rank": scenario_rank,
        "playoff_odds": playoff_odds_from_rank(scenario_rank, len(comparison_teams)),
        "position_totals": position_totals(list(scenario_players.values())),
        "average_age": roster_age(list(scenario_players.values())),
    }

    return {
        "name": req.name,
        "baseline": baseline["my_team"],
        "scenario": scenario_snapshot,
        "actions": action_results,
        "summary": scenario_summary(
            baseline["my_team"]["total_value"],
            scenario_value,
            baseline_rank,
            scenario_rank,
            len(comparison_teams),
            len(req.actions),
        ),
    }


@router.get("/league/{league_id}/simulation-lab")
async def get_simulation_lab(league_id: str):
    """Return baseline rosters, saved scenarios, and selectable players for what-if analysis."""
    async with aiosqlite.connect(DB_PATH) as db:
        baseline = await build_simulation_baseline(db, league_id)
        async with db.execute(
            """
            SELECT scenario_id, name, result_json, actions_json, created_at, updated_at
            FROM simulation_scenarios
            WHERE league_id=?
            ORDER BY updated_at DESC
            LIMIT 20
            """,
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

    saved = [
        {
            "scenario_id": row[0],
            "name": row[1],
            "result": json.loads(row[2] or "{}"),
            "actions": json.loads(row[3] or "[]"),
            "created_at": row[4],
            "updated_at": row[5],
        }
        for row in rows
    ]
    return {**baseline, "saved_scenarios": saved}


@router.post("/simulation-lab/scenarios")
async def create_simulation_scenario(req: SimulationRequest):
    """Evaluate a what-if scenario and optionally persist it without mutating real roster tables."""
    async with aiosqlite.connect(DB_PATH) as db:
        result = await evaluate_simulation(db, req)
        if req.save:
            now = datetime.now(timezone.utc).isoformat()
            scenario_id = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO simulation_scenarios
                    (scenario_id, league_id, name, actions_json, result_json,
                     linked_decision_id, linked_trade_idea_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scenario_id,
                    req.league_id,
                    req.name,
                    json.dumps([action.model_dump() for action in req.actions]),
                    json.dumps(result),
                    req.linked_decision_id,
                    req.linked_trade_idea_id,
                    now,
                    now,
                ),
            )
            await db.commit()
            result["scenario_id"] = scenario_id
    return result


@router.get("/proposals/{league_id}")
async def get_proposals(league_id: str):
    """Auto-generated ranked trade proposals for this league."""
    if league_id not in LEAGUE_CONFIG:
        raise HTTPException(status_code=404, detail=f"League {league_id} not found.")

    async with aiosqlite.connect(DB_PATH) as db:
        trust = await data_trust.get_trust_status(db, league_id)

    proposals = await generate_proposals(league_id)
    if not trust["ok"]:
        # Proposals normally return a bare list; only wrap it when degraded so
        # the existing successful-path shape is unchanged for current consumers.
        return {"proposals": proposals, "degraded": True, "degraded_reasons": trust["reasons"]}
    return proposals


@router.get("/alerts/{league_id}")
async def get_alerts(league_id: str):
    """Return recent alerts for players on my roster in this league."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
            (league_id, my_roster_id),
        ) as cur:
            row = await cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Roster not found. Run daily sync first.")

        player_ids = json.loads(row[0] or "[]")
        if not player_ids:
            return []

        placeholders = ",".join("?" * len(player_ids))
        query = f"""
            SELECT
                a.alert_type,
                a.severity,
                a.player_name,
                p.position,
                p.team,
                a.old_value,
                a.new_value,
                a.detail,
                a.created_at
            FROM alerts a
            LEFT JOIN players p ON p.sleeper_id = a.sleeper_id
            WHERE a.league_id=?
              AND a.created_at >= ?
              AND a.sleeper_id IN ({placeholders})
            ORDER BY
                CASE a.severity
                    WHEN 'critical' THEN 0
                    WHEN 'notable' THEN 1
                    ELSE 2
                END,
                a.created_at DESC
        """
        async with db.execute(query, [league_id, cutoff, *player_ids]) as cur:
            rows = await cur.fetchall()

    return [
        {
            "alert_type": row[0],
            "severity": row[1],
            "player_name": row[2],
            "position": row[3],
            "team": row[4],
            "old_value": row[5],
            "new_value": row[6],
            "detail": row[7],
            "created_at": row[8],
        }
        for row in rows
    ]


@router.get("/calibration/{league_id}")
async def get_calibration(league_id: str):
    """Return market calibration data for a league."""
    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)
        async with db.execute("SELECT COUNT(*) FROM trade_history WHERE league_id=?", (league_id,)) as cur:
            total_row = await cur.fetchone()

        async with db.execute(
            """
            SELECT sleeper_id, player_name, fc_value, avg_trade_ratio, observed_trades
            FROM market_calibration
            WHERE league_id=? AND observed_trades >= 2
            ORDER BY ABS(avg_trade_ratio - 1) DESC
            """,
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

    players = []
    for row in rows:
        ratio = row[3] or 0
        if ratio > 1.1:
            signal = "OVERPAID"
        elif ratio < 0.9:
            signal = "UNDERVALUED"
        else:
            signal = "FAIR"
        players.append({
            "sleeper_id": row[0],
            "player_name": row[1],
            "fc_value": row[2],
            "avg_trade_ratio": ratio,
            "signal": signal,
            "observed_trades": row[4],
        })

    return {"league_id": league_id, "total_trades_analyzed": total_row[0] if total_row else 0, "players": players}


@router.get("/trade-history/{league_id}")
async def get_trade_history(league_id: str):
    """Return recent stored trade history with player names resolved."""
    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)
        async with db.execute(
            """
            SELECT transaction_id, week, season, side_a_player_ids_json, side_b_player_ids_json,
                   side_a_pick_ids_json, side_b_pick_ids_json, side_a_total_value,
                   side_b_total_value, created_at
            FROM trade_history
            WHERE league_id=?
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

        player_ids = set()
        parsed_rows = []
        for row in rows:
            side_a_ids = json.loads(row[3] or "[]")
            side_b_ids = json.loads(row[4] or "[]")
            player_ids.update(side_a_ids)
            player_ids.update(side_b_ids)
            parsed_rows.append((row, side_a_ids, side_b_ids))

        names = {}
        if player_ids:
            placeholders = ",".join("?" * len(player_ids))
            async with db.execute(
                f"SELECT sleeper_id, name FROM players WHERE sleeper_id IN ({placeholders})",
                list(player_ids),
            ) as cur:
                names = {player_id: name for player_id, name in await cur.fetchall()}

    return [
        {
            "transaction_id": row[0],
            "week": row[1],
            "season": row[2],
            "side_a_players": [{"sleeper_id": pid, "name": names.get(pid, pid)} for pid in side_a_ids],
            "side_b_players": [{"sleeper_id": pid, "name": names.get(pid, pid)} for pid in side_b_ids],
            "side_a_picks": json.loads(row[5] or "[]"),
            "side_b_picks": json.loads(row[6] or "[]"),
            "side_a_total_value": row[7],
            "side_b_total_value": row[8],
            "created_at": row[9],
        }
        for row, side_a_ids, side_b_ids in parsed_rows
    ]


@router.get("/managers/{league_id}")
async def get_managers(league_id: str):
    """Return manager tendency profiles for a league."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
        async with db.execute(
            """
            SELECT roster_id, owner_name, trades_analyzed, qb_premium, rb_premium, wr_premium,
                   te_premium, pick_sell_bias, accept_rate, updated_at, profile_json
            FROM manager_profiles
            WHERE league_id=?
            ORDER BY trades_analyzed DESC, owner_name
            """,
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

    return [manager_payload(row, my_roster_id) for row in rows]


@router.get("/managers/{league_id}/{roster_id}")
async def get_manager_detail(league_id: str, roster_id: int):
    """Return one manager profile and their related trade history rows."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
        async with db.execute(
            """
            SELECT roster_id, owner_name, trades_analyzed, qb_premium, rb_premium, wr_premium,
                   te_premium, pick_sell_bias, accept_rate, updated_at, profile_json
            FROM manager_profiles
            WHERE league_id=? AND roster_id=?
            """,
            (league_id, roster_id),
        ) as cur:
            profile_row = await cur.fetchone()

        if not profile_row:
            raise HTTPException(status_code=404, detail="Manager profile not found. Run daily sync first.")

        async with db.execute(
            """
            SELECT transaction_id, week, season, side_a_roster_id, side_b_roster_id,
                   side_a_total_value, side_b_total_value, created_at
            FROM trade_history
            WHERE league_id=? AND (side_a_roster_id=? OR side_b_roster_id=?)
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (league_id, roster_id, roster_id),
        ) as cur:
            trade_rows = await cur.fetchall()

    payload = manager_payload(profile_row, my_roster_id)
    payload["trades"] = [
        {
            "transaction_id": row[0],
            "week": row[1],
            "season": row[2],
            "side_a_roster_id": row[3],
            "side_b_roster_id": row[4],
            "side_a_total_value": row[5],
            "side_b_total_value": row[6],
            "created_at": row[7],
        }
        for row in trade_rows
    ]
    return payload


@router.get("/sync")
async def trigger_sync():
    """Trigger a manual sync in the background."""
    asyncio.create_task(daily_sync.main())
    return {"status": "sync started"}


@router.get("/league/{league_id}/picks")
async def get_picks(league_id: str, my_roster_id: Optional[int] = None):
    """Return traded picks for this league."""
    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)
        async with db.execute(
            "SELECT season, round, original_owner_id, current_owner_id "
            "FROM picks WHERE league_id=? ORDER BY season, round",
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

    return [
        {
            "season": r[0], "round": r[1],
            "original_owner_id": r[2], "current_owner_id": r[3],
        }
        for r in rows
    ]


@router.get("/players/{player_id}/profile")
async def get_player_profile(player_id: str, response: Response):
    """Return full dynasty profile for a single player."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, "
            "trend_30d, injury_status, depth_chart_order "
            "FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            row = await cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

        p = {
            "sleeper_id": row[0], "name": row[1], "position": row[2], "team": row[3],
            "age": row[4], "value_sf": row[5] or 0, "value_1qb": row[6] or 0,
            "trend_30d": row[7] or 0, "injury_status": row[8],
        }
        # Use the first league config available for enrichment
        from backend.services.fantasy_engine import LEAGUE_CONFIG
        league_id = next(iter(LEAGUE_CONFIG), None)
        enriched = enrich_player(p, league_id) if league_id else p

        # Positional rank: count players with higher value in same position
        position = row[2] or "WR"
        value_col = (
            "value_sf"
            if league_id and LEAGUE_CONFIG.get(league_id, {}).get("base_format") == "sf"
            else "value_1qb"
        )
        player_value = row[5] if value_col == "value_sf" else row[6]
        async with db.execute(
            f"SELECT COUNT(*) FROM players WHERE position = ? AND {value_col} > ?",
            (position, player_value or 0),
        ) as cur:
            rank_row = await cur.fetchone()
        positional_rank = (rank_row[0] if rank_row else 0) + 1

        # Recent snapshots as proxy for recent stats
        async with db.execute(
            "SELECT snapshot_date, value_sf, depth_chart_order, injury_status "
            "FROM player_snapshots WHERE sleeper_id = ? ORDER BY snapshot_date DESC LIMIT 4",
            (player_id,),
        ) as cur:
            snap_rows = await cur.fetchall()

        recent_stats = [
            {
                "week": snap[0],
                "value": snap[1],
                "depth_chart_order": snap[2],
                "injury_status": snap[3],
            }
            for snap in snap_rows
        ]

        seven_day_value_change = None
        seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        async with db.execute(
            "SELECT value_sf, snapshot_date FROM player_snapshots "
            "WHERE sleeper_id = ? AND snapshot_date <= ? AND value_sf IS NOT NULL "
            "ORDER BY snapshot_date DESC LIMIT 1",
            (player_id, seven_days_ago),
        ) as cur:
            old_value_row = await cur.fetchone()

        current_value = player_value or 0
        if old_value_row and current_value:
            old_value = old_value_row[0] or 0
            if old_value:
                delta = current_value - old_value
                seven_day_value_change = {
                    "delta": delta,
                    "delta_pct": round((delta / old_value) * 100, 1),
                    "current_value": current_value,
                    "value_7d_ago": old_value,
                    "snapshot_date": old_value_row[1],
                }

        async with db.execute(
            "SELECT snapshot_date, value_sf FROM player_snapshots "
            "WHERE sleeper_id = ? AND value_sf IS NOT NULL "
            "ORDER BY snapshot_date ASC",
            (player_id,),
        ) as cur:
            trend_rows = await cur.fetchall()
        value_trend = player_value_trend([
            {"snapshot_date": trend_row[0], "value_sf": trend_row[1]}
            for trend_row in trend_rows
        ])
        career_comps = await build_player_career_comps(db, p, limit=3)
        usage_trend = await get_usage_for_player(db, player_id)
        schedule_sos = await build_schedule_sos(p, weeks=8)

        # Comparable players: same position, similar value (within ±15%)
        value_target = player_value or 1
        low, high = value_target * 0.85, value_target * 1.15
        async with db.execute(
            f"SELECT sleeper_id, name, position, team, age, {value_col}, trend_30d "
            f"FROM players WHERE position = ? AND {value_col} BETWEEN ? AND ? AND sleeper_id != ? "
            f"ORDER BY ABS({value_col} - ?) LIMIT 3",
            (position, low, high, player_id, value_target),
        ) as cur:
            comp_rows = await cur.fetchall()

        comparable_players = [
            {
                "sleeper_id": cr[0], "name": cr[1], "position": cr[2],
                "team": cr[3], "age": cr[4], "dynasty_value": cr[5], "trend_30d": cr[6],
            }
            for cr in comp_rows
        ]

    # Breakout score from enriched data
    breakout_score = enriched.get("breakout_score", None)
    career_stage = enriched.get("career_stage", "prime")
    years_in_prime = enriched.get("years_in_prime_remaining", None)

    return {
        "sleeper_id": enriched["sleeper_id"],
        "name": enriched["name"],
        "position": enriched.get("position"),
        "team": enriched.get("team"),
        "age": enriched.get("age"),
        "years_exp": None,  # not stored in db currently
        "dynasty_value": enriched.get("adjusted_value", player_value),
        "dynasty_value_sf": row[5],
        "dynasty_value_1qb": row[6],
        "seven_day_value_change": seven_day_value_change,
        "trend_30d": enriched.get("trend_30d", 0),
        "injury_status": enriched.get("injury_status"),
        "career_stage": career_stage,
        "years_in_prime_remaining": years_in_prime,
        "positional_rank": positional_rank,
        "breakout_score": breakout_score,
        "value_trend": value_trend,
        "career_comps": career_comps,
        "usage_trend": usage_trend,
        "schedule_sos": schedule_sos,
        "recent_stats": recent_stats,
        "comparable_players": comparable_players,
    }


async def build_player_career_comps(db: aiosqlite.Connection, player: dict, limit: int = 3) -> list[dict]:
    await ensure_player_comps_table(db)
    position = player.get("position") or "WR"
    value = float(player.get("value_sf") or player.get("value_1qb") or 0)
    value_floor = max(0, value * 0.35)
    value_ceiling = max(value_floor + 1, value * 1.85)
    async with db.execute(
        """
        SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, depth_chart_order
        FROM players
        WHERE position = ?
          AND sleeper_id != ?
          AND COALESCE(value_sf, value_1qb, 0) BETWEEN ? AND ?
        ORDER BY ABS(COALESCE(value_sf, value_1qb, 0) - ?) ASC
        LIMIT 40
        """,
        (position, player["sleeper_id"], value_floor, value_ceiling, value),
    ) as cur:
        candidate_rows = await cur.fetchall()

    candidates = [
        {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "age": row[4],
            "value_sf": row[5] or 0,
            "value_1qb": row[6] or 0,
            "trend_30d": row[7] or 0,
            "depth_chart_order": row[8],
        }
        for row in candidate_rows
    ]
    comps = compute_player_comps(player, candidates, limit=limit)
    computed_at = datetime.now(timezone.utc).isoformat()
    payload = []

    for comp in comps:
        await db.execute(
            """
            INSERT INTO player_comps (
                sleeper_id, comp_sleeper_id, similarity_score, factors_json, computed_at
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(sleeper_id, comp_sleeper_id) DO UPDATE SET
                similarity_score=excluded.similarity_score,
                factors_json=excluded.factors_json,
                computed_at=excluded.computed_at
            """,
            (
                player["sleeper_id"],
                comp["sleeper_id"],
                comp["similarity_score"],
                json.dumps(comp.get("factors") or {}),
                computed_at,
            ),
        )
        payload.append({
            "sleeper_id": comp["sleeper_id"],
            "name": comp["name"],
            "position": comp.get("position"),
            "team": comp.get("team"),
            "age": comp.get("age"),
            "dynasty_value": comp.get("value_sf") or comp.get("value_1qb") or 0,
            "trend_30d": comp.get("trend_30d") or 0,
            "similarity_score": comp["similarity_score"],
            "factors": comp.get("factors") or {},
            "trajectory": await player_value_history(db, comp["sleeper_id"]),
        })

    await db.commit()
    return payload


async def _trade_partner_leagues(db: aiosqlite.Connection, league_id: Optional[str]) -> list[dict]:
    if league_id:
        return [await get_league_row(db, league_id)]

    async with db.execute(
        "SELECT league_id, name, n_teams, format, my_roster_id, config_json FROM leagues"
    ) as cur:
        rows = await cur.fetchall()

    if rows:
        return [
            {
                "league_id": row[0],
                "name": row[1],
                "n_teams": row[2],
                "format": row[3],
                "my_roster_id": row[4],
                "config": json.loads(row[5] or "{}"),
            }
            for row in rows
        ]

    return [
        {
            "league_id": lid,
            "name": cfg["name"],
            "n_teams": cfg["n_teams"],
            "format": cfg.get("base_format", "sf"),
            "my_roster_id": cfg.get("my_roster_id", 1),
            "config": cfg,
        }
        for lid, cfg in LEAGUE_CONFIG.items()
    ]


@router.get("/players/{player_id}/potential-buyers")
async def get_player_potential_buyers(
    player_id: str,
    response: Response,
    league_id: Optional[str] = None,
    limit: int = 8,
):
    """Return managers whose rosters are weakest at this player's position."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    requested_limit = max(1, min(int(limit or 8), 12))
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, "
            "trend_30d, injury_status, depth_chart_order "
            "FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

        target_base = {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "age": row[4],
            "value_sf": row[5] or 0,
            "value_1qb": row[6] or 0,
            "trend_30d": row[7] or 0,
            "injury_status": row[8],
            "depth_chart_order": row[9],
        }
        leagues = await _trade_partner_leagues(db, league_id)
        buyers = []

        for league in leagues:
            lid = str(league["league_id"])
            my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
            async with db.execute(
                "SELECT roster_id, owner_display_name, player_ids_json "
                "FROM rosters WHERE league_id=? ORDER BY roster_id",
                (lid,),
            ) as cur:
                roster_rows = await cur.fetchall()
            if not roster_rows:
                continue

            rosters = []
            for roster_id, owner, player_ids_json in roster_rows:
                players = await get_players_for_ids(db, json.loads(player_ids_json or "[]"), lid)
                rosters.append({
                    "league_id": lid,
                    "league_name": league.get("name") or lid,
                    "roster_id": roster_id,
                    "owner": owner or f"Team {roster_id}",
                    "is_mine": roster_id == my_roster_id,
                    "players": players,
                })

            buyers.extend(find_trade_partner_buyers(
                enrich_player(target_base, lid),
                rosters,
                limit=requested_limit,
            ))

    buyers.sort(key=lambda item: item["score"], reverse=True)
    return {
        "player": {
            "sleeper_id": target_base["sleeper_id"],
            "name": target_base["name"],
            "position": target_base["position"],
        },
        "league_id": league_id,
        "buyers": buyers[:requested_limit],
    }


@router.get("/players/{player_id}/career-comps")
async def get_player_career_comps(player_id: str, response: Response, limit: int = 3):
    """Return the top historical player comps with value trajectories."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    requested_limit = max(1, min(int(limit or 3), 5))
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, depth_chart_order "
            "FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

        player = {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "age": row[4],
            "value_sf": row[5] or 0,
            "value_1qb": row[6] or 0,
            "trend_30d": row[7] or 0,
            "depth_chart_order": row[8],
        }
        comps = await build_player_career_comps(db, player, limit=requested_limit)
        target_history = await player_value_history(db, player_id)

    return {
        "sleeper_id": player["sleeper_id"],
        "name": player["name"],
        "position": player.get("position"),
        "target_trajectory": target_history,
        "comps": comps,
    }


@router.get("/players/{player_id}/schedule-sos")
async def get_player_schedule_sos(player_id: str, response: Response, weeks: int = 8):
    """Return a player's upcoming opponent list and 0-100 strength-of-schedule score."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    requested_weeks = max(1, min(int(weeks or 8), 8))
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

    player = {
        "sleeper_id": row[0],
        "name": row[1],
        "position": row[2],
        "team": row[3],
    }
    return {
        **player,
        **await build_schedule_sos(player, weeks=requested_weeks),
    }


@router.get("/players/{player_id}/usage")
async def get_player_usage(player_id: str, response: Response):
    """Return weekly target-share/snap-count history and trend for a player."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            player_row = await cur.fetchone()
        if not player_row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

        usage = await get_usage_for_player(db, player_id)

    return {
        "sleeper_id": player_row[0],
        "name": player_row[1],
        "position": player_row[2],
        "team": player_row[3],
        **usage,
    }


@router.get("/players/{player_id}/value-trend")
async def get_player_value_trend(player_id: str, response: Response):
    """Return 30/90-day value windows and a BUY/SELL/HOLD signal for a player."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, value_sf FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            player_row = await cur.fetchone()
        if not player_row:
            raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

        async with db.execute(
            "SELECT snapshot_date, value_sf FROM player_snapshots "
            "WHERE sleeper_id = ? AND value_sf IS NOT NULL "
            "ORDER BY snapshot_date ASC",
            (player_id,),
        ) as cur:
            rows = await cur.fetchall()

    trend = player_value_trend([
        {"snapshot_date": row[0], "value_sf": row[1]}
        for row in rows
    ])
    return {
        "sleeper_id": player_row[0],
        "name": player_row[1],
        "position": player_row[2],
        "team": player_row[3],
        "current_value": player_row[4] or 0,
        **trend,
    }


@router.get("/players/{player_id}/age-curve-projection")
async def get_player_age_curve_projection(player_id: str, response: Response):
    """Return 1/3/5-year dynasty value projections from positional age curves."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb "
            "FROM players WHERE sleeper_id = ?",
            (player_id,),
        ) as cur:
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Player {player_id} not found.")

    league_id = next(iter(LEAGUE_CONFIG), None)
    value_col = (
        "value_sf"
        if league_id and LEAGUE_CONFIG.get(league_id, {}).get("base_format") == "sf"
        else "value_1qb"
    )
    current_value = row[5] if value_col == "value_sf" else row[6]
    projection = project_age_curve_values(
        {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "age": row[4],
        },
        current_value or 0,
    )
    return {
        "sleeper_id": row[0],
        "name": row[1],
        "team": row[3],
        "value_basis": value_col,
        **projection,
    }


@router.get("/portfolio/exposure")
async def get_portfolio_exposure():
    """Return per-player exposure across all leagues Marcus owns a roster in."""
    async with aiosqlite.connect(DB_PATH) as db:
        # 1. Fetch all leagues
        async with db.execute(
            "SELECT league_id, name, n_teams, format, my_roster_id, config_json FROM leagues"
        ) as cur:
            league_rows = await cur.fetchall()

        if not league_rows:
            return {"total_leagues": 0, "players": [], "by_position": {}}

        leagues = [
            {
                "league_id": r[0],
                "name": r[1],
                "n_teams": r[2],
                "format": r[3],
                "my_roster_id": json.loads(r[5] or "{}").get("my_roster_id", r[4]),
            }
            for r in league_rows
        ]
        total_leagues = len(leagues)

        # 2. For each league, find Marcus's roster player IDs
        player_league_map: dict = {}  # sleeper_id -> [league_name, ...]

        for league in leagues:
            league_id = league["league_id"]
            my_roster_id = league["my_roster_id"]
            async with db.execute(
                "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
                (league_id, my_roster_id),
            ) as cur:
                row = await cur.fetchone()
            if not row:
                continue
            player_ids = json.loads(row[0] or "[]")
            for pid in player_ids:
                if pid not in player_league_map:
                    player_league_map[pid] = []
                player_league_map[pid].append(league["name"])

        if not player_league_map:
            return {"total_leagues": total_leagues, "players": [], "by_position": {}}

        # 3. Fetch player details for all owned players
        all_player_ids = list(player_league_map.keys())
        placeholders = ",".join("?" * len(all_player_ids))
        async with db.execute(
            f"SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status "
            f"FROM players WHERE sleeper_id IN ({placeholders})",
            all_player_ids,
        ) as cur:
            player_rows = await cur.fetchall()

    # 4. Build exposure records
    players_out = []
    for r in player_rows:
        sleeper_id = r[0]
        leagues_owned = player_league_map.get(sleeper_id, [])
        leagues_count = len(leagues_owned)
        exposure_pct = round((leagues_count / total_leagues) * 100, 1)

        # Use SF value if available, fall back to 1QB
        dynasty_value = r[5] or r[6] or 0

        players_out.append({
            "sleeper_id": sleeper_id,
            "player_name": r[1],
            "position": r[2] or "Unknown",
            "team": r[3] or "FA",
            "age": r[4],
            "dynasty_value": dynasty_value,
            "leagues_owned": leagues_owned,
            "leagues_count": leagues_count,
            "exposure_pct": exposure_pct,
            "total_leagues": total_leagues,
        })

    # 5. Sort: exposure_pct desc, then dynasty_value desc
    players_out.sort(key=lambda p: (-p["exposure_pct"], -p["dynasty_value"]))

    # 6. Group by position
    by_position = {}
    for p in players_out:
        pos = p["position"]
        if pos not in by_position:
            by_position[pos] = []
        by_position[pos].append(p)

    return {
        "total_leagues": total_leagues,
        "league_names": [lg["name"] for lg in leagues],
        "players": players_out,
        "by_position": by_position,
    }


# ── League Settings Auto-Detector (#64) ───────────────────────────────────────

def _parse_league_settings(league_data: dict) -> dict:
    """Parse Sleeper league JSON into structured scoring/format settings."""
    roster_positions = league_data.get("roster_positions") or []
    scoring = league_data.get("scoring_settings") or {}

    is_superflex = "SUPER_FLEX" in roster_positions
    qb_slots = roster_positions.count("QB")
    is_te_premium = float(scoring.get("bonus_rec_te", 0) or 0) > 0

    rec = float(scoring.get("rec", 0) or 0)
    if rec >= 1.0:
        rec_format = "PPR"
    elif rec >= 0.5:
        rec_format = "0.5PPR"
    else:
        rec_format = "0PPR"

    format_label = "SF" if is_superflex else "1QB"

    return {
        "is_superflex": is_superflex,
        "is_te_premium": is_te_premium,
        "qb_slots": qb_slots,
        "rec_format": rec_format,
        "format_label": format_label,
    }


async def _ensure_league_settings_table(db: aiosqlite.Connection) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS league_settings (
            league_id TEXT PRIMARY KEY,
            league_name TEXT,
            is_superflex INTEGER DEFAULT 0,
            is_te_premium INTEGER DEFAULT 0,
            qb_slots INTEGER DEFAULT 1,
            rec_format TEXT DEFAULT 'PPR',
            format_label TEXT DEFAULT '1QB',
            raw_json TEXT,
            updated_at TEXT
        )
        """
    )


@router.get("/leagues/settings")
async def get_leagues_settings():
    """
    Auto-detect scoring format for every known league from the Sleeper API.
    Detects: SF vs 1QB, TE Premium, PPR/0.5PPR/0PPR.
    Results are cached in the league_settings table and returned immediately.
    """
    now = datetime.now(timezone.utc).isoformat()
    results = []

    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_league_settings_table(db)
        await db.commit()

        for league_id, cfg in LEAGUE_CONFIG.items():
            try:
                league_data = await sleeper_svc.fetch_league_info(league_id)
            except Exception:
                league_data = {}

            parsed = _parse_league_settings(league_data)
            league_name = league_data.get("name") or cfg.get("name", league_id)

            await db.execute(
                """
                INSERT INTO league_settings
                    (league_id, league_name, is_superflex, is_te_premium, qb_slots,
                     rec_format, format_label, raw_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(league_id) DO UPDATE SET
                    league_name=excluded.league_name,
                    is_superflex=excluded.is_superflex,
                    is_te_premium=excluded.is_te_premium,
                    qb_slots=excluded.qb_slots,
                    rec_format=excluded.rec_format,
                    format_label=excluded.format_label,
                    raw_json=excluded.raw_json,
                    updated_at=excluded.updated_at
                """,
                (
                    league_id,
                    league_name,
                    int(parsed["is_superflex"]),
                    int(parsed["is_te_premium"]),
                    parsed["qb_slots"],
                    parsed["rec_format"],
                    parsed["format_label"],
                    json.dumps(league_data),
                    now,
                ),
            )

            results.append(
                {
                    "league_id": league_id,
                    "league_name": league_name,
                    "format_label": parsed["format_label"],
                    "is_superflex": parsed["is_superflex"],
                    "is_te_premium": parsed["is_te_premium"],
                    "qb_slots": parsed["qb_slots"],
                    "rec_format": parsed["rec_format"],
                }
            )

        await db.commit()

    return results


@router.get("/league/{league_id}/settings")
async def get_league_settings(league_id: str):
    """Return cached scoring settings for a single league; fetches from Sleeper if not cached."""
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_league_settings_table(db)

        async with db.execute(
            """
            SELECT league_id, league_name, is_superflex, is_te_premium,
                   qb_slots, rec_format, format_label
            FROM league_settings WHERE league_id=?
            """,
            (league_id,),
        ) as cur:
            row = await cur.fetchone()

        if row:
            return {
                "league_id": row[0],
                "league_name": row[1],
                "is_superflex": bool(row[2]),
                "is_te_premium": bool(row[3]),
                "qb_slots": row[4],
                "rec_format": row[5],
                "format_label": row[6],
            }

        # Not cached — fetch from Sleeper now
        cfg = LEAGUE_CONFIG.get(league_id, {})
        try:
            league_data = await sleeper_svc.fetch_league_info(league_id)
        except Exception:
            league_data = {}

        parsed = _parse_league_settings(league_data)
        league_name = league_data.get("name") or cfg.get("name", league_id)

        await db.execute(
            """
            INSERT INTO league_settings
                (league_id, league_name, is_superflex, is_te_premium, qb_slots,
                 rec_format, format_label, raw_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_id) DO UPDATE SET
                league_name=excluded.league_name,
                is_superflex=excluded.is_superflex,
                is_te_premium=excluded.is_te_premium,
                qb_slots=excluded.qb_slots,
                rec_format=excluded.rec_format,
                format_label=excluded.format_label,
                raw_json=excluded.raw_json,
                updated_at=excluded.updated_at
            """,
            (
                league_id,
                league_name,
                int(parsed["is_superflex"]),
                int(parsed["is_te_premium"]),
                parsed["qb_slots"],
                parsed["rec_format"],
                parsed["format_label"],
                json.dumps(league_data),
                now,
            ),
        )
        await db.commit()

    return {
        "league_id": league_id,
        "league_name": league_name,
        "is_superflex": parsed["is_superflex"],
        "is_te_premium": parsed["is_te_premium"],
        "qb_slots": parsed["qb_slots"],
        "rec_format": parsed["rec_format"],
        "format_label": parsed["format_label"],
    }


@router.get("/league/{league_id}/team-needs")
async def get_team_needs(league_id: str):
    """Return positional strength grades (0-100) for every team in the league.

    Grades are computed by normalising each team's total dynasty value at each
    position against the maximum value held by any team at that position.
    Picks are valued by counting them and scaling against the most pick-rich team.
    """
    POSITIONS = ["QB", "RB", "WR", "TE"]

    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        # Fetch pick counts per roster
        async with db.execute(
            "SELECT current_owner_id, COUNT(*) FROM picks WHERE league_id=? GROUP BY current_owner_id",
            (league_id,),
        ) as cur:
            pick_rows = await cur.fetchall()

    pick_counts = {row[0]: row[1] for row in pick_rows}
    max_picks = max(pick_counts.values(), default=1) or 1

    teams = []
    pos_totals = {pos: [] for pos in POSITIONS}

    for roster_id, owner, pid_json in roster_rows:
        player_ids = json.loads(pid_json or "[]")

        # Inline value lookup — avoid another DB connection
        pos_values = {pos: 0.0 for pos in POSITIONS}

        if player_ids:
            async with aiosqlite.connect(DB_PATH) as db2:
                placeholders = ",".join("?" * len(player_ids))
                async with db2.execute(
                    f"SELECT position, value_sf, value_1qb FROM players WHERE sleeper_id IN ({placeholders})",
                    player_ids,
                ) as cur:
                    player_rows = await cur.fetchall()

            for pos, vsf, v1qb in player_rows:
                if pos in pos_values:
                    pos_values[pos] += float(vsf or v1qb or 0)

        for pos in POSITIONS:
            pos_totals[pos].append(pos_values[pos])

        picks = pick_counts.get(roster_id, 0)
        teams.append({
            "roster_id": roster_id,
            "team_name": owner or f"Team {roster_id}",
            "_pos_values": pos_values,
            "_picks": picks,
        })

    # Compute max per position for normalisation
    max_pos = {pos: max(pos_totals[pos], default=1) or 1 for pos in POSITIONS}

    result = []
    for team in teams:
        grades = {}
        for pos in POSITIONS:
            raw = team["_pos_values"][pos]
            grades[pos] = round((raw / max_pos[pos]) * 100)
        grades["Picks"] = round((team["_picks"] / max_picks) * 100)

        result.append({
            "team_name": team["team_name"],
            "roster_id": team["roster_id"],
            "grades": grades,
        })

    return result


# ---------------------------------------------------------------------------
# F04: Start/Sit Recommendations
# ---------------------------------------------------------------------------

STARTER_SLOTS = {"QB": 1, "RB": 2, "WR": 3, "TE": 1}
INJURY_MULTIPLIER = {"OUT": 0.0, "DOUBTFUL": 0.3, "QUESTIONABLE": 0.7, "PROBABLE": 0.95}


def _injury_mult(status):
    if not status:
        return 1.0
    return INJURY_MULTIPLIER.get(status.upper(), 1.0)


def _depth_mult(depth):
    if depth is None or depth <= 0:
        return 1.0
    if depth == 1:
        return 1.0
    if depth == 2:
        return 0.7
    return 0.4


@router.get("/startsit/{league_id}")
async def get_startsit(league_id: str):
    """Return start/sit recommendations for Marcus's roster in the given league."""
    async with aiosqlite.connect(DB_PATH) as db:
        trust = await data_trust.get_trust_status(db, league_id)
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        async with db.execute(
            "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
            (league_id, my_roster_id),
        ) as cur:
            row = await cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Roster not found. Run daily sync first.")

        player_ids = json.loads(row[0] or "[]")
        if not player_ids:
            return {"recommendations": [], "optimal_lineup": {}}

        placeholders = ",".join("?" * len(player_ids))
        async with db.execute(
            f"SELECT sleeper_id, name, position, team, value_sf, injury_status, depth_chart_order "
            f"FROM players WHERE sleeper_id IN ({placeholders})",
            player_ids,
        ) as cur:
            player_rows = await cur.fetchall()

    players = []
    for r in player_rows:
        sleeper_id, name, position, team, value_sf, injury_status, depth = r
        value_sf = value_sf or 0
        score = value_sf * _injury_mult(injury_status) * _depth_mult(depth)
        players.append({
            "sleeper_id": sleeper_id,
            "name": name,
            "position": position,
            "team": team,
            "value_sf": value_sf,
            "injury_status": injury_status,
            "depth_chart_order": depth,
            "score": score,
        })

    by_pos = {}
    for p in players:
        pos = p["position"]
        if pos in STARTER_SLOTS:
            by_pos.setdefault(pos, []).append(p)

    recommendations = []
    optimal_lineup = {}
    already_flagged_out = set()

    for pos, slots in STARTER_SLOTS.items():
        pos_players = sorted(by_pos.get(pos, []), key=lambda x: x["score"], reverse=True)
        starters = pos_players[:slots]
        bench = pos_players[slots:]

        optimal_lineup[pos] = starters

        for bench_player in bench:
            for starter in starters:
                if bench_player["score"] > starter["score"]:
                    value_diff = round(bench_player["score"] - starter["score"], 1)
                    reason_parts = []
                    if starter["injury_status"]:
                        reason_parts.append(f"{starter['name']} is {starter['injury_status']}")
                    if bench_player["value_sf"] > starter["value_sf"]:
                        reason_parts.append(f"{bench_player['name']} has higher dynasty value")
                    if bench_player["depth_chart_order"] == 1 and (starter["depth_chart_order"] or 0) > 1:
                        reason_parts.append(f"{bench_player['name']} is the depth-1 starter")
                    reason = "; ".join(reason_parts) if reason_parts else "Higher projected score"
                    already_flagged_out.add(starter["sleeper_id"])
                    recommendations.append({
                        "action": "START",
                        "player_in": {
                            "sleeper_id": bench_player["sleeper_id"],
                            "name": bench_player["name"],
                            "position": bench_player["position"],
                            "team": bench_player["team"],
                            "value_sf": bench_player["value_sf"],
                            "injury_status": bench_player["injury_status"],
                            "score": round(bench_player["score"], 1),
                        },
                        "player_out": {
                            "sleeper_id": starter["sleeper_id"],
                            "name": starter["name"],
                            "position": starter["position"],
                            "team": starter["team"],
                            "value_sf": starter["value_sf"],
                            "injury_status": starter["injury_status"],
                            "score": round(starter["score"], 1),
                        },
                        "value_diff": value_diff,
                        "reason": reason,
                    })
                    break

        for starter in starters:
            inj = (starter["injury_status"] or "").upper()
            if inj in ("OUT", "DOUBTFUL") and starter["sleeper_id"] not in already_flagged_out:
                recommendations.append({
                    "action": "SIT",
                    "player_in": None,
                    "player_out": {
                        "sleeper_id": starter["sleeper_id"],
                        "name": starter["name"],
                        "position": starter["position"],
                        "team": starter["team"],
                        "value_sf": starter["value_sf"],
                        "injury_status": starter["injury_status"],
                        "score": round(starter["score"], 1),
                    },
                    "value_diff": 0,
                    "reason": f"{starter['name']} is listed as {starter['injury_status']}",
                })

    recommendations.sort(key=lambda r: r["value_diff"], reverse=True)

    serialized_lineup = {}
    for pos, pos_starters in optimal_lineup.items():
        serialized_lineup[pos] = [
            {
                "sleeper_id": p["sleeper_id"],
                "name": p["name"],
                "position": p["position"],
                "team": p["team"],
                "value_sf": p["value_sf"],
                "injury_status": p["injury_status"],
                "score": round(p["score"], 1),
            }
            for p in pos_starters
        ]

    result = {
        "league_id": league_id,
        "recommendations": recommendations,
        "optimal_lineup": serialized_lineup,
    }
    if not trust["ok"]:
        result["degraded"] = True
        result["degraded_reasons"] = trust["reasons"]
    return result


# ---------------------------------------------------------------------------
# F05: Waiver Wire Ranker
# ---------------------------------------------------------------------------

@router.get("/waiver/{league_id}")
async def get_waiver_wire(league_id: str):
    """Return top free agents not rostered in this league, sorted by dynasty value."""
    async with aiosqlite.connect(DB_PATH) as db:
        trust = await data_trust.get_trust_status(db, league_id)
        await get_league_row(db, league_id)

        async with db.execute(
            "SELECT player_ids_json FROM rosters WHERE league_id=?",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        rostered_ids = set()
        for (pid_json,) in roster_rows:
            ids = json.loads(pid_json or "[]")
            rostered_ids.update(ids)

        if rostered_ids:
            placeholders = ",".join("?" * len(rostered_ids))
            query = (
                f"SELECT sleeper_id, name, position, team, value_sf, injury_status, depth_chart_order "
                f"FROM players "
                f"WHERE sleeper_id NOT IN ({placeholders}) "
                f"AND position IN ('QB','RB','WR','TE','K','DEF') "
                f"ORDER BY value_sf DESC "
                f"LIMIT 100"
            )
            async with db.execute(query, list(rostered_ids)) as cur:
                rows = await cur.fetchall()
        else:
            async with db.execute(
                "SELECT sleeper_id, name, position, team, value_sf, injury_status, depth_chart_order "
                "FROM players "
                "WHERE position IN ('QB','RB','WR','TE','K','DEF') "
                "ORDER BY value_sf DESC LIMIT 100"
            ) as cur:
                rows = await cur.fetchall()

    free_agents = []
    for r in rows:
        sleeper_id, name, position, team, value_sf, injury_status, depth = r
        free_agents.append({
            "sleeper_id": sleeper_id,
            "name": name,
            "position": position,
            "team": team or "",
            "value_sf": value_sf or 0,
            "injury_status": injury_status,
            "depth_chart_order": depth,
            "roster_pct": 0,
        })

    result = {
        "league_id": league_id,
        "free_agents": free_agents,
        "total": len(free_agents),
    }
    if not trust["ok"]:
        result["degraded"] = True
        result["degraded_reasons"] = trust["reasons"]
    return result


# ---------------------------------------------------------------------------
# F01 — Player News & Injury Feed
# ---------------------------------------------------------------------------

@router.get("/news")
async def get_news(league_id: Optional[str] = None):
    """Return the last 50 news items, optionally filtered to a league's roster players."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        owned_ids: Optional[set] = None
        if league_id:
            # Collect the player IDs on Marcus's own roster in this league.
            # `rosters` has no `my_roster_id` column -- it lives on `leagues` -- so
            # this has to join through `leagues.my_roster_id` (same pattern as
            # get_value_movers/get_team_needs), not query `rosters.my_roster_id`
            # directly (that was issue #275: an OperationalError on every call).
            async with db.execute(
                "SELECT r.player_ids_json "
                "FROM leagues l JOIN rosters r ON r.league_id = l.league_id AND r.roster_id = l.my_roster_id "
                "WHERE l.league_id = ?",
                (league_id,),
            ) as cur:
                row = await cur.fetchone()
            owned_ids = set(json.loads(row[0] or "[]")) if row else set()

        if owned_ids is not None and len(owned_ids) == 0:
            # No players found for this league
            return []

        # Build query
        if owned_ids:
            placeholders = ",".join("?" * len(owned_ids))
            query = (
                f"SELECT n.sleeper_id, n.player_name, n.headline, n.detail, n.source, n.published_at, "
                f"p.position, p.team "
                f"FROM news_items n LEFT JOIN players p ON p.sleeper_id = n.sleeper_id "
                f"WHERE n.sleeper_id IN ({placeholders}) "
                f"ORDER BY n.published_at DESC LIMIT 50"
            )
            async with db.execute(query, list(owned_ids)) as cur:
                rows = await cur.fetchall()
        else:
            query = (
                "SELECT n.sleeper_id, n.player_name, n.headline, n.detail, n.source, n.published_at, "
                "p.position, p.team "
                "FROM news_items n LEFT JOIN players p ON p.sleeper_id = n.sleeper_id "
                "ORDER BY n.published_at DESC LIMIT 50"
            )
            async with db.execute(query) as cur:
                rows = await cur.fetchall()

    return [
        {
            "sleeper_id": r[0],
            "player_name": r[1],
            "headline": r[2],
            "detail": r[3],
            "source": r[4],
            "published_at": r[5],
            "position": r[6],
            "team": r[7],
            "sentiment": classify_news_sentiment(r[2], r[3]),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# F03 — Value Movers (7-day delta)
# ---------------------------------------------------------------------------

@router.get("/players/movers")
async def get_value_movers():
    """Return top 10 gainers and top 10 losers by value change over the last 7 days."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Collect all player IDs Marcus owns across all leagues
        async with db.execute(
            "SELECT l.my_roster_id, r.player_ids_json "
            "FROM leagues l JOIN rosters r ON r.league_id = l.league_id AND r.roster_id = l.my_roster_id"
        ) as cur:
            roster_rows = await cur.fetchall()

        owned_ids: set = set()
        for row in roster_rows:
            owned_ids.update(json.loads(row[1] or "[]"))

        if not owned_ids:
            return {"gainers": [], "losers": [], "note": "No rosters found — run daily sync first."}

        placeholders = ",".join("?" * len(owned_ids))
        owned_list = list(owned_ids)

        # Get latest snapshot per player
        async with db.execute(
            f"SELECT s.sleeper_id, s.value_sf, s.snapshot_date "
            f"FROM player_snapshots s "
            f"INNER JOIN ("
            f"  SELECT sleeper_id, MAX(snapshot_date) AS max_date "
            f"  FROM player_snapshots WHERE sleeper_id IN ({placeholders}) GROUP BY sleeper_id"
            f") latest ON s.sleeper_id = latest.sleeper_id AND s.snapshot_date = latest.max_date",
            owned_list,
        ) as cur:
            latest_rows = await cur.fetchall()

        if not latest_rows:
            return {
                "gainers": [],
                "losers": [],
                "note": "No snapshot data yet — snapshots are recorded during daily sync.",
            }

        latest = {r[0]: {"value": r[1], "date": r[2]} for r in latest_rows}

        # For each player, get the snapshot closest to 7 days ago
        seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

        movers = []
        for sleeper_id, snap in latest.items():
            async with db.execute(
                "SELECT value_sf, snapshot_date FROM player_snapshots "
                "WHERE sleeper_id = ? AND snapshot_date <= ? "
                "ORDER BY snapshot_date DESC LIMIT 1",
                (sleeper_id, seven_days_ago),
            ) as cur:
                old_row = await cur.fetchone()

            if not old_row:
                continue  # no old snapshot available

            value_now = snap["value"] or 0
            value_old = old_row[0] or 0

            if value_old == 0:
                continue

            delta = value_now - value_old
            delta_pct = round((delta / value_old) * 100, 1)

            # Skip trivial moves
            if abs(delta) < 1:
                continue

            movers.append({
                "sleeper_id": sleeper_id,
                "value_now": value_now,
                "value_7d_ago": value_old,
                "delta": delta,
                "delta_pct": delta_pct,
            })

        if not movers:
            return {
                "gainers": [],
                "losers": [],
                "note": "Not enough historical snapshots yet (need at least 7 days of data).",
            }

        # Enrich with player info
        all_ids = [m["sleeper_id"] for m in movers]
        placeholders2 = ",".join("?" * len(all_ids))
        async with db.execute(
            f"SELECT sleeper_id, name, position, team FROM players WHERE sleeper_id IN ({placeholders2})",
            all_ids,
        ) as cur:
            player_rows = await cur.fetchall()

        player_info = {r[0]: {"name": r[1], "position": r[2], "team": r[3]} for r in player_rows}

        for m in movers:
            info = player_info.get(m["sleeper_id"], {})
            m["player_name"] = info.get("name", m["sleeper_id"])
            m["position"] = info.get("position", "")
            m["team"] = info.get("team", "")

        movers.sort(key=lambda x: x["delta"], reverse=True)
        gainers = movers[:10]
        losers = list(reversed(movers[-10:])) if len(movers) >= 10 else list(reversed(movers))

    return {"gainers": gainers, "losers": losers}


# ---------------------------------------------------------------------------
# Feature 1: Dynasty Power Rankings
# ---------------------------------------------------------------------------

PICK_VALUES_BY_ROUND = {1: 5000, 2: 1500, 3: 600, 4: 150}


@router.get("/league/{league_id}/power-rankings")
async def get_power_rankings(league_id: str):
    """Return power rankings for all teams: roster value + pick assets = power score."""
    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])

        # 1. Fetch all rosters
        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        # 2. Fetch picks per roster
        async with db.execute(
            "SELECT current_owner_id, round FROM picks WHERE league_id=?",
            (league_id,),
        ) as cur:
            pick_rows = await cur.fetchall()

        # Group picks by owner
        picks_by_owner: dict = {}
        for owner_id, rnd in pick_rows:
            picks_by_owner.setdefault(owner_id, []).append(rnd)

        # 3. Compute roster values
        teams = []
        for roster_id, owner, pid_json in roster_rows:
            player_ids = json.loads(pid_json or "[]")

            roster_value = 0.0
            if player_ids:
                placeholders = ",".join("?" * len(player_ids))
                async with db.execute(
                    f"SELECT value_sf, value_1qb FROM players WHERE sleeper_id IN ({placeholders})",
                    player_ids,
                ) as cur:
                    prows = await cur.fetchall()
                for vsf, v1qb in prows:
                    roster_value += float(vsf or v1qb or 0)

            # Pick value
            owner_picks = picks_by_owner.get(roster_id, [])
            pick_value_total = sum(PICK_VALUES_BY_ROUND.get(rnd, 100) for rnd in owner_picks)

            power_score = roster_value + pick_value_total
            teams.append({
                "roster_id": roster_id,
                "owner_display_name": owner or f"Team {roster_id}",
                "is_mine": roster_id == my_roster_id,
                "roster_value": round(roster_value),
                "pick_value": round(pick_value_total),
                "power_score": round(power_score),
                "_picks_detail": owner_picks,
            })

        # 4. Sort by power score and assign ranks
        teams.sort(key=lambda t: t["power_score"], reverse=True)
        for i, team in enumerate(teams):
            team["rank"] = i + 1

        # 5. Compute last-week ranks using player_snapshots
        seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

        # Get old snapshot values per player
        async with db.execute(
            """
            SELECT s.sleeper_id, s.value_sf
            FROM player_snapshots s
            INNER JOIN (
                SELECT sleeper_id, MAX(snapshot_date) AS max_date
                FROM player_snapshots
                WHERE snapshot_date <= ?
                GROUP BY sleeper_id
            ) old ON s.sleeper_id = old.sleeper_id AND s.snapshot_date = old.max_date
            """,
            (seven_days_ago,),
        ) as cur:
            old_snap_rows = await cur.fetchall()

        old_values = {r[0]: float(r[1] or 0) for r in old_snap_rows}

        # Re-compute old roster values per team
        if old_values:
            old_rosters: list = []
            for roster_id, owner, pid_json in roster_rows:
                player_ids = json.loads(pid_json or "[]")
                old_roster_val = sum(old_values.get(pid, 0) for pid in player_ids)
                owner_picks = picks_by_owner.get(roster_id, [])
                old_pick_val = sum(PICK_VALUES_BY_ROUND.get(rnd, 100) for rnd in owner_picks)
                old_rosters.append({
                    "roster_id": roster_id,
                    "old_power_score": old_roster_val + old_pick_val,
                })

            old_rosters.sort(key=lambda t: t["old_power_score"], reverse=True)
            old_rank_map = {t["roster_id"]: i + 1 for i, t in enumerate(old_rosters)}

            for team in teams:
                old_rank = old_rank_map.get(team["roster_id"])
                team["prev_rank"] = old_rank
                if old_rank:
                    team["rank_change"] = old_rank - team["rank"]  # positive = moved up
                else:
                    team["rank_change"] = None
        else:
            for team in teams:
                team["prev_rank"] = None
                team["rank_change"] = None

        # Remove internal field
        for team in teams:
            team.pop("_picks_detail", None)

    return {
        "league_id": league_id,
        "league_name": league["name"],
        "my_roster_id": my_roster_id,
        "rankings": teams,
    }


# ---------------------------------------------------------------------------
# Feature 2: Trade Database with Search (extends existing /trade-history/{league_id})
# ---------------------------------------------------------------------------

@router.get("/league/{league_id}/trade-history")
async def get_league_trade_history(
    league_id: str,
    search: Optional[str] = None,
    season: Optional[int] = None,
    limit: int = 50,
):
    """Trade history with player names resolved. Supports ?search=name and ?season=YYYY."""
    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)

        # Build WHERE clause
        conditions = ["league_id=?"]
        params: list = [league_id]
        if season:
            conditions.append("season=?")
            params.append(season)

        where = " AND ".join(conditions)

        async with db.execute(
            f"""
            SELECT transaction_id, week, season,
                   side_a_player_ids_json, side_b_player_ids_json,
                   side_a_pick_ids_json, side_b_pick_ids_json,
                   side_a_total_value, side_b_total_value,
                   side_a_roster_id, side_b_roster_id,
                   created_at
            FROM trade_history
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [*params, limit],
        ) as cur:
            rows = await cur.fetchall()

        # Collect all player IDs to resolve names in one query
        player_ids_needed: set = set()
        roster_ids_needed: set = set()
        parsed_rows = []
        for row in rows:
            side_a_ids = json.loads(row[3] or "[]")
            side_b_ids = json.loads(row[4] or "[]")
            player_ids_needed.update(side_a_ids)
            player_ids_needed.update(side_b_ids)
            roster_ids_needed.update([row[9], row[10]])
            parsed_rows.append((row, side_a_ids, side_b_ids))

        # Resolve player names + values
        player_info: dict = {}
        if player_ids_needed:
            ph = ",".join("?" * len(player_ids_needed))
            async with db.execute(
                f"SELECT sleeper_id, name, position, value_sf, value_1qb FROM players WHERE sleeper_id IN ({ph})",
                list(player_ids_needed),
            ) as cur:
                for pid, pname, ppos, vsf, v1qb in await cur.fetchall():
                    player_info[pid] = {
                        "name": pname or pid,
                        "position": ppos or "",
                        "value": vsf or v1qb or 0,
                    }

        # Resolve owner names via rosters
        owner_names: dict = {}
        if roster_ids_needed:
            ph2 = ",".join("?" * len(roster_ids_needed))
            async with db.execute(
                f"SELECT roster_id, owner_display_name FROM rosters WHERE league_id=? AND roster_id IN ({ph2})",
                [league_id, *list(roster_ids_needed)],
            ) as cur:
                for rid, oname in await cur.fetchall():
                    owner_names[rid] = oname or f"Team {rid}"

    def resolve_players(ids):
        result = []
        for pid in ids:
            info = player_info.get(pid, {"name": pid, "position": "", "value": 0})
            result.append({
                "sleeper_id": pid,
                "name": info["name"],
                "position": info["position"],
                "value": info["value"],
            })
        return result

    def parse_picks(picks_json):
        raw = json.loads(picks_json or "[]")
        result = []
        for pk in raw:
            if isinstance(pk, dict):
                rnd = pk.get("round", pk.get("r", 0))
                yr = pk.get("year", pk.get("season", 0))
            else:
                rnd, yr = 0, 0
            val = PICK_VALUES_BY_ROUND.get(rnd, 100)
            result.append({"round": rnd, "year": yr, "value": val})
        return result

    output = []
    for row, side_a_ids, side_b_ids in parsed_rows:
        a_players = resolve_players(side_a_ids)
        b_players = resolve_players(side_b_ids)
        a_picks = parse_picks(row[5])
        b_picks = parse_picks(row[6])

        a_total = (row[7] or 0) or (
            sum(p["value"] for p in a_players) + sum(p["value"] for p in a_picks)
        )
        b_total = (row[8] or 0) or (
            sum(p["value"] for p in b_players) + sum(p["value"] for p in b_picks)
        )

        analysis = trade_value_analysis(a_total, b_total)

        output.append({
            "transaction_id": row[0],
            "week": row[1],
            "season": row[2],
            "side_a": {
                "roster_id": row[9],
                "owner_name": owner_names.get(row[9], f"Team {row[9]}"),
                "players": a_players,
                "picks": a_picks,
                "total_value": round(a_total),
            },
            "side_b": {
                "roster_id": row[10],
                "owner_name": owner_names.get(row[10], f"Team {row[10]}"),
                "players": b_players,
                "picks": b_picks,
                "total_value": round(b_total),
            },
            "value_delta": analysis["value_delta"],
            "classification": analysis["classification"],
            "side_a_classification": analysis["side_a_classification"],
            "side_b_classification": analysis["side_b_classification"],
            "verdict": analysis["classification"],
            "created_at": row[11],
        })

    # Apply search filter (by player name, post-resolve)
    if search:
        needle = search.lower()
        output = [
            t for t in output
            if any(needle in p["name"].lower() for p in t["side_a"]["players"])
            or any(needle in p["name"].lower() for p in t["side_b"]["players"])
        ]

    return {
        "trades": output,
        "leaderboard": trade_leaderboard(output),
    }


# ---------------------------------------------------------------------------
# Feature 3: Global Player Search
# ---------------------------------------------------------------------------

@router.get("/players/search")
async def search_players(response: Response, q: str = "", sport: str = "all"):
    """Search football and baseball players by name. Returns top 20 per sport."""
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    if not q or len(q) < 2:
        return {"football": [], "baseball": []}

    pattern = f"%{q}%"
    football_results = []
    baseball_results = []

    async with aiosqlite.connect(DB_PATH) as db:
        if sport in ("all", "football"):
            async with db.execute(
                "SELECT sleeper_id, name, position, team, value_sf, value_1qb "
                "FROM players WHERE name LIKE ? "
                "ORDER BY COALESCE(value_sf, value_1qb, 0) DESC LIMIT 20",
                (pattern,),
            ) as cur:
                rows = await cur.fetchall()
            for r in rows:
                football_results.append({
                    "id": r[0],
                    "name": r[1],
                    "position": r[2] or "",
                    "team": r[3] or "FA",
                    "value": r[4] or r[5] or 0,
                    "sport": "football",
                    "level": None,
                })

        if sport in ("all", "baseball"):
            # Try baseball_players table — may not exist
            try:
                async with db.execute(
                    "SELECT mlb_id, name, position, team, level "
                    "FROM baseball_players WHERE name LIKE ? LIMIT 20",
                    (pattern,),
                ) as cur:
                    rows = await cur.fetchall()
                for r in rows:
                    baseball_results.append({
                        "id": r[0],
                        "name": r[1],
                        "position": r[2] or "",
                        "team": r[3] or "",
                        "value": None,
                        "sport": "baseball",
                        "level": r[4],
                    })
            except Exception:
                pass  # table may not exist

    return {"football": football_results, "baseball": baseball_results}


# ---------------------------------------------------------------------------
# Feature: Historical Roster Value Chart
# ---------------------------------------------------------------------------

@router.get("/portfolio/value-history")
async def get_value_history(league_id: Optional[str] = None):
    """Return daily total roster value over time for Marcus's roster(s).

    If league_id is provided, returns data for that league only.
    Otherwise combines all leagues (summing Marcus's roster values per date).
    Returns [{date, total_value, player_count}, ...] ordered ascending.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        if league_id:
            async with db.execute(
                "SELECT league_id, my_roster_id, config_json FROM leagues WHERE league_id = ?",
                (league_id,),
            ) as cur:
                league_rows = await cur.fetchall()
        else:
            async with db.execute(
                "SELECT league_id, my_roster_id, config_json FROM leagues"
            ) as cur:
                league_rows = await cur.fetchall()

        if not league_rows:
            return []

        league_roster_pairs = []
        for r in league_rows:
            lid = r[0]
            config = json.loads(r[2] or "{}")
            my_rid = config.get("my_roster_id", r[1])
            league_roster_pairs.append((lid, my_rid))

        all_owned: set = set()
        league_owned: dict = {}

        for lid, my_rid in league_roster_pairs:
            async with db.execute(
                "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
                (lid, my_rid),
            ) as cur:
                row = await cur.fetchone()
            if row:
                ids = set(json.loads(row[0] or "[]"))
                league_owned[lid] = ids
                all_owned.update(ids)

        if not all_owned:
            return []

        placeholders = ",".join("?" * len(all_owned))
        async with db.execute(
            f"SELECT sleeper_id, snapshot_date, value_sf "
            f"FROM player_snapshots "
            f"WHERE sleeper_id IN ({placeholders}) "
            f"ORDER BY snapshot_date ASC",
            list(all_owned),
        ) as cur:
            snap_rows = await cur.fetchall()

    if not snap_rows:
        return []

    if league_id and league_id in league_owned:
        filter_ids = league_owned[league_id]
    else:
        filter_ids = all_owned

    date_totals: dict = {}
    for sleeper_id, snap_date, value_sf in snap_rows:
        if sleeper_id not in filter_ids:
            continue
        v = value_sf or 0
        if snap_date not in date_totals:
            date_totals[snap_date] = {"total_value": 0.0, "player_count": 0}
        date_totals[snap_date]["total_value"] += v
        date_totals[snap_date]["player_count"] += 1

    result = [
        {
            "date": date,
            "total_value": round(entry["total_value"], 2),
            "player_count": entry["player_count"],
        }
        for date, entry in sorted(date_totals.items())
    ]
    return result


# ---------------------------------------------------------------------------
# Feature: Rookie Rankings
# ---------------------------------------------------------------------------

@router.get("/players/rookies")
async def get_rookies(response: Response, season: int = 2025):
    """Return dynasty rookie rankings sorted by SF value.

    Filters by years_exp <= 1 if the column exists, otherwise falls back to
    age <= 23. Includes rank, positional rank, and rising badge.
    """
    response.headers["Cache-Control"] = PLAYER_VALUE_CACHE_CONTROL
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("PRAGMA table_info(players)") as cur:
            columns = {row[1] for row in await cur.fetchall()}

        has_years_exp = "years_exp" in columns

        if has_years_exp:
            async with db.execute(
                """
                SELECT sleeper_id, name, position, team, value_sf, age,
                       depth_chart_order, injury_status, trend_30d,
                       COALESCE(years_exp, 0) as years_exp
                FROM players
                WHERE years_exp IS NOT NULL AND years_exp <= 1
                  AND position IN ('QB','RB','WR','TE')
                ORDER BY value_sf DESC
                """,
            ) as cur:
                rows = await cur.fetchall()
        else:
            async with db.execute(
                """
                SELECT sleeper_id, name, position, team, value_sf, age,
                       depth_chart_order, injury_status, trend_30d, 0 as years_exp
                FROM players
                WHERE age <= 23
                  AND depth_chart_order IS NOT NULL
                  AND position IN ('QB','RB','WR','TE')
                ORDER BY value_sf DESC
                """,
            ) as cur:
                rows = await cur.fetchall()

        if not rows:
            async with db.execute(
                """
                SELECT sleeper_id, name, position, team, value_sf, age,
                       depth_chart_order, injury_status, trend_30d, 0 as years_exp
                FROM players
                WHERE age <= 24
                  AND position IN ('QB','RB','WR','TE')
                ORDER BY value_sf DESC
                LIMIT 60
                """,
            ) as cur:
                rows = await cur.fetchall()

    if not rows:
        return []

    pos_rank_counters: dict = {}
    result = []
    overall_rank = 0
    for r in rows:
        sleeper_id, name, position, team, value_sf, age, depth, injury, trend_30d, years_exp = r
        overall_rank += 1
        pos = position or "WR"
        pos_rank_counters[pos] = pos_rank_counters.get(pos, 0) + 1
        positional_rank = f"{pos}{pos_rank_counters[pos]}"
        is_rising = (trend_30d or 0) > 50

        result.append({
            "rank": overall_rank,
            "sleeper_id": sleeper_id,
            "name": name,
            "position": pos,
            "team": team or "FA",
            "value_sf": value_sf or 0,
            "age": age,
            "depth_chart_order": depth,
            "injury_status": injury,
            "trend_30d": trend_30d or 0,
            "positional_rank": positional_rank,
            "is_rising": is_rising,
            "years_exp": years_exp,
        })

    return result


# ---------------------------------------------------------------------------
# Feature: Mock Draft Simulator
# ---------------------------------------------------------------------------

_DRAFT_SESSIONS: dict = {}


class DraftStartRequest(BaseModel):
    format: str = "SF"
    teams: int = 12
    rounds: int = 20
    pick_position: int = 1


class DraftPickRequest(BaseModel):
    player_id: str


@router.post("/draft/start")
async def start_draft(req: DraftStartRequest):
    """Create a new mock draft session. Returns draft_id and initial state."""
    teams = max(8, min(16, req.teams))
    rounds = max(10, min(30, req.rounds))
    pick_position = max(1, min(teams, req.pick_position))
    fmt = req.format.upper()

    async with aiosqlite.connect(DB_PATH) as db:
        value_col = "value_sf" if fmt == "SF" else "value_1qb"
        async with db.execute(
            f"SELECT sleeper_id, name, position, team, value_sf, value_1qb, age, depth_chart_order, injury_status "
            f"FROM players "
            f"WHERE position IN ('QB','RB','WR','TE','K') "
            f"ORDER BY {value_col} DESC "
            f"LIMIT 500"
        ) as cur:
            player_rows = await cur.fetchall()

    players_pool = []
    for r in player_rows:
        value = (r[5] if fmt == "SF" else r[6]) or 0
        players_pool.append({
            "sleeper_id": r[0],
            "name": r[1],
            "position": r[2] or "WR",
            "team": r[3] or "FA",
            "value": value,
            "age": r[7],
            "depth_chart_order": r[8],
            "injury_status": r[9],
        })

    pick_order = []
    for rnd in range(1, rounds + 1):
        if rnd % 2 == 1:
            teams_this_round = list(range(1, teams + 1))
        else:
            teams_this_round = list(range(teams, 0, -1))
        for pick_in_round, team_idx in enumerate(teams_this_round, 1):
            overall = (rnd - 1) * teams + pick_in_round
            pick_order.append({
                "overall": overall,
                "round": rnd,
                "pick_in_round": pick_in_round,
                "team": team_idx,
                "is_marcus": team_idx == pick_position,
                "player_id": None,
                "player_name": None,
                "player_position": None,
            })

    draft_id = str(uuid.uuid4())[:8]
    _DRAFT_SESSIONS[draft_id] = {
        "draft_id": draft_id,
        "format": fmt,
        "teams": teams,
        "rounds": rounds,
        "pick_position": pick_position,
        "available": {p["sleeper_id"]: p for p in players_pool},
        "pick_order": pick_order,
        "current_pick_idx": 0,
        "marcus_roster": [],
        "ai_rosters": {t: [] for t in range(1, teams + 1) if t != pick_position},
        "completed": False,
    }

    # AI auto-picks for all picks before Marcus's first turn
    session = _DRAFT_SESSIONS[draft_id]
    _advance_ai_picks(session)

    return _get_draft_state(draft_id)


def _get_draft_state(draft_id: str) -> dict:
    session = _DRAFT_SESSIONS.get(draft_id)
    if not session:
        return {"error": "Draft session not found"}

    pick_order = session["pick_order"]
    current_idx = session["current_pick_idx"]
    total_picks = len(pick_order)

    current_pick = pick_order[current_idx] if current_idx < total_picks else None
    next_picks = pick_order[current_idx:current_idx + 8] if current_idx < total_picks else []

    available_sorted = sorted(
        session["available"].values(),
        key=lambda p: p["value"],
        reverse=True,
    )

    return {
        "draft_id": draft_id,
        "format": session["format"],
        "teams": session["teams"],
        "rounds": session["rounds"],
        "pick_position": session["pick_position"],
        "current_pick": current_pick,
        "current_pick_idx": current_idx,
        "total_picks": total_picks,
        "is_marcus_turn": current_pick["is_marcus"] if current_pick else False,
        "marcus_roster": session["marcus_roster"],
        "available_players": available_sorted[:100],
        "next_picks": next_picks,
        "completed": session["completed"],
        "completed_picks": [p for p in pick_order if p["player_id"]],
    }


def _ai_pick(session: dict, team_idx: int):
    """AI picks best available player with positional need weighting."""
    if team_idx == session["pick_position"]:
        ai_roster = session["marcus_roster"]
    else:
        ai_roster = session["ai_rosters"].get(team_idx, [])

    pos_counts = {}
    for p in ai_roster:
        pos_counts[p["position"]] = pos_counts.get(p["position"], 0) + 1

    pos_need = {
        "QB": 1.5 if pos_counts.get("QB", 0) == 0 else 0.3,
        "RB": 1.2 if pos_counts.get("RB", 0) < 3 else 0.8,
        "WR": 1.2 if pos_counts.get("WR", 0) < 4 else 0.8,
        "TE": 1.3 if pos_counts.get("TE", 0) == 0 else 0.5,
        "K": 0.1,
    }

    available = list(session["available"].values())
    if not available:
        return None

    scored = [
        (p, p["value"] * pos_need.get(p["position"], 1.0) * random.uniform(0.85, 1.0))
        for p in available
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[0][0] if scored else None


def _advance_ai_picks(session: dict):
    """Process AI picks until it is Marcus's turn or the draft ends."""
    pick_order = session["pick_order"]
    total = len(pick_order)

    while session["current_pick_idx"] < total:
        idx = session["current_pick_idx"]
        pick = pick_order[idx]

        if pick["is_marcus"]:
            break

        team_idx = pick["team"]
        player = _ai_pick(session, team_idx)
        if not player:
            session["completed"] = True
            break

        session["available"].pop(player["sleeper_id"])
        session["ai_rosters"].setdefault(team_idx, []).append(player)
        pick["player_id"] = player["sleeper_id"]
        pick["player_name"] = player["name"]
        pick["player_position"] = player["position"]
        session["current_pick_idx"] += 1

    if session["current_pick_idx"] >= total:
        session["completed"] = True


@router.get("/draft/{draft_id}/state")
async def get_draft_state(draft_id: str):
    """Return current state of a draft session."""
    if draft_id not in _DRAFT_SESSIONS:
        raise HTTPException(status_code=404, detail="Draft session not found")
    return _get_draft_state(draft_id)


@router.post("/draft/{draft_id}/pick")
async def make_pick(draft_id: str, req: DraftPickRequest):
    """Marcus makes his pick. AI picks for all other teams until Marcus's next turn."""
    if draft_id not in _DRAFT_SESSIONS:
        raise HTTPException(status_code=404, detail="Draft session not found")

    session = _DRAFT_SESSIONS[draft_id]
    if session["completed"]:
        raise HTTPException(status_code=400, detail="Draft is already completed")

    current_idx = session["current_pick_idx"]
    pick_order = session["pick_order"]
    total = len(pick_order)

    if current_idx >= total:
        session["completed"] = True
        return _get_draft_state(draft_id)

    current_pick = pick_order[current_idx]
    if not current_pick["is_marcus"]:
        raise HTTPException(status_code=400, detail="It is not Marcus's turn")

    player_id = req.player_id
    if player_id not in session["available"]:
        raise HTTPException(status_code=400, detail="Player not available")

    player = session["available"].pop(player_id)
    session["marcus_roster"].append(player)
    pick_order[current_idx]["player_id"] = player_id
    pick_order[current_idx]["player_name"] = player["name"]
    pick_order[current_idx]["player_position"] = player["position"]
    session["current_pick_idx"] += 1

    _advance_ai_picks(session)

    return _get_draft_state(draft_id)


@router.post("/draft/{draft_id}/auto-pick")
async def auto_pick(draft_id: str):
    """AI picks for Marcus at current turn (best available by position need)."""
    if draft_id not in _DRAFT_SESSIONS:
        raise HTTPException(status_code=404, detail="Draft session not found")

    session = _DRAFT_SESSIONS[draft_id]
    if session["completed"]:
        raise HTTPException(status_code=400, detail="Draft is already completed")

    current_idx = session["current_pick_idx"]
    pick_order = session["pick_order"]
    total = len(pick_order)

    if current_idx >= total:
        session["completed"] = True
        return _get_draft_state(draft_id)

    current_pick = pick_order[current_idx]
    if not current_pick["is_marcus"]:
        raise HTTPException(status_code=400, detail="Not Marcus's turn")

    player = _ai_pick(session, session["pick_position"])
    if not player:
        session["completed"] = True
        return _get_draft_state(draft_id)

    session["available"].pop(player["sleeper_id"])
    session["marcus_roster"].append(player)
    pick_order[current_idx]["player_id"] = player["sleeper_id"]
    pick_order[current_idx]["player_name"] = player["name"]
    pick_order[current_idx]["player_position"] = player["position"]
    session["current_pick_idx"] += 1

    _advance_ai_picks(session)

    return _get_draft_state(draft_id)
