"""Daily dynasty fantasy news digest — reads real alerts + value movers from
backend/fantasy.db and supplements with live ESPN news for rostered players.

Replaces the old ~/Desktop/Claude/life-os-based digest (retired 2026-07-02,
see DECISION-ENGINE-PLAN.md) — that script read a parallel life-os database
that this app never wrote to. This one reads this app's real database and
reuses the same severity classification daily_sync.py already writes to the
`alerts` table (critical/notable/fyi), instead of re-deriving severity from
raw article text.

Usage:
    python3 -m backend.scripts.news_digest --output logs/fantasy-news-2026-07-05.md
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
from pathlib import Path

import aiosqlite

from backend.database import DB_PATH
from backend.services.espn_news import fetch_news_for_players

SEVERITY_ICON = {"critical": "\U0001F534", "notable": "\U0001F7E1", "fyi": "\U0001F7E2"}
SEVERITY_LABEL = {"critical": "Urgent", "notable": "Notable", "fyi": "FYI"}


async def get_rostered_ids(db: aiosqlite.Connection) -> set[str]:
    """All player IDs Marcus owns across all leagues (uses leagues.my_roster_id,
    not rosters.my_roster_id — that column doesn't exist; see #<news-bug-issue>)."""
    async with db.execute(
        "SELECT r.player_ids_json FROM leagues l "
        "JOIN rosters r ON r.league_id = l.league_id AND r.roster_id = l.my_roster_id"
    ) as cur:
        rows = await cur.fetchall()
    import json
    ids: set[str] = set()
    for (pid_json,) in rows:
        ids.update(json.loads(pid_json or "[]"))
    return ids


async def get_todays_alerts(db: aiosqlite.Connection, since_iso: str) -> list[dict]:
    async with db.execute(
        "SELECT alert_type, severity, player_name, old_value, new_value, detail, created_at "
        "FROM alerts WHERE created_at >= ? "
        "ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'notable' THEN 1 ELSE 2 END, created_at DESC",
        (since_iso,),
    ) as cur:
        rows = await cur.fetchall()
    return [
        {
            "alert_type": r[0], "severity": r[1], "player_name": r[2],
            "old_value": r[3], "new_value": r[4], "detail": r[5], "created_at": r[6],
        }
        for r in rows
    ]


async def get_value_movers(db: aiosqlite.Connection, owned_ids: set[str], min_trend: int = 150) -> list[dict]:
    if not owned_ids:
        return []
    placeholders = ",".join("?" * len(owned_ids))
    owned_list = list(owned_ids)
    async with db.execute(
        f"SELECT sleeper_id, name, position, team, trend_30d FROM players "
        f"WHERE sleeper_id IN ({placeholders}) AND ABS(COALESCE(trend_30d, 0)) >= ? "
        f"ORDER BY ABS(trend_30d) DESC LIMIT 15",
        owned_list + [min_trend],
    ) as cur:
        rows = await cur.fetchall()
    return [{"name": r[1], "position": r[2], "team": r[3], "trend_30d": r[4]} for r in rows]


def render_report(date_str: str, alerts: list[dict], movers: list[dict], articles: list[dict]) -> str:
    lines = [f"# Fantasy News Digest — {date_str}", ""]

    for sev in ("critical", "notable", "fyi"):
        bucket = [a for a in alerts if a["severity"] == sev]
        lines.append(f"## {SEVERITY_ICON[sev]} {SEVERITY_LABEL[sev]}")
        if not bucket:
            lines.append("None today.")
        else:
            for a in bucket:
                lines.append(f"**{a['player_name']}** ({a['alert_type']}) — {a['detail']} "
                             f"({a['old_value']} → {a['new_value']})")
        lines.append("")

    lines.append("## \U0001F4F0 ESPN coverage mentioning your players")
    if not articles:
        lines.append("None today.")
    else:
        for art in articles[:10]:
            names = ", ".join(art.get("athlete_names", [])[:3]) or "unknown"
            lines.append(f"- **{names}** — {art.get('headline', '')}")
    lines.append("")

    lines.append("## \U0001F4C8 Value movers on your rosters (30-day, |trend| ≥ 150)")
    if not movers:
        lines.append("None today.")
    else:
        for m in movers:
            arrow = "↑" if (m["trend_30d"] or 0) > 0 else "↓"
            lines.append(f"{arrow} {m['name']} ({m['position']}, {m['team']}) {m['trend_30d']:+d}")
    lines.append("")
    lines.append(f"*Generated {datetime.datetime.now().strftime('%H:%M')}*")
    return "\n".join(lines)


async def run(output: str) -> Path:
    today = datetime.date.today()
    since_iso = today.isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        owned_ids = await get_rostered_ids(db)
        alerts = await get_todays_alerts(db, since_iso)
        movers = await get_value_movers(db, owned_ids)

    try:
        articles = await fetch_news_for_players(list(owned_ids)) if owned_ids else []
    except Exception as exc:  # ESPN fetch is best-effort — don't fail the whole digest over it
        articles = []
        print(f"  WARNING: ESPN news fetch failed ({exc}) — continuing without articles section")

    report = render_report(today.isoformat(), alerts, movers, articles)

    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the daily dynasty news digest.")
    parser.add_argument("--output", default="logs/fantasy-news-digest.md")
    args = parser.parse_args()
    path = asyncio.run(run(args.output))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
