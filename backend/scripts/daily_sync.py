"""Daily fantasy data sync for Dynasty Calculator."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import aiosqlite

from backend.database import DB_PATH, init_db
from backend.services import fantasy_engine, fantasycalc, sleeper


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _upsert_players(db: aiosqlite.Connection, sf_values: list[dict], one_qb_values: list[dict]) -> int:
    now = _now()
    players = {}

    for player in sf_values:
        sleeper_id = player["sleeper_id"]
        players[sleeper_id] = {
            "sleeper_id": sleeper_id,
            "name": player["name"],
            "position": player["position"],
            "team": player["team"],
            "age": player["age"],
            "value_sf": player["value"],
            "value_1qb": 0,
            "trend_30d": player["trend_30d"],
        }

    for player in one_qb_values:
        sleeper_id = player["sleeper_id"]
        existing = players.setdefault(
            sleeper_id,
            {
                "sleeper_id": sleeper_id,
                "name": player["name"],
                "position": player["position"],
                "team": player["team"],
                "age": player["age"],
                "value_sf": 0,
                "value_1qb": 0,
                "trend_30d": player["trend_30d"],
            },
        )
        existing["value_1qb"] = player["value"]

    for player in players.values():
        await db.execute(
            """
            INSERT INTO players (
                sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sleeper_id) DO UPDATE SET
                name = excluded.name,
                position = excluded.position,
                team = excluded.team,
                age = excluded.age,
                value_sf = excluded.value_sf,
                value_1qb = excluded.value_1qb,
                trend_30d = excluded.trend_30d,
                updated_at = excluded.updated_at
            """,
            (
                player["sleeper_id"],
                player["name"],
                player["position"],
                player["team"],
                player["age"],
                player["value_sf"],
                player["value_1qb"],
                player["trend_30d"],
                now,
            ),
        )

    return len(players)


async def _sync_league(db: aiosqlite.Connection, league_id: str, config: dict) -> None:
    now = _now()
    sleeper_config = sleeper.LEAGUES.get(league_id, {})

    await db.execute(
        """
        INSERT INTO leagues (league_id, name, n_teams, format, my_roster_id, config_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(league_id) DO UPDATE SET
            name = excluded.name,
            n_teams = excluded.n_teams,
            format = excluded.format,
            my_roster_id = excluded.my_roster_id,
            config_json = excluded.config_json
        """,
        (
            league_id,
            config["name"],
            config["n_teams"],
            sleeper_config.get("format", config["base_format"].upper()),
            sleeper_config.get("my_roster_id"),
            json.dumps(config, sort_keys=True),
        ),
    )

    rosters = await sleeper.fetch_rosters(league_id)
    users = await sleeper.fetch_league_users(league_id)
    await db.execute("DELETE FROM rosters WHERE league_id = ?", (league_id,))

    for roster in rosters:
        owner_id = roster.get("owner_id")
        await db.execute(
            """
            INSERT INTO rosters (league_id, roster_id, owner_display_name, player_ids_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                league_id,
                roster.get("roster_id"),
                users.get(str(owner_id), str(owner_id or "")),
                json.dumps(roster.get("players") or []),
                now,
            ),
        )

    picks = await sleeper.fetch_traded_picks(league_id)
    await db.execute("DELETE FROM picks WHERE league_id = ?", (league_id,))

    for pick in picks:
        await db.execute(
            """
            INSERT INTO picks (
                league_id, season, round, original_owner_id, current_owner_id, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                league_id,
                pick.get("season"),
                pick.get("round"),
                pick.get("roster_id") or pick.get("original_owner_id"),
                pick.get("owner_id") or pick.get("current_owner_id"),
                now,
            ),
        )


async def main() -> None:
    """Run the full daily FantasyCalc and Sleeper sync into SQLite."""
    await init_db()
    synced_players = 0

    async with aiosqlite.connect(DB_PATH) as db:
        try:
            sf_values = await fantasycalc.fetch_sf_values()
            one_qb_values = await fantasycalc.fetch_1qb_values()
            synced_players = await _upsert_players(db, sf_values, one_qb_values)

            for league_id, config in fantasy_engine.LEAGUE_CONFIG.items():
                await _sync_league(db, league_id, config)

            message = f"{synced_players} players synced"
            await db.execute(
                "INSERT INTO sync_log (sync_type, status, message, ran_at) VALUES (?, ?, ?, ?)",
                ("daily_sync", "success", message, _now()),
            )
            await db.commit()
            print(message)
        except Exception as exc:
            await db.execute(
                "INSERT INTO sync_log (sync_type, status, message, ran_at) VALUES (?, ?, ?, ?)",
                ("daily_sync", "failure", str(exc), _now()),
            )
            await db.commit()
            raise


if __name__ == "__main__":
    asyncio.run(main())
