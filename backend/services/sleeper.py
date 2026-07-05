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


async def fetch_weekly_player_stats(season: int, week: int, season_type: str = "regular") -> dict[str, Any]:
    """Fetch raw weekly player stat rows from Sleeper."""
    data = await _get_json(f"/stats/nfl/{season_type}/{season}/{week}")
    return data if isinstance(data, dict) else {}


async def fetch_nfl_week_schedule(season: int, week: int, season_type: str = "regular") -> list[dict[str, Any]]:
    """Fetch a Sleeper NFL schedule week, returning an empty list when unavailable."""
    paths = [
        f"/schedule/nfl/{season_type}/{season}/{week}",
        f"/schedule/nfl/{season}/{week}",
    ]
    for path in paths:
        try:
            data = await _get_json(path)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                continue
            raise
        if isinstance(data, list):
            return [game for game in data if isinstance(game, dict)]
    return []


def _game_teams(game: dict[str, Any]) -> tuple[str | None, str | None]:
    home = game.get("home") or game.get("home_team") or game.get("home_team_abbr")
    away = game.get("away") or game.get("away_team") or game.get("away_team_abbr")
    return (str(home).upper() if home else None, str(away).upper() if away else None)


async def fetch_upcoming_opponents(team: str, weeks: int = 8) -> list[dict[str, Any]]:
    """Return upcoming opponents for a team from Sleeper schedule data."""
    if not team:
        return []

    state = await fetch_nfl_state()
    season = int(state.get("season") or datetime_now_year())
    current_week = int(state.get("week") or 1)
    season_type = str(state.get("season_type") or "regular")
    team_code = str(team).upper()
    opponents = []

    for week in range(current_week, current_week + max(1, min(int(weeks or 8), 8))):
        for game in await fetch_nfl_week_schedule(season, week, season_type=season_type):
            home, away = _game_teams(game)
            if not home or not away:
                continue
            if team_code == home:
                opponents.append({"season": season, "week": week, "opponent": away, "home": True})
                break
            if team_code == away:
                opponents.append({"season": season, "week": week, "opponent": home, "home": False})
                break
    return opponents


def _fantasy_points(stats: dict[str, Any]) -> float | None:
    return _float_stat(
        stats,
        "pts_ppr",
        "pts_half_ppr",
        "pts_std",
        "fantasy_points_ppr",
        "fantasy_points",
    )


async def fetch_defensive_points_allowed_by_position(
    season: int | None = None,
    through_week: int | None = None,
    weeks_back: int = 6,
    season_type: str = "regular",
) -> dict[str, dict[str, Any]]:
    """
    Derive average fantasy points allowed by defense and position from Sleeper weekly stats.

    Sleeper stat rows include opponent fields when available. When they do not, callers receive
    an empty mapping and can present the SOS feature as unavailable instead of guessing.
    """
    state = await fetch_nfl_state()
    stat_season = int(season or state.get("season") or datetime_now_year())
    current_week = int(through_week or state.get("week") or 1)
    stat_type = str(state.get("season_type") or season_type)
    players = await fetch_all_players()

    start_week = max(1, current_week - max(1, weeks_back) + 1)
    allowed: dict[str, dict[str, list[float]]] = {}
    for week in range(start_week, current_week + 1):
        weekly_stats = await fetch_weekly_player_stats(stat_season, week, season_type=stat_type)
        for sleeper_id, stats in weekly_stats.items():
            if not isinstance(stats, dict):
                continue
            opponent = stats.get("opp") or stats.get("opponent") or stats.get("opp_team")
            points = _fantasy_points(stats)
            player = players.get(str(sleeper_id), {}) if isinstance(players, dict) else {}
            position = str(player.get("position") or stats.get("pos") or "").upper()
            if not opponent or points is None or position not in {"QB", "RB", "WR", "TE"}:
                continue
            defense = str(opponent).upper()
            allowed.setdefault(defense, {}).setdefault(position, []).append(float(points))

    result: dict[str, dict[str, Any]] = {}
    for defense, by_position in allowed.items():
        result[defense] = {}
        for position, values in by_position.items():
            if values:
                result[defense][position] = {
                    "avg_points_allowed": round(sum(values) / len(values), 2),
                    "sample_size": len(values),
                }
    return result


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
