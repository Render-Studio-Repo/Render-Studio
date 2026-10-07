"""Marketplace ranking — popular models first, with explicit fair weights.

Score (higher is better)
------------------------
    score =
        1.00 * log1p(sales)          # completed paid orders
      + 0.35 * log1p(views)        # product-page views
      + 0.55 * rating_avg * log1p(rating_count)   # quality, damped by sample size
      + 0.40 * recency              # 1.0 at publish, ~0 after 180 days
      + 0.70 * sponsorship_boost  # 1 while an approved sponsorship/premium window is active
      + 0.45 * paid_boost          # 1 while a paid boost window is active
      + 0.25 * featured             # admin featured flag

Sponsorship/premium is stronger than paid boost so editorial trust beats
pay-to-win, but paid boost still surfaces new work. Neither can drown a
listing that is actually selling: a model with 40 sales and a 4.6★ rating
still outranks a brand-new sponsored listing with no traction.

Recency uses a 180-day half-ish linear decay from published_at (or created_at).
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

SALES_W = 1.00
VIEWS_W = 0.35
RATING_W = 0.55
RECENCY_W = 0.40
SPONSOR_W = 0.70
PAID_BOOST_W = 0.45
FEATURED_W = 0.25
RECENCY_DAYS = 180.0


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def recency_factor(published_at: str | None, *, now: datetime | None = None) -> float:
    dt = _parse_iso(published_at)
    if not dt:
        return 0.15
    now = now or datetime.now(timezone.utc)
    days = max(0.0, (now - dt).total_seconds() / 86400.0)
    return max(0.0, 1.0 - (days / RECENCY_DAYS))


def boost_active(listing: dict[str, Any], *, now: datetime | None = None) -> tuple[bool, bool]:
    """Return (sponsorship_active, paid_boost_active)."""
    now = now or datetime.now(timezone.utc)
    until = _parse_iso(listing.get("boosted_until"))
    status = str(listing.get("boost_status") or "").lower()
    if status != "approved":
        return False, False
    if until and until < now:
        return False, False
    kind = str(listing.get("boost_kind") or listing.get("premium_kind") or "sponsorship").lower()
    if kind in {"paid", "paid_boost", "boost"}:
        return False, True
    return True, False


def score_listing(listing: dict[str, Any], *, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    sales = max(0, int(listing.get("sales_count") or listing.get("sales") or 0))
    views = max(0, int(listing.get("view_count") or listing.get("views") or 0))
    rating_count = max(0, int(listing.get("rating_count") or 0))
    rating_sum = float(listing.get("rating_sum") or 0)
    if listing.get("rating_avg") is not None and not rating_sum:
        rating_avg = float(listing.get("rating_avg") or 0)
    else:
        rating_avg = (rating_sum / rating_count) if rating_count else 0.0
    rating_avg = max(0.0, min(5.0, rating_avg))
    published = listing.get("published_at") or listing.get("created_at")
    sponsor, paid = boost_active(listing, now=now)
    featured = 1.0 if listing.get("featured") else 0.0
    return (
        SALES_W * math.log1p(sales)
        + VIEWS_W * math.log1p(views)
        + RATING_W * rating_avg * math.log1p(rating_count)
        + RECENCY_W * recency_factor(published, now=now)
        + SPONSOR_W * (1.0 if sponsor else 0.0)
        + PAID_BOOST_W * (1.0 if paid else 0.0)
        + FEATURED_W * featured
    )


def rank_listings(listings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    scored: list[dict[str, Any]] = []
    for item in listings:
        row = dict(item)
        row["ranking_score"] = round(score_listing(row, now=now), 6)
        sponsor, paid = boost_active(row, now=now)
        row["sponsored"] = sponsor
        row["paid_boost_active"] = paid
        scored.append(row)
    scored.sort(
        key=lambda row: (
            float(row.get("ranking_score") or 0),
            str(row.get("published_at") or row.get("updated_at") or ""),
        ),
        reverse=True,
    )
    return scored
