"""Private Grok music + social analytics store.

Marketing/ is gitignored. If that folder is missing (CI), fall back to data/marketing/.
"""

from __future__ import annotations

import hmac
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request

from backend.config import settings
from backend.services import youtube_music_search as ytm

logger = logging.getLogger("render3d.marketing_social")

ROOT = Path(__file__).resolve().parents[2]
CHECKIN_DAYS = (1, 2, 3, 7, 14, 21, 28)
PLATFORMS = ("x", "instagram", "linkedin", "other")
_LOCK = threading.Lock()

DEFAULT_PLAYLIST = {
    "id": "render-hype",
    "title": "Render hype",
    "youtube_url": "https://www.youtube.com/watch?v=uHeQBDQlPD8&list=PLZ0LWy2i9_iOc2UpCVdloDeNiMBebMvCS",
}

PLATFORM_ADVICE = {
    "x": "X users reply when you end with a question. Ask one. Keep the first line a hook, not a caption dump.",
    "instagram": "Lead with a 3-second visual hook. Put the CTA in the first comment. Keep the on-screen text short.",
    "linkedin": "Lead with the product outcome, not the meme. First comment can carry the demo link.",
    "other": "Tighten the first line and add one clear ask (question, click, or reply).",
}


def advice_for(loser: str, winner: str = "") -> str:
    loser = str(loser or "other")
    winner = str(winner or "")
    base = PLATFORM_ADVICE.get(loser, PLATFORM_ADVICE["other"])
    if loser == "instagram" and winner == "x":
        return (
            "X won comments because people reply to a question. On Instagram add a question sticker "
            "or a first-comment ask, and keep the 3-second visual hook."
        )
    if loser == "x" and winner == "instagram":
        return "Ask a question at the end — X users comment on questions. Shorten the first line into a hook."
    return base


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_dt(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def marketing_root() -> Path:
    preferred = ROOT / "Marketing"
    if preferred.is_dir():
        return preferred
    fallback = ROOT / "data" / "marketing"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def music_dir() -> Path:
    configured = str(getattr(settings, "grok_music_library_dir", "") or "").strip()
    if configured:
        path = Path(configured)
        if not path.is_absolute():
            path = ROOT / configured
        path.mkdir(parents=True, exist_ok=True)
        return path
    path = marketing_root() / "Music" / "library"
    path.mkdir(parents=True, exist_ok=True)
    return path


def knowledge_dir() -> Path:
    path = marketing_root() / "knowledge"
    path.mkdir(parents=True, exist_ok=True)
    return path


def scripts_dir() -> Path:
    path = marketing_root() / "scripts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def state_path() -> Path:
    return marketing_root() / "Music" / "state.json"


def empty_state() -> dict[str, Any]:
    return {
        "tracks": {},
        "playlists": {},
        "requests": [],
        "posts": {},
        "weekly_reports": [],
        "knowledge": [],
        "script_runs": [],
    }


def _load() -> dict[str, Any]:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            merged = empty_state()
            merged.update(data)
            if not merged.get("playlists"):
                merged["playlists"][DEFAULT_PLAYLIST["id"]] = dict(DEFAULT_PLAYLIST, track_ids=[])
            return merged
    except (OSError, ValueError):
        pass
    state = empty_state()
    state["playlists"][DEFAULT_PLAYLIST["id"]] = dict(DEFAULT_PLAYLIST, track_ids=[])
    return state


def _save(state: dict[str, Any]) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def public_base() -> str:
    return str(getattr(settings, "public_base_url", "") or "https://render3d.app").rstrip("/")


def api_key() -> str:
    return str(getattr(settings, "grok_music_api_key", "") or "").strip()


def require_api_key(request: Request) -> None:
    key = api_key()
    if not key:
        raise HTTPException(503, "GROK_MUSIC_API_KEY is not set")
    auth = str(request.headers.get("authorization") or "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        token = str(request.headers.get("x-grok-music-key") or request.query_params.get("key") or "").strip()
    if not token or not hmac.compare_digest(token, key):
        raise HTTPException(401, "Invalid GROK_MUSIC_API_KEY")


def grok_playbook() -> dict[str, Any]:
    base = public_base()
    return {
        "for": "grok-bot",
        "never": [
            "Do not commit Marketing/ or GROK_MUSIC_API_KEY.",
            "Do not download clean/non-explicit, covers, or instrumentals.",
            "Do not post live tweets from a test.",
        ],
        "quality": {
            "prefer": "Official artist / Topic / VEVO. If missing, most popular remaining match.",
            "reject": "clean, non-explicit, censored, radio edit, cover, karaoke, instrumental",
        },
        "auth": "Authorization: Bearer GROK_MUSIC_API_KEY (or ?key= on audio/player URLs only)",
        "base": f"{base}/api/marketing/v1",
        "endpoints": {
            "request_song": f"POST {base}/api/marketing/v1/music/request",
            "playlist": f"GET {base}/api/marketing/v1/playlists",
            "library": f"GET {base}/api/marketing/v1/music/library",
            "player": f"{base}/api/marketing/v1/music/player/{{track_id}}",
            "mp3": f"{base}/api/marketing/v1/music/files/{{track_id}}.mp3",
            "attach_post": f"POST {base}/api/marketing/v1/posts",
            "checkin": f"POST {base}/api/marketing/v1/posts/{{post_id}}/checkin",
            "due": f"GET {base}/api/marketing/v1/checkins/due",
            "weekly": f"POST {base}/api/marketing/v1/reports/weekly",
            "knowledge": f"GET {base}/api/marketing/v1/knowledge",
            "taste": f"GET {base}/api/marketing/v1/taste",
        },
        "reason_values": ["x_post", "instagram_post", "linkedin_post", "other"],
        "checkin_cadence": "Days 1–3 after the post, then weekly for 4 weeks. Always include the live post URL, comments text, sentiment, and whether negativity or positivity drove views.",
        "mcp_tools": [
            "grok_music_request",
            "grok_music_library",
            "grok_social_post",
            "grok_social_checkin",
            "grok_social_weekly",
            "grok_taste",
        ],
        "local_docs": [
            str(marketing_root() / "GROK.md"),
            str(marketing_root() / "Music" / "GROK.md"),
        ],
    }


def track_urls(track_id: str) -> dict[str, str]:
    base = public_base()
    return {
        "download_url": f"{base}/api/marketing/v1/music/files/{track_id}.mp3",
        "player_url": f"{base}/api/marketing/v1/music/player/{track_id}",
    }


def public_track(track: dict[str, Any]) -> dict[str, Any]:
    tid = str(track.get("id") or "")
    out = {k: v for k, v in track.items() if k != "path"}
    out.update(track_urls(tid))
    return out


def library_payload() -> dict[str, Any]:
    with _LOCK:
        state = _load()
        tracks = [public_track(t) for t in state["tracks"].values()]
        tracks.sort(key=lambda t: (-int(t.get("request_count") or 0), str(t.get("title") or "")))
        playlists = []
        for pl in state["playlists"].values():
            items = [public_track(state["tracks"][tid]) for tid in pl.get("track_ids") or [] if tid in state["tracks"]]
            playlists.append({**pl, "tracks": items, "count": len(items)})
        return {"ok": True, "tracks": tracks, "playlists": playlists, "request_count": len(state["requests"])}


def _record_request(state: dict[str, Any], track_id: str, query: str, reason: str, reason_detail: str) -> dict[str, Any]:
    req = {
        "id": f"req_{uuid.uuid4().hex[:12]}",
        "track_id": track_id,
        "query": query,
        "reason": reason or "other",
        "reason_detail": reason_detail,
        "requested_at": now_iso(),
        "post_id": None,
    }
    state["requests"].append(req)
    track = state["tracks"].get(track_id)
    if track:
        track["request_count"] = int(track.get("request_count") or 0) + 1
        reasons = list(track.get("reasons") or [])
        reasons.append({"at": req["requested_at"], "reason": req["reason"], "detail": reason_detail})
        track["reasons"] = reasons[-40:]
    return req


def _ingest_download(state: dict[str, Any], downloaded: dict[str, Any], playlist_id: str | None = None) -> dict[str, Any]:
    tid = str(downloaded.get("id") or downloaded.get("youtube_id") or uuid.uuid4().hex[:11])
    src = Path(downloaded["path"])
    dest = music_dir() / f"{tid}.mp3"
    if src.resolve() != dest.resolve():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        if src.parent.resolve() != dest.parent.resolve() or src.name != dest.name:
            try:
                if src.name == f"{tid}.mp3" or src.parent == Path(tempfile.gettempdir()):
                    pass
            except OSError:
                pass
    existing = state["tracks"].get(tid) or {}
    track = {
        **existing,
        "id": tid,
        "title": downloaded.get("title") or existing.get("title") or "Untitled",
        "artist": downloaded.get("artist") or existing.get("artist") or "",
        "uploader": downloaded.get("uploader") or "",
        "youtube_id": downloaded.get("youtube_id") or tid,
        "youtube_url": downloaded.get("youtube_url") or "",
        "view_count": int(downloaded.get("view_count") or existing.get("view_count") or 0),
        "official": bool(downloaded.get("official")),
        "explicit": bool(downloaded.get("explicit")),
        "filename": dest.name,
        "path": str(dest),
        "request_count": int(existing.get("request_count") or 0),
        "reasons": list(existing.get("reasons") or []),
    }
    state["tracks"][tid] = track
    if playlist_id:
        pl = state["playlists"].setdefault(playlist_id, {"id": playlist_id, "title": playlist_id, "track_ids": []})
        ids = list(pl.get("track_ids") or [])
        if tid not in ids:
            ids.append(tid)
        pl["track_ids"] = ids
    return track


def request_song(
    *,
    query: str = "",
    url: str = "",
    playlist: str = "",
    reason: str = "other",
    reason_detail: str = "",
) -> dict[str, Any]:
    q = str(query or "").strip()
    url = str(url or "").strip()
    playlist = str(playlist or "").strip()
    reason = str(reason or "other").strip().lower() or "other"
    if reason not in {"x_post", "instagram_post", "linkedin_post", "other"}:
        reason = "other"
    if playlist.startswith("http"):
        url = playlist
        playlist = ""
    if not q and not url and not playlist:
        raise HTTPException(400, "Send query (song name), url, or playlist")
    if url and "list=" in url:
        return download_playlist(url, reason=reason, reason_detail=reason_detail)
    if playlist:
        return playlist_payload(playlist, reason=reason, reason_detail=reason_detail)
    with _LOCK:
        state = _load()
        if q:
            for track in state["tracks"].values():
                hay = f"{track.get('title')} {track.get('artist')}".lower()
                if q.lower() in hay:
                    req = _record_request(state, track["id"], q, reason, reason_detail)
                    _save(state)
                    return {"ok": True, "cached": True, "request": req, "track": public_track(track)}
    dest = music_dir()
    if url:
        downloaded = ytm.download_mp3(url, dest)
    else:
        downloaded = ytm.search_and_download(q, dest)
    with _LOCK:
        state = _load()
        track = _ingest_download(state, downloaded, playlist_id=None)
        req = _record_request(state, track["id"], q or url, reason, reason_detail)
        _save(state)
    return {
        "ok": True,
        "cached": False,
        "request": req,
        "track": public_track(track),
        "note": "Use player_url in the post workflow, then POST the live post URL when it is live.",
    }


def _playlist_match(state: dict[str, Any], needle: str) -> dict[str, Any] | None:
    raw = needle.strip().lower()
    for pl in state["playlists"].values():
        if pl.get("id") == needle or str(pl.get("title") or "").lower() == raw:
            return pl
        if raw and raw in str(pl.get("title") or "").lower():
            return pl
    return None


def playlist_payload(playlist_id: str, *, reason: str = "", reason_detail: str = "") -> dict[str, Any]:
    with _LOCK:
        state = _load()
        pl = state["playlists"].get(playlist_id) or _playlist_match(state, playlist_id)
        if not pl:
            raise HTTPException(404, "Unknown playlist")
        tracks = [public_track(state["tracks"][tid]) for tid in pl.get("track_ids") or [] if tid in state["tracks"]]
        if reason:
            for track in tracks:
                _record_request(state, track["id"], pl.get("title") or playlist_id, reason, reason_detail)
            _save(state)
    return {"ok": True, "playlist": {**pl, "tracks": tracks, "count": len(tracks)}}


def download_playlist(url: str, *, reason: str = "other", reason_detail: str = "") -> dict[str, Any]:
    listing, entries = ytm.list_playlist(url)
    slug = re.sub(r"[^a-z0-9]+", "-", str(listing.get("title") or "playlist").lower()).strip("-") or "playlist"
    dest = music_dir()
    imported: list[dict[str, Any]] = []
    failures: list[str] = []
    for entry in entries:
        if ytm.is_rejected(entry):
            continue
        try:
            downloaded = ytm.download_mp3(ytm.video_url(entry), dest)
        except Exception as exc:
            failures.append(f"{ytm.video_url(entry)}: {exc}")
            continue
        with _LOCK:
            state = _load()
            track = _ingest_download(state, downloaded, playlist_id=slug)
            state["playlists"][slug]["title"] = listing.get("title") or slug
            state["playlists"][slug]["youtube_url"] = url
            _record_request(state, track["id"], listing.get("title") or url, reason, reason_detail)
            _save(state)
        imported.append(public_track(track))
    return {
        "ok": True,
        "playlist_id": slug,
        "title": listing.get("title") or slug,
        "imported": len(imported),
        "failed": failures,
        "tracks": imported,
    }


def list_playlists() -> dict[str, Any]:
    return library_payload()


def mp3_path(track_id: str) -> Path:
    tid = str(track_id or "").replace(".mp3", "")
    with _LOCK:
        state = _load()
        track = state["tracks"].get(tid)
    if not track:
        raise HTTPException(404, "Track not found")
    path = Path(track.get("path") or music_dir() / f"{tid}.mp3")
    if not path.is_file():
        alt = music_dir() / f"{tid}.mp3"
        if alt.is_file():
            return alt
        raise HTTPException(404, "MP3 missing on disk")
    return path


def player_html(track_id: str, key: str = "") -> str:
    with _LOCK:
        state = _load()
        track = state["tracks"].get(str(track_id or "").replace(".mp3", ""))
    if not track:
        raise HTTPException(404, "Track not found")
    qs = f"?key={key}" if key else ""
    src = f"/api/marketing/v1/music/files/{track['id']}.mp3{qs}"
    reasons = track.get("reasons") or []
    last = reasons[-1] if reasons else {}
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(track.get("title"))}</title>
<style>
body{{margin:0;background:#000;color:#e7e9ea;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{max-width:640px;margin:40px auto;padding:24px}}
h1{{font-size:22px;margin:0 0 6px}}
p{{color:#71767b}}
audio{{width:100%;margin:18px 0}}
a{{color:#1d9bf0}}
.stat{{display:flex;gap:16px}}
</style></head><body>
<main>
  <h1>{_esc(track.get("title"))}</h1>
  <p>{_esc(track.get("artist"))} · {_esc(track.get("uploader"))}</p>
  <div class="stat"><span>{int(track.get("request_count") or 0)} Grok requests</span><span>last: {_esc(last.get("reason"))}</span></div>
  <audio controls src="{_esc(src)}"></audio>
  <p><a href="{_esc(src)}&download=1">Download MP3</a></p>
</main>
</body></html>"""


def _esc(value: Any) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _checkin_plan(posted_at: str) -> list[dict[str, Any]]:
    start = parse_dt(posted_at) or datetime.now(timezone.utc)
    plan = []
    for day in CHECKIN_DAYS:
        kind = f"d{day}" if day <= 3 else f"w{day // 7}"
        plan.append({"kind": kind, "due_at": (start + timedelta(days=day)).isoformat(), "done": False, "at": None})
    return plan


def attach_post(body: dict[str, Any]) -> dict[str, Any]:
    track_id = str(body.get("track_id") or "").strip()
    request_id = str(body.get("request_id") or "").strip()
    platform = str(body.get("platform") or "other").strip().lower()
    if platform not in PLATFORMS:
        platform = "other"
    post_url = str(body.get("post_url") or body.get("url") or "").strip()
    if not post_url:
        raise HTTPException(400, "post_url is required once the post is live")
    posted_at = str(body.get("posted_at") or now_iso())
    group = str(body.get("same_video_group") or body.get("video_fingerprint") or "").strip()
    with _LOCK:
        state = _load()
        if track_id and track_id not in state["tracks"]:
            raise HTTPException(404, "Unknown track_id")
        if request_id:
            for req in state["requests"]:
                if req.get("id") == request_id:
                    track_id = track_id or req.get("track_id")
                    break
        pid = str(body.get("id") or f"post_{uuid.uuid4().hex[:12]}")
        post = {
            "id": pid,
            "track_id": track_id,
            "request_id": request_id,
            "platform": platform,
            "post_url": post_url,
            "posted_at": posted_at,
            "same_video_group": group,
            "metrics": [],
            "comments": [],
            "analyses": [],
            "checkins": _checkin_plan(posted_at),
        }
        state["posts"][pid] = post
        if request_id:
            for req in state["requests"]:
                if req.get("id") == request_id:
                    req["post_id"] = pid
        _save(state)
    return {"ok": True, "post": post, "next": due_checkins()}


def checkin_post(post_id: str, body: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        state = _load()
        post = state["posts"].get(post_id)
        if not post:
            raise HTTPException(404, "Unknown post")
        metric = {
            "at": now_iso(),
            "views": int(body.get("views") or 0),
            "likes": int(body.get("likes") or 0),
            "comments_count": int(body.get("comments_count") or len(body.get("comments") or [])),
            "reposts": int(body.get("reposts") or body.get("shares") or 0),
            "impressions": int(body.get("impressions") or body.get("views") or 0),
            "engagement_rate": float(body.get("engagement_rate") or 0),
        }
        if not metric["engagement_rate"] and metric["impressions"]:
            engaged = metric["likes"] + metric["comments_count"] + metric["reposts"]
            metric["engagement_rate"] = round(engaged / metric["impressions"] * 100, 4)
        post["metrics"].append(metric)
        comments = []
        for row in body.get("comments") or []:
            if isinstance(row, str):
                comments.append({"text": row, "at": now_iso()})
            elif isinstance(row, dict) and row.get("text"):
                comments.append({"text": str(row.get("text")), "author": str(row.get("author") or ""), "at": now_iso()})
        if comments:
            post["comments"].extend(comments)
        sentiment = str(body.get("sentiment") or "mixed").lower()
        if sentiment not in {"positive", "negative", "mixed"}:
            sentiment = "mixed"
        viral_from = str(body.get("viral_from") or "").lower()
        if viral_from not in {"positive", "negative", "none"}:
            if sentiment == "negative" and metric["impressions"] > 0:
                viral_from = "negative"
            elif sentiment == "positive":
                viral_from = "positive"
            else:
                viral_from = "none"
        analysis = {
            "at": now_iso(),
            "why_good_or_bad": str(body.get("why_good_or_bad") or body.get("analysis") or ""),
            "sentiment": sentiment,
            "viral_from": viral_from,
            "advice": str(body.get("advice") or PLATFORM_ADVICE.get(post.get("platform"), "")),
        }
        post["analyses"].append(analysis)
        kind = str(body.get("kind") or "").strip()
        remaining = [c for c in post.get("checkins") or [] if not c.get("done")]
        target = None
        if kind:
            target = next((c for c in post["checkins"] if c.get("kind") == kind and not c.get("done")), None)
        if target is None and remaining:
            target = remaining[0]
        if target:
            target["done"] = True
            target["at"] = now_iso()
        _save(state)
    return {"ok": True, "post": post, "due": due_checkins()}


def due_checkins() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    due = []
    with _LOCK:
        state = _load()
        for post in state["posts"].values():
            for slot in post.get("checkins") or []:
                if slot.get("done"):
                    continue
                due_at = parse_dt(slot.get("due_at"))
                if due_at and due_at <= now + timedelta(hours=12):
                    due.append(
                        {
                            "post_id": post["id"],
                            "platform": post.get("platform"),
                            "post_url": post.get("post_url"),
                            "track_id": post.get("track_id"),
                            "kind": slot.get("kind"),
                            "due_at": slot.get("due_at"),
                        }
                    )
    due.sort(key=lambda r: str(r.get("due_at")))
    return {"ok": True, "due": due, "count": len(due)}


def submit_weekly_report(body: dict[str, Any]) -> dict[str, Any]:
    report = {
        "id": f"wk_{uuid.uuid4().hex[:10]}",
        "week_of": str(body.get("week_of") or now_iso()[:10]),
        "submitted_at": now_iso(),
        "platforms": body.get("platforms") or {},
        "summary": str(body.get("summary") or ""),
        "wins": str(body.get("wins") or ""),
        "losses": str(body.get("losses") or ""),
        "sentiment": str(body.get("sentiment") or "mixed"),
        "viral_from": str(body.get("viral_from") or "none"),
        "recommendations": str(body.get("recommendations") or ""),
    }
    with _LOCK:
        state = _load()
        state["weekly_reports"].append(report)
        state["weekly_reports"] = state["weekly_reports"][-52:]
        _save(state)
    return {"ok": True, "report": report}


def add_knowledge_file(filename: str, data: bytes, *, note: str = "") -> dict[str, Any]:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name) or "upload.bin"
    kid = uuid.uuid4().hex[:12]
    dest = knowledge_dir() / f"{kid}_{safe}"
    dest.write_bytes(data)
    item = {
        "id": kid,
        "filename": safe,
        "path": str(dest),
        "bytes": len(data),
        "note": note,
        "uploaded_at": now_iso(),
    }
    with _LOCK:
        state = _load()
        state["knowledge"].append(item)
        _save(state)
    return {"ok": True, "item": {k: v for k, v in item.items() if k != "path"}}


def list_knowledge() -> dict[str, Any]:
    with _LOCK:
        state = _load()
        items = [{k: v for k, v in row.items() if k != "path"} for row in state.get("knowledge") or []]
    return {"ok": True, "items": items}


def knowledge_text(item_id: str, *, limit: int = 20_000) -> dict[str, Any]:
    with _LOCK:
        state = _load()
        item = next((r for r in state.get("knowledge") or [] if r.get("id") == item_id), None)
    if not item:
        raise HTTPException(404, "Unknown knowledge item")
    path = Path(item.get("path") or "")
    if not path.is_file():
        raise HTTPException(404, "File missing")
    raw = path.read_bytes()[:limit]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    return {"ok": True, "id": item_id, "filename": item.get("filename"), "text": text, "note": item.get("note")}


def taste_pack() -> dict[str, Any]:
    with _LOCK:
        state = _load()
        tracks = sorted(state["tracks"].values(), key=lambda t: -int(t.get("request_count") or 0))[:40]
        artists = []
        seen = set()
        for t in tracks:
            a = str(t.get("artist") or "").strip()
            if a and a.lower() not in seen:
                seen.add(a.lower())
                artists.append(a)
        knowledge = [{k: v for k, v in row.items() if k != "path"} for row in state.get("knowledge") or []]
        runs = state.get("script_runs") or []
    return {
        "ok": True,
        "quality_rules": grok_playbook()["quality"],
        "top_requested": [public_track(t) for t in tracks],
        "artists": artists,
        "knowledge": knowledge,
        "recent_script_runs": runs[-8:],
        "due": due_checkins(),
        "playbook": grok_playbook(),
    }


def latest_metric(post: dict[str, Any]) -> dict[str, Any]:
    metrics = post.get("metrics") or []
    return metrics[-1] if metrics else {"impressions": 0, "views": 0, "likes": 0, "comments_count": 0}


def cross_pairs(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for post in posts:
        key = str(post.get("same_video_group") or "").strip()
        if not key:
            continue
        groups.setdefault(key, []).append(post)
    out = []
    for gid, items in groups.items():
        if len(items) < 2:
            continue
        ranked = sorted(items, key=lambda p: int(latest_metric(p).get("impressions") or 0), reverse=True)
        winner, loser = ranked[0], ranked[-1]
        out.append(
            {
                "group": gid,
                "winner_platform": winner.get("platform"),
                "loser_platform": loser.get("platform"),
                "winner_impressions": int(latest_metric(winner).get("impressions") or 0),
                "loser_impressions": int(latest_metric(loser).get("impressions") or 0),
                "winner_url": winner.get("post_url"),
                "loser_url": loser.get("post_url"),
                "why": (
                    f"{winner.get('platform')} reached more impressions on the same video. "
                    f"On {loser.get('platform')}: {advice_for(loser.get('platform'), winner.get('platform'))}"
                ),
                "advice": advice_for(loser.get("platform"), winner.get("platform")),
            }
        )
    return out


def dashboard_payload(*, platform: str = "all", sort: str = "impressions") -> dict[str, Any]:
    with _LOCK:
        state = _load()
        posts = list(state["posts"].values())
        reports = list(state["weekly_reports"] or [])
        tracks = list(state["tracks"].values())
        requests = list(state["requests"] or [])
        knowledge = [{k: v for k, v in row.items() if k != "path"} for row in state.get("knowledge") or []]
        script_runs = list(state.get("script_runs") or [])
        all_posts = list(posts)
    if platform and platform != "all":
        posts = [p for p in posts if p.get("platform") == platform]
    decorated = []
    totals = {p: {"impressions": 0, "engagements": 0, "posts": 0} for p in PLATFORMS}
    mix = {"impressions": 0, "engagements": 0, "posts": 0}
    for post in posts:
        m = latest_metric(post)
        impressions = int(m.get("impressions") or m.get("views") or 0)
        engagements = int(m.get("likes") or 0) + int(m.get("comments_count") or 0) + int(m.get("reposts") or 0)
        rate = float(m.get("engagement_rate") or 0)
        analysis = (post.get("analyses") or [{}])[-1]
        row = {**post, "impressions": impressions, "engagements": engagements, "engagement_rate": rate, "latest_analysis": analysis}
        decorated.append(row)
        plat = str(post.get("platform") or "other")
        if plat not in totals:
            plat = "other"
        totals[plat]["impressions"] += impressions
        totals[plat]["engagements"] += engagements
        totals[plat]["posts"] += 1
        mix["impressions"] += impressions
        mix["engagements"] += engagements
        mix["posts"] += 1
    reverse = True
    key = sort if sort in {"impressions", "engagements", "engagement_rate", "posted_at"} else "impressions"
    if key == "posted_at":
        decorated.sort(key=lambda p: str(p.get("posted_at") or ""), reverse=True)
    else:
        decorated.sort(key=lambda p: p.get(key) or 0, reverse=reverse)
    series = []
    for post in decorated:
        series.append(
            {
                "id": post["id"],
                "platform": post.get("platform"),
                "label": (post.get("post_url") or post["id"])[:48],
                "impressions": post["impressions"],
                "engagements": post["engagements"],
            }
        )
    return {
        "ok": True,
        "generated_at": now_iso(),
        "platform": platform or "all",
        "sort": key,
        "totals": totals,
        "mix": mix,
        "posts": decorated,
        "series": series,
        "cross": cross_pairs(all_posts),
        "weekly_reports": reports[-12:],
        "tracks": [public_track(t) for t in sorted(tracks, key=lambda t: -int(t.get("request_count") or 0))],
        "requests": requests[-80:],
        "knowledge": knowledge,
        "scripts": list_scripts()["scripts"],
        "script_runs": script_runs[-20:],
        "due": due_checkins(),
        "playbook": grok_playbook(),
    }


def ensure_builtin_scripts() -> None:
    folder = scripts_dir()
    builtins = {
        "scrape_x_week.py": X_WEEK_SCRIPT,
        "scrape_icloud_music.py": ICLOUD_SCRIPT,
    }
    for name, body in builtins.items():
        path = folder / name
        if not path.is_file():
            path.write_text(body, encoding="utf-8")


def list_scripts() -> dict[str, Any]:
    ensure_builtin_scripts()
    items = []
    for path in sorted(scripts_dir().glob("*.py")):
        items.append({"id": path.stem, "filename": path.name, "bytes": path.stat().st_size})
    return {"ok": True, "scripts": items}


def script_source(name: str) -> dict[str, Any]:
    ensure_builtin_scripts()
    path = _script_path(name)
    return {"ok": True, "filename": path.name, "source": path.read_text(encoding="utf-8")}


def save_script(name: str, source: str) -> dict[str, Any]:
    path = _script_path(name)
    path.write_text(str(source or ""), encoding="utf-8")
    return {"ok": True, "filename": path.name}


def _script_path(name: str) -> Path:
    ensure_builtin_scripts()
    raw = Path(name or "").name
    if not raw.endswith(".py"):
        raw = f"{raw}.py"
    if not re.fullmatch(r"[A-Za-z0-9._-]+\.py", raw):
        raise HTTPException(400, "Invalid script name")
    return scripts_dir() / raw


def run_script(name: str) -> dict[str, Any]:
    path = _script_path(name)
    env = dict(**{k: v for k, v in __import__("os").environ.items()})
    started = now_iso()
    try:
        proc = subprocess.run(
            ["python3", str(path)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        out = (proc.stdout or "")[-20_000:]
        err = (proc.stderr or "")[-8_000:]
        code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        err = "timed out after 120s"
        code = 124
    run = {
        "id": f"run_{uuid.uuid4().hex[:10]}",
        "script": path.name,
        "started_at": started,
        "finished_at": now_iso(),
        "exit_code": code,
        "stdout": out,
        "stderr": err,
    }
    with _LOCK:
        state = _load()
        state.setdefault("script_runs", []).append(run)
        state["script_runs"] = state["script_runs"][-40:]
        _save(state)
    if out.strip() and path.name.startswith("scrape_"):
        dest = knowledge_dir() / f"{path.stem}-latest.txt"
        dest.write_text(out, encoding="utf-8")
        with _LOCK:
            state = _load()
            item = {
                "id": f"kb_{path.stem}",
                "filename": dest.name,
                "path": str(dest),
                "bytes": dest.stat().st_size,
                "note": f"Latest {path.name} output for Grok taste",
                "uploaded_at": now_iso(),
            }
            state["knowledge"] = [k for k in state["knowledge"] if k.get("id") != item["id"]]
            state["knowledge"].append(item)
            _save(state)
    return {"ok": code == 0, "run": run}


X_WEEK_SCRIPT = '''#!/usr/bin/env python3
# GROK: last-7-days X posts for taste + caption style. Never print tokens.
# Output is copied into Marketing/knowledge for grok_taste.
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def env(name: str) -> str:
    return str(os.environ.get(name) or "").strip()


def main() -> int:
    token = env("TWITTER_BEARER_TOKEN") or env("X_BEARER_TOKEN")
    if not token:
        print("No TWITTER_BEARER_TOKEN. Skipping live scrape; Grok should use knowledge uploads instead.")
        return 0
    start = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    me_req = Request("https://api.x.com/2/users/me", headers={"Authorization": f"Bearer {token}"})
    me = json.loads(urlopen(me_req, timeout=30).read().decode())
    uid = str((me.get("data") or {}).get("id") or "")
    if not uid:
        print("Could not resolve X user id")
        return 1
    qs = urlencode(
        {
            "max_results": "50",
            "start_time": start,
            "tweet.fields": "created_at,public_metrics,text",
        }
    )
    req = Request(f"https://api.x.com/2/users/{uid}/tweets?{qs}", headers={"Authorization": f"Bearer {token}"})
    data = json.loads(urlopen(req, timeout=30).read().decode())
    tweets = data.get("data") or []
    print(json.dumps({"count": len(tweets), "tweets": tweets}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''

ICLOUD_SCRIPT = '''#!/usr/bin/env python3
# GROK: list song titles from iCloud Drive / Music so grok_taste can match Sam's library.
# Never upload files; names only.
from __future__ import annotations

from pathlib import Path

HOME = Path.home()
AUDIO = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".aiff", ".alac"}
CANDIDATES = [
    HOME / "Music" / "Music",
    HOME / "Music" / "iTunes" / "iTunes Media" / "Music",
    HOME / "Music" / "YouTube MP3s",
    HOME / "Library" / "Mobile Documents" / "com~apple~CloudDocs",
    HOME / "Library" / "Mobile Documents",
]


def main() -> int:
    names: list[str] = []
    seen: set[str] = set()
    for root in CANDIDATES:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in AUDIO:
                continue
            label = path.stem
            key = label.lower()
            if key in seen:
                continue
            seen.add(key)
            names.append(label)
            if len(names) >= 400:
                break
        if len(names) >= 400:
            break
    print("\\n".join(names) if names else "No local/iCloud audio names found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''
