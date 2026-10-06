"""AI texture design studio — project-scoped design chats, generated previews, team sharing."""

from __future__ import annotations

import base64
import json
import re
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_CHATS = 40
MAX_MESSAGES = 80
MAX_IMAGE_BYTES = 12 * 1024 * 1024

MATERIAL_PRESETS = {
    "wood": "seamless wood grain material albedo map, natural fibers, tileable texture",
    "metal": "seamless brushed metal material albedo map, subtle anisotropy, tileable",
    "stone": "seamless stone / rock material albedo map, natural pores, tileable",
    "fabric": "seamless woven fabric material albedo map, soft fibers, tileable",
    "plastic": "seamless injection-molded plastic material albedo map, subtle surface noise, tileable",
    "concrete": "seamless concrete material albedo map, fine aggregate, tileable",
    "leather": "seamless leather material albedo map, soft creases, tileable",
    "ceramic": "seamless ceramic glaze material albedo map, subtle speckles, tileable",
    "custom": "",
}

STYLE_PRESETS = {
    "seamless": "perfectly seamless tileable, no borders, continuous edges",
    "photoreal": "photoreal PBR albedo / basecolor map, studio lighting neutral",
    "stylized": "stylized game-ready material look, clean readable detail",
    "macro": "extreme close-up macro detail, high frequency micro-structure",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_id(value: str, *, n: int = 24) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(value or ""))[:n] or uuid.uuid4().hex[:12]


def _root(project_path: Path) -> Path:
    root = Path(project_path) / "texture_design"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _chat_dir(project_path: Path, chat_id: str) -> Path:
    path = _root(project_path) / "chats" / _safe_id(chat_id, n=40)
    path.mkdir(parents=True, exist_ok=True)
    (path / "images").mkdir(parents=True, exist_ok=True)
    return path


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _index_path(project_path: Path) -> Path:
    return _root(project_path) / "chats.json"


def _load_index(project_path: Path) -> list[dict[str, Any]]:
    raw = _read_json(_index_path(project_path), [])
    return raw if isinstance(raw, list) else []


def _save_index(project_path: Path, items: list[dict[str, Any]]) -> None:
    _write_json(_index_path(project_path), items[:MAX_CHATS])


def build_prompt(
    *,
    user_prompt: str,
    material: str = "custom",
    style: str = "seamless",
    color: str = "",
    detail: str = "medium",
) -> str:
    bits = [
        "Create a high-quality seamless material texture map for 3D wrapping.",
        "Output should be a flat albedo / basecolor texture only (no 3D sphere, no UI, no text).",
        STYLE_PRESETS.get(style, STYLE_PRESETS["seamless"]),
    ]
    mat = MATERIAL_PRESETS.get(material, "")
    if mat:
        bits.append(mat)
    if color:
        bits.append(f"Dominant color / tint: {color}.")
    detail_map = {
        "low": "soft large-scale pattern, low micro-detail",
        "medium": "balanced mid-frequency detail",
        "high": "rich high-frequency micro-detail",
    }
    bits.append(detail_map.get(detail, detail_map["medium"]))
    user = (user_prompt or "").strip()
    if user:
        bits.append(f"Designer brief: {user}")
    return " ".join(bits)


def _neutral_png(size: int = 1024, rgb: tuple[int, int, int] = (168, 168, 168)) -> bytes:
    """Minimal uncompressed-ish PNG (solid fill) without Pillow."""
    import struct

    size = max(64, min(int(size or 1024), 2048))
    width = height = size
    r, g, b = rgb
    raw = b"".join(b"\x00" + bytes([r, g, b]) * width for _ in range(height))
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def create_chat(
    project_path: Path,
    *,
    user: dict[str, Any],
    title: str | None = None,
) -> dict[str, Any]:
    chat_id = uuid.uuid4().hex[:12]
    folder = _chat_dir(project_path, chat_id)
    meta = {
        "id": chat_id,
        "title": (title or "Texture design").strip()[:80] or "Texture design",
        "created_at": _now(),
        "updated_at": _now(),
        "created_by": user.get("id"),
        "created_by_name": user.get("display_name") or user.get("name") or user.get("email") or "User",
        "shared": False,
        "member_ids": [str(user.get("id"))] if user.get("id") else [],
        "message_count": 0,
    }
    _write_json(folder / "meta.json", meta)
    _write_json(folder / "messages.json", [])
    index = _load_index(project_path)
    index.insert(0, {k: meta[k] for k in ("id", "title", "updated_at", "shared", "created_by", "created_by_name", "message_count")})
    _save_index(project_path, index)
    return meta


def list_chats(project_path: Path, *, user_id: str) -> list[dict[str, Any]]:
    uid = str(user_id or "")
    out: list[dict[str, Any]] = []
    for item in _load_index(project_path):
        chat_id = item.get("id")
        if not chat_id:
            continue
        meta = get_chat_meta(project_path, chat_id)
        if not meta:
            continue
        members = [str(x) for x in (meta.get("member_ids") or [])]
        if meta.get("shared") or uid in members or str(meta.get("created_by")) == uid:
            out.append(meta)
    return out


def get_chat_meta(project_path: Path, chat_id: str) -> dict[str, Any] | None:
    folder = _root(project_path) / "chats" / _safe_id(chat_id, n=40)
    meta = _read_json(folder / "meta.json", None)
    return meta if isinstance(meta, dict) and meta.get("id") else None


def can_access_chat(meta: dict[str, Any] | None, user_id: str) -> bool:
    if not meta:
        return False
    uid = str(user_id or "")
    if str(meta.get("created_by")) == uid:
        return True
    if meta.get("shared"):
        return True
    return uid in {str(x) for x in (meta.get("member_ids") or [])}


def list_messages(project_path: Path, chat_id: str) -> list[dict[str, Any]]:
    folder = _chat_dir(project_path, chat_id)
    msgs = _read_json(folder / "messages.json", [])
    return msgs if isinstance(msgs, list) else []


def _touch_chat(project_path: Path, meta: dict[str, Any]) -> None:
    meta["updated_at"] = _now()
    folder = _chat_dir(project_path, meta["id"])
    _write_json(folder / "meta.json", meta)
    index = _load_index(project_path)
    brief = {
        "id": meta["id"],
        "title": meta.get("title"),
        "updated_at": meta.get("updated_at"),
        "shared": bool(meta.get("shared")),
        "created_by": meta.get("created_by"),
        "created_by_name": meta.get("created_by_name"),
        "message_count": meta.get("message_count") or 0,
    }
    index = [brief] + [x for x in index if x.get("id") != meta["id"]]
    _save_index(project_path, index)


def append_message(
    project_path: Path,
    chat_id: str,
    *,
    role: str,
    text: str,
    user: dict[str, Any] | None = None,
    image_bytes: bytes | None = None,
    design: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = get_chat_meta(project_path, chat_id)
    if not meta:
        raise ValueError("Chat not found")
    folder = _chat_dir(project_path, chat_id)
    msg_id = uuid.uuid4().hex[:12]
    image_name = None
    if image_bytes:
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise ValueError("Generated texture is too large")
        image_name = f"{msg_id}.png"
        (folder / "images" / image_name).write_bytes(image_bytes)
    message = {
        "id": msg_id,
        "role": role if role in ("user", "assistant", "system") else "assistant",
        "text": (text or "").strip()[:4000],
        "created_at": _now(),
        "user_id": (user or {}).get("id"),
        "user_name": (user or {}).get("display_name") or (user or {}).get("name") or (user or {}).get("email"),
        "image_name": image_name,
        "image_url": f"/api/projects/{{project_id}}/texture-design/chats/{chat_id}/images/{image_name}" if image_name else None,
        "design": design or None,
    }
    messages = list_messages(project_path, chat_id)
    messages.append(message)
    _write_json(folder / "messages.json", messages[-MAX_MESSAGES:])
    meta["message_count"] = len(messages[-MAX_MESSAGES:])
    if role == "user" and text and meta.get("title") in (None, "", "Texture design"):
        meta["title"] = text.strip()[:48]
    _touch_chat(project_path, meta)
    return message


def resolve_image(project_path: Path, chat_id: str, image_name: str) -> Path:
    safe_name = Path(str(image_name or "")).name
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.png", safe_name or ""):
        raise ValueError("Invalid image")
    path = _chat_dir(project_path, chat_id) / "images" / safe_name
    if not path.is_file():
        raise ValueError("Image not found")
    return path


def share_chat(
    project_path: Path,
    chat_id: str,
    *,
    requester_id: str,
    shared: bool = True,
    member_ids: list[str] | None = None,
) -> dict[str, Any]:
    meta = get_chat_meta(project_path, chat_id)
    if not meta:
        raise ValueError("Chat not found")
    if str(meta.get("created_by")) != str(requester_id):
        # Co-owners on shared chats can also update membership.
        if not (meta.get("shared") and str(requester_id) in {str(x) for x in (meta.get("member_ids") or [])}):
            raise PermissionError("Only chat members can update sharing")
    meta["shared"] = bool(shared)
    members = {str(meta.get("created_by"))} if meta.get("created_by") else set()
    if member_ids is not None:
        members.update(str(x) for x in member_ids if x)
    else:
        members.update(str(x) for x in (meta.get("member_ids") or []) if x)
    meta["member_ids"] = sorted(members)
    _touch_chat(project_path, meta)
    return meta


def decorate_message(project_id: str, message: dict[str, Any]) -> dict[str, Any]:
    out = dict(message)
    name = out.get("image_name")
    if name:
        out["image_url"] = f"/api/projects/{project_id}/texture-design/chats/{out.get('chat_id') or ''}/images/{name}".replace(
            "//images", "/images"
        )
        # Prefer explicit chat id from caller path — fixed below by endpoints.
    return out


def image_url(project_id: str, chat_id: str, image_name: str) -> str:
    return f"/api/projects/{project_id}/texture-design/chats/{chat_id}/images/{image_name}"


def make_neutral_base_png(size: int = 1024) -> bytes:
    return _neutral_png(size=size)


def prompt_for_generation(body: dict[str, Any]) -> str:
    return build_prompt(
        user_prompt=str(body.get("prompt") or ""),
        material=str(body.get("material") or "custom"),
        style=str(body.get("style") or "seamless"),
        color=str(body.get("color") or ""),
        detail=str(body.get("detail") or "medium"),
    )
