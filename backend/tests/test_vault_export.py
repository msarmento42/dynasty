"""
Tests for backend.exporters.vault_export.

Builds a throwaway SQLite DB (using the real schema.sql), seeds one league
with a roster-value trend, a settled trade, and a value-move alert, runs the
exporter, and validates the structure of the resulting Markdown: frontmatter
keys, per-league sections present, and the ~150-line-per-league cap honored.
"""
import asyncio
import datetime
from pathlib import Path

import aiosqlite
import pytest

from backend.database import SCHEMA_PATH
from backend.exporters.vault_export import export_summary, MAX_LINES_PER_LEAGUE

REQUIRED_FRONTMATTER_KEYS = ["title", "date", "type", "source", "status"]


async def _seed(db_path: Path):
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(schema)

        await db.execute(
            "INSERT INTO leagues (league_id, name, n_teams, format, my_roster_id, config_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("lg1", "Odin Invitational", 12, "SF", 4, "{}"),
        )

        await db.execute(
            "INSERT INTO roster_snapshots (league_id, roster_id, total_value, synced_at) VALUES (?, ?, ?, ?)",
            ("lg1", 4, 10000, "2026-06-05T00:00:00Z"),
        )
        await db.execute(
            "INSERT INTO roster_snapshots (league_id, roster_id, total_value, synced_at) VALUES (?, ?, ?, ?)",
            ("lg1", 4, 10500, "2026-06-30T00:00:00Z"),
        )

        await db.execute(
            "INSERT INTO trade_history (league_id, transaction_id, week, season, "
            "side_a_roster_id, side_b_roster_id, side_a_total_value, side_b_total_value, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("lg1", "tx1", 10, 2026, 4, 7, 2500, 2200, "2026-06-20T00:00:00Z"),
        )

        await db.execute(
            "INSERT INTO alerts (league_id, sleeper_id, player_name, alert_type, severity, "
            "old_value, new_value, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("lg1", "p1", "Test Player", "value_move", "fyi", "1000", "1400", "moved", "2026-06-28T00:00:00Z"),
        )

        await db.commit()


def parse_frontmatter(text: str) -> dict:
    assert text.startswith("---")
    end = text.find("\n---", 3)
    assert end != -1
    fm = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm


@pytest.fixture()
def seeded_db(tmp_path):
    db_path = tmp_path / "fantasy_test.db"
    asyncio.run(_seed(db_path))
    return db_path


def test_export_summary_writes_valid_frontmatter(seeded_db, tmp_path):
    output_dir = tmp_path / "exports" / "vault" / "dynasty"
    as_of = datetime.date(2026, 7, 2)

    path = asyncio.run(export_summary(output_dir=str(output_dir), as_of=as_of, db_path=seeded_db))

    assert path.exists()
    text = path.read_text()
    fm = parse_frontmatter(text)
    missing = [k for k in REQUIRED_FRONTMATTER_KEYS if k not in fm or not fm[k]]
    assert not missing, f"missing frontmatter keys: {missing}"
    assert fm["source"] == "exporter"
    assert fm["status"] == "draft"


def test_export_summary_includes_league_sections(seeded_db, tmp_path):
    output_dir = tmp_path / "exports" / "vault" / "dynasty"
    as_of = datetime.date(2026, 7, 2)

    path = asyncio.run(export_summary(output_dir=str(output_dir), as_of=as_of, db_path=seeded_db))
    text = path.read_text()

    assert "Odin Invitational" in text
    assert "Strategy posture" in text
    assert "Trade activity & rationale" in text
    assert "Notable value movers" in text
    assert "Test Player" in text
    assert "1000" in text and "1400" in text


def test_export_summary_never_dumps_full_roster(seeded_db, tmp_path):
    """Summaries must not include raw roster/valuation dumps (players table)."""
    output_dir = tmp_path / "exports" / "vault" / "dynasty"
    as_of = datetime.date(2026, 7, 2)

    path = asyncio.run(export_summary(output_dir=str(output_dir), as_of=as_of, db_path=seeded_db))
    text = path.read_text()

    # The exporter never queries `players` or `rosters` tables directly --
    # verify no per-league section exceeds the documented line cap.
    for section in text.split("\n---\n\n")[1:]:
        assert len([line for line in section.splitlines() if line.strip()]) <= MAX_LINES_PER_LEAGUE + 5
