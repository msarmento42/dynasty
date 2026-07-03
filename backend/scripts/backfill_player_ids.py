"""Backfill player_id_map from local players and Sleeper metadata.

Optional manual overrides may be stored in backend/data/player_id_overrides.json
as either a list of rows or an object keyed by sleeper_id.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from backend.database import DB_PATH
from backend.services import sleeper
from backend.services.player_identity import ID_FIELDS, identity_key, resolve_ids


DEFAULT_OVERRIDE_PATH = Path(__file__).resolve().parents[1] / "data" / "player_id_overrides.json"


def load_overrides(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}

    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        rows = [
            {"sleeper_id": sleeper_id, **override}
            for sleeper_id, override in raw.items()
            if isinstance(override, dict)
        ]
    elif isinstance(raw, list):
        rows = [row for row in raw if isinstance(row, dict)]
    else:
        raise ValueError("Override file must be a JSON object or list")

    overrides = {}
    for row in rows:
        sleeper_id = row.get("sleeper_id")
        if sleeper_id:
            overrides[str(sleeper_id)] = row
    return overrides


async def local_players(db: aiosqlite.Connection) -> list[dict[str, Any]]:
    async with db.execute("SELECT sleeper_id, name, position, team FROM players") as cur:
        rows = await cur.fetchall()
    return [
        {"sleeper_id": str(row[0]), "name": row[1], "position": row[2], "team": row[3]}
        for row in rows
    ]


def sleeper_index(
    all_players: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[tuple[str, str, str], dict[str, Any]]]:
    by_id = {}
    by_fuzzy_key = {}
    for sleeper_id, player in all_players.items():
        if not isinstance(player, dict):
            continue
        row = {"sleeper_id": str(sleeper_id), **player}
        by_id[str(sleeper_id)] = row
        key = identity_key(row)
        if key[0] and key[1] and key[2] and key not in by_fuzzy_key:
            by_fuzzy_key[key] = row
    return by_id, by_fuzzy_key


def apply_override(resolved: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(resolved)
    for field in ID_FIELDS:
        if field in override:
            value = override[field]
            merged[field] = str(value).strip() if value is not None and str(value).strip() else None
    if "match_confidence" in override:
        merged["match_confidence"] = float(override["match_confidence"])
    else:
        merged["match_confidence"] = 1.0
    merged["match_method"] = str(override.get("match_method") or "manual_override")
    merged["manual_override"] = 1
    return merged


def resolve_player(
    player: dict[str, Any],
    by_sleeper_id: dict[str, dict[str, Any]],
    by_fuzzy_key: dict[tuple[str, str, str], dict[str, Any]],
    overrides: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    sleeper_id = player["sleeper_id"]
    sleeper_row = by_sleeper_id.get(sleeper_id)
    if sleeper_row:
        resolved = resolve_ids(sleeper_row)
    else:
        fuzzy_row = by_fuzzy_key.get(identity_key(player))
        resolved = resolve_ids(fuzzy_row) if fuzzy_row else resolve_ids(player)
        if fuzzy_row and any(resolved[field] for field in ID_FIELDS):
            resolved["sleeper_id"] = sleeper_id
            resolved["match_confidence"] = 0.75
            resolved["match_method"] = "name_team_position"

    resolved["sleeper_id"] = sleeper_id
    if sleeper_id in overrides:
        resolved = apply_override(resolved, overrides[sleeper_id])
        resolved["sleeper_id"] = sleeper_id
    return resolved


async def backfill(db_path: Path = DB_PATH, override_path: Path = DEFAULT_OVERRIDE_PATH) -> int:
    overrides = load_overrides(override_path)
    all_players = await sleeper.fetch_all_players()
    by_sleeper_id, by_fuzzy_key = sleeper_index(all_players)
    updated_at = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS player_id_map (
                sleeper_id TEXT PRIMARY KEY,
                espn_id TEXT,
                yahoo_id TEXT,
                rotowire_id TEXT,
                match_confidence REAL,
                match_method TEXT,
                manual_override INTEGER DEFAULT 0,
                updated_at TEXT
            )
            """
        )
        players = await local_players(db)
        for player in players:
            resolved = resolve_player(player, by_sleeper_id, by_fuzzy_key, overrides)
            await db.execute(
                """
                INSERT INTO player_id_map
                    (sleeper_id, espn_id, yahoo_id, rotowire_id, match_confidence,
                     match_method, manual_override, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sleeper_id) DO UPDATE SET
                    espn_id=excluded.espn_id,
                    yahoo_id=excluded.yahoo_id,
                    rotowire_id=excluded.rotowire_id,
                    match_confidence=excluded.match_confidence,
                    match_method=excluded.match_method,
                    manual_override=excluded.manual_override,
                    updated_at=excluded.updated_at
                """,
                (
                    resolved["sleeper_id"],
                    resolved.get("espn_id"),
                    resolved.get("yahoo_id"),
                    resolved.get("rotowire_id"),
                    resolved.get("match_confidence", 0.0),
                    resolved.get("match_method") or "unmatched",
                    int(resolved.get("manual_override") or 0),
                    updated_at,
                ),
            )
        await db.commit()
    return len(players)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Populate player_id_map from Sleeper metadata.")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="SQLite DB path")
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDE_PATH, help="Manual override JSON path")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    count = await backfill(args.db, args.overrides)
    print(f"Backfilled player_id_map for {count} players")


if __name__ == "__main__":
    asyncio.run(main())
