"""Trade proposal engine — auto-generates ranked trade proposals per league."""

import json
from itertools import combinations
from datetime import datetime, timezone

import aiosqlite

from backend.database import DB_PATH
from backend.services.fantasy_engine import LEAGUE_CONFIG, aggregate_confidence, pick_value


POSITIONS = ["QB", "RB", "WR", "TE"]
VALUE_MODES = {"dynasty", "redraft"}
STRATEGIES = {"balanced", "win_now", "rebuild"}


async def _load_all_rosters(db: aiosqlite.Connection, league_id: str) -> list:
    """Return list of {roster_id, owner, is_mine, players: [...enriched]}."""
    from backend.routers.fantasy import get_league_row, get_players_for_ids
    league = await get_league_row(db, league_id)
    my_id = league["config"].get("my_roster_id", league["my_roster_id"])

    async with db.execute(
        "SELECT roster_id, owner_display_name, player_ids_json "
        "FROM rosters WHERE league_id=? ORDER BY roster_id",
        (league_id,),
    ) as cur:
        rows = await cur.fetchall()

    result = []
    for r in rows:
        roster_id, owner, pid_json = r[0], r[1], r[2]
        player_ids = json.loads(pid_json or "[]")
        players = await get_players_for_ids(db, player_ids, league_id)
        result.append({
            "roster_id": roster_id,
            "owner": owner or f"Team {roster_id}",
            "is_mine": roster_id == my_id,
            "players": players,
        })
    return result


def _position_values(players: list, mode: str) -> dict:
    """Sum trade value by position for a player list."""
    vals = {pos: 0 for pos in POSITIONS}
    for p in players:
        pos = p.get("position", "")
        if pos in vals:
            vals[pos] += _player_value(p, mode)
    return vals


def _redraft_player_value(player: dict) -> float:
    """Estimate current-season value from dynasty value, age, trend, and injury state."""
    value = float(player.get("adjusted_value", 0) or 0)
    age = float(player.get("age") or 0)
    position = player.get("position")
    trend = float(player.get("trend_30d", 0) or 0)
    injury = (player.get("injury_status") or "").lower()

    multiplier = 1.0
    if age:
        if position == "RB":
            if age < 22:
                multiplier = 0.82
            elif age <= 27:
                multiplier = 1.08
            elif age >= 30:
                multiplier = 0.72
            else:
                multiplier = 0.9
        elif position in {"WR", "TE"}:
            if age < 23:
                multiplier = 0.86
            elif age <= 29:
                multiplier = 1.05
            elif age >= 32:
                multiplier = 0.78
            else:
                multiplier = 0.92
        elif position == "QB":
            if age < 24:
                multiplier = 0.88
            elif age <= 34:
                multiplier = 1.03
            else:
                multiplier = 0.9

    if trend:
        multiplier += max(-0.12, min(0.12, trend / 2500))
    if injury and injury not in {"healthy", "active"}:
        multiplier -= 0.18

    return round(max(0, value * multiplier), 1)


def _player_value(player: dict, mode: str) -> float:
    if mode == "redraft":
        return _redraft_player_value(player)
    return float(player.get("adjusted_value", 0) or 0)


def _pick_mode_value(pick: dict, mode: str) -> float:
    return 0 if mode == "redraft" else float(pick.get("value", 0) or 0)


def _side_value(players: list, picks: list, mode: str) -> float:
    return (
        sum(_player_value(player, mode) for player in players)
        + sum(_pick_mode_value(pick, mode) for pick in picks)
    )


def _youth_value(players: list, picks: list) -> float:
    score = sum(max(0, 28 - float(player.get("age") or 28)) * 35 for player in players)
    return score + sum(float(pick.get("value", 0) or 0) for pick in picks)


def _side_summary(players: list, picks: list) -> dict:
    return {
        "player_ids": [p["sleeper_id"] for p in players],
        "player_names": [p.get("name") or p["sleeper_id"] for p in players],
        "players": [
            {
                "sleeper_id": p["sleeper_id"],
                "name": p.get("name") or p["sleeper_id"],
                "position": p.get("position"),
                "team": p.get("team"),
                "age": p.get("age"),
                "dynasty_value": p.get("adjusted_value", 0),
                "redraft_value": _redraft_player_value(p),
                "trend_30d": p.get("trend_30d", 0),
            }
            for p in players
        ],
        "picks": picks,
    }


def _strategy_score(
    strategy: str,
    complementarity: float,
    dynasty_delta: float,
    redraft_delta: float,
    win_now_gain: float,
    long_term_cost: float,
) -> float:
    base = complementarity
    if strategy == "win_now":
        return base + (win_now_gain * 8) + (redraft_delta * 2) - (max(0, long_term_cost) * 1.5)
    if strategy == "rebuild":
        return base + (dynasty_delta * 2) - (win_now_gain * 2) - long_term_cost
    return base + dynasty_delta + redraft_delta + win_now_gain - max(0, long_term_cost)


def _surplus_deficit(my_vals: dict, avg_vals: dict) -> dict:
    """Positive = surplus, negative = deficit."""
    return {pos: my_vals[pos] - avg_vals[pos] for pos in POSITIONS}


def _justification(
    my_surplus: dict,
    their_surplus: dict,
    side_a_players: list,
    side_b_players: list,
    value_mode: str,
    strategy: str,
) -> str:
    """Generate a 1-sentence trade rationale."""
    # Find what I'm giving up (my surplus positions) and gaining (my deficit positions)
    giving_pos = max(my_surplus, key=lambda p: my_surplus[p])
    gaining_pos = min(my_surplus, key=lambda p: my_surplus[p])

    a_ages = [p.get("age") or 0 for p in side_a_players if p.get("age")]
    b_ages = [p.get("age") or 0 for p in side_b_players if p.get("age")]
    avg_a = round(sum(a_ages) / len(a_ages), 1) if a_ages else 0
    avg_b = round(sum(b_ages) / len(b_ages), 1) if b_ages else 0
    age_diff = round(avg_b - avg_a, 1)
    age_note = f"Age delta: {abs(age_diff)} yrs {'younger' if age_diff < 0 else 'older'}." if age_diff != 0 else ""

    mode_label = "redraft" if value_mode == "redraft" else "dynasty"
    strategy_label = strategy.replace("_", "-")
    return (
        f"You improve at {gaining_pos} while trading from {giving_pos} surplus. "
        f"Ranked for {mode_label} value and {strategy_label} strategy. {age_note}"
    ).strip()


async def generate_proposals(league_id: str, value_mode: str = "dynasty", strategy: str = "balanced") -> list:
    """
    Generate ranked trade proposals for the given league.
    Returns list of proposal dicts sorted by score descending.
    """
    value_mode = str(value_mode or "dynasty").strip().lower().replace("-", "_")
    strategy = str(strategy or "balanced").strip().lower().replace("-", "_")
    value_mode = value_mode if value_mode in VALUE_MODES else "dynasty"
    strategy = strategy if strategy in STRATEGIES else "balanced"
    cfg = LEAGUE_CONFIG.get(league_id, {})
    n_teams = cfg.get("n_teams", 12)
    current_year = datetime.now(timezone.utc).year

    async with aiosqlite.connect(DB_PATH) as db:
        rosters = await _load_all_rosters(db, league_id)

    if not rosters:
        return []

    # Compute league average position values
    all_pos_vals = [_position_values(r["players"], value_mode) for r in rosters]
    avg_vals = {
        pos: sum(v[pos] for v in all_pos_vals) / len(all_pos_vals)
        for pos in POSITIONS
    }

    my_roster = next((r for r in rosters if r["is_mine"]), None)
    if not my_roster:
        return []

    my_vals = _position_values(my_roster["players"], value_mode)
    my_surplus = _surplus_deficit(my_vals, avg_vals)

    proposals = []

    for their_roster in rosters:
        if their_roster["is_mine"]:
            continue

        their_vals = _position_values(their_roster["players"], value_mode)
        their_surplus = _surplus_deficit(their_vals, avg_vals)

        # Complementarity: their surplus aligns with my deficit
        complementarity = sum(
            max(0, their_surplus[pos]) * max(0, -my_surplus[pos])
            for pos in POSITIONS
        )
        if complementarity <= 0:
            continue

        # Generate 1-for-1 and 2-for-1 swaps between surplus/deficit positions
        my_trade_candidates = [
            p for p in my_roster["players"]
            if p.get("position") in POSITIONS
            and my_surplus.get(p.get("position"), 0) > 0
        ]
        their_trade_candidates = [
            p for p in their_roster["players"]
            if p.get("position") in POSITIONS
            and their_surplus.get(p.get("position"), 0) > 0
        ]

        # Sort by the selected value basis so redraft and dynasty produce different proposals.
        my_trade_candidates.sort(key=lambda p: _player_value(p, value_mode), reverse=True)
        their_trade_candidates.sort(key=lambda p: _player_value(p, value_mode), reverse=True)

        swap_sets = []
        # 1-for-1
        for mp in my_trade_candidates[:4]:
            for tp in their_trade_candidates[:4]:
                swap_sets.append(([mp], [tp]))
        # 2-for-1 (I send 2, receive 1)
        for mp_pair in list(combinations(my_trade_candidates[:4], 2)):
            for tp in their_trade_candidates[:3]:
                swap_sets.append((list(mp_pair), [tp]))
        # 1-for-2 (I send 1, receive 2)
        for mp in my_trade_candidates[:3]:
            for tp_pair in list(combinations(their_trade_candidates[:4], 2)):
                swap_sets.append(([mp], list(tp_pair)))

        for side_a_players, side_b_players in swap_sets:
            a_val = sum(_player_value(p, value_mode) for p in side_a_players)
            b_val = sum(_player_value(p, value_mode) for p in side_b_players)

            if a_val == 0:
                continue

            # Try to balance with a pick if off by 10-25%
            extra_picks = []
            delta_pct = (b_val - a_val) / a_val * 100

            if value_mode == "dynasty" and -25 < delta_pct < -10:
                # I'm giving too much — ask for a pick back
                gap = a_val - b_val
                for rnd in [2, 3]:
                    pval = pick_value(rnd, 1, n_teams)
                    if abs(gap - pval) / a_val < 0.08:
                        extra_picks = [{"side": "b", "round": rnd, "year": current_year + 1, "value": pval}]
                        b_val += pval
                        break
            elif value_mode == "dynasty" and 10 < delta_pct < 25:
                # I'm getting too much — offer a pick
                gap = b_val - a_val
                for rnd in [2, 3]:
                    pval = pick_value(rnd, 1, n_teams)
                    if abs(gap - pval) / b_val < 0.08:
                        extra_picks = [{"side": "a", "round": rnd, "year": current_year + 1, "value": pval}]
                        a_val += pval
                        break

            if a_val == 0:
                continue
            final_delta_pct = (b_val - a_val) / a_val * 100

            # Only keep fair-range proposals
            if abs(final_delta_pct) > 15:
                continue

            # Position improvement: does this trade help my deficits?
            a_positions = {p.get("position") for p in side_a_players}
            b_positions = {p.get("position") for p in side_b_players}
            giving_surplus = all(my_surplus.get(pos, 0) > 0 for pos in a_positions)
            gaining_deficit = any(my_surplus.get(pos, 0) < 0 for pos in b_positions)
            if not (giving_surplus and gaining_deficit):
                continue

            side_a_picks = [pk for pk in extra_picks if pk["side"] == "a"]
            side_b_picks = [pk for pk in extra_picks if pk["side"] == "b"]
            dynasty_a_value = _side_value(side_a_players, side_a_picks, "dynasty")
            dynasty_b_value = _side_value(side_b_players, side_b_picks, "dynasty")
            redraft_a_value = _side_value(side_a_players, side_a_picks, "redraft")
            redraft_b_value = _side_value(side_b_players, side_b_picks, "redraft")
            dynasty_delta = dynasty_b_value - dynasty_a_value
            redraft_delta = redraft_b_value - redraft_a_value
            win_now_gain = redraft_delta
            long_term_cost = max(
                0,
                _youth_value(side_a_players, side_a_picks)
                - _youth_value(side_b_players, side_b_picks),
            )
            score = _strategy_score(
                strategy,
                complementarity,
                dynasty_delta,
                redraft_delta,
                win_now_gain,
                long_term_cost,
            )

            verdict = "WIN" if final_delta_pct > 5 else "FAIR"

            proposals.append({
                "value_mode": value_mode,
                "strategy": strategy,
                "their_roster_id": their_roster["roster_id"],
                "their_owner": their_roster["owner"],
                "side_a": _side_summary(side_a_players, side_a_picks),
                "side_b": _side_summary(side_b_players, side_b_picks),
                "side_a_value": round(a_val, 1),
                "side_b_value": round(b_val, 1),
                "dynasty_side_a_value": round(dynasty_a_value, 1),
                "dynasty_side_b_value": round(dynasty_b_value, 1),
                "redraft_side_a_value": round(redraft_a_value, 1),
                "redraft_side_b_value": round(redraft_b_value, 1),
                "dynasty_delta": round(dynasty_delta, 1),
                "redraft_delta": round(redraft_delta, 1),
                "win_now_gain": round(win_now_gain, 1),
                "long_term_cost": round(long_term_cost, 1),
                "delta_pct": round(final_delta_pct, 1),
                "verdict": verdict,
                "side_a_players": side_a_players,
                "side_b_players": side_b_players,
                "justification": _justification(
                    my_surplus,
                    their_surplus,
                    side_a_players,
                    side_b_players,
                    value_mode,
                    strategy,
                ),
                "data_confidence": aggregate_confidence([*side_a_players, *side_b_players]),
                "_score": score,
            })

    # Deduplicate by player combo and rank
    seen = set()
    unique = []
    for p in sorted(proposals, key=lambda x: x["_score"], reverse=True):
        key = (
            frozenset(p["side_a"]["player_ids"]),
            frozenset(p["side_b"]["player_ids"]),
        )
        if key not in seen:
            seen.add(key)
            p.pop("_score")
            unique.append(p)
        if len(unique) >= 10:
            break

    for i, p in enumerate(unique):
        p["rank"] = i + 1

    return unique
