"""Sleeper trade history ingestion, calibration, and manager profiling."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from statistics import mean

import aiosqlite

from backend.database import DB_PATH
from backend.services import sleeper

POSITIONS = ("QB", "RB", "WR", "TE")
TRADE_CLASSIFICATION_THRESHOLD = 200


async def player_row(db: aiosqlite.Connection, sleeper_id: str) -> dict:
    async with db.execute(
        "SELECT name, position, value_sf FROM players WHERE sleeper_id=?",
        (str(sleeper_id),),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return {"name": str(sleeper_id), "position": None, "value_sf": 0}
    return {"name": row[0], "position": row[1], "value_sf": int(row[2] or 0)}


async def player_value(db: aiosqlite.Connection, sleeper_id: str) -> int:
    return (await player_row(db, sleeper_id))["value_sf"]


async def player_name(db: aiosqlite.Connection, sleeper_id: str) -> str:
    return (await player_row(db, sleeper_id))["name"]


async def ensure_trade_history_columns(db: aiosqlite.Connection) -> None:
    async with db.execute("PRAGMA table_info(trade_history)") as cur:
        columns = {row[1] for row in await cur.fetchall()}
    if "side_a_roster_id" not in columns:
        await db.execute("ALTER TABLE trade_history ADD COLUMN side_a_roster_id INTEGER")
    if "side_b_roster_id" not in columns:
        await db.execute("ALTER TABLE trade_history ADD COLUMN side_b_roster_id INTEGER")
    await db.commit()


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
        await ensure_trade_history_columns(db)
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
                         side_a_roster_id, side_b_roster_id,
                         side_a_player_ids_json, side_b_player_ids_json,
                         side_a_pick_ids_json, side_b_pick_ids_json,
                         side_a_total_value, side_b_total_value, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        league_id,
                        str(transaction.get("transaction_id")),
                        week,
                        season,
                        side_a["roster_id"],
                        side_b["roster_id"],
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
                (league_id, sleeper_id, name, fc_value, len(ratios), round(mean(ratios), 3), now),
            )

        await db.commit()


def average(values: list[float], default: float = 1.0) -> float:
    return round(mean(values), 3) if values else default


def classify_trade_delta(value_delta: int | float | None) -> str:
    """Classify a trade from the side A perspective."""
    delta = value_delta or 0
    if delta > TRADE_CLASSIFICATION_THRESHOLD:
        return "WINNER"
    if delta < -TRADE_CLASSIFICATION_THRESHOLD:
        return "LOSER"
    return "FAIR"


def opposite_classification(classification: str) -> str:
    if classification == "WINNER":
        return "LOSER"
    if classification == "LOSER":
        return "WINNER"
    return "FAIR"


def trade_value_analysis(side_a_total: int | float | None, side_b_total: int | float | None) -> dict:
    """Return side A value delta plus mirrored FAIR/WINNER/LOSER labels."""
    value_delta = round((side_a_total or 0) - (side_b_total or 0))
    side_a_classification = classify_trade_delta(value_delta)
    return {
        "value_delta": value_delta,
        "classification": side_a_classification,
        "side_a_classification": side_a_classification,
        "side_b_classification": opposite_classification(side_a_classification),
    }


def trade_leaderboard(trades: list[dict], limit: int = 5) -> dict:
    """Surface the largest value wins and losses across classified trades."""
    decisive_trades = [trade for trade in trades if trade.get("classification") != "FAIR"]
    biggest_steals = sorted(
        decisive_trades,
        key=lambda trade: abs(trade.get("value_delta") or 0),
        reverse=True,
    )[:limit]
    biggest_blunders = sorted(
        decisive_trades,
        key=lambda trade: abs(trade.get("value_delta") or 0),
        reverse=True,
    )[:limit]
    return {
        "biggest_steals": biggest_steals,
        "biggest_blunders": biggest_blunders,
    }


async def values_by_position(db: aiosqlite.Connection, player_ids: list[str]) -> dict:
    totals = {position: 0 for position in POSITIONS}
    for player_id in player_ids:
        player = await player_row(db, player_id)
        position = player.get("position")
        if position in totals:
            totals[position] += player.get("value_sf", 0)
    return totals


def target_signal(profile: dict) -> str:
    if profile["qb_premium"] > 1.1:
        return "SELL_QBS_TO_THEM"
    if profile["pick_sell_bias"] > 1.1:
        return "BUY_PICKS_FROM_THEM"
    if profile["rb_premium"] > 1.1:
        return "SELL_RBS_TO_THEM"
    return "NEUTRAL"


def profile_summary(profile: dict) -> str:
    premiums = [
        ("QBs", profile["qb_premium"]),
        ("RBs", profile["rb_premium"]),
        ("WRs", profile["wr_premium"]),
        ("TEs", profile["te_premium"]),
    ]
    strongest = max(premiums, key=lambda item: item[1])
    pick_note = "sells picks below value" if profile["pick_sell_bias"] > 1.1 else "does not show a pick-selling bias"
    activity = "Active trader" if profile["accept_rate"] >= 0.4 else "Selective trader"
    return f"Tends to overpay for {strongest[0]} ({strongest[1]:.2f}x) and {pick_note}. {activity}."


async def build_manager_profiles(league_id: str) -> None:
    """Analyze stored trades and upsert per-manager tendency profiles."""
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await ensure_trade_history_columns(db)
        async with db.execute(
            "SELECT roster_id, owner_display_name FROM rosters WHERE league_id=?",
            (league_id,),
        ) as cur:
            managers = await cur.fetchall()

        async with db.execute(
            """
            SELECT side_a_roster_id, side_b_roster_id, side_a_player_ids_json, side_b_player_ids_json,
                   side_a_pick_ids_json, side_b_pick_ids_json, side_a_total_value, side_b_total_value
            FROM trade_history
            WHERE league_id=?
            """,
            (league_id,),
        ) as cur:
            trades = await cur.fetchall()

        for roster_id, owner_name in managers:
            trade_count = 0
            position_ratios = {position: [] for position in POSITIONS}
            pick_biases = []

            for trade in trades:
                side_a_roster, side_b_roster = trade[0], trade[1]
                if roster_id not in (side_a_roster, side_b_roster):
                    continue

                trade_count += 1
                side_a_players = json.loads(trade[2] or "[]")
                side_b_players = json.loads(trade[3] or "[]")
                side_a_picks = json.loads(trade[4] or "[]")
                side_b_picks = json.loads(trade[5] or "[]")
                side_a_value = trade[6] or 0
                side_b_value = trade[7] or 0

                received_players = side_a_players if roster_id == side_a_roster else side_b_players
                sent_value = side_b_value if roster_id == side_a_roster else side_a_value
                sent_picks = side_b_picks if roster_id == side_a_roster else side_a_picks
                received_picks = side_a_picks if roster_id == side_a_roster else side_b_picks
                received_by_pos = await values_by_position(db, received_players)

                if sent_value > 0:
                    for position, value in received_by_pos.items():
                        if value > 0:
                            position_ratios[position].append(value / sent_value)

                if sent_picks or received_picks:
                    pick_biases.append(1.2 if sent_picks else 0.8)

            if trade_count < 3:
                continue

            profile = {
                "qb_premium": average(position_ratios["QB"]),
                "rb_premium": average(position_ratios["RB"]),
                "wr_premium": average(position_ratios["WR"]),
                "te_premium": average(position_ratios["TE"]),
                "pick_sell_bias": average(pick_biases),
                "accept_rate": round(min(1.0, trade_count / 20), 3),
            }
            profile["summary"] = profile_summary(profile)
            profile["target_signal"] = target_signal(profile)

            await db.execute(
                """
                INSERT INTO manager_profiles
                    (league_id, roster_id, owner_name, trades_analyzed, qb_premium,
                     rb_premium, wr_premium, te_premium, pick_sell_bias,
                     accept_rate, profile_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(league_id, roster_id) DO UPDATE SET
                    owner_name=excluded.owner_name,
                    trades_analyzed=excluded.trades_analyzed,
                    qb_premium=excluded.qb_premium,
                    rb_premium=excluded.rb_premium,
                    wr_premium=excluded.wr_premium,
                    te_premium=excluded.te_premium,
                    pick_sell_bias=excluded.pick_sell_bias,
                    accept_rate=excluded.accept_rate,
                    profile_json=excluded.profile_json,
                    updated_at=excluded.updated_at
                """,
                (
                    league_id,
                    roster_id,
                    owner_name,
                    trade_count,
                    profile["qb_premium"],
                    profile["rb_premium"],
                    profile["wr_premium"],
                    profile["te_premium"],
                    profile["pick_sell_bias"],
                    profile["accept_rate"],
                    json.dumps(profile),
                    now,
                ),
            )

        await db.commit()
