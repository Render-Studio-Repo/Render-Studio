"""Cross-device XR capture inbox — Quest finishes a clip, PC sessions get Share-to-X."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.xr_capture_inbox")

_MAX_PENDING = 12
_TTL_SEC = 60 * 60 * 6  # 6 hours


def _inbox_path(user_id: str) -> Path:
    root = Path(settings.data_root) / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "xr_capture_inbox.json"


def _read(user_id: str) -> list[dict[str, Any]]:
    path = _inbox_path(user_id)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "[]")
        return data if isinstance(data, list) else []
    except Exception as exc:
        logger.debug("xr inbox read failed: %s", exc)
        return []


def _write(user_id: str, items: list[dict[str, Any]]) -> None:
    path = _inbox_path(user_id)
    path.write_text(json.dumps(items[-_MAX_PENDING:], indent=2), encoding="utf-8")


def _prune(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = time.time()
    return [it for it in items if (now - float(it.get("created_at") or 0)) < _TTL_SEC]


def list_pending(user_id: str) -> list[dict[str, Any]]:
    items = _prune(_read(user_id))
    _write(user_id, items)
    return items


def push_capture(
    user_id: str,
    *,
    project_id: str,
    kind: str,
    filename: str,
    url: str,
    mode_label: str | None = None,
    source_client_id: str | None = None,
) -> dict[str, Any]:
    items = _prune(_read(user_id))
    entry = {
        "id": uuid.uuid4().hex[:16],
        "type": "xr.capture.ready",
        "project_id": project_id,
        "kind": "video" if kind == "video" else "screenshot",
        "filename": filename,
        "url": url,
        "mode_label": mode_label or "AR",
        "source_client_id": source_client_id or "",
        "created_at": time.time(),
    }
    items.append(entry)
    _write(user_id, items)
    return entry


def ack_capture(user_id: str, capture_id: str) -> bool:
    items = _prune(_read(user_id))
    next_items = [it for it in items if str(it.get("id")) != str(capture_id)]
    changed = len(next_items) != len(items)
    if changed:
        _write(user_id, next_items)
    return changed
