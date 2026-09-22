"""Site branding / server-settings store (product name, logo, loading screen).

Persists under data/branding/. Public consumers can read defaults without auth.
Admin uploads stay on disk; URLs are served via /api/branding/assets/...
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from backend.config import settings

DEFAULT_PRODUCT_NAME = "Render Studio"
DEFAULT_LOGO_URL = "/assets/loading-screen/render-studio-logo.png?v=20260908-branding"
DEFAULT_LOADING_SCREEN_URL = ""  # empty = built-in PC boot animation
ATTRIBUTION_LOGO_URL = "/assets/loading-screen/render-studio-logo.png?v=20260908-branding"
ATTRIBUTION_REPO_URL = "https://github.com/wprojects/Render-Studio"

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$")

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
_LOADING_EXTS = _IMAGE_EXTS | {".mp4", ".webm"}


def branding_root() -> Path:
    root = Path(settings.data_dir) / "branding"
    root.mkdir(parents=True, exist_ok=True)
    (root / "uploads").mkdir(parents=True, exist_ok=True)
    return root


def settings_path() -> Path:
    return branding_root() / "settings.json"


def uploads_dir() -> Path:
    return branding_root() / "uploads"


def _default_settings() -> dict[str, Any]:
    return {
        "product_name": DEFAULT_PRODUCT_NAME,
        "logo_asset": None,
        "loading_screen_asset": None,
        "updated_at": None,
    }


def _read_raw() -> dict[str, Any]:
    path = settings_path()
    if not path.is_file():
        return _default_settings()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _default_settings()
    if not isinstance(data, dict):
        return _default_settings()
    merged = _default_settings()
    merged.update({k: data.get(k) for k in merged.keys() if k in data})
    return merged


def _write_raw(data: dict[str, Any]) -> dict[str, Any]:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {**_default_settings(), **data, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def _asset_public_url(filename: str | None) -> str | None:
    if not filename or not _SAFE_NAME.match(filename):
        return None
    path = uploads_dir() / filename
    if not path.is_file():
        return None
    mtime = int(path.stat().st_mtime)
    return f"/api/branding/assets/{filename}?v={mtime}"


def public_branding() -> dict[str, Any]:
    raw = _read_raw()
    name = str(raw.get("product_name") or DEFAULT_PRODUCT_NAME).strip() or DEFAULT_PRODUCT_NAME
    logo_url = _asset_public_url(raw.get("logo_asset")) or DEFAULT_LOGO_URL
    loading_url = _asset_public_url(raw.get("loading_screen_asset")) or DEFAULT_LOADING_SCREEN_URL
    return {
        "product_name": name,
        "logo_url": logo_url,
        "loading_screen_url": loading_url,
        "loading_screen_builtin": not bool(loading_url),
        "attribution_logo_url": ATTRIBUTION_LOGO_URL,
        "attribution_repo_url": ATTRIBUTION_REPO_URL,
        "updated_at": raw.get("updated_at"),
    }


def admin_branding() -> dict[str, Any]:
    raw = _read_raw()
    public = public_branding()
    return {
        **public,
        "logo_asset": raw.get("logo_asset"),
        "loading_screen_asset": raw.get("loading_screen_asset"),
        "defaults": {
            "product_name": DEFAULT_PRODUCT_NAME,
            "logo_url": DEFAULT_LOGO_URL,
            "loading_screen_url": DEFAULT_LOADING_SCREEN_URL,
            "attribution_logo_url": ATTRIBUTION_LOGO_URL,
            "attribution_repo_url": ATTRIBUTION_REPO_URL,
        },
    }


def update_product_name(product_name: str) -> dict[str, Any]:
    name = " ".join(str(product_name or "").split()).strip()
    if not name:
        raise ValueError("Product name cannot be empty.")
    if len(name) > 64:
        raise ValueError("Product name must be 64 characters or fewer.")
    raw = _read_raw()
    raw["product_name"] = name
    _write_raw(raw)
    return admin_branding()


def _sniff_ext(filename: str, content_type: str, data: bytes) -> str:
    media = (content_type or "").lower().split(";")[0].strip()
    name = (filename or "").lower()
    suffix = Path(name).suffix
    if suffix in _LOADING_EXTS:
        return suffix
    if media == "image/png" or data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if media in {"image/jpeg", "image/jpg"} or data.startswith(b"\xff\xd8"):
        return ".jpg"
    if media == "image/webp" or (len(data) > 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP"):
        return ".webp"
    if media == "image/gif" or data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if media in {"image/svg+xml", "text/xml", "application/xml"} or data.lstrip().startswith(b"<svg") or data.lstrip().startswith(b"<?xml"):
        return ".svg"
    if media == "video/mp4" or (len(data) > 8 and data[4:8] == b"ftyp"):
        return ".mp4"
    if media == "video/webm" or data.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    raise ValueError("Unsupported file type. Use PNG, JPEG, WEBP, GIF, SVG, MP4, or WEBM.")


def _save_upload(*, kind: str, filename: str, content_type: str, data: bytes, allowed: set[str]) -> str:
    if not data:
        raise ValueError("Uploaded file is empty.")
    if len(data) > 12_000_000:
        raise ValueError("File must be under 12 MB.")
    ext = _sniff_ext(filename, content_type, data)
    if ext not in allowed:
        raise ValueError(f"Unsupported type for {kind}. Allowed: {', '.join(sorted(allowed))}")
    stamp = int(time.time())
    out_name = f"{kind}-{stamp}{ext}"
    path = uploads_dir() / out_name
    path.write_bytes(data)
    return out_name


def _remove_asset(filename: str | None) -> None:
    if not filename or not _SAFE_NAME.match(filename):
        return
    path = uploads_dir() / filename
    if path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def save_logo_upload(*, filename: str, content_type: str, data: bytes) -> dict[str, Any]:
    out_name = _save_upload(kind="logo", filename=filename, content_type=content_type, data=data, allowed=_IMAGE_EXTS)
    raw = _read_raw()
    _remove_asset(raw.get("logo_asset"))
    raw["logo_asset"] = out_name
    _write_raw(raw)
    return admin_branding()


def save_loading_screen_upload(*, filename: str, content_type: str, data: bytes) -> dict[str, Any]:
    out_name = _save_upload(
        kind="loading-screen",
        filename=filename,
        content_type=content_type,
        data=data,
        allowed=_LOADING_EXTS,
    )
    raw = _read_raw()
    _remove_asset(raw.get("loading_screen_asset"))
    raw["loading_screen_asset"] = out_name
    _write_raw(raw)
    return admin_branding()


def clear_logo() -> dict[str, Any]:
    raw = _read_raw()
    _remove_asset(raw.get("logo_asset"))
    raw["logo_asset"] = None
    _write_raw(raw)
    return admin_branding()


def clear_loading_screen() -> dict[str, Any]:
    raw = _read_raw()
    _remove_asset(raw.get("loading_screen_asset"))
    raw["loading_screen_asset"] = None
    _write_raw(raw)
    return admin_branding()


def reset_all() -> dict[str, Any]:
    raw = _read_raw()
    _remove_asset(raw.get("logo_asset"))
    _remove_asset(raw.get("loading_screen_asset"))
    _write_raw(_default_settings())
    return admin_branding()


def resolve_asset(filename: str) -> tuple[Path, str] | None:
    if not _SAFE_NAME.match(filename):
        return None
    path = uploads_dir() / filename
    if not path.is_file():
        return None
    ext = path.suffix.lower()
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
    }.get(ext, "application/octet-stream")
    return path, media
