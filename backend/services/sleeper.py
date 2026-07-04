"""Sleeper API service wrappers."""

from __future__ import annotations

from typing import Any

import httpx


BASE = "https://api.sleeper.app/v1"
SLEEPER_USER_ID = "465276267160137728"
DEFAULT_TIMEOUT = 20.0

LEAGUES = {
    "1330499939976880128": {
        "name": "The Odin Invitational",
        "my_roster_id": 4,
        "n_teams": 12,
        "format": "SF",
    },
    "1315139749693886464": {
        "name": "Four Horsemen Vol. 8",
        "my_roster_id": 3,
        "n_teams": 4,
        "format": "4QB",
    },
    "1312285408079380481": {
        "name": "Four Horsemen All-Stars",
        "my_roster_id": 4,
        "n_teams": 4,
        "format": "4QB",
    },
}

_ALL_PLAYERS_CACHE: dict[str, Any] | None = None


async def fetch_nfl_state() -> dict[str, Any]:
    """Fetch Sleeper's current NFL season/week state."""
    data = await _get_json("/state/nfl")
    return data if isinstance(data, dict) else {}


async def _get_json(path: str, params: dict[str, Any] | None = None) -> Any:
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.get(f"{BASE}{path}", params=params)
        response.raise_for_status()
        return response.json()


async def fetch_all_players() -> dict[str, Any]:
    """Fetch the full NFL player universe from Sleeper, cached once per process."""
    global _ALL_PLAYERS_CACHE
    if _ALL_PLAYERS_CACHE is None:
        data = await _get_json("/players/nfl")
        _ALL_PLAYERS_CACHE = data if isinstance(data, dict) else {}
    return _ALL_PLAYERS_CACHE


async def fetch_rosters(league_id: str) -> list[dict[str, Any]]:
    """Fetch all rosters for a Sleeper league."""
    data = await _get_json(f"/league/{league_id}/rosters")
    return data if isinstance(data, list) else []


async def fetch_league_users(league_id: str) -> dict[str, str]:
    """Fetch Sleeper league users and return a user_id to display_name mapping."""
    data = await _get_json(f"/league/{league_id}/users")
    if not isinstance(data, list):
        return {}

    users = {}
    for user in data:
        if not isinstance(user, dict):
            continue
        user_id = user.get("user_id")
        if user_id:
            users[str(user_id)] = user.get("display_name") or user.get("username") or str(user_id)
    return users


async def fetch_traded_picks(league_id: str) -> list[dict[str, Any]]:
    """Fetch traded picks for a Sleeper league."""
    data = await _get_json(f"/league/{league_id}/traded_picks")
    return data if isinstance(data, list) else []


async def fetch_transactions(league_id: str, round: int = 1) -> list[dict[str, Any]]:
    """Fetch Sleeper transactions for a league round."""
    data = await _get_json(f"/league/{league_id}/transactions/{round}")
    return data if isinstance(data, list) else []


async def fetch_trending(sport: str = "nfl", type: str = "add", limit: int = 25) -> list[dict[str, Any]]:
    """Fetch trending adds or drops from Sleeper."""
    params = {"lookback_hours": 24, "limit": limit}
    data = await _get_json(f"/players/{sport}/trending/{type}", params=params)
    return data if isinstance(data, list) else []


async def get_my_roster_players(league_id: str) -> list[str]:
    """Return Sleeper player IDs on Marcus' roster for the given league."""
    config = LEAGUES.get(league_id)
    if not config:
        return []

    rosters = await fetch_rosters(league_id)
    my_roster_id = config["my_roster_id"]
    for roster in rosters:
        if roster.get("roster_id") == my_roster_id:
            players = roster.get("players") or []
            return [str(player_id) for player_id in players]
    return []


async def fetch_league_info(league_id: str) -> dict[str, Any]:
    """Fetch full league info from Sleeper (includes scoring_settings + roster_positions)."""
    data = await _get_json(f"/league/{league_id}")
    return data if isinstance(data, dict) else {}


def _float_stat(stats: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = stats.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _normalize_usage_stats(season: int, week: int, raw_stats: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_stats, dict):
        return []

    team_targets: dict[str, float] = {}
    for stats in raw_stats.values():
        if not isinstance(stats, dict):
            continue
        team = stats.get("team")
        targets = _float_stat(stats, "rec_tgt", "targets")
        if team and targets is not None:
            team_targets[str(team)] = team_targets.get(str(team), 0.0) + targets

    usage_rows = []
    for sleeper_id, stats in raw_stats.items():
        if not isinstance(stats, dict):
            continue

        team = stats.get("team")
        targets = _float_stat(stats, "rec_tgt", "targets")
        target_share = _float_stat(stats, "target_share", "tgt_share")
        if target_share is None and team and targets is not None:
            total_targets = team_targets.get(str(team), 0.0)
            if total_targets > 0:
                target_share = targets / total_targets

        snap_pct = _float_stat(stats, "off_snp_pct", "snap_pct", "tm_off_snp_pct")
        if snap_pct is not None and snap_pct > 1:
            snap_pct = snap_pct / 100

        offensive_snaps = _float_stat(stats, "off_snp", "offensive_snaps", "snaps")
        if target_share is None and snap_pct is None and targets is None and offensive_snaps is None:
            continue

        usage_rows.append({
            "sleeper_id": str(sleeper_id),
            "season": int(season),
            "week": int(week),
            "team": str(team) if team else None,
            "targets": targets,
            "target_share": round(target_share, 4) if target_share is not None else None,
            "snap_pct": round(snap_pct, 4) if snap_pct is not None else None,
            "offensive_snaps": offensive_snaps,
        })

    return usage_rows


async def fetch_weekly_player_usage(season: int, week: int, season_type: str = "regular") -> list[dict[str, Any]]:
    """Fetch weekly target share and snap usage from Sleeper stats."""
    data = await _get_json(f"/stats/nfl/{season_type}/{season}/{week}")
    return _normalize_usage_stats(season, week, data)


async def fetch_recent_player_usage(weeks_back: int = 4) -> list[dict[str, Any]]:
    """Fetch recent weekly usage rows for the current Sleeper NFL season."""
    state = await fetch_nfl_state()
    season = int(state.get("season") or datetime_now_year())
    current_week = int(state.get("week") or 1)
    season_type = str(state.get("season_type") or "regular")

    start_week = max(1, current_week - max(weeks_back, 1) + 1)
    rows: list[dict[str, Any]] = []
    for week in range(start_week, current_week + 1):
        rows.extend(await fetch_weekly_player_usage(season, week, season_type=season_type))
    return rows


def datetime_now_year() -> int:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).year
