"""League state snapshot helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import aiosqlite


NON_ROSTER_POSITIONS = {"TAXI", "IR"}


async def _rostered_player_ids(db: aiosqlite.Connection, league_id: str) -> list[str]:
    async with db.execute(
        "SELECT player_ids_json FROM rosters WHERE league_id=?",
        (league_id,),
    ) as cur:
        rows = await cur.fetchall()

    player_ids = set()
    for (player_ids_json,) in rows:
        try:
            roster_ids = json.loads(player_ids_json or "[]")
        except json.JSONDecodeError:
            roster_ids = []
        player_ids.update(str(player_id) for player_id in roster_ids if player_id)
    return sorted(player_ids)


async def _expected_roster_count(db: aiosqlite.Connection, league_id: str, observed_count: int) -> int:
    async with db.execute(
        """
        SELECT ls.raw_json, l.n_teams
        FROM leagues l
        LEFT JOIN league_settings ls ON ls.league_id = l.league_id
        WHERE l.league_id=?
        """,
        (league_id,),
    ) as cur:
        row = await cur.fetchone()

    if not row:
        return observed_count

    raw_json, n_teams = row
    try:
        settings = json.loads(raw_json or "{}")
    except json.JSONDecodeError:
        settings = {}

    roster_positions = settings.get("roster_positions") if isinstance(settings, dict) else []
    if isinstance(roster_positions, list) and roster_positions and n_teams:
        roster_slots = [
            position
            for position in roster_positions
            if str(position).upper() not in NON_ROSTER_POSITIONS
        ]
        return int(n_teams) * len(roster_slots)

    return observed_count


async def _waiver_pool_count(db: aiosqlite.Connection, rostered_ids: list[str]) -> int:
    if not rostered_ids:
        async with db.execute("SELECT COUNT(*) FROM players") as cur:
            row = await cur.fetchone()
        return int(row[0] or 0) if row else 0

    placeholders = ",".join("?" * len(rostered_ids))
    async with db.execute(
        f"SELECT COUNT(*) FROM players WHERE sleeper_id NOT IN ({placeholders})",
        rostered_ids,
    ) as cur:
        row = await cur.fetchone()
    return int(row[0] or 0) if row else 0


async def take_snapshot(
    db: aiosqlite.Connection,
    league_id: str,
    source_sync_id: int | None = None,
) -> int:
    """Store full roster and waiver-pool state for a league."""
    rostered_ids = await _rostered_player_ids(db, league_id)
    roster_count = len(rostered_ids)
    expected_roster_count = await _expected_roster_count(db, league_id, roster_count)
    waiver_pool_count = await _waiver_pool_count(db, rostered_ids)
    taken_at = datetime.now(timezone.utc).isoformat()

    cur = await db.execute(
        """
        INSERT INTO league_snapshots
            (league_id, taken_at, roster_count, expected_roster_count,
             waiver_pool_count, rostered_player_ids_json, source_sync_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            league_id,
            taken_at,
            roster_count,
            expected_roster_count,
            waiver_pool_count,
            json.dumps(rostered_ids),
            source_sync_id,
        ),
    )
    await db.commit()
    return int(cur.lastrowid)
