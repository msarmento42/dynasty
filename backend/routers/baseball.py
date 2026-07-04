"""Baseball module — MLB Stats API endpoints + manual dynasty roster management."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.database import DB_PATH
from backend.services.mlb_stats import (
    get_current_status,
    get_player,
    get_player_career,
    get_prospects,
    search_players,
)
import asyncio

from backend.services.recommendations import generate_baseball_recommendations

router = APIRouter(prefix="/api/baseball", tags=["baseball"])

VALUE_MODES = {"dynasty": "dynasty_value", "redraft": "redraft_value"}
CONTRIBUTOR_LEVELS = {"MLB", ""}


class BaseballValueUpdate(BaseModel):
    dynasty_value: Optional[int] = Field(default=None, ge=0)
    redraft_value: Optional[int] = Field(default=None, ge=0)
    redraft_rank: Optional[int] = Field(default=None, ge=1)
    value_trend: Optional[int] = None
    value_source: Optional[str] = Field(default="manual", max_length=80)


class BaseballTradeSide(BaseModel):
    player_ids: list[int] = Field(default_factory=list)


class BaseballTradeRequest(BaseModel):
    give: BaseballTradeSide = Field(default_factory=BaseballTradeSide)
    receive: BaseballTradeSide = Field(default_factory=BaseballTradeSide)
    mode: str = "dynasty"


def value_column(mode: str) -> str:
    return VALUE_MODES.get(mode, "dynasty_value")


def is_prospect(row) -> bool:
    level = row["level"] or ""
    debut_year = row["debut_year"]
    return level not in CONTRIBUTOR_LEVELS or debut_year is None


def row_value(row, mode: str) -> int | None:
    raw = row[value_column(mode)]
    if raw is None or raw <= 0:
        return None
    return int(raw)


async def ensure_baseball_value_columns(db: aiosqlite.Connection) -> None:
    """Keep existing local SQLite DBs compatible with the expanded schema."""
    existing = {
        row[1]
        for row in await (await db.execute("PRAGMA table_info(baseball_players)")).fetchall()
    }
    columns = {
        "redraft_value": "ALTER TABLE baseball_players ADD COLUMN redraft_value INTEGER DEFAULT 0",
        "redraft_rank": "ALTER TABLE baseball_players ADD COLUMN redraft_rank INTEGER",
        "value_trend": "ALTER TABLE baseball_players ADD COLUMN value_trend INTEGER DEFAULT 0",
        "value_source": "ALTER TABLE baseball_players ADD COLUMN value_source TEXT DEFAULT 'manual'",
        "value_updated_at": "ALTER TABLE baseball_players ADD COLUMN value_updated_at TEXT",
    }
    for name, statement in columns.items():
        if name not in existing:
            await db.execute(statement)
    await db.commit()


def baseball_player_payload(row, mode: str = "dynasty") -> dict:
    value = row_value(row, mode)
    missing = []
    if not row["dynasty_value"]:
        missing.append("dynasty_value")
    if not row["redraft_value"]:
        missing.append("redraft_value")
    return {
        "mlb_id": row["mlb_id"],
        "name": row["name"],
        "position": row["position"],
        "team": row["team"],
        "level": row["level"],
        "age": row["age"],
        "debut_year": row["debut_year"],
        "dynasty_value": row["dynasty_value"] or 0,
        "redraft_value": row["redraft_value"] or 0,
        "redraft_rank": row["redraft_rank"],
        "value_trend": row["value_trend"] or 0,
        "value_source": row["value_source"] or "manual",
        "value_updated_at": row["value_updated_at"],
        "selected_value": value,
        "selected_mode": mode,
        "is_prospect": is_prospect(row),
        "asset_type": "prospect" if is_prospect(row) else "mlb_contributor",
        "value_warnings": missing,
    }


def baseball_confidence(row) -> dict:
    warnings = []
    if not row["dynasty_value"]:
        warnings.append("missing manual dynasty value")
    if "redraft_value" in row.keys() and not row["redraft_value"]:
        warnings.append("missing manual redraft value")
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
        return {"player": bio, "career": career}
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
        await ensure_baseball_value_columns(db)
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT r.mlb_id, r.acquired_date, r.notes,
                   p.name, p.position, p.team, p.level, p.age, p.sport_id,
                   p.bats, p.throws, p.draft_year, p.debut_year, p.dynasty_value,
                   p.redraft_value, p.redraft_rank, p.value_trend, p.value_source,
                   p.value_updated_at, p.updated_at
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
            "redraft_value": row["redraft_value"],
            "redraft_rank": row["redraft_rank"],
            "value_trend": row["value_trend"],
            "value_source": row["value_source"],
            "value_updated_at": row["value_updated_at"],
            "acquired_date": row["acquired_date"],
            "notes": row["notes"],
            "is_prospect": is_prospect(row),
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


@router.patch("/players/{mlb_id}/values")
async def update_player_values(mlb_id: int, payload: BaseballValueUpdate):
    """Manually maintain baseball dynasty/redraft values when no free API exists."""
    fields = []
    values = []
    for field in ("dynasty_value", "redraft_value", "redraft_rank", "value_trend", "value_source"):
        value = getattr(payload, field)
        if value is not None:
            fields.append(f"{field} = ?")
            values.append(value)
    if not fields:
        raise HTTPException(status_code=400, detail="No value fields provided")

    fields.append("value_updated_at = ?")
    values.append(datetime.now(timezone.utc).isoformat())
    values.append(mlb_id)

    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_baseball_value_columns(db)
        result = await db.execute(
            f"UPDATE baseball_players SET {', '.join(fields)} WHERE mlb_id = ?",
            values,
        )
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Player {mlb_id} not found")

    return {"status": "updated", "mlb_id": mlb_id}


@router.get("/value-board")
async def get_value_board(
    mode: str = Query("dynasty", pattern="^(dynasty|redraft)$"),
    roster_name: str = "My Baseball Roster",
):
    """Roster values sorted by dynasty or redraft mode with missing-data flags."""
    order_col = value_column(mode)
    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_baseball_value_columns(db)
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(
            f"""
            SELECT r.mlb_id, p.name, p.position, p.team, p.level, p.age, p.debut_year,
                   p.dynasty_value, p.redraft_value, p.redraft_rank, p.value_trend,
                   p.value_source, p.value_updated_at
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ?
            ORDER BY COALESCE(p.{order_col}, 0) DESC, p.name
            """,
            (roster_name,),
        )).fetchall()

    players = [baseball_player_payload(row, mode) for row in rows]
    missing = [p for p in players if p["selected_value"] is None]
    return {
        "mode": mode,
        "roster_name": roster_name,
        "players": players,
        "count": len(players),
        "missing_value_count": len(missing),
        "warnings": [
            "Players with missing values are excluded from side totals and shown as warnings."
        ] if missing else [],
    }


async def load_trade_players(db: aiosqlite.Connection, player_ids: list[int], mode: str) -> list[dict]:
    if not player_ids:
        return []
    placeholders = ",".join("?" for _ in player_ids)
    rows = await (await db.execute(
        f"""
        SELECT mlb_id, name, position, team, level, age, debut_year, dynasty_value,
               redraft_value, redraft_rank, value_trend, value_source, value_updated_at
        FROM baseball_players
        WHERE mlb_id IN ({placeholders})
        """,
        player_ids,
    )).fetchall()
    by_id = {row["mlb_id"]: baseball_player_payload(row, mode) for row in rows}
    return [by_id[mlb_id] for mlb_id in player_ids if mlb_id in by_id]


def trade_side_summary(players: list[dict]) -> dict:
    valued = [p for p in players if p["selected_value"] is not None]
    missing = [p for p in players if p["selected_value"] is None]
    total = sum(p["selected_value"] for p in valued)
    return {
        "players": players,
        "total_value": total,
        "valued_count": len(valued),
        "missing_value_players": missing,
        "prospects": [p for p in players if p["is_prospect"]],
        "contributors": [p for p in players if not p["is_prospect"]],
    }


@router.post("/trade/analyze")
async def analyze_baseball_trade(payload: BaseballTradeRequest):
    mode = payload.mode if payload.mode in VALUE_MODES else "dynasty"
    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_baseball_value_columns(db)
        db.row_factory = aiosqlite.Row
        give_players = await load_trade_players(db, payload.give.player_ids, mode)
        receive_players = await load_trade_players(db, payload.receive.player_ids, mode)

    give = trade_side_summary(give_players)
    receive = trade_side_summary(receive_players)
    diff = receive["total_value"] - give["total_value"]
    missing_count = len(give["missing_value_players"]) + len(receive["missing_value_players"])
    if missing_count:
        verdict = "incomplete"
        summary = "Trade has missing value inputs; review before trusting the score."
    elif diff > 100:
        verdict = "accept"
        summary = "Incoming side has a clear value edge."
    elif diff < -100:
        verdict = "decline"
        summary = "Outgoing side carries more value."
    else:
        verdict = "balanced"
        summary = "Values are close enough to decide by roster fit."

    return {
        "mode": mode,
        "give": give,
        "receive": receive,
        "net_value": diff,
        "verdict": verdict,
        "summary": summary,
        "warnings": [
            "Missing values do not count as zero; they are omitted from totals and listed for manual review."
        ] if missing_count else [],
    }


@router.get("/trade/proposals")
async def baseball_trade_proposals(
    mode: str = Query("dynasty", pattern="^(dynasty|redraft)$"),
    strategy: str = Query("contend", pattern="^(contend|rebuild)$"),
    roster_name: str = "My Baseball Roster",
    limit: int = Query(8, ge=1, le=20),
):
    """Find baseball proposal ideas from cached players and roster assets."""
    order_col = value_column(mode)
    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_baseball_value_columns(db)
        db.row_factory = aiosqlite.Row
        roster_rows = await (await db.execute(
            f"""
            SELECT r.mlb_id, p.name, p.position, p.team, p.level, p.age, p.debut_year,
                   p.dynasty_value, p.redraft_value, p.redraft_rank, p.value_trend,
                   p.value_source, p.value_updated_at
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            WHERE r.roster_name = ?
            ORDER BY COALESCE(p.{order_col}, 0) DESC, p.name
            """,
            (roster_name,),
        )).fetchall()
        candidate_rows = await (await db.execute(
            f"""
            SELECT p.mlb_id, p.name, p.position, p.team, p.level, p.age, p.debut_year,
                   p.dynasty_value, p.redraft_value, p.redraft_rank, p.value_trend,
                   p.value_source, p.value_updated_at
            FROM baseball_players p
            WHERE COALESCE(p.{order_col}, 0) > 0
              AND p.mlb_id NOT IN (
                  SELECT mlb_id FROM baseball_rosters WHERE roster_name = ?
              )
            ORDER BY COALESCE(p.{order_col}, 0) DESC, p.name
            LIMIT ?
            """,
            (roster_name, limit * 3),
        )).fetchall()

    roster = [baseball_player_payload(row, mode) for row in roster_rows]
    candidates = [baseball_player_payload(row, mode) for row in candidate_rows]
    if strategy == "contend":
        targets = [p for p in candidates if not p["is_prospect"]]
        offers = sorted(
            [p for p in roster if p["is_prospect"]],
            key=lambda p: p["selected_value"] or 0,
            reverse=True,
        )
    else:
        targets = [p for p in candidates if p["is_prospect"]]
        offers = sorted(
            [p for p in roster if not p["is_prospect"]],
            key=lambda p: p["selected_value"] or 0,
            reverse=True,
        )

    proposals = []
    for target in targets[:limit]:
        target_value = target["selected_value"] or 0
        offer_pool = [p for p in offers if p["selected_value"] is not None]
        offer = min(offer_pool, key=lambda p: abs((p["selected_value"] or 0) - target_value), default=None)
        proposals.append({
            "target": target,
            "offer": offer,
            "strategy": strategy,
            "mode": mode,
            "value_gap": target_value - ((offer or {}).get("selected_value") or 0),
            "asset_read": (
                "MLB contributor target for a contender" if not target["is_prospect"]
                else "prospect target for a rebuild"
            ),
            "warnings": [
                "Candidate pool is cached player values, not a synced league ownership feed."
            ],
        })

    return {
        "mode": mode,
        "strategy": strategy,
        "proposals": proposals,
        "count": len(proposals),
        "data_note": "Uses cached baseball_players and manual values; ownership outside this roster is not yet synced.",
    }


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
