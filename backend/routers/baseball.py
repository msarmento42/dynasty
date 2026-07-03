"""Baseball module — MLB Stats API endpoints + manual dynasty roster management."""
from __future__ import annotations

from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, HTTPException, Query

from backend.database import DB_PATH
from backend.services.mlb_stats import (
    get_current_status,
    get_player,
    get_player_career,
    get_prospects,
    search_players,
)
import asyncio

from backend.services.player_intelligence import baseball_intelligence
from backend.services.recommendations import generate_baseball_recommendations

router = APIRouter(prefix="/api/baseball", tags=["baseball"])


def baseball_confidence(row) -> dict:
    warnings = []
    if not row["dynasty_value"]:
        warnings.append("missing manual dynasty value")
    if not row["updated_at"]:
        warnings.append("missing MLB cache timestamp")

    if not warnings:
        level = "high"
        label = "Fresh"
    elif row["dynasty_value"]:
        level = "medium"
        label = "Review"
    else:
        level = "low"
        label = "Low trust"

    return {
        "level": level,
        "label": label,
        "source": "MLB Stats API + manual values",
        "updated_at": row["updated_at"],
        "warnings": warnings,
    }


@router.get("/recommendations")
async def get_baseball_recommendations(limit: int = Query(8, ge=1, le=24)):
    """Return unified baseball recommendations for dashboard cards."""
    return await generate_baseball_recommendations(limit=limit)


# ---------------------------------------------------------------------------
# Player search & profiles
# ---------------------------------------------------------------------------

@router.get("/players/search")
async def search_baseball_players(q: str = Query("", min_length=0), limit: int = 20):
    """Search MLB/MiLB player universe by name."""
    if not q or len(q) < 2:
        return {"players": [], "query": q}
    try:
        players = await search_players(q, limit=limit)
        return {"players": players, "query": q, "count": len(players)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MLB API error: {exc}") from exc


@router.get("/players/{mlb_id}")
async def get_baseball_player(mlb_id: int):
    """Full player profile: bio + career stats by level."""
    try:
        bio = await get_player(mlb_id)
        if not bio:
            raise HTTPException(status_code=404, detail=f"Player {mlb_id} not found")
        career = await get_player_career(mlb_id)
        async with aiosqlite.connect(DB_PATH) as db:
            source_intelligence = await baseball_intelligence(db, mlb_id)
        return {"player": bio, "career": career, "source_intelligence": source_intelligence}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MLB API error: {exc}") from exc


# ---------------------------------------------------------------------------
# Prospects
# ---------------------------------------------------------------------------

@router.get("/prospects")
async def get_prospect_list(limit: int = Query(200, ge=1, le=1000)):
    """All active minor leaguers sorted by level (AAA first)."""
    try:
        prospects = await get_prospects(limit=limit)
        return {"prospects": prospects, "count": len(prospects)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MLB API error: {exc}") from exc


# ---------------------------------------------------------------------------
# Dynasty Roster (manually managed)
# ---------------------------------------------------------------------------

@router.get("/roster")
async def get_baseball_roster(roster_name: str = "My Baseball Roster"):
    """Get Marcus's manually managed baseball dynasty roster."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT r.mlb_id, r.acquired_date, r.notes,
                   p.name, p.position, p.team, p.level, p.age, p.sport_id,
                   p.bats, p.throws, p.draft_year, p.debut_year, p.dynasty_value,
                   p.updated_at
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ?
            ORDER BY p.position, p.name
            """,
            (roster_name,),
        ) as cur:
            rows = await cur.fetchall()

    players = []
    for row in rows:
        players.append({
            "mlb_id": row["mlb_id"],
            "name": row["name"],
            "position": row["position"],
            "team": row["team"],
            "level": row["level"],
            "age": row["age"],
            "bats": row["bats"],
            "throws": row["throws"],
            "draft_year": row["draft_year"],
            "debut_year": row["debut_year"],
            "dynasty_value": row["dynasty_value"],
            "acquired_date": row["acquired_date"],
            "notes": row["notes"],
            "data_confidence": baseball_confidence(row),
        })

    levels = [p["data_confidence"]["level"] for p in players]
    summary_level = "low" if "low" in levels else ("medium" if "medium" in levels else "high")
    return {
        "roster_name": roster_name,
        "players": players,
        "count": len(players),
        "data_confidence": {"level": summary_level, "label": summary_level.title()},
    }


@router.post("/roster/{mlb_id}")
async def add_to_roster(mlb_id: int, roster_name: str = "My Baseball Roster", notes: str = ""):
    """Add a player to the baseball dynasty roster. Fetches bio from MLB API."""
    # Fetch player info and cache in baseball_players
    try:
        bio = await get_player(mlb_id)
        if not bio:
            raise HTTPException(status_code=404, detail=f"Player {mlb_id} not found in MLB API")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MLB API error: {exc}") from exc

    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        # Upsert player bio into baseball_players cache
        await db.execute(
            """
            INSERT INTO baseball_players
                (mlb_id, name, position, team, team_id, level, sport_id, age,
                 birth_date, bats, throws, draft_year, debut_year, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(mlb_id) DO UPDATE SET
                name=excluded.name, position=excluded.position,
                team=excluded.team, team_id=excluded.team_id,
                level=excluded.level, sport_id=excluded.sport_id,
                age=excluded.age, birth_date=excluded.birth_date,
                bats=excluded.bats, throws=excluded.throws,
                draft_year=excluded.draft_year, debut_year=excluded.debut_year,
                updated_at=excluded.updated_at
            """,
            (
                bio["mlb_id"], bio["name"], bio["position"], bio["team"],
                bio.get("team_id"), bio["level"], bio.get("sport_id", 1),
                bio.get("age"), bio.get("birth_date", ""),
                bio.get("bats", ""), bio.get("throws", ""),
                bio.get("draft_year"), bio.get("debut_year"), now,
            ),
        )
        # Add to roster
        try:
            await db.execute(
                """
                INSERT INTO baseball_rosters (roster_name, mlb_id, acquired_date, notes)
                VALUES (?, ?, ?, ?)
                """,
                (roster_name, mlb_id, now[:10], notes),
            )
        except aiosqlite.IntegrityError:
            raise HTTPException(status_code=409, detail=f"Player {mlb_id} already on roster '{roster_name}'")
        await db.commit()

    return {"status": "added", "mlb_id": mlb_id, "name": bio["name"], "roster_name": roster_name}


@router.delete("/roster/{mlb_id}")
async def remove_from_roster(mlb_id: int, roster_name: str = "My Baseball Roster"):
    """Remove a player from the baseball dynasty roster."""
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute(
            "DELETE FROM baseball_rosters WHERE roster_name = ? AND mlb_id = ?",
            (roster_name, mlb_id),
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Player {mlb_id} not found on roster '{roster_name}'")

    return {"status": "removed", "mlb_id": mlb_id, "roster_name": roster_name}


@router.patch("/roster/{mlb_id}/notes")
async def update_roster_notes(mlb_id: int, notes: str, roster_name: str = "My Baseball Roster"):
    """Update notes for a player on the roster."""
    async with aiosqlite.connect(DB_PATH) as db:
        result = await db.execute(
            "UPDATE baseball_rosters SET notes = ? WHERE roster_name = ? AND mlb_id = ?",
            (notes, roster_name, mlb_id),
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Player {mlb_id} not on roster '{roster_name}'")

    return {"status": "updated", "mlb_id": mlb_id, "notes": notes}


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Weekly roster assistant (#188)
#
# IL Monitor now uses real MLB Stats API data (injury_status column, kept
# fresh via POST /roster/refresh-injury-status). Call that endpoint before
# reading this one if injury_status_updated_at looks stale.
#
# FAAB targets are still NOT implemented: baseball_rosters only tracks
# Marcus's OWN roster, not a synced view of the full league, so there's no
# way to distinguish a free agent from a player owned by someone else. This
# needs a real fantasy-platform integration before it can be built honestly.
# ---------------------------------------------------------------------------

@router.get("/weekly-assistant")
async def weekly_assistant(roster_name: str = "My Baseball Roster"):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(
            """
            SELECT r.mlb_id, p.name, p.position, p.team, p.dynasty_value
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ? AND p.position IN ('SP', 'RP')
            ORDER BY p.dynasty_value DESC
            """,
            (roster_name,),
        )).fetchall()

        il_rows = await (await db.execute(
            """
            SELECT r.mlb_id, p.name, p.position, p.team, p.injury_status, p.injury_status_updated_at
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ?
              AND p.injury_status IS NOT NULL
              AND p.injury_status NOT IN ('Active', 'Unknown')
            ORDER BY p.injury_status_updated_at DESC
            """,
            (roster_name,),
        )).fetchall()

        staleness_row = await (await db.execute(
            """
            SELECT MIN(p.injury_status_updated_at) AS oldest
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ?
            """,
            (roster_name,),
        )).fetchone()

    pitchers = [dict(r) for r in rows]
    start_candidates = pitchers[: max(1, len(pitchers) // 2)] if pitchers else []
    stream_watch = pitchers[max(1, len(pitchers) // 2):] if pitchers else []
    il_players = [dict(r) for r in il_rows]

    return {
        "roster_name": roster_name,
        "start_sit": {
            "start": start_candidates,
            "bench_or_stream": stream_watch,
            "ranking_basis": "dynasty_value (no per-start matchup/ERA data source available yet)",
        },
        "il_monitor": {
            "available": True,
            "players": il_players,
            "data_freshness": staleness_row["oldest"] if staleness_row else None,
            "note": "Call POST /api/baseball/roster/refresh-injury-status first if this looks stale.",
        },
        "faab_targets": {
            "available": False,
            "reason": (
                "baseball_rosters only tracks the user's own roster, not a full league sync, "
                "so free agents can't be distinguished from owned players yet"
            ),
        },
    }


@router.post("/roster/refresh-injury-status")
async def refresh_injury_status(roster_name: str = "My Baseball Roster"):
    """Fetch current MLB roster status for every player on this roster and
    persist it to baseball_players.injury_status. Real data from MLB Stats
    API (rosterEntries hydrate) — not fabricated. Run this before checking
    the weekly assistant's IL Monitor for fresh results.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(
            "SELECT mlb_id FROM baseball_rosters WHERE roster_name = ?", (roster_name,)
        )).fetchall()
        mlb_ids = [r["mlb_id"] for r in rows]

        async def fetch_one(mlb_id):
            try:
                status = await get_current_status(mlb_id)
                return mlb_id, status
            except Exception as e:
                return mlb_id, {
                    "status_code": None,
                    "status_description": f"lookup failed: {e}",
                    "is_active_roster": None,
                }

        results = await asyncio.gather(*(fetch_one(mid) for mid in mlb_ids))

        now = datetime.now(timezone.utc).isoformat()
        for mlb_id, status in results:
            await db.execute(
                "UPDATE baseball_players SET injury_status = ?, injury_status_updated_at = ? WHERE mlb_id = ?",
                (status["status_description"], now, mlb_id),
            )
        await db.commit()

    return {
        "roster_name": roster_name,
        "players_checked": len(mlb_ids),
        "statuses": {mlb_id: status["status_description"] for mlb_id, status in results},
    }
