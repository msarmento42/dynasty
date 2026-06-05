"""Fantasy value engine for league-adjusted dynasty player values."""

from __future__ import annotations

from typing import Any


LEAGUE_CONFIG = {
    "1330499939976880128": {
        "name": "The Odin Invitational",
        "base_format": "sf",
        "n_teams": 12,
        "te_discount": 0.60,
        "scoring_bonus_multiplier": 1.0,
        "vorp_replacement_pct": 0.50,
    },
    "1315139749693886464": {
        "name": "Four Horsemen Vol. 8",
        "base_format": "1qb",
        "n_teams": 4,
        "te_discount": 1.0,
        "scoring_bonus_multiplier": 1.15,
        "vorp_replacement_pct": 0.70,
    },
    "1312285408079380481": {
        "name": "Four Horsemen All-Stars",
        "base_format": "1qb",
        "n_teams": 4,
        "te_discount": 1.0,
        "scoring_bonus_multiplier": 1.15,
        "vorp_replacement_pct": 0.70,
    },
}

AGE_CURVES = {
    "QB": {"rising": (0, 27), "prime": (27, 31), "declining": (31, 99)},
    "RB": {"rising": (0, 24), "prime": (24, 27), "declining": (27, 99)},
    "WR": {"rising": (0, 25), "prime": (25, 29), "declining": (29, 99)},
    "TE": {"rising": (0, 26), "prime": (26, 30), "declining": (30, 99)},
}


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


def classify_career_stage(position: str, age: float) -> str:
    """Return rising, prime, or declining for a player position and age."""
    curve = AGE_CURVES.get(position, {"rising": (0, 25), "prime": (25, 29), "declining": (29, 99)})
    for stage, (start, end) in curve.items():
        if start <= age < end:
            return stage
    return "declining"


def years_in_prime_remaining(position: str, age: float) -> float:
    """Estimate years remaining before the end of a player's prime window."""
    curve = AGE_CURVES.get(position)
    if not curve:
        return 0.0
    _, prime_end = curve["prime"]
    return max(0.0, round(prime_end - age, 1))


def adjusted_value(base_value: int, position: str, league_id: str) -> int:
    """Apply league-specific TE and scoring adjustments to a raw FantasyCalc value."""
    config = LEAGUE_CONFIG.get(league_id, {})
    value = float(base_value)

    if position == "TE":
        value *= float(config.get("te_discount", 1.0))
    if position in {"RB", "WR"}:
        value *= float(config.get("scoring_bonus_multiplier", 1.0))

    return int(round(value))


def pick_value(round: int, years_away: int, n_teams: int) -> int:
    """Estimate a dynasty rookie pick value by round, year distance, and league size."""
    base_values = {1: 4000, 2: 2500, 3: 1500, 4: 800}
    base = base_values.get(round, 0)
    year_discount = 0.85 ** max(0, years_away)
    scarcity = (max(n_teams, 1) / 12) ** 0.5
    return int(base * year_discount * scarcity)


def enrich_player(player: dict[str, Any], league_id: str) -> dict[str, Any]:
    """Add league-adjusted value, career stage, prime window, and trend trajectory to a player."""
    config = LEAGUE_CONFIG.get(league_id, {})
    base_format = config.get("base_format", "sf")
    base_value_key = "value_sf" if base_format == "sf" else "value_1qb"

    position = str(player.get("position") or "")
    age = _as_float(player.get("age"))
    trend_30d = _as_int(player.get("trend_30d"))
    raw_value = _as_int(player.get(base_value_key) or player.get("value_sf") or player.get("value"))

    if trend_30d > 100:
        trajectory = "+"
    elif trend_30d < -100:
        trajectory = "-"
    else:
        trajectory = "="

    enriched = dict(player)
    enriched["adjusted_value"] = adjusted_value(raw_value, position, league_id)
    enriched["career_stage"] = classify_career_stage(position, age)
    enriched["years_in_prime_remaining"] = years_in_prime_remaining(position, age)
    enriched["trajectory"] = trajectory
    return enriched
