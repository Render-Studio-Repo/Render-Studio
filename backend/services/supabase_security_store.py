"""Supabase-backed security ledger for free-trial anti-abuse.

When SUPABASE_URL + SUPABASE_SECRET_KEY are set, IP claims / weekly grant counts /
pool / waitlist use Supabase as the source of truth (harder to tamper with than
local SQLite alone). Local SQLite remains a mirror for offline/admin reads.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.services import supabase_client

logger = logging.getLogger("render3d.supabase_security")


def enabled() -> bool:
    return supabase_client.configured()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb():
    return supabase_client.get_admin_client()


def ip_owner(ip: str) -> str | None:
    ip = str(ip or "").strip()
    if not ip or not enabled():
        return None
    try:
        res = _sb().table("render_trial_ips").select("user_id").eq("ip", ip).limit(1).execute()
        rows = res.data or []
        if not rows:
            return None
        return str(rows[0].get("user_id") or "") or None
    except Exception:
        logger.warning("Supabase ip_owner failed", exc_info=True)
        return None


def claim_ip(ip: str, user_id: str, *, granted_at: str | None = None) -> bool:
    """Insert IP claim. Returns False if owned by another user."""
    ip = str(ip or "").strip()
    user_id = str(user_id or "").strip()
    if not ip or not user_id or not enabled():
        return True  # no-op success when disabled
    owner = ip_owner(ip)
    if owner and owner != user_id:
        return False
    if owner == user_id:
        return True
    try:
        _sb().table("render_trial_ips").upsert(
            {
                "ip": ip,
                "user_id": user_id,
                "granted_at": granted_at or _now_iso(),
            },
            on_conflict="ip",
        ).execute()
        # Re-read in case of race
        owner2 = ip_owner(ip)
        return not owner2 or owner2 == user_id
    except Exception:
        logger.warning("Supabase claim_ip failed", exc_info=True)
        return True  # fall back to local sqlite enforcement


def company_grants_since(since_iso: str) -> int | None:
    """Count non-pool trial grants since timestamp. None if Supabase unavailable."""
    if not enabled():
        return None
    try:
        res = (
            _sb()
            .table("render_trial_grants")
            .select("id, from_pool, created_at")
            .gte("created_at", since_iso)
            .execute()
        )
        rows = res.data or []
        return sum(1 for r in rows if not r.get("from_pool"))
    except Exception:
        logger.warning("Supabase company_grants_since failed", exc_info=True)
        return None


def record_grant(
    *,
    user_id: str,
    amount_cents: int,
    from_pool: bool,
    client_ip: str | None,
    meta: dict[str, Any] | None = None,
) -> None:
    if not enabled():
        return
    try:
        _sb().table("render_trial_grants").insert(
            {
                "user_id": user_id,
                "amount_cents": int(amount_cents),
                "from_pool": bool(from_pool),
                "client_ip": client_ip,
                "created_at": _now_iso(),
                "meta": meta or {},
            }
        ).execute()
    except Exception:
        logger.warning("Supabase record_grant failed", exc_info=True)


def record_reclaim(*, user_id: str, amount_cents: int, meta: dict[str, Any] | None = None) -> None:
    if not enabled():
        return
    try:
        _sb().table("render_trial_reclaims").insert(
            {
                "user_id": user_id,
                "amount_cents": int(amount_cents),
                "created_at": _now_iso(),
                "meta": meta or {},
            }
        ).execute()
    except Exception:
        logger.warning("Supabase record_reclaim failed", exc_info=True)


def get_pool_cents() -> int | None:
    if not enabled():
        return None
    try:
        res = _sb().table("render_trial_pool").select("balance_cents").eq("id", 1).limit(1).execute()
        rows = res.data or []
        if not rows:
            return 0
        return int(rows[0].get("balance_cents") or 0)
    except Exception:
        logger.warning("Supabase get_pool_cents failed", exc_info=True)
        return None


def add_pool_cents(amount: int) -> int | None:
    if not enabled() or amount == 0:
        return get_pool_cents()
    try:
        current = get_pool_cents() or 0
        nxt = max(0, current + int(amount))
        _sb().table("render_trial_pool").upsert(
            {"id": 1, "balance_cents": nxt, "updated_at": _now_iso()}
        ).execute()
        return nxt
    except Exception:
        logger.warning("Supabase add_pool_cents failed", exc_info=True)
        return None


def try_debit_pool(amount: int) -> bool:
    """Atomically-ish debit pool if balance allows. Best-effort under concurrent load."""
    if not enabled():
        return False
    amount = int(amount)
    try:
        current = get_pool_cents()
        if current is None or current < amount:
            return False
        nxt = current - amount
        _sb().table("render_trial_pool").upsert(
            {"id": 1, "balance_cents": nxt, "updated_at": _now_iso()}
        ).execute()
        # Verify
        after = get_pool_cents()
        if after is not None and after < 0:
            add_pool_cents(amount)
            return False
        return True
    except Exception:
        logger.warning("Supabase try_debit_pool failed", exc_info=True)
        return False


def enqueue_waitlist(user_id: str, ip: str | None) -> None:
    if not enabled():
        return
    try:
        _sb().table("render_trial_waitlist").upsert(
            {
                "user_id": user_id,
                "ip": ip,
                "created_at": _now_iso(),
            },
            on_conflict="user_id",
        ).execute()
    except Exception:
        logger.warning("Supabase enqueue_waitlist failed", exc_info=True)


def remove_waitlist(user_id: str) -> None:
    if not enabled():
        return
    try:
        _sb().table("render_trial_waitlist").delete().eq("user_id", user_id).execute()
    except Exception:
        logger.warning("Supabase remove_waitlist failed", exc_info=True)


def next_waitlisted() -> dict[str, Any] | None:
    if not enabled():
        return None
    try:
        res = (
            _sb()
            .table("render_trial_waitlist")
            .select("user_id, ip, created_at")
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        logger.warning("Supabase next_waitlisted failed", exc_info=True)
        return None


def ping() -> dict[str, Any]:
    """Health check used after URL is configured."""
    if not enabled():
        return {"ok": False, "error": "not_configured", **supabase_client.status()}
    try:
        res = _sb().table("render_trial_pool").select("id, balance_cents").eq("id", 1).limit(1).execute()
        return {"ok": True, "pool": (res.data or [None])[0], **supabase_client.status()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], **supabase_client.status()}
