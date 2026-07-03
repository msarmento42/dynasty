"""Player identity helpers for cross-source ID mapping."""

from __future__ import annotations

import re
from typing import Any


ID_FIELDS = ("espn_id", "yahoo_id", "rotowire_id")


def _metadata(player_row: dict[str, Any]) -> dict[str, Any]:
    metadata = player_row.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _first_value(player_row: dict[str, Any], *keys: str) -> str | None:
    metadata = _metadata(player_row)
    for key in keys:
        value = player_row.get(key)
        if value is None:
            value = metadata.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _normalized_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _normalized_team(value: Any) -> str:
    return str(value or "").strip().upper()


def _normalized_position(value: Any) -> str:
    return str(value or "").strip().upper()


def identity_key(player_row: dict[str, Any]) -> tuple[str, str, str]:
    """Return the fuzzy-match key used by the backfill script."""
    name = (
        player_row.get("name")
        or player_row.get("full_name")
        or f"{player_row.get('first_name', '')} {player_row.get('last_name', '')}"
    )
    return (
        _normalized_text(name),
        _normalized_team(player_row.get("team")),
        _normalized_position(player_row.get("position")),
    )


def resolve_ids(player_row: dict[str, Any]) -> dict[str, Any]:
    """Extract known cross-source IDs from a Sleeper-style player row."""
    resolved = {
        "sleeper_id": str(player_row.get("sleeper_id") or player_row.get("player_id") or ""),
        "espn_id": _first_value(player_row, "espn_id", "espnId"),
        "yahoo_id": _first_value(player_row, "yahoo_id", "yahooId"),
        "rotowire_id": _first_value(player_row, "rotowire_id", "rotowireId"),
        "match_confidence": 0.0,
        "match_method": "unmatched",
        "manual_override": 0,
    }

    if any(resolved[field] for field in ID_FIELDS):
        resolved["match_confidence"] = 1.0
        resolved["match_method"] = "sleeper_metadata"

    return resolved


def espn_to_sleeper_map(all_players: dict[str, Any]) -> dict[str, str]:
    """Build the ESPN-to-Sleeper lookup used by ESPN news filtering."""
    mapping = {}
    for sleeper_id, player in all_players.items():
        if not isinstance(player, dict):
            continue
        player_with_id = {"sleeper_id": sleeper_id, **player}
        espn_id = resolve_ids(player_with_id).get("espn_id")
        if espn_id:
            mapping[str(espn_id)] = str(sleeper_id)
    return mapping
