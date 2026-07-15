"""User knowledge bases: folders of docs/CAD/drawings injected into AI prompts."""

from __future__ import annotations

import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn

TEXT_SUFFIXES = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".log",
    ".xml", ".html", ".htm", ".css", ".js", ".ts", ".py", ".dxf", ".svg",
}
CAD_SUFFIXES = {
    ".step", ".stp", ".stl", ".3mf", ".glb", ".gltf", ".obj", ".ply", ".off",
    ".iges", ".igs", ".brep", ".brp",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
DOC_SUFFIXES = {".pdf"}
ALLOWED_SUFFIXES = TEXT_SUFFIXES | CAD_SUFFIXES | IMAGE_SUFFIXES | DOC_SUFFIXES | {".f3z"}

MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_TEXT_EXTRACT = 80_000
MAX_PROMPT_CHARS = 12_000
MAX_ITEM_EXCERPT = 3_500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _kb_root(user_id: str, kb_id: str) -> Path:
    root = Path(settings.data_dir) / "knowledge" / str(user_id) / str(kb_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_name(name: str) -> str:
    base = Path(str(name or "file")).name.strip() or "file"
    base = re.sub(r"[^\w.\- ()[\]]+", "_", base)
    return base[:180] or "file"


def init_knowledge_tables() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS knowledge_bases (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_folders (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES knowledge_folders(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_items (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                folder_id TEXT,
                name TEXT NOT NULL,
                media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                storage_path TEXT NOT NULL,
                text_excerpt TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                FOREIGN KEY (folder_id) REFERENCES knowledge_folders(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_skill_links (
                kb_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (kb_id, skill_id),
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS knowledge_shares (
                id TEXT PRIMARY KEY,
                kb_id TEXT NOT NULL,
                share_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(kb_id, share_type, target_id),
                FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user ON knowledge_bases(user_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_folders_kb ON knowledge_folders(kb_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_items_kb ON knowledge_items(kb_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_skill_kb ON knowledge_skill_links(skill_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_shares_kb ON knowledge_shares(kb_id);
            CREATE INDEX IF NOT EXISTS idx_knowledge_shares_target ON knowledge_shares(share_type, target_id);
            """
        )


def _file_category(name: str) -> str:
    suffix = Path(str(name or "")).suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return "text"
    if suffix in CAD_SUFFIXES or suffix == ".f3z":
        return "cad"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    if suffix in DOC_SUFFIXES:
        return "pdf"
    return "other"


def _compute_items_stats(rows: list[Any]) -> dict[str, Any]:
    by_ext: dict[str, dict[str, int]] = {}
    by_category = {"text": 0, "cad": 0, "image": 0, "pdf": 0, "other": 0}
    total_bytes = 0
    text_ready = 0
    excerpt_chars = 0
    largest = None
    for row in rows:
        name = row["name"] if not isinstance(row, dict) else row.get("name")
        size = int((row["size_bytes"] if not isinstance(row, dict) else row.get("size_bytes")) or 0)
        excerpt = (row["text_excerpt"] if not isinstance(row, dict) else row.get("text_excerpt")) or ""
        total_bytes += size
        if str(excerpt).strip():
            text_ready += 1
            excerpt_chars += len(str(excerpt))
        ext = Path(str(name or "")).suffix.lower() or "(none)"
        bucket = by_ext.setdefault(ext, {"count": 0, "bytes": 0})
        bucket["count"] += 1
        bucket["bytes"] += size
        cat = _file_category(str(name or ""))
        by_category[cat] = int(by_category.get(cat) or 0) + 1
        if largest is None or size > int(largest.get("size_bytes") or 0):
            largest = {"name": name, "size_bytes": size, "category": cat}
    formats = [
        {"ext": ext, "count": data["count"], "bytes": data["bytes"]}
        for ext, data in sorted(by_ext.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
    ]
    return {
        "item_count": len(rows),
        "total_bytes": total_bytes,
        "avg_bytes": int(total_bytes / len(rows)) if rows else 0,
        "text_ready_count": text_ready,
        "text_ready_rate": round(text_ready / len(rows), 4) if rows else None,
        "excerpt_chars": excerpt_chars,
        "by_category": by_category,
        "by_format": formats[:16],
        "largest_file": largest,
    }


def knowledge_base_stats(user_id: str, kb_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        owned = conn.execute(
            "SELECT id FROM knowledge_bases WHERE id = ? AND user_id = ?",
            (kb_id, user_id),
        ).fetchone()
        if not owned:
            raise LookupError("Knowledge base not found")
        folder_count = conn.execute(
            "SELECT COUNT(*) AS n FROM knowledge_folders WHERE kb_id = ?",
            (kb_id,),
        ).fetchone()["n"]
        rows = conn.execute(
            """
            SELECT name, size_bytes, text_excerpt, media_type, created_at
              FROM knowledge_items
             WHERE kb_id = ?
            """,
            (kb_id,),
        ).fetchall()
        skills = conn.execute(
            "SELECT skill_id FROM knowledge_skill_links WHERE kb_id = ? ORDER BY skill_id",
            (kb_id,),
        ).fetchall()
    stats = _compute_items_stats(rows)
    stats["folder_count"] = int(folder_count or 0)
    stats["skill_ids"] = [r["skill_id"] for r in skills]
    stats["skill_count"] = len(stats["skill_ids"])
    return stats


def user_knowledge_stats(user_id: str) -> dict[str, Any]:
    bases = list_knowledge_bases(user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT i.name, i.size_bytes, i.text_excerpt, i.media_type, i.kb_id
              FROM knowledge_items i
              JOIN knowledge_bases k ON k.id = i.kb_id
             WHERE k.user_id = ?
            """,
            (user_id,),
        ).fetchall()
        folder_count = conn.execute(
            """
            SELECT COUNT(*) AS n
              FROM knowledge_folders f
              JOIN knowledge_bases k ON k.id = f.kb_id
             WHERE k.user_id = ?
            """,
            (user_id,),
        ).fetchone()["n"]
        skill_links = conn.execute(
            """
            SELECT COUNT(*) AS n
              FROM knowledge_skill_links l
              JOIN knowledge_bases k ON k.id = l.kb_id
             WHERE k.user_id = ?
            """,
            (user_id,),
        ).fetchone()["n"]
    stats = _compute_items_stats(rows)
    stats["knowledge_base_count"] = len(bases)
    stats["folder_count"] = int(folder_count or 0)
    stats["skill_link_count"] = int(skill_links or 0)
    return stats


def _row_kb(row: Any, *, include_counts: bool = True, access: str = "owner") -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": row["id"],
        "user_id": row["user_id"],
        "name": row["name"],
        "description": row["description"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "access": access,
        "shared_with_me": access == "shared",
    }
    if include_counts:
        stats = knowledge_base_stats(row["user_id"], row["id"])
        item["folder_count"] = stats["folder_count"]
        item["item_count"] = stats["item_count"]
        item["total_bytes"] = stats["total_bytes"]
        item["text_ready_count"] = stats["text_ready_count"]
        item["by_category"] = stats["by_category"]
        item["skill_ids"] = stats["skill_ids"]
        item["stats"] = stats
    return item


def list_shared_kb_ids(user_id: str) -> set[str]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT s.kb_id
              FROM knowledge_shares s
             WHERE (s.share_type = 'user' AND s.target_id = ?)
                OR (
                      s.share_type = 'team'
                  AND EXISTS (
                        SELECT 1 FROM team_members tm
                         WHERE tm.team_id = s.target_id AND tm.user_id = ?
                  )
                )
                OR (
                      s.share_type = 'project'
                  AND EXISTS (
                        SELECT 1
                          FROM project_access pa
                          JOIN team_members tm ON tm.team_id = pa.team_id
                         WHERE pa.project_id = s.target_id AND tm.user_id = ?
                  )
                )
            """,
            (user_id, user_id, user_id),
        ).fetchall()
    return {r["kb_id"] for r in rows}


def user_can_access_kb(user_id: str, kb_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT user_id FROM knowledge_bases WHERE id = ?", (kb_id,)).fetchone()
    if not row:
        return False
    if row["user_id"] == user_id:
        return True
    return kb_id in list_shared_kb_ids(user_id)


def _share_routes_for_user(conn: Any, kb_id: str, user_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT share_type, target_id, shared_by, created_at
          FROM knowledge_shares
         WHERE kb_id = ?
        """,
        (kb_id,),
    ).fetchall()
    routes: list[dict[str, Any]] = []
    for row in rows:
        stype = row["share_type"]
        tid = row["target_id"]
        keep = False
        label = tid
        if stype == "user" and tid == user_id:
            keep = True
            label = "Direct share"
        elif stype == "team":
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
                (tid, user_id),
            ).fetchone()
            if member:
                keep = True
                team = conn.execute("SELECT name FROM teams WHERE id = ?", (tid,)).fetchone()
                label = (team["name"] if team else None) or "Workspace"
        elif stype == "project":
            access = conn.execute(
                """
                SELECT 1
                  FROM project_access pa
                  JOIN team_members tm ON tm.team_id = pa.team_id
                 WHERE pa.project_id = ? AND tm.user_id = ?
                """,
                (tid, user_id),
            ).fetchone()
            if access:
                keep = True
                label = f"Project {tid}"
        if keep:
            routes.append(
                {
                    "share_type": stype,
                    "target_id": tid,
                    "label": label,
                    "shared_by": row["shared_by"],
                    "created_at": row["created_at"],
                }
            )
    return routes


def list_knowledge_bases(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM knowledge_bases
             WHERE user_id = ?
             ORDER BY updated_at DESC, name COLLATE NOCASE
            """,
            (user_id,),
        ).fetchall()
    return [_row_kb(row, access="owner") for row in rows]


def list_shared_knowledge_bases(user_id: str) -> list[dict[str, Any]]:
    shared_ids = list_shared_kb_ids(user_id)
    if not shared_ids:
        return []
    out: list[dict[str, Any]] = []
    with get_conn() as conn:
        for kb_id in shared_ids:
            row = conn.execute("SELECT * FROM knowledge_bases WHERE id = ?", (kb_id,)).fetchone()
            if not row or row["user_id"] == user_id:
                continue
            item = _row_kb(row, access="shared")
            owner = conn.execute(
                "SELECT id, display_name, email FROM users WHERE id = ?",
                (row["user_id"],),
            ).fetchone()
            item["owner"] = {
                "id": owner["id"] if owner else row["user_id"],
                "display_name": (owner["display_name"] if owner else None) or "Owner",
                "email": (owner["email"] if owner else "") or "",
            }
            item["shared_via"] = _share_routes_for_user(conn, kb_id, user_id)
            out.append(item)
    out.sort(key=lambda kb: (kb.get("name") or "").lower())
    return out


def create_knowledge_base(user_id: str, name: str, description: str = "") -> dict[str, Any]:
    kb_id = str(uuid.uuid4())[:12]
    now = _now()
    clean_name = (name or "").strip() or "Knowledge base"
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO knowledge_bases (id, user_id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (kb_id, user_id, clean_name[:120], (description or "").strip()[:2000], now, now),
        )
    _kb_root(user_id, kb_id)
    return get_knowledge_base(user_id, kb_id, require_owner=True)


def get_knowledge_base(user_id: str, kb_id: str, *, require_owner: bool = False) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM knowledge_bases WHERE id = ?", (kb_id,)).fetchone()
    if not row:
        raise LookupError("Knowledge base not found")
    is_owner = row["user_id"] == user_id
    if require_owner and not is_owner:
        raise PermissionError("Only the owner can modify this knowledge base")
    if not is_owner and not user_can_access_kb(user_id, kb_id):
        raise LookupError("Knowledge base not found")
    item = _row_kb(row, access="owner" if is_owner else "shared")
    if not is_owner:
        with get_conn() as conn:
            owner = conn.execute(
                "SELECT id, display_name, email FROM users WHERE id = ?",
                (row["user_id"],),
            ).fetchone()
            item["owner"] = {
                "id": owner["id"] if owner else row["user_id"],
                "display_name": (owner["display_name"] if owner else None) or "Owner",
                "email": (owner["email"] if owner else "") or "",
            }
            item["shared_via"] = _share_routes_for_user(conn, kb_id, user_id)
    return item


def update_knowledge_base(
    user_id: str,
    kb_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    skill_ids: list[str] | None = None,
) -> dict[str, Any]:
    kb = get_knowledge_base(user_id, kb_id, require_owner=True)
    now = _now()
    with get_conn() as conn:
        if name is not None:
            conn.execute(
                "UPDATE knowledge_bases SET name = ?, updated_at = ? WHERE id = ?",
                ((name or "").strip()[:120] or kb["name"], now, kb_id),
            )
        if description is not None:
            conn.execute(
                "UPDATE knowledge_bases SET description = ?, updated_at = ? WHERE id = ?",
                ((description or "").strip()[:2000], now, kb_id),
            )
        if skill_ids is not None:
            conn.execute("DELETE FROM knowledge_skill_links WHERE kb_id = ?", (kb_id,))
            for raw in skill_ids:
                skill_id = str(raw or "").strip().lower()
                if not skill_id:
                    continue
                conn.execute(
                    """
                    INSERT OR IGNORE INTO knowledge_skill_links (kb_id, skill_id, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (kb_id, skill_id[:64], now),
                )
            conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now, kb_id))
    return get_knowledge_base(user_id, kb_id, require_owner=True)


def delete_knowledge_base(user_id: str, kb_id: str) -> None:
    kb = get_knowledge_base(user_id, kb_id, require_owner=True)
    owner_id = kb["user_id"]
    with get_conn() as conn:
        conn.execute("DELETE FROM knowledge_bases WHERE id = ? AND user_id = ?", (kb_id, owner_id))
    root = Path(settings.data_dir) / "knowledge" / str(owner_id) / str(kb_id)
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)


def list_folders(user_id: str, kb_id: str) -> list[dict[str, Any]]:
    get_knowledge_base(user_id, kb_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM knowledge_folders
             WHERE kb_id = ?
             ORDER BY sort_order, name COLLATE NOCASE
            """,
            (kb_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "kb_id": row["kb_id"],
            "parent_id": row["parent_id"],
            "name": row["name"],
            "sort_order": row["sort_order"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def create_folder(user_id: str, kb_id: str, name: str, parent_id: str | None = None) -> dict[str, Any]:
    get_knowledge_base(user_id, kb_id, require_owner=True)
    folder_id = str(uuid.uuid4())[:12]
    now = _now()
    clean = (name or "").strip()[:120] or "Folder"
    with get_conn() as conn:
        if parent_id:
            parent = conn.execute(
                "SELECT id FROM knowledge_folders WHERE id = ? AND kb_id = ?",
                (parent_id, kb_id),
            ).fetchone()
            if not parent:
                raise ValueError("Parent folder not found")
        conn.execute(
            """
            INSERT INTO knowledge_folders (id, kb_id, parent_id, name, sort_order, created_at)
            VALUES (?, ?, ?, ?, 0, ?)
            """,
            (folder_id, kb_id, parent_id, clean, now),
        )
        conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now, kb_id))
    return {
        "id": folder_id,
        "kb_id": kb_id,
        "parent_id": parent_id,
        "name": clean,
        "sort_order": 0,
        "created_at": now,
    }


def ensure_folder_path(user_id: str, kb_id: str, relative_dir: str) -> str | None:
    """Create nested folders from a relative path like 'specs/motors' and return leaf folder id."""
    parts = [p for p in Path(str(relative_dir or "")).parts if p not in {"", ".", ".."}]
    if not parts:
        return None
    current: str | None = None
    existing = {(f["parent_id"] or "", f["name"].lower()): f for f in list_folders(user_id, kb_id)}
    for part in parts:
        key = (current or "", part.lower())
        found = existing.get(key)
        if found:
            current = found["id"]
            continue
        created = create_folder(user_id, kb_id, part, parent_id=current)
        existing[(current or "", part.lower())] = created
        current = created["id"]
    return current


def list_items(user_id: str, kb_id: str, folder_id: str | None = None) -> list[dict[str, Any]]:
    get_knowledge_base(user_id, kb_id)
    with get_conn() as conn:
        if folder_id:
            rows = conn.execute(
                """
                SELECT * FROM knowledge_items
                 WHERE kb_id = ? AND folder_id = ?
                 ORDER BY name COLLATE NOCASE
                """,
                (kb_id, folder_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM knowledge_items
                 WHERE kb_id = ?
                 ORDER BY created_at DESC, name COLLATE NOCASE
                """,
                (kb_id,),
            ).fetchall()
    return [_row_item(row) for row in rows]


def _row_item(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kb_id": row["kb_id"],
        "folder_id": row["folder_id"],
        "name": row["name"],
        "media_type": row["media_type"],
        "size_bytes": row["size_bytes"],
        "text_excerpt": (row["text_excerpt"] or "")[:400],
        "has_text": bool((row["text_excerpt"] or "").strip()),
        "created_at": row["created_at"],
    }


def _extract_text(path: Path, suffix: str) -> str:
    if suffix in TEXT_SUFFIXES:
        try:
            return path.read_text(encoding="utf-8", errors="ignore")[:MAX_TEXT_EXTRACT]
        except Exception:
            return ""
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore

            reader = PdfReader(str(path))
            chunks: list[str] = []
            for page in reader.pages[:40]:
                chunks.append(page.extract_text() or "")
                if sum(len(c) for c in chunks) > MAX_TEXT_EXTRACT:
                    break
            return "\n".join(chunks)[:MAX_TEXT_EXTRACT]
        except Exception:
            try:
                import PyPDF2  # type: ignore

                reader = PyPDF2.PdfReader(str(path))
                chunks = []
                for page in reader.pages[:40]:
                    chunks.append(page.extract_text() or "")
                return "\n".join(chunks)[:MAX_TEXT_EXTRACT]
            except Exception:
                return f"[PDF file: {path.name} — text extraction unavailable]"
    if suffix in CAD_SUFFIXES:
        return (
            f"[CAD/model file: {path.name}]\n"
            f"Use this as a geometry/knowledge reference for dimensions, mounting, and fit."
        )
    if suffix in IMAGE_SUFFIXES:
        return f"[Image reference: {path.name}]"
    return f"[File: {path.name}]"


def add_item_bytes(
    user_id: str,
    kb_id: str,
    *,
    filename: str,
    data: bytes,
    media_type: str = "application/octet-stream",
    folder_id: str | None = None,
    relative_path: str | None = None,
) -> dict[str, Any]:
    kb = get_knowledge_base(user_id, kb_id, require_owner=True)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    safe = _safe_name(filename)
    suffix = Path(safe).suffix.lower()
    if suffix and suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {suffix}")

    resolved_folder = folder_id
    if relative_path:
        parent = str(Path(relative_path).parent).replace("\\", "/")
        if parent not in {"", "."}:
            resolved_folder = ensure_folder_path(user_id, kb_id, parent)

    item_id = str(uuid.uuid4())[:12]
    store_name = f"{item_id}__{safe}"
    dest = _kb_root(kb["user_id"], kb_id) / store_name
    dest.write_bytes(data)
    excerpt = _extract_text(dest, suffix)
    now = _now()
    with get_conn() as conn:
        if resolved_folder:
            folder = conn.execute(
                "SELECT id FROM knowledge_folders WHERE id = ? AND kb_id = ?",
                (resolved_folder, kb_id),
            ).fetchone()
            if not folder:
                resolved_folder = None
        conn.execute(
            """
            INSERT INTO knowledge_items
              (id, kb_id, folder_id, name, media_type, storage_path, text_excerpt, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                kb_id,
                resolved_folder,
                safe,
                (media_type or "application/octet-stream")[:120],
                store_name,
                excerpt[:MAX_TEXT_EXTRACT],
                len(data),
                now,
            ),
        )
        conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (now, kb_id))
    return get_item(user_id, kb_id, item_id)


def get_item(user_id: str, kb_id: str, item_id: str) -> dict[str, Any]:
    get_knowledge_base(user_id, kb_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_items WHERE id = ? AND kb_id = ?",
            (item_id, kb_id),
        ).fetchone()
    if not row:
        raise LookupError("Knowledge item not found")
    return _row_item(row)


def delete_item(user_id: str, kb_id: str, item_id: str) -> None:
    kb = get_knowledge_base(user_id, kb_id, require_owner=True)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM knowledge_items WHERE id = ? AND kb_id = ?",
            (item_id, kb_id),
        ).fetchone()
        if not row:
            raise LookupError("Knowledge item not found")
        conn.execute("DELETE FROM knowledge_items WHERE id = ? AND kb_id = ?", (item_id, kb_id))
        conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (_now(), kb_id))
    path = _kb_root(kb["user_id"], kb_id) / row["storage_path"]
    if path.is_file():
        path.unlink(missing_ok=True)


def get_kb_tree(user_id: str, kb_id: str) -> dict[str, Any]:
    kb = get_knowledge_base(user_id, kb_id)
    folders = list_folders(user_id, kb_id)
    items = list_items(user_id, kb_id)
    return {
        "knowledge_base": kb,
        "folders": folders,
        "items": items,
        "stats": kb.get("stats") or knowledge_base_stats(kb["user_id"], kb_id),
        "can_edit": kb.get("access") == "owner",
    }


def resolve_kb_ids_for_prompt(
    user_id: str,
    *,
    knowledge_base_ids: list[str] | None = None,
    skill_ids: list[str] | None = None,
) -> list[str]:
    selected = [str(x).strip() for x in (knowledge_base_ids or []) if str(x).strip()]
    out: list[str] = []
    seen: set[str] = set()
    owned = {kb["id"] for kb in list_knowledge_bases(user_id)}
    shared = list_shared_kb_ids(user_id)
    allowed = owned | shared
    for kb_id in selected:
        if kb_id in allowed and kb_id not in seen:
            out.append(kb_id)
            seen.add(kb_id)
    skill_set = {str(s).strip().lower() for s in (skill_ids or []) if str(s).strip()}
    if skill_set:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT l.kb_id
                  FROM knowledge_skill_links l
                  JOIN knowledge_bases k ON k.id = l.kb_id
                 WHERE k.user_id = ?
                    OR l.kb_id IN (
                        SELECT s.kb_id FROM knowledge_shares s
                         WHERE (s.share_type = 'user' AND s.target_id = ?)
                            OR (
                                  s.share_type = 'team'
                              AND EXISTS (
                                    SELECT 1 FROM team_members tm
                                     WHERE tm.team_id = s.target_id AND tm.user_id = ?
                              )
                            )
                            OR (
                                  s.share_type = 'project'
                              AND EXISTS (
                                    SELECT 1
                                      FROM project_access pa
                                      JOIN team_members tm ON tm.team_id = pa.team_id
                                     WHERE pa.project_id = s.target_id AND tm.user_id = ?
                              )
                            )
                    )
                """,
                (user_id, user_id, user_id, user_id),
            ).fetchall()
            for row in rows:
                linked = conn.execute(
                    "SELECT skill_id FROM knowledge_skill_links WHERE kb_id = ?",
                    (row["kb_id"],),
                ).fetchall()
                if any(r["skill_id"] in skill_set for r in linked) and row["kb_id"] not in seen:
                    if row["kb_id"] in allowed or row["kb_id"] in owned:
                        out.append(row["kb_id"])
                        seen.add(row["kb_id"])
    return out


def list_knowledge_shares(user_id: str, kb_id: str) -> list[dict[str, Any]]:
    get_knowledge_base(user_id, kb_id, require_owner=True)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, kb_id, share_type, target_id, shared_by, created_at
              FROM knowledge_shares
             WHERE kb_id = ?
             ORDER BY created_at DESC
            """,
            (kb_id,),
        ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            label = row["target_id"]
            if row["share_type"] == "user":
                user = conn.execute(
                    "SELECT display_name, email FROM users WHERE id = ?",
                    (row["target_id"],),
                ).fetchone()
                label = (user["display_name"] if user else None) or (user["email"] if user else row["target_id"])
            elif row["share_type"] == "team":
                team = conn.execute("SELECT name FROM teams WHERE id = ?", (row["target_id"],)).fetchone()
                label = (team["name"] if team else None) or row["target_id"]
            elif row["share_type"] == "project":
                label = f"Project {row['target_id']}"
            item["label"] = label
            out.append(item)
    return out


def share_knowledge_base(
    user_id: str,
    kb_id: str,
    *,
    share_type: str,
    target_id: str,
) -> dict[str, Any]:
    get_knowledge_base(user_id, kb_id, require_owner=True)
    stype = str(share_type or "").strip().lower()
    tid = str(target_id or "").strip()
    if stype not in {"user", "project", "team"}:
        raise ValueError("share_type must be user, project, or team")
    if not tid:
        raise ValueError("target_id is required")

    from backend.services import teams_service

    if stype == "user":
        if tid == user_id:
            raise ValueError("You already own this knowledge base")
        with get_conn() as conn:
            target = conn.execute("SELECT id FROM users WHERE id = ?", (tid,)).fetchone()
        if not target:
            raise ValueError("User not found")
        # Prefer sharing with teammates
        teammate = False
        for team in teams_service.list_teams(user_id):
            members = teams_service.list_team_members(team["id"], user_id)
            if any(m["id"] == tid for m in members):
                teammate = True
                break
        if not teammate:
            raise ValueError("You can only share with workspace teammates")
    elif stype == "team":
        teams_service.list_team_members(tid, user_id)
    elif stype == "project":
        if not teams_service.can_access_project(user_id, tid):
            raise ValueError("You do not have access to that project")

    share_id = str(uuid.uuid4())[:12]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO knowledge_shares (id, kb_id, share_type, target_id, shared_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(kb_id, share_type, target_id) DO NOTHING
            """,
            (share_id, kb_id, stype, tid, user_id, now),
        )
        row = conn.execute(
            """
            SELECT id, kb_id, share_type, target_id, shared_by, created_at
              FROM knowledge_shares
             WHERE kb_id = ? AND share_type = ? AND target_id = ?
            """,
            (kb_id, stype, tid),
        ).fetchone()
    return dict(row) if row else {"id": share_id, "kb_id": kb_id, "share_type": stype, "target_id": tid}


def unshare_knowledge_base(user_id: str, kb_id: str, share_id: str) -> None:
    get_knowledge_base(user_id, kb_id, require_owner=True)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM knowledge_shares WHERE id = ? AND kb_id = ?",
            (share_id, kb_id),
        ).fetchone()
        if not row:
            raise LookupError("Share not found")
        conn.execute("DELETE FROM knowledge_shares WHERE id = ? AND kb_id = ?", (share_id, kb_id))


def list_share_targets(user_id: str) -> dict[str, Any]:
    from backend.services import teams_service

    teams = teams_service.list_teams(user_id)
    members_by_id: dict[str, dict[str, Any]] = {}
    for team in teams:
        try:
            for member in teams_service.list_team_members(team["id"], user_id):
                if member["id"] == user_id:
                    continue
                members_by_id[member["id"]] = {
                    "id": member["id"],
                    "display_name": member.get("display_name") or member.get("email") or member["id"],
                    "email": member.get("email") or "",
                    "team_id": team["id"],
                    "team_name": team.get("name") or team["id"],
                }
        except Exception:
            continue
    projects = []
    for row in teams_service.user_project_access(user_id, None):
        pid = row.get("project_id") or row.get("id")
        if not pid:
            continue
        name = pid
        try:
            from backend.config import settings
            from backend.services.project_store import load_meta as _load_meta

            root = Path(settings.projects_dir)
            if not root.is_absolute():
                root = Path.cwd() / root
            meta = _load_meta(root / str(pid))
            if isinstance(meta, dict) and meta.get("name"):
                name = meta["name"]
        except Exception:
            pass
        projects.append(
            {
                "id": pid,
                "name": name,
                "team_id": row.get("team_id"),
            }
        )
    return {
        "users": sorted(members_by_id.values(), key=lambda m: (m.get("display_name") or "").lower()),
        "teams": [{"id": t["id"], "name": t.get("name") or t["id"]} for t in teams],
        "projects": projects,
    }


def build_prompt_context(
    user_id: str,
    *,
    knowledge_base_ids: list[str] | None = None,
    skill_ids: list[str] | None = None,
    max_chars: int = MAX_PROMPT_CHARS,
) -> dict[str, Any] | None:
    kb_ids = resolve_kb_ids_for_prompt(user_id, knowledge_base_ids=knowledge_base_ids, skill_ids=skill_ids)
    if not kb_ids:
        return None
    sections: list[str] = []
    used = 0
    sources: list[dict[str, Any]] = []
    for kb_id in kb_ids:
        try:
            kb = get_knowledge_base(user_id, kb_id)
        except LookupError:
            continue
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, name, text_excerpt, media_type, folder_id
                  FROM knowledge_items
                 WHERE kb_id = ?
                 ORDER BY created_at DESC
                """,
                (kb_id,),
            ).fetchall()
        block = [f"### Knowledge base: {kb['name']}"]
        if kb.get("description"):
            block.append(kb["description"])
        for row in rows:
            excerpt = (row["text_excerpt"] or "").strip()
            if not excerpt:
                continue
            piece = f"#### {row['name']}\n{excerpt[:MAX_ITEM_EXCERPT]}"
            if used + len(piece) > max_chars:
                block.append("[Additional knowledge truncated]")
                sections.append("\n".join(block))
                return {
                    "knowledge_base_ids": kb_ids,
                    "text": "\n\n".join(sections).strip(),
                    "sources": sources,
                    "truncated": True,
                }
            block.append(piece)
            used += len(piece)
            sources.append({"kb_id": kb_id, "item_id": row["id"], "name": row["name"]})
        sections.append("\n".join(block))
    text = "\n\n".join(sections).strip()
    if not text:
        return None
    return {
        "knowledge_base_ids": kb_ids,
        "text": text,
        "sources": sources,
        "truncated": False,
    }
