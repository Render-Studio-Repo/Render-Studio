"""Keep deleted projects from being re-registered or re-seeded."""

from __future__ import annotations

import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.project_lifecycle")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _projects_root() -> Path:
    return Path(settings.projects_dir)


def deleted_marker_dir() -> Path:
    return _projects_root() / ".deleted"


def _marker_path(project_id: str) -> Path:
    return deleted_marker_dir() / str(project_id).strip()


def is_project_deleted(project_id: str) -> bool:
    pid = str(project_id or "").strip()
    if not pid or pid.startswith("."):
        return False
    if _marker_path(pid).is_file():
        return True
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM deleted_projects WHERE project_id = ?",
                (pid,),
            ).fetchone()
        return row is not None
    except Exception:
        return False


def mark_project_deleted(project_id: str) -> None:
    pid = str(project_id or "").strip()
    if not pid or pid.startswith("."):
        return
    try:
        with get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO deleted_projects (project_id, deleted_at) VALUES (?, ?)",
                (pid, _now()),
            )
            conn.commit()
    except Exception:
        logger.debug("deleted_projects row failed for %s", pid, exc_info=True)
    try:
        marker = _marker_path(pid)
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("deleted\n", encoding="utf-8")
    except OSError:
        logger.debug("deleted marker write failed for %s", pid, exc_info=True)


def clear_project_deleted(project_id: str) -> None:
    pid = str(project_id or "").strip()
    if not pid:
        return
    try:
        with get_conn() as conn:
            conn.execute("DELETE FROM deleted_projects WHERE project_id = ?", (pid,))
            conn.commit()
    except Exception:
        logger.debug("clear deleted_projects failed for %s", pid, exc_info=True)
    try:
        _marker_path(pid).unlink(missing_ok=True)
    except OSError:
        pass


def suppress_demo_template(user_id: str, template_id: str) -> None:
    uid = str(user_id or "").strip()
    tid = str(template_id or "").strip()
    if not uid or not tid:
        return
    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO deleted_demo_templates (user_id, template_id, deleted_at)
                VALUES (?, ?, ?)
                """,
                (uid, tid, _now()),
            )
            conn.commit()
    except Exception:
        logger.debug("suppress demo template failed user=%s template=%s", uid, tid, exc_info=True)


def is_demo_template_suppressed(user_id: str, template_id: str) -> bool:
    uid = str(user_id or "").strip()
    tid = str(template_id or "").strip()
    if not uid or not tid:
        return False
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM deleted_demo_templates WHERE user_id = ? AND template_id = ?",
                (uid, tid),
            ).fetchone()
        return row is not None
    except Exception:
        return False


def clear_demo_template_suppressed(user_id: str, template_id: str) -> None:
    uid = str(user_id or "").strip()
    tid = str(template_id or "").strip()
    if not uid or not tid:
        return
    try:
        with get_conn() as conn:
            conn.execute(
                "DELETE FROM deleted_demo_templates WHERE user_id = ? AND template_id = ?",
                (uid, tid),
            )
            conn.commit()
    except Exception:
        logger.debug("clear demo suppress failed user=%s template=%s", uid, tid, exc_info=True)


def purge_project_records(project_id: str) -> None:
    pid = str(project_id or "").strip()
    if not pid:
        return
    with get_conn() as conn:
        conn.execute("DELETE FROM project_access WHERE project_id = ?", (pid,))
        conn.execute("DELETE FROM project_shares WHERE project_id = ?", (pid,))
        conn.execute("DELETE FROM project_hidden WHERE project_id = ?", (pid,))
        conn.execute("DELETE FROM project_share_invites WHERE project_id = ?", (pid,))
        try:
            conn.execute("DELETE FROM project_fusion_mirrors WHERE project_id = ?", (pid,))
        except Exception:
            pass
        conn.commit()


def remove_leftover_deleted_project(projects_root: Path, project_id: str) -> bool:
    """Delete a leftover on-disk folder for a tombstoned project. Returns True if removed."""
    pid = str(project_id or "").strip()
    if not pid or not is_project_deleted(pid):
        return False
    path = Path(projects_root) / pid
    if not path.is_dir():
        return False
    shutil.rmtree(path, ignore_errors=True)
    return not path.exists()


def mint_project_id(projects_root: Path) -> str:
    """8-char id that is not tombstoned and does not already exist on disk."""
    root = Path(projects_root)
    for _ in range(64):
        pid = str(uuid.uuid4())[:8]
        if is_project_deleted(pid):
            continue
        if (root / pid).exists():
            continue
        return pid
    raise RuntimeError("Could not allocate a project id")


def sweep_deleted_project_dirs(projects_root: Path) -> int:
    root = Path(projects_root)
    if not root.is_dir():
        return 0
    removed = 0
    ids: set[str] = set()
    try:
        with get_conn() as conn:
            rows = conn.execute("SELECT project_id FROM deleted_projects").fetchall()
        ids.update(str(r["project_id"]) for r in rows)
    except Exception:
        pass
    marker_root = deleted_marker_dir()
    if marker_root.is_dir():
        for marker in marker_root.iterdir():
            if marker.is_file() and not marker.name.startswith("."):
                ids.add(marker.name)
    for pid in ids:
        if remove_leftover_deleted_project(root, pid):
            removed += 1
    return removed
