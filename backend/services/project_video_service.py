"""Per-project viewport video library (recent clips for re-edit / Share to X)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger("render3d")

_lock = threading.Lock()
_MAX_VIDEOS = 36
_MAX_BYTES = 180 * 1024 * 1024
_SAFE_LABEL = re.compile(r"[^\w\s\-.,!?()'/:+]+", re.UNICODE)
_VIDEO_EXTS = {".webm", ".mp4", ".mov", ".m4v", ".mkv"}


def videos_dir(project_path: Path) -> Path:
    path = Path(project_path) / "videos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _index_path(project_path: Path) -> Path:
    return videos_dir(project_path) / "index.json"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _sanitize_label(raw: str | None) -> str:
    text = _SAFE_LABEL.sub("", str(raw or "")).strip()
    return (text or "Viewport clip")[:80]


def _ext_for(filename: str, mime: str) -> str:
    name = str(filename or "").lower()
    for ext in _VIDEO_EXTS:
        if name.endswith(ext):
            return ext
    mime_l = str(mime or "").lower()
    if "mp4" in mime_l or "m4v" in mime_l:
        return ".mp4"
    if "quicktime" in mime_l or mime_l.endswith("/mov"):
        return ".mov"
    if "webm" in mime_l:
        return ".webm"
    return ".webm"


def _read_index(project_path: Path) -> list[dict[str, Any]]:
    path = _index_path(project_path)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _write_index(project_path: Path, items: list[dict[str, Any]]) -> None:
    _index_path(project_path).write_text(json.dumps(items, indent=2), encoding="utf-8")


def _content_hash(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data[: min(len(data), 2 * 1024 * 1024)])
    h.update(str(len(data)).encode("utf-8"))
    return h.hexdigest()[:24]


def _make_poster(video_path: Path, poster_path: Path) -> bool:
    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", "0.15",
                "-i", str(video_path),
                "-frames:v", "1",
                "-q:v", "4",
                str(poster_path),
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0 and poster_path.is_file() and poster_path.stat().st_size > 0


def _public_item(item: dict[str, Any], project_id: str) -> dict[str, Any]:
    vid = str(item.get("id") or "")
    return {
        "id": vid,
        "label": item.get("label") or "Viewport clip",
        "filename": item.get("filename"),
        "mime": item.get("mime") or "video/webm",
        "bytes": int(item.get("bytes") or 0),
        "created_at": item.get("created_at"),
        "has_poster": bool(item.get("has_poster")),
        "poster_url": f"/api/projects/{project_id}/videos/{vid}/poster" if item.get("has_poster") else None,
        "url": f"/api/projects/{project_id}/videos/{vid}",
    }


def list_videos(project_path: Path, project_id: str, *, limit: int = 24) -> list[dict[str, Any]]:
    items = _read_index(project_path)
    items = sorted(items, key=lambda row: str(row.get("created_at") or ""), reverse=True)
    out = []
    for item in items[: max(1, min(int(limit or 24), _MAX_VIDEOS))]:
        video_path = videos_dir(project_path) / str(item.get("filename") or "")
        if not video_path.is_file():
            continue
        out.append(_public_item(item, project_id))
    return out


def save_video(
    project_path: Path,
    project_id: str,
    *,
    data: bytes,
    filename: str = "clip.webm",
    mime: str = "video/webm",
    label: str | None = None,
) -> dict[str, Any]:
    if not data:
        raise ValueError("Video is empty.")
    if len(data) > _MAX_BYTES:
        raise ValueError("Video is too large to save (max 180 MB).")

    digest = _content_hash(data)
    with _lock:
        items = _read_index(project_path)
        for existing in items:
            if existing.get("content_hash") == digest:
                return {**_public_item(existing, project_id), "deduped": True}

        video_id = uuid.uuid4().hex[:12]
        ext = _ext_for(filename, mime)
        stored_name = f"{video_id}{ext}"
        folder = videos_dir(project_path)
        video_path = folder / stored_name
        video_path.write_bytes(data)

        poster_name = f"{video_id}.jpg"
        poster_path = folder / poster_name
        has_poster = _make_poster(video_path, poster_path)
        if not has_poster and poster_path.exists():
            try:
                poster_path.unlink()
            except OSError:
                pass

        item = {
            "id": video_id,
            "label": _sanitize_label(label),
            "filename": stored_name,
            "poster": poster_name if has_poster else None,
            "has_poster": has_poster,
            "mime": mime or ("video/mp4" if ext == ".mp4" else "video/webm"),
            "bytes": len(data),
            "content_hash": digest,
            "created_at": _now_iso(),
        }
        items.insert(0, item)
        # Prune oldest beyond cap
        keep: list[dict[str, Any]] = []
        for row in items:
            if len(keep) >= _MAX_VIDEOS:
                _delete_files(project_path, row)
                continue
            keep.append(row)
        _write_index(project_path, keep)
        return {**_public_item(item, project_id), "deduped": False}


def _delete_files(project_path: Path, item: dict[str, Any]) -> None:
    folder = videos_dir(project_path)
    for key in ("filename", "poster"):
        name = item.get(key)
        if not name:
            continue
        path = folder / str(name)
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass


def get_video_file(project_path: Path, video_id: str) -> tuple[Path, dict[str, Any]] | None:
    with _lock:
        items = _read_index(project_path)
    for item in items:
        if str(item.get("id") or "") != str(video_id):
            continue
        path = videos_dir(project_path) / str(item.get("filename") or "")
        if not path.is_file():
            return None
        return path, item
    return None


def get_poster_file(project_path: Path, video_id: str) -> Path | None:
    with _lock:
        items = _read_index(project_path)
    for item in items:
        if str(item.get("id") or "") != str(video_id):
            continue
        name = item.get("poster")
        if not name:
            return None
        path = videos_dir(project_path) / str(name)
        return path if path.is_file() else None
    return None


def delete_video(project_path: Path, video_id: str) -> bool:
    with _lock:
        items = _read_index(project_path)
        keep = []
        removed = None
        for item in items:
            if str(item.get("id") or "") == str(video_id):
                removed = item
                continue
            keep.append(item)
        if not removed:
            return False
        _delete_files(project_path, removed)
        _write_index(project_path, keep)
        return True
