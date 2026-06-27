"""Draft pick value calculator — converts dynasty picks to KTC-equivalent values."""

from datetime import datetime
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter
from pydantic import BaseModel

from backend.database import DB_PATH
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player

router = APIRouter()

# Static FantasyCalc-inspired pick values (KTC-equivalent points).
# 2025 values are per-pick-slot (1.01–1.12); future years use early/mid/late tiers.
PICK_VALUES = {
    "2025": {
        "1.01": 9500, "1.02": 8200, "1.03": 7100, "1.04": 6300,
        "1.05": 5800, "1.06": 5400, "1.07": 4900, "1.08": 4500,
        "1.09": 4100, "1.10": 3800, "1.11": 3500, "1.12": 3200,
        "2nd": 2000, "3rd": 800, "4th": 200,
    },
    "2026": {
        "1st_early": 7200, "1st_mid": 5600, "1st_late": 3800,
        "2nd": 1600, "3rd": 600, "4th": 150,
    },
    "2027": {
        "1st_early": 5800, "1st_mid": 4400, "1st_late": 3000,
        "2nd": 1200, "3rd": 450, "4th": 100,
    },
    "2028": {
        "1st_early": 4500, "1st_mid": 3400, "1st_late": 2200,
        "2nd": 900, "3rd": 300, "4th": 75,
    },
}

# Human-readable labels for display
PICK_LABELS = {
    "1.01": "1st Round (1.01)", "1.02": "1st Round (1.02)", "1.03": "1st Round (1.03)",
    "1.04": "1st Round (1.04)", "1.05": "1st Round (1.05)", "1.06": "1st Round (1.06)",
    "1.07": "1st Round (1.07)", "1.08": "1st Round (1.08)", "1.09": "1st Round (1.09)",
    "1.10": "1st Round (1.10)", "1.11": "1st Round (1.11)", "1.12": "1st Round (1.12)",
    "2nd": "2nd Round", "3rd": "3rd Round", "4th": "4th Round",
    "1st_early": "1st Round (Early)", "1st_mid": "1st Round (Mid)", "1st_late": "1st Round (Late)",
}


class PickItem(BaseModel):
    year: str
    round: str  # e.g. "1.01", "1st_early", "2nd"


class PlayerItem(BaseModel):
    player_id: str


class TradeSideItem(BaseModel):
    picks: List[PickItem] = []
    player_ids: List[str] = []


class CompareRequest(BaseModel):
    side_a: TradeSideItem
    side_b: TradeSideItem
    league_id: Optional[str] = None


@router.get("/values")
async def get_pick_values():
    """Return current pick market values for rounds 1–4, years 2025–2028."""
    current_year = str(datetime.now().year)
    return {
        "pick_values": PICK_VALUES,
        "current_year": current_year,
        "pick_labels": PICK_LABELS,
    }


async def resolve_player_value(db: aiosqlite.Connection, player_id: str, league_id: Optional[str]) -> dict:
    """Fetch a player from the DB and return enriched value."""
    async with db.execute(
        "SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status "
        "FROM players WHERE sleeper_id = ?",
        (player_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return {"player_id": player_id, "name": "Unknown", "value": 0}

    p = {
        "sleeper_id": row[0], "name": row[1], "position": row[2], "team": row[3],
        "age": row[4], "value_sf": row[5] or 0, "value_1qb": row[6] or 0,
        "trend_30d": row[7] or 0, "injury_status": row[8],
    }
    lid = league_id or (next(iter(LEAGUE_CONFIG)) if LEAGUE_CONFIG else "")
    enriched = enrich_player(p, lid)
    return {
        "player_id": player_id,
        "name": enriched["name"],
        "position": enriched.get("position", ""),
        "team": enriched.get("team", ""),
        "value": enriched.get("adjusted_value", 0),
    }


def resolve_pick_value(pick: PickItem) -> dict:
    year_values = PICK_VALUES.get(pick.year, {})
    value = year_values.get(pick.round, 0)
    label = PICK_LABELS.get(pick.round, pick.round)
    return {
        "year": pick.year,
        "round": pick.round,
        "label": f"{pick.year} {label}",
        "value": value,
    }


@router.post("/compare")
async def compare_picks(req: CompareRequest):
    """
    Compare two trade sides containing picks and/or players.
    Returns value totals for each side and the winner.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        # Resolve side A
        side_a_items = []
        for pick in req.side_a.picks:
            side_a_items.append(resolve_pick_value(pick))
        for pid in req.side_a.player_ids:
            side_a_items.append(await resolve_player_value(db, pid, req.league_id))

        # Resolve side B
        side_b_items = []
        for pick in req.side_b.picks:
            side_b_items.append(resolve_pick_value(pick))
        for pid in req.side_b.player_ids:
            side_b_items.append(await resolve_player_value(db, pid, req.league_id))

    side_a_total = sum(item["value"] for item in side_a_items)
    side_b_total = sum(item["value"] for item in side_b_items)
    delta = side_a_total - side_b_total

    if side_a_total == 0 and side_b_total == 0:
        winner = "even"
    elif abs(delta) < max(side_a_total, side_b_total) * 0.05:
        winner = "even"
    elif delta > 0:
        winner = "side_a"
    else:
        winner = "side_b"

    return {
        "side_a_total": side_a_total,
        "side_b_total": side_b_total,
        "side_a_items": side_a_items,
        "side_b_items": side_b_items,
        "delta": delta,
        "delta_pct": round(abs(delta) / max(side_a_total, side_b_total, 1) * 100, 1),
        "winner": winner,
    }


@router.get("/players/search")
async def search_players(q: str = "", limit: int = 20):
    """Search players by name for the pick calculator autocomplete."""
    if not q or len(q) < 2:
        return {"players": []}

    pattern = f"%{q}%"
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT sleeper_id, name, position, team, value_sf, value_1qb "
            "FROM players WHERE name LIKE ? ORDER BY value_sf DESC LIMIT ?",
            (pattern, limit),
        ) as cur:
            rows = await cur.fetchall()

    players = []
    for r in rows:
        value = r[4] or r[5] or 0
        players.append({
            "sleeper_id": r[0],
            "name": r[1],
            "position": r[2] or "",
            "team": r[3] or "",
            "value": value,
        })
    return {"players": players}
