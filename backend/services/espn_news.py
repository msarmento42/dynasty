"""ESPN news API service wrappers."""

from __future__ import annotations

from typing import Any

import httpx

from backend.services import sleeper
from backend.services.player_identity import espn_to_sleeper_map


ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"
DEFAULT_TIMEOUT = 20.0


def _article_categories(article: dict[str, Any]) -> list[dict[str, Any]]:
    categories = article.get("categories") or []
    return [category for category in categories if isinstance(category, dict)]


def _normalize_article(article: dict[str, Any]) -> dict[str, Any]:
    athlete_ids = []
    athlete_names = []

    for category in _article_categories(article):
        if category.get("type") != "athlete":
            continue
        athlete_id = category.get("athleteId") or category.get("uid") or category.get("id")
        athlete_name = category.get("description") or category.get("displayName") or category.get("text")
        if athlete_id is not None:
            athlete_ids.append(str(athlete_id))
        if athlete_name:
            athlete_names.append(str(athlete_name))

    return {
        "headline": article.get("headline") or "",
        "detail": article.get("description") or article.get("byline") or "",
        "published_at": article.get("published") or article.get("lastModified") or "",
        "athlete_ids": athlete_ids,
        "athlete_names": athlete_names,
    }


async def fetch_nfl_news(limit: int = 50) -> list[dict[str, Any]]:
    """Fetch and normalize the latest NFL news from ESPN."""
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        response = await client.get(ESPN_NEWS_URL, params={"limit": limit})
        response.raise_for_status()

    data = response.json()
    articles = data.get("articles") if isinstance(data, dict) else []
    if not isinstance(articles, list):
        return []
    return [_normalize_article(article) for article in articles if isinstance(article, dict)]


async def fetch_news_for_players(sleeper_ids: list[str]) -> list[dict[str, Any]]:
    """Fetch NFL news and return articles mentioning any of the provided Sleeper player IDs."""
    wanted = {str(sleeper_id) for sleeper_id in sleeper_ids}
    all_players = await sleeper.fetch_all_players()
    espn_to_sleeper = espn_to_sleeper_map(all_players)
    articles = await fetch_nfl_news()

    filtered = []
    for article in articles:
        article_sleeper_ids = {
            espn_to_sleeper[athlete_id]
            for athlete_id in article["athlete_ids"]
            if athlete_id in espn_to_sleeper
        }
        if article_sleeper_ids & wanted:
            enriched = dict(article)
            enriched["sleeper_ids"] = sorted(article_sleeper_ids & wanted)
            filtered.append(enriched)

    return filtered
