"""Data trust validation gate for recommendation-producing endpoints.

Checks freshness, roster-count integrity, and cross-source ID-resolution
confidence for a league before a recommendation endpoint serves a response.
Never raises -- on internal error (e.g. a Phase 0 table missing), returns a
degraded result and logs to sync_log instead of a 500, per issue #270.
"""

from __future__ import annotations

from datetime import datetime, timezone

import aiosqlite

FRESHNESS_THRESHOLD_HOURS = 26
ID_CONFIDENCE_THRESHOLD = 0.8


async def _latest_snapshot(db: aiosqlite.Connection, league_id: str):
    async with db.execute(
        """
        SELECT taken_at, roster_count, expected_roster_count
        FROM league_snapshots
        WHERE league_id = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (league_id,),
    ) as cur:
        return await cur.fetchone()


async def _id_confidence_pct(db: aiosqlite.Connection) -> float:
    """Percentage of players (rostered + waiver pool, i.e. all of `players`)
    with a player_id_map match_confidence at/above ID_CONFIDENCE_THRESHOLD."""
    async with db.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN m.match_confidence >= ? THEN 1 ELSE 0 END) AS confident
        FROM players p
        LEFT JOIN player_id_map m ON m.sleeper_id = p.sleeper_id
        """,
        (ID_CONFIDENCE_THRESHOLD,),
    ) as cur:
        row = await cur.fetchone()

    if not row or not row[0]:
        return 0.0
    total, confident = row
    return round((confident or 0) / total * 100, 1)


async def _log_trust_error(db: aiosqlite.Connection, league_id: str, exc: Exception) -> None:
    try:
        await db.execute(
            "INSERT INTO sync_log (sync_type, status, message, ran_at) VALUES (?, ?, ?, ?)",
            (
                "data_trust",
                "error",
                f"check_league_trust failed for {league_id}: {exc}",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await db.commit()
    except Exception:  # noqa: BLE001 - logging must never raise
        pass


async def check_league_trust(db: aiosqlite.Connection, league_id: str) -> dict:
    """Return {"ok", "reasons", "snapshot_age_hours", "id_confidence_pct"} for a league.

    ok is False if: no snapshot exists, the latest snapshot is older than
    FRESHNESS_THRESHOLD_HOURS, roster_count != expected_roster_count on the
    latest snapshot, or id_confidence_pct is below ID_CONFIDENCE_THRESHOLD.
    """
    reasons: list[str] = []
    snapshot_age_hours = None
    id_confidence_pct = 0.0

    try:
        snapshot = await _latest_snapshot(db, league_id)
        if not snapshot:
            reasons.append("no_snapshot")
        else:
            taken_at_raw, roster_count, expected_roster_count = snapshot
            try:
                taken_at = datetime.fromisoformat(taken_at_raw)
                if taken_at.tzinfo is None:
                    taken_at = taken_at.replace(tzinfo=timezone.utc)
                snapshot_age_hours = round(
                    (datetime.now(timezone.utc) - taken_at).total_seconds() / 3600, 2
                )
            except (TypeError, ValueError):
                reasons.append("unparseable_snapshot_timestamp")
                snapshot_age_hours = None

            if snapshot_age_hours is not None and snapshot_age_hours > FRESHNESS_THRESHOLD_HOURS:
                reasons.append(f"stale_snapshot:{snapshot_age_hours}h > {FRESHNESS_THRESHOLD_HOURS}h")

            if expected_roster_count is not None and roster_count != expected_roster_count:
                reasons.append(
                    f"roster_count_mismatch:{roster_count} != expected {expected_roster_count}"
                )

        id_confidence_pct = await _id_confidence_pct(db)
        if id_confidence_pct < ID_CONFIDENCE_THRESHOLD * 100:
            reasons.append(
                f"low_id_confidence:{id_confidence_pct}% < {ID_CONFIDENCE_THRESHOLD * 100}%"
            )
    except Exception as exc:  # noqa: BLE001 - degrade, never 500 on a trust check
        reasons.append(f"trust_check_error:{exc}")
        await _log_trust_error(db, league_id, exc)

    return {
        "ok": not reasons,
        "reasons": reasons,
        "snapshot_age_hours": snapshot_age_hours,
        "id_confidence_pct": id_confidence_pct,
    }
