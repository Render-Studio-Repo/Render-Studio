"""
Marketplace ecosystem sync policy + stubs.

Honors local setup ecosystem_mode:
  private  -> blocked
  curated  -> only explicitly published items
  public   -> eligible public listings
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from backend.services import server_setup_service as setup


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sync_status() -> Dict[str, Any]:
    policy = setup.public_ecosystem_policy()
    return {
        "ok": True,
        "policy": policy,
        "endpoint": "https://render.studio/api/ecosystem/ingest",  # public hub (documented)
        "last_attempt_at": None,
        "queue_count": 0,
        "note": (
            "Local servers push public listings through this policy. "
            "Private mode never uploads. Curated mode requires explicit publish flags."
        ),
    }


def prepare_public_payload(items: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    policy = setup.public_ecosystem_policy()
    if policy.get("blocked"):
        return {
            "ok": False,
            "skipped": True,
            "reason": "ecosystem_private",
            "detail": "Server ecosystem mode is private — nothing will be uploaded.",
            "policy": policy,
        }

    rows = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        explicit = bool(item.get("publish_public") or item.get("public"))
        if policy.get("requires_explicit_publish") and not explicit:
            continue
        rows.append(
            {
                "id": item.get("id"),
                "title": item.get("title") or item.get("name"),
                "version": item.get("version") or "1.0.0",
                "kind": item.get("kind") or "model",
                "server_name": policy.get("server_name"),
                "published_at": _now_iso(),
            }
        )

    if policy.get("auto_publish_all") and not rows and items:
        # Public mode with provided items that lacked flags — include them.
        for item in items:
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "id": item.get("id"),
                    "title": item.get("title") or item.get("name"),
                    "version": item.get("version") or "1.0.0",
                    "kind": item.get("kind") or "model",
                    "server_name": policy.get("server_name"),
                    "published_at": _now_iso(),
                }
            )

    return {
        "ok": True,
        "dry_run": True,
        "policy": policy,
        "items": rows,
        "count": len(rows),
        "detail": "Payload prepared. Wire hub credentials before live upload.",
    }
