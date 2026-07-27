"""Phone / remote clip capture sessions for the viewport video studio."""

from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from backend.config import settings

_lock = threading.Lock()
_SESSION_TTL_SEC = 60 * 60 * 2  # 2 hours
_MAX_CLIP_BYTES = 180 * 1024 * 1024
_MAX_CLIPS_PER_SESSION = 24

_SAFE_LABEL = re.compile(r"[^\w\s\-.,!?()'/]+", re.UNICODE)


def _root() -> Path:
    path = Path(settings.data_dir) / "video_capture"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session_dir(token: str) -> Path:
    return _root() / token


def _meta_path(token: str) -> Path:
    return _session_dir(token) / "session.json"


def _now() -> float:
    return time.time()


def _sanitize_label(raw: str | None) -> str:
    text = _SAFE_LABEL.sub("", str(raw or "")).strip()
    return (text or "Phone clip")[:80]


def _read_meta(token: str) -> dict[str, Any] | None:
    path = _meta_path(token)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_meta(token: str, data: dict[str, Any]) -> None:
    folder = _session_dir(token)
    folder.mkdir(parents=True, exist_ok=True)
    _meta_path(token).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _expired(meta: dict[str, Any]) -> bool:
    return float(meta.get("expires_at") or 0) < _now()


def cleanup_expired() -> int:
    removed = 0
    root = _root()
    if not root.is_dir():
        return 0
    with _lock:
        for folder in root.iterdir():
            if not folder.is_dir():
                continue
            meta = _read_meta(folder.name)
            if meta is None or _expired(meta):
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
    return removed


def create_session(user_id: str, *, project_id: str | None = None, hint: str | None = None) -> dict[str, Any]:
    cleanup_expired()
    token = secrets.token_urlsafe(18)
    created = _now()
    meta = {
        "token": token,
        "user_id": str(user_id),
        "project_id": project_id,
        "hint": (str(hint or "").strip() or "Record a clip for your Render3D edit")[:160],
        "created_at": created,
        "expires_at": created + _SESSION_TTL_SEC,
        "clips": [],
    }
    with _lock:
        _write_meta(token, meta)
    return public_session(meta, include_owner=True)


def public_session(meta: dict[str, Any], *, include_owner: bool = False) -> dict[str, Any]:
    clips = meta.get("clips") or []
    out = {
        "token": meta.get("token"),
        "hint": meta.get("hint") or "",
        "expires_at": meta.get("expires_at"),
        "clip_count": len(clips),
        "clips": [
            {
                "id": c.get("id"),
                "label": c.get("label"),
                "filename": c.get("filename"),
                "mime": c.get("mime"),
                "size": c.get("size"),
                "created_at": c.get("created_at"),
                "source": c.get("source") or "phone",
            }
            for c in clips
            if isinstance(c, dict)
        ],
    }
    if include_owner:
        out["user_id"] = meta.get("user_id")
        out["project_id"] = meta.get("project_id")
    return out


def get_session(token: str, *, require_user_id: str | None = None) -> dict[str, Any]:
    token = str(token or "").strip()
    if not token or "/" in token or ".." in token:
        raise FileNotFoundError("Capture session not found.")
    with _lock:
        meta = _read_meta(token)
        if meta is None or _expired(meta):
            if meta is not None:
                shutil.rmtree(_session_dir(token), ignore_errors=True)
            raise FileNotFoundError("Capture session expired or not found.")
        if require_user_id and str(meta.get("user_id")) != str(require_user_id):
            raise PermissionError("Not your capture session.")
        return meta


def add_clip(
    token: str,
    *,
    raw: bytes,
    filename: str,
    mime: str,
    label: str | None = None,
    source: str = "phone",
) -> dict[str, Any]:
    if not raw:
        raise ValueError("Video file is empty.")
    if len(raw) > _MAX_CLIP_BYTES:
        raise ValueError("Video is too large (max 180 MB).")

    with _lock:
        meta = get_session(token)
        clips = list(meta.get("clips") or [])
        if len(clips) >= _MAX_CLIPS_PER_SESSION:
            raise ValueError("This session already has the maximum number of clips.")

        clip_id = secrets.token_hex(8)
        safe_name = Path(filename or "clip.webm").name
        ext = Path(safe_name).suffix.lower()
        if ext not in {".webm", ".mp4", ".mov", ".m4v", ".mkv"}:
            if "mp4" in (mime or "").lower() or "quicktime" in (mime or "").lower():
                ext = ".mp4"
            else:
                ext = ".webm"
        stored = f"{clip_id}{ext}"
        path = _session_dir(token) / stored
        path.write_bytes(raw)
        entry = {
            "id": clip_id,
            "label": _sanitize_label(label),
            "filename": stored,
            "original_name": safe_name[:120],
            "mime": (mime or "video/webm")[:80],
            "size": len(raw),
            "created_at": _now(),
            "source": (source or "phone")[:32],
        }
        clips.append(entry)
        meta["clips"] = clips
        _write_meta(token, meta)
        return entry


def clip_path(token: str, clip_id: str) -> tuple[Path, dict[str, Any]]:
    meta = get_session(token)
    for clip in meta.get("clips") or []:
        if str(clip.get("id")) == str(clip_id):
            path = _session_dir(token) / str(clip.get("filename"))
            if not path.is_file():
                raise FileNotFoundError("Clip file missing.")
            return path, clip
    raise FileNotFoundError("Clip not found.")


def delete_clip(token: str, clip_id: str, *, user_id: str) -> None:
    with _lock:
        meta = get_session(token, require_user_id=user_id)
        clips = list(meta.get("clips") or [])
        keep = []
        removed = None
        for clip in clips:
            if str(clip.get("id")) == str(clip_id):
                removed = clip
            else:
                keep.append(clip)
        if removed is None:
            raise FileNotFoundError("Clip not found.")
        path = _session_dir(token) / str(removed.get("filename"))
        path.unlink(missing_ok=True)
        meta["clips"] = keep
        _write_meta(token, meta)


def close_session(token: str, *, user_id: str) -> None:
    with _lock:
        get_session(token, require_user_id=user_id)
        shutil.rmtree(_session_dir(token), ignore_errors=True)
