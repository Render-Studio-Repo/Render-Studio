"""Inspect OSS first-launch readiness without exposing private KB contents."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.config import settings
from backend.database import DB_PATH, get_conn

FIRST_PARTY_HOSTS = {
    "render3d.app",
    "www.render3d.app",
}


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    if db_path is None:
        return get_conn()
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _count(conn: sqlite3.Connection, query: str) -> int:
    row = conn.execute(query).fetchone()
    if row is None:
        return 0
    if isinstance(row, sqlite3.Row):
        value = row[0]
    else:
        value = row[0]
    try:
        return int(value or 0)
    except Exception:
        return 0


def _knowledge_root(data_dir: Path | None = None) -> Path:
    base = Path(data_dir or settings.data_dir)
    return base / "knowledge"


def _is_first_party_hosted() -> bool:
    base = str(getattr(settings, "public_base_url", "") or "").strip()
    host = (urlparse(base).hostname or "").lower()
    return host in FIRST_PARTY_HOSTS


def _scan_storage(
    knowledge_root: Path,
    *,
    known_kb_pairs: set[tuple[str, str]],
    known_storage_files: set[tuple[str, str, str]],
) -> dict[str, int]:
    stats = {
        "user_dirs": 0,
        "kb_dirs": 0,
        "storage_files": 0,
        "storage_bytes": 0,
        "orphan_kb_dirs": 0,
        "orphan_storage_files": 0,
        "unexpected_files": 0,
        "unexpected_dirs": 0,
        "stray_user_dirs": 0,
    }
    if not knowledge_root.exists():
        return stats
    if not knowledge_root.is_dir():
        stats["unexpected_files"] += 1
        return stats

    for user_entry in knowledge_root.iterdir():
        if user_entry.is_file():
            stats["unexpected_files"] += 1
            continue
        if not user_entry.is_dir():
            stats["unexpected_dirs"] += 1
            continue
        stats["user_dirs"] += 1
        saw_kb_dir = False
        for kb_entry in user_entry.iterdir():
            if kb_entry.is_file():
                stats["unexpected_files"] += 1
                continue
            if not kb_entry.is_dir():
                stats["unexpected_dirs"] += 1
                continue
            saw_kb_dir = True
            stats["kb_dirs"] += 1
            pair = (user_entry.name, kb_entry.name)
            if pair not in known_kb_pairs:
                stats["orphan_kb_dirs"] += 1
            for child in kb_entry.iterdir():
                if child.is_dir():
                    stats["unexpected_dirs"] += 1
                    continue
                if not child.is_file():
                    stats["unexpected_files"] += 1
                    continue
                stats["storage_files"] += 1
                try:
                    stats["storage_bytes"] += int(child.stat().st_size or 0)
                except OSError:
                    pass
                if (user_entry.name, kb_entry.name, child.name) not in known_storage_files:
                    stats["orphan_storage_files"] += 1
        if not saw_kb_dir:
            stats["stray_user_dirs"] += 1
    return stats


def _inspect_install_state(
    *,
    data_dir: Path | None = None,
    db_path: Path | None = None,
) -> dict[str, Any]:
    knowledge_root = _knowledge_root(data_dir)
    counts: dict[str, int] = {}
    details: list[str] = []

    with _connect(db_path) as conn:
        counts = {
            "knowledge_bases": _count(conn, "SELECT COUNT(*) FROM knowledge_bases"),
            "knowledge_folders": _count(conn, "SELECT COUNT(*) FROM knowledge_folders"),
            "knowledge_items": _count(conn, "SELECT COUNT(*) FROM knowledge_items"),
            "knowledge_skill_links": _count(conn, "SELECT COUNT(*) FROM knowledge_skill_links"),
            "knowledge_shares": _count(conn, "SELECT COUNT(*) FROM knowledge_shares"),
        }
        kb_rows = conn.execute(
            """
            SELECT id, user_id
              FROM knowledge_bases
            """
        ).fetchall()
        item_rows = conn.execute(
            """
            SELECT k.user_id, i.kb_id, i.storage_path
              FROM knowledge_items i
              JOIN knowledge_bases k ON k.id = i.kb_id
            """
        ).fetchall()
        folder_orphans = _count(
            conn,
            """
            SELECT COUNT(*)
              FROM knowledge_folders f
              LEFT JOIN knowledge_bases k ON k.id = f.kb_id
             WHERE k.id IS NULL
            """,
        )
        item_orphans = _count(
            conn,
            """
            SELECT COUNT(*)
              FROM knowledge_items i
              LEFT JOIN knowledge_bases k ON k.id = i.kb_id
             WHERE k.id IS NULL
            """,
        )
        skill_orphans = _count(
            conn,
            """
            SELECT COUNT(*)
              FROM knowledge_skill_links l
              LEFT JOIN knowledge_bases k ON k.id = l.kb_id
             WHERE k.id IS NULL
            """,
        )
        share_orphans = _count(
            conn,
            """
            SELECT COUNT(*)
              FROM knowledge_shares s
              LEFT JOIN knowledge_bases k ON k.id = s.kb_id
             WHERE k.id IS NULL
            """,
        )

    known_kb_pairs = {(str(row["user_id"]), str(row["id"])) for row in kb_rows}
    known_storage_files = {
        (str(row["user_id"]), str(row["kb_id"]), str(row["storage_path"]))
        for row in item_rows
    }
    storage = _scan_storage(
        knowledge_root,
        known_kb_pairs=known_kb_pairs,
        known_storage_files=known_storage_files,
    )
    counts.update(
        {
            "knowledge_user_dirs": storage["user_dirs"],
            "knowledge_kb_dirs": storage["kb_dirs"],
            "knowledge_storage_files": storage["storage_files"],
            "knowledge_storage_bytes": storage["storage_bytes"],
        }
    )

    missing_storage_files = 0
    for user_id, kb_id, storage_path in known_storage_files:
        file_path = knowledge_root / user_id / kb_id / storage_path
        if not file_path.is_file():
            missing_storage_files += 1

    anomalies: list[str] = []
    if counts["knowledge_bases"] == 0 and any(
        counts[key] > 0
        for key in ("knowledge_folders", "knowledge_items", "knowledge_skill_links", "knowledge_shares")
    ):
        anomalies.append("Knowledge tables contain child rows even though no knowledge bases exist.")
    if folder_orphans:
        anomalies.append(f"{folder_orphans} folder row(s) point at missing knowledge bases.")
    if item_orphans:
        anomalies.append(f"{item_orphans} item row(s) point at missing knowledge bases.")
    if skill_orphans:
        anomalies.append(f"{skill_orphans} skill-link row(s) point at missing knowledge bases.")
    if share_orphans:
        anomalies.append(f"{share_orphans} share row(s) point at missing knowledge bases.")
    if storage["stray_user_dirs"]:
        anomalies.append(f"{storage['stray_user_dirs']} user folder(s) exist under data/knowledge without any KB directories.")
    if storage["orphan_kb_dirs"]:
        anomalies.append(f"{storage['orphan_kb_dirs']} KB storage folder(s) have no matching database rows.")
    if storage["orphan_storage_files"]:
        anomalies.append(f"{storage['orphan_storage_files']} KB file(s) exist on disk without matching database rows.")
    if storage["unexpected_files"]:
        anomalies.append(f"{storage['unexpected_files']} unexpected file(s) were found in data/knowledge.")
    if storage["unexpected_dirs"]:
        anomalies.append(f"{storage['unexpected_dirs']} unexpected nested folder(s) were found in data/knowledge.")
    if missing_storage_files:
        anomalies.append(f"{missing_storage_files} KB file(s) are referenced in the database but missing on disk.")
    if counts["knowledge_bases"] != storage["kb_dirs"]:
        anomalies.append(
            "Database knowledge-base count does not match on-disk KB directory count "
            f"({counts['knowledge_bases']} vs {storage['kb_dirs']})."
        )
    if counts["knowledge_items"] != storage["storage_files"]:
        anomalies.append(
            "Database knowledge-item count does not match on-disk KB file count "
            f"({counts['knowledge_items']} vs {storage['storage_files']})."
        )

    has_kb_data = any(
        counts[key] > 0
        for key in (
            "knowledge_bases",
            "knowledge_folders",
            "knowledge_items",
            "knowledge_skill_links",
            "knowledge_shares",
            "knowledge_user_dirs",
            "knowledge_kb_dirs",
            "knowledge_storage_files",
        )
    )

    if anomalies:
        details.extend(anomalies)
        details.append("Clear data/knowledge and the knowledge_* tables before treating this as a first launch.")
        return {
            "kind": "half_seeded",
            "status": "fail",
            "fail_closed": True,
            "summary": "FAIL — knowledge storage looks half-seeded or inconsistent.",
            "details": details,
            "counts": counts,
        }

    if has_kb_data:
        details.append(
            "Expected an empty knowledge library on first launch, but KB data already exists "
            f"({counts['knowledge_bases']} base(s), {counts['knowledge_items']} file(s))."
        )
        if counts["knowledge_skill_links"]:
            details.append(f"{counts['knowledge_skill_links']} skill link(s) are already attached.")
        if counts["knowledge_shares"]:
            details.append(f"{counts['knowledge_shares']} share row(s) already exist.")
        details.append("This is a dirty install for OSS launch purposes, so the checklist stays closed to PASS.")
        return {
            "kind": "dirty",
            "status": "fail",
            "fail_closed": True,
            "summary": "FAIL — knowledge data already exists, so this is not a clean first launch.",
            "details": details,
            "counts": counts,
        }

    return {
        "kind": "clean",
        "status": "pass",
        "fail_closed": False,
        "summary": "PASS — knowledge storage is empty, so this looks like a clean first launch.",
        "details": [
            "No knowledge bases, KB files, skill links, or share rows were found.",
            "No leftover KB storage folders were found on disk.",
        ],
        "counts": counts,
    }


def get_public_checklist_state(
    *,
    data_dir: Path | None = None,
    db_path: Path | None = None,
) -> dict[str, Any]:
    try:
        knowledge_state = _inspect_install_state(data_dir=data_dir, db_path=db_path)
    except Exception as exc:
        knowledge_state = {
            "kind": "inspection_error",
            "status": "fail",
            "fail_closed": True,
            "summary": "FAIL — could not inspect knowledge storage, so OSS launch stays fail-closed.",
            "details": [
                f"Inspector error: {exc}",
                "Fix the KB database/storage issue before treating this as a first launch.",
            ],
            "counts": {
                "knowledge_bases": 0,
                "knowledge_folders": 0,
                "knowledge_items": 0,
                "knowledge_skill_links": 0,
                "knowledge_shares": 0,
                "knowledge_user_dirs": 0,
                "knowledge_kb_dirs": 0,
                "knowledge_storage_files": 0,
                "knowledge_storage_bytes": 0,
            },
        }

    return {
        "install_mode": "first_party_hosted" if _is_first_party_hosted() else "oss_candidate",
        "show_checklist_recommended": not _is_first_party_hosted(),
        "knowledge_state": knowledge_state,
        "ecosystem_sync": {
            "default_enabled": False,
            "summary": "Optional. Leave ecosystem sync off until you actually want outside CAD/apps on day one.",
        },
    }


__all__ = ["get_public_checklist_state"]
