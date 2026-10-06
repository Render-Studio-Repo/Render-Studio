"""YouTube search/rank for Grok music downloads.

Prefer official / Topic / VEVO. Never pick clean/non-explicit, covers, or instrumentals.
If no official channel, take the most-played remaining match.
"""

from __future__ import annotations

import math
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any

REJECT_RE = re.compile(
    r"("
    r"\bclean\b|\bnon[- ]?explicit\b|\bcensored\b|\bradio\s*edit\b|"
    r"\bcover\b|\bkaraoke\b|\binstrumental\b|\bpiano\s*(?:version|cover)\b|"
    r"\borchestra(?:l)?\b|\bacoustic\s*cover\b|\b8d\s*audio\b|"
    r"\bnightcore\b|\bsped\s*up\b|\bslowed(?:\s*&\s*reverb)?\b|"
    r"\blullaby\b|\bmusic\s*box\b"
    r")",
    re.I,
)
OFFICIAL_UPLOADER_RE = re.compile(
    r"(official|\bvevo\b|\btopic\b|\s-\s*topic$|provided to youtube)",
    re.I,
)
EXPLICIT_RE = re.compile(r"\bexplicit\b|\be\s*version\b", re.I)


def clean_title(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = re.sub(
        r"\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyric\s+video|lyrics|visualizer|4k|hd)[\])]\s*$",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\s*\|\s*(?:official\s+)?(?:video|audio|lyrics)\s*$", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", text).strip(" .-")


def query_artist(query: str) -> str:
    raw = str(query or "").strip()
    if " - " in raw:
        return raw.split(" - ", 1)[0].strip()
    parts = raw.split()
    if len(parts) >= 2:
        return " ".join(parts[:2])
    return raw


def is_rejected(entry: dict[str, Any] | None) -> bool:
    if not entry:
        return True
    blob = " ".join(
        str(entry.get(k) or "")
        for k in ("title", "track", "uploader", "channel", "artist", "description")
    )
    return bool(REJECT_RE.search(blob))


def is_official(entry: dict[str, Any], query: str) -> bool:
    uploader = str(entry.get("uploader") or entry.get("channel") or "")
    title = str(entry.get("title") or "")
    if OFFICIAL_UPLOADER_RE.search(uploader) or OFFICIAL_UPLOADER_RE.search(title):
        return True
    artist = query_artist(query).lower()
    if artist and artist in uploader.lower():
        return True
    return False


def score_candidate(entry: dict[str, Any], query: str) -> float:
    if is_rejected(entry):
        return -1e12
    title = str(entry.get("title") or "")
    uploader = str(entry.get("uploader") or entry.get("channel") or "")
    views = float(entry.get("view_count") or 0)
    score = math.log10(views + 1) * 12
    if is_official(entry, query):
        score += 90
    if "vevo" in uploader.lower():
        score += 20
    if re.search(r"\s-\s*topic$", uploader, re.I):
        score += 25
    if EXPLICIT_RE.search(title):
        score += 35
    q = str(query or "").lower()
    hay = f"{title} {uploader}".lower()
    for token in q.split():
        if token and token in hay:
            score += 4
    return score


def pick_best(entries: list[dict[str, Any]] | None, query: str) -> dict[str, Any] | None:
    viable = [e for e in (entries or []) if e and not is_rejected(e)]
    if not viable:
        return None
    official = [e for e in viable if is_official(e, query)]
    pool = official or viable
    return max(pool, key=lambda e: (score_candidate(e, query), float(e.get("view_count") or 0)))


def video_url(entry: dict[str, Any]) -> str:
    vid = str(entry.get("id") or "").strip()
    if vid and re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
        return f"https://www.youtube.com/watch?v={vid}"
    url = str(entry.get("webpage_url") or entry.get("url") or "")
    if url.startswith(("https://", "http://")):
        return url
    return f"https://www.youtube.com/watch?v={url}" if url else ""


def track_filename(info: dict[str, Any]) -> str:
    title = clean_title(info.get("track") or info.get("title") or "Untitled")
    title_artist = ""
    if not info.get("track") and " - " in title:
        title_artist, title = title.split(" - ", 1)
    artist = clean_title(
        title_artist
        or info.get("artist")
        or info.get("creator")
        or info.get("uploader")
        or info.get("channel")
        or "Unknown Artist"
    )
    artist = re.sub(r"\s*-\s*Topic$", "", artist, flags=re.I).strip() or "Unknown Artist"
    return f"{artist} - {clean_title(title) or 'Untitled'}.mp3"


def search_youtube(query: str, *, limit: int = 15) -> list[dict[str, Any]]:
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError('Install yt-dlp: python3 -m pip install -U "yt-dlp[default]"') from exc
    q = str(query or "").strip()
    if not q:
        raise ValueError("query is required")
    with yt_dlp.YoutubeDL(
        {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "skip_download": True,
            "noplaylist": True,
            "ignoreerrors": True,
        }
    ) as ydl:
        info = ydl.extract_info(f"ytsearch{int(limit)}:{q}", download=False) or {}
    return [e for e in (info.get("entries") or []) if e]


def list_playlist(url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError('Install yt-dlp: python3 -m pip install -U "yt-dlp[default]"') from exc
    with yt_dlp.YoutubeDL(
        {
            "extract_flat": "in_playlist",
            "skip_download": True,
            "ignoreerrors": True,
            "quiet": True,
        }
    ) as ydl:
        listing = ydl.extract_info(url, download=False) or {}
    entries = [e for e in (listing.get("entries") or [listing]) if e]
    return listing, entries


def download_mp3(url: str, dest_dir: Path) -> dict[str, Any]:
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError('Install yt-dlp: python3 -m pip install -U "yt-dlp[default]"') from exc
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("Install ffmpeg and ffprobe and put them on PATH")
    dest_dir.mkdir(parents=True, exist_ok=True)
    with yt_dlp.YoutubeDL(
        {
            "format": "bestaudio/best",
            "outtmpl": str(dest_dir / "%(id)s.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
            ],
        }
    ) as ydl:
        info = ydl.extract_info(url, download=True)
    if not info:
        raise RuntimeError("No video information returned")
    if is_rejected(info):
        raise RuntimeError("Refused: clean, cover, or instrumental match")
    video_id = str(info.get("id") or "")
    source = dest_dir / f"{video_id}.mp3"
    if not source.is_file():
        raise RuntimeError(f"MP3 conversion did not create {source.name}")
    target = dest_dir / track_filename(info)
    if target.exists() and target.resolve() != source.resolve():
        target = dest_dir / f"{target.stem} [{video_id}].mp3"
    if source.resolve() != target.resolve():
        source.replace(target)
    return {
        "id": video_id,
        "title": clean_title(info.get("track") or info.get("title") or "Untitled"),
        "artist": re.sub(
            r"\s*-\s*Topic$",
            "",
            clean_title(info.get("artist") or info.get("uploader") or info.get("channel") or ""),
            flags=re.I,
        ),
        "uploader": str(info.get("uploader") or info.get("channel") or ""),
        "youtube_id": video_id,
        "youtube_url": video_url(info),
        "view_count": int(info.get("view_count") or 0),
        "official": is_official(info, str(info.get("title") or "")),
        "explicit": bool(EXPLICIT_RE.search(str(info.get("title") or ""))),
        "filename": target.name,
        "path": str(target),
    }


def search_and_download(query: str, dest_dir: Path) -> dict[str, Any]:
    entries = search_youtube(query)
    picked = pick_best(entries, query)
    if not picked:
        raise RuntimeError("No official or popular match (clean/cover/instrumental skipped)")
    return download_mp3(video_url(picked), dest_dir)
