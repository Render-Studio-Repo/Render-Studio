"""Supabase public."Users" — hashed passwords + encrypted AI keys + management stats.

When SUPABASE_URL + service role are set and Users is reachable, this table is
the source of truth for login and personal AI-key lookup. SQLite stays on disk
as a cold backup (optional dual-write). We never fall back to sqlite password
or personal-key reads while Supabase is configured — that would hide an outage.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.auth import verify_password
from backend.config import settings
from backend.database import get_conn
from backend.services import supabase_client

logger = logging.getLogger("render3d.supabase_users")

USERS_TABLE = supabase_client.USERS_TABLE
LEDGER_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "001_security_trial_ledger.sql"
SCHEMA_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "002_users.sql"
RLS_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "003_users_rls_lockdown.sql"
INTEREST_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "004_cloud_compute_interest.sql"
WORKSPACE_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "005_workspace_oauth_credits.sql"
X_CONSUMER_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "007_x_consumer_keys.sql"
GITHUB_PAT_SQL = Path(__file__).resolve().parents[2] / "integrations" / "supabase" / "migrations" / "008_github_user_secrets.sql"

ACTIVITY_COLUMNS = {
    "suggestion": "suggestions_count",
    "bug": "bug_requests_count",
    "render_agent": "render_agent_questions_count",
    "chat": "chats_sent_count",
}
ACTIVITY_SELECT = (
    "cloud_compute_interest,cloud_compute_interest_at,"
    "suggestions_count,submitted_suggestions,"
    "render_agent_questions_count,chats_sent_count,bug_requests_count"
)

_SECRET_COL_HINTS = ("token", "secret", "password", "api_key", "apikey", "refresh")
_PROBE_TTL = 20.0
_probe_lock = threading.Lock()
_probe_cache: dict[str, Any] = {"at": 0.0, "ok": False, "count": None, "error": None}


def enabled() -> bool:
    return supabase_client.configured()


def local_forced() -> bool:
    mode = str(getattr(settings, "users_backend", "") or "").strip().lower()
    return mode in {"local", "sqlite"}


def prefer_supabase() -> bool:
    """True when env says remote users — sqlite must not be used for login/key lookup."""
    return enabled() and not local_forced()


def clear_probe_cache() -> None:
    with _probe_lock:
        _probe_cache.update({"at": 0.0, "ok": False, "count": None, "error": None})


def refresh_probe(*, force: bool = False) -> dict[str, Any]:
    """Ping Users (count only). Never stores row payloads."""
    now = time.monotonic()
    with _probe_lock:
        if not force and _probe_cache["at"] and now - float(_probe_cache["at"]) < _PROBE_TTL:
            return dict(_probe_cache)
    if not prefer_supabase():
        result = {"at": now, "ok": False, "count": None, "error": "local_or_unconfigured"}
        with _probe_lock:
            _probe_cache.update(result)
        return dict(result)
    try:
        res = _sb().table(USERS_TABLE).select("id", count="exact").limit(1).execute()
        count = getattr(res, "count", None)
        if count is None:
            rows = res.data or []
            count = len(rows)
        result = {"at": now, "ok": True, "count": int(count or 0), "error": None}
    except Exception as exc:
        logger.warning("Users probe failed", exc_info=True)
        result = {"at": now, "ok": False, "count": None, "error": str(exc)[:120]}
    with _probe_lock:
        _probe_cache.update(result)
    return dict(result)


def cached_probe() -> dict[str, Any]:
    with _probe_lock:
        snap = dict(_probe_cache)
    if not snap.get("at"):
        return refresh_probe()
    return snap


def users_reachable() -> bool:
    return bool(refresh_probe().get("ok"))


def source_of_truth() -> bool:
    return prefer_supabase() and users_reachable()


def cached_users_backend() -> str:
    """Instant health field. Never networks."""
    if local_forced() or not enabled():
        return "sqlite"
    with _probe_lock:
        ok = _probe_cache.get("ok")
        seen = bool(_probe_cache.get("at"))
    if seen and ok:
        return "supabase"
    if seen and not ok:
        return "supabase_unreachable"
    if prefer_supabase():
        return "supabase"
    return "sqlite"


def sqlite_user_count() -> int:
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()
        return int(row["c"] if row else 0)
    except Exception:
        return 0


def remote_user_count() -> int | None:
    probe = cached_probe()
    if probe.get("ok"):
        return probe.get("count")
    return None


def _sb():
    return supabase_client.get_admin_client()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return bool(row)


def _row_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    try:
        return {k: row[k] for k in row.keys()}
    except Exception:
        return dict(row)


def _is_bcrypt(value: str | None) -> bool:
    raw = str(value or "")
    return raw.startswith("$2a$") or raw.startswith("$2b$") or raw.startswith("$2y$")


def _encrypt(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    from backend.services.user_ai_keys_service import _encrypt as _fernet_encrypt

    return _fernet_encrypt(raw)


def _decrypt_secret(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    from backend.services.user_ai_keys_service import _decrypt as _fernet_decrypt

    plain = _fernet_decrypt(raw)
    if plain:
        return str(plain).strip() or None
    if raw.startswith("gAAAA"):
        return None
    return raw


def _parse_json(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return default


def _uuid_or_none(value: Any) -> str | None:
    raw = str(value or "").strip()
    if len(raw) == 36 and raw.count("-") == 4:
        return raw
    return None


def _sql_statements(sql: str) -> list[str]:
    """Split SQL into statements, dropping full-line comments first."""
    kept: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        kept.append(line)
    joined = "\n".join(kept)
    return [part.strip() for part in joined.split(";") if part.strip()]


def ensure_remote_schema() -> dict[str, Any]:
    """Create Users (+ helper tables) via Management SQL if the PAT is set."""
    if not supabase_client.management_configured():
        return {"ok": False, "error": "no_access_token"}
    results: list[dict[str, Any]] = []
    for path in (LEDGER_SQL, SCHEMA_SQL, RLS_SQL, INTEREST_SQL, WORKSPACE_SQL, X_CONSUMER_SQL, GITHUB_PAT_SQL):
        if not path.is_file():
            results.append({"file": path.name, "ok": False, "error": "missing"})
            continue
        sql = path.read_text(encoding="utf-8")
        result = supabase_client.run_management_sql(sql)
        results.append({"file": path.name, "ok": bool(result.get("ok")), "error": result.get("error")})
        if not result.get("ok"):
            # Management API often accepts one statement; split and retry.
            failed = 0
            for chunk in _sql_statements(sql):
                one = supabase_client.run_management_sql(chunk + ";")
                if not one.get("ok"):
                    failed += 1
            results[-1] = {
                "file": path.name,
                "ok": failed == 0,
                "error": None if failed == 0 else f"{failed}_statements_failed",
                "split": True,
            }
    ok = all(r.get("ok") for r in results) if results else False
    return {"ok": ok, "migrations": results}


def upsert_user_row(payload: dict[str, Any]) -> bool:
    if not enabled() or not payload.get("id"):
        return False
    body = dict(payload)
    body["updated_at"] = _now()
    sid = _uuid_or_none(body.get("supabase_user_id"))
    if sid:
        body["supabase_user_id"] = sid
    else:
        body.pop("supabase_user_id", None)
    # Never send empty non-bcrypt password placeholders.
    ph = body.get("password_hash")
    if ph is not None and not _is_bcrypt(str(ph)):
        body["password_hash"] = None
    try:
        _sb().table(USERS_TABLE).upsert(body, on_conflict="id").execute()
        return True
    except Exception:
        logger.warning("Users upsert failed for %s", body.get("id"), exc_info=True)
        return False


def get_by_id(user_id: str) -> dict[str, Any] | None:
    if not enabled() or not user_id:
        return None
    try:
        res = _sb().table(USERS_TABLE).select("*").eq("id", user_id).limit(1).execute()
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        logger.warning("Users get_by_id failed", exc_info=True)
        return None


def get_by_email(email: str) -> dict[str, Any] | None:
    if not enabled() or not email:
        return None
    try:
        res = (
            _sb()
            .table(USERS_TABLE)
            .select("*")
            .eq("email", email.strip().lower())
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        logger.warning("Users get_by_email failed", exc_info=True)
        return None


_ROLE_SAFE_SELECT = "id,email,username,display_name,role,created_at"


def list_by_role(role: str) -> list[dict[str, Any]]:
    """Directory rows for a Users.role. Never selects secrets or key columns."""
    wanted = str(role or "").strip().lower()
    if not enabled() or wanted not in {"admin", "manager", "user"}:
        return []
    try:
        res = _sb().table(USERS_TABLE).select(_ROLE_SAFE_SELECT).eq("role", wanted).execute()
        out = []
        for row in res.data or []:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "id": row.get("id"),
                    "email": row.get("email"),
                    "username": row.get("username"),
                    "display_name": row.get("display_name"),
                    "role": row.get("role"),
                    "created_at": row.get("created_at"),
                }
            )
        return out
    except Exception:
        logger.warning("Users list_by_role failed", exc_info=True)
        return []


def verify_password_for_email(email: str, password: str) -> bool:
    """Check bcrypt stored on Users. Never logs the password or hash."""
    row = get_by_email(email)
    if not row:
        return False
    return verify_password(password, str(row.get("password_hash") or ""))


def profile_from_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    handle = row.get("username") or (row.get("settings") or {}).get("handle") if isinstance(row.get("settings"), dict) else row.get("username")
    return {
        "id": row.get("id"),
        "email": row.get("email"),
        "display_name": row.get("display_name") or "",
        "handle": handle,
        "avatar_url": row.get("avatar_url"),
        "bio": row.get("bio"),
        "created_at": row.get("created_at"),
        "profile_url": f"/u/{handle}" if handle else None,
        "role": str(row.get("role") or "user").strip().lower() or "user",
    }


def x_consumer_credentials(user_id: str) -> tuple[str, str] | None:
    """Decrypt this user's X developer-app consumer key/secret. None if unset."""
    uid = str(user_id or "").strip()
    if not enabled() or not uid:
        return None
    try:
        res = (
            _sb()
            .table(USERS_TABLE)
            .select("x_consumer_key,x_consumer_secret")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.debug("x_consumer_credentials select skipped", exc_info=True)
        return None
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return None
    key = _decrypt_secret(rows[0].get("x_consumer_key"))
    secret = _decrypt_secret(rows[0].get("x_consumer_secret"))
    if key and secret:
        return key, secret
    return None


def set_x_consumer_credentials(user_id: str, key: str, secret: str) -> bool:
    """Store Fernet-encrypted X consumer key/secret on one Users row."""
    uid = str(user_id or "").strip()
    consumer_key = str(key or "").strip()
    consumer_secret = str(secret or "").strip()
    if not enabled() or not uid or not consumer_key or not consumer_secret:
        return False
    enc_key = _encrypt(consumer_key)
    enc_secret = _encrypt(consumer_secret)
    if not enc_key or not enc_secret:
        return False
    try:
        _sb().table(USERS_TABLE).update(
            {
                "x_consumer_key": enc_key,
                "x_consumer_secret": enc_secret,
                "updated_at": _now(),
            }
        ).eq("id", uid).execute()
        return True
    except Exception:
        logger.warning("Users x_consumer update failed for %s", uid, exc_info=True)
        return False


def x_bot_token(user_id: str) -> str | None:
    """Decrypt this user's X chat bot token (xcbot_). None if unset."""
    uid = str(user_id or "").strip()
    if not enabled() or not uid:
        return None
    try:
        res = (
            _sb()
            .table(USERS_TABLE)
            .select("x_bot_token")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.debug("x_bot_token select skipped", exc_info=True)
        return None
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return None
    return _decrypt_secret(rows[0].get("x_bot_token"))


def set_x_bot_token(user_id: str, token: str) -> bool:
    """Store Fernet-encrypted X chat bot token on one Users row."""
    uid = str(user_id or "").strip()
    raw = str(token or "").strip()
    if not enabled() or not uid or not raw:
        return False
    enc = _encrypt(raw)
    if not enc:
        return False
    try:
        _sb().table(USERS_TABLE).update({"x_bot_token": enc, "updated_at": _now()}).eq("id", uid).execute()
        return True
    except Exception:
        logger.warning("Users x_bot_token update failed for %s", uid, exc_info=True)
        return False


def github_pat(user_id: str) -> str | None:
    """Decrypt this user's GitHub PAT. None if unset. Never log the value."""
    uid = str(user_id or "").strip()
    if not enabled() or not uid:
        return None
    try:
        res = (
            _sb()
            .table(USERS_TABLE)
            .select("github_pat")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
    except Exception:
        logger.debug("github_pat select skipped", exc_info=True)
        return None
    rows = res.data or []
    if not rows or not isinstance(rows[0], dict):
        return None
    return _decrypt_secret(rows[0].get("github_pat"))


def set_github_pat(user_id: str, token: str) -> bool:
    """Store a Fernet-encrypted GitHub PAT on one Users row (service role)."""
    uid = str(user_id or "").strip()
    raw = str(token or "").strip()
    if not enabled() or not uid or not raw:
        return False
    enc = _encrypt(raw)
    if not enc:
        return False
    try:
        _sb().table(USERS_TABLE).update({"github_pat": enc, "updated_at": _now()}).eq("id", uid).execute()
        return True
    except Exception:
        logger.warning("Users github_pat update failed for %s", uid, exc_info=True)
        return False


def clear_github_pat(user_id: str) -> bool:
    uid = str(user_id or "").strip()
    if not enabled() or not uid:
        return False
    try:
        _sb().table(USERS_TABLE).update({"github_pat": None, "updated_at": _now()}).eq("id", uid).execute()
        return True
    except Exception:
        logger.warning("Users github_pat clear failed for %s", uid, exc_info=True)
        return False


def store_user_secret(user_id: str, kind: str, value: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Upsert a pasted secret onto the Users row or Auth provider. Never logs value."""
    uid = str(user_id or "").strip()
    raw = str(value or "").strip()
    name = str(kind or "").strip().lower().replace("-", "_")
    extra = extra or {}
    if not uid or not raw:
        return {"ok": False, "error": "missing"}
    if name in {"github_pat", "github_token", "pat", "personal_access_token"}:
        return {"ok": set_github_pat(uid, raw), "kind": "github_pat"}
    if name in {"github_oauth", "github_client_secret", "github_oauth_app"}:
        cid = str(extra.get("client_id") or extra.get("github_client_id") or "").strip()
        if len(cid) < 8:
            return {"ok": False, "error": "client_id_required", "kind": "github_oauth"}
        result = supabase_client.configure_github_auth_provider(cid, raw)
        return {"ok": bool(result.get("ok")), "kind": "github_oauth", "error": result.get("error")}
    if name in {"x_consumer_secret", "twitter_consumer_secret"}:
        key = str(extra.get("consumer_key") or extra.get("x_consumer_key") or "").strip()
        if not key:
            return {"ok": False, "error": "consumer_key_required", "kind": "x_consumer"}
        return {"ok": set_x_consumer_credentials(uid, key, raw), "kind": "x_consumer"}
    if name in {"x_bot_token", "xchat_bot_token", "xcbot", "x_chat_bot_token"}:
        return {"ok": set_x_bot_token(uid, raw), "kind": "x_bot_token"}
    return {"ok": False, "error": "unknown_kind", "kind": name}


def _owned_project_ids(conn, user_id: str) -> list[str]:
    if not _table_exists(conn, "project_access"):
        return []
    rows = conn.execute(
        "SELECT project_id FROM project_access WHERE created_by = ?",
        (user_id,),
    ).fetchall()
    return [str(r["project_id"]) for r in rows if r["project_id"]]


def _prompt_stats_for_projects(project_ids: list[str], user_id: str) -> dict[str, Any]:
    prompt_count = 0
    success_count = 0
    error_count = 0
    last_created: str | None = None
    projects_dir = Path(settings.projects_dir)
    for pid in project_ids:
        hist = projects_dir / pid / "prompt_history.json"
        if not hist.is_file():
            continue
        try:
            data = json.loads(hist.read_text(encoding="utf-8"))
        except Exception:
            continue
        entries = data if isinstance(data, list) else (data.get("entries") or data.get("prompts") or [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            owner = str(entry.get("user_id") or entry.get("userId") or "").strip()
            if owner and owner != user_id:
                continue
            prompt_count += 1
            status = str(entry.get("status") or entry.get("result") or "").lower()
            if status in {"ok", "success", "done", "completed"}:
                success_count += 1
            elif status in {"error", "failed", "fail"}:
                error_count += 1
            created = str(entry.get("created_at") or entry.get("ts") or "")
            if created and (not last_created or created > last_created):
                last_created = created
    return {
        "prompt_count": prompt_count,
        "success_count": success_count,
        "error_count": error_count,
        "last_model_created_at": last_created,
    }


def _ai_keys_payload(conn, user_id: str, user_row: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    keys: list[dict[str, Any]] = []
    active_id = str(user_row.get("active_ai_key_id") or "") or None
    if _table_exists(conn, "user_ai_keys"):
        rows = conn.execute(
            "SELECT id, name, provider, model, api_key_enc, created_at, base_url FROM user_ai_keys WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        for row in rows:
            enc = str(row["api_key_enc"] or "")
            if not enc:
                continue
            hint = "saved"
            try:
                from backend.services.user_ai_keys_service import _decrypt, key_hint

                plain = _decrypt(enc)
                if plain:
                    hint = key_hint(plain) or hint
            except Exception:
                pass
            keys.append(
                {
                    "id": str(row["id"]),
                    "provider": str(row["provider"] or "openai"),
                    "name": str(row["name"] or ""),
                    "model": str(row["model"] or ""),
                    "base_url": row["base_url"] if "base_url" in row.keys() else None,
                    "ciphertext": enc,
                    "key_hint": hint,
                    "is_active": str(row["id"]) == (active_id or ""),
                    "created_at": row["created_at"],
                }
            )
    if not keys:
        enc = str(user_row.get("ai_api_key_enc") or user_row.get("openai_api_key_enc") or "")
        if enc:
            keys.append(
                {
                    "id": active_id or "legacy",
                    "provider": str(user_row.get("ai_provider") or "openai"),
                    "name": "legacy",
                    "model": str(user_row.get("ai_model") or ""),
                    "ciphertext": enc,
                    "key_hint": "saved",
                    "is_active": True,
                }
            )
    return keys, active_id


def _oauth_secrets(conn, user_id: str) -> dict[str, Any]:
    blob: dict[str, Any] = {}
    tables = (
        ("github_tokens", "github"),
        ("autodesk_tokens", "autodesk"),
        ("onshape_tokens", "onshape"),
        ("twitter_oauth_tokens", "twitter"),
        ("calendar_connections", "calendar"),
        ("ai_subscriptions", "subscriptions"),
        ("social_accounts", "social"),
        ("marketplace_seller_accounts", "stripe"),
        ("user_stream_links", "stream"),
        ("context_drive_connections", "drive"),
    )
    for table, key in tables:
        if not _table_exists(conn, table):
            continue
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        except Exception:
            continue
        if "user_id" not in cols:
            continue
        try:
            rows = conn.execute(f"SELECT * FROM {table} WHERE user_id = ?", (user_id,)).fetchall()
        except Exception:
            continue
        packed: list[dict[str, Any]] = []
        for row in rows:
            item: dict[str, Any] = {}
            for col in cols:
                if col == "user_id":
                    continue
                val = row[col]
                if val is None or val == "":
                    continue
                lname = col.lower()
                if any(h in lname for h in _SECRET_COL_HINTS):
                    enc = _encrypt(str(val))
                    if enc:
                        item[f"{col}_enc"] = enc
                else:
                    item[col] = val
            if item:
                packed.append(item)
        if not packed:
            continue
        blob[key] = packed[0] if len(packed) == 1 else packed
    return blob


def _role_for_user(conn, user_id: str, email: str) -> str:
    from backend.services.platform_roles_service import SUPER_ADMIN_EMAILS, is_super_admin

    if is_super_admin({"email": email}) or email in SUPER_ADMIN_EMAILS:
        return "admin"
    if _table_exists(conn, "platform_roles"):
        row = conn.execute("SELECT role FROM platform_roles WHERE user_id = ?", (user_id,)).fetchone()
        if row and row["role"]:
            return str(row["role"])
    return "user"


def build_payload_for_local_user(user_id: str, *, last_login_at: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        user = _row_dict(row)
        email = str(user.get("email") or "").strip().lower()
        owned = _owned_project_ids(conn, user_id)
        prompt_stats = _prompt_stats_for_projects(owned, user_id)
        credits = 0
        spend = 0
        credit_meta: dict[str, Any] = {}
        if _table_exists(conn, "ai_credit_accounts"):
            acct = conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
            if acct:
                credit_meta = _row_dict(acct)
                credits = int(acct["balance_cents"] or 0)
        if _table_exists(conn, "ai_credit_transactions"):
            spend_row = conn.execute(
                """
                SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0)
                FROM ai_credit_transactions WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
            spend = int((spend_row[0] if spend_row else 0) or 0)
        ai_keys, active_id = _ai_keys_payload(conn, user_id, user)
        oauth = _oauth_secrets(conn, user_id)
        settings_blob = {
            "handle": user.get("handle"),
            "store_settings": _parse_json(user.get("store_settings_json"), {}),
            "receive_payments": _parse_json(user.get("receive_payments_json"), {}),
            "status_text": user.get("status_text"),
            "status_icon": user.get("status_icon"),
            "status_updated_at": user.get("status_updated_at"),
            "credits": {
                "use_platform_key": credit_meta.get("use_platform_key"),
                "platform_provider": credit_meta.get("platform_provider"),
                "platform_model": credit_meta.get("platform_model"),
                "trial_granted_at": credit_meta.get("trial_granted_at"),
                "auto_refill_enabled": credit_meta.get("auto_refill_enabled"),
            },
        }
        last_seen = user.get("last_seen_at")
        stats = {
            "project_count": len(owned),
            "model_count": len(owned),
            **prompt_stats,
            "credits_balance_cents": credits,
            "total_spend_cents": spend,
            "last_seen_at": last_seen,
            "ai_key_count": len(ai_keys),
            "ai_providers": sorted({k.get("provider") for k in ai_keys if k.get("provider")}),
        }
        payload: dict[str, Any] = {
            "id": user_id,
            "email": email,
            "username": user.get("handle"),
            "display_name": user.get("display_name") or "",
            "password_hash": user.get("password_hash") if _is_bcrypt(user.get("password_hash")) else None,
            "role": _role_for_user(conn, user_id, email),
            "created_at": user.get("created_at"),
            "last_login_at": last_login_at or last_seen,
            "last_seen_at": last_seen,
            "avatar_url": user.get("avatar_url"),
            "bio": user.get("bio"),
            "active_ai_key_id": active_id,
            "ai_provider": user.get("ai_provider"),
            "ai_model": user.get("ai_model"),
            "ai_keys": ai_keys,
            "oauth_secrets": oauth,
            "settings": settings_blob,
            "stats": stats,
            "project_count": len(owned),
            "model_count": len(owned),
            "prompt_count": int(prompt_stats.get("prompt_count") or 0),
            "success_count": int(prompt_stats.get("success_count") or 0),
            "error_count": int(prompt_stats.get("error_count") or 0),
            "credits_balance_cents": credits,
            "total_spend_cents": spend,
            "last_model_created_at": prompt_stats.get("last_model_created_at"),
            "owned_project_ids": owned,
            "cloud_compute_interest": bool(int(user.get("cloud_compute_interest") or 0)),
            "cloud_compute_interest_at": user.get("cloud_compute_interest_at"),
        }
        sid = user.get("supabase_user_id")
        if sid:
            payload["supabase_user_id"] = sid
        return payload


def upsert_local_user(user_id: str, *, last_login_at: str | None = None) -> bool:
    payload = build_payload_for_local_user(user_id, last_login_at=last_login_at)
    if not payload:
        return False
    return upsert_user_row(payload)


def persist_stats_snapshot(users: list[dict[str, Any]]) -> int:
    """Write Management dashboard stats onto Users (ciphertext columns untouched)."""
    if not enabled():
        return 0
    written = 0
    for item in users:
        uid = str(item.get("id") or "")
        if not uid:
            continue
        patch = {
            "id": uid,
            "email": str(item.get("email") or "").strip().lower() or None,
            "display_name": item.get("display_name"),
            "project_count": int(item.get("project_count") or 0),
            "model_count": int(item.get("model_count") or 0),
            "prompt_count": int(item.get("prompt_count") or 0),
            "success_count": int(item.get("success_count") or 0),
            "error_count": int(item.get("error_count") or 0),
            "total_spend_cents": int(round(float(item.get("total_cost_usd") or 0) * 100)),
            "last_seen_at": item.get("last_active_at") or item.get("last_seen_at"),
            "stats": {
                "project_count": int(item.get("project_count") or 0),
                "prompt_count": int(item.get("prompt_count") or 0),
                "success_count": int(item.get("success_count") or 0),
                "error_count": int(item.get("error_count") or 0),
                "total_cost_usd": item.get("total_cost_usd"),
                "total_tokens": item.get("total_tokens"),
                "last_active_at": item.get("last_active_at"),
            },
        }
        patch = {k: v for k, v in patch.items() if v is not None}
        if upsert_user_row(patch):
            written += 1
    return written


def _apply_activity_row(item: dict[str, Any], row: dict[str, Any]) -> None:
    for key in ACTIVITY_COLUMNS.values():
        if row.get(key) is not None:
            try:
                item[key] = int(row.get(key) or 0)
            except (TypeError, ValueError):
                item[key] = 0
    if row.get("submitted_suggestions") is not None:
        item["submitted_suggestions"] = bool(row.get("submitted_suggestions"))
    elif int(item.get("suggestions_count") or 0) > 0:
        item["submitted_suggestions"] = True
    if row.get("cloud_compute_interest") is not None:
        item["cloud_compute_interest"] = bool(row.get("cloud_compute_interest"))
    if row.get("cloud_compute_interest_at") and not item.get("cloud_compute_interest_at"):
        item["cloud_compute_interest_at"] = row.get("cloud_compute_interest_at")


def overlay_stats(users_by_id: dict[str, dict[str, Any]]) -> None:
    if not enabled() or not users_by_id:
        return
    base_select = (
        "id,email,role,last_login_at,last_seen_at,project_count,model_count,"
        "prompt_count,success_count,error_count,credits_balance_cents,total_spend_cents,stats"
    )
    rows: list[dict[str, Any]] = []
    try:
        res = _sb().table(USERS_TABLE).select(f"{base_select},{ACTIVITY_SELECT}").execute()
        rows = res.data or []
    except Exception:
        try:
            res = _sb().table(USERS_TABLE).select(base_select).execute()
            rows = res.data or []
        except Exception:
            logger.warning("Users overlay_stats failed", exc_info=True)
            return
    for row in rows:
        uid = str(row.get("id") or "")
        item = users_by_id.get(uid)
        if not item:
            continue
        item["role"] = row.get("role") or item.get("role")
        item["last_login_at"] = row.get("last_login_at")
        if not item.get("last_active_at"):
            item["last_active_at"] = row.get("last_seen_at") or row.get("last_login_at")
        if not int(item.get("prompt_count") or 0) and row.get("prompt_count"):
            item["prompt_count"] = int(row.get("prompt_count") or 0)
        if not int(item.get("project_count") or 0) and row.get("project_count"):
            item["project_count"] = int(row.get("project_count") or 0)
        item["credits_balance_cents"] = row.get("credits_balance_cents")
        item["supabase_users"] = True
        _apply_activity_row(item, row)


def increment_activity(user_id: str, kind: str) -> bool:
    """Atomically bump a Users activity counter. No-op without Supabase or a user id."""
    uid = str(user_id or "").strip()
    col = ACTIVITY_COLUMNS.get(str(kind or "").strip().lower())
    if not enabled() or not uid or not col:
        return False
    try:
        res = (
            _sb()
            .table(USERS_TABLE)
            .select(f"id,{col}")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False
        n = int(rows[0].get(col) or 0) + 1
        fields: dict[str, Any] = {col: n}
        if col == "suggestions_count":
            fields["submitted_suggestions"] = True
        return patch_user(uid, **fields)
    except Exception:
        logger.warning("Users increment_activity failed kind=%s", kind, exc_info=True)
        return False


def activity_for_user(user_id: str) -> dict[str, Any]:
    """Summary columns for admin UI. Empty dict when remote is off or the row is missing."""
    if not enabled() or not user_id:
        return {}
    row = get_by_id(user_id)
    if not row:
        return {}
    out: dict[str, Any] = {
        "suggestions_count": int(row.get("suggestions_count") or 0),
        "submitted_suggestions": bool(row.get("submitted_suggestions"))
        or int(row.get("suggestions_count") or 0) > 0,
        "render_agent_questions_count": int(row.get("render_agent_questions_count") or 0),
        "chats_sent_count": int(row.get("chats_sent_count") or 0),
        "bug_requests_count": int(row.get("bug_requests_count") or 0),
    }
    if row.get("cloud_compute_interest") is not None:
        out["cloud_compute_interest"] = bool(row.get("cloud_compute_interest"))
    return out


def sync_all_from_sqlite(*, limit: int = 2000) -> dict[str, Any]:
    if not enabled():
        return {"ok": False, "error": "not_configured"}
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM users ORDER BY created_at ASC LIMIT ?",
            (int(limit),),
        ).fetchall()
    upserted = 0
    errors: list[str] = []
    for row in rows:
        uid = str(row["id"])
        try:
            if upsert_local_user(uid):
                upserted += 1
            else:
                errors.append(uid)
        except Exception as exc:
            errors.append(f"{uid}: {str(exc)[:80]}")
    return {
        "ok": True,
        "total": len(rows),
        "upserted": upserted,
        "errors": errors[:20],
    }


def touch_last_seen(user_id: str, when: str | None = None) -> None:
    if not enabled() or not user_id:
        return
    stamp = when or _now()
    try:
        _sb().table(USERS_TABLE).update({"last_seen_at": stamp, "updated_at": stamp}).eq("id", user_id).execute()
    except Exception:
        logger.warning("Users touch_last_seen failed", exc_info=True)


def touch_last_login(user_id: str, when: str | None = None) -> None:
    if not enabled() or not user_id:
        return
    stamp = when or _now()
    try:
        _sb().table(USERS_TABLE).update(
            {"last_login_at": stamp, "last_seen_at": stamp, "updated_at": stamp}
        ).eq("id", user_id).execute()
    except Exception:
        logger.warning("Users touch_last_login failed", exc_info=True)


def patch_user(user_id: str, **fields: Any) -> bool:
    """Update specific Users columns. Never logs values."""
    if not enabled() or not user_id or not fields:
        return False
    body = {k: v for k, v in fields.items() if v is not None or k in fields}
    body["updated_at"] = _now()
    ph = body.get("password_hash")
    if ph is not None and not _is_bcrypt(str(ph)):
        body.pop("password_hash", None)
    try:
        _sb().table(USERS_TABLE).update(body).eq("id", user_id).execute()
        return True
    except Exception:
        logger.warning("Users patch failed for %s", user_id, exc_info=True)
        return False


def upsert_password_hash(user_id: str, email: str, password_hash: str, *, display_name: str = "") -> bool:
    if not enabled() or not user_id or not _is_bcrypt(password_hash):
        return False
    return upsert_user_row(
        {
            "id": user_id,
            "email": (email or "").strip().lower(),
            "display_name": display_name or "",
            "password_hash": password_hash,
        }
    )


def personal_keys(user_id: str) -> list[dict[str, Any]]:
    row = get_by_id(user_id)
    if not row:
        return []
    keys = row.get("ai_keys") or []
    if isinstance(keys, str):
        keys = _parse_json(keys, [])
    return [k for k in keys if isinstance(k, dict)] if isinstance(keys, list) else []


def list_key_meta(user_id: str) -> list[dict[str, Any]]:
    row = get_by_id(user_id)
    active_id = str((row or {}).get("active_ai_key_id") or "") or None
    out: list[dict[str, Any]] = []
    for item in personal_keys(user_id):
        out.append(
            {
                "id": str(item.get("id") or ""),
                "name": item.get("name"),
                "provider": item.get("provider"),
                "provider_label": None,
                "model": item.get("model"),
                "base_url": item.get("base_url"),
                "created_at": item.get("created_at"),
                "is_active": str(item.get("id") or "") == (active_id or ""),
            }
        )
    return out


def replace_personal_keys(
    user_id: str,
    keys: list[dict[str, Any]],
    *,
    active_id: str | None = None,
    ai_provider: str | None = None,
    ai_model: str | None = None,
) -> bool:
    packed = []
    for item in keys:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        packed.append(
            {
                "id": str(item.get("id")),
                "provider": item.get("provider") or "openai",
                "name": item.get("name") or "",
                "model": item.get("model") or "",
                "base_url": item.get("base_url"),
                "ciphertext": item.get("ciphertext") or item.get("api_key_enc") or "",
                "key_hint": item.get("key_hint") or "saved",
                "is_active": str(item.get("id")) == str(active_id or ""),
                "created_at": item.get("created_at"),
            }
        )
    fields: dict[str, Any] = {"ai_keys": packed}
    if active_id is not None:
        fields["active_ai_key_id"] = active_id
    if ai_provider is not None:
        fields["ai_provider"] = ai_provider
    if ai_model is not None:
        fields["ai_model"] = ai_model
    return patch_user(user_id, **fields)


def find_personal_key(user_id: str, key_id: str) -> dict[str, Any] | None:
    kid = str(key_id or "")
    for item in personal_keys(user_id):
        if str(item.get("id") or "") == kid:
            return item
    return None
