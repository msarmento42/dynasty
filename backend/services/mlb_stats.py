"""MLB Stats API client — free, no auth required."""
from __future__ import annotations

import httpx
from typing import Optional

MLB_API = "https://statsapi.mlb.com/api/v1"
DEFAULT_TIMEOUT = 20.0

SPORT_IDS = {
    "MLB": 1, "AAA": 11, "AA": 12, "A+": 13, "A": 14, "Rookie": 16,
}
SPORT_LABELS = {v: k for k, v in SPORT_IDS.items()}

# Level sort order (higher = higher level)
LEVEL_RANK = {"MLB": 6, "AAA": 5, "AA": 4, "A+": 3, "A": 2, "Rookie": 1}


async def _get_json(url: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


def _map_person(p: dict, sport_id: int | None = None) -> dict:
    """Normalize a person record from MLB API to our schema shape."""
    pos = p.get("primaryPosition", {})
    team = p.get("currentTeam", {})
    sport = p.get("sport", {})
    resolved_sport_id = sport_id or sport.get("id", 1)
    level = SPORT_LABELS.get(resolved_sport_id, "MLB")
    return {
        "mlb_id": p.get("id"),
        "name": p.get("fullName", ""),
        "position": pos.get("abbreviation", ""),
        "team": team.get("name", ""),
        "team_id": team.get("id"),
        "level": level,
        "sport_id": resolved_sport_id,
        "age": p.get("currentAge"),
        "birth_date": p.get("birthDate", ""),
        "bats": p.get("batSide", {}).get("code", ""),
        "throws": p.get("pitchHand", {}).get("code", ""),
        "draft_year": p.get("draftYear"),
        "debut_year": int(p.get("mlbDebutDate", "")[:4]) if p.get("mlbDebutDate") else None,
    }


async def search_players(query: str, limit: int = 20) -> list[dict]:
    """Search MLB player universe by name (case-insensitive substring match)."""
    if not query or len(query) < 2:
        return []
    # MLB Stats API search endpoint
    url = f"{MLB_API}/people/search"
    data = await _get_json(url, params={"names": query, "sportId": 1})
    people = data.get("people", [])
    results = []
    for p in people[:limit]:
        results.append(_map_person(p))
    return results


async def get_player(mlb_id: int) -> dict:
    """Get player bio + current team/level."""
    url = f"{MLB_API}/people/{mlb_id}"
    data = await _get_json(url, params={"hydrate": "currentTeam,team"})
    people = data.get("people", [])
    if not people:
        return {}
    return _map_person(people[0])


async def get_player_stats(mlb_id: int, season: int = 2025, sport_id: int = 1) -> dict:
    """Get stats for a player at a given level for a given season."""
    hydrate = f"stats(group=[hitting,pitching,fielding],type=season,season={season},sportId={sport_id})"
    url = f"{MLB_API}/people/{mlb_id}"
    data = await _get_json(url, params={"hydrate": hydrate})
    people = data.get("people", [])
    if not people:
        return {}
    person = people[0]
    stats_groups = {}
    for stat_block in person.get("stats", []):
        group = stat_block.get("group", {}).get("displayName", "")
        splits = stat_block.get("splits", [])
        if splits:
            stats_groups[group] = splits[0].get("stat", {})
    return {
        "mlb_id": mlb_id,
        "season": season,
        "sport_id": sport_id,
        "level": SPORT_LABELS.get(sport_id, "MLB"),
        "stats": stats_groups,
    }


async def get_player_career(mlb_id: int) -> list[dict]:
    """Get yearByYear stats across all levels (shows level progression)."""
    url = f"{MLB_API}/people/{mlb_id}"
    hydrate = "stats(group=[hitting,pitching],type=yearByYear)"
    data = await _get_json(url, params={"hydrate": hydrate})
    people = data.get("people", [])
    if not people:
        return []

    person = people[0]
    rows: dict[tuple, dict] = {}

    for stat_block in person.get("stats", []):
        group = stat_block.get("group", {}).get("displayName", "")  # hitting / pitching
        for split in stat_block.get("splits", []):
            season = split.get("season", "")
            sport = split.get("sport", {})
            sport_id = sport.get("id", 1)
            level = SPORT_LABELS.get(sport_id, "MLB")
            team = split.get("team", {}).get("name", "")
            key = (season, sport_id)
            if key not in rows:
                rows[key] = {
                    "season": season,
                    "level": level,
                    "sport_id": sport_id,
                    "team": team,
                    "hitting": {},
                    "pitching": {},
                }
            rows[key][group] = split.get("stat", {})

    # Sort by season desc, then level rank desc
    sorted_rows = sorted(
        rows.values(),
        key=lambda r: (r["season"], LEVEL_RANK.get(r["level"], 0)),
        reverse=True,
    )
    return sorted_rows


async def get_prospects(limit: int = 200) -> list[dict]:
    """Get all active minor leaguers (sport IDs 11-16) — sorted by level desc."""
    minor_sport_ids = [11, 12, 13, 14, 16]  # AAA, AA, A+, A, Rookie
    all_players: list[dict] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for sport_id in minor_sport_ids:
            try:
                url = f"{MLB_API}/sports/{sport_id}/players"
                response = await client.get(url, params={"season": 2025, "gameType": "R"})
                response.raise_for_status()
                data = response.json()
                for p in data.get("people", []):
                    player = _map_person(p, sport_id=sport_id)
                    all_players.append(player)
            except Exception:
                continue  # Skip levels that fail

    # Sort by level rank desc (AAA first), then by name
    all_players.sort(
        key=lambda p: (-LEVEL_RANK.get(p["level"], 0), p["name"])
    )
    return all_players[:limit]
