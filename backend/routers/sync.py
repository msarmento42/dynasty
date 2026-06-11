from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, HTTPException

try:
    from backend.database import DB_PATH, init_db
    from backend.scripts import daily_sync
except ModuleNotFoundError:
    from database import DB_PATH, init_db
    from scripts import daily_sync

router = APIRouter()

COUNT_TABLES = ("players", "leagues", "rosters", "picks", "trade_history")


async def _count_rows(db, table_name):
    try:
        cursor = await db.execute(f"SELECT COUNT(*) FROM {table_name}")
        row = await cursor.fetchone()
        return row[0] if row else 0
    except Exception:
        return 0


async def _last_sync(db):
    try:
        cursor = await db.execute(
            """
            SELECT sync_type, status, message, ran_at
            FROM sync_log
            ORDER BY ran_at DESC, id DESC
            LIMIT 1
            """
        )
        row = await cursor.fetchone()
    except Exception:
        return None

    if not row:
        return None

    return {
        "sync_type": row[0],
        "status": row[1],
        "message": row[2],
        "ran_at": row[3],
    }


async def _build_status():
    await init_db()

    async with aiosqlite.connect(DB_PATH) as db:
        counts = {table: await _count_rows(db, table) for table in COUNT_TABLES}
        last_sync = await _last_sync(db)

    core_data_loaded = counts["players"] > 0 and counts["leagues"] > 0 and counts["rosters"] > 0

    return {
        "database_path": str(DB_PATH),
        "database_exists": DB_PATH.exists(),
        "core_data_loaded": core_data_loaded,
        "needs_sync": not core_data_loaded,
        "counts": counts,
        "last_sync": last_sync,
    }


async def _record_sync_failure(message):
    await init_db()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO sync_log (sync_type, status, message, ran_at) VALUES (?, ?, ?, ?)",
            (
                "manual_sync",
                "error",
                message[:500],
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await db.commit()


@router.get("/sync-status")
async def sync_status():
    return await _build_status()


@router.post("/sync")
async def run_sync():
    daily_sync.DB_PATH = str(DB_PATH)

    try:
        await daily_sync.main()
    except Exception as exc:
        await _record_sync_failure(str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await _build_status()
