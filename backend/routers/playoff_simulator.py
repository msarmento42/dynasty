"""Playoff odds simulator — Monte Carlo simulation for dynasty playoff probability."""

import json
import random

import aiosqlite
from fastapi import APIRouter, Query

from backend.database import DB_PATH
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player

router = APIRouter()


# Default playoff spots (top 6 of 12, top 2 of 4, etc.)
def playoff_spots(n_teams: int) -> int:
    if n_teams <= 4:
        return 2
    if n_teams <= 8:
        return 4
    return 6


TOTAL_REGULAR_SEASON_WEEKS = 14
CURRENT_WEEK = 10  # assume mid-season for mock


async def load_teams_from_db(league_id: str) -> list:
    """Load all rosters with total dynasty value as proxy for projected points."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT league_id, name, n_teams, format, my_roster_id, config_json "
            "FROM leagues WHERE league_id = ?",
            (league_id,),
        ) as cur:
            league_row = await cur.fetchone()

        if not league_row:
            return []

        async with db.execute(
            "SELECT roster_id, owner_display_name, player_ids_json "
            "FROM rosters WHERE league_id = ? ORDER BY roster_id",
            (league_id,),
        ) as cur:
            roster_rows = await cur.fetchall()

        teams = []
        for roster_id, owner, pid_json in roster_rows:
            player_ids = json.loads(pid_json or "[]")
            if not player_ids:
                continue
            placeholders = ",".join("?" * len(player_ids))
            async with db.execute(
                f"SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status "
                f"FROM players WHERE sleeper_id IN ({placeholders})",
                player_ids,
            ) as cur2:
                player_rows = await cur2.fetchall()

            total_value = 0
            for r in player_rows:
                p = {
                    "sleeper_id": r[0], "name": r[1], "position": r[2], "team": r[3],
                    "age": r[4], "value_sf": r[5] or 0, "value_1qb": r[6] or 0,
                    "trend_30d": r[7] or 0, "injury_status": r[8],
                }
                enriched = enrich_player(p, league_id)
                total_value += enriched.get("adjusted_value", 0)

            teams.append({
                "roster_id": roster_id,
                "team_name": owner or f"Team {roster_id}",
                "proj_points": max(total_value / 500.0, 50.0),
            })

    return teams


def mock_teams(n=12):
    """Generate plausible mock teams when no real data is available."""
    names = [
        "Alpha Squad", "Beta Blitz", "Gamma Force", "Delta Dogs",
        "Epsilon Elite", "Zeta Zone", "Eta Hawks", "Theta Titans",
        "Iota Iron", "Kappa Kings", "Lambda Lords", "Mu Mavericks",
    ]
    base_points = [145, 138, 132, 128, 125, 121, 118, 115, 110, 106, 100, 92]
    teams = []
    for i in range(min(n, 12)):
        teams.append({
            "roster_id": i + 1,
            "team_name": names[i],
            "proj_points": base_points[i] + random.uniform(-5, 5),
        })
    return teams


def simulate_season(teams, weeks_remaining, spots, sim_count):
    """
    Monte Carlo simulation.

    Each team plays through remaining weeks; win probability proportional to
    projected points (with weekly variance).
    """
    n = len(teams)
    playoff_counts = [0] * n

    for _ in range(sim_count):
        # Seed plausible current records based on team strength
        wins = []
        for i in range(n):
            base_win_rate = 0.4 + (n - i) / (n * 2.5)
            current_wins = round(base_win_rate * CURRENT_WEEK + random.gauss(0, 1))
            current_wins = max(0, min(current_wins, CURRENT_WEEK))
            wins.append(current_wins)

        sim_wins = wins[:]
        matchup_indices = list(range(n))
        for _week in range(weeks_remaining):
            random.shuffle(matchup_indices)
            for k in range(0, n - 1, 2):
                a, b = matchup_indices[k], matchup_indices[k + 1]
                proj_a = teams[a]["proj_points"] * random.uniform(0.8, 1.2)
                proj_b = teams[b]["proj_points"] * random.uniform(0.8, 1.2)
                total = proj_a + proj_b
                prob_a_wins = proj_a / total if total > 0 else 0.5
                if random.random() < prob_a_wins:
                    sim_wins[a] += 1
                else:
                    sim_wins[b] += 1

        ranked = sorted(range(n), key=lambda i: (sim_wins[i], teams[i]["proj_points"]), reverse=True)
        for pos in range(min(spots, n)):
            playoff_counts[ranked[pos]] += 1

    return playoff_counts


@router.get("/simulate")
async def simulate_playoffs(
    league_id: str = Query(None, description="Sleeper league ID"),
    simulations: int = Query(10000, ge=100, le=50000),
):
    """
    Run Monte Carlo playoff odds simulation.

    Returns each team's probability of making the playoffs based on remaining schedule.
    """
    weeks_remaining = TOTAL_REGULAR_SEASON_WEEKS - CURRENT_WEEK

    teams = []
    if league_id:
        teams = await load_teams_from_db(league_id)

    if not teams and LEAGUE_CONFIG:
        first_league_id = next(iter(LEAGUE_CONFIG))
        teams = await load_teams_from_db(first_league_id)
        if teams:
            league_id = first_league_id

    if not teams:
        n_teams = 12
        if league_id and league_id in LEAGUE_CONFIG:
            n_teams = LEAGUE_CONFIG[league_id].get("n_teams", 12)
        teams = mock_teams(n_teams)

    n = len(teams)
    spots = playoff_spots(n)
    total_proj = sum(t["proj_points"] for t in teams)

    playoff_counts = simulate_season(teams, weeks_remaining, spots, simulations)

    results = []
    for i, team in enumerate(teams):
        prob = playoff_counts[i] / simulations
        win_rate = team["proj_points"] / total_proj if total_proj else 1 / n
        avg_wins = round(
            CURRENT_WEEK * win_rate * (n - 1) / n + weeks_remaining * win_rate * (n - 1) / n,
            1
        )
        results.append({
            "roster_id": team["roster_id"],
            "team_name": team["team_name"],
            "current_record": (
                f"{round(CURRENT_WEEK * win_rate * (n - 1) / n)}-"
                f"{round(CURRENT_WEEK * (1 - win_rate) * (n - 1) / n)}"
            ),
            "playoff_probability": round(prob * 100, 1),
            "avg_wins": avg_wins,
            "simulations": simulations,
        })

    results.sort(key=lambda r: r["playoff_probability"], reverse=True)

    return {
        "league_id": league_id,
        "n_teams": n,
        "playoff_spots": spots,
        "weeks_remaining": weeks_remaining,
        "simulations": simulations,
        "teams": results,
    }