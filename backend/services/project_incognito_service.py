"""Per-user project Incognito mode — private to owner, hidden from management."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from backend import database as _db
from backend.database import get_conn

_PIN_ROUNDS = 120_000
_UNLOCK_TTL_HOURS = 12
_TABLES_READY_FOR: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        str(pin).encode("utf-8"),
        bytes.fromhex(salt),
        _PIN_ROUNDS,
    ).hex()


def ensure_tables() -> None:
    global _TABLES_READY_FOR
    db_key = str(_db.DB_PATH)
    if _TABLES_READY_FOR == db_key:
        return
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_incognito (
                project_id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                pin_salt TEXT,
                pin_hash TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_incognito_unlocks (
                project_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                unlocked_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        conn.commit()
    _TABLES_READY_FOR = db_key


def is_enabled(project_id: str) -> bool:
    pid = str(project_id or "").strip()
    if not pid:
        return False
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT enabled FROM project_incognito WHERE project_id = ?",
            (pid,),
        ).fetchone()
    return bool(row and int(row["enabled"] or 0))


def enabled_project_ids() -> set[str]:
    ensure_tables()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT project_id FROM project_incognito WHERE enabled = 1"
        ).fetchall()
    return {str(r["project_id"]) for r in rows}


def get_status(project_id: str, user_id: str | None = None) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip() or None
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT project_id, owner_user_id, enabled, pin_hash, updated_at
              FROM project_incognito
             WHERE project_id = ?
            """,
            (pid,),
        ).fetchone()
    if not row or not int(row["enabled"] or 0):
        return {
            "project_id": pid,
            "incognito": False,
            "has_pin": False,
            "unlocked": True,
            "owner_user_id": None,
        }
    has_pin = bool(row["pin_hash"])
    unlocked = True
    if has_pin and uid:
        unlocked = is_unlocked(pid, uid)
    elif has_pin and not uid:
        unlocked = False
    return {
        "project_id": pid,
        "incognito": True,
        "has_pin": has_pin,
        "unlocked": unlocked if has_pin else True,
        "owner_user_id": row["owner_user_id"],
        "updated_at": row["updated_at"],
    }


def is_owner(project_id: str, user_id: str) -> bool:
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if not pid or not uid:
        return False
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT created_by FROM project_access WHERE project_id = ?",
            (pid,),
        ).fetchone()
        inc = conn.execute(
            "SELECT owner_user_id FROM project_incognito WHERE project_id = ?",
            (pid,),
        ).fetchone()
    if inc and str(inc["owner_user_id"] or "") == uid:
        return True
    if row and str(row["created_by"] or "") == uid:
        return True
    return False


def is_unlocked(project_id: str, user_id: str) -> bool:
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if not pid or not uid:
        return False
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT expires_at FROM project_incognito_unlocks
             WHERE project_id = ? AND user_id = ?
            """,
            (pid, uid),
        ).fetchone()
    if not row:
        return False
    expires = _parse_ts(row["expires_at"])
    if not expires:
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires > datetime.now(timezone.utc)


def is_locked_for_user(project_id: str, user_id: str) -> bool:
    status = get_status(project_id, user_id)
    return bool(status.get("incognito") and status.get("has_pin") and not status.get("unlocked"))


def enable(
    project_id: str,
    owner_user_id: str,
    *,
    pin: str | None = None,
) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    uid = str(owner_user_id or "").strip()
    if not pid or not uid:
        raise ValueError("project_id and owner_user_id are required")
    ensure_tables()
    now = _now()
    pin_salt = None
    pin_hash = None
    clean_pin = str(pin or "").strip()
    if clean_pin:
        if len(clean_pin) < 4 or len(clean_pin) > 32:
            raise ValueError("PIN must be 4–32 characters")
        pin_salt = secrets.token_hex(16)
        pin_hash = _hash_pin(clean_pin, pin_salt)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO project_incognito (
                project_id, owner_user_id, enabled, pin_salt, pin_hash, created_at, updated_at
            ) VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                owner_user_id = excluded.owner_user_id,
                enabled = 1,
                pin_salt = excluded.pin_salt,
                pin_hash = excluded.pin_hash,
                updated_at = excluded.updated_at
            """,
            (pid, uid, pin_salt, pin_hash, now, now),
        )
        # Fresh enable: clear other users' unlocks; unlock owner if no new pin
        # or after setting pin they still need to unlock — unlock owner now since they just set it.
        conn.execute(
            "DELETE FROM project_incognito_unlocks WHERE project_id = ?",
            (pid,),
        )
        expires = (datetime.now(timezone.utc) + timedelta(hours=_UNLOCK_TTL_HOURS)).isoformat()
        conn.execute(
            """
            INSERT INTO project_incognito_unlocks (project_id, user_id, unlocked_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (pid, uid, now, expires),
        )
        # Force off public visibility when entering incognito.
        try:
            conn.execute(
                "UPDATE project_access SET is_public = 0 WHERE project_id = ?",
                (pid,),
            )
        except Exception:
            pass
        conn.commit()
    return get_status(pid, uid)


def disable(project_id: str, owner_user_id: str) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    uid = str(owner_user_id or "").strip()
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM project_incognito WHERE project_id = ?",
            (pid,),
        ).fetchone()
        if row and str(row["owner_user_id"] or "") not in {"", uid}:
            raise PermissionError("Only the incognito owner can disable this mode")
        conn.execute(
            """
            UPDATE project_incognito
               SET enabled = 0, pin_salt = NULL, pin_hash = NULL, updated_at = ?
             WHERE project_id = ?
            """,
            (_now(), pid),
        )
        conn.execute(
            "DELETE FROM project_incognito_unlocks WHERE project_id = ?",
            (pid,),
        )
        conn.commit()
    return get_status(pid, uid)


def set_pin(project_id: str, owner_user_id: str, pin: str | None) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    uid = str(owner_user_id or "").strip()
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT owner_user_id, enabled FROM project_incognito WHERE project_id = ?",
            (pid,),
        ).fetchone()
        if not row or not int(row["enabled"] or 0):
            raise ValueError("Incognito mode is not enabled")
        if str(row["owner_user_id"] or "") != uid:
            raise PermissionError("Only the owner can change the PIN")
        clean_pin = str(pin or "").strip()
        if clean_pin:
            if len(clean_pin) < 4 or len(clean_pin) > 32:
                raise ValueError("PIN must be 4–32 characters")
            salt = secrets.token_hex(16)
            hashed = _hash_pin(clean_pin, salt)
        else:
            salt = None
            hashed = None
        conn.execute(
            """
            UPDATE project_incognito
               SET pin_salt = ?, pin_hash = ?, updated_at = ?
             WHERE project_id = ?
            """,
            (salt, hashed, _now(), pid),
        )
        conn.execute(
            "DELETE FROM project_incognito_unlocks WHERE project_id = ?",
            (pid,),
        )
        if hashed:
            expires = (datetime.now(timezone.utc) + timedelta(hours=_UNLOCK_TTL_HOURS)).isoformat()
            conn.execute(
                """
                INSERT INTO project_incognito_unlocks (project_id, user_id, unlocked_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (pid, uid, _now(), expires),
            )
        conn.commit()
    return get_status(pid, uid)


def unlock(project_id: str, user_id: str, pin: str) -> dict[str, Any]:
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    clean_pin = str(pin or "").strip()
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT owner_user_id, enabled, pin_salt, pin_hash
              FROM project_incognito
             WHERE project_id = ?
            """,
            (pid,),
        ).fetchone()
        if not row or not int(row["enabled"] or 0):
            raise ValueError("Incognito mode is not enabled")
        if str(row["owner_user_id"] or "") != uid:
            raise PermissionError("Incognito projects are private to their owner")
        if not row["pin_hash"] or not row["pin_salt"]:
            # No PIN set — treat as unlocked.
            return get_status(pid, uid)
        expected = str(row["pin_hash"])
        actual = _hash_pin(clean_pin, str(row["pin_salt"]))
        if not hmac.compare_digest(expected, actual):
            raise PermissionError("Incorrect PIN")
        now = _now()
        expires = (datetime.now(timezone.utc) + timedelta(hours=_UNLOCK_TTL_HOURS)).isoformat()
        conn.execute(
            """
            INSERT INTO project_incognito_unlocks (project_id, user_id, unlocked_at, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id, user_id) DO UPDATE SET
                unlocked_at = excluded.unlocked_at,
                expires_at = excluded.expires_at
            """,
            (pid, uid, now, expires),
        )
        conn.commit()
    return get_status(pid, uid)


def list_index(user_id: str | None = None) -> dict[str, dict[str, Any]]:
    """One SQLite round-trip for GET /api/projects. Empty table ⇒ no per-row queries."""
    ensure_tables()
    uid = str(user_id or "").strip() or None
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT project_id, owner_user_id, pin_hash
              FROM project_incognito
             WHERE enabled = 1
            """
        ).fetchall()
        unlocks: set[str] = set()
        if uid and rows:
            ids = [str(r["project_id"]) for r in rows]
            placeholders = ",".join("?" for _ in ids)
            now = _now()
            urows = conn.execute(
                f"""
                SELECT project_id FROM project_incognito_unlocks
                 WHERE user_id = ? AND project_id IN ({placeholders})
                   AND expires_at > ?
                """,
                (uid, *ids, now),
            ).fetchall()
            unlocks = {str(r["project_id"]) for r in urows}
    index: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = str(row["project_id"])
        has_pin = bool(row["pin_hash"])
        if has_pin and uid:
            unlocked = pid in unlocks
        elif has_pin:
            unlocked = False
        else:
            unlocked = True
        index[pid] = {
            "owner_user_id": str(row["owner_user_id"] or ""),
            "has_pin": has_pin,
            "unlocked": unlocked,
        }
    return index


def annotate_project(
    summary: dict[str, Any],
    user_id: str | None,
    *,
    index: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Attach incognito flags to a project summary dict."""
    pid = str(summary.get("id") or summary.get("project_id") or "").strip()
    if not pid:
        return summary
    out = dict(summary)
    if index is not None:
        info = index.get(pid)
        if not info:
            out["incognito"] = False
            out["incognito_has_pin"] = False
            out["incognito_unlocked"] = True
            return out
        out["incognito"] = True
        out["incognito_has_pin"] = bool(info.get("has_pin"))
        out["incognito_unlocked"] = bool(info.get("unlocked"))
        return out
    status = get_status(pid, user_id)
    out["incognito"] = bool(status.get("incognito"))
    out["incognito_has_pin"] = bool(status.get("has_pin"))
    out["incognito_unlocked"] = bool(status.get("unlocked"))
    return out


def should_hide_from_user(
    project_id: str,
    user_id: str,
    *,
    owner_user_id: str | None = None,
    index: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """True when an incognito project must not appear for this viewer."""
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if index is not None:
        info = index.get(pid)
        if not info:
            return False
        owner = str(owner_user_id or info.get("owner_user_id") or "").strip()
        if owner and owner == uid:
            return False
        return True
    if not is_enabled(pid):
        return False
    owner = str(owner_user_id or "").strip()
    if not owner:
        status = get_status(pid)
        owner = str(status.get("owner_user_id") or "")
    if owner and owner == uid:
        return False
    # Also allow access-row created_by match
    if is_owner(pid, uid):
        return False
    return True
