"""Project-local notes: gitignored multi-note store + legacy Sam's Notes import."""

from __future__ import annotations

import base64
import html
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

WORKSTATION_NAME = "Sam's Notes"
MAX_CHARS = 200_000
MAX_TITLE = 200
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_SAFE_USER = re.compile(r"[^A-Za-z0-9_-]+")
_NOTE_ID = re.compile(r"^n[a-z0-9]{8,32}$")
_IMAGE_ID = re.compile(r"^i[a-z0-9]{8,32}$")
_SECRET_RE = re.compile(
    r"(app secret|user token|app credentials|\bapp id\b|\bOC\|[0-9]{6,}|\bOCAQAG[0-9A-Za-z]+)",
    re.I,
)
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"(?is)<(script|style|iframe|object|embed|link|meta|form)[^>]*>.*?</\1>")
_VOID_BAD_RE = re.compile(r"(?is)<(script|style|iframe|object|embed|link|meta|form)[^>]*/?>")
_ONATTR_RE = re.compile(r"(?i)\son\w+\s*=\s*('[^']*'|\"[^\"]*\"|[^\s>]+)")
_JS_URL_RE = re.compile(r"(?i)javascript:")
_DATA_URL_RE = re.compile(
    r"^data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$",
    re.I,
)

IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


def workstation_path() -> Path:
    path = (ROOT_DIR / WORKSTATION_NAME).resolve()
    root = ROOT_DIR.resolve()
    if path != root / WORKSTATION_NAME:
        raise ValueError("invalid workstation notes path")
    return path


def user_notes_path(user_id: str) -> Path:
    safe = _SAFE_USER.sub("", str(user_id or "").strip()).strip("._-")[:80] or "anon"
    root = (Path(settings.data_dir) / "user_notes").resolve()
    path = (root / f"{safe}.json").resolve()
    if not str(path).startswith(str(root)):
        raise ValueError("invalid user notes path")
    return path


def _clip(text: str, limit: int = MAX_CHARS) -> str:
    return str(text or "")[:limit]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_note_id() -> str:
    return "n" + uuid.uuid4().hex[:16]


def _new_image_id() -> str:
    return "i" + uuid.uuid4().hex[:16]


def looks_like_secret(text: str) -> bool:
    return bool(_SECRET_RE.search(str(text or "")))


def sanitize_html(raw: str) -> str:
    html_text = _clip(str(raw or ""))
    html_text = _SCRIPT_RE.sub("", html_text)
    html_text = _VOID_BAD_RE.sub("", html_text)
    html_text = _ONATTR_RE.sub("", html_text)
    html_text = _JS_URL_RE.sub("", html_text)
    return html_text


def plaintext_to_html(text: str) -> str:
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    parts: list[str] = []
    for line in lines:
        if line.startswith("# "):
            parts.append(f"<h1>{html.escape(line[2:])}</h1>")
        elif line.startswith("## "):
            parts.append(f"<h2>{html.escape(line[3:])}</h2>")
        elif line.startswith("### "):
            parts.append(f"<h3>{html.escape(line[4:])}</h3>")
        elif line.startswith("- "):
            parts.append(f"<ul><li>{html.escape(line[2:])}</li></ul>")
        elif not line.strip():
            parts.append("<p></p>")
        else:
            parts.append(f"<p>{html.escape(line)}</p>")
    return "\n".join(parts) or "<p></p>"


def html_to_plain(raw: str) -> str:
    text = str(raw or "")
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|h1|h2|h3|li|tr)>", "\n", text)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def detect_image(data: bytes) -> tuple[str, str] | None:
    if not data:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8"):
        return "jpg", "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "gif", "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def parse_data_url_image(data_url: str) -> bytes:
    match = _DATA_URL_RE.match(str(data_url or "").strip())
    if not match:
        raise ValueError("Paste a PNG, JPEG, GIF, or WebP image.")
    try:
        blob = base64.b64decode(match.group(2), validate=False)
    except Exception as exc:
        raise ValueError("Invalid image data.") from exc
    if not detect_image(blob):
        raise ValueError("Paste a PNG, JPEG, GIF, or WebP image.")
    return blob


def _store_root(kind: str, user_id: str = "") -> Path:
    base = (Path(settings.data_dir) / "studio_notes").resolve()
    if kind == "workstation":
        path = (base / "workstation").resolve()
    else:
        safe = _SAFE_USER.sub("", str(user_id or "").strip()).strip("._-")[:80] or "anon"
        path = (base / "users" / safe).resolve()
    if not str(path).startswith(str(base)):
        raise ValueError("invalid notes store path")
    return path


def _index_path(kind: str, user_id: str = "") -> Path:
    return _store_root(kind, user_id) / "index.json"


def _note_file(kind: str, note_id: str, user_id: str = "") -> Path:
    if not _NOTE_ID.match(note_id):
        raise ValueError("invalid note id")
    root = _store_root(kind, user_id)
    path = (root / "notes" / f"{note_id}.json").resolve()
    if not str(path).startswith(str(root)):
        raise ValueError("invalid note path")
    return path


def _image_dir(kind: str, user_id: str = "") -> Path:
    return _store_root(kind, user_id) / "images"


def _empty_index() -> dict[str, Any]:
    return {"version": 2, "migrated": False, "notes": []}


def _load_index(kind: str, user_id: str = "") -> dict[str, Any]:
    path = _index_path(kind, user_id)
    if not path.is_file():
        return _empty_index()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _empty_index()
    if not isinstance(data, dict):
        return _empty_index()
    notes = data.get("notes")
    if not isinstance(notes, list):
        data["notes"] = []
    data.setdefault("version", 2)
    data.setdefault("migrated", False)
    return data


def _save_index(kind: str, payload: dict[str, Any], user_id: str = "") -> None:
    path = _index_path(kind, user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_note_file(kind: str, note_id: str, user_id: str = "") -> dict[str, Any] | None:
    path = _note_file(kind, note_id, user_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_note_file(kind: str, note: dict[str, Any], user_id: str = "") -> None:
    path = _note_file(kind, str(note.get("id") or ""), user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(note, ensure_ascii=False, indent=2), encoding="utf-8")


def _summary(note: dict[str, Any]) -> dict[str, Any]:
    plain = html_to_plain(str(note.get("html") or ""))
    title = str(note.get("title") or "").strip() or "Untitled"
    secret = looks_like_secret(f"{title}\n{plain}")
    if secret:
        safe_lines = [ln.strip() for ln in plain.splitlines() if ln.strip() and not looks_like_secret(ln)]
        preview = " ".join(safe_lines)[:80] or "Note (may contain credentials)"
    else:
        preview = " ".join(plain.split())[:80]
    return {
        "id": note.get("id"),
        "title": title[:MAX_TITLE],
        "updated_at": note.get("updated_at"),
        "created_at": note.get("created_at"),
        "preview": preview,
        "may_contain_secrets": secret,
    }


def _public_note(note: dict[str, Any]) -> dict[str, Any]:
    summary = _summary(note)
    summary["html"] = sanitize_html(str(note.get("html") or ""))
    return summary


def _legacy_user_text(user_id: str) -> str:
    path = user_notes_path(user_id)
    if not path.is_file():
        return ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _clip(str(data.get("text") or ""))
    except json.JSONDecodeError:
        return _clip(path.read_text(encoding="utf-8", errors="replace"))


def _create_note_record(title: str, html_body: str) -> dict[str, Any]:
    now = _now()
    return {
        "id": _new_note_id(),
        "title": _clip(title, MAX_TITLE).strip() or "Untitled",
        "html": sanitize_html(html_body),
        "created_at": now,
        "updated_at": now,
    }


def _append_index(kind: str, note: dict[str, Any], user_id: str = "", migrated: bool | None = None) -> None:
    index = _load_index(kind, user_id)
    index["notes"] = [row for row in index.get("notes") or [] if isinstance(row, dict) and row.get("id") != note["id"]]
    index["notes"].insert(0, {
        "id": note["id"],
        "title": note["title"],
        "updated_at": note["updated_at"],
        "created_at": note["created_at"],
    })
    if migrated is not None:
        index["migrated"] = migrated
    _save_index(kind, index, user_id)


def ensure_store(kind: str, user_id: str = "") -> dict[str, Any]:
    index = _load_index(kind, user_id)
    if index.get("migrated"):
        return index
    if kind == "workstation":
        path = workstation_path()
        if path.is_file():
            raw = _clip(path.read_text(encoding="utf-8", errors="replace"))
            if raw.strip():
                note = _create_note_record("Sam's Notes", plaintext_to_html(raw))
                _write_note_file(kind, note, user_id)
                _append_index(kind, note, user_id, migrated=True)
                return _load_index(kind, user_id)
        index["migrated"] = True
        _save_index(kind, index, user_id)
        return index
    legacy = _legacy_user_text(user_id)
    if legacy.strip():
        note = _create_note_record("Your notes", plaintext_to_html(legacy))
        _write_note_file("user", note, user_id)
        _append_index("user", note, user_id, migrated=True)
        return _load_index("user", user_id)
    index["migrated"] = True
    _save_index(kind, index, user_id)
    return index


def list_notes(kind: str, user_id: str = "") -> dict[str, Any]:
    ensure_store(kind, user_id)
    index = _load_index(kind, user_id)
    notes: list[dict[str, Any]] = []
    for row in index.get("notes") or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        full = _read_note_file(kind, str(row["id"]), user_id)
        if full:
            notes.append(_summary(full))
        else:
            notes.append({
                "id": row.get("id"),
                "title": str(row.get("title") or "Untitled")[:MAX_TITLE],
                "updated_at": row.get("updated_at"),
                "created_at": row.get("created_at"),
                "preview": "",
                "may_contain_secrets": False,
            })
    return {
        "notes": notes,
        "kind": kind,
        "source": "file" if kind == "workstation" else "user",
        "path": WORKSTATION_NAME if kind == "workstation" else None,
    }


def get_note(kind: str, note_id: str, user_id: str = "") -> dict[str, Any] | None:
    ensure_store(kind, user_id)
    note = _read_note_file(kind, note_id, user_id)
    if not note:
        return None
    payload = _public_note(note)
    payload["kind"] = kind
    if kind == "workstation":
        payload["path"] = WORKSTATION_NAME
        payload["source"] = "file"
    else:
        payload["source"] = "user"
    return payload


def create_note(kind: str, user_id: str = "", title: str = "", html_body: str = "", text: str | None = None) -> dict[str, Any]:
    ensure_store(kind, user_id)
    body = html_body
    if text and not str(html_body or "").strip():
        body = plaintext_to_html(text)
    note = _create_note_record(title or "Untitled", body)
    _write_note_file(kind, note, user_id)
    _append_index(kind, note, user_id)
    found = get_note(kind, note["id"], user_id)
    if not found:
        raise RuntimeError("failed to create note")
    return found


def update_note(
    kind: str,
    note_id: str,
    user_id: str = "",
    title: str | None = None,
    html_body: str | None = None,
    text: str | None = None,
) -> dict[str, Any] | None:
    ensure_store(kind, user_id)
    note = _read_note_file(kind, note_id, user_id)
    if not note:
        return None
    if title is not None:
        note["title"] = _clip(title, MAX_TITLE).strip() or "Untitled"
    if html_body is not None:
        note["html"] = sanitize_html(html_body)
    elif text is not None:
        note["html"] = sanitize_html(plaintext_to_html(text))
    note["updated_at"] = _now()
    _write_note_file(kind, note, user_id)
    _append_index(kind, note, user_id)
    return get_note(kind, note_id, user_id)


def delete_note(kind: str, note_id: str, user_id: str = "") -> bool:
    ensure_store(kind, user_id)
    path = _note_file(kind, note_id, user_id)
    if not path.is_file():
        return False
    path.unlink()
    index = _load_index(kind, user_id)
    index["notes"] = [row for row in index.get("notes") or [] if isinstance(row, dict) and row.get("id") != note_id]
    _save_index(kind, index, user_id)
    return True


def save_image(kind: str, data: bytes, user_id: str = "") -> dict[str, Any]:
    if not data:
        raise ValueError("Uploaded image is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Images must be under 8 MB.")
    detected = detect_image(data)
    if not detected:
        raise ValueError("Upload a PNG, JPEG, GIF, or WebP image.")
    ext, media = detected
    ensure_store(kind, user_id)
    image_id = _new_image_id()
    folder = _image_dir(kind, user_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = (folder / f"{image_id}.{ext}").resolve()
    if not str(path).startswith(str(folder)):
        raise ValueError("invalid image path")
    path.write_bytes(data)
    rel = f"/api/notes/workstation/images/{image_id}" if kind == "workstation" else f"/api/users/me/notes/images/{image_id}"
    return {"id": image_id, "media_type": media, "url": rel, "ext": ext}


def get_image(kind: str, image_id: str, user_id: str = "") -> tuple[Path, str] | None:
    if not _IMAGE_ID.match(image_id):
        return None
    folder = _image_dir(kind, user_id)
    if not folder.is_dir():
        return None
    for ext, media in IMAGE_TYPES.items():
        path = (folder / f"{image_id}.{ext}").resolve()
        if str(path).startswith(str(folder)) and path.is_file():
            return path, media
    return None


def read_workstation() -> dict[str, Any]:
    listing = list_notes("workstation")
    first = (listing.get("notes") or [None])[0]
    note = get_note("workstation", str(first["id"])) if first else None
    exists = workstation_path().is_file() or bool(listing.get("notes"))
    return {
        "text": html_to_plain(note.get("html") or "") if note else "",
        "html": note.get("html") if note else "",
        "notes": listing.get("notes") or [],
        "active_id": note.get("id") if note else None,
        "source": "file",
        "path": WORKSTATION_NAME,
        "exists": exists,
        "may_contain_secrets": bool(note and note.get("may_contain_secrets")),
    }


def write_workstation(text: str) -> dict[str, Any]:
    listing = list_notes("workstation")
    html_body = plaintext_to_html(text)
    if listing.get("notes"):
        update_note("workstation", str(listing["notes"][0]["id"]), html_body=html_body, text=None)
    else:
        create_note("workstation", title="Sam's Notes", html_body=html_body)
    return read_workstation()


def read_user_notes(user_id: str) -> dict[str, Any]:
    listing = list_notes("user", user_id)
    first = (listing.get("notes") or [None])[0]
    note = get_note("user", str(first["id"]), user_id) if first else None
    return {
        "text": html_to_plain(note.get("html") or "") if note else "",
        "html": note.get("html") if note else "",
        "notes": listing.get("notes") or [],
        "active_id": note.get("id") if note else None,
        "source": "user",
        "exists": bool(note),
        "updated_at": note.get("updated_at") if note else None,
        "may_contain_secrets": bool(note and note.get("may_contain_secrets")),
    }


def write_user_notes(user_id: str, text: str) -> dict[str, Any]:
    listing = list_notes("user", user_id)
    html_body = plaintext_to_html(text)
    if listing.get("notes"):
        update_note("user", str(listing["notes"][0]["id"]), user_id, html_body=html_body)
    else:
        create_note("user", user_id=user_id, title="Your notes", html_body=html_body)
    # Keep a plaintext sidecar for anything still reading the v1 path.
    path = user_notes_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"text": _clip(text), "updated_at": _now()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return read_user_notes(user_id)
