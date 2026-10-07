"""Public share permission trio: view / remix / edit, plus link comments."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VIDEO_SHARE_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".ogg"}
SHARE_MODES = ("view", "remix", "edit")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_video_filename(name: str | None) -> bool:
    return Path(str(name or "")).suffix.lower() in VIDEO_SHARE_EXTS


def normalize_share_mode(value: str | None) -> str:
    raw = str(value or "view").strip().lower().replace(" ", "_").replace("-", "_")
    if raw in {
        "edit",
        "editor",
        "remix_and_edit",
        "remixandedit",
        "view_edit_remix",
        "view_and_edit_remix",
        "view_and_remix_and_edit",
        "view_edit_and_remix",
    }:
        return "edit"
    if raw in {"remix", "remixer", "remix_only", "view_and_remix", "download"}:
        return "remix"
    return "view"


def share_mode_from_record(share: dict[str, Any] | None) -> str:
    if not isinstance(share, dict):
        return "view"
    stored = str(share.get("share_mode") or "").strip()
    if stored:
        return normalize_share_mode(stored)
    if share.get("allow_edit"):
        return "edit"
    if "allow_download" in share:
        return "remix" if share.get("allow_download") else "view"
    if "allow_remix" in share:
        return "remix" if share.get("allow_remix") else "view"
    # Legacy shares omitted flags and kept download/remix.
    return "remix"


def apply_share_mode(share: dict[str, Any], mode: str | None) -> dict[str, Any]:
    resolved = normalize_share_mode(mode)
    share["share_mode"] = resolved
    share["allow_download"] = resolved in {"remix", "edit"}
    share["allow_remix"] = resolved in {"remix", "edit"}
    share["allow_edit"] = resolved == "edit"
    return share


def share_mode_from_payload(payload: dict[str, Any] | None) -> str | None:
    body = payload if isinstance(payload, dict) else {}
    if "share_mode" in body or "mode" in body:
        return normalize_share_mode(str(body.get("share_mode") or body.get("mode") or "view"))
    if "allow_edit" in body and body.get("allow_edit"):
        return "edit"
    if "allow_remix" in body or "allow_download" in body:
        if body.get("allow_edit"):
            return "edit"
        if body.get("allow_remix") or body.get("allow_download"):
            return "remix"
        return "view"
    return None


def share_client_flags(share: dict[str, Any] | None) -> dict[str, Any]:
    mode = share_mode_from_record(share)
    return {
        "share_mode": mode,
        "allow_download": mode in {"remix", "edit"},
        "allow_remix": mode in {"remix", "edit"},
        "allow_edit": mode == "edit",
    }


def join_role_for_mode(mode: str | None) -> str:
    resolved = normalize_share_mode(mode)
    if resolved == "edit":
        return "editor"
    if resolved == "remix":
        return "remixer"
    return "viewer"


def _clamp01(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _sanitize_markup_geometry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in ("x", "y", "w", "h", "x1", "y1", "x2", "y2"):
        if key in raw and raw.get(key) is not None:
            out[key] = _clamp01(raw.get(key))
    points = raw.get("points")
    if isinstance(points, list):
        cleaned = []
        for point in points[:400]:
            if isinstance(point, dict):
                cleaned.append({"x": _clamp01(point.get("x")), "y": _clamp01(point.get("y"))})
        if cleaned:
            out["points"] = cleaned
    return out


def list_share_comments(share: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows = (share or {}).get("comments") if isinstance(share, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "comment").lower()
        if kind in {"markup", "pin"} or str(row.get("text") or "").strip() or row.get("geometry") or row.get("tool"):
            out.append(dict(row))
    out.sort(key=lambda item: float(item.get("t") or 0))
    return out[-400:]


def add_share_comment(
    share: dict[str, Any],
    *,
    text: str,
    t: float | None = None,
    x: float | None = None,
    y: float | None = None,
    kind: str = "comment",
    author: dict[str, Any] | None = None,
    allow_pin: bool = False,
    tool: str | None = None,
    geometry: dict[str, Any] | None = None,
    color: str | None = None,
    duration: float | None = None,
) -> dict[str, Any]:
    raw_kind = str(kind or "comment").strip().lower()
    resolved_kind = "markup" if raw_kind == "markup" else ("pin" if raw_kind == "pin" else "comment")
    if resolved_kind == "pin" and not allow_pin:
        raise PermissionError("Pin markup needs remix-and-edit permission")
    tool_name = str(tool or "").strip().lower()[:40]
    geom = _sanitize_markup_geometry(geometry)
    body = str(text or "").strip()[:2000]
    if not body:
        if resolved_kind == "markup" and (tool_name or geom):
            body = tool_name or "markup"
        else:
            raise ValueError("Comment text is required")
    comment = {
        "id": uuid.uuid4().hex[:16],
        "text": body,
        "t": max(0.0, float(t or 0)),
        "kind": resolved_kind,
        "created_at": _now(),
        "author_name": str((author or {}).get("display_name") or (author or {}).get("name") or "Guest")[:80],
        "author_id": str((author or {}).get("id") or "")[:80],
        "avatar_url": str((author or {}).get("avatar_url") or "")[:400],
    }
    if x is not None:
        comment["x"] = _clamp01(x)
    if y is not None:
        comment["y"] = _clamp01(y)
    if tool_name:
        comment["tool"] = tool_name
    if geom:
        comment["geometry"] = geom
    if color:
        comment["color"] = str(color).strip()[:32]
    if resolved_kind in {"markup", "pin"} or tool_name:
        try:
            hold = float(duration) if duration is not None else 3.2
        except (TypeError, ValueError):
            hold = 3.2
        comment["duration"] = max(0.4, min(12.0, hold))
    rows = share.setdefault("comments", [])
    if not isinstance(rows, list):
        rows = []
        share["comments"] = rows
    rows.append(comment)
    if len(rows) > 400:
        del rows[:-400]
    snapshot_markup_revision(share)
    return comment


def snapshot_markup_revision(share: dict[str, Any]) -> dict[str, Any]:
    comments = list_share_comments(share)
    t = max((float(item.get("t") or 0) for item in comments), default=0.0)
    revision = {
        "id": uuid.uuid4().hex[:16],
        "t": t,
        "created_at": _now(),
        "comments": [dict(item) for item in comments],
    }
    rows = share.setdefault("markup_revisions", [])
    if not isinstance(rows, list):
        rows = []
        share["markup_revisions"] = rows
    rows.append(revision)
    if len(rows) > 40:
        del rows[:-40]
    return revision


def list_markup_revisions(share: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows = (share or {}).get("markup_revisions") if isinstance(share, dict) else None
    if not isinstance(rows, list):
        return []
    return [dict(row) for row in rows if isinstance(row, dict)][-40:]


def delete_share_comment(share: dict[str, Any], comment_id: str) -> dict[str, Any] | None:
    rows = share.get("comments")
    if not isinstance(rows, list):
        return None
    found = None
    kept: list[dict[str, Any]] = []
    wanted = str(comment_id or "")
    for row in rows:
        if isinstance(row, dict) and str(row.get("id") or "") == wanted:
            found = row
            continue
        if isinstance(row, dict):
            kept.append(row)
    share["comments"] = kept
    if found:
        snapshot_markup_revision(share)
    return found


def restore_markup_revision(
    share: dict[str, Any],
    *,
    revision_id: str | None = None,
    t: float | None = None,
) -> list[dict[str, Any]]:
    revisions = list_markup_revisions(share)
    chosen = None
    if revision_id:
        chosen = next((row for row in revisions if str(row.get("id") or "") == str(revision_id)), None)
    if chosen is None and t is not None:
        want = float(t)
        chosen = min(revisions, key=lambda row: abs(float(row.get("t") or 0) - want), default=None)
    if chosen is None:
        raise ValueError("No markup revision to restore")
    share["comments"] = [dict(row) for row in (chosen.get("comments") or []) if isinstance(row, dict)]
    snapshot_markup_revision(share)
    return list_share_comments(share)


def clear_share_markups(share: dict[str, Any]) -> list[dict[str, Any]]:
    rows = list_share_comments(share)
    share["comments"] = [
        row for row in rows
        if str(row.get("kind") or "comment") == "comment" and not row.get("tool")
    ]
    snapshot_markup_revision(share)
    return list_share_comments(share)
