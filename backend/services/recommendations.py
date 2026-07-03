"""Unified recommendation engine for football and baseball decision surfaces."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import aiosqlite

from backend.database import DB_PATH
from backend.services.fantasy_engine import LEAGUE_CONFIG, enrich_player
from backend.services.proposals import generate_proposals


POSITIONS = ("QB", "RB", "WR", "TE")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _confidence(level: str, source: str, warnings: list[str] | None = None) -> dict:
    label = {"high": "High trust", "medium": "Review", "low": "Low trust"}.get(level, "Review")
    return {"level": level, "label": label, "source": source, "warnings": warnings or []}


def _impact(value: float, label: str = "value") -> dict:
    value = round(float(value or 0), 1)
    if value >= 1000:
        tier = "high"
    elif value >= 250:
        tier = "medium"
    else:
        tier = "low"
    return {"score": value, "tier": tier, "label": label}


def _risk(level: str, reasons: list[str] | None = None) -> dict:
    return {"level": level, "reasons": reasons or []}


def _rec(
    *,
    category: str,
    action: str,
    title: str,
    summary: str,
    rationale: str,
    confidence: dict,
    impact: dict,
    risk: dict,
    time_horizon: str,
    data_used: list[str],
    entities: dict | None = None,
    source: str,
) -> dict:
    return {
        "id": f"{source}:{category}:{action}:{title}".lower().replace(" ", "-")[:120],
        "sport": "baseball" if category.startswith("baseball") else "football",
        "category": category,
        "action": action,
        "title": title,
        "summary": summary,
        "rationale": rationale,
        "confidence": confidence,
        "impact": impact,
        "risk": risk,
        "time_horizon": time_horizon,
        "data_used": data_used,
        "entities": entities or {},
        "source": source,
    }


async def _league_row(db: aiosqlite.Connection, league_id: str) -> dict | None:
    async with db.execute(
        "SELECT league_id, name, n_teams, format, my_roster_id, config_json FROM leagues WHERE league_id=?",
        (league_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        cfg = LEAGUE_CONFIG.get(league_id)
        if not cfg:
            return None
        return {
            "league_id": league_id,
            "name": cfg["name"],
            "n_teams": cfg["n_teams"],
            "format": cfg["base_format"].upper(),
            "my_roster_id": cfg.get("my_roster_id", 1),
            "config": cfg,
        }
    return {
        "league_id": row[0],
        "name": row[1],
        "n_teams": row[2],
        "format": row[3],
        "my_roster_id": json.loads(row[5] or "{}").get("my_roster_id", row[4]),
        "config": json.loads(row[5] or "{}"),
    }


async def _players_for_ids(db: aiosqlite.Connection, player_ids: list[str], league_id: str) -> list[dict]:
    if not player_ids:
        return []
    placeholders = ",".join("?" * len(player_ids))
    async with db.execute(
        f"SELECT sleeper_id, name, position, team, age, value_sf, value_1qb, trend_30d, injury_status, updated_at "
        f"FROM players WHERE sleeper_id IN ({placeholders})",
        player_ids,
    ) as cur:
        rows = await cur.fetchall()

    players = []
    for row in rows:
        player = {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "age": row[4],
            "value_sf": row[5] or 0,
            "value_1qb": row[6] or 0,
            "trend_30d": row[7] or 0,
            "injury_status": row[8],
            "updated_at": row[9],
        }
        players.append(enrich_player(player, league_id))
    return players


async def _my_players(db: aiosqlite.Connection, league_id: str) -> tuple[dict | None, list[dict]]:
    league = await _league_row(db, league_id)
    if not league:
        return None, []
    async with db.execute(
        "SELECT player_ids_json FROM rosters WHERE league_id=? AND roster_id=?",
        (league_id, league["my_roster_id"]),
    ) as cur:
        row = await cur.fetchone()
    player_ids = json.loads(row[0] or "[]") if row else []
    return league, await _players_for_ids(db, player_ids, league_id)


async def _free_agents(db: aiosqlite.Connection, league_id: str, limit: int = 8) -> list[dict]:
    async with db.execute("SELECT player_ids_json FROM rosters WHERE league_id=?", (league_id,)) as cur:
        rows = await cur.fetchall()
    rostered = set()
    for row in rows:
        rostered.update(json.loads(row[0] or "[]"))

    if rostered:
        placeholders = ",".join("?" * len(rostered))
        query = (
            f"SELECT sleeper_id, name, position, team, value_sf, injury_status, depth_chart_order "
            f"FROM players WHERE sleeper_id NOT IN ({placeholders}) "
            f"AND position IN ('QB','RB','WR','TE','K','DEF') ORDER BY value_sf DESC LIMIT ?"
        )
        params = [*rostered, limit]
    else:
        query = (
            "SELECT sleeper_id, name, position, team, value_sf, injury_status, depth_chart_order "
            "FROM players WHERE position IN ('QB','RB','WR','TE','K','DEF') ORDER BY value_sf DESC LIMIT ?"
        )
        params = [limit]

    async with db.execute(query, params) as cur:
        rows = await cur.fetchall()
    return [
        {
            "sleeper_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "value_sf": row[4] or 0,
            "injury_status": row[5],
            "depth_chart_order": row[6],
        }
        for row in rows
    ]


def _position_needs(players: list[dict]) -> list[tuple[str, float]]:
    totals = {pos: 0.0 for pos in POSITIONS}
    for player in players:
        pos = player.get("position")
        if pos in totals:
            totals[pos] += float(player.get("adjusted_value") or player.get("value_sf") or 0)
    if not totals:
        return []
    average = sum(totals.values()) / len(totals)
    return sorted(((pos, average - total) for pos, total in totals.items()), key=lambda item: item[1], reverse=True)


def _lineup_recommendations(players: list[dict]) -> list[dict]:
    starter_slots = {"QB": 1, "RB": 2, "WR": 3, "TE": 1}
    recs = []
    for pos, slots in starter_slots.items():
        position_players = sorted(
            [p for p in players if p.get("position") == pos],
            key=lambda p: float(p.get("adjusted_value") or p.get("value_sf") or 0),
            reverse=True,
        )
        starters = position_players[:slots]
        bench = position_players[slots:]
        for starter in starters:
            injury = (starter.get("injury_status") or "").upper()
            if injury in {"OUT", "DOUBTFUL"}:
                replacement = bench[0] if bench else None
                recs.append(_rec(
                    category="lineup",
                    action="sit",
                    title=f"Sit {starter['name']}",
                    summary=f"{starter['name']} is listed as {injury}.",
                    rationale="Injury status is severe enough to override the normal value-based lineup order.",
                    confidence=_confidence("high", "Roster, injury status, player value"),
                    impact=_impact(starter.get("adjusted_value") or starter.get("value_sf"), "protected lineup value"),
                    risk=_risk("medium", ["Replacement quality may be thin."]),
                    time_horizon="this week",
                    data_used=["roster", "injury_status", "adjusted_value"],
                    entities={"player": starter, "replacement": replacement},
                    source="lineup-health",
                ))
    return recs


async def _store_snapshot(league_id: str | None, sport: str, recommendations: list[dict]) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS recommendation_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                league_id TEXT,
                sport TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                recommendation_count INTEGER NOT NULL,
                payload_json TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            INSERT INTO recommendation_snapshots
                (league_id, sport, generated_at, recommendation_count, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (league_id, sport, _now(), len(recommendations), json.dumps(recommendations)),
        )
        await db.commit()


async def generate_football_recommendations(league_id: str, limit: int = 12) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        league, players = await _my_players(db, league_id)
        free_agents = await _free_agents(db, league_id, limit=6)

    if not league:
        return {"league_id": league_id, "recommendations": [], "generated_at": _now(), "status": "missing_league"}

    recommendations = []
    recommendations.extend(_lineup_recommendations(players))

    for pos, gap in _position_needs(players)[:2]:
        if gap <= 0:
            continue
        target = next((player for player in free_agents if player.get("position") == pos), None)
        recommendations.append(_rec(
            category="roster",
            action="add" if target else "trade target",
            title=f"Improve {pos} depth",
            summary=(f"Top available target: {target['name']}." if target else f"{pos} trails your roster average."),
            rationale=f"Your {pos} value is below your roster's positional average by roughly {round(gap)} points.",
            confidence=_confidence("medium", "Roster values, free-agent values"),
            impact=_impact(gap, "positional value gap"),
            risk=_risk("low" if target else "medium", [] if target else ["May require trade market pricing."]),
            time_horizon="next 7 days",
            data_used=["roster", "adjusted_value", "free_agents"],
            entities={"target": target, "position": pos},
            source="roster-needs",
        ))

    for player in sorted(players, key=lambda p: float(p.get("trend_30d") or 0), reverse=True)[:3]:
        trend = float(player.get("trend_30d") or 0)
        if trend <= 0:
            continue
        recommendations.append(_rec(
            category="market",
            action="hold",
            title=f"Hold rising {player['name']}",
            summary=f"{player['name']} is up {round(trend)} value points over 30 days.",
            rationale=(
                "Positive value momentum makes an immediate sell less attractive unless an offer prices in the rise."
            ),
            confidence=_confidence("medium", "FantasyCalc value trend"),
            impact=_impact(trend, "30-day value move"),
            risk=_risk("low"),
            time_horizon="next 30 days",
            data_used=["trend_30d", "adjusted_value"],
            entities={"player": player},
            source="value-trends",
        ))

    try:
        proposals = await generate_proposals(league_id)
    except Exception:
        proposals = []

    for proposal in proposals[:3]:
        confidence = proposal.get("data_confidence") or _confidence("medium", "Trade proposal engine")
        recommendations.append(_rec(
            category="trade",
            action="trade target",
            title=f"Explore deal with {proposal.get('their_owner') or 'another manager'}",
            summary=proposal.get("justification") or "Proposal engine found a positional fit.",
            rationale=(
                "The proposal engine matched your surplus positions with a manager whose surplus helps your roster."
            ),
            confidence=confidence,
            impact=_impact(
                abs(float(proposal.get("side_b_value", 0)) - float(proposal.get("side_a_value", 0))),
                "trade value delta",
            ),
            risk=_risk("medium", ["Counterparty acceptance and manager preferences are uncertain."]),
            time_horizon="next 30 days",
            data_used=["rosters", "manager_surplus", "adjusted_value", "proposal_engine"],
            entities={"proposal": proposal},
            source="proposal-engine",
        ))

    priority = {"high": 3, "medium": 2, "low": 1}
    recommendations.sort(
        key=lambda rec: (priority.get(rec["impact"]["tier"], 0), rec["confidence"]["level"] != "low"),
        reverse=True,
    )
    recommendations = recommendations[:limit]
    await _store_snapshot(league_id, "football", recommendations)
    return {
        "league_id": league_id,
        "league_name": league["name"],
        "generated_at": _now(),
        "recommendations": recommendations,
        "summary": {
            "total": len(recommendations),
            "low_confidence": sum(1 for rec in recommendations if rec["confidence"]["level"] == "low"),
            "categories": sorted({rec["category"] for rec in recommendations}),
        },
    }


async def generate_baseball_recommendations(limit: int = 8) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT r.mlb_id, r.notes, p.name, p.position, p.team, p.level, p.age,
                   p.dynasty_value, p.updated_at
            FROM baseball_rosters r
            LEFT JOIN baseball_players p ON p.mlb_id = r.mlb_id
            ORDER BY COALESCE(p.dynasty_value, 0) DESC, p.name
            """
        ) as cur:
            rows = await cur.fetchall()

    recommendations = []
    for row in rows:
        player = dict(row)
        warnings = []
        if not player.get("dynasty_value"):
            warnings.append("Missing manual dynasty value.")
        if not player.get("updated_at"):
            warnings.append("Missing player cache timestamp.")
        if warnings:
            recommendations.append(_rec(
                category="baseball-data",
                action="hold",
                title=f"Review {player.get('name') or player.get('mlb_id')}",
                summary="Baseball value data needs a manual trust check.",
                rationale=(
                    "The recommendation engine will mark baseball actions low confidence until values and "
                    "cache dates are present."
                ),
                confidence=_confidence("low", "MLB Stats API + manual values", warnings),
                impact=_impact(player.get("dynasty_value") or 0, "manual dynasty value"),
                risk=_risk("medium", warnings),
                time_horizon="before next roster move",
                data_used=["baseball_rosters", "baseball_players", "dynasty_value", "updated_at"],
                entities={"player": player},
                source="baseball-data-quality",
            ))

    if not recommendations and rows:
        top = dict(rows[0])
        recommendations.append(_rec(
            category="baseball-roster",
            action="hold",
            title=f"Hold {top.get('name')}",
            summary="Top baseball asset has usable manual value data.",
            rationale=(
                "No urgent baseball data gaps were found, so the best current action is to protect the "
                "highest-value roster asset."
            ),
            confidence=_confidence("medium", "MLB Stats API + manual values"),
            impact=_impact(top.get("dynasty_value") or 0, "manual dynasty value"),
            risk=_risk("low"),
            time_horizon="next 30 days",
            data_used=["baseball_rosters", "baseball_players", "dynasty_value"],
            entities={"player": top},
            source="baseball-roster-priority",
        ))

    recommendations = recommendations[:limit]
    await _store_snapshot(None, "baseball", recommendations)
    return {
        "generated_at": _now(),
        "recommendations": recommendations,
        "summary": {
            "total": len(recommendations),
            "low_confidence": sum(1 for rec in recommendations if rec["confidence"]["level"] == "low"),
            "categories": sorted({rec["category"] for rec in recommendations}),
        },
    }
