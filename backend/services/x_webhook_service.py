"""X Account Activity webhook: CRC handshake, HMAC verify, Grok bot inbound.

Public URLs (FastAPI on :8001, host render3d.app):
  GET/POST https://render3d.app/api/webhooks/x
  GET/POST https://render3d.app/api/x/webhook

CRC (GET ?crc_token=): HMAC-SHA256 of the token with the app Consumer Secret,
then ``{"response_token": "sha256=<base64>"}``.

POST: header ``X-Twitter-Webhooks-Signature`` is HMAC-SHA256 of the raw body
with the same secret. Mentions/DMs go to ``grok_bot_service`` (draft replies;
live posts only when X_WEBHOOK_AUTO_REPLY is true).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import Any

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.x_webhook")

DEFAULT_PATH = "/api/webhooks/x"
ALIAS_PATH = "/api/x/webhook"
# Extra public paths in case the X portal was saved without /api
EXTRA_PATHS = ("/webhooks/x", "/webhooks/twitter", "/api/twitter/webhook")
SIGNATURE_HEADER = "x-twitter-webhooks-signature"


class WebhookConfigError(RuntimeError):
    """Consumer secret missing — CRC / signature cannot run."""


class WebhookSignatureError(RuntimeError):
    """POST failed HMAC verification."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def webhook_path() -> str:
    raw = str(getattr(settings, "x_webhook_path", None) or DEFAULT_PATH).strip() or DEFAULT_PATH
    if not raw.startswith("/"):
        raw = "/" + raw
    return raw


def webhook_paths() -> tuple[str, ...]:
    paths = [DEFAULT_PATH, ALIAS_PATH, *EXTRA_PATHS]
    custom = webhook_path()
    if custom not in paths:
        paths.append(custom)
    return tuple(paths)


def public_url(path: str | None = None) -> str:
    base = (getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
    return f"{base}{path or webhook_path()}"


def consumer_key() -> str:
    return (
        str(getattr(settings, "x_consumer_key", None) or "").strip()
        or str(getattr(settings, "twitter_client_id", None) or "").strip()
    )


def consumer_secret() -> str:
    """App Consumer Secret for CRC + POST HMAC.

    Prefer X_CONSUMER_SECRET; fall back to TWITTER_CLIENT_SECRET (OAuth 1.0a
    API Key Secret on this host).
    """
    return (
        str(getattr(settings, "x_consumer_secret", None) or "").strip()
        or str(getattr(settings, "twitter_client_secret", None) or "").strip()
    )


def require_consumer_secret() -> str:
    secret = consumer_secret()
    if not secret:
        raise WebhookConfigError(
            "X webhook needs X_CONSUMER_SECRET or TWITTER_CLIENT_SECRET (Consumer Key Secret)."
        )
    return secret


def hmac_sha256_b64(secret: str, message: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def crc_response_token(crc_token: str, secret: str) -> str:
    token = str(crc_token or "")
    return "sha256=" + hmac_sha256_b64(secret, token.encode("utf-8"))


def crc_response(crc_token: str, secret: str | None = None) -> dict[str, str]:
    return {"response_token": crc_response_token(crc_token, secret or require_consumer_secret())}


def signature_header_value(body: bytes, secret: str) -> str:
    return "sha256=" + hmac_sha256_b64(secret, body)


def verify_signature(body: bytes, header: str | None, secret: str | None = None) -> bool:
    key = secret if secret is not None else require_consumer_secret()
    expected = signature_header_value(body, key)
    got = str(header or "").strip()
    if not got or len(got) != len(expected):
        return False
    return hmac.compare_digest(got, expected)


def health() -> dict[str, Any]:
    secret_ready = bool(consumer_secret())
    return {
        "ok": True,
        "service": "x-account-activity",
        "path": webhook_path(),
        "paths": list(webhook_paths()),
        "public_url": public_url(),
        "crc": "GET with crc_token → {response_token: sha256=...}",
        "signature_header": "X-Twitter-Webhooks-Signature",
        "consumer_secret_configured": secret_ready,
        "consumer_key_configured": bool(consumer_key()),
    }


def crc_token_from_query(raw_qs: str | bytes | None, fallback: str | None = None) -> str:
    """Read crc_token without treating ``+`` as space.

    Starlette/FastAPI use form decoding (``+`` → space). X's crc_token is often
    base64-ish and includes ``+``; HMAC of the spaced string fails CRC.
    ``unquote`` keeps ``+`` and still decodes ``%XX``.
    """
    if isinstance(raw_qs, bytes):
        qs = raw_qs.decode("latin-1", errors="replace")
    else:
        qs = str(raw_qs or "")
    for part in qs.split("&"):
        if not part:
            continue
        key, _, val = part.partition("=")
        if urllib.parse.unquote(key) == "crc_token":
            return urllib.parse.unquote(val)
    return str(fallback or "")


def handle_crc(crc_token: str | None, raw_qs: str | bytes | None = None) -> dict[str, Any]:
    token = crc_token_from_query(raw_qs, fallback=crc_token)
    if not token:
        return health()
    return crc_response(token)


def ensure_event_log() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS x_webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                received_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                twitter_user_id TEXT,
                tweet_id TEXT,
                handled TEXT,
                error TEXT
            )
            """
        )


def _log_event(kind: str, twitter_user_id: str, tweet_id: str, handled: str, error: str = "") -> None:
    try:
        ensure_event_log()
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO x_webhook_events
                  (received_at, kind, twitter_user_id, tweet_id, handled, error)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (_now(), kind, twitter_user_id or None, tweet_id or None, handled, error[:240] if error else None),
            )
    except Exception:
        logger.debug("x webhook event log skipped", exc_info=True)


def _tweet_text(tweet: dict[str, Any]) -> str:
    extended = tweet.get("extended_tweet") if isinstance(tweet.get("extended_tweet"), dict) else {}
    return str(
        (extended or {}).get("full_text")
        or tweet.get("full_text")
        or tweet.get("text")
        or ""
    ).strip()


def _user_id(blob: Any) -> str:
    if isinstance(blob, dict):
        return str(blob.get("id_str") or blob.get("id") or "").strip()
    return str(blob or "").strip()


def extract_inbound_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Mentions and DMs, skipping the bot's own tweets/messages."""
    if not isinstance(payload, dict):
        return []
    for_user = str(payload.get("for_user_id") or "").strip()
    out: list[dict[str, Any]] = []
    for tweet in payload.get("tweet_create_events") or []:
        if not isinstance(tweet, dict):
            continue
        if tweet.get("retweeted_status"):
            continue
        author = _user_id(tweet.get("user"))
        if for_user and author and author == for_user:
            continue
        text = _tweet_text(tweet)
        if not text:
            continue
        out.append(
            {
                "kind": "mention",
                "text": text,
                "sender_id": author,
                "tweet_id": str(tweet.get("id_str") or tweet.get("id") or "").strip(),
                "for_user_id": for_user,
            }
        )
    for event in payload.get("direct_message_events") or []:
        if not isinstance(event, dict):
            continue
        created = event.get("message_create") if isinstance(event.get("message_create"), dict) else {}
        sender = str(created.get("sender_id") or "").strip()
        if for_user and sender and sender == for_user:
            continue
        data = created.get("message_data") if isinstance(created.get("message_data"), dict) else {}
        text = str(data.get("text") or "").strip()
        if not text:
            continue
        out.append(
            {
                "kind": "dm",
                "text": text,
                "sender_id": sender,
                "tweet_id": str(event.get("id") or "").strip(),
                "for_user_id": for_user,
            }
        )
    return out


def handle_post(body: bytes, signature_header: str | None) -> dict[str, Any]:
    secret = require_consumer_secret()
    if not verify_signature(body or b"", signature_header, secret):
        raise WebhookSignatureError("Invalid X-Twitter-Webhooks-Signature.")
    if not body:
        return {"ok": True, "events": 0}
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("x webhook POST body was not JSON")
        return {"ok": True, "events": 0, "skipped": "invalid_json"}
    if not isinstance(payload, dict):
        return {"ok": True, "events": 0, "skipped": "not_object"}
    messages = extract_inbound_messages(payload)
    handled: list[dict[str, Any]] = []
    if messages:
        from backend.services import grok_bot_service

        handled = grok_bot_service.handle_inbound_messages(messages)
    for item, result in zip(messages, handled):
        _log_event(
            str(item.get("kind") or ""),
            str(item.get("sender_id") or ""),
            str(item.get("tweet_id") or ""),
            str((result or {}).get("status") or "ok"),
            str((result or {}).get("error") or ""),
        )
    kinds = sorted({str(m.get("kind") or "") for m in messages})
    logger.info("x webhook accepted events=%s kinds=%s", len(messages), ",".join(kinds) or "-")
    return {
        "ok": True,
        "events": len(messages),
        "handled": handled,
        "for_user_id": str(payload.get("for_user_id") or ""),
    }
