import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

try:
    from backend.database import init_db
    from backend.routers import fantasy
    from backend.routers import playoff_simulator
    from backend.routers import pick_calculator
    from backend.routers import baseball
except ModuleNotFoundError:
    from database import init_db
    from routers import fantasy
    from routers import playoff_simulator
    from routers import pick_calculator
    from routers import baseball

app = FastAPI(title="Dynasty Calculator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fantasy.router, prefix="/fantasy")
app.include_router(playoff_simulator.router, prefix="/api/playoff")
app.include_router(pick_calculator.router, prefix="/api/picks")
app.include_router(baseball.router)


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve React build when SERVE_STATIC=true (Railway / production)
if os.environ.get("SERVE_STATIC", "").lower() in ("1", "true", "yes"):
    import pathlib
    from fastapi.responses import FileResponse

    STATIC_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "dist"

    if STATIC_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            index = STATIC_DIR / "index.html"
            return FileResponse(str(index))
