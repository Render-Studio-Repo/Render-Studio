"""Cron-friendly X auto-repost polling.

This service polls one connected X account's posts and reposts them from another
connected X account owned by the same Render Studio user.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import requests
from requests_oauthlib import OAuth1

from backend.config import settings
from backend.database import get_conn
from backend.services import twitter_account_vault_service as twitter_vault
from backend.services import twitter_link_service

logger = logging.getLogger("render3d.twitter.repost")

STATE_DIR = Path(settings.data_dir) / "scheduled-social"
DEFAULT_SOURCE_USERNAME = "Winstead_Works"
DEFAULT_REPOST_AS_USERNAME = "A1_Projects"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-") or "x-repost"


def enabled() -> bool:
    return bool(getattr(settings, "x_ww_to_a1_repost_enabled", False))


def state_path(user_id: str, *, repost_as_username: str, source_username: str) -> Path:
    return STATE_DIR / f"x-repost-{_slug(user_id)}-{_slug(repost_as_username)}-from-{_slug(source_username)}.json"


def load_state(user_id: str, *, repost_as_username: str, source_username: str) -> dict[str, Any]:
    path = state_path(user_id, repost_as_username=repost_as_username, source_username=source_username)
    if not path.is_file():
        return {
            "user_id": user_id,
            "repost_as_username": repost_as_username,
            "source_username": source_username,
            "last_seen_id": None,
            "reposted_ids": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {
            "user_id": user_id,
            "repost_as_username": repost_as_username,
            "source_username": source_username,
            "last_seen_id": None,
            "reposted_ids": [],
        }


def save_state(user_id: str, *, repost_as_username: str, source_username: str, state: dict[str, Any]) -> None:
    path = state_path(user_id, repost_as_username=repost_as_username, source_username=source_username)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(state or {})
    payload["user_id"] = user_id
    payload["repost_as_username"] = repost_as_username
    payload["source_username"] = source_username
    payload["updated_at"] = _now_iso()
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _account_summary(user_id: str, username: str) -> dict[str, Any]:
    normalized = str(username or "").strip().lstrip("@").lower()
    for account in twitter_vault.list_accounts(user_id):
        if str(account.get("username") or "").strip().lower() == normalized:
            return account
    raise RuntimeError(f"Connected X account @{normalized} was not found.")


def _app_key() -> str:
    return str(getattr(settings, "x_a1_projects_app_key", "") or settings.twitter_client_id or "").strip()


def _app_secret() -> str:
    return str(getattr(settings, "x_a1_projects_app_secret", "") or settings.twitter_client_secret or "").strip()


def _bearer_token() -> str:
    return str(getattr(settings, "x_a1_projects_bearer_token", "") or "").strip()


def _env_repost_creds() -> dict[str, Any] | None:
    access = str(getattr(settings, "a1_projects_x_access_token", "") or "").strip()
    secret = str(getattr(settings, "a1_projects_x_access_token_secret", "") or "").strip()
    app_key = _app_key()
    app_secret = _app_secret()
    if not (access and secret and app_key and app_secret):
        return None
    auth = OAuth1(
        app_key,
        client_secret=app_secret,
        resource_owner_key=access,
        resource_owner_secret=secret,
        signature_method="HMAC-SHA1",
    )
    return {
        "mode": "oauth1",
        "access_token": access,
        "token_secret": secret,
        "auth": auth,
        "username": DEFAULT_REPOST_AS_USERNAME,
    }


def _call_x_json(
    creds: dict[str, Any],
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    method = method.upper()
    if creds.get("mode") == "oauth1":
        resp = requests.request(
            method,
            url,
            auth=creds["auth"],
            params=params,
            json=json_body,
            headers={"Content-Type": "application/json"} if json_body is not None else None,
            timeout=timeout,
        )
    else:
        headers = {
            "Authorization": f"Bearer {str(creds.get('access_token') or '')}",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        resp = httpx.request(
            method,
            url,
            params=params,
            json=json_body,
            headers=headers,
            timeout=timeout,
        )
    if int(resp.status_code) >= 400:
        detail = twitter_link_service._x_error_detail(resp, "X request failed")  # noqa: SLF001
        raise RuntimeError(detail)
    return resp.json() or {}


def fetch_recent_posts(
    user_id: str,
    *,
    source_username: str,
    since_id: str | None = None,
    max_results: int = 10,
) -> list[dict[str, Any]]:
    bearer = _bearer_token()
    if bearer:
        creds: dict[str, Any] = {"mode": "oauth2", "access_token": bearer}
        who = _call_x_json(
            creds,
            "GET",
            f"{twitter_link_service.API_BASE}/users/by/username/{str(source_username).strip().lstrip('@')}",
            params={"user.fields": "username,name"},
            timeout=30,
        )
        source_user_id = str((who.get("data") or {}).get("id") or "").strip()
    else:
        creds = twitter_link_service.get_user_auth(user_id, account_username=source_username)
        source = _account_summary(user_id, source_username)
        source_user_id = str(source.get("twitter_user_id") or creds.get("twitter_user_id") or "").strip()
    if not source_user_id:
        raise RuntimeError(f"Connected X account @{source_username.lstrip('@')} is missing a twitter_user_id.")
    params: dict[str, Any] = {
        "max_results": max(5, min(int(max_results), 25)),
        "tweet.fields": "created_at,conversation_id,referenced_tweets",
    }
    if since_id:
        params["since_id"] = str(since_id).strip()
    payload = _call_x_json(
        creds,
        "GET",
        f"{twitter_link_service.API_BASE}/users/{source_user_id}/tweets",
        params=params,
        timeout=30,
    )
    rows = payload.get("data") or []
    return [row for row in rows if isinstance(row, dict) and row.get("id")]


def repost_post(user_id: str, *, repost_as_username: str, tweet_id: str) -> dict[str, Any]:
    env_creds = _env_repost_creds()
    if env_creds and str(repost_as_username).strip().lstrip("@").lower() == DEFAULT_REPOST_AS_USERNAME.lower():
        creds = env_creds
        try:
            actor = _account_summary(user_id, repost_as_username)
        except RuntimeError:
            actor = {"username": repost_as_username.lstrip("@")}
        actor_user_id = str(actor.get("twitter_user_id") or "").strip()
        if not actor_user_id:
            bearer = _bearer_token()
            if not bearer:
                raise RuntimeError(
                    "A1 env write tokens are set, but the repost actor id is unknown. "
                    "Connect the A1 primary account in the vault or set X_A1_PROJECTS_BEARER_TOKEN."
                )
            who = _call_x_json(
                {"mode": "oauth2", "access_token": bearer},
                "GET",
                f"{twitter_link_service.API_BASE}/users/by/username/{str(repost_as_username).strip().lstrip('@')}",
                params={"user.fields": "username,name"},
                timeout=30,
            )
            actor_user_id = str((who.get("data") or {}).get("id") or "").strip()
    else:
        creds = twitter_link_service.get_user_auth(user_id, account_username=repost_as_username)
        actor = _account_summary(user_id, repost_as_username)
        actor_user_id = str(actor.get("twitter_user_id") or creds.get("twitter_user_id") or "").strip()
    if not actor_user_id:
        raise RuntimeError(f"Connected X account @{repost_as_username.lstrip('@')} is missing a twitter_user_id.")
    try:
        payload = _call_x_json(
            creds,
            "POST",
            f"{twitter_link_service.API_BASE}/users/{actor_user_id}/retweets",
            json_body={"tweet_id": str(tweet_id)},
            timeout=30,
        )
    except RuntimeError as exc:
        detail = str(exc).lower()
        if "already" in detail and ("retweet" in detail or "repost" in detail):
            return {
                "tweet_id": str(tweet_id),
                "reposted": False,
                "duplicate": True,
                "actor_username": actor.get("username") or repost_as_username.lstrip("@"),
            }
        raise
    data = payload.get("data") or {}
    return {
        "tweet_id": str(tweet_id),
        "reposted": bool(data.get("retweeted", True)),
        "actor_username": actor.get("username") or repost_as_username.lstrip("@"),
    }


def poll_and_repost(
    user_id: str,
    *,
    source_username: str = DEFAULT_SOURCE_USERNAME,
    repost_as_username: str = DEFAULT_REPOST_AS_USERNAME,
    dry_run: bool = False,
) -> dict[str, Any]:
    if not enabled():
        return {
            "ok": True,
            "skipped": True,
            "reason": "disabled",
            "repost_as_username": repost_as_username.lstrip("@"),
            "source_username": source_username.lstrip("@"),
        }
    state = load_state(
        user_id,
        repost_as_username=repost_as_username,
        source_username=source_username,
    )
    since_id = str(state.get("last_seen_id") or "").strip() or None
    recent = fetch_recent_posts(
        user_id,
        source_username=source_username,
        since_id=since_id,
        max_results=10,
    )
    if not recent:
        state["last_run_at"] = _now_iso()
        save_state(
            user_id,
            repost_as_username=repost_as_username,
            source_username=source_username,
            state=state,
        )
        return {
            "ok": True,
            "dry_run": bool(dry_run),
            "repost_as_username": repost_as_username.lstrip("@"),
            "source_username": source_username.lstrip("@"),
            "fetched": 0,
            "reposted": 0,
            "tweet_ids": [],
        }

    ordered = sorted(
        recent,
        key=lambda row: (
            str(row.get("created_at") or ""),
            int(str(row.get("id") or "0")),
        ),
    )
    seen_ids = [str(item) for item in list(state.get("reposted_ids") or []) if item]
    seen_set = set(seen_ids)
    reposted: list[str] = []
    for row in ordered:
        tweet_id = str(row.get("id") or "").strip()
        if not tweet_id or tweet_id in seen_set:
            continue
        if not dry_run:
            repost_post(user_id, repost_as_username=repost_as_username, tweet_id=tweet_id)
        reposted.append(tweet_id)
        seen_set.add(tweet_id)

    newest_id = str(recent[0].get("id") or "").strip()
    state["last_seen_id"] = newest_id or state.get("last_seen_id")
    state["last_run_at"] = _now_iso()
    if reposted:
        state["last_reposted_at"] = _now_iso()
    state["reposted_ids"] = (seen_ids + reposted)[-200:]
    save_state(
        user_id,
        repost_as_username=repost_as_username,
        source_username=source_username,
        state=state,
    )
    return {
        "ok": True,
        "dry_run": bool(dry_run),
        "repost_as_username": repost_as_username.lstrip("@"),
        "source_username": source_username.lstrip("@"),
        "fetched": len(recent),
        "reposted": len(reposted),
        "tweet_ids": reposted,
        "last_seen_id": state.get("last_seen_id"),
        "state_path": str(state_path(user_id, repost_as_username=repost_as_username, source_username=source_username)),
    }


def resolve_user_id(*, user_id: str | None = None, email: str | None = None, username: str | None = None) -> str:
    uid = str(user_id or "").strip()
    if uid:
        return uid
    with get_conn() as conn:
        if email:
            row = conn.execute(
                "SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1",
                (str(email).strip(),),
            ).fetchone()
            if row:
                return str(row["id"])
        if username:
            row = conn.execute(
                "SELECT id FROM users WHERE lower(handle) = lower(?) OR lower(display_name) = lower(?) LIMIT 1",
                (str(username).strip().lstrip("@"), str(username).strip()),
            ).fetchone()
            if row:
                return str(row["id"])
    raise RuntimeError("Could not resolve the Render Studio user for the repost job.")
