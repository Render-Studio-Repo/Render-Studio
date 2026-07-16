"""Per-user texture library — source images, sphere previews, favorites."""

from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

MAX_TEXTURE_BYTES = 12 * 1024 * 1024
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_user(user_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(user_id or "user"))[:120] or "user"


def _library_root(user_id: str) -> Path:
    root = Path(settings.data_dir) / "texture_library" / _safe_user(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _texture_dir(user_id: str, texture_id: str) -> Path:
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(texture_id or ""))[:64]
    if not safe_id:
        raise ValueError("Invalid texture id")
    path = _library_root(user_id) / safe_id
    if not path.is_dir():
        raise ValueError("Texture not found")
    return path


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    raw = (data_url or "").strip()
    if not raw:
        raise ValueError("Image data is required")
    if raw.startswith("data:"):
        header, _, payload = raw.partition(",")
        if not payload:
            raise ValueError("Invalid image data URL")
        mime = "image/png"
        if ";" in header:
            mime = header[5:].split(";", 1)[0] or mime
        try:
            data = base64.b64decode(payload, validate=False)
        except Exception as exc:
            raise ValueError("Could not decode image data") from exc
        suffix = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
            "image/png": ".png",
        }.get(mime.lower(), ".png")
        return data, suffix
    # bare base64
    try:
        return base64.b64decode(raw, validate=False), ".png"
    except Exception as exc:
        raise ValueError("Could not decode image data") from exc


def _write_image(path: Path, data: bytes, suffix: str) -> Path:
    if len(data) > MAX_TEXTURE_BYTES:
        raise ValueError("Texture images must be under 12 MB")
    if suffix.lower() not in ALLOWED_IMAGE_SUFFIXES:
        raise ValueError("Upload PNG, JPEG, or WebP textures")
    path.parent.mkdir(parents=True, exist_ok=True)
    target = path.with_suffix(suffix.lower())
    target.write_bytes(data)
    return target


def _read_meta(folder: Path) -> dict[str, Any]:
    meta_path = folder / "meta.json"
    if not meta_path.is_file():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_meta(folder: Path, meta: dict[str, Any]) -> None:
    (folder / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _public_urls(user_id: str, texture_id: str, meta: dict[str, Any]) -> dict[str, str | None]:
    base = f"/api/users/me/textures/{texture_id}"
    source_name = meta.get("source_filename")
    sphere_name = meta.get("sphere_filename")
    return {
        "source_url": f"{base}/source" if source_name else None,
        "sphere_url": f"{base}/sphere" if sphere_name else None,
        "thumbnail_url": f"{base}/sphere" if sphere_name else (f"{base}/source" if source_name else None),
    }


def _serialize(user_id: str, folder: Path) -> dict[str, Any] | None:
    meta = _read_meta(folder)
    texture_id = meta.get("id") or folder.name
    if not meta.get("id"):
        return None
    urls = _public_urls(user_id, texture_id, meta)
    return {
        "id": texture_id,
        "name": meta.get("name") or "Texture",
        "favorite": bool(meta.get("favorite")),
        "source_label": meta.get("source_label") or "",
        "project_id": meta.get("project_id"),
        "created_at": meta.get("created_at"),
        "updated_at": meta.get("updated_at"),
        **urls,
    }


def list_textures(user_id: str, *, favorites_only: bool = False) -> list[dict[str, Any]]:
    root = _library_root(user_id)
    items: list[dict[str, Any]] = []
    for folder in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not folder.is_dir():
            continue
        item = _serialize(user_id, folder)
        if not item:
            continue
        if favorites_only and not item.get("favorite"):
            continue
        items.append(item)
    return items


def get_texture(user_id: str, texture_id: str) -> dict[str, Any]:
    folder = _texture_dir(user_id, texture_id)
    item = _serialize(user_id, folder)
    if not item:
        raise ValueError("Texture not found")
    return item


def create_texture(
    user_id: str,
    *,
    name: str | None = None,
    source_data_url: str | None = None,
    sphere_data_url: str | None = None,
    source_bytes: bytes | None = None,
    source_filename: str | None = None,
    source_label: str | None = None,
    project_id: str | None = None,
    favorite: bool = False,
) -> dict[str, Any]:
    texture_id = str(uuid.uuid4())[:12]
    folder = _library_root(user_id) / texture_id
    folder.mkdir(parents=True, exist_ok=True)

    source_path = None
    if source_data_url:
        data, suffix = _decode_data_url(source_data_url)
        source_path = _write_image(folder / "source", data, suffix)
    elif source_bytes is not None:
        suffix = Path(source_filename or "source.png").suffix.lower() or ".png"
        source_path = _write_image(folder / "source", source_bytes, suffix)
    else:
        raise ValueError("A source texture image is required")

    sphere_path = None
    if sphere_data_url:
        data, suffix = _decode_data_url(sphere_data_url)
        sphere_path = _write_image(folder / "sphere", data, suffix)

    clean_name = (name or Path(source_filename or "Texture").stem or "Texture").strip()[:80] or "Texture"
    meta = {
        "id": texture_id,
        "name": clean_name,
        "favorite": bool(favorite),
        "source_label": (source_label or "").strip()[:200],
        "project_id": project_id,
        "source_filename": source_path.name if source_path else None,
        "sphere_filename": sphere_path.name if sphere_path else None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _write_meta(folder, meta)
    return get_texture(user_id, texture_id)


def update_texture(
    user_id: str,
    texture_id: str,
    *,
    name: str | None = None,
    favorite: bool | None = None,
    source_label: str | None = None,
    sphere_data_url: str | None = None,
) -> dict[str, Any]:
    folder = _texture_dir(user_id, texture_id)
    meta = _read_meta(folder)
    if not meta.get("id"):
        raise ValueError("Texture not found")
    if name is not None:
        meta["name"] = (name or "Texture").strip()[:80] or "Texture"
    if favorite is not None:
        meta["favorite"] = bool(favorite)
    if source_label is not None:
        meta["source_label"] = (source_label or "").strip()[:200]
    if sphere_data_url:
        data, suffix = _decode_data_url(sphere_data_url)
        sphere_path = _write_image(folder / "sphere", data, suffix)
        # Remove previous sphere with different suffix
        for old in folder.glob("sphere.*"):
            if old != sphere_path:
                try:
                    old.unlink()
                except OSError:
                    pass
        meta["sphere_filename"] = sphere_path.name
    meta["updated_at"] = _now()
    _write_meta(folder, meta)
    return get_texture(user_id, texture_id)


def delete_texture(user_id: str, texture_id: str) -> dict[str, Any]:
    folder = _texture_dir(user_id, texture_id)
    import shutil

    shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True, "id": texture_id}


def resolve_texture_file(user_id: str, texture_id: str, kind: str) -> Path:
    folder = _texture_dir(user_id, texture_id)
    meta = _read_meta(folder)
    key = "source_filename" if kind == "source" else "sphere_filename"
    name = meta.get(key)
    if not name:
        # Fall back: sphere missing → source
        if kind == "sphere":
            name = meta.get("source_filename")
        if not name:
            raise ValueError("Texture file not found")
    path = folder / Path(name).name
    if not path.is_file():
        raise ValueError("Texture file not found")
    return path
