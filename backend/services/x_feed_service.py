"""Public combined X timeline for the Updates page (@a1_projects + @winstead_works).

Uses the app Bearer token server-side only. Never return credentials in JSON.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.config import ROOT_DIR, settings

logger = logging.getLogger("render3d.x_feed")

API_BASE = "https://api.twitter.com/2"
FX_BASE = "https://api.fxtwitter.com"
HANDLES = ("a1_projects", "winstead_works")
CACHE_PATH = ROOT_DIR / "data" / "x_feed_cache_v2.json"
CACHE_TTL_SEC = 8 * 60
PAGE_SIZE = 100
MAX_PAGES_PER_USER = 2
MAX_MERGED = 200
MAX_PER_USER = MAX_MERGED
TIMEOUT = 18.0

_lock = threading.Lock()
_memory: dict[str, Any] | None = None
_memory_at = 0.0

_USER_FIELDS = "name,username,profile_image_url,verified,protected"
_TWEET_FIELDS = "created_at,lang,entities,attachments,public_metrics,referenced_tweets,conversation_id"
_MEDIA_FIELDS = "type,url,preview_image_url,width,height,alt_text"


def _bearer() -> str:
    return (getattr(settings, "twitter_bearer_token", None) or "").strip()


def configured() -> bool:
    return bool(_bearer())


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_bearer()}",
        "User-Agent": "RenderStudioUpdatesXFeed/1.0",
    }


def _load_disk_cache() -> dict[str, Any] | None:
    try:
        if not CACHE_PATH.is_file():
            return None
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("tweets"), list):
            return data
    except Exception:
        logger.warning("x-feed disk cache unreadable")
    return None


def _save_disk_cache(payload: dict[str, Any]) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logger.warning("x-feed disk cache not written")


def _bigger_avatar(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    return raw.replace("_normal.", "_bigger.").replace("_normal.", "_x96.")


def _expand_text(tweet: dict[str, Any]) -> str:
    text = str(tweet.get("text") or "")
    entities = tweet.get("entities") if isinstance(tweet.get("entities"), dict) else {}
    urls = entities.get("urls") if isinstance(entities.get("urls"), list) else []
    for row in urls:
        if not isinstance(row, dict):
            continue
        short = str(row.get("url") or "")
        display = str(row.get("expanded_url") or row.get("display_url") or short)
        # Drop trailing media t.co links when media is shown separately.
        if row.get("media_key") or "/status/" in display and display.endswith("/photo/1"):
            if short:
                text = text.replace(short, "").rstrip()
            continue
        if short and display and short in text:
            text = text.replace(short, display)
    return " ".join(text.split()).strip()


def _media_items(tweet: dict[str, Any], media_by_key: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    attachments = tweet.get("attachments") if isinstance(tweet.get("attachments"), dict) else {}
    keys = attachments.get("media_keys") if isinstance(attachments.get("media_keys"), list) else []
    out: list[dict[str, str]] = []
    for key in keys:
        media = media_by_key.get(str(key)) or {}
        kind = str(media.get("type") or "")
        src = str(media.get("url") or media.get("preview_image_url") or "").strip()
        if not src:
            continue
        out.append({
            "type": kind or "photo",
            "src": src,
            "alt": str(media.get("alt_text") or ""),
        })
        if len(out) >= 2:
            break
    return out


def _normalize_user(user: dict[str, Any]) -> dict[str, str]:
    username = str(user.get("username") or "").lstrip("@")
    return {
        "id": str(user.get("id") or ""),
        "name": str(user.get("name") or username),
        "username": username,
        "avatar": _bigger_avatar(str(user.get("avatar") or user.get("profile_image_url") or "")),
        "url": f"https://x.com/{username}" if username else "",
        "verified": bool(user.get("verified")),
    }


def _lookup_user(client: httpx.Client, handle: str) -> dict[str, Any]:
    resp = client.get(
        f"{API_BASE}/users/by/username/{handle}",
        params={"user.fields": _USER_FIELDS},
        headers=_auth_headers(),
        timeout=TIMEOUT,
    )
    if resp.status_code == 429:
        raise RuntimeError("rate_limited")
    if resp.status_code >= 400:
        raise RuntimeError(f"user_lookup_{resp.status_code}")
    data = resp.json() if resp.content else {}
    user = data.get("data") if isinstance(data, dict) else None
    if not isinstance(user, dict) or not user.get("id"):
        raise RuntimeError("user_not_found")
    return user


def _user_tweets(client: httpx.Client, user_id: str) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    tweets: list[dict[str, Any]] = []
    media_by_key: dict[str, dict[str, Any]] = {}
    token = ""
    for _ in range(MAX_PAGES_PER_USER):
        params: dict[str, Any] = {
            "max_results": min(100, PAGE_SIZE),
            "exclude": "replies",
            "tweet.fields": _TWEET_FIELDS,
            "expansions": "attachments.media_keys",
            "media.fields": _MEDIA_FIELDS,
        }
        if token:
            params["pagination_token"] = token
        resp = client.get(
            f"{API_BASE}/users/{user_id}/tweets",
            params=params,
            headers=_auth_headers(),
            timeout=TIMEOUT,
        )
        if resp.status_code == 429:
            raise RuntimeError("rate_limited")
        if resp.status_code >= 400:
            raise RuntimeError(f"tweets_{resp.status_code}")
        payload = resp.json() if resp.content else {}
        rows = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(rows, list):
            tweets.extend(row for row in rows if isinstance(row, dict))
        includes = payload.get("includes") if isinstance(payload, dict) else {}
        media_list = includes.get("media") if isinstance(includes, dict) else []
        if isinstance(media_list, list):
            for media in media_list:
                if isinstance(media, dict) and media.get("media_key"):
                    media_by_key[str(media["media_key"])] = media
        meta = payload.get("meta") if isinstance(payload, dict) else {}
        token = str((meta or {}).get("next_token") or "").strip()
        if not token or len(tweets) >= MAX_MERGED:
            break
    return tweets[:MAX_MERGED], media_by_key


def _iso_from_fx(item: dict[str, Any]) -> str:
    ts = item.get("created_timestamp")
    try:
        if ts is not None:
            return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except Exception:
        pass
    raw = str(item.get("created_at") or "").strip()
    if not raw:
        return ""
    try:
        from email.utils import parsedate_to_datetime

        return parsedate_to_datetime(raw).astimezone(timezone.utc).isoformat()
    except Exception:
        return raw


def _fx_media(item: dict[str, Any]) -> list[dict[str, str]]:
    media = item.get("media") if isinstance(item.get("media"), dict) else {}
    rows = []
    for key in ("photos", "videos", "all"):
        chunk = media.get(key)
        if isinstance(chunk, list):
            rows.extend(chunk)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for media_item in rows:
        if not isinstance(media_item, dict):
            continue
        src = str(
            media_item.get("url")
            or media_item.get("thumbnail_url")
            or media_item.get("preview_image_url")
            or ""
        ).strip()
        if not src or src in seen:
            continue
        seen.add(src)
        out.append({
            "type": str(media_item.get("type") or "photo"),
            "src": src,
            "alt": str(media_item.get("alt_text") or media_item.get("alt") or ""),
        })
        if len(out) >= 2:
            break
    return out


def _from_fx_item(item: dict[str, Any], fallback_handle: str) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    if item.get("replying_to"):
        return None
    tid = str(item.get("id") or "").strip()
    text = str(item.get("text") or item.get("raw_text") or "").strip()
    if isinstance(item.get("raw_text"), dict):
        text = str(item["raw_text"].get("text") or text).strip()
    if not tid or not text:
        return None
    author_raw = item.get("author") if isinstance(item.get("author"), dict) else {}
    username = str(author_raw.get("screen_name") or fallback_handle).lstrip("@")
    profile = _normalize_user({
        "id": author_raw.get("id"),
        "name": author_raw.get("name") or username,
        "username": username,
        "profile_image_url": author_raw.get("avatar_url") or "",
        "verified": bool((author_raw.get("verification") or {}).get("verified")) if isinstance(author_raw.get("verification"), dict) else False,
    })
    return {
        "id": tid,
        "text": text,
        "created_at": _iso_from_fx(item),
        "url": str(item.get("url") or f"https://x.com/{username}/status/{tid}"),
        "author": profile,
        "media": _fx_media(item),
    }


def _fetch_fx_handle(client: httpx.Client, handle: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    tweets: list[dict[str, Any]] = []
    profile = _normalize_user({"username": handle})
    cursor = ""
    for _ in range(MAX_PAGES_PER_USER):
        params: dict[str, Any] = {"count": min(100, PAGE_SIZE)}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(
            f"{FX_BASE}/2/profile/{handle}/statuses",
            params=params,
            headers={"User-Agent": "RenderStudioUpdatesXFeed/1.0"},
            timeout=TIMEOUT,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"fx_{resp.status_code}")
        payload = resp.json() if resp.content else {}
        results = payload.get("results") if isinstance(payload, dict) else None
        for item in results if isinstance(results, list) else []:
            row = _from_fx_item(item, handle)
            if not row:
                continue
            tweets.append(row)
            profile = row["author"]
        next_cursor = payload.get("cursor") if isinstance(payload, dict) else {}
        cursor = str((next_cursor or {}).get("bottom") or "").strip()
        if not cursor or len(tweets) >= MAX_MERGED:
            break
    return profile, tweets[:MAX_MERGED]


def _official_handle(client: httpx.Client, handle: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    user = _lookup_user(client, handle)
    profile = _normalize_user(user)
    rows, media_by_key = _user_tweets(client, str(user["id"]))
    tweets: list[dict[str, Any]] = []
    for tweet in rows:
        if not isinstance(tweet, dict) or not tweet.get("id"):
            continue
        tid = str(tweet.get("id"))
        tweets.append({
            "id": tid,
            "text": _expand_text(tweet),
            "created_at": str(tweet.get("created_at") or ""),
            "url": f"https://x.com/{profile['username']}/status/{tid}",
            "author": profile,
            "media": _media_items(tweet, media_by_key),
        })
    return profile, tweets


def _fetch_live() -> dict[str, Any]:
    errors: list[str] = []
    profiles: list[dict[str, Any]] = []
    tweets: list[dict[str, Any]] = []
    source = "none"

    with httpx.Client() as client:
        for handle in HANDLES:
            got = False
            if configured():
                try:
                    profile, rows = _official_handle(client, handle)
                    profiles.append(profile)
                    tweets.extend(rows)
                    source = "x_api"
                    got = True
                except Exception as err:
                    errors.append(f"{handle}:{err}")
                    logger.warning("x-feed official fetch failed for %s (%s)", handle, err)
            if not got:
                try:
                    profile, rows = _fetch_fx_handle(client, handle)
                    profiles.append(profile)
                    tweets.extend(rows)
                    if source != "x_api":
                        source = "fxtwitter"
                    got = True
                except Exception as err:
                    errors.append(f"{handle}:{err}")
                    logger.warning("x-feed fallback fetch failed for %s (%s)", handle, err)
                    profiles.append(_normalize_user({"username": handle}))

    tweets.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    ok = bool(tweets)
    reason = ""
    if not ok:
        joined = " ".join(errors)
        if "rate_limited" in joined:
            reason = "rate_limited"
        elif not configured() and not tweets:
            reason = "not_configured" if not any("fx_" in e for e in errors) else "fetch_failed"
        elif errors:
            reason = "fetch_failed"
        else:
            reason = "empty"
    return {
        "ok": ok,
        "reason": reason,
        "source": source,
        "handles": list(HANDLES),
        "profiles": profiles,
        "tweets": tweets[:MAX_MERGED],
        "total": min(len(tweets), MAX_MERGED),
        "fetched_at": int(time.time()),
        "cached": False,
        "errors": errors[:8],
    }


def _page(payload: dict[str, Any], offset: int, limit: int) -> dict[str, Any]:
    tweets = payload.get("tweets") if isinstance(payload.get("tweets"), list) else []
    total = min(len(tweets), MAX_MERGED)
    start = max(0, int(offset))
    size = max(1, min(int(limit), MAX_MERGED))
    chunk = tweets[start : start + size]
    out = dict(payload)
    out["tweets"] = chunk
    out["offset"] = start
    out["limit"] = size
    out["total"] = total
    out["has_more"] = start + len(chunk) < total
    out["max"] = MAX_MERGED
    return out


def public_feed(*, force: bool = False, offset: int = 0, limit: int = 40) -> dict[str, Any]:
    """Merged chronological tweets. Serves memory/disk cache on errors or TTL hit."""
    global _memory, _memory_at
    now = time.time()
    with _lock:
        if not force and _memory and (now - _memory_at) < CACHE_TTL_SEC:
            out = dict(_memory)
            out["cached"] = True
            return _page(out, offset, limit)
        disk = _load_disk_cache()
        if not force and disk and (now - float(disk.get("fetched_at") or 0)) < CACHE_TTL_SEC:
            _memory = disk
            _memory_at = now
            out = dict(disk)
            out["cached"] = True
            return _page(out, offset, limit)
        try:
            live = _fetch_live()
        except Exception:
            logger.exception("x-feed live fetch crashed")
            live = {
                "ok": False,
                "reason": "fetch_failed",
                "handles": list(HANDLES),
                "tweets": [],
                "profiles": [_normalize_user({"username": h}) for h in HANDLES],
                "fetched_at": int(now),
                "cached": False,
                "errors": ["crash"],
            }

        if live.get("ok") and live.get("tweets"):
            _memory = live
            _memory_at = now
            _save_disk_cache(live)
            return _page(live, offset, limit)

        stale = _memory or disk
        if stale and stale.get("tweets"):
            out = dict(stale)
            out["cached"] = True
            out["stale"] = True
            out["reason"] = live.get("reason") or out.get("reason") or "stale"
            return _page(out, offset, limit)
        return _page(live, offset, limit)
