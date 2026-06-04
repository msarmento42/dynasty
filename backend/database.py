from pathlib import Path

import aiosqlite


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "fantasy.db"
SCHEMA_PATH = BASE_DIR / "db" / "schema.sql"


async def init_db():
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(schema)
        await db.commit()
