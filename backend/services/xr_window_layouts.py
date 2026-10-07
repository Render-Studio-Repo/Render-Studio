"""Per-user named XR window layouts (any project can apply them)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.xr_window_layouts")

_MAX_LAYOUTS = 8
_MAX_THUMB = 12000
_NAME_MAX = 40


def _path(user_id: str) -> Path:
    root = Path(getattr(settings, "data_dir", None) or getattr(settings, "data_root", "data")) / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "xr_window_layouts.json"


def _read(user_id: str) -> dict[str, Any]:
    path = _path(user_id)
    if not path.is_file():
        return {"v": 1, "layouts": [], "lastId": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {"v": 1, "layouts": [], "lastId": ""}
    except Exception as exc:
        logger.debug("xr layouts read failed: %s", exc)
        return {"v": 1, "layouts": [], "lastId": ""}


def _write(user_id: str, store: dict[str, Any]) -> dict[str, Any]:
    path = _path(user_id)
    path.write_text(json.dumps(store, indent=2), encoding="utf-8")
    return store


def _sanitize_pose(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    def clamp(key: str, lo: float, hi: float, fallback: float) -> float:
        try:
            n = float(raw.get(key))
        except (TypeError, ValueError):
            n = fallback
        if n != n:
            n = fallback
        return max(lo, min(hi, n))

    pose = {
        "v": 2,
        "visible": raw.get("visible") is True,
        "forward": clamp("forward", 0.25, 2.4, 0.7),
        "right": clamp("right", -1.6, 1.6, 0.0),
        "up": clamp("up", -0.8, 0.5, -0.08),
    }
    tab = str(raw.get("tab") or "").strip()[:24]
    if tab:
        pose["tab"] = tab
    return pose


def _sanitize_layout(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    poses_in = raw.get("poses") if isinstance(raw.get("poses"), dict) else {}
    poses = {}
    for kind, pose in poses_in.items():
        key = str(kind)[:24]
        clean = _sanitize_pose(pose)
        if clean:
            poses[key] = clean
    open_flags = {}
    src_open = raw.get("open") if isinstance(raw.get("open"), dict) else {}
    for key, val in src_open.items():
        open_flags[str(key)[:24]] = val is True
    layout_id = str(raw.get("id") or "").strip()[:32]
    if not layout_id:
        return None
    thumb = str(raw.get("thumb") or "")[:_MAX_THUMB]
    return {
        "id": layout_id,
        "name": (str(raw.get("name") or "Layout 1").strip() or "Layout 1")[:_NAME_MAX],
        "thumb": thumb,
        "createdAt": int(raw.get("createdAt") or 0) or 0,
        "lastUsedAt": int(raw.get("lastUsedAt") or 0) or 0,
        "menuTab": str(raw.get("menuTab") or "")[:24],
        "poses": poses,
        "open": open_flags,
    }


def load_layouts(user_id: str) -> dict[str, Any]:
    data = _read(user_id)
    layouts = []
    for row in data.get("layouts") or []:
        clean = _sanitize_layout(row)
        if clean:
            layouts.append(clean)
    layouts = layouts[:_MAX_LAYOUTS]
    last_id = str(data.get("lastId") or "")
    if last_id and not any(l["id"] == last_id for l in layouts):
        last_id = layouts[0]["id"] if layouts else ""
    return {"v": 1, "layouts": layouts, "lastId": last_id}


def save_layouts(user_id: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    incoming = payload if isinstance(payload, dict) else {}
    layouts = []
    for row in incoming.get("layouts") or []:
        clean = _sanitize_layout(row)
        if clean:
            layouts.append(clean)
    layouts = layouts[:_MAX_LAYOUTS]
    last_id = str(incoming.get("lastId") or "")
    if last_id and not any(l["id"] == last_id for l in layouts):
        last_id = layouts[0]["id"] if layouts else ""
    return _write(user_id, {"v": 1, "layouts": layouts, "lastId": last_id})
