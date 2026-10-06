"""Crew knowledge lake HTTP — scores, receipts, jobs, training."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from backend.services import agent_knowledge_lake as lake

router = APIRouter()


@router.get("/api/agent-knowledge/status")
def knowledge_status() -> dict[str, Any]:
    lake.seed_if_empty()
    return lake.status()


@router.get("/api/agent-knowledge/search")
def knowledge_search(
    q: str = Query(default="", max_length=200),
    kind: str = Query(default="", max_length=40),
    agent_id: str = Query(default="", max_length=80),
    feature_id: str = Query(default="", max_length=120),
    limit: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    return lake.search(query=q, kind=kind, agent_id=agent_id, feature_id=feature_id, limit=limit)


@router.get("/api/agent-knowledge/features")
def knowledge_features(
    q: str = Query(default="", max_length=200),
    locked_only: bool = Query(default=True),
    limit: int = Query(default=100, ge=1, le=200),
) -> dict[str, Any]:
    return lake.search_features(query=q, locked_only=locked_only, limit=limit)


@router.post("/api/agent-knowledge/ingest")
def knowledge_ingest(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    kind = str(body.get("kind") or "")
    if kind == "receipt":
        extra = body.get("score") if isinstance(body.get("score"), dict) else {}
        return lake.ingest_receipt(body.get("receipt") or body, extra=extra)
    if kind == "score":
        return lake.ingest_score(body)
    return lake.ingest(body)
