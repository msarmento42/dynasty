"""Trade proposal engine — auto-generates ranked trade proposals per league."""

import json
from itertools import combinations
from datetime import datetime, timezone

import aiosqlite

from backend.database import DB_PATH
from backend.services.fantasy_engine import LEAGUE_CONFIG, pick_value


POSITIONS = ["QB", "RB", "WR", "TE"]


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


def _position_values(players: list) -> dict:
    """Sum adjusted_value by position for a player list."""
    vals = {pos: 0 for pos in POSITIONS}
    for p in players:
        pos = p.get("position", "")
        if pos in vals:
            vals[pos] += p.get("adjusted_value", 0)
    return vals


def _surplus_deficit(my_vals: dict, avg_vals: dict) -> dict:
    """Positive = surplus, negative = deficit."""
    return {pos: my_vals[pos] - avg_vals[pos] for pos in POSITIONS}


def _justification(my_surplus: dict, their_surplus: dict, side_a_players: list, side_b_players: list) -> str:
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

    return (
        f"You improve at {gaining_pos} while trading from {giving_pos} surplus. {age_note}".strip()
    )


async def generate_proposals(league_id: str) -> list:
    """
    Generate ranked trade proposals for the given league.
    Returns list of proposal dicts sorted by score descending.
    """
    cfg = LEAGUE_CONFIG.get(league_id, {})
    n_teams = cfg.get("n_teams", 12)
    current_year = datetime.now(timezone.utc).year

    async with aiosqlite.connect(DB_PATH) as db:
        rosters = await _load_all_rosters(db, league_id)

    if not rosters:
        return []

    # Compute league average position values
    all_pos_vals = [_position_values(r["players"]) for r in rosters]
    avg_vals = {
        pos: sum(v[pos] for v in all_pos_vals) / len(all_pos_vals)
        for pos in POSITIONS
    }

    my_roster = next((r for r in rosters if r["is_mine"]), None)
    if not my_roster:
        return []

    my_vals = _position_values(my_roster["players"])
    my_surplus = _surplus_deficit(my_vals, avg_vals)

    proposals = []

    for their_roster in rosters:
        if their_roster["is_mine"]:
            continue

        their_vals = _position_values(their_roster["players"])
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

        # Sort by adjusted_value desc — trade best available
        my_trade_candidates.sort(key=lambda p: p.get("adjusted_value", 0), reverse=True)
        their_trade_candidates.sort(key=lambda p: p.get("adjusted_value", 0), reverse=True)

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
            a_val = sum(p.get("adjusted_value", 0) for p in side_a_players)
            b_val = sum(p.get("adjusted_value", 0) for p in side_b_players)

            if a_val == 0:
                continue

            # Try to balance with a pick if off by 10-25%
            extra_picks = []
            delta_pct = (b_val - a_val) / a_val * 100

            if -25 < delta_pct < -10:
                # I'm giving too much — ask for a pick back
                gap = a_val - b_val
                for rnd in [2, 3]:
                    pval = pick_value(rnd, 1, n_teams)
                    if abs(gap - pval) / a_val < 0.08:
                        extra_picks = [{"side": "b", "round": rnd, "year": current_year + 1, "value": pval}]
                        b_val += pval
                        break
            elif 10 < delta_pct < 25:
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

            score = complementarity * (1 + abs(final_delta_pct) / 100)

            verdict = "WIN" if final_delta_pct > 5 else "FAIR"

            proposals.append({
                "their_roster_id": their_roster["roster_id"],
                "their_owner": their_roster["owner"],
                "side_a": {
                    "player_ids": [p["sleeper_id"] for p in side_a_players],
                    "picks": [pk for pk in extra_picks if pk["side"] == "a"],
                },
                "side_b": {
                    "player_ids": [p["sleeper_id"] for p in side_b_players],
                    "picks": [pk for pk in extra_picks if pk["side"] == "b"],
                },
                "side_a_value": a_val,
                "side_b_value": b_val,
                "delta_pct": round(final_delta_pct, 1),
                "verdict": verdict,
                "side_a_players": side_a_players,
                "side_b_players": side_b_players,
                "justification": _justification(my_surplus, their_surplus, side_a_players, side_b_players),
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
