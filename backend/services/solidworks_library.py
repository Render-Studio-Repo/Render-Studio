"""Personal SolidWorks library — store STEP/SLDPRT, import into projects, push edits back."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

LIBRARY_SUFFIXES = {".step", ".stp", ".sldprt", ".sldasm", ".stl", ".3mf"}
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def library_root(user_id: str) -> Path:
    root = Path(settings.data_dir) / "solidworks_library" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(name: str) -> str:
    raw = Path(str(name or "part")).name
    stem = _SAFE_NAME.sub("_", Path(raw).stem).strip("._") or "part"
    suffix = Path(raw).suffix.lower()
    if suffix not in LIBRARY_SUFFIXES:
        suffix = ".step"
    return f"{stem[:80]}{suffix}"


def _item_dir(user_id: str, item_id: str) -> Path:
    path = library_root(user_id) / item_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def _meta_path(user_id: str, item_id: str) -> Path:
    return _item_dir(user_id, item_id) / "item.json"


def _read_meta(user_id: str, item_id: str) -> dict[str, Any] | None:
    path = _meta_path(user_id, item_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_meta(user_id: str, item_id: str, meta: dict[str, Any]) -> None:
    _meta_path(user_id, item_id).write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _file_path(user_id: str, meta: dict[str, Any]) -> Path:
    return _item_dir(user_id, str(meta["id"])) / str(meta["filename"])


def list_items(user_id: str) -> list[dict[str, Any]]:
    root = library_root(user_id)
    items: list[dict[str, Any]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        meta = _read_meta(user_id, child.name)
        if not meta:
            continue
        path = _file_path(user_id, meta)
        try:
            size = path.stat().st_size if path.is_file() else 0
        except OSError:
            size = 0
        meta["size"] = size
        items.append(meta)
    items.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return items


def get_item(user_id: str, item_id: str) -> dict[str, Any] | None:
    meta = _read_meta(user_id, item_id)
    if not meta:
        return None
    path = _file_path(user_id, meta)
    if not path.is_file():
        return None
    meta["size"] = path.stat().st_size
    meta["path"] = path
    return meta


def add_item(user_id: str, filename: str, data: bytes, *, folder: str = "My Parts") -> dict[str, Any]:
    if not data:
        raise ValueError("Empty file.")
    safe = _safe_filename(filename)
    item_id = uuid.uuid4().hex[:12]
    folder_label = str(folder or "My Parts").strip()[:80] or "My Parts"
    now = _now()
    meta = {
        "id": item_id,
        "name": Path(safe).stem.replace("_", " "),
        "filename": safe,
        "original_name": Path(str(filename or safe)).name,
        "folder": folder_label,
        "created_at": now,
        "updated_at": now,
    }
    dest = _file_path(user_id, meta)
    dest.write_bytes(data)
    _write_meta(user_id, item_id, meta)
    meta["size"] = dest.stat().st_size
    return meta


def replace_item(user_id: str, item_id: str, filename: str, data: bytes) -> dict[str, Any]:
    meta = get_item(user_id, item_id)
    if not meta:
        raise FileNotFoundError(item_id)
    old = Path(meta["path"])
    safe = _safe_filename(filename or meta.get("filename") or "part.step")
    meta["filename"] = safe
    meta["updated_at"] = _now()
    dest = _item_dir(user_id, item_id) / safe
    dest.write_bytes(data)
    if old.is_file() and old.resolve() != dest.resolve():
        try:
            old.unlink()
        except OSError:
            pass
    store = {k: v for k, v in meta.items() if k not in {"path", "size"}}
    _write_meta(user_id, item_id, store)
    meta["size"] = dest.stat().st_size
    meta["path"] = dest
    return meta


def delete_item(user_id: str, item_id: str) -> bool:
    meta = _read_meta(user_id, item_id)
    if not meta:
        return False
    folder = _item_dir(user_id, item_id)
    try:
        for child in folder.iterdir():
            child.unlink()
        folder.rmdir()
    except OSError:
        return False
    return True
