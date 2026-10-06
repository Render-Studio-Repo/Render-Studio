"""Per-user / per-project XR window hide + anchored pose (collab visibility)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.xr_window_visibility")

_NAME_MAX = 80


def _path(user_id: str) -> Path:
    root = Path(getattr(settings, "data_dir", None) or getattr(settings, "data_root", "data")) / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "xr_window_visibility.json"


def _read(user_id: str) -> dict[str, Any]:
    path = _path(user_id)
    if not path.is_file():
        return {"v": 1, "projects": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {"v": 1, "projects": {}}
    except Exception as exc:
        logger.debug("xr window visibility read failed: %s", exc)
        return {"v": 1, "projects": {}}


def _write(user_id: str, store: dict[str, Any]) -> dict[str, Any]:
    path = _path(user_id)
    path.write_text(json.dumps(store, indent=2), encoding="utf-8")
    return store


def _sanitize_window(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    win_id = str(raw.get("id") or "").strip()[:_NAME_MAX]
    if not win_id:
        return None
    pose = raw.get("pose") if isinstance(raw.get("pose"), dict) else {}
    clean_pose = {}
    for key in ("wx", "wy", "wz", "qx", "qy", "qz", "qw", "forward", "right", "up", "scale"):
        try:
            clean_pose[key] = float(pose.get(key))
        except (TypeError, ValueError):
            continue
    return {
        "id": win_id,
        "hidden": raw.get("hidden") is True,
        "curved": raw.get("curved") is True,
        "anchored": raw.get("anchored") is True,
        "pose": clean_pose,
    }


def load_visibility(user_id: str, project_id: str = "") -> dict[str, Any]:
    data = _read(user_id)
    projects = data.get("projects") if isinstance(data.get("projects"), dict) else {}
    pid = str(project_id or "").strip()
    if pid:
        raw_windows = projects.get(pid) if isinstance(projects.get(pid), dict) else {}
        windows = {}
        src = raw_windows.get("windows") if isinstance(raw_windows.get("windows"), dict) else raw_windows
        for key, val in src.items():
            clean = _sanitize_window({**(val if isinstance(val, dict) else {}), "id": key})
            if clean:
                windows[clean["id"]] = clean
        return {"v": 1, "projectId": pid, "windows": windows}
    return {"v": 1, "projects": projects}


def save_visibility(user_id: str, project_id: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    if not pid:
        return {"v": 1, "projectId": "", "windows": {}}
    incoming = payload if isinstance(payload, dict) else {}
    windows_in = incoming.get("windows") if isinstance(incoming.get("windows"), dict) else {}
    windows = {}
    for key, val in windows_in.items():
        clean = _sanitize_window({**(val if isinstance(val, dict) else {}), "id": key})
        if clean:
            windows[clean["id"]] = clean
    store = _read(user_id)
    projects = store.get("projects") if isinstance(store.get("projects"), dict) else {}
    projects[pid] = {"windows": windows}
    _write(user_id, {"v": 1, "projects": projects})
    return {"v": 1, "projectId": pid, "windows": windows}
