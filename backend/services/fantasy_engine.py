"""Fantasy value engine - league-adjusted player values, pick valuation, daily sync."""

import math

# -- League configs ---------------------------------------------------------

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

# -- Career stage curves ----------------------------------------------------

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


# -- Value adjustments ------------------------------------------------------

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


def qb_premium(player: dict, league_id: str):
    """Return QB value inflation details for Four Horsemen 4QB leagues."""
    config = LEAGUE_CONFIG.get(league_id, {})
    if config.get("base_format") != "4qb" or player.get("position") != "QB":
        return None

    value_sf = float(player.get("value_sf") or 0)
    value_1qb = float(player.get("value_1qb") or 0)
    if value_1qb <= 0:
        return None

    multiplier = round(value_sf / value_1qb, 2)
    if multiplier > 1.8:
        label = "4QB Target"
    elif multiplier < 1.2:
        label = "Format Neutral"
    else:
        label = "Overvalued in 4QB"

    return {
        "value_sf": int(value_sf),
        "value_1qb": int(value_1qb),
        "premium_multiplier": multiplier,
        "label": label,
    }


# -- Pick valuation ---------------------------------------------------------

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


# -- Positional impact ------------------------------------------------------

TRADE_POSITIONS = ("QB", "RB", "WR", "TE")


def positional_counts(players: list) -> dict:
    """Count fantasy-relevant player positions in a list of enriched players."""
    counts = {position: 0 for position in TRADE_POSITIONS}
    for player in players:
        position = (player.get("position") or "").upper()
        if position in counts:
            counts[position] += 1
    return counts


def trade_positional_impact(side_a_players: list, side_b_players: list) -> dict:
    """
    Return net positional changes for both sides of a trade.

    In the Trade Builder, side A is Marcus' outgoing side and side B is the
    incoming side, so "you" gain side B positions and lose side A positions.
    """
    side_a_counts = positional_counts(side_a_players)
    side_b_counts = positional_counts(side_b_players)

    positions = []
    for position in TRADE_POSITIONS:
        you_delta = side_b_counts[position] - side_a_counts[position]
        them_delta = -you_delta
        positions.append({
            "position": position,
            "you": you_delta,
            "them": them_delta,
            "you_send": side_a_counts[position],
            "you_receive": side_b_counts[position],
        })

    return {
        "positions": positions,
        "you": {item["position"]: item["you"] for item in positions},
        "them": {item["position"]: item["them"] for item in positions},
    }


# -- Player enrichment ------------------------------------------------------

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

    premium = qb_premium(enriched, league_id)
    if premium:
        enriched["qb_premium"] = premium

    return enriched
