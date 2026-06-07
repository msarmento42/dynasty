"""FantasyCalc API service wrappers."""

from __future__ import annotations

from typing import Any

import httpx


BASE = "https://api.fantasycalc.com/values/current"
DEFAULT_TIMEOUT = 20.0


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_item(item: dict[str, Any]) -> dict[str, Any] | None:
    player = item.get("player") or {}
    sleeper_id = player.get("sleeperId")
    if sleeper_id is None:
        return None

    return {
        "sleeper_id": str(sleeper_id),
        "name": player.get("name") or player.get("displayName") or "",
        "position": player.get("position") or "",
        "team": player.get("maybeTeam") or "FA",
        "age": _as_float(player.get("maybeAge")),
        "value": _as_int(item.get("value")),
        "rank": _as_int(item.get("overallRank") or item.get("rank")),
        "pos_rank": _as_int(item.get("positionRank") or item.get("posRank")),
        "trend_30d": _as_int(item.get("trend30Day")),
    }


async def fetch_values(
    num_qbs: int = 2,
    num_teams: int = 12,
    ppr: float = 1.0,
    rookies_only: bool = False,
) -> list[dict[str, Any]]:
    """Fetch current dynasty values from FantasyCalc and return normalized player records."""
    params = {
        "isDynasty": "true",
        "numQbs": num_qbs,
        "numTeams": num_teams,
        "ppr": ppr,
    }
    if rookies_only:
        params["rookiesOnly"] = "true"

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.get(BASE, params=params)
        response.raise_for_status()

    data = response.json()
    if isinstance(data, dict):
        items = data.get("values") or data.get("players") or data.get("data") or []
    else:
        items = data

    normalized = [_normalize_item(item) for item in items if isinstance(item, dict)]
    return [item for item in normalized if item is not None]


async def fetch_sf_values() -> list[dict[str, Any]]:
    """Fetch superflex dynasty values from FantasyCalc."""
    return await fetch_values(num_qbs=2)


async def fetch_1qb_values() -> list[dict[str, Any]]:
    """Fetch 1QB dynasty values from FantasyCalc."""
    return await fetch_values(num_qbs=1)


async def fetch_rookie_rankings(num_qbs: int = 2) -> list[dict[str, Any]]:
    """Fetch rookie-only dynasty rankings from FantasyCalc."""
    return await fetch_values(num_qbs=num_qbs, rookies_only=True)
