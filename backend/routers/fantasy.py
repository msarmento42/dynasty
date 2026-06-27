"""Fantasy API endpoints - leagues, rosters, trade evaluation, picks."""

import asyncio
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.database import DB_PATH
from backend.scripts import daily_sync
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player, pick_value, trade_positional_impact
from backend.services.proposals import generate_proposals
from backend.services import sleeper as sleeper_svc

router = APIRouter()


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
        f"SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status "
        f"FROM players WHERE sleeper_id IN ({placeholders})",
        player_ids,
    ) as cur:
        rows = await cur.fetchall()
    players = []
    for r in rows:
        p = {
            "sleeper_id": r[0], "name": r[1], "position": r[2], "team": r[3],
            "age": r[4], "value_sf": r[5] or 0, "value_1qb": r[6] or 0,
            "trend_30d": r[7] or 0, "injury_status": r[8],
        }
        players.append(enrich_player(p, league_id))
    return players


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

    players.sort(key=lambda p: p.get("adjusted_value", 0), reverse=True)
    total = sum(p.get("adjusted_value", 0) for p in players)

    return {
        "league_id": league_id,
        "league_name": league["name"],
        "my_roster_id": my_roster_id,
        "players": players,
        "total_adjusted_value": total,
    }


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
            })

    result.sort(key=lambda r: r["total_adjusted_value"], reverse=True)
    return result


@router.post("/trade/evaluate")
async def evaluate_trade(req: TradeRequest):
    """Evaluate a proposed trade - returns values, delta, and verdict."""
    league_id = req.league_id
    cfg = LEAGUE_CONFIG.get(league_id, {})
    n_teams = cfg.get("n_teams", 12)
    current_year = datetime.now(timezone.utc).year

    async with aiosqlite.connect(DB_PATH) as db:
        side_a_players = await get_players_for_ids(db, req.side_a.player_ids, league_id)
        side_b_players = await get_players_for_ids(db, req.side_b.player_ids, league_id)

    side_a_picks = []
    for pk in req.side_a.picks:
        val = pick_value(pk.round, pk.year - current_year, n_teams)
        side_a_picks.append({"round": pk.round, "year": pk.year, "value": val})

    side_b_picks = []
    for pk in req.side_b.picks:
        val = pick_value(pk.round, pk.year - current_year, n_teams)
        side_b_picks.append({"round": pk.round, "year": pk.year, "value": val})

    side_a_value = (
        sum(p.get("adjusted_value", 0) for p in side_a_players)
        + sum(p["value"] for p in side_a_picks)
    )
    side_b_value = (
        sum(p.get("adjusted_value", 0) for p in side_b_players)
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

    return {
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
    }


@router.get("/proposals/{league_id}")
async def get_proposals(league_id: str):
    """Auto-generated ranked trade proposals for this league."""
    if league_id not in LEAGUE_CONFIG:
        raise HTTPException(status_code=404, detail=f"League {league_id} not found.")
    return await generate_proposals(league_id)


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
async def get_player_profile(player_id: str):
    """Return full dynasty profile for a single player."""
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
        "trend_30d": enriched.get("trend_30d", 0),
        "injury_status": enriched.get("injury_status"),
        "career_stage": career_stage,
        "years_in_prime_remaining": years_in_prime,
        "positional_rank": positional_rank,
        "breakout_score": breakout_score,
        "recent_stats": recent_stats,
        "comparable_players": comparable_players,
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

    return {
        "league_id": league_id,
        "recommendations": recommendations,
        "optimal_lineup": serialized_lineup,
    }


# ---------------------------------------------------------------------------
# F05: Waiver Wire Ranker
# ---------------------------------------------------------------------------

@router.get("/waiver/{league_id}")
async def get_waiver_wire(league_id: str):
    """Return top free agents not rostered in this league, sorted by dynasty value."""
    async with aiosqlite.connect(DB_PATH) as db:
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

    return {
        "league_id": league_id,
        "free_agents": free_agents,
        "total": len(free_agents),
    }


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
            # Collect all player IDs Marcus owns in this league
            async with db.execute(
                "SELECT player_ids_json FROM rosters WHERE league_id = ? AND my_roster_id IS NOT NULL "
                "UNION ALL "
                "SELECT r.player_ids_json FROM rosters r "
                "JOIN leagues l ON l.league_id = r.league_id AND l.my_roster_id = r.roster_id "
                "WHERE r.league_id = ?",
                (league_id, league_id),
            ) as cur:
                rows = await cur.fetchall()

            if rows:
                owned_ids = set()
                for row in rows:
                    ids = json.loads(row[0] or "[]")
                    owned_ids.update(ids)

            # If no roster match found, fetch all rosters for league and find Marcus's
            if not owned_ids:
                async with db.execute(
                    "SELECT l.my_roster_id, r.player_ids_json "
                    "FROM leagues l JOIN rosters r ON r.league_id = l.league_id AND r.roster_id = l.my_roster_id "
                    "WHERE l.league_id = ?",
                    (league_id,),
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    owned_ids = set(json.loads(row[1] or "[]"))

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

        value_delta = round(a_total - b_total)
        if value_delta > 500:
            verdict = "A_WON"
        elif value_delta < -500:
            verdict = "B_WON"
        else:
            verdict = "FAIR"

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
            "value_delta": value_delta,
            "verdict": verdict,
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

    return output


# ---------------------------------------------------------------------------
# Feature 3: Global Player Search
# ---------------------------------------------------------------------------

@router.get("/players/search")
async def search_players(q: str = "", sport: str = "all"):
    """Search football and baseball players by name. Returns top 20 per sport."""
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
async def get_rookies(season: int = 2025):
    """Return dynasty rookie rankings sorted by SF value.

    Filters by years_exp <= 1 if the column exists, otherwise falls back to
    age <= 23. Includes rank, positional rank, and rising badge.
    """
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
