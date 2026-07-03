"""User preferences — currently just the dynasty/redraft value-mode toggle (issue #178).

NOTE: this endpoint persists the selected mode, but no page in the app yet reads
value_mode to switch which value column it displays. The players table only has
value_sf/value_1qb (dynasty market values from FantasyCalc) — there is no redraft
ADP-based value source wired into this app yet. Wiring real redraft values into
every page (trade analyzer, power rankings, start/sit, waiver wire) requires a new
data source and is out of scope for this PR. Building the toggle without fabricating
redraft numbers seemed better than shipping a switch that silently does nothing, or
worse, faking values — so this ships the persistence layer + UI only, with the
gap called out explicitly here and in the PR description.
"""
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

try:
    from backend.database import DB_PATH
except ModuleNotFoundError:
    from database import DB_PATH

import aiosqlite

router = APIRouter()


class PreferencesUpdate(BaseModel):
    value_mode: str


@router.get("/preferences")
async def get_preferences():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT value_mode, updated_at FROM user_preferences WHERE id = 1")
        row = await cursor.fetchone()
        if row is None:
            return {"value_mode": "dynasty", "updated_at": None}
        return {"value_mode": row["value_mode"], "updated_at": row["updated_at"]}


@router.put("/preferences")
async def update_preferences(payload: PreferencesUpdate):
    if payload.value_mode not in ("dynasty", "redraft"):
        payload.value_mode = "dynasty"
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO user_preferences (id, value_mode, updated_at) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET value_mode = excluded.value_mode, updated_at = excluded.updated_at
            """,
            (payload.value_mode, now),
        )
        await db.commit()
    return {"value_mode": payload.value_mode, "updated_at": now}
