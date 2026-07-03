"""Data-trust validation gate for recommendation-producing endpoints.

Phase 0 of DECISION-ENGINE-PLAN.md: before a recommendation-producing
endpoint (waiver, start/sit, trade evaluate, proposals) serves a response,
check whether the data behind it is fresh, complete, and well-identified
enough to trust. If not, callers should mark the response `degraded` rather
than silently serving a confidently-wrong answer.

Two entry points:
- `check_league_trust` does the actual checks and can raise if the
  underlying tables are missing or malformed.
- `get_trust_status` is the safe wrapper routers should call: it never
  raises, and logs unexpected failures to `sync_log` instead of crashing
  the endpoint (issue #270, implementation instruction 3).
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone

import aiosqlite

# How old the latest league_snapshots row can be before we call the data stale.
SNAPSHOT_FRESHNESS_THRESHOLD_HOURS = 26

# Minimum player_id_map.match_confidence to count a player as "resolved"
# for the purposes of the ID-confidence check.
ID_CONFIDENCE_THRESHOLD = 0.8

# Positions the live waiver/roster endpoints treat as fantasy-relevant.
# Mirrors the filter in GET /waiver/{league_id}.
SKILL_POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def _parse_snapshot_age_hours(taken_at: str | None) -> float | None:
    if not taken_at:
        return None
    try:
        taken_dt = datetime.fromisoformat(taken_at)
    except ValueError:
        return None
    if taken_dt.tzinfo is None:
        taken_dt = taken_dt.replace(tzinfo=timezone.utc)
    return round((datetime.now(timezone.utc) - taken_dt).total_seconds() / 3600, 1)


async def _relevant_player_ids(db: aiosqlite.Connection, rostered_ids: set) -> set:
    """Rostered players plus the current waiver-pool candidates for this league."""
    placeholders = ",".join("?" * len(rostered_ids)) if rostered_ids else None
    if placeholders:
        query = (
            f"SELECT sleeper_id FROM players "
            f"WHERE position IN ({','.join('?' * len(SKILL_POSITIONS))}) "
            f"AND sleeper_id NOT IN ({placeholders})"
        )
        params = [*SKILL_POSITIONS, *rostered_ids]
    else:
        query = f"SELECT sleeper_id FROM players WHERE position IN ({','.join('?' * len(SKILL_POSITIONS))})"
        params = list(SKILL_POSITIONS)

    async with db.execute(query, params) as cur:
        waiver_rows = await cur.fetchall()
    waiver_ids = {str(r[0]) for r in waiver_rows}
    return rostered_ids | waiver_ids


async def check_league_trust(db: aiosqlite.Connection, league_id: str) -> dict:
    """Check freshness, roster completeness, and ID-resolution confidence.

    Returns {"ok": bool, "reasons": [...], "snapshot_age_hours": float|None,
    "id_confidence_pct": float|None}. May raise if `league_snapshots` or
    `player_id_map` don't exist yet -- callers that need graceful
    degradation on that failure mode should use `get_trust_status` instead.
    """
    reasons: list[str] = []

    async with db.execute(
        """
        SELECT taken_at, roster_count, expected_roster_count, rostered_player_ids_json
        FROM league_snapshots
        WHERE league_id = ?
        ORDER BY taken_at DESC
        LIMIT 1
        """,
        (league_id,),
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        return {
            "ok": False,
            "reasons": ["no snapshot found for this league -- run daily sync first"],
            "snapshot_age_hours": None,
            "id_confidence_pct": None,
        }

    taken_at, roster_count, expected_roster_count, rostered_ids_json = row

    snapshot_age_hours = _parse_snapshot_age_hours(taken_at)
    if snapshot_age_hours is None:
        reasons.append(f"could not parse snapshot timestamp: {taken_at!r}")
    elif snapshot_age_hours > SNAPSHOT_FRESHNESS_THRESHOLD_HOURS:
        reasons.append(
            f"snapshot is {snapshot_age_hours}h old, exceeds "
            f"{SNAPSHOT_FRESHNESS_THRESHOLD_HOURS}h freshness threshold"
        )

    if expected_roster_count is not None and roster_count != expected_roster_count:
        reasons.append(
            f"roster_count {roster_count} != expected_roster_count {expected_roster_count} "
            "-- sync may have partially failed"
        )

    try:
        rostered_ids = {str(pid) for pid in json.loads(rostered_ids_json or "[]")}
    except json.JSONDecodeError:
        rostered_ids = set()
        reasons.append("could not parse rostered_player_ids_json on latest snapshot")

    relevant_ids = await _relevant_player_ids(db, rostered_ids)

    id_confidence_pct = None
    if relevant_ids:
        placeholders = ",".join("?" * len(relevant_ids))
        async with db.execute(
            f"SELECT match_confidence FROM player_id_map WHERE sleeper_id IN ({placeholders})",
            list(relevant_ids),
        ) as cur:
            confidence_rows = await cur.fetchall()

        resolved_count = sum(
            1 for (confidence,) in confidence_rows
            if (confidence or 0.0) >= ID_CONFIDENCE_THRESHOLD
        )
        id_confidence_pct = round(100 * resolved_count / len(relevant_ids), 1)
        if id_confidence_pct < ID_CONFIDENCE_THRESHOLD * 100:
            reasons.append(
                f"only {id_confidence_pct}% of rostered/waiver-pool players resolved "
                f"above {int(ID_CONFIDENCE_THRESHOLD * 100)}% ID-match confidence"
            )

    return {
        "ok": len(reasons) == 0,
        "reasons": reasons,
        "snapshot_age_hours": snapshot_age_hours,
        "id_confidence_pct": id_confidence_pct,
    }


async def get_trust_status(db: aiosqlite.Connection, league_id: str) -> dict:
    """Safe wrapper for routers: never raises.

    If `check_league_trust` itself errors (e.g. Phase 0 migrations haven't
    run), log it to `sync_log` and treat the endpoint as degraded rather
    than letting the error 500 the request.
    """
    try:
        return await check_league_trust(db, league_id)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        try:
            await db.execute(
                "INSERT INTO sync_log (sync_type, status, message, ran_at) VALUES (?, ?, ?, ?)",
                (
                    "data_trust_check",
                    "error",
                    f"check_league_trust failed for league {league_id}: "
                    f"{exc!r}\n{traceback.format_exc(limit=3)}",
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            await db.commit()
        except Exception:  # noqa: BLE001 - logging must never itself raise
            pass
        return {
            "ok": False,
            "reasons": [f"trust check failed: {exc}"],
            "snapshot_age_hours": None,
            "id_confidence_pct": None,
        }
