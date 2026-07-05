"""Fantasy value engine - league-adjusted player values, pick valuation, daily sync."""

import math
from datetime import datetime, timezone

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

AGE_CURVE_PEAKS = {"QB": 28, "RB": 24, "WR": 26, "TE": 27}
AGE_CURVE_DECAY = {
    "QB": {"pre_peak": 0.018, "post_peak": 0.035},
    "RB": {"pre_peak": 0.035, "post_peak": 0.105},
    "WR": {"pre_peak": 0.026, "post_peak": 0.060},
    "TE": {"pre_peak": 0.024, "post_peak": 0.050},
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


def age_curve_multiplier(position: str, age: float) -> float:
    """Return a position-specific dynasty value multiplier for the given age."""
    pos = position if position in AGE_CURVE_PEAKS else "WR"
    peak_age = AGE_CURVE_PEAKS[pos]
    decay = AGE_CURVE_DECAY[pos]
    if age <= 0:
        return 1.0
    if age <= peak_age:
        return max(0.65, 1 - ((peak_age - age) * decay["pre_peak"]))
    return max(0.25, 1 - ((age - peak_age) * decay["post_peak"]))


def project_age_curve_values(player: dict, current_value: int, years: tuple = (1, 3, 5)) -> dict:
    """Project current dynasty value forward using position-specific age curves."""
    position = player.get("position") or "WR"
    age = float(player.get("age") or 0)
    safe_value = max(0, int(current_value or 0))
    current_multiplier = age_curve_multiplier(position, age) or 1.0
    projections = []

    for year in years:
        future_age = round(age + year, 1) if age > 0 else None
        future_multiplier = age_curve_multiplier(position, future_age or age)
        projected_value = (
            round(safe_value * (future_multiplier / current_multiplier))
            if current_multiplier
            else safe_value
        )
        projections.append({
            "year": year,
            "age": future_age,
            "multiplier": round(future_multiplier, 3),
            "projected_value": max(0, projected_value),
        })

    return {
        "position": position,
        "current_age": age or None,
        "current_value": safe_value,
        "current_multiplier": round(current_multiplier, 3),
        "peak_age": AGE_CURVE_PEAKS.get(position, AGE_CURVE_PEAKS["WR"]),
        "projections": projections,
    }


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


def startup_adjusted_value(player: dict, league_id: str, draft_position: int = None) -> dict:
    """
    Return startup-draft calibrated value details for one enriched player.

    Startup drafts overvalue long-term rookie insulation and early positional scarcity.
    This keeps the normal in-season value intact and exposes a separate adjusted value
    that callers can opt into with mode=startup.
    """
    position = (player.get("position") or "WR").upper()
    base_value = float(player.get("adjusted_value") or player.get("value_sf") or player.get("value_1qb") or 0)
    age = float(player.get("age") or 0)
    config = LEAGUE_CONFIG.get(league_id, {})
    base_format = config.get("base_format", "sf")
    safe_pick = max(1, int(draft_position or 1))

    rookie_multiplier = 1.0
    if age and age <= 22:
        rookie_multiplier = 1.22
    elif age and age <= 23:
        rookie_multiplier = 1.14

    position_multiplier = {
        "QB": 1.12 if base_format in ("sf", "4qb") else 1.02,
        "WR": 1.08,
        "TE": 1.04,
        "RB": 0.94,
    }.get(position, 1.0)

    pick_window_multiplier = 1.0
    if safe_pick <= 24:
        pick_window_multiplier += {"QB": 0.08, "WR": 0.05, "TE": 0.03, "RB": -0.02}.get(position, 0.0)
    elif safe_pick <= 60:
        pick_window_multiplier += {"QB": 0.04, "WR": 0.03, "TE": 0.02, "RB": -0.01}.get(position, 0.0)

    multiplier = max(0.75, rookie_multiplier * position_multiplier * pick_window_multiplier)
    startup_value = round(base_value * multiplier)

    return {
        "startup_value": int(startup_value),
        "startup_delta": int(startup_value - base_value),
        "startup_multiplier": round(multiplier, 3),
        "startup_context": {
            "draft_position": safe_pick,
            "rookie_multiplier": round(rookie_multiplier, 3),
            "position_multiplier": round(position_multiplier, 3),
            "pick_window_multiplier": round(pick_window_multiplier, 3),
        },
    }


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


def startup_pick_value(round: int, years_away: int, n_teams: int, draft_position: int = None) -> int:
    """
    Estimate pick value in startup-draft mode.

    Picks become primary currency in startup rooms. Earlier picks and larger league
    formats get a stronger premium while future-pick discounting remains intact.
    """
    base_value = pick_value(round, years_away, n_teams)
    safe_pick = max(1, int(draft_position or 1))
    if safe_pick <= 12:
        slot_multiplier = 1.35
    elif safe_pick <= 24:
        slot_multiplier = 1.22
    elif safe_pick <= 60:
        slot_multiplier = 1.12
    else:
        slot_multiplier = 1.05

    round_multiplier = {1: 1.18, 2: 1.10, 3: 1.04, 4: 1.0}.get(round, 0.95)
    league_multiplier = 1 + min(0.12, max(0, n_teams - 12) * 0.015)
    return int(base_value * slot_multiplier * round_multiplier * league_multiplier)


# -- Positional impact ------------------------------------------------------

TRADE_POSITIONS = ("QB", "RB", "WR", "TE")
VALUE_TREND_BUY_THRESHOLD = 8.0
VALUE_TREND_SELL_THRESHOLD = -8.0


def _player_value(player: dict) -> float:
    return float(player.get("adjusted_value") or player.get("value_sf") or player.get("value_1qb") or 0)


def _parse_timestamp(value: str):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _days_between(start: datetime, end: datetime) -> float:
    return max(0.0, (end - start).total_seconds() / 86400)


def linear_regression_slope(points: list) -> float:
    """Return value points per day for dated value history."""
    if len(points) < 2:
        return 0.0

    dated_points = [
        (_parse_timestamp(point.get("snapshot_date")), float(point.get("value") or 0))
        for point in points
        if point.get("snapshot_date") and point.get("value") is not None
    ]
    dated_points = [(date, value) for date, value in dated_points if date is not None]
    if len(dated_points) < 2:
        return 0.0

    first_date = dated_points[0][0]
    xs = [_days_between(first_date, date) for date, _ in dated_points]
    ys = [value for _, value in dated_points]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        return 0.0

    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    return round(numerator / denominator, 2)


def player_value_trend(snapshot_rows: list) -> dict:
    """Aggregate player value snapshots into 30/90-day windows and a buy/sell signal."""
    points = []
    for row in snapshot_rows:
        snapshot_date = row.get("snapshot_date")
        value = row.get("value_sf")
        parsed = _parse_timestamp(snapshot_date)
        if parsed is None or value is None:
            continue
        points.append({
            "snapshot_date": parsed.date().isoformat(),
            "value": int(value),
            "parsed_date": parsed,
        })

    points.sort(key=lambda item: item["parsed_date"])
    if not points:
        return {
            "window_30d": [],
            "window_90d": [],
            "slope_30d": 0.0,
            "slope_90d": 0.0,
            "signal": "HOLD",
            "signal_reason": "Not enough value history yet.",
        }

    latest_date = points[-1]["parsed_date"]

    def window(days: int) -> list:
        cutoff_days = max(0, days)
        return [
            {"snapshot_date": point["snapshot_date"], "value": point["value"]}
            for point in points
            if _days_between(point["parsed_date"], latest_date) <= cutoff_days
        ]

    window_30d = window(30)
    window_90d = window(90)
    slope_30d = linear_regression_slope(window_30d)
    slope_90d = linear_regression_slope(window_90d)
    blended_slope = (slope_30d * 0.7) + (slope_90d * 0.3)

    if blended_slope >= VALUE_TREND_BUY_THRESHOLD:
        signal = "BUY"
        reason = "Recent value trend is rising faster than the buy threshold."
    elif blended_slope <= VALUE_TREND_SELL_THRESHOLD:
        signal = "SELL"
        reason = "Recent value trend is falling faster than the sell threshold."
    else:
        signal = "HOLD"
        reason = "Recent value trend is within the hold band."

    return {
        "window_30d": window_30d,
        "window_90d": window_90d,
        "slope_30d": slope_30d,
        "slope_90d": slope_90d,
        "blended_slope": round(blended_slope, 2),
        "signal": signal,
        "signal_reason": reason,
        "thresholds": {
            "buy": VALUE_TREND_BUY_THRESHOLD,
            "sell": VALUE_TREND_SELL_THRESHOLD,
        },
    }


def _similarity_component(delta: float, scale: float) -> float:
    return max(0.0, 1.0 - (abs(float(delta or 0)) / max(scale, 1.0)))


def _opportunity_tier(player: dict) -> int:
    depth = player.get("depth_chart_order")
    if depth is not None:
        try:
            depth_number = int(depth)
        except (TypeError, ValueError):
            depth_number = None
        if depth_number is not None:
            if depth_number <= 1:
                return 3
            if depth_number <= 3:
                return 2
            return 1

    value = float(player.get("value_sf") or player.get("value_1qb") or 0)
    if value >= 4500:
        return 3
    if value >= 1500:
        return 2
    return 1


def compute_player_comps(target: dict, candidates: list[dict], limit: int = 3) -> list[dict]:
    """
    Rank same-position historical comps from available local metadata.

    The original AGIOS contract names draft age, draft round, and opportunity tier.
    The current players table does not store draft metadata, so this uses the
    available proxy set: age, position, value band, and depth/value opportunity.
    """
    target_position = (target.get("position") or "").upper()
    target_age = float(target.get("age") or 0)
    target_value = float(target.get("value_sf") or target.get("value_1qb") or 0)
    target_opportunity = _opportunity_tier(target)
    ranked = []

    for candidate in candidates:
        if candidate.get("sleeper_id") == target.get("sleeper_id"):
            continue
        if (candidate.get("position") or "").upper() != target_position:
            continue

        candidate_age = float(candidate.get("age") or 0)
        candidate_value = float(candidate.get("value_sf") or candidate.get("value_1qb") or 0)
        candidate_opportunity = _opportunity_tier(candidate)
        age_score = _similarity_component(candidate_age - target_age, 4.0) if target_age and candidate_age else 0.45
        value_scale = max(target_value, candidate_value, 1000.0)
        value_score = _similarity_component(candidate_value - target_value, value_scale)
        opportunity_score = _similarity_component(candidate_opportunity - target_opportunity, 2.0)
        score = round(((age_score * 0.38) + (value_score * 0.34) + (opportunity_score * 0.28)) * 100, 1)

        ranked.append({
            **candidate,
            "similarity_score": score,
            "factors": {
                "age_delta": round(candidate_age - target_age, 1) if target_age and candidate_age else None,
                "value_delta": round(candidate_value - target_value),
                "target_opportunity_tier": target_opportunity,
                "comp_opportunity_tier": candidate_opportunity,
                "draft_metadata": "unavailable",
            },
        })

    ranked.sort(key=lambda item: item["similarity_score"], reverse=True)
    return ranked[: max(1, int(limit or 3))]


def data_confidence(
    *,
    value: int = 0,
    updated_at: str = None,
    stale_after_hours: int = 36,
    source: str = "FantasyCalc",
) -> dict:
    """Summarize whether a value can be trusted by the UI and recommendation engine."""
    warnings = []
    timestamp = _parse_timestamp(updated_at)
    age_hours = None

    if not value:
        warnings.append("missing value")
    if timestamp is None:
        warnings.append("missing timestamp")
    else:
        age_hours = max(0, round((datetime.now(timezone.utc) - timestamp).total_seconds() / 3600, 1))
        if age_hours > stale_after_hours:
            warnings.append(f"stale {source} data")

    if not warnings:
        level = "high"
        label = "Fresh"
    elif len(warnings) == 1 and value:
        level = "medium"
        label = "Review"
    else:
        level = "low"
        label = "Low trust"

    return {
        "level": level,
        "label": label,
        "source": source,
        "updated_at": updated_at,
        "age_hours": age_hours,
        "warnings": warnings,
    }


def aggregate_confidence(players: list) -> dict:
    """Roll player confidence metadata into a recommendation-level signal."""
    if not players:
        return {"level": "low", "label": "No players", "warnings": ["missing player data"]}

    levels = [p.get("data_confidence", {}).get("level", "low") for p in players]
    warnings = []
    for player in players:
        for warning in player.get("data_confidence", {}).get("warnings", []):
            if warning not in warnings:
                warnings.append(warning)

    if "low" in levels:
        level = "low"
        label = "Low trust"
    elif "medium" in levels:
        level = "medium"
        label = "Review"
    else:
        level = "high"
        label = "Fresh"

    return {"level": level, "label": label, "warnings": warnings}


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


def _gini(values: list[float]) -> float:
    """Return a 0-1 inequality score for a list of non-negative values."""
    safe_values = sorted(max(0.0, float(value or 0)) for value in values)
    if not safe_values or sum(safe_values) <= 0:
        return 0.0

    count = len(safe_values)
    weighted_sum = sum((index + 1) * value for index, value in enumerate(safe_values))
    return ((2 * weighted_sum) / (count * sum(safe_values))) - ((count + 1) / count)


def _scarcity_label(score: int) -> str:
    if score >= 70:
        return "Critical leverage"
    if score >= 45:
        return "Scarce"
    if score >= 25:
        return "Moderate"
    return "Evenly distributed"


def positional_scarcity_index(teams: list[dict], positions: tuple = TRADE_POSITIONS) -> list[dict]:
    """
    Compute per-position scarcity from rostered dynasty value distribution.

    Higher scores mean quality at that position is concentrated on fewer teams,
    which creates trade leverage for managers with strong starters there.
    """
    team_count = max(1, len(teams))
    expected_share = 1 / team_count
    result = []

    for position in positions:
        team_values = []
        total_value = 0.0
        for team in teams:
            value = sum(
                float(player.get("adjusted_value") or player.get("value_sf") or player.get("value_1qb") or 0)
                for player in team.get("players", [])
                if (player.get("position") or "").upper() == position
            )
            total_value += value
            team_values.append({
                "roster_id": team.get("roster_id"),
                "team_name": team.get("team_name") or team.get("owner") or f"Team {team.get('roster_id')}",
                "is_mine": bool(team.get("is_mine")),
                "value": round(value),
            })

        team_values.sort(key=lambda item: item["value"], reverse=True)
        for rank, item in enumerate(team_values, 1):
            item["rank"] = rank
            item["share_pct"] = round((item["value"] / total_value * 100) if total_value else 0, 1)

        top_share = (team_values[0]["value"] / total_value) if total_value and team_values else 0
        gini = _gini([item["value"] for item in team_values])
        score = round(min(100, max(0, (gini * 85) + max(0, top_share - expected_share) * 180)))

        result.append({
            "position": position,
            "scarcity_score": score,
            "scarcity_label": _scarcity_label(score),
            "distribution_quality": round(gini, 3),
            "league_total_value": round(total_value),
            "top_team": team_values[0] if team_values else None,
            "teams": team_values,
        })

    return result


def find_trade_partner_buyers(target_player: dict, rosters: list[dict], limit: int = 8) -> list[dict]:
    """
    Rank managers who are most likely to need the target player's position.

    Uses the same roster-value inputs as the team-needs surface: per-position
    rostered dynasty value, player count depth, and league averages.
    """
    position = str(target_player.get("position") or "").upper()
    if position not in TRADE_POSITIONS:
        return []

    position_rows = []
    for roster in rosters:
        players = roster.get("players", [])
        position_players = [
            player for player in players
            if str(player.get("position") or "").upper() == position
        ]
        position_value = sum(_player_value(player) for player in position_players)
        position_rows.append({
            "roster": roster,
            "players": sorted(position_players, key=_player_value, reverse=True),
            "position_count": len(position_players),
            "position_value": position_value,
        })

    if not position_rows:
        return []

    avg_value = sum(row["position_value"] for row in position_rows) / len(position_rows)
    avg_count = sum(row["position_count"] for row in position_rows) / len(position_rows)
    max_value = max((row["position_value"] for row in position_rows), default=0) or 1
    target_value = _player_value(target_player)
    ranked = []

    for row in position_rows:
        roster = row["roster"]
        if roster.get("is_mine"):
            continue
        roster_player_ids = {
            str(player.get("sleeper_id"))
            for player in roster.get("players", [])
            if player.get("sleeper_id") is not None
        }
        if str(target_player.get("sleeper_id")) in roster_player_ids:
            continue

        value_gap = max(0.0, avg_value - row["position_value"])
        depth_gap = max(0.0, avg_count - row["position_count"])
        low_value_score = (value_gap / max(avg_value, 1.0)) * 55
        low_depth_score = min(25.0, depth_gap * 15)
        target_fit_score = min(20.0, (target_value / max(max_value, target_value, 1.0)) * 20)
        score = round(min(100.0, low_value_score + low_depth_score + target_fit_score), 1)

        if score <= 0:
            continue

        top_players = row["players"][:3]
        ranked.append({
            "league_id": roster.get("league_id"),
            "league_name": roster.get("league_name"),
            "roster_id": roster.get("roster_id"),
            "manager": roster.get("owner") or roster.get("team_name") or f"Team {roster.get('roster_id')}",
            "position": position,
            "score": score,
            "position_value": round(row["position_value"]),
            "league_avg_position_value": round(avg_value),
            "position_count": row["position_count"],
            "league_avg_position_count": round(avg_count, 1),
            "value_gap": round(value_gap),
            "depth_gap": round(depth_gap, 1),
            "top_position_players": [
                {
                    "sleeper_id": player.get("sleeper_id"),
                    "name": player.get("name"),
                    "team": player.get("team"),
                    "value": round(_player_value(player)),
                }
                for player in top_players
            ],
            "reason": (
                f"{position} value is {round(value_gap):,} below league average"
                if value_gap > 0
                else f"{position} depth is below league average"
            ),
        })

    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked[: max(1, int(limit or 8))]


# -- Strength of schedule ---------------------------------------------------

def _sos_label(score: int) -> str:
    if score >= 70:
        return "Favorable"
    if score >= 45:
        return "Neutral"
    return "Difficult"


def compute_schedule_sos(
    player: dict,
    opponents: list[dict],
    defensive_allowed: dict[str, dict],
    weeks: int = 4,
) -> dict:
    """Compute a 0-100 upcoming schedule score for a player."""
    position = str(player.get("position") or "").upper()
    requested_weeks = max(1, min(int(weeks or 4), 8))
    upcoming = opponents[:requested_weeks]

    position_values = [
        float(team_stats.get(position, {}).get("avg_points_allowed"))
        for team_stats in defensive_allowed.values()
        if team_stats.get(position, {}).get("avg_points_allowed") is not None
    ]
    if position not in TRADE_POSITIONS:
        return {
            "available": False,
            "reason": "Schedule scoring is only available for QB, RB, WR, and TE.",
            "sos_score": None,
            "sos_label": "Unavailable",
            "opponents": upcoming,
        }
    if not upcoming:
        return {
            "available": False,
            "reason": "Upcoming opponent data is not available from Sleeper yet.",
            "sos_score": None,
            "sos_label": "Unavailable",
            "opponents": [],
        }
    if not position_values:
        return {
            "available": False,
            "reason": "Defensive points-allowed data is not available from Sleeper weekly stats yet.",
            "sos_score": None,
            "sos_label": "Unavailable",
            "opponents": upcoming,
        }

    league_avg = sum(position_values) / len(position_values)
    spread = max(position_values) - min(position_values)
    if spread <= 0:
        spread = max(league_avg, 1.0)

    matchup_rows = []
    score_total = 0.0
    scored_games = 0
    for item in upcoming:
        opponent = str(item.get("opponent") or "").upper()
        allowed_payload = defensive_allowed.get(opponent, {}).get(position, {})
        allowed = allowed_payload.get("avg_points_allowed")
        if allowed is None:
            matchup_score = None
            matchup_label = "Unknown"
        else:
            matchup_score = round(max(0, min(100, 50 + ((float(allowed) - league_avg) / spread) * 50)))
            matchup_label = _sos_label(matchup_score)
            score_total += matchup_score
            scored_games += 1

        matchup_rows.append({
            **item,
            "position": position,
            "avg_points_allowed": allowed,
            "sample_size": allowed_payload.get("sample_size"),
            "matchup_score": matchup_score,
            "matchup_label": matchup_label,
        })

    if scored_games == 0:
        return {
            "available": False,
            "reason": "No upcoming opponents have defensive points-allowed data yet.",
            "sos_score": None,
            "sos_label": "Unavailable",
            "opponents": matchup_rows,
        }

    score = round(score_total / scored_games)
    return {
        "available": True,
        "reason": None,
        "sos_score": score,
        "sos_label": _sos_label(score),
        "position": position,
        "weeks": requested_weeks,
        "league_average_points_allowed": round(league_avg, 2),
        "opponents": matchup_rows,
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
    enriched["full_name"] = enriched.get("full_name") or enriched.get("name")
    enriched["adjusted_value"] = adjusted_value(base_val, position, league_id)
    enriched["career_stage"] = classify_career_stage(position, age) if age > 0 else "unknown"
    enriched["years_in_prime_remaining"] = years_in_prime_remaining(position, age) if age > 0 else 0.0
    enriched["trajectory"] = "+" if trend > 100 else ("-" if trend < -100 else "=")
    startup_value = startup_adjusted_value(enriched, league_id)
    enriched["startup_adjusted_value"] = startup_value["startup_value"]
    enriched["startup_delta"] = startup_value["startup_delta"]
    enriched["startup_multiplier"] = startup_value["startup_multiplier"]
    enriched["data_confidence"] = data_confidence(
        value=enriched["adjusted_value"],
        updated_at=enriched.get("updated_at"),
    )

    premium = qb_premium(enriched, league_id)
    if premium:
        enriched["qb_premium"] = premium

    return enriched
