"""Workspace-level activity (folders, project moves) shared across a team."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.teams_service import _require_team_member

MAX_ENTRIES = 300
MAX_META_CHARS = 2000


def _clip_meta(meta: dict[str, Any] | None) -> dict[str, Any]:
    raw = meta or {}
    try:
        text = json.dumps(raw, default=str)
    except TypeError:
        return {"_clipped": True}
    if len(text) <= MAX_META_CHARS:
        return raw
    return {"_clipped": True, "preview": text[: MAX_META_CHARS - 24] + "…"}


def _prune_team(conn, team_id: str) -> int:
    rows = conn.execute(
        """
        SELECT rowid FROM workspace_activity
        WHERE team_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
        """,
        (team_id, MAX_ENTRIES),
    ).fetchall()
    if not rows:
        return 0
    ids = [r[0] for r in rows]
    placeholders = ",".join("?" * len(ids))
    conn.execute(f"DELETE FROM workspace_activity WHERE rowid IN ({placeholders})", ids)
    return len(ids)


def prune_all_teams() -> int:
    removed = 0
    with get_conn() as conn:
        teams = conn.execute("SELECT DISTINCT team_id FROM workspace_activity").fetchall()
        for (tid,) in teams:
            removed += _prune_team(conn, tid)
        conn.commit()
    return removed


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
    clipped = _clip_meta(meta)
    meta_json = json.dumps(clipped)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO workspace_activity (id, team_id, project_id, kind, label, user_id, user_name, meta, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (entry_id, team_id, project_id, kind, label, user_id, user_name, meta_json, now),
        )
        _prune_team(conn, team_id)
        conn.commit()
    return {
        "id": entry_id,
        "team_id": team_id,
        "project_id": project_id,
        "kind": kind,
        "label": label,
        "user_id": user_id,
        "user_name": user_name,
        "meta": clipped,
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
