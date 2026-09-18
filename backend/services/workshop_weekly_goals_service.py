"""Read-only Workshop weekly goals mirror helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
MIRROR_PATH = ROOT / "sandbox-sessions" / "workshop" / "weekly-goals" / "latest.json"
CHICAGO_TZ = ZoneInfo("America/Chicago")
VALID_SOURCES = {"current", "manual"}
VALID_STATUSES = {"todo", "doing", "done", "blocked"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _current_week_id(now: datetime | None = None) -> str:
    local_now = (now or datetime.now(timezone.utc)).astimezone(CHICAGO_TZ)
    iso = local_now.date().isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _empty_state(*, source: str = "manual", updated_at: str | None = None) -> dict[str, Any]:
    return {
        "week_id": _current_week_id(),
        "updated_at": updated_at or _now_iso(),
        "source": source if source in VALID_SOURCES else "manual",
        "goals": [],
    }


def _coerce_goal(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    goal_id = str(value.get("id") or "").strip()
    title = str(value.get("title") or "").strip()
    owner_slug = str(value.get("owner_slug") or "").strip()
    if not goal_id or not title or not owner_slug:
        return None
    status = str(value.get("status") or "todo").strip().lower()
    if status not in VALID_STATUSES:
        status = "todo"
    goal: dict[str, Any] = {
        "id": goal_id,
        "title": title,
        "owner_slug": owner_slug,
        "status": status,
    }
    claim_id = str(value.get("claim_id") or "").strip()
    if claim_id:
        goal["claim_id"] = claim_id
    return goal


def normalize_state(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return _empty_state()
    week_id = str(value.get("week_id") or "").strip() or _current_week_id()
    updated_at = str(value.get("updated_at") or "").strip() or _now_iso()
    source = str(value.get("source") or "manual").strip().lower()
    if source not in VALID_SOURCES:
        source = "manual"
    goals_raw = value.get("goals")
    goals = []
    if isinstance(goals_raw, list):
        for item in goals_raw:
            goal = _coerce_goal(item)
            if goal:
                goals.append(goal)
    return {
        "week_id": week_id,
        "updated_at": updated_at,
        "source": source,
        "goals": goals,
    }


def get_state() -> dict[str, Any]:
    if not MIRROR_PATH.is_file():
        return _empty_state()
    try:
        data = json.loads(MIRROR_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _empty_state(updated_at=_now_iso())
    return normalize_state(data)
