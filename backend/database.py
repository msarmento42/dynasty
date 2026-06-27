import os
from pathlib import Path
import aiosqlite

BASE_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = BASE_DIR / "db" / "schema.sql"

_env_db_path = os.environ.get("DB_PATH")
DB_PATH = Path(_env_db_path) if _env_db_path else BASE_DIR / "fantasy.db"

async def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(schema)
        await db.commit()
