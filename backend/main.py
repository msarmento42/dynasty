from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from backend.database import init_db
    from backend.routers import fantasy
except ModuleNotFoundError:
    from database import init_db
    from routers import fantasy

app = FastAPI(title="Dynasty Calculator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fantasy.router, prefix="/fantasy")


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}
