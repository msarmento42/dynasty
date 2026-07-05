"""Roster grading utilities for dynasty league health."""

from collections import Counter

IR_ELIGIBLE_STATUSES = {"IR", "INJURED RESERVE", "OUT", "PUP"}
TAXI_EXCLUDED_POSITIONS = {"DEF", "K"}

POSITION_TARGETS = {
    "sf": {"QB": 2, "RB": 3, "WR": 4, "TE": 1},
    "4qb": {"QB": 4, "RB": 3, "WR": 4, "TE": 1},
    "1qb": {"QB": 1, "RB": 3, "WR": 4, "TE": 1},
}


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def letter_grade(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def weighted_average_age(players: list[dict]) -> float:
    weighted_total = 0.0
    value_total = 0.0
    for player in players:
        age = float(player.get("age") or 0)
        value = float(player.get("adjusted_value") or 0)
        if age <= 0 or value <= 0:
            continue
        weighted_total += age * value
        value_total += value
    return round(weighted_total / value_total, 1) if value_total else 0.0


def age_profile_score(avg_age: float) -> float:
    if avg_age <= 0:
        return 50.0
    if avg_age <= 25:
        return 100.0
    if avg_age <= 27:
        return 88.0
    if avg_age <= 29:
        return 72.0
    if avg_age <= 31:
        return 55.0
    return 38.0


def positional_balance_score(players: list[dict], league_id: str) -> tuple[float, dict]:
    base_format = "4qb" if league_id in {"1315139749693886464", "1312285408079380481"} else "sf"
    targets = POSITION_TARGETS.get(base_format, POSITION_TARGETS["sf"])
    counts = Counter(player.get("position") or "Other" for player in players)

    penalties = []
    for position, target in targets.items():
        count = counts.get(position, 0)
        if count < target:
            penalties.append((target - count) * 16)
        elif count > target * 3:
            penalties.append((count - target * 3) * 3)
        else:
            penalties.append(0)

    score = clamp(100 - sum(penalties))
    return score, {position: counts.get(position, 0) for position in targets}


def future_capital_score(picks: list[dict]) -> tuple[float, int]:
    pick_value_total = sum(float(pick.get("value") or 0) for pick in picks)
    pick_count_bonus = min(len(picks) * 6, 24)
    score = clamp((pick_value_total / 9000 * 76) + pick_count_bonus)
    return score, int(pick_value_total)


def grade_roster(players: list[dict], picks: list[dict], league_id: str) -> dict:
    """Return a 0-100 dynasty roster score and A-F grade."""
    total_value = sum(float(player.get("adjusted_value") or 0) for player in players)
    value_score = clamp(total_value / 1000)

    avg_age = weighted_average_age(players)
    age_score = age_profile_score(avg_age)
    balance_score, position_counts = positional_balance_score(players, league_id)
    capital_score, pick_value_total = future_capital_score(picks)

    score = round(
        (value_score * 0.40)
        + (age_score * 0.30)
        + (balance_score * 0.20)
        + (capital_score * 0.10),
        1,
    )

    return {
        "score": score,
        "letter": letter_grade(score),
        "breakdown": {
            "total_value": int(total_value),
            "value_score": round(value_score, 1),
            "average_age": avg_age,
            "age_score": round(age_score, 1),
            "balance_score": round(balance_score, 1),
            "future_capital_score": round(capital_score, 1),
            "future_capital_value": pick_value_total,
            "position_counts": position_counts,
        },
    }


def is_ir_eligible(player: dict) -> bool:
    status = str(player.get("injury_status") or "").strip().upper()
    return status in IR_ELIGIBLE_STATUSES or "INJURED RESERVE" in status


def is_taxi_eligible(player: dict) -> bool:
    position = str(player.get("position") or "").upper()
    if position in TAXI_EXCLUDED_POSITIONS:
        return False

    years_exp = player.get("years_exp")
    if years_exp is not None:
        try:
            return float(years_exp) <= 1
        except (TypeError, ValueError):
            pass

    age = player.get("age")
    try:
        return float(age) <= 23
    except (TypeError, ValueError):
        return False


def roster_slot_management_flags(
    players: list[dict],
    active_ids: set[str],
    reserve_ids: set[str],
    taxi_ids: set[str],
    *,
    reserve_slots: int = 0,
    taxi_slots: int = 0,
) -> list[dict]:
    """Flag players who qualify for a non-active slot but are still active."""
    flags = []
    for player in players:
        sleeper_id = str(player.get("sleeper_id") or "")
        if not sleeper_id or sleeper_id not in active_ids:
            continue

        if reserve_slots > 0 and is_ir_eligible(player) and sleeper_id not in reserve_ids:
            flags.append({
                "player_id": sleeper_id,
                "player_name": player.get("full_name") or player.get("name") or sleeper_id,
                "position": player.get("position"),
                "team": player.get("team"),
                "current_slot": "active",
                "recommended_slot": "IR",
                "reason": f"{player.get('injury_status') or 'injured'} status is IR-eligible.",
                "suggested_fix": f"Move {player.get('full_name') or player.get('name') or sleeper_id} to IR.",
            })

        if taxi_slots > 0 and is_taxi_eligible(player) and sleeper_id not in taxi_ids:
            flags.append({
                "player_id": sleeper_id,
                "player_name": player.get("full_name") or player.get("name") or sleeper_id,
                "position": player.get("position"),
                "team": player.get("team"),
                "current_slot": "active",
                "recommended_slot": "Taxi",
                "reason": "Rookie or young player profile is taxi-eligible.",
                "suggested_fix": f"Move {player.get('full_name') or player.get('name') or sleeper_id} to a taxi slot.",
            })

    return flags
