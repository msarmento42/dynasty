"""Fantasy API endpoints - leagues, rosters, trade evaluation, picks."""

import asyncio
import json
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
            "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status, depth_chart_order "
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
        value_col = "value_sf" if (league_id and LEAGUE_CONFIG.get(league_id, {}).get("base_format") == "sf") else "value_1qb"
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
        league = await get_league_row(db, league_id)

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
