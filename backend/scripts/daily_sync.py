"""Daily fantasy data sync — pulls FantasyCalc + Sleeper into SQLite."""

import asyncio
import json
from datetime import datetime, timezone

import aiosqlite

from backend.services import fantasycalc, sleeper
from backend.services.fantasy_engine import LEAGUE_CONFIG


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

    # Upsert league
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
            config.get("my_roster_id", 1),
            json.dumps(config),
        ),
    )

    # Fetch users for display names
    users = await sleeper.fetch_league_users(league_id)  # {user_id: display_name}

    # Fetch and upsert rosters
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

    # Fetch and upsert traded picks
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


async def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    print(f"[{now}] Starting daily fantasy sync...")

    async with aiosqlite.connect(DB_PATH) as db:
        # 1. Fetch FantasyCalc values
        print("  Fetching FantasyCalc SF values...")
        sf_players = await fantasycalc.fetch_sf_values()
        print("  Fetching FantasyCalc 1QB values...")
        onqb_players = await fantasycalc.fetch_1qb_values()

        # 2. Upsert players
        n = await upsert_players(db, sf_players)
        await upsert_1qb_values(db, onqb_players)
        print(f"  Synced {n} players")

        # 3. Sync each league
        for league_id, config in LEAGUE_CONFIG.items():
            print(f"  Syncing league: {config['name']}...")
            await sync_league(db, league_id, config)

        # 4. Write sync log
        await db.execute(
            """
            INSERT INTO sync_log (sync_type, status, message, ran_at)
            VALUES (?, ?, ?, ?)
            """,
            ("daily_sync", "success", f"{n} players synced, {len(LEAGUE_CONFIG)} leagues", now),
        )
        await db.commit()

    print(f"  Done. {n} players, {len(LEAGUE_CONFIG)} leagues synced.")


if __name__ == "__main__":
    asyncio.run(main())
