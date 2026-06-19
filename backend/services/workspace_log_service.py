"""Workspace-level activity (folders, project moves) shared across a team."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.teams_service import _require_team_member

MAX_ENTRIES = 300


def append_event(
    team_id: str,
    *,
    kind: str,
    label: str,
    user_id: str | None = None,
    user_name: str | None = None,
    project_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _require_team_member(team_id, user_id or "")
    entry_id = str(uuid.uuid4())[:10]
    now = datetime.now(timezone.utc).isoformat()
    meta_json = json.dumps(meta or {})
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO workspace_activity (id, team_id, project_id, kind, label, user_id, user_name, meta, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (entry_id, team_id, project_id, kind, label, user_id, user_name, meta_json, now),
        )
        conn.commit()
    return {
        "id": entry_id,
        "team_id": team_id,
        "project_id": project_id,
        "kind": kind,
        "label": label,
        "user_id": user_id,
        "user_name": user_name,
        "meta": meta or {},
        "created_at": now,
    }


def list_events(team_id: str, user_id: str, *, limit: int = 80) -> list[dict[str, Any]]:
    _require_team_member(team_id, user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, team_id, project_id, kind, label, user_id, user_name, meta, created_at
            FROM workspace_activity
            WHERE team_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (team_id, limit),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["meta"] = json.loads(d.get("meta") or "{}")
        except json.JSONDecodeError:
            d["meta"] = {}
        out.append(d)
    return out
