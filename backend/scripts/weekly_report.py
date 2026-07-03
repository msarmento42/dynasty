"""Weekly dynasty strategy report — reads real data from backend/fantasy.db
for all leagues and writes a markdown report Marcus reads Sunday morning.

Replaces the old ~/Desktop/Claude/life-os-based weekly report (retired
2026-07-02, see DECISION-ENGINE-PLAN.md) — that script read a parallel
life-os database this app never wrote to, using bespoke roster-analysis
logic that was never ported to this app's real schema. This version reuses
this app's own tested logic (services/proposals.generate_proposals, and the
team-needs grading query from routers/fantasy.py) instead of re-deriving
position-gap math from scratch.

Usage:
    python3 -m backend.scripts.weekly_report --output logs/fantasy-dynasty-2026-07-05.md

Run backend/scripts/daily_sync.py first (or let fantasy-daily-sync's own run
that morning cover it) so this reads fresh data.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
from pathlib import Path

import aiosqlite

from backend.database import DB_PATH
from backend.services.proposals import generate_proposals

POSITIONS = ["QB", "RB", "WR", "TE"]


async def get_leagues(db: aiosqlite.Connection) -> list[dict]:
    """my_roster_id only lives on `leagues` — `league_settings` has display/format
    metadata but not roster ownership, so this always joins both."""
    async with db.execute(
        "SELECT l.league_id, l.name, l.my_roster_id, l.format, ls.format_label "
        "FROM leagues l LEFT JOIN league_settings ls ON ls.league_id = l.league_id"
    ) as cur:
        rows = await cur.fetchall()
    return [
        {"league_id": r[0], "name": r[1], "my_roster_id": r[2], "format": r[4] or r[3]}
        for r in rows
    ]


async def get_my_grade(db: aiosqlite.Connection, league_id: str, my_roster_id: int) -> dict | None:
    """Reuses the exact query GET /fantasy/league/{id}/team-needs uses (verified
    working 2026-07-02) so this stays consistent with what the app's own UI shows."""
    async with db.execute(
        "SELECT roster_id, owner_display_name, player_ids_json FROM rosters WHERE league_id=? ORDER BY roster_id",
        (league_id,),
    ) as cur:
        roster_rows = await cur.fetchall()

    all_pos_values = []
    my_pos_values = None
    for roster_id, owner, pid_json in roster_rows:
        player_ids = json.loads(pid_json or "[]")
        pos_values = {pos: 0.0 for pos in POSITIONS}
        if player_ids:
            placeholders = ",".join("?" * len(player_ids))
            async with db.execute(
                f"SELECT position, value_sf, value_1qb FROM players WHERE sleeper_id IN ({placeholders})",
                player_ids,
            ) as cur:
                player_rows = await cur.fetchall()
            for pos, vsf, v1qb in player_rows:
                if pos in pos_values:
                    pos_values[pos] += float(vsf or v1qb or 0)
        all_pos_values.append(pos_values)
        if roster_id == my_roster_id:
            my_pos_values = pos_values

    if my_pos_values is None:
        return None

    gaps = {}
    for pos in POSITIONS:
        vals = [pv[pos] for pv in all_pos_values]
        avg = sum(vals) / len(vals) if vals else 0
        gaps[pos] = round(((my_pos_values[pos] - avg) / avg * 100) if avg else 0, 1)

    return {"starter_value": my_pos_values, "vs_avg_pct": gaps}


async def get_value_movers(db: aiosqlite.Connection, owned_ids: set[str], min_trend: int = 150) -> list[dict]:
    if not owned_ids:
        return []
    placeholders = ",".join("?" * len(owned_ids))
    async with db.execute(
        f"SELECT name, position, team, trend_30d FROM players "
        f"WHERE sleeper_id IN ({placeholders}) AND ABS(COALESCE(trend_30d, 0)) >= ? "
        f"ORDER BY ABS(trend_30d) DESC LIMIT 20",
        list(owned_ids) + [min_trend],
    ) as cur:
        rows = await cur.fetchall()
    return [{"name": r[0], "position": r[1], "team": r[2], "trend_30d": r[3]} for r in rows]


def render_league_section(league: dict, grade: dict | None, proposals: list[dict], picks: list[dict]) -> str:
    lines = [f"## {league['name']} ({league.get('format', '')}) "]
    if grade:
        gaps = grade["vs_avg_pct"]
        sv = grade["starter_value"]
        lines.append("**Position value vs. league average:**")
        lines.append(" | ".join(f"{p}: {sv[p]:.0f} ({gaps[p]:+.1f}%)" for p in POSITIONS))
    else:
        lines.append("_No roster grade available — check league_settings/my_roster_id sync._")
    lines.append("")

    lines.append("**Top trade proposals:**")
    if not proposals:
        lines.append("None generated this week.")
    else:
        for i, p in enumerate(proposals[:3], 1):
            side_a_names = ", ".join(pl["name"] for pl in p.get("side_a_players", []))
            side_b_names = ", ".join(pl["name"] for pl in p.get("side_b_players", []))
            lines.append(
                f"{i}. **vs {p.get('their_owner', 'unknown')}** — offer {side_a_names} for "
                f"{side_b_names} | value balance: {p.get('delta_pct', 0):+.1f}% | verdict: {p.get('verdict', '?')}"
            )
    lines.append("")

    if picks:
        lines.append("**Pick inventory:** " + ", ".join(f"{pk['season']} R{pk['round']}" for pk in picks[:6]))
        lines.append("")

    return "\n".join(lines)


async def run(output: str, as_of: datetime.date | None = None) -> Path:
    as_of = as_of or datetime.date.today()

    async with aiosqlite.connect(DB_PATH) as db:
        leagues = await get_leagues(db)

        sections = []
        all_owned_ids: set[str] = set()
        for league in leagues:
            league_id = league["league_id"]
            my_roster_id = league["my_roster_id"]

            grade = await get_my_grade(db, league_id, my_roster_id) if my_roster_id is not None else None

            if my_roster_id is not None:
                async with db.execute(
                    "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
                    (league_id, my_roster_id),
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    all_owned_ids.update(json.loads(row[0] or "[]"))

            async with db.execute(
                "SELECT season, round, original_owner_id, current_owner_id FROM picks "
                "WHERE league_id=? AND current_owner_id=? ORDER BY season, round",
                (league_id, my_roster_id),
            ) as cur:
                pick_rows = await cur.fetchall()
            picks = [{"season": r[0], "round": r[1]} for r in pick_rows]

            try:
                proposals = await generate_proposals(league_id)
            except Exception as exc:
                proposals = []
                print(f"  WARNING: proposal generation failed for {league['name']} ({exc})")

            sections.append(render_league_section(league, grade, proposals, picks))

        movers = await get_value_movers(db, all_owned_ids)

    body = f"# Dynasty Weekly — {as_of.isoformat()}\n\n" + "\n---\n\n".join(sections)
    body += "\n---\n\n## \U0001F4C8 Value movers across all your rosters this week\n"
    if movers:
        for m in movers:
            arrow = "↑" if (m["trend_30d"] or 0) > 0 else "↓"
            body += f"{arrow} {m['name']} ({m['position']}, {m['team']}) {m['trend_30d']:+d}\n"
    else:
        body += "None this week.\n"
    body += f"\n---\n*Generated: {datetime.datetime.now().strftime('%H:%M')}*\n"

    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the weekly dynasty strategy report.")
    parser.add_argument("--output", default="logs/fantasy-dynasty-weekly.md")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD, defaults to today")
    args = parser.parse_args()
    as_of = datetime.date.fromisoformat(args.as_of) if args.as_of else None
    path = asyncio.run(run(args.output, as_of=as_of))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
