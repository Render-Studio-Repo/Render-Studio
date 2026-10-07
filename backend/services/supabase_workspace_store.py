"""Supabase Teams / OAuth / credits / team keys — live path when USERS_BACKEND=supabase.

SQLite stays on disk as a dual-write backup. Never logs ciphertext, tokens, or hashes.
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.database import get_conn
from backend.services import supabase_client

logger = logging.getLogger("render3d.supabase_workspace")

WORKSPACE_SQL = (
    Path(__file__).resolve().parents[2]
    / "integrations"
    / "supabase"
    / "migrations"
    / "005_workspace_oauth_credits.sql"
)

TEAMS = "Teams"
MEMBERS = "TeamMembers"
INVITES = "TeamInvites"
ACCESS = "ProjectAccess"
TEAM_KEYS = "TeamKeys"
GRANTS = "TeamKeyGrants"
OPTS = "UserTeamKeyOpts"
OAUTH = "OAuthTokens"
CREDITS = "CreditAccounts"
TX = "CreditTransactions"

_FERNET_PREFIX = "gAAAA"

# Only enabled around a single read-only project response. Never retain access
# decisions between requests: membership revocations must take effect next time.
_permission_reads: ContextVar[dict | None] = ContextVar("workspace_permission_reads", default=None)


@contextmanager
def permission_read_scope():
    token = _permission_reads.set({})
    try:
        yield
    finally:
        _permission_reads.reset(token)


def _permission_row(table: str, **filters: str) -> dict[str, Any] | None:
    cache = _permission_reads.get()
    key = (table, tuple(sorted(filters.items())))
    if cache is not None and key in cache:
        return deepcopy(cache[key])
    rows = _select(table, **filters)
    row = rows[0] if rows else None
    if cache is not None:
        cache[key] = deepcopy(row)
    return row


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb():
    return supabase_client.get_admin_client()


def enabled() -> bool:
    return supabase_client.configured()


def live() -> bool:
    """True when origin should read/write these tables on Supabase (no sqlite live fallback)."""
    try:
        from backend.services import supabase_users_store as sbusers

        return bool(sbusers.prefer_supabase() and enabled())
    except Exception:
        return False


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(int(value))
    raw = str(value).strip().lower()
    if raw in {"1", "true", "t", "yes"}:
        return True
    if raw in {"0", "false", "f", "no", ""}:
        return False
    return default


def _encrypt(value: str | None) -> str | None:
    raw = str(value or "")
    if not raw:
        return None
    if raw.startswith(_FERNET_PREFIX):
        return raw
    from backend.services.user_ai_keys_service import _encrypt as _fernet_encrypt

    return _fernet_encrypt(raw)


def _decrypt(value: str | None) -> str | None:
    raw = str(value or "")
    if not raw:
        return None
    from backend.services.user_ai_keys_service import _decrypt as _fernet_decrypt

    plain = _fernet_decrypt(raw)
    return plain if plain is not None else raw


def _row(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return dict(obj)
    try:
        return {k: obj[k] for k in obj.keys()}
    except Exception:
        return dict(obj)


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return bool(row)


def _cols(conn, table: str) -> set[str]:
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def ensure_remote_schema() -> dict[str, Any]:
    if not supabase_client.management_configured():
        return {"ok": False, "error": "no_access_token"}
    if not WORKSPACE_SQL.is_file():
        return {"ok": False, "error": "missing_sql"}
    from backend.services.supabase_users_store import _sql_statements

    sql = WORKSPACE_SQL.read_text(encoding="utf-8")
    result = supabase_client.run_management_sql(sql)
    if result.get("ok"):
        return {"ok": True, "file": WORKSPACE_SQL.name, "split": False}
    failed = 0
    for chunk in _sql_statements(sql):
        one = supabase_client.run_management_sql(chunk + ";")
        if not one.get("ok"):
            failed += 1
    return {
        "ok": failed == 0,
        "file": WORKSPACE_SQL.name,
        "split": True,
        "error": None if failed == 0 else f"{failed}_statements_failed",
    }


def _upsert(table: str, body: dict[str, Any], on_conflict: str) -> bool:
    if not enabled() or not body:
        return False
    try:
        _sb().table(table).upsert(body, on_conflict=on_conflict).execute()
        return True
    except Exception:
        logger.warning("workspace upsert failed table=%s", table, exc_info=True)
        return False


def _delete_eq(table: str, **eq: Any) -> bool:
    if not enabled():
        return False
    try:
        q = _sb().table(table).delete()
        for key, val in eq.items():
            q = q.eq(key, val)
        q.execute()
        return True
    except Exception:
        logger.warning("workspace delete failed table=%s", table, exc_info=True)
        return False


def _select(table: str, columns: str = "*", **filters: Any) -> list[dict[str, Any]]:
    if not enabled():
        return []
    try:
        q = _sb().table(table).select(columns)
        for key, val in filters.items():
            if val is None:
                continue
            q = q.eq(key, val)
        res = q.execute()
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("workspace select failed table=%s", table, exc_info=True)
        return []


# ── Teams / membership / project access ───────────────────────────────────────


def upsert_team(row: dict[str, Any]) -> bool:
    body = {
        "id": str(row.get("id") or ""),
        "name": str(row.get("name") or ""),
        "created_by": str(row.get("created_by") or ""),
        "created_at": row.get("created_at") or _now(),
        "render_folder_provider": row.get("render_folder_provider") or "render3d",
        "render_folder_ref": row.get("render_folder_ref"),
        "render_folder_label": row.get("render_folder_label"),
        "render_folder_connected_at": row.get("render_folder_connected_at"),
    }
    if not body["id"]:
        return False
    return _upsert(TEAMS, body, "id")


def upsert_member(row: dict[str, Any]) -> bool:
    body = {
        "team_id": str(row.get("team_id") or ""),
        "user_id": str(row.get("user_id") or ""),
        "role": str(row.get("role") or "user"),
        "joined_at": row.get("joined_at") or _now(),
        "can_invite": _as_bool(row.get("can_invite"), False),
        "access": str(row.get("access") or "edit"),
        "can_export": _as_bool(row.get("can_export"), True),
        "can_access_tools": _as_bool(row.get("can_access_tools"), True),
        "explorer_visible": _as_bool(row.get("explorer_visible"), True),
    }
    if not body["team_id"] or not body["user_id"]:
        return False
    return _upsert(MEMBERS, body, "team_id,user_id")


def upsert_invite(row: dict[str, Any]) -> bool:
    body = {
        "id": str(row.get("id") or ""),
        "team_id": str(row.get("team_id") or ""),
        "email": str(row.get("email") or "").strip().lower(),
        "invited_by": str(row.get("invited_by") or ""),
        "status": str(row.get("status") or "pending"),
        "token": row.get("token"),
        "grant_chatgpt": _as_bool(row.get("grant_chatgpt"), False),
        "grant_openai": _as_bool(row.get("grant_openai") or row.get("grant_openai_keys"), False),
        "created_at": row.get("created_at") or _now(),
    }
    if not body["id"]:
        return False
    return _upsert(INVITES, body, "id")


def upsert_project_access(row: dict[str, Any]) -> bool:
    body = {
        "project_id": str(row.get("project_id") or ""),
        "team_id": str(row.get("team_id") or ""),
        "folder_id": row.get("folder_id"),
        "sort_order": int(row.get("sort_order") or 0),
        "is_public": _as_bool(row.get("is_public"), False),
        "public_pinned": _as_bool(row.get("public_pinned"), False),
        "created_by": row.get("created_by"),
        "created_at": row.get("created_at") or _now(),
    }
    if not body["project_id"] or not body["team_id"]:
        return False
    return _upsert(ACCESS, body, "project_id")


def get_member(team_id: str, user_id: str) -> dict[str, Any] | None:
    return _permission_row(MEMBERS, team_id=team_id, user_id=user_id)


def list_members(team_id: str) -> list[dict[str, Any]]:
    return _select(MEMBERS, team_id=team_id)


def list_user_memberships(user_id: str) -> list[dict[str, Any]]:
    return _select(MEMBERS, user_id=user_id)


def get_team(team_id: str) -> dict[str, Any] | None:
    rows = _select(TEAMS, id=team_id)
    return rows[0] if rows else None


def list_teams_for_user(user_id: str) -> list[dict[str, Any]]:
    memberships = list_user_memberships(user_id)
    if not memberships:
        return []
    ids = [str(m.get("team_id") or "") for m in memberships if m.get("team_id")]
    teams_by_id: dict[str, dict[str, Any]] = {}
    try:
        res = _sb().table(TEAMS).select("*").in_("id", ids).execute()
        for row in res.data or []:
            if isinstance(row, dict) and row.get("id"):
                teams_by_id[str(row["id"])] = row
    except Exception:
        logger.warning("list_teams_for_user teams fetch failed", exc_info=True)
    counts: dict[str, int] = {}
    try:
        res = _sb().table(MEMBERS).select("team_id").in_("team_id", ids).execute()
        for row in res.data or []:
            tid = str((row or {}).get("team_id") or "")
            if tid:
                counts[tid] = counts.get(tid, 0) + 1
    except Exception:
        logger.warning("list_teams_for_user count failed", exc_info=True)
    out: list[dict[str, Any]] = []
    for mem in memberships:
        tid = str(mem.get("team_id") or "")
        team = teams_by_id.get(tid) or {}
        if not team:
            continue
        item = dict(team)
        item.update(mem)
        item["id"] = tid
        item["member_count"] = counts.get(tid, 0)
        out.append(item)
    return out


def user_project_access(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    memberships = list_user_memberships(user_id)
    if team_id:
        memberships = [m for m in memberships if str(m.get("team_id")) == str(team_id)]
    mem_by_team = {str(m.get("team_id")): m for m in memberships}
    team_ids = list(mem_by_team.keys())
    if not team_ids:
        return []
    try:
        q = _sb().table(ACCESS).select("*").in_("team_id", team_ids)
        res = q.execute()
        rows = [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("user_project_access failed", exc_info=True)
        return []
    owner_ids = [str(r.get("created_by") or "") for r in rows if r.get("created_by")]
    profiles: dict[str, dict[str, Any]] = {}
    if owner_ids:
        try:
            from backend.services.supabase_users_store import USERS_TABLE

            pres = (
                _sb()
                .table(USERS_TABLE)
                .select("id,email,display_name")
                .in_("id", list(dict.fromkeys(owner_ids)))
                .execute()
            )
            for p in pres.data or []:
                if isinstance(p, dict) and p.get("id"):
                    profiles[str(p["id"])] = p
        except Exception:
            pass
    out: list[dict[str, Any]] = []
    for row in rows:
        mem = mem_by_team.get(str(row.get("team_id")) or "") or {}
        owner = profiles.get(str(row.get("created_by") or "")) or {}
        item = dict(row)
        item.update(
            {
                "role": mem.get("role"),
                "can_invite": mem.get("can_invite"),
                "access": mem.get("access"),
                "owner_email": owner.get("email"),
                "owner_name": owner.get("display_name"),
            }
        )
        out.append(item)
    return out


def project_team_id(project_id: str) -> str | None:
    row = get_project_access(project_id)
    return (str(row.get("team_id") or "") or None) if row else None


def get_project_access(project_id: str) -> dict[str, Any] | None:
    return _permission_row(ACCESS, project_id=project_id)


def team_project_ids(team_id: str) -> list[str]:
    return [str(r.get("project_id")) for r in _select(ACCESS, team_id=team_id) if r.get("project_id")]


def team_member_ids(team_id: str) -> list[str]:
    return [str(r.get("user_id")) for r in list_members(team_id) if r.get("user_id")]


def delete_project_access(project_id: str) -> bool:
    return _delete_eq(ACCESS, project_id=project_id)


def delete_member(team_id: str, user_id: str) -> bool:
    return _delete_eq(MEMBERS, team_id=team_id, user_id=user_id)


def delete_team(team_id: str) -> bool:
    _delete_eq(INVITES, team_id=team_id)
    _delete_eq(ACCESS, team_id=team_id)
    keys = list_team_keys(team_id)
    for key in keys:
        kid = str(key.get("id") or "")
        if kid:
            _delete_eq(GRANTS, key_id=kid)
            _delete_eq(OPTS, key_id=kid)
    _delete_eq(TEAM_KEYS, team_id=team_id)
    _delete_eq(MEMBERS, team_id=team_id)
    return _delete_eq(TEAMS, id=team_id)


def personal_team_id(user_id: str) -> str | None:
    memberships = list_user_memberships(user_id)
    owner_ids = [
        str(m.get("team_id"))
        for m in memberships
        if str(m.get("role") or "") in {"owner", "admin"}
    ]
    if not owner_ids:
        return None
    try:
        res = (
            _sb()
            .table(TEAMS)
            .select("id,created_by,created_at")
            .eq("created_by", user_id)
            .in_("id", owner_ids)
            .order("created_at")
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return str(rows[0].get("id") or "") or None
    except Exception:
        logger.warning("personal_team_id failed", exc_info=True)
    return owner_ids[0] if owner_ids else None


def pending_invites_for_email(email: str) -> list[dict[str, Any]]:
    if not enabled() or not email:
        return []
    try:
        res = (
            _sb()
            .table(INVITES)
            .select("*")
            .eq("email", email.strip().lower())
            .eq("status", "pending")
            .execute()
        )
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("pending_invites_for_email failed", exc_info=True)
        return []


def get_invite(invite_id: str) -> dict[str, Any] | None:
    rows = _select(INVITES, id=invite_id)
    return rows[0] if rows else None


# ── Team keys ─────────────────────────────────────────────────────────────────


def upsert_team_key(row: dict[str, Any]) -> bool:
    enc = str(row.get("api_key_enc") or "")
    if not enc:
        return False
    body = {
        "id": str(row.get("id") or ""),
        "team_id": str(row.get("team_id") or ""),
        "name": str(row.get("name") or ""),
        "provider": str(row.get("provider") or "openai"),
        "api_key_enc": enc,
        "model": str(row.get("model") or ""),
        "shared_by": str(row.get("shared_by") or ""),
        "enabled": _as_bool(row.get("enabled"), True),
        "scope_type": str(row.get("scope_type") or "all"),
        "scope_project_id": row.get("scope_project_id"),
        "scope_label": row.get("scope_label"),
        "created_at": row.get("created_at") or _now(),
    }
    if not body["id"] or not body["team_id"]:
        return False
    return _upsert(TEAM_KEYS, body, "id")


def upsert_grant(row: dict[str, Any]) -> bool:
    body = {
        "key_id": str(row.get("key_id") or ""),
        "user_id": str(row.get("user_id") or ""),
        "granted": _as_bool(row.get("granted"), False),
        "updated_by": str(row.get("updated_by") or ""),
        "updated_at": row.get("updated_at") or _now(),
    }
    if not body["key_id"] or not body["user_id"]:
        return False
    return _upsert(GRANTS, body, "key_id,user_id")


def upsert_opt(row: dict[str, Any]) -> bool:
    body = {
        "user_id": str(row.get("user_id") or ""),
        "key_id": str(row.get("key_id") or ""),
        "use_key": _as_bool(row.get("use_key"), True),
        "model": row.get("model"),
        "daily_limit_usd": row.get("daily_limit_usd"),
        "daily_token_limit": row.get("daily_token_limit"),
        "allowed_models": row.get("allowed_models"),
    }
    if not body["user_id"] or not body["key_id"]:
        return False
    return _upsert(OPTS, body, "user_id,key_id")


def list_team_keys(team_id: str) -> list[dict[str, Any]]:
    return _select(TEAM_KEYS, team_id=team_id)


def get_team_key(key_id: str) -> dict[str, Any] | None:
    rows = _select(TEAM_KEYS, id=key_id)
    return rows[0] if rows else None


def list_grants_for_keys(key_ids: list[str]) -> list[dict[str, Any]]:
    if not enabled() or not key_ids:
        return []
    try:
        res = _sb().table(GRANTS).select("*").in_("key_id", key_ids).execute()
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("list_grants_for_keys failed", exc_info=True)
        return []


def list_opts_for_keys(key_ids: list[str]) -> list[dict[str, Any]]:
    if not enabled() or not key_ids:
        return []
    try:
        res = _sb().table(OPTS).select("*").in_("key_id", key_ids).execute()
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("list_opts_for_keys failed", exc_info=True)
        return []


def list_opts_for_user(user_id: str) -> list[dict[str, Any]]:
    return _select(OPTS, user_id=user_id)


def delete_team_key(key_id: str) -> bool:
    _delete_eq(GRANTS, key_id=key_id)
    _delete_eq(OPTS, key_id=key_id)
    return _delete_eq(TEAM_KEYS, id=key_id)


def resolve_team_key_for_user(user_id: str, key_id: str | None = None) -> dict[str, Any] | None:
    """Return a granted/enabled team key row including ciphertext. Caller decrypts."""
    memberships = list_user_memberships(user_id)
    team_ids = [str(m.get("team_id")) for m in memberships if m.get("team_id")]
    if not team_ids:
        return None
    try:
        q = _sb().table(TEAM_KEYS).select("*").eq("enabled", True).in_("team_id", team_ids)
        if key_id:
            q = q.eq("id", key_id)
        res = q.execute()
        keys = [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("resolve_team_key_for_user keys failed", exc_info=True)
        return None
    if not keys:
        return None
    key_ids = [str(k.get("id")) for k in keys if k.get("id")]
    grants = {(g.get("key_id"), g.get("user_id")): _as_bool(g.get("granted")) for g in list_grants_for_keys(key_ids)}
    opts = {(o.get("key_id"), o.get("user_id")): o for o in list_opts_for_user(user_id)}
    chosen: dict[str, Any] | None = None
    for key in keys:
        kid = str(key.get("id") or "")
        owner = str(key.get("shared_by") or "") == str(user_id)
        granted = owner or grants.get((kid, user_id), False)
        if not granted:
            continue
        opt = opts.get((kid, user_id)) or {}
        if key_id:
            chosen = {**key, "opt": opt}
            break
        if _as_bool(opt.get("use_key"), False):
            chosen = {**key, "opt": opt}
            break
        if chosen is None and _as_bool(opt.get("use_key"), True):
            chosen = {**key, "opt": opt}
    return chosen


# ── OAuth ─────────────────────────────────────────────────────────────────────


def oauth_get(user_id: str, provider: str) -> dict[str, Any] | None:
    rows = _select(OAUTH, user_id=user_id, provider=provider)
    if not rows:
        return None
    row = rows[0]
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    return {
        "user_id": user_id,
        "provider": provider,
        "access_token": _decrypt(row.get("access_token_enc")),
        "refresh_token": _decrypt(row.get("refresh_token_enc")),
        "expires_at": row.get("expires_at"),
        "provider_user_id": row.get("provider_user_id") or extra.get("provider_user_id"),
        "provider_email": row.get("provider_email") or extra.get("provider_email"),
        "provider_name": row.get("provider_name") or extra.get("provider_name"),
        "extra": extra,
        "updated_at": row.get("updated_at"),
    }


def oauth_find_by_provider_user(provider: str, provider_user_id: str) -> dict[str, Any] | None:
    if not enabled() or not provider_user_id:
        return None
    try:
        res = (
            _sb()
            .table(OAUTH)
            .select("user_id,provider,provider_user_id")
            .eq("provider", provider)
            .eq("provider_user_id", provider_user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        logger.warning("oauth_find_by_provider_user failed", exc_info=True)
        return None


def oauth_upsert(
    user_id: str,
    provider: str,
    *,
    access_token: str | None = None,
    refresh_token: str | None = None,
    expires_at: str | None = None,
    provider_user_id: str | None = None,
    provider_email: str | None = None,
    provider_name: str | None = None,
    extra: dict[str, Any] | None = None,
) -> bool:
    existing = oauth_get(user_id, provider) if live() else None
    extra_out = dict(extra or {})
    if existing and existing.get("extra"):
        merged = dict(existing["extra"])
        merged.update(extra_out)
        extra_out = merged
    access_enc = _encrypt(access_token) if access_token else (None if access_token == "" else None)
    refresh_enc = _encrypt(refresh_token) if refresh_token else None
    if existing and not access_token:
        access_enc = _encrypt(existing.get("access_token"))
    if existing and not refresh_token:
        refresh_enc = _encrypt(existing.get("refresh_token"))
    body: dict[str, Any] = {
        "user_id": user_id,
        "provider": provider,
        "access_token_enc": access_enc,
        "refresh_token_enc": refresh_enc,
        "expires_at": expires_at,
        "provider_user_id": provider_user_id,
        "provider_email": provider_email,
        "provider_name": provider_name,
        "extra": extra_out,
        "updated_at": _now(),
    }
    return _upsert(OAUTH, body, "user_id,provider")


def oauth_delete(user_id: str, provider: str) -> bool:
    return _delete_eq(OAUTH, user_id=user_id, provider=provider)


# ── Credits ───────────────────────────────────────────────────────────────────


def get_credit_account(user_id: str) -> dict[str, Any] | None:
    rows = _select(CREDITS, user_id=user_id)
    return rows[0] if rows else None


def upsert_credit_account(row: dict[str, Any]) -> bool:
    uid = str(row.get("user_id") or "")
    if not uid:
        return False
    body = {
        "user_id": uid,
        "balance_cents": int(row.get("balance_cents") or 0),
        "auto_refill_enabled": _as_bool(row.get("auto_refill_enabled"), False),
        "auto_refill_threshold_cents": int(row.get("auto_refill_threshold_cents") or 500),
        "auto_refill_amount_cents": int(row.get("auto_refill_amount_cents") or 2000),
        "use_platform_key": _as_bool(row.get("use_platform_key"), False),
        "platform_provider": str(row.get("platform_provider") or "openai"),
        "platform_model": str(row.get("platform_model") or ""),
        "trial_granted_at": row.get("trial_granted_at") or None,
        "trial_popup_seen_at": row.get("trial_popup_seen_at") or None,
        "trial_email_sent_at": row.get("trial_email_sent_at") or None,
        "trial_grant_ip": row.get("trial_grant_ip") or None,
        "trial_reclaimed_at": row.get("trial_reclaimed_at") or None,
        "created_at": row.get("created_at") or _now(),
        "updated_at": row.get("updated_at") or _now(),
    }
    return _upsert(CREDITS, body, "user_id")


def upsert_credit_tx(row: dict[str, Any]) -> bool:
    meta = row.get("meta")
    if meta is None:
        raw = row.get("meta_json")
        if isinstance(raw, str):
            try:
                meta = json.loads(raw or "{}")
            except Exception:
                meta = {}
        elif isinstance(raw, dict):
            meta = raw
        else:
            meta = {}
    body = {
        "id": str(row.get("id") or ""),
        "user_id": str(row.get("user_id") or ""),
        "kind": str(row.get("kind") or ""),
        "amount_cents": int(row.get("amount_cents") or 0),
        "balance_after_cents": int(row.get("balance_after_cents") or 0),
        "provider": str(row.get("provider") or ""),
        "model": str(row.get("model") or ""),
        "project_id": row.get("project_id"),
        "stripe_session_id": row.get("stripe_session_id"),
        "meta": meta if isinstance(meta, dict) else {},
        "created_at": row.get("created_at") or _now(),
    }
    if not body["id"] or not body["user_id"]:
        return False
    return _upsert(TX, body, "id")


def list_credit_transactions(user_id: str, *, limit: int = 40) -> list[dict[str, Any]]:
    if not enabled():
        return []
    lim = max(1, min(100, int(limit or 40)))
    try:
        res = (
            _sb()
            .table(TX)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(lim)
            .execute()
        )
        return [r for r in (res.data or []) if isinstance(r, dict)]
    except Exception:
        logger.warning("list_credit_transactions failed", exc_info=True)
        return []


def last_purchase(user_id: str) -> dict[str, Any] | None:
    if not enabled():
        return None
    try:
        res = (
            _sb()
            .table(TX)
            .select("*")
            .eq("user_id", user_id)
            .in_("kind", ["purchase", "demo_purchase"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        logger.warning("last_purchase failed", exc_info=True)
        return None


def debit_credits(user_id: str, cents: int) -> dict[str, Any]:
    if not enabled():
        return {"ok": False, "error": "not_configured"}
    try:
        res = _sb().rpc("debit_credit_account", {"p_user_id": user_id, "p_cents": int(cents)}).execute()
        data = res.data
        if isinstance(data, list) and data:
            data = data[0]
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {"ok": False, "error": "bad_rpc"}
        if isinstance(data, dict):
            return data
        return {"ok": False, "error": "bad_rpc"}
    except Exception:
        logger.warning("debit_credits rpc failed", exc_info=True)
        return {"ok": False, "error": "rpc_failed"}


# ── Migrate ───────────────────────────────────────────────────────────────────


def _count(conn, table: str) -> int:
    if not _table_exists(conn, table):
        return 0
    row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
    return int(row["c"] if row else 0)


def migrate_from_sqlite() -> dict[str, Any]:
    """Idempotent upsert of sqlite workspace/oauth/credit rows. Never returns secrets."""
    counts: dict[str, int] = {}
    migrated: dict[str, int] = {}
    with get_conn() as conn:
        counts["teams"] = _count(conn, "teams")
        counts["team_members"] = _count(conn, "team_members")
        counts["team_invites"] = _count(conn, "team_invites")
        counts["project_access"] = _count(conn, "project_access")
        counts["team_shared_ai_keys"] = _count(conn, "team_shared_ai_keys")
        counts["team_key_grants"] = _count(conn, "team_key_grants")
        counts["user_team_key_opts"] = _count(conn, "user_team_key_opts")
        counts["ai_credit_accounts"] = _count(conn, "ai_credit_accounts")
        counts["ai_credit_transactions"] = _count(conn, "ai_credit_transactions")
        counts["onshape_tokens"] = _count(conn, "onshape_tokens")
        counts["autodesk_tokens"] = _count(conn, "autodesk_tokens")
        counts["twitter_oauth_tokens"] = _count(conn, "twitter_oauth_tokens")
        counts["github_tokens"] = _count(conn, "github_tokens")

        def _go(table: str, upsert_fn, mapper) -> int:
            if not _table_exists(conn, table):
                return 0
            n = 0
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            for row in rows:
                payload = mapper(_row(row))
                if payload and upsert_fn(payload):
                    n += 1
            return n

        migrated["Teams"] = _go("teams", upsert_team, lambda r: r)
        migrated["TeamMembers"] = _go("team_members", upsert_member, lambda r: r)
        migrated["TeamInvites"] = _go("team_invites", upsert_invite, lambda r: r)
        migrated["ProjectAccess"] = _go("project_access", upsert_project_access, lambda r: r)
        migrated["TeamKeys"] = _go("team_shared_ai_keys", upsert_team_key, lambda r: r)
        migrated["TeamKeyGrants"] = _go("team_key_grants", upsert_grant, lambda r: r)
        migrated["UserTeamKeyOpts"] = _go("user_team_key_opts", upsert_opt, lambda r: r)
        migrated["CreditAccounts"] = _go("ai_credit_accounts", upsert_credit_account, lambda r: r)
        migrated["CreditTransactions"] = _go("ai_credit_transactions", upsert_credit_tx, lambda r: r)

        oauth_n = 0
        for table, provider, extra_map in (
            ("onshape_tokens", "onshape", lambda r: {"onshape_user_id": r.get("onshape_user_id"), "onshape_email": r.get("onshape_email")}),
            ("autodesk_tokens", "autodesk", lambda r: {
                "autodesk_user_id": r.get("autodesk_user_id"),
                "autodesk_email": r.get("autodesk_email"),
                "autodesk_name": r.get("autodesk_name"),
            }),
            ("twitter_oauth_tokens", "twitter", lambda r: {
                "twitter_user_id": r.get("twitter_user_id"),
                "username": r.get("username"),
                "display_name": r.get("display_name"),
                "picture_url": r.get("picture_url"),
                "scope": r.get("scope"),
                "created_at": r.get("created_at"),
            }),
            ("github_tokens", "github", lambda r: {"login": r.get("login")}),
        ):
            if not _table_exists(conn, table):
                continue
            for row in conn.execute(f"SELECT * FROM {table}").fetchall():
                data = _row(row)
                uid = str(data.get("user_id") or "")
                if not uid:
                    continue
                extra = extra_map(data)
                ok = oauth_upsert(
                    uid,
                    provider,
                    access_token=str(data.get("access_token") or "") or None,
                    refresh_token=str(data.get("refresh_token") or "") or None,
                    expires_at=data.get("expires_at"),
                    provider_user_id=str(
                        extra.get("onshape_user_id")
                        or extra.get("autodesk_user_id")
                        or extra.get("twitter_user_id")
                        or ""
                    )
                    or None,
                    provider_email=str(extra.get("onshape_email") or extra.get("autodesk_email") or "") or None,
                    provider_name=str(extra.get("autodesk_name") or extra.get("display_name") or extra.get("login") or "")
                    or None,
                    extra=extra,
                )
                if ok:
                    oauth_n += 1
        migrated["OAuthTokens"] = oauth_n

    logger.info(
        "workspace_migrate sqlite_counts=%s remote_upserts=%s",
        {k: v for k, v in counts.items()},
        {k: v for k, v in migrated.items()},
    )
    return {"ok": True, "sqlite": counts, "upserted": migrated}
