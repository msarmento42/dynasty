"""
Dynasty vault exporter — writes a local Markdown strategy summary per league
for the Marcus OS vault.

Local-only: reads the already-synced local SQLite DB (fantasy.db); makes no
network calls (no Sleeper/FantasyCalc/ESPN requests) and never touches the
vault repo directly. Summaries only -- never full roster/valuation dumps,
capped to roughly 150 lines per league.

Sections per league:
  - Strategy posture: my-roster total value trend over the last 30 days.
  - Trade activity & rationale: the last few completed trades involving my
    roster, with the value delta on each side (this repo does not persist
    "open" trade proposals -- those are computed live -- so this section
    covers recent settled trade history instead).
  - Notable value movers: recent `value_move` alerts for players on my
    roster (from the existing alert-detection pipeline).

Usage:
    python -m backend.exporters.vault_export [--output-dir exports/vault/dynasty] [--as-of YYYY-MM-DD]
"""
import argparse
import asyncio
import datetime
from pathlib import Path

import aiosqlite

from backend.database import DB_PATH

MAX_LINES_PER_LEAGUE = 150
RECENT_TRADES_LIMIT = 5
VALUE_MOVERS_LIMIT = 5
TREND_WINDOW_DAYS = 30


def _iso_week_str(d: datetime.date) -> str:
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def _frontmatter(title: str, date: datetime.date, tags=None) -> str:
    tags = tags or []
    tags_str = "[" + ", ".join(tags) + "]"
    return (
        "---\n"
        f"title: {title}\n"
        f"date: {date.isoformat()}\n"
        "type: dynasty-summary\n"
        f"tags: {tags_str}\n"
        "source: exporter\n"
        "status: draft\n"
        "---\n\n"
    )


async def get_leagues(db: aiosqlite.Connection) -> list:
    async with db.execute(
        "SELECT league_id, name, n_teams, format, my_roster_id FROM leagues"
    ) as cur:
        rows = await cur.fetchall()
    return [
        {"league_id": r[0], "name": r[1], "n_teams": r[2], "format": r[3], "my_roster_id": r[4]}
        for r in rows
    ]


async def get_value_trend(db: aiosqlite.Connection, league_id: str, my_roster_id: int, as_of: datetime.date) -> dict:
    cutoff = (as_of - datetime.timedelta(days=TREND_WINDOW_DAYS)).isoformat()
    async with db.execute(
        """
        SELECT total_value, synced_at FROM roster_snapshots
        WHERE league_id=? AND roster_id=? AND synced_at >= ?
        ORDER BY synced_at ASC
        """,
        (league_id, my_roster_id, cutoff),
    ) as cur:
        rows = await cur.fetchall()

    if not rows:
        return {"sample_size": 0, "earliest": None, "latest": None, "delta": None}

    earliest, latest = rows[0][0], rows[-1][0]
    return {
        "sample_size": len(rows),
        "earliest": earliest,
        "latest": latest,
        "delta": round(latest - earliest, 1) if earliest is not None and latest is not None else None,
    }


async def get_recent_trades(
    db: aiosqlite.Connection, league_id: str, my_roster_id: int, limit: int = RECENT_TRADES_LIMIT
) -> list:
    async with db.execute(
        """
        SELECT side_a_roster_id, side_b_roster_id, side_a_total_value, side_b_total_value, created_at
        FROM trade_history
        WHERE league_id=? AND (side_a_roster_id=? OR side_b_roster_id=?)
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (league_id, my_roster_id, my_roster_id, limit),
    ) as cur:
        rows = await cur.fetchall()

    trades = []
    for side_a, side_b, val_a, val_b, created_at in rows:
        if side_a == my_roster_id:
            my_value, their_value = val_a or 0, val_b or 0
        else:
            my_value, their_value = val_b or 0, val_a or 0
        trades.append({
            "created_at": created_at,
            "my_value": my_value,
            "their_value": their_value,
            "delta": my_value - their_value,
        })
    return trades


async def get_value_movers(db: aiosqlite.Connection, league_id: str, limit: int = VALUE_MOVERS_LIMIT) -> list:
    async with db.execute(
        """
        SELECT player_name, old_value, new_value, created_at
        FROM alerts
        WHERE league_id=? AND alert_type='value_move'
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (league_id, limit),
    ) as cur:
        rows = await cur.fetchall()
    return [
        {"player_name": r[0], "old_value": r[1], "new_value": r[2], "created_at": r[3]}
        for r in rows
    ]


def render_league_section(league: dict, trend: dict, trades: list, movers: list) -> str:
    lines = [f"## {league['name']} ({league['format']}, {league['n_teams']} teams)\n"]

    lines.append("### Strategy posture\n")
    if trend["sample_size"] < 2:
        lines.append(
            "Not enough roster-value snapshots in the last "
            f"{TREND_WINDOW_DAYS} days to compute a trend.\n"
        )
    else:
        direction = "up" if trend["delta"] > 0 else ("down" if trend["delta"] < 0 else "flat")
        lines.append(
            f"Roster value trending **{direction}** over the last {TREND_WINDOW_DAYS} days "
            f"({trend['earliest']} → {trend['latest']}, delta {trend['delta']:+.1f}).\n"
        )

    lines.append("### Trade activity & rationale\n")
    lines.append(
        "_(Recent settled trades; this app computes open proposals live rather "
        "than persisting them, so this covers trade history, not pending offers.)_\n"
    )
    if not trades:
        lines.append("No trades in history for this roster yet.\n")
    else:
        for t in trades:
            verdict = "value gain" if t["delta"] > 0 else ("value loss" if t["delta"] < 0 else "even value")
            lines.append(
                f"- {t['created_at']}: received {t['my_value']}, gave {t['their_value']} "
                f"({verdict}, delta {t['delta']:+d})"
            )
        lines.append("")

    lines.append("### Notable value movers\n")
    if not movers:
        lines.append("No recent value-move alerts for this roster.\n")
    else:
        for m in movers:
            try:
                delta = int(m["new_value"]) - int(m["old_value"])
            except (TypeError, ValueError):
                delta = None
            delta_str = f"{delta:+d}" if delta is not None else "n/a"
            mover_line = (
                f"- {m['player_name']}: {m['old_value']} → {m['new_value']} "
                f"({delta_str}) on {m['created_at']}"
            )
            lines.append(mover_line)
        lines.append("")

    section = "\n".join(lines)
    section_lines = section.splitlines()
    if len(section_lines) > MAX_LINES_PER_LEAGUE:
        section_lines = section_lines[:MAX_LINES_PER_LEAGUE] + [
            "", "_(truncated to stay within the per-league line cap)_"
        ]
    return "\n".join(section_lines)


async def export_summary(output_dir: str = "exports/vault/dynasty", as_of: datetime.date = None, db_path=None) -> Path:
    as_of = as_of or datetime.date.today()
    path = db_path or DB_PATH

    async with aiosqlite.connect(path) as db:
        leagues = await get_leagues(db)
        sections = []
        for league in leagues:
            trend = await get_value_trend(db, league["league_id"], league["my_roster_id"], as_of)
            trades = await get_recent_trades(db, league["league_id"], league["my_roster_id"])
            movers = await get_value_movers(db, league["league_id"])
            sections.append(render_league_section(league, trend, trades, movers))

    week_str = _iso_week_str(as_of)
    fm = _frontmatter(f"Dynasty Strategy Summary — {week_str}", as_of, tags=["dynasty", "exporter"])
    body = fm + ("\n---\n\n".join(sections) if sections else "No leagues configured.\n")

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"summary-{week_str}.md"
    out_path.write_text(body)
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Export dynasty strategy summaries for the Marcus OS vault.")
    parser.add_argument("--output-dir", default="exports/vault/dynasty")
    parser.add_argument("--as-of", default=None, help="YYYY-MM-DD, defaults to today")
    args = parser.parse_args()

    as_of = datetime.date.fromisoformat(args.as_of) if args.as_of else datetime.date.today()
    path = asyncio.run(export_summary(output_dir=args.output_dir, as_of=as_of))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
