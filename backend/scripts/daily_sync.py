"""Daily fantasy data sync - pulls FantasyCalc + Sleeper into SQLite."""

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import aiosqlite

from backend.services import fantasycalc, sleeper, trade_history
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player
from backend.services.sleeper import LEAGUES


DB_PATH = "backend/fantasy.db"


async def upsert_players(db: aiosqlite.Connection, players: list[dict]) -> int:
    """Upsert players from FantasyCalc into players table."""
    count = 0
    for p in players:
        sid = p.get("sleeper_id")
        if not sid:
            continue
        await db.execute(
            """
            INSERT INTO players
                (sleeper_id, name, position, team, age, value_sf, value_1qb,
                 trend_30d, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sleeper_id) DO UPDATE SET
                name=excluded.name, position=excluded.position,
                team=excluded.team, age=excluded.age,
                value_sf=excluded.value_sf, value_1qb=excluded.value_1qb,
                trend_30d=excluded.trend_30d, updated_at=excluded.updated_at
            """,
            (
                sid, p.get("name"), p.get("position"), p.get("team"),
                p.get("age"), p.get("value"), 0,
                p.get("trend_30d", 0), datetime.now(timezone.utc).isoformat(),
            ),
        )
        count += 1
    await db.commit()
    return count


async def upsert_1qb_values(db: aiosqlite.Connection, players: list[dict]) -> None:
    """Patch value_1qb onto already-upserted players."""
    for p in players:
        sid = p.get("sleeper_id")
        if not sid:
            continue
        await db.execute(
            "UPDATE players SET value_1qb=? WHERE sleeper_id=?",
            (p.get("value", 0), sid),
        )
    await db.commit()


async def sync_league(db: aiosqlite.Connection, league_id: str, config: dict) -> None:
    """Sync one league: upsert league row, rosters, and traded picks."""
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """
        INSERT INTO leagues (league_id, name, n_teams, format, my_roster_id, config_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(league_id) DO UPDATE SET
            name=excluded.name, n_teams=excluded.n_teams,
            format=excluded.format, my_roster_id=excluded.my_roster_id,
            config_json=excluded.config_json
        """,
        (
            league_id,
            config["name"],
            config["n_teams"],
            config["base_format"].upper(),
            LEAGUES.get(league_id, {}).get("my_roster_id", 1),
            json.dumps(config),
        ),
    )

    users = await sleeper.fetch_league_users(league_id)

    rosters = await sleeper.fetch_rosters(league_id)
    for roster in rosters:
        roster_id = roster.get("roster_id")
        owner_id = roster.get("owner_id", "")
        owner_name = users.get(owner_id, f"Team {roster_id}")
        player_ids = roster.get("players") or []
        await db.execute(
            """
            INSERT INTO rosters
                (league_id, roster_id, owner_display_name, player_ids_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO UPDATE SET
                owner_display_name=excluded.owner_display_name,
                player_ids_json=excluded.player_ids_json,
                updated_at=excluded.updated_at
            """,
            (league_id, roster_id, owner_name, json.dumps(player_ids), now),
        )

    traded_picks = await sleeper.fetch_traded_picks(league_id)
    for pick in traded_picks:
        await db.execute(
            """
            INSERT OR IGNORE INTO picks
                (league_id, season, round, original_owner_id, current_owner_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                league_id,
                pick.get("season"),
                pick.get("round"),
                pick.get("roster_id"),
                pick.get("owner_id"),
                now,
            ),
        )

    await db.commit()

    await snapshot_roster_values(db, league_id, now)


async def snapshot_roster_values(db: aiosqlite.Connection, league_id: str, synced_at: str) -> int:
    """Store total adjusted value snapshots for every roster in a league."""
    async with db.execute(
        "SELECT roster_id, player_ids_json FROM rosters WHERE league_id=?",
        (league_id,),
    ) as cur:
        roster_rows = await cur.fetchall()

    snapshot_count = 0
    for roster_id, player_ids_json in roster_rows:
        player_ids = json.loads(player_ids_json or "[]")
        total_value = 0

        if player_ids:
            placeholders = ",".join("?" * len(player_ids))
            async with db.execute(
                f"""
                SELECT sleeper_id, name, position, team, age, value_sf, value_1qb,
                       trend_30d, injury_status
                FROM players
                WHERE sleeper_id IN ({placeholders})
                """,
                player_ids,
            ) as cur:
                rows = await cur.fetchall()

            for row in rows:
                player = {
                    "sleeper_id": row[0],
                    "name": row[1],
                    "position": row[2],
                    "team": row[3],
                    "age": row[4],
                    "value_sf": row[5] or 0,
                    "value_1qb": row[6] or 0,
                    "trend_30d": row[7] or 0,
                    "injury_status": row[8],
                }
                total_value += enrich_player(player, league_id).get("adjusted_value", 0)

        await db.execute(
            """
            INSERT INTO roster_snapshots (league_id, roster_id, total_value, synced_at)
            VALUES (?, ?, ?, ?)
            """,
            (league_id, roster_id, total_value, synced_at),
        )
        snapshot_count += 1

    await db.commit()
    return snapshot_count


def injury_severity(status: Optional[str]) -> str:
    normalized = (status or "").lower()
    if normalized in {"out", "ir", "injured reserve"}:
        return "critical"
    return "notable"


async def get_my_roster_players(db: aiosqlite.Connection) -> list[dict]:
    async with db.execute(
        """
        SELECT DISTINCT
            l.league_id,
            p.sleeper_id,
            p.name,
            p.injury_status,
            p.depth_chart_order,
            p.value_sf
        FROM leagues l
        JOIN rosters r
            ON r.league_id = l.league_id
           AND r.roster_id = COALESCE(l.my_roster_id, 1)
        JOIN players p
            ON EXISTS (
                SELECT 1
                FROM json_each(r.player_ids_json)
                WHERE json_each.value = p.sleeper_id
            )
        """
    ) as cur:
        rows = await cur.fetchall()

    return [
        {
            "league_id": row[0],
            "sleeper_id": row[1],
            "name": row[2],
            "injury_status": row[3],
            "depth_chart_order": row[4],
            "value_sf": row[5] or 0,
        }
        for row in rows
    ]


async def latest_snapshot(db: aiosqlite.Connection, sleeper_id: str) -> Optional[dict]:
    async with db.execute(
        """
        SELECT injury_status, depth_chart_order, value_sf, snapshot_date
        FROM player_snapshots
        WHERE sleeper_id=?
        ORDER BY snapshot_date DESC
        LIMIT 1
        """,
        (sleeper_id,),
    ) as cur:
        row = await cur.fetchone()

    if not row:
        return None
    return {
        "injury_status": row[0],
        "depth_chart_order": row[1],
        "value_sf": row[2] or 0,
        "snapshot_date": row[3],
    }


async def insert_alert(
    db: aiosqlite.Connection,
    player: dict,
    alert_type: str,
    severity: str,
    old_value: object,
    new_value: object,
    detail: str,
    created_at: str,
) -> None:
    await db.execute(
        """
        INSERT INTO alerts
            (league_id, sleeper_id, player_name, alert_type, severity,
             old_value, new_value, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            player["league_id"],
            player["sleeper_id"],
            player["name"],
            alert_type,
            severity,
            "" if old_value is None else str(old_value),
            "" if new_value is None else str(new_value),
            detail,
            created_at,
        ),
    )


async def detect_changes(db: aiosqlite.Connection) -> int:
    """Compare current my-roster player state to prior snapshots and insert alerts."""
    today = date.today().isoformat()
    now = datetime.now(timezone.utc).isoformat()
    alert_count = 0

    for player in await get_my_roster_players(db):
        previous = await latest_snapshot(db, player["sleeper_id"])
        if previous:
            old_status = previous.get("injury_status")
            new_status = player.get("injury_status")
            if old_status != new_status:
                await insert_alert(
                    db,
                    player,
                    "injury_status",
                    injury_severity(new_status),
                    old_status or "healthy",
                    new_status or "healthy",
                    f"{player['name']} injury status changed.",
                    now,
                )
                alert_count += 1

            old_depth = previous.get("depth_chart_order")
            new_depth = player.get("depth_chart_order")
            if old_depth is not None and new_depth is not None and new_depth - old_depth >= 1:
                await insert_alert(
                    db,
                    player,
                    "depth_chart",
                    "notable",
                    old_depth,
                    new_depth,
                    f"{player['name']} moved down the depth chart.",
                    now,
                )
                alert_count += 1

            old_value = previous.get("value_sf", 0)
            new_value = player.get("value_sf", 0)
            if abs(new_value - old_value) > 300:
                await insert_alert(
                    db,
                    player,
                    "value_move",
                    "fyi",
                    old_value,
                    new_value,
                    f"{player['name']} dynasty value moved by {new_value - old_value}.",
                    now,
                )
                alert_count += 1

        await db.execute(
            """
            INSERT INTO player_snapshots
                (sleeper_id, injury_status, depth_chart_order, value_sf, snapshot_date)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(sleeper_id, snapshot_date) DO UPDATE SET
                injury_status=excluded.injury_status,
                depth_chart_order=excluded.depth_chart_order,
                value_sf=excluded.value_sf
            """,
            (
                player["sleeper_id"],
                player.get("injury_status"),
                player.get("depth_chart_order"),
                player.get("value_sf", 0),
                today,
            ),
        )

    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    await db.execute("DELETE FROM alerts WHERE created_at < ?", (cutoff,))
    await db.commit()
    return alert_count


async def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    print(f"[{now}] Starting daily fantasy sync...")

    async with aiosqlite.connect(DB_PATH) as db:
        print("  Fetching FantasyCalc SF values...")
        sf_players = await fantasycalc.fetch_sf_values()
        print("  Fetching FantasyCalc 1QB values...")
        onqb_players = await fantasycalc.fetch_1qb_values()

        n = await upsert_players(db, sf_players)
        await upsert_1qb_values(db, onqb_players)
        print(f"  Synced {n} players")

        total_new_trades = 0
        for league_id, config in LEAGUE_CONFIG.items():
            print(f"  Syncing league: {config['name']}...")
            await sync_league(db, league_id, config)
            new_trades = await trade_history.ingest_trade_history(league_id)
            await trade_history.compute_calibration(league_id)
            await trade_history.build_manager_profiles(league_id)
            total_new_trades += new_trades
            print(f"  Ingested {new_trades} new trades for {config['name']}")

        alert_count = await detect_changes(db)
        print(f"  Created {alert_count} alerts")

        await db.execute(
            """
            INSERT INTO sync_log (sync_type, status, message, ran_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                "daily_sync",
                "success",
                (
                    f"{n} players synced, {len(LEAGUE_CONFIG)} leagues, "
                    f"{total_new_trades} new trades, {alert_count} alerts"
                ),
                now,
            ),
        )
        await db.commit()

    print(f"  Done. {n} players, {len(LEAGUE_CONFIG)} leagues synced.")


if __name__ == "__main__":
    asyncio.run(main())
