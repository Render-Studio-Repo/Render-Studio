"""Post Render3D product updates to LinkedIn (member or organization).

Env:
  LINKEDIN_ACCESS_TOKEN   — OAuth access token with w_member_social and/or w_organization_social
  LINKEDIN_AUTHOR_URN     — urn:li:person:… or urn:li:organization:…
  LINKEDIN_ENABLED        — optional, default true when token+author set
"""

from __future__ import annotations

import json
import mimetypes
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

API_BASE = "https://api.linkedin.com"
REST_BASE = f"{API_BASE}/rest"
USER_AGENT = "Render3DUpdatesBot (https://render3d.app, 1.0)"
POSTED_STATE = ROOT_DIR / "data" / "linkedin_posted_updates.json"
PUBLIC_BASE = (getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
LINKEDIN_VERSION = "202401"


def _token() -> str:
    return (getattr(settings, "linkedin_access_token", None) or "").strip()


def _author_urn() -> str:
    return (getattr(settings, "linkedin_author_urn", None) or "").strip()


def configured() -> bool:
    enabled = str(getattr(settings, "linkedin_enabled", True) or True).strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return False
    return bool(_token() and _author_urn())


def _load_posted() -> set[str]:
    if not POSTED_STATE.is_file():
        return set()
    try:
        data = json.loads(POSTED_STATE.read_text(encoding="utf-8"))
        ids = data.get("ids") if isinstance(data, dict) else data
        return {str(x) for x in (ids or []) if x}
    except Exception:
        return set()


def _save_posted(ids: set[str]) -> None:
    POSTED_STATE.parent.mkdir(parents=True, exist_ok=True)
    POSTED_STATE.write_text(
        json.dumps(
            {
                "ids": sorted(ids),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _headers(*, json_body: bool = True, rest: bool = True) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {_token()}",
        "User-Agent": USER_AGENT,
        "X-Restli-Protocol-Version": "2.0.0",
    }
    if rest:
        h["LinkedIn-Version"] = LINKEDIN_VERSION
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def _request(
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, str]]:
    data: bytes | None
    if body is None:
        data = None
    elif isinstance(body, (bytes, bytearray)):
        data = bytes(body)
    else:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers or _headers())
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8") or ""
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            if not raw:
                return None, hdrs
            try:
                return json.loads(raw), hdrs
            except json.JSONDecodeError:
                return {"raw": raw}, hdrs
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8", errors="replace")[:1200]
        except Exception:
            pass
        raise RuntimeError(f"LinkedIn API {err.code}: {detail or err}") from err


def connection_status() -> dict[str, Any]:
    out: dict[str, Any] = {
        "configured": configured(),
        "author_urn": _author_urn() or None,
        "error": None,
    }
    if not configured():
        out["error"] = "Missing LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN"
        return out
    try:
        # Lightweight identity check for person tokens; org tokens may 403 here.
        me, _ = _request(
            f"{API_BASE}/v2/userinfo",
            headers=_headers(json_body=False, rest=False),
        )
        out["userinfo"] = me
    except Exception as err:
        out["note"] = str(err)
    return out


def _absolute_url(path: str | None) -> str | None:
    if not path:
        return None
    p = str(path).strip()
    if not p:
        return None
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if not p.startswith("/"):
        p = "/" + p
    return f"{PUBLIC_BASE}{p}"


def build_commentary(update: dict[str, Any]) -> str:
    """Prefer an explicit linkedin body; else compose from title/summary."""
    explicit = str(update.get("linkedin") or update.get("linkedin_text") or "").strip()
    if explicit:
        return explicit[:2800]
    title = str(update.get("title") or update.get("id") or "Update").strip()
    summary = str(update.get("summary") or "").strip()
    kind = str(update.get("kind") or "feature").strip().lower() or "feature"
    kind_label = {
        "feature": "Feature",
        "tool": "Tool",
        "fix": "Fix",
        "improve": "Improve",
    }.get(kind, kind.title())
    href = _absolute_url(update.get("href") or "/updates.html")
    parts = [f"**{kind_label}**", "", f"New in Render3D — {title}"]
    if summary:
        parts.append("")
        parts.append(summary)
    if href:
        parts.append("")
        parts.append(f"Try it: {href}")
        parts.append(f"Updates: {PUBLIC_BASE}/updates.html")
    parts.append("")
    parts.append("#Render3D #CAD #AI")
    return "\n".join(parts)[:2800]


def _register_image(path: Path) -> str | None:
    """Upload a still image and return a digitalmediaAsset URN, or None."""
    if not path.is_file():
        return None
    suffix = path.suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        # LinkedIn feed media prefers still images; skip GIFs for now.
        return None
    author = _author_urn()
    register_body = {
        "registerUploadRequest": {
            "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
            "owner": author,
            "serviceRelationships": [
                {
                    "relationshipType": "OWNER",
                    "identifier": "urn:li:userGeneratedContent",
                }
            ],
        }
    }
    reg, _ = _request(
        f"{API_BASE}/v2/assets?action=registerUpload",
        method="POST",
        body=register_body,
        headers=_headers(rest=False),
    )
    if not isinstance(reg, dict):
        return None
    value = reg.get("value") or {}
    asset = value.get("asset")
    upload_mech = (value.get("uploadMechanism") or {}).get(
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ) or {}
    upload_url = upload_mech.get("uploadUrl")
    if not asset or not upload_url:
        return None
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    req = urllib.request.Request(
        upload_url,
        data=path.read_bytes(),
        method="PUT",
        headers={
            "Authorization": f"Bearer {_token()}",
            "Content-Type": mime,
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(req, timeout=120):
        pass
    return str(asset)


def announce_text(content: str, *, media_path: str | Path | None = None) -> dict[str, Any]:
    text = str(content or "").strip()
    if not text:
        raise ValueError("content is required")
    if not configured():
        return {"ok": False, "skipped": True, "reason": "not_configured"}

    author = _author_urn()
    media_urn = None
    if media_path:
        media_urn = _register_image(Path(media_path))

    if media_urn:
        body = {
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text[:2800]},
                    "shareMediaCategory": "IMAGE",
                    "media": [
                        {
                            "status": "READY",
                            "description": {"text": "Render3D update"},
                            "media": media_urn,
                            "title": {"text": "Render3D"},
                        }
                    ],
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
    else:
        body = {
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text[:2800]},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }

    result, hdrs = _request(
        f"{API_BASE}/v2/ugcPosts",
        method="POST",
        body=body,
        headers=_headers(rest=False),
    )
    post_id = None
    if isinstance(result, dict):
        post_id = result.get("id")
    if not post_id:
        post_id = hdrs.get("x-restli-id") or hdrs.get("x-linkedin-id")
    return {"ok": True, "skipped": False, "post_id": post_id, "media": bool(media_urn)}


def announce_update(update: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
    if not configured():
        return {"ok": False, "skipped": True, "reason": "not_configured"}
    uid = str(update.get("id") or "").strip()
    posted = _load_posted()
    if uid and uid in posted and not force:
        return {"ok": True, "skipped": True, "reason": "already_posted", "id": uid}

    media = update.get("media") or update.get("visual_file") or update.get("gif_path")
    commentary = build_commentary(update)
    result = announce_text(commentary, media_path=media)
    if result.get("ok") and not result.get("skipped") and uid:
        posted.add(uid)
        _save_posted(posted)
    result["id"] = uid or None
    return result


def announce_updates(updates: list[dict[str, Any]], *, force: bool = False) -> dict[str, Any]:
    results = []
    for row in updates:
        try:
            results.append(announce_update(row, force=force))
        except Exception as err:
            results.append({"ok": False, "id": row.get("id"), "error": str(err)})
    return {
        "ok": all(r.get("ok") for r in results) if results else True,
        "posted": sum(1 for r in results if r.get("ok") and not r.get("skipped")),
        "skipped": sum(1 for r in results if r.get("skipped")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "results": results,
    }
