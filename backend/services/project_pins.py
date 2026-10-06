"""Per-user personal project pins (max 5). GET/PUT /api/users/me/project-pins."""

from __future__ import annotations

import json
from typing import Any

from backend.database import get_conn

MAX_PERSONAL_PINS = 5
CAP_MESSAGE = "Unpin one project first — you can pin up to 5."


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_project_pins (
              user_id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """
        )
        conn.commit()


def normalize_ids(ids: Any) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in ids or []:
        value = str(raw or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def get_pins(user_id: str) -> list[str]:
    ensure_schema()
    uid = str(user_id or "").strip()
    if not uid:
        return []
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM user_project_pins WHERE user_id = ?",
            (uid,),
        ).fetchone()
    if not row:
        return []
    try:
        payload = json.loads(row["payload"] or "[]")
    except Exception:
        payload = []
    if isinstance(payload, dict):
        payload = payload.get("pinned_ids") or payload.get("pinnedIds") or []
    return normalize_ids(payload)


def put_pins(user_id: str, ids: Any) -> list[str]:
    ensure_schema()
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("Missing user")
    next_ids = normalize_ids(ids)
    if len(next_ids) > MAX_PERSONAL_PINS:
        raise ValueError(CAP_MESSAGE)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_project_pins (user_id, payload, updated_at)
            VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(user_id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (uid, json.dumps(next_ids)),
        )
        conn.commit()
    return next_ids
