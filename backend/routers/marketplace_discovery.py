"""Public, read-only marketplace discovery; visibility follows catalog settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.auth import get_current_user_optional
from backend.services.marketplace_discovery_service import discover

router = APIRouter()


@router.get("/api/marketplace/discover")
def marketplace_discover(
    q: str = Query(default="", max_length=600),
    kind: str = Query(default="", pattern=r"^(|model|agent|knowledge|skill)$"),
    limit: int = Query(default=6, ge=1, le=12),
    user: dict | None = Depends(get_current_user_optional),
):
    return discover(q.strip(), user_id=(user or {}).get("id"), kind=kind, limit=limit)
