"""Fantasy value engine — league-adjusted player values, pick valuation, daily sync."""

import math

# ── League configs ─────────────────────────────────────────────────────────

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
        "base_format": "4qb",
        "n_teams": 4,
        "te_discount": 1.0,
        "scoring_bonus_multiplier": 1.15,
        "vorp_replacement_pct": 0.70,
    },
    "1312285408079380481": {
        "name": "Four Horsemen All-Stars",
        "base_format": "4qb",
        "n_teams": 4,
        "te_discount": 1.0,
        "scoring_bonus_multiplier": 1.15,
        "vorp_replacement_pct": 0.70,
    },
}

# ── Career stage curves ─────────────────────────────────────────────────────

AGE_CURVES = {
    "QB": {"rising": (0, 27), "prime": (27, 31), "declining": (31, 99)},
    "RB": {"rising": (0, 24), "prime": (24, 27), "declining": (27, 99)},
    "WR": {"rising": (0, 25), "prime": (25, 29), "declining": (29, 99)},
    "TE": {"rising": (0, 26), "prime": (26, 30), "declining": (30, 99)},
}


def classify_career_stage(position: str, age: float) -> str:
    """Return 'rising', 'prime', or 'declining' for a player."""
    curves = AGE_CURVES.get(position, AGE_CURVES["WR"])
    if age < curves["rising"][1]:
        return "rising"
    if age < curves["prime"][1]:
        return "prime"
    return "declining"


def years_in_prime_remaining(position: str, age: float) -> float:
    """Return approximate years left in prime window (0 if already declining)."""
    curves = AGE_CURVES.get(position, AGE_CURVES["WR"])
    prime_end = curves["prime"][1]
    remaining = prime_end - age
    return max(0.0, round(remaining, 1))


# ── Value adjustments ───────────────────────────────────────────────────────

def adjusted_value(base_value: int, position: str, league_id: str) -> int:
    """Apply league-specific adjustments to a raw FantasyCalc value."""
    config = LEAGUE_CONFIG.get(league_id)
    if not config:
        return base_value

    value = float(base_value)

    # TE discount for leagues without required TE starter slot
    if position == "TE":
        value *= config["te_discount"]

    # Scoring bonus multiplier boosts volume positions (RB, WR)
    if position in ("RB", "WR"):
        value *= config["scoring_bonus_multiplier"]

    return int(value)


# ── Pick valuation ──────────────────────────────────────────────────────────

def pick_value(round: int, years_away: int, n_teams: int) -> int:
    """
    Estimate dynasty pick value.
    Base: {1: 4000, 2: 2500, 3: 1500, 4: 800}
    Discount 15% per year away. Scale by (n_teams / 12) ** 0.5.
    """
    base = {1: 4000, 2: 2500, 3: 1500, 4: 800}.get(round, 400)
    year_discount = 0.85 ** max(0, years_away)
    scarcity = math.sqrt(n_teams / 12)
    return int(base * year_discount * scarcity)


# ── Player enrichment ───────────────────────────────────────────────────────

def enrich_player(player: dict, league_id: str) -> dict:
    """
    Given a normalized player dict (from fantasycalc.py), add league-adjusted fields.

    Input keys expected: sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d
    Added keys: adjusted_value, career_stage, years_in_prime_remaining, trajectory
    """
    config = LEAGUE_CONFIG.get(league_id, {})
    base_format = config.get("base_format", "sf")
    base_val = player.get("value_sf", 0) if base_format == "sf" else player.get("value_1qb", 0)

    position = player.get("position", "WR")
    age = float(player.get("age") or 0)
    trend = player.get("trend_30d", 0) or 0

    enriched = dict(player)
    enriched["adjusted_value"] = adjusted_value(base_val, position, league_id)
    enriched["career_stage"] = classify_career_stage(position, age) if age > 0 else "unknown"
    enriched["years_in_prime_remaining"] = years_in_prime_remaining(position, age) if age > 0 else 0.0
    enriched["trajectory"] = "+" if trend > 100 else ("-" if trend < -100 else "=")

    return enriched
