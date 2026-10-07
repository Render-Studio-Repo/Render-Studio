"""Team-shared ChatGPT / Codex logins and the 3-render new-user trial.

New accounts get counted ChatGPT generations on the host subscription instead of
$10 platform-key credits. Anyone can also share their own ChatGPT login with a
team the same way API keys are shared (default deny except the owner).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.config import settings
from backend.database import get_conn

TRIAL_RENDER_LIMIT = 3
TRIAL_KIND = "chatgpt_renders"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_tables(conn: Any | None = None) -> None:
    sql = """
        CREATE TABLE IF NOT EXISTS ai_trial_renders (
            user_id TEXT PRIMARY KEY,
            granted_at TEXT NOT NULL,
            used_count INTEGER NOT NULL DEFAULT 0,
            limit_count INTEGER NOT NULL DEFAULT 3,
            popup_seen_at TEXT,
            email_sent_at TEXT,
            grant_ip TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS team_shared_chatgpt (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (team_id, owner_user_id),
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS team_chatgpt_grants (
            share_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            granted INTEGER NOT NULL DEFAULT 0,
            updated_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            daily_limit_usd REAL,
            PRIMARY KEY (share_id, user_id),
            FOREIGN KEY (share_id) REFERENCES team_shared_chatgpt(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS personal_chatgpt_people (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            granted INTEGER NOT NULL DEFAULT 1,
            daily_limit_usd REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (owner_user_id, user_id),
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """
    if conn is not None:
        conn.executescript(sql)
        _ensure_grant_limit_column(conn)
        return
    with get_conn() as owned:
        owned.executescript(sql)
        _ensure_grant_limit_column(owned)


def _ensure_grant_limit_column(conn: Any) -> None:
    try:
        conn.execute("ALTER TABLE team_chatgpt_grants ADD COLUMN daily_limit_usd REAL")
    except sqlite3.OperationalError:
        pass


def _signed_in(user_id: str | None) -> bool:
    uid = str(user_id or "").strip()
    if not uid:
        return False
    try:
        from backend.services.chatgpt_codex_auth import read_chatgpt_auth

        return bool(read_chatgpt_auth(uid).get("signed_in"))
    except Exception:
        return False


def _owner_emails() -> list[str]:
    raw = getattr(settings, "openai_owner_emails", None) or ""
    return [e.strip().lower() for e in str(raw).split(",") if e.strip()]


def host_chatgpt_user_id() -> str | None:
    """Sam / configured owner whose ChatGPT login funds new-user trial renders."""
    emails = _owner_emails()
    candidates: list[str] = []
    with get_conn() as conn:
        if emails:
            placeholders = ",".join("?" * len(emails))
            rows = conn.execute(
                f"""
                SELECT id FROM users
                WHERE lower(email) IN ({placeholders})
                ORDER BY created_at ASC
                """,
                emails,
            ).fetchall()
            candidates.extend(str(r["id"]) for r in rows)
    for uid in candidates:
        if _signed_in(uid):
            return uid
    return None


def _user_label(conn: Any, user_id: str) -> str:
    row = conn.execute(
        "SELECT display_name, email FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        return "Teammate"
    return str(row["display_name"] or row["email"] or "Teammate")


def trial_row(user_id: str) -> dict[str, Any] | None:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT * FROM ai_trial_renders WHERE user_id = ?",
            (uid,),
        ).fetchone()
    return dict(row) if row else None


def trial_remaining(user_id: str) -> int:
    row = trial_row(user_id)
    if not row:
        return 0
    limit = max(0, int(row.get("limit_count") or TRIAL_RENDER_LIMIT))
    used = max(0, int(row.get("used_count") or 0))
    return max(0, limit - used)


def trial_status(user_id: str) -> dict[str, Any]:
    row = trial_row(user_id)
    if not row:
        return {
            "kind": TRIAL_KIND,
            "granted": False,
            "renders_limit": TRIAL_RENDER_LIMIT,
            "renders_used": 0,
            "renders_remaining": 0,
            "show_popup": False,
            "on_free_trial": False,
            "active": False,
            "popup_seen": False,
            "email_sent": False,
            "key_label": "ChatGPT trial",
        }
    limit = max(0, int(row.get("limit_count") or TRIAL_RENDER_LIMIT))
    used = max(0, int(row.get("used_count") or 0))
    remaining = max(0, limit - used)
    popup_seen = bool(str(row.get("popup_seen_at") or "").strip())
    return {
        "kind": TRIAL_KIND,
        "granted": True,
        "granted_at": row.get("granted_at"),
        "renders_limit": limit,
        "renders_used": used,
        "renders_remaining": remaining,
        "popup_seen": popup_seen,
        "show_popup": bool(remaining > 0 and not popup_seen),
        "email_sent": bool(str(row.get("email_sent_at") or "").strip()),
        "on_free_trial": remaining > 0,
        "active": remaining > 0,
        "amount_cents": 0,
        "amount_usd": 0,
        "key_label": "ChatGPT trial",
        "host_available": bool(host_chatgpt_user_id()),
    }


def overlay_trial_info(info: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Keep existing $10 credit trials; otherwise surface ChatGPT render counts."""
    out = dict(info or {})
    if str(out.get("granted_at") or "").strip() and int(out.get("amount_cents") or 0) > 0:
        out.setdefault("kind", "credits")
        return out
    render = trial_status(user_id)
    if not render.get("granted"):
        out.setdefault("kind", TRIAL_KIND)
        out.setdefault("renders_limit", TRIAL_RENDER_LIMIT)
        out.setdefault("renders_remaining", 0)
        out.setdefault("renders_used", 0)
        return out
    out.update(render)
    return out


def grant_trial_renders(user_id: str, ip: str | None = None) -> bool:
    """Idempotent one-time 3-render grant. Does not add platform-key cents."""
    uid = str(user_id or "").strip()
    if not uid:
        return False
    now = _now()
    ip_s = str(ip or "").strip() or None
    with get_conn() as conn:
        ensure_tables(conn)
        existing = conn.execute(
            "SELECT user_id FROM ai_trial_renders WHERE user_id = ?",
            (uid,),
        ).fetchone()
        if existing:
            return False
        conn.execute(
            """
            INSERT INTO ai_trial_renders (
                user_id, granted_at, used_count, limit_count, grant_ip
            ) VALUES (?, ?, 0, ?, ?)
            """,
            (uid, now, TRIAL_RENDER_LIMIT, ip_s),
        )
        if ip_s:
            try:
                conn.execute(
                    "INSERT INTO ai_credit_trial_ips (ip, user_id, granted_at) VALUES (?, ?, ?)",
                    (ip_s, uid, now),
                )
            except Exception:
                pass
        try:
            conn.execute("DELETE FROM ai_credit_trial_waitlist WHERE user_id = ?", (uid,))
        except Exception:
            pass
        meta = {
            "signup_trial": True,
            "kind": TRIAL_KIND,
            "renders_limit": TRIAL_RENDER_LIMIT,
            "key_label": "ChatGPT trial",
            "client_ip": ip_s,
            "note": "Three ChatGPT trial renders on the host subscription.",
        }
        try:
            conn.execute(
                """
                INSERT INTO ai_credit_transactions (
                  id, user_id, kind, amount_cents, balance_after_cents, provider, meta_json, created_at
                ) VALUES (?, ?, 'trial', 0, 0, 'chatgpt', ?, ?)
                """,
                (str(uuid.uuid4()), uid, json.dumps(meta), now),
            )
        except Exception:
            pass
    try:
        from backend.services import supabase_security_store as sbsec

        if ip_s:
            sbsec.claim_ip(ip_s, uid, granted_at=now)
        sbsec.remove_waitlist(uid)
        sbsec.record_grant(
            user_id=uid,
            amount_cents=0,
            from_pool=False,
            client_ip=ip_s,
            meta=meta,
        )
    except Exception:
        pass
    return True


def consume_trial_render(user_id: str) -> bool:
    """Atomically spend one trial render. False if none remaining or never granted."""
    uid = str(user_id or "").strip()
    if not uid:
        return False
    with get_conn() as conn:
        ensure_tables(conn)
        cur = conn.execute(
            """
            UPDATE ai_trial_renders
               SET used_count = used_count + 1
             WHERE user_id = ?
               AND used_count < limit_count
            """,
            (uid,),
        )
        return int(cur.rowcount or 0) > 0


def ack_trial_popup(user_id: str) -> None:
    uid = str(user_id or "").strip()
    if not uid:
        return
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        conn.execute(
            """
            UPDATE ai_trial_renders
               SET popup_seen_at = COALESCE(NULLIF(popup_seen_at, ''), ?)
             WHERE user_id = ?
            """,
            (now, uid),
        )


def mark_trial_email_sent(user_id: str) -> None:
    uid = str(user_id or "").strip()
    if not uid:
        return
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        conn.execute(
            """
            UPDATE ai_trial_renders
               SET email_sent_at = COALESCE(NULLIF(email_sent_at, ''), ?)
             WHERE user_id = ?
            """,
            (now, uid),
        )


def _grant_over_daily_limit(row: Any, spent_today_usd: float | None) -> bool:
    if spent_today_usd is None:
        return False
    raw = row["daily_limit_usd"] if row["daily_limit_usd"] is not None else None
    if raw is None:
        return False
    try:
        return float(spent_today_usd) >= float(raw)
    except (TypeError, ValueError):
        return False


def resolve_codex_owner(user_id: str, *, spent_today_usd: float | None = None) -> dict[str, Any]:
    """Who Codex should run as: own login, a granted team share, or the trial host."""
    uid = str(user_id or "").strip()
    empty = {"owner_user_id": None, "kind": None, "owner_name": ""}
    if not uid:
        return empty
    if _signed_in(uid):
        return {"owner_user_id": uid, "kind": "self", "owner_name": ""}
    had_grant = False
    blocked: dict[str, Any] | None = None
    with get_conn() as conn:
        ensure_tables(conn)
        personal_rows = conn.execute(
            """
            SELECT p.id, p.owner_user_id, p.daily_limit_usd
              FROM personal_chatgpt_people p
             WHERE p.user_id = ?
               AND p.granted = 1
             ORDER BY p.created_at ASC
            """,
            (uid,),
        ).fetchall()
        for row in personal_rows:
            had_grant = True
            owner = str(row["owner_user_id"] or "")
            if _grant_over_daily_limit(row, spent_today_usd):
                blocked = {
                    "kind": "daily_limit",
                    "share_id": row["id"],
                    "daily_limit_usd": float(row["daily_limit_usd"]),
                    "spent_today_usd": float(spent_today_usd or 0),
                    "owner_name": _user_label(conn, owner) if owner else "",
                    "source": "personal",
                }
                continue
            if owner and _signed_in(owner):
                return {
                    "owner_user_id": owner,
                    "kind": "personal",
                    "owner_name": _user_label(conn, owner),
                    "share_id": row["id"],
                    "daily_limit_usd": row["daily_limit_usd"],
                }
        rows = conn.execute(
            """
            SELECT s.id, s.owner_user_id, s.team_id, g.daily_limit_usd
              FROM team_chatgpt_grants g
              JOIN team_shared_chatgpt s ON s.id = g.share_id
              JOIN team_members tm ON tm.team_id = s.team_id AND tm.user_id = ?
             WHERE g.user_id = ?
               AND g.granted = 1
             ORDER BY s.created_at ASC
            """,
            (uid, uid),
        ).fetchall()
        for row in rows:
            had_grant = True
            owner = str(row["owner_user_id"] or "")
            if _grant_over_daily_limit(row, spent_today_usd):
                blocked = {
                    "kind": "daily_limit",
                    "share_id": row["id"],
                    "team_id": row["team_id"],
                    "daily_limit_usd": float(row["daily_limit_usd"]),
                    "spent_today_usd": float(spent_today_usd or 0),
                    "owner_name": _user_label(conn, owner) if owner else "",
                    "source": "team",
                }
                continue
            if owner and _signed_in(owner):
                return {
                    "owner_user_id": owner,
                    "kind": "team",
                    "owner_name": _user_label(conn, owner),
                    "share_id": row["id"],
                    "team_id": row["team_id"],
                    "daily_limit_usd": row["daily_limit_usd"],
                }
    if had_grant and blocked:
        return {**empty, **blocked}
    if trial_remaining(uid) > 0:
        host = host_chatgpt_user_id()
        if host:
            return {"owner_user_id": host, "kind": "trial", "owner_name": "Render Studio"}
    return empty


def _is_team_member(conn: Any, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
        (team_id, user_id),
    ).fetchone()
    return bool(row)


def _is_team_owner(conn: Any, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND role='owner'",
        (team_id, user_id),
    ).fetchone()
    return bool(row)


def share_with_team(team_id: str, owner_user_id: str) -> dict[str, Any]:
    if not _signed_in(owner_user_id):
        raise ValueError("Sign in with ChatGPT under Subscriptions before sharing it with a team.")
    now = _now()
    share_id = str(uuid.uuid4())[:8]
    with get_conn() as conn:
        ensure_tables(conn)
        if not _is_team_member(conn, team_id, owner_user_id):
            raise ValueError("Not a team member")
        existing = conn.execute(
            "SELECT id FROM team_shared_chatgpt WHERE team_id=? AND owner_user_id=?",
            (team_id, owner_user_id),
        ).fetchone()
        if existing:
            return get_share(team_id, existing["id"], owner_user_id)
        conn.execute(
            """
            INSERT INTO team_shared_chatgpt (id, team_id, owner_user_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (share_id, team_id, owner_user_id, now),
        )
        members = conn.execute(
            "SELECT user_id FROM team_members WHERE team_id=?",
            (team_id,),
        ).fetchall()
        for member in members:
            mid = member["user_id"]
            if mid == owner_user_id:
                continue
            conn.execute(
                """
                INSERT INTO team_chatgpt_grants (share_id, user_id, granted, updated_by, updated_at)
                VALUES (?, ?, 0, ?, ?)
                ON CONFLICT(share_id, user_id) DO NOTHING
                """,
                (share_id, mid, owner_user_id, now),
            )
    return get_share(team_id, share_id, owner_user_id)


def unshare_from_team(team_id: str, share_id: str, requester_id: str) -> None:
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT owner_user_id FROM team_shared_chatgpt WHERE id=? AND team_id=?",
            (share_id, team_id),
        ).fetchone()
        if not row:
            raise ValueError("Shared ChatGPT login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError("Only the owner can stop sharing this ChatGPT login")
        conn.execute("DELETE FROM team_chatgpt_grants WHERE share_id=?", (share_id,))
        conn.execute("DELETE FROM team_shared_chatgpt WHERE id=?", (share_id,))


def deny_shared_chatgpt_for_new_member(
    team_id: str,
    user_id: str,
    *,
    updated_by: str | None = None,
) -> None:
    now = _now()
    actor = updated_by or user_id
    with get_conn() as conn:
        ensure_tables(conn)
        shares = conn.execute(
            "SELECT id, owner_user_id FROM team_shared_chatgpt WHERE team_id=?",
            (team_id,),
        ).fetchall()
        for share in shares:
            if share["owner_user_id"] == user_id:
                continue
            conn.execute(
                """
                INSERT INTO team_chatgpt_grants (share_id, user_id, granted, updated_by, updated_at)
                VALUES (?, ?, 0, ?, ?)
                ON CONFLICT(share_id, user_id) DO NOTHING
                """,
                (share["id"], user_id, actor, now),
            )


def list_team_shares(team_id: str, requester_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        ensure_tables(conn)
        if not _is_team_member(conn, team_id, requester_id):
            raise ValueError("Not a team member")
        rows = conn.execute(
            """
            SELECT s.id, s.team_id, s.owner_user_id, s.created_at,
                   u.display_name AS owner_name, u.email AS owner_email,
                   COALESCE(g.granted, 0) AS granted
              FROM team_shared_chatgpt s
              JOIN users u ON u.id = s.owner_user_id
              LEFT JOIN team_chatgpt_grants g
                     ON g.share_id = s.id AND g.user_id = ?
             WHERE s.team_id = ?
             ORDER BY s.created_at ASC
            """,
            (requester_id, team_id),
        ).fetchall()
        out = []
        for row in rows:
            is_owner = row["owner_user_id"] == requester_id
            out.append(
                {
                    "id": row["id"],
                    "team_id": row["team_id"],
                    "owner_user_id": row["owner_user_id"],
                    "owner_name": row["owner_name"],
                    "owner_email": row["owner_email"],
                    "created_at": row["created_at"],
                    "is_owner": is_owner,
                    "granted": True if is_owner else bool(row["granted"]),
                    "owner_signed_in": _signed_in(row["owner_user_id"]),
                }
            )
        return out


def get_share(team_id: str, share_id: str, requester_id: str) -> dict[str, Any]:
    shares = list_team_shares(team_id, requester_id)
    for share in shares:
        if share["id"] == share_id:
            return share
    raise ValueError("Shared ChatGPT login not found")


def _as_limit(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _user_columns(conn: Any) -> set[str]:
    try:
        rows = conn.execute("PRAGMA table_info(users)").fetchall()
        return {str(r["name"] if "name" in r.keys() else r[1]) for r in rows}
    except Exception:
        return set()


def _find_registered_user(
    conn: Any,
    *,
    user_id: str | None = None,
    email: str | None = None,
    handle: str | None = None,
) -> Any | None:
    uid = str(user_id or "").strip()
    email_q = str(email or "").strip().lower()
    handle_q = str(handle or "").strip().lstrip("@")
    cols = _user_columns(conn)
    select = "id, email, display_name"
    if "handle" in cols:
        select += ", handle"
    if "avatar_url" in cols:
        select += ", avatar_url"
    if uid:
        return conn.execute(f"SELECT {select} FROM users WHERE id=?", (uid,)).fetchone()
    if email_q:
        return conn.execute(
            f"SELECT {select} FROM users WHERE lower(email)=?",
            (email_q,),
        ).fetchone()
    if handle_q and "handle" in cols:
        return conn.execute(
            f"SELECT {select} FROM users WHERE lower(COALESCE(handle,''))=lower(?)",
            (handle_q,),
        ).fetchone()
    return None


def _person_from_user_row(row: Any, *, granted: bool = True, daily_limit_usd: Any = None) -> dict[str, Any]:
    uid = str(row["id"] if "id" in row.keys() else row["user_id"])
    handle = ""
    try:
        handle = str(row["handle"] or "").strip()
    except (KeyError, IndexError):
        handle = ""
    avatar = ""
    try:
        avatar = str(row["avatar_url"] or "").strip()
    except (KeyError, IndexError):
        avatar = ""
    return {
        "id": uid,
        "user_id": uid,
        "display_name": str(row["display_name"] or row["email"] or "Person"),
        "email": str(row["email"] or "").strip().lower() or None,
        "handle": handle or None,
        "handle_label": f"@{handle}" if handle else None,
        "avatar_url": avatar or (f"/api/users/{uid}/avatar" if uid else None),
        "granted": bool(granted),
        "is_owner": False,
        "workspace_member": False,
        "daily_limit_usd": _as_limit(daily_limit_usd),
    }


def list_personal_people(owner_user_id: str) -> list[dict[str, Any]]:
    """People who can use this ChatGPT login without joining a workspace."""
    oid = str(owner_user_id or "").strip()
    if not oid:
        return []
    with get_conn() as conn:
        ensure_tables(conn)
        cols = _user_columns(conn)
        extra = ""
        extra += ", u.handle" if "handle" in cols else ""
        extra += ", u.avatar_url" if "avatar_url" in cols else ""
        rows = conn.execute(
            f"""
            SELECT p.id AS grant_id, p.user_id, p.granted, p.daily_limit_usd, p.created_at,
                   u.display_name, u.email{extra}
              FROM personal_chatgpt_people p
              JOIN users u ON u.id = p.user_id
             WHERE p.owner_user_id = ?
             ORDER BY lower(u.display_name), lower(u.email)
            """,
            (oid,),
        ).fetchall()
    out = []
    for row in rows:
        person = _person_from_user_row(row, granted=bool(row["granted"]), daily_limit_usd=row["daily_limit_usd"])
        person["grant_id"] = row["grant_id"]
        person["created_at"] = row["created_at"]
        out.append(person)
    return out


def list_personal_received(user_id: str) -> list[dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return []
    with get_conn() as conn:
        ensure_tables(conn)
        rows = conn.execute(
            """
            SELECT p.id, p.owner_user_id, p.daily_limit_usd, u.display_name AS owner_name
              FROM personal_chatgpt_people p
              JOIN users u ON u.id = p.owner_user_id
             WHERE p.user_id = ?
               AND p.granted = 1
             ORDER BY p.created_at ASC
            """,
            (uid,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "granted": True,
            "owner_user_id": r["owner_user_id"],
            "owner_name": r["owner_name"],
            "daily_limit_usd": _as_limit(r["daily_limit_usd"]),
            "owner_signed_in": _signed_in(r["owner_user_id"]),
            "kind": "personal",
        }
        for r in rows
    ]


def _is_team_member_of_owner(conn: Any, owner_user_id: str, user_id: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
          FROM team_members a
          JOIN team_members b ON a.team_id = b.team_id
         WHERE a.user_id = ? AND b.user_id = ?
         LIMIT 1
        """,
        (owner_user_id, user_id),
    ).fetchone()
    return bool(row)


def add_personal_person(
    owner_user_id: str,
    *,
    email: str | None = None,
    handle: str | None = None,
    user_id: str | None = None,
    daily_limit_usd: float | None = None,
    confirm_new_collaborator: bool = False,
) -> dict[str, Any]:
    """Grant ChatGPT login access to a registered user without adding them to a workspace."""
    oid = str(owner_user_id or "").strip()
    if not oid:
        raise ValueError("Owner is required")
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        found = _find_registered_user(conn, user_id=user_id, email=email, handle=handle)
        if not found:
            raise ValueError("This user doesn't exist")
        target_id = str(found["id"])
        if target_id == oid:
            raise ValueError("You are already the owner of this login")
        existing = conn.execute(
            "SELECT id, granted, daily_limit_usd FROM personal_chatgpt_people WHERE owner_user_id=? AND user_id=?",
            (oid, target_id),
        ).fetchone()
        if existing:
            return {
                "status": "already_added",
                "person": _person_from_user_row(
                    found,
                    granted=bool(existing["granted"]),
                    daily_limit_usd=existing["daily_limit_usd"],
                ),
            }
        from backend.services.teams_service import have_shared_workspace

        if not confirm_new_collaborator and not have_shared_workspace(oid, target_id):
            person = _person_from_user_row(found, granted=True, daily_limit_usd=daily_limit_usd)
            label = person.get("handle_label") or person.get("display_name")
            return {
                "status": "needs_confirm",
                "person": person,
                "user": person,
                "message": f"Add {label} as a person (not to a workspace) so they can use this ChatGPT login?",
            }
        grant_id = str(uuid.uuid4())[:8]
        conn.execute(
            """
            INSERT INTO personal_chatgpt_people
                (id, owner_user_id, user_id, granted, daily_limit_usd, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?)
            """,
            (grant_id, oid, target_id, daily_limit_usd, now, now),
        )
        member = conn.execute(
            """
            SELECT 1 FROM team_members a
              JOIN team_members b ON a.team_id = b.team_id
             WHERE a.user_id = ? AND b.user_id = ?
             LIMIT 1
            """,
            (oid, target_id),
        ).fetchone()
        person = _person_from_user_row(found, granted=True, daily_limit_usd=daily_limit_usd)
        person["grant_id"] = grant_id
        person["workspace_member"] = bool(member)
        return {"status": "added", "person": person, "chatgpt_granted": True}


def remove_personal_person(owner_user_id: str, target_user_id: str) -> dict[str, Any]:
    oid = str(owner_user_id or "").strip()
    tid = str(target_user_id or "").strip()
    if not oid or not tid:
        raise ValueError("Person is required")
    with get_conn() as conn:
        ensure_tables(conn)
        cur = conn.execute(
            "DELETE FROM personal_chatgpt_people WHERE owner_user_id=? AND user_id=?",
            (oid, tid),
        )
        if not cur.rowcount:
            raise ValueError("That person is not on your People list")
    return {"ok": True, "removed_user_id": tid}


def set_personal_person_access(
    owner_user_id: str,
    target_user_id: str,
    *,
    granted: bool | None = None,
    daily_limit_usd: float | None = None,
    daily_limit_provided: bool = False,
) -> list[dict[str, Any]]:
    if granted is None and not daily_limit_provided:
        raise ValueError("granted or daily_limit_usd is required")
    oid = str(owner_user_id or "").strip()
    tid = str(target_user_id or "").strip()
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        current = conn.execute(
            "SELECT granted, daily_limit_usd FROM personal_chatgpt_people WHERE owner_user_id=? AND user_id=?",
            (oid, tid),
        ).fetchone()
        if not current:
            raise ValueError("That person is not on your People list")
        next_granted = (1 if granted else 0) if granted is not None else int(current["granted"] or 0)
        next_limit = daily_limit_usd if daily_limit_provided else current["daily_limit_usd"]
        conn.execute(
            """
            UPDATE personal_chatgpt_people
               SET granted=?, daily_limit_usd=?, updated_at=?
             WHERE owner_user_id=? AND user_id=?
            """,
            (next_granted, next_limit, now, oid, tid),
        )
    return list_personal_people(oid)


def is_workspace_member_of_owner(owner_user_id: str, user_id: str) -> bool:
    with get_conn() as conn:
        return _is_team_member_of_owner(conn, owner_user_id, user_id)


def list_share_members(team_id: str, share_id: str, requester_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT owner_user_id FROM team_shared_chatgpt WHERE id=? AND team_id=?",
            (share_id, team_id),
        ).fetchone()
        if not row:
            raise ValueError("Shared ChatGPT login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError("Only the owner can manage who uses this ChatGPT login")
        members = conn.execute(
            """
            SELECT tm.user_id, u.display_name, u.email, u.handle, u.avatar_url, tm.role,
                   CASE WHEN tm.user_id = ? THEN 1 ELSE COALESCE(g.granted, 0) END AS granted,
                   g.daily_limit_usd AS daily_limit_usd
              FROM team_members tm
              JOIN users u ON u.id = tm.user_id
              LEFT JOIN team_chatgpt_grants g ON g.share_id = ? AND g.user_id = tm.user_id
             WHERE tm.team_id = ?
             ORDER BY u.display_name
            """,
            (row["owner_user_id"], share_id, team_id),
        ).fetchall()
    return [
        {
            "id": m["user_id"],
            "user_id": m["user_id"],
            "display_name": m["display_name"],
            "email": m["email"],
            "handle": (m["handle"] or "").strip() or None,
            "handle_label": f"@{m['handle']}" if (m["handle"] or "").strip() else None,
            "avatar_url": m["avatar_url"] or (f"/api/users/{m['user_id']}/avatar" if m["user_id"] else None),
            "role": m["role"],
            "granted": bool(m["granted"]),
            "is_owner": m["user_id"] == row["owner_user_id"],
            "daily_limit_usd": None if m["user_id"] == row["owner_user_id"] else _as_limit(m["daily_limit_usd"]),
        }
        for m in members
    ]


def set_member_access(
    team_id: str,
    share_id: str,
    target_user_id: str,
    *,
    requester_id: str,
    granted: bool | None = None,
    daily_limit_usd: float | None = None,
    daily_limit_provided: bool = False,
) -> list[dict[str, Any]]:
    if granted is None and not daily_limit_provided:
        raise ValueError("granted or daily_limit_usd is required")
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT owner_user_id FROM team_shared_chatgpt WHERE id=? AND team_id=?",
            (share_id, team_id),
        ).fetchone()
        if not row:
            raise ValueError("Shared ChatGPT login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError("Only the owner can manage who uses this ChatGPT login")
        if target_user_id == row["owner_user_id"]:
            return list_share_members(team_id, share_id, requester_id)
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not member:
            raise ValueError("That person is not on this team")
        current = conn.execute(
            "SELECT granted, daily_limit_usd FROM team_chatgpt_grants WHERE share_id=? AND user_id=?",
            (share_id, target_user_id),
        ).fetchone()
        next_granted = (1 if granted else 0) if granted is not None else int(current["granted"] if current else 0)
        next_limit = daily_limit_usd if daily_limit_provided else (
            current["daily_limit_usd"] if current else None
        )
        conn.execute(
            """
            INSERT INTO team_chatgpt_grants (share_id, user_id, granted, updated_by, updated_at, daily_limit_usd)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(share_id, user_id) DO UPDATE SET
                granted = excluded.granted,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at,
                daily_limit_usd = excluded.daily_limit_usd
            """,
            (share_id, target_user_id, next_granted, requester_id, now, next_limit),
        )
    return list_share_members(team_id, share_id, requester_id)


def grant_team_chatgpt_to_member(
    team_id: str,
    target_user_id: str,
    requester_id: str,
) -> list[str]:
    """Turn on every ChatGPT login the requester can share on this workspace."""
    granted_ids: list[str] = []
    with get_conn() as conn:
        ensure_tables(conn)
        is_owner = _is_team_owner(conn, team_id, requester_id)
        shares = conn.execute(
            "SELECT id, owner_user_id FROM team_shared_chatgpt WHERE team_id=?",
            (team_id,),
        ).fetchall()
    for share in shares:
        if share["owner_user_id"] == target_user_id:
            continue
        if share["owner_user_id"] != requester_id and not is_owner:
            continue
        set_member_access(
            team_id,
            share["id"],
            target_user_id,
            granted=True,
            requester_id=requester_id,
        )
        granted_ids.append(str(share["id"]))
    return granted_ids


def listing_for_user(user_id: str) -> dict[str, Any]:
    """Owned + received ChatGPT shares for the Subscriptions panel."""
    uid = str(user_id or "").strip()
    owned: list[dict[str, Any]] = []
    received: list[dict[str, Any]] = []
    if not uid:
        return {"owned": owned, "received": received}
    with get_conn() as conn:
        ensure_tables(conn)
        teams = conn.execute(
            """
            SELECT t.id, t.name
              FROM team_members tm
              JOIN teams t ON t.id = tm.team_id
             WHERE tm.user_id = ?
             ORDER BY t.name
            """,
            (uid,),
        ).fetchall()
        team_ids = [t["id"] for t in teams]
        rows = conn.execute(
            """
            SELECT s.id, s.team_id, s.owner_user_id, s.created_at, t.name AS team_name,
                   u.display_name AS owner_name
              FROM team_shared_chatgpt s
              JOIN teams t ON t.id = s.team_id
              JOIN users u ON u.id = s.owner_user_id
             WHERE s.team_id IN ({})
            """.format(",".join("?" * len(team_ids)) if team_ids else "''"),
            team_ids,
        ).fetchall() if team_ids else []
        grant_rows = conn.execute(
            "SELECT share_id, granted FROM team_chatgpt_grants WHERE user_id = ?",
            (uid,),
        ).fetchall()
        granted_map = {g["share_id"]: bool(g["granted"]) for g in grant_rows}
        for row in rows:
            item = {
                "id": row["id"],
                "team_id": row["team_id"],
                "team_name": row["team_name"],
                "owner_user_id": row["owner_user_id"],
                "owner_name": row["owner_name"],
                "created_at": row["created_at"],
                "owner_signed_in": _signed_in(row["owner_user_id"]),
            }
            if row["owner_user_id"] == uid:
                owned.append(item)
            elif granted_map.get(row["id"]):
                received.append({**item, "granted": True})
    return {
        "owned": owned,
        "received": received,
        "signed_in": _signed_in(uid),
        "personal_people": list_personal_people(uid),
        "personal_received": list_personal_received(uid),
    }


def status_rows_for_user(user_id: str) -> list[dict[str, Any]]:
    """Rows for Manage AI keys — owned shares plus ChatGPT logins granted to you."""
    listing = listing_for_user(user_id)
    rows: list[dict[str, Any]] = []
    for item in listing.get("owned") or []:
        rows.append(
            {
                **item,
                "is_owner": True,
                "granted": True,
                "can_manage": True,
                "name": f"ChatGPT · {item.get('team_name') or 'workspace'}",
            }
        )
    for item in [*(listing.get("received") or []), *(listing.get("personal_received") or [])]:
        rows.append(
            {
                **item,
                "is_owner": False,
                "granted": True,
                "can_manage": False,
                "name": f"ChatGPT · {item.get('owner_name') or 'teammate'}",
            }
        )
    return rows
