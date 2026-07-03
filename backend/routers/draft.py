"""Draft assistant — snake draft board, shared by football (#180) and baseball (#187).

Recommendation logic is intentionally simple for v1: rank available players by
value (value_sf for football, dynasty_value for baseball), then apply a flat
boost to positions the user's team hasn't filled yet relative to a rough
starter-count target. This is a heuristic, not a projections model — good
enough to unblock live drafting, not a replacement for real ADP/projection
data. Flagged here and in the PR description as a known simplification.
"""
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from backend.database import DB_PATH
except ModuleNotFoundError:
    from database import DB_PATH

router = APIRouter(prefix="/api/dynasty/draft", tags=["draft"])

# Rough starter-slot targets used only for the positional-need boost.
FOOTBALL_NEED_TARGETS = {"QB": 2, "RB": 4, "WR": 5, "TE": 2}
BASEBALL_NEED_TARGETS = {"C": 1, "1B": 1, "2B": 1, "3B": 1, "SS": 1, "OF": 3, "SP": 4, "RP": 2}


class DraftStartRequest(BaseModel):
    sport: str = "football"
    num_teams: int
    num_rounds: int
    user_pick_slot: int
    mode: str = "snake"
    faab_budget: Optional[int] = None


class DraftPickRequest(BaseModel):
    team_slot: int
    player_id: str
    player_name: str
    position: Optional[str] = None
    faab_spent: Optional[int] = None


def _slot_for_pick(overall_pick: int, num_teams: int) -> int:
    """Snake draft: odd rounds go 1..N, even rounds go N..1."""
    round_num = (overall_pick - 1) // num_teams + 1
    pick_in_round = (overall_pick - 1) % num_teams + 1
    if round_num % 2 == 1:
        return pick_in_round
    return num_teams - pick_in_round + 1


@router.post("/start")
async def start_draft(req: DraftStartRequest):
    if req.sport not in ("football", "baseball"):
        raise HTTPException(400, "sport must be 'football' or 'baseball'")
    if not (1 <= req.user_pick_slot <= req.num_teams):
        raise HTTPException(400, "user_pick_slot out of range")
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO draft_sessions (
                sport, num_teams, num_rounds, user_pick_slot, mode, faab_budget, current_pick, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (req.sport, req.num_teams, req.num_rounds, req.user_pick_slot, req.mode, req.faab_budget, now),
        )
        await db.commit()
        return {"session_id": cursor.lastrowid}


@router.post("/{session_id}/pick")
async def make_pick(session_id: int, req: DraftPickRequest):
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        session = await (await db.execute("SELECT * FROM draft_sessions WHERE id = ?", (session_id,))).fetchone()
        if session is None:
            raise HTTPException(404, "draft session not found")
        overall_pick = session["current_pick"]
        total_picks = session["num_teams"] * session["num_rounds"]
        if overall_pick > total_picks:
            raise HTTPException(400, "draft already complete")
        round_num = (overall_pick - 1) // session["num_teams"] + 1
        pick_in_round = (overall_pick - 1) % session["num_teams"] + 1
        expected_slot = _slot_for_pick(overall_pick, session["num_teams"])
        if req.team_slot != expected_slot:
            raise HTTPException(400, f"it is team {expected_slot}'s pick, not team {req.team_slot}'s")
        try:
            await db.execute(
                """
                INSERT INTO draft_picks (
                    session_id, overall_pick, round, pick_in_round, team_slot,
                    player_id, player_name, position, faab_spent, picked_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id, overall_pick, round_num, pick_in_round, req.team_slot,
                    req.player_id, req.player_name, req.position, req.faab_spent, now,
                ),
            )
        except aiosqlite.IntegrityError:
            raise HTTPException(409, "this pick has already been made")
        await db.execute("UPDATE draft_sessions SET current_pick = ? WHERE id = ?", (overall_pick + 1, session_id))
        await db.commit()
        return {"overall_pick": overall_pick, "next_pick": overall_pick + 1}


@router.get("/{session_id}/state")
async def draft_state(session_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        session = await (await db.execute("SELECT * FROM draft_sessions WHERE id = ?", (session_id,))).fetchone()
        if session is None:
            raise HTTPException(404, "draft session not found")
        picks_rows = await (await db.execute(
            "SELECT * FROM draft_picks WHERE session_id = ? ORDER BY overall_pick", (session_id,)
        )).fetchall()
        picks = [dict(p) for p in picks_rows]
        taken_ids = {p["player_id"] for p in picks}

        sport = session["sport"]
        num_teams = session["num_teams"]
        overall_pick = session["current_pick"]
        total_picks = num_teams * session["num_rounds"]
        is_complete = overall_pick > total_picks
        on_the_clock = None if is_complete else _slot_for_pick(overall_pick, num_teams)
        is_user_turn = (not is_complete) and on_the_clock == session["user_pick_slot"]

        # positional need for the user's team so far
        user_positions_drafted = [
            p["position"] for p in picks
            if p["team_slot"] == session["user_pick_slot"] and p["position"]
        ]
        need_targets = FOOTBALL_NEED_TARGETS if sport == "football" else BASEBALL_NEED_TARGETS
        pos_counts = {pos: user_positions_drafted.count(pos) for pos in need_targets}
        needs = {pos: max(0, target - pos_counts.get(pos, 0)) for pos, target in need_targets.items()}

        # available players by value, with a need boost
        if sport == "football":
            value_col, table, id_col = "value_sf", "players", "sleeper_id"
        else:
            value_col, table, id_col = "dynasty_value", "baseball_players", "mlb_id"

        rows = await (await db.execute(
            f"SELECT {id_col} AS id, name, position, {value_col} AS value FROM {table}"
        )).fetchall()
        available = [dict(r) for r in rows if str(r["id"]) not in {str(t) for t in taken_ids}]
        for p in available:
            need_boost = 1.15 if needs.get(p["position"], 0) > 0 else 1.0
            p["adjusted_value"] = round((p["value"] or 0) * need_boost, 1)
        available.sort(key=lambda p: p["adjusted_value"], reverse=True)
        top_available = available[:50]

        faab_remaining = None
        if session["faab_budget"] is not None:
            spent = sum(p["faab_spent"] or 0 for p in picks if p["team_slot"] == session["user_pick_slot"])
            faab_remaining = session["faab_budget"] - spent

        return {
            "session": dict(session),
            "picks": picks,
            "is_complete": is_complete,
            "on_the_clock_team": on_the_clock,
            "is_user_turn": is_user_turn,
            "user_needs": needs,
            "faab_remaining": faab_remaining,
            "recommendations": top_available[:10],
            "available_players": top_available,
        }
