"""Provider-scoped personal CLI subscription grants; credentials stay with the owner."""
from __future__ import annotations

import math
import uuid
from contextlib import contextmanager
from typing import Any

from backend.database import get_conn
from backend.services import chatgpt_share_service as people


@contextmanager
def _connection():
    conn = get_conn()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _provider(provider: str) -> str:
    from backend.services.subscription_share_service import normalize_provider
    return normalize_provider(provider)


def ensure_tables(conn: Any) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS personal_cli_login_grants (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        granted INTEGER NOT NULL DEFAULT 1,
        daily_limit_usd REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, owner_user_id, user_id)
    )""")


def _limit(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError("Daily limit must be a number") from exc
    if not math.isfinite(number) or number < 0:
        raise ValueError("Daily limit must be a finite non-negative number")
    return number


def list_personal_people(owner_user_id: str, provider: str) -> list[dict[str, Any]]:
    pid = _provider(provider)
    with _connection() as conn:
        ensure_tables(conn)
        rows = conn.execute("""SELECT id, user_id, granted, daily_limit_usd, created_at
            FROM personal_cli_login_grants WHERE owner_user_id=? AND provider=? ORDER BY created_at""",
            (owner_user_id, pid)).fetchall()
        result = []
        for row in rows:
            user = people._find_registered_user(conn, user_id=row["user_id"])
            if user:
                result.append({**people._person_from_user_row(user, granted=bool(row["granted"]),
                    daily_limit_usd=row["daily_limit_usd"]), "grant_id": row["id"],
                    "provider": pid, "created_at": row["created_at"]})
        return result


def list_personal_received(user_id: str, provider: str) -> list[dict[str, Any]]:
    from backend.services.subscription_share_service import _signed_in
    pid = _provider(provider)
    with _connection() as conn:
        ensure_tables(conn)
        rows = conn.execute("""SELECT p.id, p.owner_user_id, p.daily_limit_usd, u.display_name AS owner_name
            FROM personal_cli_login_grants p JOIN users u ON u.id=p.owner_user_id
            WHERE p.user_id=? AND p.provider=? AND p.granted=1 ORDER BY p.created_at""",
            (user_id, pid)).fetchall()
    return [{**dict(row), "provider": pid, "kind": "personal", "granted": True,
             "owner_signed_in": _signed_in(pid, row["owner_user_id"])} for row in rows]


def add_personal_person(owner_user_id: str, provider: str, *, email: str | None = None,
        handle: str | None = None, user_id: str | None = None,
        daily_limit_usd: float | None = None, confirm_new_collaborator: bool = False) -> dict[str, Any]:
    from backend.services.subscription_share_service import LABELS, _signed_in
    from backend.services.teams_service import have_shared_workspace
    pid = _provider(provider)
    limit = _limit(daily_limit_usd)
    if not owner_user_id or not _signed_in(pid, owner_user_id):
        raise ValueError(f"Sign in with {LABELS[pid]} before sharing your subscription.")
    with _connection() as conn:
        ensure_tables(conn)
        user = people._find_registered_user(conn, user_id=user_id, email=email, handle=handle)
        if not user:
            raise ValueError("This user doesn't exist")
        target = str(user["id"])
        if target == owner_user_id:
            raise ValueError("You are already the owner of this login")
        existing = conn.execute("""SELECT granted, daily_limit_usd FROM personal_cli_login_grants
            WHERE provider=? AND owner_user_id=? AND user_id=?""", (pid, owner_user_id, target)).fetchone()
        if existing:
            return {"status": "already_added", "person": people._person_from_user_row(user,
                granted=bool(existing["granted"]), daily_limit_usd=existing["daily_limit_usd"])}
        person = people._person_from_user_row(user, daily_limit_usd=limit)
        if not confirm_new_collaborator and not have_shared_workspace(owner_user_id, target):
            return {"status": "needs_confirm", "person": person, "user": person,
                "message": f"Add {person['display_name']} so they can use your {LABELS[pid]} subscription?"}
        grant_id, now = str(uuid.uuid4()), people._now()
        conn.execute("""INSERT INTO personal_cli_login_grants
            (id, provider, owner_user_id, user_id, granted, daily_limit_usd, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)""", (grant_id, pid, owner_user_id, target, limit, now, now))
    return {"status": "added", "person": {**person, "grant_id": grant_id, "provider": pid},
            "provider": pid, "granted": True}


def set_personal_person_access(owner_user_id: str, provider: str, target_user_id: str, *,
        granted: bool | None = None, daily_limit_usd: float | None = None,
        daily_limit_provided: bool = False) -> list[dict[str, Any]]:
    pid = _provider(provider)
    if granted is None and not daily_limit_provided:
        raise ValueError("granted or daily_limit_usd is required")
    limit = _limit(daily_limit_usd) if daily_limit_provided else None
    with _connection() as conn:
        ensure_tables(conn)
        row = conn.execute("""SELECT granted, daily_limit_usd FROM personal_cli_login_grants
            WHERE owner_user_id=? AND user_id=? AND provider=?""",
            (owner_user_id, target_user_id, pid)).fetchone()
        if not row:
            raise ValueError("That person is not on your People list")
        conn.execute("""UPDATE personal_cli_login_grants SET granted=?, daily_limit_usd=?, updated_at=?
            WHERE owner_user_id=? AND user_id=? AND provider=?""",
            (int(granted) if granted is not None else row["granted"],
             limit if daily_limit_provided else row["daily_limit_usd"], people._now(),
             owner_user_id, target_user_id, pid))
    return list_personal_people(owner_user_id, pid)


def remove_personal_person(owner_user_id: str, provider: str, target_user_id: str) -> dict[str, Any]:
    pid = _provider(provider)
    with _connection() as conn:
        ensure_tables(conn)
        cursor = conn.execute("DELETE FROM personal_cli_login_grants WHERE owner_user_id=? AND user_id=? AND provider=?",
            (owner_user_id, target_user_id, pid))
        if not cursor.rowcount:
            raise ValueError("That person is not on your People list")
    return {"ok": True, "removed_user_id": target_user_id}


def resolve_owner(user_id: str, provider: str, spent_today_usd: float | None) -> dict[str, Any] | None:
    blocked = None
    for grant in list_personal_received(user_id, provider):
        if not grant["owner_signed_in"]:
            continue
        limit = grant["daily_limit_usd"]
        if limit is not None and (spent_today_usd is None or spent_today_usd >= limit):
            blocked = {"owner_user_id": None, "kind": "daily_limit", "owner_name": grant["owner_name"],
                "share_id": grant["id"], "daily_limit_usd": limit,
                "spent_today_usd": spent_today_usd, "source": "personal"}
            continue
        return {"owner_user_id": grant["owner_user_id"], "kind": "personal",
            "owner_name": grant["owner_name"], "share_id": grant["id"], "daily_limit_usd": limit}
    return blocked
