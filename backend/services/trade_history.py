"""Sleeper trade history ingestion and market calibration."""

import json
from datetime import datetime, timezone
from statistics import mean

import aiosqlite

from backend.database import DB_PATH
from backend.services import sleeper


async def player_value(db: aiosqlite.Connection, sleeper_id: str) -> int:
    async with db.execute(
        "SELECT value_sf FROM players WHERE sleeper_id=?",
        (str(sleeper_id),),
    ) as cur:
        row = await cur.fetchone()
    return int(row[0] or 0) if row else 0


async def player_name(db: aiosqlite.Connection, sleeper_id: str) -> str:
    async with db.execute(
        "SELECT name FROM players WHERE sleeper_id=?",
        (str(sleeper_id),),
    ) as cur:
        row = await cur.fetchone()
    return row[0] if row else str(sleeper_id)


def group_trade_sides(transaction: dict) -> list[dict]:
    """Group players and picks by the roster receiving assets in a trade."""
    sides = {}
    adds = transaction.get("adds") or {}
    drops = transaction.get("drops") or {}

    for player_id, roster_id in adds.items():
        side = sides.setdefault(roster_id, {"roster_id": roster_id, "players": [], "picks": []})
        side["players"].append(str(player_id))

    for player_id, previous_roster_id in drops.items():
        if player_id in adds:
            continue
        side = sides.setdefault(previous_roster_id, {"roster_id": previous_roster_id, "players": [], "picks": []})
        side["players"].append(str(player_id))

    for pick in transaction.get("draft_picks") or []:
        roster_id = pick.get("owner_id") or pick.get("roster_id")
        if roster_id is None:
            continue
        side = sides.setdefault(roster_id, {"roster_id": roster_id, "players": [], "picks": []})
        side["picks"].append(pick)

    return list(sides.values())


async def side_value(db: aiosqlite.Connection, player_ids: list[str]) -> int:
    values = [await player_value(db, player_id) for player_id in player_ids]
    return sum(values)


async def ingest_trade_history(league_id: str, season: int = 2024) -> int:
    """Pull Sleeper trade transactions for a league season and store parsed sides."""
    inserted = 0
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        for week in range(1, 19):
            transactions = await sleeper.fetch_transactions(league_id, week)
            for transaction in transactions:
                if transaction.get("type") != "trade":
                    continue

                sides = group_trade_sides(transaction)
                if len(sides) < 2:
                    continue

                side_a = sides[0]
                side_b = sides[1]
                side_a_value = await side_value(db, side_a["players"])
                side_b_value = await side_value(db, side_b["players"])

                cursor = await db.execute(
                    """
                    INSERT OR IGNORE INTO trade_history
                        (league_id, transaction_id, week, season,
                         side_a_player_ids_json, side_b_player_ids_json,
                         side_a_pick_ids_json, side_b_pick_ids_json,
                         side_a_total_value, side_b_total_value, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        league_id,
                        str(transaction.get("transaction_id")),
                        week,
                        season,
                        json.dumps(side_a["players"]),
                        json.dumps(side_b["players"]),
                        json.dumps(side_a["picks"]),
                        json.dumps(side_b["picks"]),
                        side_a_value,
                        side_b_value,
                        transaction.get("created") or now,
                    ),
                )
                if cursor.rowcount:
                    inserted += 1

        await db.commit()

    return inserted


async def compute_calibration(league_id: str) -> None:
    """Compute observed value ratios for players appearing in stored trades."""
    ratios_by_player = {}

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT side_a_player_ids_json, side_b_player_ids_json,
                   side_a_total_value, side_b_total_value
            FROM trade_history
            WHERE league_id=?
            """,
            (league_id,),
        ) as cur:
            rows = await cur.fetchall()

        for row in rows:
            side_a_players = json.loads(row[0] or "[]")
            side_b_players = json.loads(row[1] or "[]")
            side_a_value = row[2] or 0
            side_b_value = row[3] or 0

            if side_a_value > 0 and side_b_value > 0:
                for player_id in side_a_players:
                    ratios_by_player.setdefault(player_id, []).append(side_b_value / side_a_value)
                for player_id in side_b_players:
                    ratios_by_player.setdefault(player_id, []).append(side_a_value / side_b_value)

        now = datetime.now(timezone.utc).isoformat()
        for sleeper_id, ratios in ratios_by_player.items():
            fc_value = await player_value(db, sleeper_id)
            name = await player_name(db, sleeper_id)
            await db.execute(
                """
                INSERT INTO market_calibration
                    (league_id, sleeper_id, player_name, fc_value,
                     observed_trades, avg_trade_ratio, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(league_id, sleeper_id) DO UPDATE SET
                    player_name=excluded.player_name,
                    fc_value=excluded.fc_value,
                    observed_trades=excluded.observed_trades,
                    avg_trade_ratio=excluded.avg_trade_ratio,
                    updated_at=excluded.updated_at
                """,
                (
                    league_id,
                    sleeper_id,
                    name,
                    fc_value,
                    len(ratios),
                    round(mean(ratios), 3),
                    now,
                ),
            )

        await db.commit()
