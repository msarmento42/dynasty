"""Source-aware player intelligence helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import aiosqlite

STALE_HOURS = {
    "value": 36,
    "projection": 48,
    "adp": 168,
    "rank": 168,
    "news": 24,
    "injury": 24,
    "depth_chart": 72,
    "usage": 72,
    "stats": 168,
    "statcast": 168,
    "probable_starter": 48,
    "recent_form": 72,
    "roster_status": 72,
    "manual_value": 720,
    "prospect_level": 720,
}

METRIC_WEIGHTS = {
    "value": 1.0,
    "manual_value": 1.0,
    "projection": 0.85,
    "rank": 0.75,
    "adp": 0.65,
    "stats": 0.55,
    "statcast": 0.55,
    "recent_form": 0.5,
    "usage": 0.5,
    "probable_starter": 0.45,
    "depth_chart": 0.45,
    "roster_status": 0.45,
    "injury": 0.4,
    "news": 0.35,
    "prospect_level": 0.35,
}


def _parse_time(value: str | None):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _age_hours(value: str | None):
    parsed = _parse_time(value)
    if parsed is None:
        return None
    return max(0, round((datetime.now(timezone.utc) - parsed).total_seconds() / 3600, 1))


def _freshness(metric_type: str, observed_at: str | None) -> dict:
    age_hours = _age_hours(observed_at)
    threshold = STALE_HOURS.get(metric_type, 72)
    if age_hours is None:
        return {
            "status": "missing",
            "age_hours": None,
            "stale_after_hours": threshold,
            "message": "No timestamp available for this source.",
        }
    status = "fresh" if age_hours <= threshold else "stale"
    return {
        "status": status,
        "age_hours": age_hours,
        "stale_after_hours": threshold,
        "message": f"{metric_type.replace('_', ' ')} source is {age_hours} hours old.",
    }


def _confidence(metric_type: str, value, observed_at: str | None, base: float = 0.75) -> float:
    score = base
    if value in (None, "", 0):
        score -= 0.25
    freshness = _freshness(metric_type, observed_at)
    if freshness["status"] == "stale":
        score -= 0.2
    elif freshness["status"] == "missing":
        score -= 0.3
    return round(max(0.05, min(score, 0.99)), 2)


def _metric(
    *,
    source: str,
    metric_type: str,
    value=None,
    rank=None,
    scoring_format: str = "overall",
    confidence: float | None = None,
    observed_at: str | None = None,
    detail: str = "",
) -> dict:
    return {
        "source": source,
        "metric_type": metric_type,
        "scoring_format": scoring_format,
        "value": value,
        "rank": rank,
        "confidence": confidence if confidence is not None else _confidence(metric_type, value, observed_at),
        "observed_at": observed_at,
        "freshness": _freshness(metric_type, observed_at),
        "detail": detail,
    }


def _metric_value(metric: dict) -> float | None:
    value = metric.get("value")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _summarize(metrics: list[dict]) -> dict:
    numeric = [m for m in metrics if _metric_value(m) is not None]
    value_metrics = [m for m in numeric if m["metric_type"] in {"value", "manual_value", "projection", "adp", "rank"}]
    values = [_metric_value(m) for m in value_metrics]
    warnings = []

    stale_sources = [m["source"] for m in metrics if m["freshness"]["status"] == "stale"]
    thin_types = {"value", "manual_value", "projection", "rank", "adp"} - {m["metric_type"] for m in metrics}
    if stale_sources:
        warnings.append(f"Stale sources: {', '.join(sorted(set(stale_sources)))}")
    if len(value_metrics) < 2:
        warnings.append("Thin value coverage: fewer than two value/rank/projection sources.")
    if thin_types:
        warnings.append(f"Missing feed types: {', '.join(sorted(thin_types))}")

    disagreement = 0
    if len(values) >= 2:
        disagreement = round(max(values) - min(values), 1)
        baseline = max(max(values), 1)
        if disagreement / baseline >= 0.25:
            warnings.append("Sources disagree by at least 25%.")

    weighted_total = 0.0
    weight_total = 0.0
    for metric in numeric:
        weight = METRIC_WEIGHTS.get(metric["metric_type"], 0.4) * float(metric.get("confidence") or 0.5)
        weighted_total += (_metric_value(metric) or 0) * weight
        weight_total += weight
    blended_score = round(weighted_total / weight_total, 1) if weight_total else 0
    confidence_score = round(
        sum(float(m.get("confidence") or 0) for m in metrics) / len(metrics),
        2,
    ) if metrics else 0

    return {
        "blended_score": blended_score,
        "confidence_score": confidence_score,
        "source_count": len({m["source"] for m in metrics}),
        "metric_count": len(metrics),
        "source_disagreement": disagreement,
        "warnings": warnings,
        "recommendation_data_state": "thin" if len(value_metrics) < 2 else ("stale" if stale_sources else "ready"),
    }


async def _stored_metrics(db: aiosqlite.Connection, sport: str, player_id: str) -> list[dict]:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS player_source_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sport TEXT NOT NULL,
            player_id TEXT NOT NULL,
            player_name TEXT,
            source TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            scoring_format TEXT DEFAULT 'overall',
            metric_value REAL,
            metric_rank INTEGER,
            confidence REAL DEFAULT 0.5,
            observed_at TEXT,
            payload_json TEXT,
            UNIQUE(sport, player_id, source, metric_type, scoring_format)
        )
        """
    )
    async with db.execute(
        """
        SELECT source, metric_type, scoring_format, metric_value, metric_rank, confidence, observed_at, payload_json
        FROM player_source_metrics
        WHERE sport = ? AND player_id = ?
        ORDER BY source, metric_type
        """,
        (sport, str(player_id)),
    ) as cur:
        rows = await cur.fetchall()

    metrics = []
    for row in rows:
        try:
            payload = json.loads(row[7] or "{}")
        except json.JSONDecodeError:
            payload = {}
        metrics.append(_metric(
            source=row[0],
            metric_type=row[1],
            scoring_format=row[2] or "overall",
            value=row[3],
            rank=row[4],
            confidence=round(float(row[5] or 0.5), 2),
            observed_at=row[6],
            detail=payload.get("detail", ""),
        ))
    return metrics


async def football_intelligence(db: aiosqlite.Connection, sleeper_id: str) -> dict:
    async with db.execute(
        """
        SELECT sleeper_id, name, position, team, value_sf, value_1qb, trend_30d,
               injury_status, depth_chart_order, updated_at
        FROM players
        WHERE sleeper_id = ?
        """,
        (sleeper_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return {"metrics": [], "summary": _summarize([])}

    metrics = await _stored_metrics(db, "football", sleeper_id)
    updated_at = row[9]
    if row[4]:
        metrics.append(_metric(
            source="FantasyCalc",
            metric_type="value",
            scoring_format="superflex",
            value=row[4],
            observed_at=updated_at,
            detail="Current superflex dynasty value.",
        ))
    if row[5]:
        metrics.append(_metric(
            source="FantasyCalc",
            metric_type="value",
            scoring_format="1qb",
            value=row[5],
            observed_at=updated_at,
            detail="Current 1QB dynasty value.",
        ))
    metrics.append(_metric(
        source="Sleeper",
        metric_type="depth_chart",
        value=row[8],
        observed_at=updated_at,
        detail="Depth chart order from synced player cache.",
    ))
    metrics.append(_metric(
        source="Sleeper",
        metric_type="injury",
        value=0 if row[7] else 1,
        observed_at=updated_at,
        detail=row[7] or "No injury designation in cache.",
    ))
    if row[6] is not None:
        metrics.append(_metric(
            source="Local snapshots",
            metric_type="usage",
            value=row[6],
            observed_at=updated_at,
            detail="30-day value trend from stored snapshots.",
        ))

    async with db.execute(
        "SELECT published_at, headline FROM news_items WHERE sleeper_id = ? ORDER BY published_at DESC LIMIT 1",
        (sleeper_id,),
    ) as cur:
        news_row = await cur.fetchone()
    if news_row:
        metrics.append(_metric(
            source="ESPN News",
            metric_type="news",
            value=1,
            observed_at=news_row[0],
            detail=news_row[1] or "Latest synced headline.",
        ))

    async with db.execute(
        "SELECT match_confidence, updated_at FROM player_id_map WHERE sleeper_id = ?",
        (sleeper_id,),
    ) as cur:
        id_row = await cur.fetchone()
    if id_row:
        metrics.append(_metric(
            source="ID map",
            metric_type="roster_status",
            value=round(float(id_row[0] or 0) * 100, 1),
            observed_at=id_row[1],
            detail="Cross-source player identity match confidence.",
        ))

    return {"metrics": metrics, "summary": _summarize(metrics)}


async def baseball_intelligence(db: aiosqlite.Connection, mlb_id: int) -> dict:
    async with db.execute(
        """
        SELECT mlb_id, name, position, team, level, dynasty_value, injury_status, updated_at
        FROM baseball_players
        WHERE mlb_id = ?
        """,
        (mlb_id,),
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return {"metrics": [], "summary": _summarize([])}

    metrics = await _stored_metrics(db, "baseball", str(mlb_id))
    metrics.append(_metric(
        source="Manual baseball values",
        metric_type="manual_value",
        value=row[5] or 0,
        observed_at=row[7],
        detail="Manually maintained dynasty value.",
    ))
    metrics.append(_metric(
        source="MLB Stats API",
        metric_type="roster_status",
        value=1 if row[3] else 0,
        observed_at=row[7],
        detail=f"{row[3] or 'No team'} / {row[4] or 'unknown level'}",
    ))
    metrics.append(_metric(
        source="MLB Stats API",
        metric_type="prospect_level",
        value={"MLB": 5, "AAA": 4, "AA": 3, "A+": 2, "A": 1}.get(row[4], 0),
        observed_at=row[7],
        detail=f"Current level: {row[4] or 'unknown'}.",
    ))
    metrics.append(_metric(
        source="MLB Stats API",
        metric_type="injury",
        value=0 if row[6] else 1,
        observed_at=row[7],
        detail=row[6] or "No injury designation in cache.",
    ))

    async with db.execute(
        """
        SELECT season, level, stat_type
        FROM baseball_stats
        WHERE mlb_id = ?
        ORDER BY season DESC
        LIMIT 1
        """,
        (mlb_id,),
    ) as cur:
        stats_row = await cur.fetchone()
    if stats_row:
        metrics.append(_metric(
            source="MLB Stats API",
            metric_type="stats",
            value=1,
            observed_at=row[7],
            detail=f"Latest cached {stats_row[2]} stats from {stats_row[0]} {stats_row[1]}.",
        ))

    return {"metrics": metrics, "summary": _summarize(metrics)}


async def football_source_rankings(db: aiosqlite.Connection, limit: int = 40) -> list[dict]:
    async with db.execute(
        """
        SELECT sleeper_id, name, position, team
        FROM players
        WHERE COALESCE(value_sf, value_1qb, 0) > 0
        ORDER BY COALESCE(value_sf, value_1qb, 0) DESC
        LIMIT ?
        """,
        (limit,),
    ) as cur:
        rows = await cur.fetchall()

    ranked = []
    for row in rows:
        intelligence = await football_intelligence(db, row[0])
        ranked.append({
            "player_id": row[0],
            "name": row[1],
            "position": row[2],
            "team": row[3],
            "source_intelligence": intelligence,
            "blended_score": intelligence["summary"]["blended_score"],
            "confidence_score": intelligence["summary"]["confidence_score"],
        })
    ranked.sort(key=lambda item: (item["blended_score"], item["confidence_score"]), reverse=True)
    return ranked
