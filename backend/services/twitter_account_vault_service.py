"""Encrypted multi-account X token vault.

Primary/default account stays in the legacy top-level slot so existing readers
keep working:

- SQLite: `twitter_oauth_tokens` root columns remain the primary account.
- Supabase Users.oauth_secrets.twitter remains the primary/default account.

Additional accounts are stored additively beside the primary:

- SQLite: `twitter_oauth_tokens.accounts_json`
- Supabase Users.oauth_secrets.twitter_accounts[]

For compatibility, Supabase OAuthTokens is also mirrored as:

- provider='twitter' for the primary/default account
- provider='twitter:<handle>' for secondary accounts
"""

from __future__ import annotations

import copy
import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services import supabase_client
from backend.services.user_ai_keys_service import _decrypt, _encrypt

logger = logging.getLogger("render3d.twitter.vault")

PRIMARY_PROVIDER = "twitter"
SECONDARY_ACCOUNTS_KEY = "twitter_accounts"
OAUTH1_SECRET_PREFIX = "oauth1:"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb():
    return supabase_client.get_admin_client()


def _supabase_enabled() -> bool:
    return supabase_client.configured() and _sb() is not None


def _normalize_username(value: str | None) -> str | None:
    raw = str(value or "").strip().lstrip("@")
    return raw.lower() or None


def _account_match_key(account: dict[str, Any]) -> str:
    username = _normalize_username(account.get("username"))
    if username:
        return f"user:{username}"
    user_id = str(account.get("twitter_user_id") or "").strip()
    if user_id:
        return f"id:{user_id}"
    display = str(account.get("display_name") or "").strip().lower()
    return f"name:{display}"


def _target_matches(account: dict[str, Any], target: str | None) -> bool:
    want = str(target or "").strip()
    if not want:
        return False
    want_norm = _normalize_username(want)
    have_username = _normalize_username(account.get("username"))
    if want_norm and have_username and want_norm == have_username:
        return True
    return want == str(account.get("twitter_user_id") or "").strip()


def _ciphertext(value: str | None) -> tuple[str | None, bool]:
    raw = str(value or "").strip()
    if not raw:
        return None, False
    plain = _decrypt(raw)
    if plain is not None:
        return raw, False
    return _encrypt(raw), True


def _decrypt_or_legacy(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    plain = _decrypt(raw)
    return plain if plain is not None else raw


def _sanitize_account(record: dict[str, Any] | None) -> tuple[dict[str, Any] | None, bool]:
    if not isinstance(record, dict):
        return None, False
    access_enc, access_migrated = _ciphertext(
        record.get("access_token_enc") or record.get("access_token")
    )
    if not access_enc:
        return None, False
    refresh_enc, refresh_migrated = _ciphertext(
        record.get("refresh_token_enc") or record.get("refresh_token")
    )
    created_at = str(record.get("created_at") or "").strip() or _now_iso()
    updated_at = str(record.get("updated_at") or "").strip() or created_at
    account = {
        "scope": str(record.get("scope") or "").strip() or "oauth2",
        "username": str(record.get("username") or "").strip() or None,
        "display_name": str(record.get("display_name") or "").strip() or None,
        "twitter_user_id": str(record.get("twitter_user_id") or "").strip() or None,
        "picture_url": str(record.get("picture_url") or "").strip() or None,
        "expires_at": str(record.get("expires_at") or "").strip() or None,
        "access_token_enc": access_enc,
        "refresh_token_enc": refresh_enc,
        "created_at": created_at,
        "updated_at": updated_at,
    }
    return account, bool(access_migrated or refresh_migrated)


def _account_payload(
    *,
    access_token: str,
    refresh_token: str | None,
    expires_at: str | None,
    scope: str | None,
    profile: dict[str, Any] | None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profile = profile or {}
    now = _now_iso()
    created_at = str((existing or {}).get("created_at") or "").strip() or now
    return {
        "scope": str(scope or "oauth2").strip() or "oauth2",
        "username": str(profile.get("username") or (existing or {}).get("username") or "").strip() or None,
        "display_name": str(profile.get("name") or profile.get("display_name") or (existing or {}).get("display_name") or "").strip() or None,
        "twitter_user_id": str(profile.get("id") or profile.get("twitter_user_id") or (existing or {}).get("twitter_user_id") or "").strip() or None,
        "picture_url": str(profile.get("profile_image_url") or profile.get("picture_url") or (existing or {}).get("picture_url") or "").strip() or None,
        "expires_at": str(expires_at or (existing or {}).get("expires_at") or "").strip() or None,
        "access_token_enc": _encrypt(access_token),
        "refresh_token_enc": _encrypt(refresh_token) if refresh_token else (existing or {}).get("refresh_token_enc"),
        "created_at": created_at,
        "updated_at": now,
    }


def _summary(account: dict[str, Any], *, is_primary: bool) -> dict[str, Any]:
    username = str(account.get("username") or "").strip() or None
    provider = PRIMARY_PROVIDER if is_primary else f"{PRIMARY_PROVIDER}:{(username or account.get('twitter_user_id') or 'account')}"
    return {
        "provider": provider,
        "twitter_user_id": account.get("twitter_user_id"),
        "username": username,
        "display_name": account.get("display_name"),
        "picture_url": account.get("picture_url"),
        "updated_at": account.get("updated_at"),
        "expires_at": account.get("expires_at"),
        "has_refresh": bool(account.get("refresh_token_enc")),
        "is_primary": bool(is_primary),
    }


def _ensure_tables() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS twitter_oauth_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TEXT,
                scope TEXT,
                twitter_user_id TEXT,
                username TEXT,
                display_name TEXT,
                picture_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS twitter_oauth_pending (
                state TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                code_verifier TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        cols = {str(row[1]) for row in conn.execute("PRAGMA table_info(twitter_oauth_tokens)").fetchall()}
        if "accounts_json" not in cols:
            conn.execute("ALTER TABLE twitter_oauth_tokens ADD COLUMN accounts_json TEXT NOT NULL DEFAULT '[]'")
        conn.commit()


def _load_sqlite_accounts(user_id: str) -> tuple[list[dict[str, Any]], bool]:
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT access_token, refresh_token, expires_at, scope, twitter_user_id, username,
                   display_name, picture_url, created_at, updated_at, accounts_json
              FROM twitter_oauth_tokens
             WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    if not row:
        return [], False
    mutated = False
    accounts: list[dict[str, Any]] = []
    primary, primary_migrated = _sanitize_account(
        {
            "access_token": row["access_token"],
            "refresh_token": row["refresh_token"],
            "expires_at": row["expires_at"],
            "scope": row["scope"],
            "twitter_user_id": row["twitter_user_id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "picture_url": row["picture_url"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
    )
    if primary:
        accounts.append(primary)
    mutated = mutated or primary_migrated
    raw_accounts = row["accounts_json"]
    try:
        extras = json.loads(raw_accounts or "[]")
    except (TypeError, ValueError):
        extras = []
        mutated = True
    for item in extras if isinstance(extras, list) else []:
        account, migrated = _sanitize_account(item)
        if not account:
            mutated = True
            continue
        if any(_account_match_key(existing) == _account_match_key(account) for existing in accounts):
            mutated = True
            continue
        accounts.append(account)
        mutated = mutated or migrated
    return accounts, mutated


def _fetch_supabase_token_rows(user_id: str) -> list[dict[str, Any]]:
    if not _supabase_enabled():
        return []
    try:
        res = (
            _sb()
            .table("OAuthTokens")
            .select("provider, access_token_enc, refresh_token_enc, expires_at, provider_user_id, provider_name, extra, updated_at")
            .eq("user_id", user_id)
            .like("provider", "twitter%")
            .execute()
        )
        rows = res.data or []
        return [row for row in rows if isinstance(row, dict)]
    except Exception:
        logger.warning("Supabase OAuthTokens fetch failed for %s", user_id, exc_info=True)
        return []


def _load_supabase_accounts(user_id: str) -> list[dict[str, Any]]:
    if not _supabase_enabled():
        return []
    accounts: list[dict[str, Any]] = []
    try:
        res = _sb().table("Users").select("oauth_secrets").eq("id", user_id).limit(1).execute()
        rows = res.data or []
        oauth_secrets = rows[0].get("oauth_secrets") if rows else {}
        oauth_secrets = oauth_secrets if isinstance(oauth_secrets, dict) else {}
        primary, _ = _sanitize_account((oauth_secrets or {}).get("twitter"))
        if primary:
            accounts.append(primary)
        extras = (oauth_secrets or {}).get(SECONDARY_ACCOUNTS_KEY)
        if isinstance(extras, list):
            for item in extras:
                account, _ = _sanitize_account(item)
                if account and all(_account_match_key(existing) != _account_match_key(account) for existing in accounts):
                    accounts.append(account)
    except Exception:
        logger.warning("Supabase Users.oauth_secrets fetch failed for %s", user_id, exc_info=True)

    for row in _fetch_supabase_token_rows(user_id):
        extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
        account, _ = _sanitize_account(
            {
                "access_token_enc": row.get("access_token_enc"),
                "refresh_token_enc": row.get("refresh_token_enc"),
                "expires_at": row.get("expires_at"),
                "scope": extra.get("scope"),
                "username": extra.get("username"),
                "display_name": extra.get("display_name") or row.get("provider_name"),
                "picture_url": extra.get("picture_url"),
                "twitter_user_id": extra.get("twitter_user_id") or row.get("provider_user_id"),
                "created_at": extra.get("created_at"),
                "updated_at": row.get("updated_at") or extra.get("updated_at"),
            }
        )
        if not account:
            continue
        provider = str(row.get("provider") or "")
        is_primary = provider == PRIMARY_PROVIDER
        existing_idx = next(
            (idx for idx, existing in enumerate(accounts) if _account_match_key(existing) == _account_match_key(account)),
            None,
        )
        if existing_idx is None:
            if is_primary:
                accounts.insert(0, account)
            else:
                accounts.append(account)
            continue
        if is_primary and existing_idx != 0:
            existing = accounts.pop(existing_idx)
            accounts.insert(0, existing)
    return accounts


def _sync_social_accounts(conn: sqlite3.Connection, user_id: str, accounts: list[dict[str, Any]]) -> None:
    desired_ids = {
        str(account.get("twitter_user_id") or "").strip(): account
        for account in accounts
        if str(account.get("twitter_user_id") or "").strip()
    }
    existing_rows = conn.execute(
        "SELECT provider_user_id FROM social_accounts WHERE provider = 'twitter' AND user_id = ?",
        (user_id,),
    ).fetchall()
    existing_ids = {str(row["provider_user_id"] or "").strip() for row in existing_rows}
    now = _now_iso()
    for provider_user_id, account in desired_ids.items():
        conn.execute(
            """
            INSERT INTO social_accounts
              (provider, provider_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
            VALUES ('twitter', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, provider_user_id) DO UPDATE SET
              user_id = excluded.user_id,
              email = excluded.email,
              display_name = excluded.display_name,
              picture_url = excluded.picture_url,
              updated_at = excluded.updated_at
            """,
            (
                provider_user_id,
                user_id,
                account.get("username"),
                account.get("display_name"),
                account.get("picture_url"),
                str(account.get("created_at") or now),
                now,
            ),
        )
    for stale_id in sorted(existing_ids - set(desired_ids.keys())):
        conn.execute(
            "DELETE FROM social_accounts WHERE provider = 'twitter' AND provider_user_id = ? AND user_id = ?",
            (stale_id, user_id),
        )


def _provider_for_account(account: dict[str, Any], *, is_primary: bool) -> str:
    if is_primary:
        return PRIMARY_PROVIDER
    username = _normalize_username(account.get("username"))
    if username:
        return f"{PRIMARY_PROVIDER}:{username}"
    return f"{PRIMARY_PROVIDER}:{account.get('twitter_user_id') or 'account'}"


def _upsert_supabase_tokens(user_id: str, accounts: list[dict[str, Any]]) -> None:
    if not _supabase_enabled():
        return
    desired_providers = set()
    try:
        for idx, account in enumerate(accounts):
            is_primary = idx == 0
            provider = _provider_for_account(account, is_primary=is_primary)
            desired_providers.add(provider)
            _sb().table("OAuthTokens").upsert(
                {
                    "user_id": user_id,
                    "provider": provider,
                    "access_token_enc": account.get("access_token_enc"),
                    "refresh_token_enc": account.get("refresh_token_enc"),
                    "expires_at": account.get("expires_at"),
                    "provider_user_id": account.get("twitter_user_id"),
                    "provider_name": account.get("display_name"),
                    "extra": {
                        "scope": account.get("scope"),
                        "username": account.get("username"),
                        "created_at": account.get("created_at"),
                        "updated_at": account.get("updated_at"),
                        "picture_url": account.get("picture_url"),
                        "display_name": account.get("display_name"),
                        "twitter_user_id": account.get("twitter_user_id"),
                    },
                    "updated_at": _now_iso(),
                },
                on_conflict="user_id,provider",
            ).execute()
        for row in _fetch_supabase_token_rows(user_id):
            provider = str(row.get("provider") or "")
            if provider and provider not in desired_providers:
                _sb().table("OAuthTokens").delete().eq("user_id", user_id).eq("provider", provider).execute()
    except Exception:
        logger.warning("Supabase OAuthTokens sync failed for %s", user_id, exc_info=True)


def _sync_supabase_accounts(user_id: str, accounts: list[dict[str, Any]]) -> None:
    if not _supabase_enabled():
        return
    try:
        res = _sb().table("Users").select("oauth_secrets").eq("id", user_id).limit(1).execute()
        rows = res.data or []
        current = rows[0].get("oauth_secrets") if rows else {}
        oauth_secrets = copy.deepcopy(current) if isinstance(current, dict) else {}
        if accounts:
            oauth_secrets["twitter"] = {
                key: value
                for key, value in accounts[0].items()
                if value is not None
            }
            extras = [
                {key: value for key, value in account.items() if value is not None}
                for account in accounts[1:]
            ]
            if extras:
                oauth_secrets[SECONDARY_ACCOUNTS_KEY] = extras
            else:
                oauth_secrets.pop(SECONDARY_ACCOUNTS_KEY, None)
        else:
            oauth_secrets.pop("twitter", None)
            oauth_secrets.pop(SECONDARY_ACCOUNTS_KEY, None)
        _sb().table("Users").update(
            {"oauth_secrets": oauth_secrets, "updated_at": _now_iso()}
        ).eq("id", user_id).execute()
    except Exception:
        logger.warning("Supabase oauth_secrets sync failed for %s", user_id, exc_info=True)
    _upsert_supabase_tokens(user_id, accounts)


def _save_accounts(user_id: str, accounts: list[dict[str, Any]], *, sync_supabase: bool = True) -> None:
    _ensure_tables()
    normalized = [account for account in accounts if account and account.get("access_token_enc")]
    with get_conn() as conn:
        if not normalized:
            conn.execute("DELETE FROM twitter_oauth_tokens WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM social_accounts WHERE provider = 'twitter' AND user_id = ?", (user_id,))
            conn.commit()
        else:
            primary = normalized[0]
            extras = normalized[1:]
            conn.execute(
                """
                INSERT INTO twitter_oauth_tokens
                  (user_id, access_token, refresh_token, expires_at, scope, twitter_user_id,
                   username, display_name, picture_url, created_at, updated_at, accounts_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  access_token = excluded.access_token,
                  refresh_token = excluded.refresh_token,
                  expires_at = excluded.expires_at,
                  scope = excluded.scope,
                  twitter_user_id = excluded.twitter_user_id,
                  username = excluded.username,
                  display_name = excluded.display_name,
                  picture_url = excluded.picture_url,
                  updated_at = excluded.updated_at,
                  accounts_json = excluded.accounts_json
                """,
                (
                    user_id,
                    primary.get("access_token_enc"),
                    primary.get("refresh_token_enc"),
                    primary.get("expires_at"),
                    primary.get("scope"),
                    primary.get("twitter_user_id"),
                    primary.get("username"),
                    primary.get("display_name"),
                    primary.get("picture_url"),
                    primary.get("created_at") or _now_iso(),
                    _now_iso(),
                    json.dumps(extras),
                ),
            )
            _sync_social_accounts(conn, user_id, normalized)
            conn.commit()
    if sync_supabase:
        _sync_supabase_accounts(user_id, normalized)


def _load_accounts(user_id: str) -> list[dict[str, Any]]:
    accounts, mutated = _load_sqlite_accounts(user_id)
    if accounts:
        if mutated:
            _save_accounts(user_id, accounts, sync_supabase=False)
        return accounts
    remote = _load_supabase_accounts(user_id)
    if remote:
        _save_accounts(user_id, remote, sync_supabase=False)
    return remote


def list_accounts(user_id: str) -> list[dict[str, Any]]:
    return [_summary(account, is_primary=(idx == 0)) for idx, account in enumerate(_load_accounts(user_id))]


def linked_account(user_id: str) -> dict[str, Any] | None:
    accounts = list_accounts(user_id)
    return accounts[0] if accounts else None


def upsert_account(
    user_id: str,
    *,
    access_token: str,
    refresh_token: str | None,
    expires_at: str | None,
    scope: str | None,
    profile: dict[str, Any] | None,
) -> dict[str, Any]:
    accounts = _load_accounts(user_id)
    incoming = _account_payload(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        scope=scope,
        profile=profile,
        existing=None,
    )
    incoming_key = _account_match_key(incoming)
    primary = accounts[0] if accounts else None
    next_accounts: list[dict[str, Any]] = []
    if not primary:
        next_accounts = [incoming]
    else:
        primary_key = _account_match_key(primary)
        if incoming_key == primary_key:
            merged = _account_payload(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
                scope=scope,
                profile=profile,
                existing=primary,
            )
            next_accounts = [merged, *accounts[1:]]
        else:
            next_accounts = [primary]
            replaced = False
            for existing in accounts[1:]:
                if _account_match_key(existing) == incoming_key:
                    next_accounts.append(
                        _account_payload(
                            access_token=access_token,
                            refresh_token=refresh_token,
                            expires_at=expires_at,
                            scope=scope,
                            profile=profile,
                            existing=existing,
                        )
                    )
                    replaced = True
                else:
                    next_accounts.append(existing)
            if not replaced:
                next_accounts.append(incoming)
    _save_accounts(user_id, next_accounts)
    summaries = list_accounts(user_id)
    match = next(
        (
            summary
            for summary in summaries
            if _target_matches(summary, incoming.get("username"))
            or str(summary.get("twitter_user_id") or "") == str(incoming.get("twitter_user_id") or "")
        ),
        None,
    )
    return match or summaries[0]


def remove_account(user_id: str, target: str | None = None) -> None:
    if not target:
        _save_accounts(user_id, [])
        return
    accounts = _load_accounts(user_id)
    keep = [account for account in accounts if not _target_matches(account, target)]
    _save_accounts(user_id, keep)


def get_account_auth(user_id: str, target: str | None = None) -> dict[str, Any]:
    accounts = _load_accounts(user_id)
    if not accounts:
        raise RuntimeError("Connect your X account first.")
    selected = accounts[0]
    if target:
        match = next((account for account in accounts if _target_matches(account, target)), None)
        if not match:
            raise RuntimeError(f"Connected X account @{str(target).lstrip('@')} was not found.")
        selected = match
    access = _decrypt_or_legacy(selected.get("access_token_enc"))
    refresh = _decrypt_or_legacy(selected.get("refresh_token_enc"))
    if not access:
        raise RuntimeError("X session incomplete. Reconnect your X account.")
    return {
        "mode": "oauth1" if (refresh or "").startswith(OAUTH1_SECRET_PREFIX) or str(selected.get("scope") or "") == "oauth1" else "oauth2",
        "access_token": access,
        "refresh_token": refresh,
        "username": selected.get("username"),
        "twitter_user_id": selected.get("twitter_user_id"),
        "display_name": selected.get("display_name"),
        "picture_url": selected.get("picture_url"),
        "scope": selected.get("scope"),
        "expires_at": selected.get("expires_at"),
    }
