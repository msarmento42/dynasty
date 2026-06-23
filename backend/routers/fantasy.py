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
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player, pick_value
from backend.services.fantasycalc import fetch_rookie_rankings
from backend.services.proposals import generate_proposals
from backend.services.roster_grade import grade_roster

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


@router.get("/rookies")
async def get_rookies(num_qbs: int = 2):
    """Return rookie-only dynasty rankings enriched with career context."""
    if num_qbs not in (1, 2):
        raise HTTPException(status_code=400, detail="num_qbs must be 1 or 2.")

    raw_players = await fetch_rookie_rankings(num_qbs=num_qbs)
    league_id = "1330499939976880128"
    enriched = []
    for player in raw_players:
        value = player.get("value", 0)
        normalized = {
            "sleeper_id": player.get("sleeper_id"),
            "name": player.get("name"),
            "position": player.get("position"),
            "team": player.get("team"),
            "age": player.get("age"),
            "value_sf": value,
            "value_1qb": value,
            "trend_30d": player.get("trend_30d", 0),
            "rank": player.get("rank", 0),
            "pos_rank": player.get("pos_rank", 0),
        }
        enriched.append(enrich_player(normalized, league_id))

    enriched.sort(key=lambda player: player.get("adjusted_value", 0), reverse=True)
    for index, player in enumerate(enriched, start=1):
        player["rookie_rank"] = index
        player["format"] = "SF" if num_qbs == 2 else "1QB"
    return enriched


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


@router.get("/league/{league_id}/grades")
async def get_roster_grades(league_id: str):
    """Return roster grades for every team in a league."""
    current_year = datetime.now(timezone.utc).year

    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
        n_teams = league.get("n_teams") or LEAGUE_CONFIG.get(league_id, {}).get("n_teams", 12)

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        if not roster_rows:
            raise HTTPException(status_code=404, detail="Rosters not found. Run daily sync first.")

        picks_by_roster = {}
        async with db.execute(
            "SELECT season, round, original_owner_id, current_owner_id FROM picks WHERE league_id=?",
            (league_id,),
        ) as cur:
            pick_rows = await cur.fetchall()

        for season, round_number, original_owner_id, current_owner_id in pick_rows:
            owner_id = current_owner_id or original_owner_id
            years_away = int(season or current_year) - current_year
            value = pick_value(int(round_number or 0), years_away, int(n_teams or 12))
            picks_by_roster.setdefault(owner_id, []).append({
                "season": season,
                "round": round_number,
                "original_owner_id": original_owner_id,
                "current_owner_id": current_owner_id,
                "value": value,
            })

        grades = []
        for roster_id, owner, player_ids_json in roster_rows:
            player_ids = json.loads(player_ids_json or "[]")
            players = await get_players_for_ids(db, player_ids, league_id)
            picks = picks_by_roster.get(roster_id, [])
            grade = grade_roster(players, picks, league_id)
            grades.append({
                "league_id": league_id,
                "roster_id": roster_id,
                "owner": owner or f"Team {roster_id}",
                "is_mine": roster_id == my_roster_id,
                "player_count": len(players),
                "pick_count": len(picks),
                **grade,
            })

    grades.sort(key=lambda item: item["score"], reverse=True)
    return grades


@router.get("/league/{league_id}/power-rankings")
async def get_power_rankings(league_id: str):
    """Rank every team by player value plus current pick capital."""
    current_year = datetime.now(timezone.utc).year

    async with aiosqlite.connect(DB_PATH) as db:
        league = await get_league_row(db, league_id)
        my_roster_id = league["config"].get("my_roster_id", league["my_roster_id"])
        n_teams = league.get("n_teams") or LEAGUE_CONFIG.get(league_id, {}).get("n_teams", 12)

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id=? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        if not roster_rows:
            raise HTTPException(status_code=404, detail="Rosters not found. Run daily sync first.")

        picks_by_roster = {}
        async with db.execute(
            "SELECT season, round, original_owner_id, current_owner_id FROM picks WHERE league_id=?",
            (league_id,),
        ) as cur:
            pick_rows = await cur.fetchall()

        for season, round_number, original_owner_id, current_owner_id in pick_rows:
            owner_id = current_owner_id or original_owner_id
            years_away = int(season or current_year) - current_year
            value = pick_value(int(round_number or 0), years_away, int(n_teams or 12))
            picks_by_roster.setdefault(owner_id, []).append(value)

        rankings = []
        for roster_id, owner, player_ids_json in roster_rows:
            player_ids = json.loads(player_ids_json or "[]")
            players = await get_players_for_ids(db, player_ids, league_id)
            players.sort(key=lambda player: player.get("adjusted_value", 0), reverse=True)

            player_value = sum(player.get("adjusted_value", 0) for player in players)
            starter_value = sum(player.get("adjusted_value", 0) for player in players[:15])
            bench_value = player_value - starter_value
            pick_value_total = sum(picks_by_roster.get(roster_id, []))
            total_value = player_value + pick_value_total

            rankings.append({
                "league_id": league_id,
                "roster_id": roster_id,
                "owner_display_name": owner or f"Team {roster_id}",
                "is_mine": roster_id == my_roster_id,
                "total_value": total_value,
                "starter_value": starter_value,
                "bench_value": bench_value,
                "pick_value": pick_value_total,
                "player_count": len(players),
                "pick_count": len(picks_by_roster.get(roster_id, [])),
            })

    rankings.sort(key=lambda team: team["total_value"], reverse=True)
    leader_value = rankings[0]["total_value"] if rankings else 0
    for index, team in enumerate(rankings, start=1):
        team["rank"] = index
        team["delta_from_1"] = team["total_value"] - leader_value

    return rankings


@router.get("/portfolio")
async def get_portfolio():
    """Return the configured user's roster portfolio across every synced league."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT league_id, name, n_teams, format, my_roster_id, config_json "
            "FROM leagues ORDER BY name"
        ) as cur:
            league_rows = await cur.fetchall()

        if not league_rows:
            raise HTTPException(status_code=404, detail="Leagues not found. Run daily sync first.")

        leagues = []
        player_ownership = {}
        positional_breakdown = {}
        total_adjusted_value = 0

        for league_row in league_rows:
            league_id = league_row[0]
            league_config = json.loads(league_row[5] or "{}")
            my_roster_id = league_config.get("my_roster_id", league_row[4])

            async with db.execute(
                "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
                (league_id, my_roster_id),
            ) as cur:
                roster_row = await cur.fetchone()

            player_ids = json.loads((roster_row[0] if roster_row else None) or "[]")
            players = await get_players_for_ids(db, player_ids, league_id)
            players.sort(key=lambda player: player.get("adjusted_value", 0), reverse=True)
            league_total = sum(player.get("adjusted_value", 0) for player in players)
            total_adjusted_value += league_total

            for player in players:
                sleeper_id = player.get("sleeper_id")
                if sleeper_id:
                    player_ownership.setdefault(sleeper_id, {
                        "sleeper_id": sleeper_id,
                        "name": player.get("name"),
                        "position": player.get("position"),
                        "team": player.get("team"),
                        "adjusted_value": player.get("adjusted_value", 0),
                        "leagues": [],
                    })["leagues"].append({
                        "league_id": league_id,
                        "league_name": league_row[1],
                    })

                position = player.get("position") or "Other"
                position_stats = positional_breakdown.setdefault(position, {"count": 0, "value": 0})
                position_stats["count"] += 1
                position_stats["value"] += player.get("adjusted_value", 0)

            leagues.append({
                "league_id": league_id,
                "league_name": league_row[1],
                "format": league_row[3],
                "my_roster_id": my_roster_id,
                "total_adjusted_value": league_total,
                "players": players,
            })

    concentrated_ids = {
        sleeper_id
        for sleeper_id, ownership in player_ownership.items()
        if len(ownership["leagues"]) >= 2
    }

    for league in leagues:
        for player in league["players"]:
            ownership = player_ownership.get(player.get("sleeper_id"), {"leagues": []})
            player["concentrated"] = player.get("sleeper_id") in concentrated_ids
            player["owned_leagues"] = ownership["leagues"]

    concentrated_players = [
        ownership
        for ownership in player_ownership.values()
        if len(ownership["leagues"]) >= 2
    ]
    concentrated_players.sort(key=lambda player: player.get("adjusted_value", 0), reverse=True)

    return {
        "leagues": leagues,
        "stats": {
            "total_unique_players": len(player_ownership),
            "concentration_risk_players": len(concentrated_players),
            "total_adjusted_value": total_adjusted_value,
            "positional_breakdown": positional_breakdown,
        },
        "concentrated_players": concentrated_players,
    }


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
async def get_trade_history_legacy(league_id: str):
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


@router.get("/league/{league_id}/trade-history")
async def get_trade_history(league_id: str, limit: int = 50):
    """Return chronological trade history for a league with player names resolved."""
    async with aiosqlite.connect(DB_PATH) as db:
        await get_league_row(db, league_id)

        # Build roster_id → owner name map
        async with db.execute(
            "SELECT roster_id, owner_display_name FROM rosters WHERE league_id = ?",
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()
        roster_owners = {row[0]: (row[1] or f"Team {row[0]}") for row in rows}

        # Fetch trades newest-first
        async with db.execute(
            """SELECT transaction_id, week, season,
                      side_a_roster_id, side_b_roster_id,
                      side_a_player_ids_json, side_b_player_ids_json,
                      side_a_pick_ids_json, side_b_pick_ids_json,
                      side_a_total_value, side_b_total_value, created_at
               FROM trade_history
               WHERE league_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (league_id, limit),
        ) as cur:
            trades = await cur.fetchall()

        async def resolve_players(player_ids: list) -> list:
            result = []
            for pid in player_ids:
                async with db.execute(
                    "SELECT name, position FROM players WHERE sleeper_id = ?",
                    (str(pid),),
                ) as c2:
                    row = await c2.fetchone()
                if row:
                    result.append({"name": row[0], "position": row[1]})
                else:
                    result.append({"name": str(pid), "position": None})
            return result

        results = []
        for t in trades:
            (txn_id, week, season, a_rid, b_rid,
             a_players_json, b_players_json,
             a_picks_json, b_picks_json,
             a_val, b_val, created_at) = t

            a_player_ids = json.loads(a_players_json or "[]")
            b_player_ids = json.loads(b_players_json or "[]")
            a_picks = json.loads(a_picks_json or "[]")
            b_picks = json.loads(b_picks_json or "[]")

            a_players = await resolve_players(a_player_ids)
            b_players = await resolve_players(b_player_ids)

            a_val = a_val or 0
            b_val = b_val or 0
            delta = a_val - b_val
            threshold = max(a_val, b_val, 1) * 0.10

            if delta > threshold:
                winner = "side_a"
            elif delta < -threshold:
                winner = "side_b"
            else:
                winner = "fair"

            results.append({
                "trade_id": txn_id,
                "traded_at": created_at,
                "week": week,
                "season": season,
                "side_a": {
                    "owner": roster_owners.get(a_rid, f"Team {a_rid}"),
                    "roster_id": a_rid,
                    "players": a_players,
                    "picks": a_picks,
                    "total_value": a_val,
                },
                "side_b": {
                    "owner": roster_owners.get(b_rid, f"Team {b_rid}"),
                    "roster_id": b_rid,
                    "players": b_players,
                    "picks": b_picks,
                    "total_value": b_val,
                },
                "value_delta": delta,
                "winner": winner,
            })

    return {"league_id": league_id, "trades": results}
