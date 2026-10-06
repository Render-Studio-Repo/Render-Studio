#!/usr/bin/env python3
"""Queue + studio-dark GIF renderer for Grok bot clip requests.

The HTTP MCP on this Mac is the listener. Grok calls grok_request_clip;
jobs land in data/grok-bot/clips/. GIFs render with the same 720×400
studio-dark recipe as scripts/gif-demos/. MP4 / live UI records stay in
the harness inbox for Cursor to run Playwright / viewport Record.

Never fires paid Generate.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
JOBS_DIR = REPO_ROOT / "data" / "grok-bot" / "clips"
INBOX = REPO_ROOT / "data" / "grok-bot" / "harness-inbox.md"
MEDIA_DIR = REPO_ROOT / "frontend" / "docs" / "media"
VENV_PY = REPO_ROOT / ".venv" / "bin" / "python"
PUBLIC = "https://render3d.app"
W, H = 720, 400
BG = (13, 17, 23)
PANEL = (22, 27, 34)
LINE = (48, 54, 61)
TEXT = (201, 209, 217)
MUTED = (139, 148, 158)
ACCENT = (56, 189, 248)
ORANGE = (249, 115, 22)

KNOWN_SCRIPTS = {
    "sept": "scripts/gif-demos/record_sept_feature_gifs.py",
    "aug": "scripts/gif-demos/record_aug_sep_feature_gifs.py",
    "getting-started": "scripts/gif-demos/record_getting_started_gifs.py",
    "robotics": "scripts/gif-demos/record_robotics_configuration_gifs.py",
    "source-parts": "scripts/gif-demos/record_source_parts_gif.py",
}
LIVE_DEMOS = {
    "canvas": "canvas",
    "wiring": "wiring",
    "workspaces": "workspaces",
    "picks": "picks",
    "sketch": "sketch",
    "ai-generate": "ai-generate",
    "source-parts": "source-parts",
    "render-agent": "render-agent",
    "cloud-sync": "cloud-sync",
    "finder": None,
    "imagine": None,
    "robotics": None,
}
LIVE_HINTS = (
    "live ui",
    "live site",
    "live render",
    "playwright",
    "viewport rec",
    "record_gs",
    "real product",
    "not a placeholder",
    "not the old",
)
_MIN_LIVE_BYTES = 80_000
GETTING_STARTED = REPO_ROOT / "scripts" / "gif-demos" / "record_getting_started_gifs.py"

_lock = threading.Lock()
_listener_started = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(title: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "-", str(title or "clip").lower()).strip("-")
    return (raw or "clip")[:48]


def job_path(job_id: str) -> Path:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    return JOBS_DIR / f"{job_id}.json"


def read_job(job_id: str) -> dict[str, Any] | None:
    path = job_path(job_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def write_job(job: dict[str, Any]) -> dict[str, Any]:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    path = job_path(str(job["id"]))
    path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    return job


def list_jobs(limit: int = 20) -> list[dict[str, Any]]:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for path in sorted(JOBS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            rows.append(data)
        if len(rows) >= limit:
            break
    return rows


def harness_prompt(job: dict[str, Any]) -> str:
    slug = job.get("slug") or "clip"
    kind = job.get("kind") or "gif"
    return (
        "Grok bot requested a Studio clip. Do **not** run paid Generate.\n\n"
        f"- Job: `{job.get('id')}`\n"
        f"- Kind: `{kind}`\n"
        f"- Title: {job.get('title')}\n"
        f"- Prompt: {job.get('prompt')}\n"
        f"- Save GIF to: `frontend/docs/media/{slug}.gif` (720×400, studio-dark #0d1117, loop)\n"
        f"- Public URL: {PUBLIC}/docs/media/{slug}.gif\n\n"
        "Same recipe as `scripts/gif-demos/record_aug_sep_feature_gifs.py` "
        "and `record_sept_feature_gifs.py`. For a live UI take, use Playwright "
        "`scripts/gif-demos/record_gs_demos.py` or viewport Rec → convert GIF. "
        "Promo MP4: `node scripts/promo-record/record-x-showme.mjs http://127.0.0.1:8001`.\n"
        "Mark the job done by writing status=done and url on "
        f"`data/grok-bot/clips/{job.get('id')}.json`.\n"
    )


def _write_inbox(job: dict[str, Any]) -> None:
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    block = f"## {job.get('id')} — {_now()}\n\n{harness_prompt(job)}\n"
    prior = INBOX.read_text(encoding="utf-8") if INBOX.is_file() else "# Grok bot → Cursor harness inbox\n\n"
    INBOX.write_text(block + prior[:12000], encoding="utf-8")


def _blob(job: dict[str, Any]) -> str:
    return " ".join(str(job.get(k) or "") for k in ("title", "slug", "prompt", "run")).lower()


def wants_live(job: dict[str, Any]) -> bool:
    if job.get("live") in {True, "1", "true", "yes"}:
        return True
    if str(job.get("kind") or "") in {"mp4", "webm"}:
        return True
    blob = _blob(job)
    return any(hint in blob for hint in LIVE_HINTS)


def infer_live_demo(job: dict[str, Any]) -> str | None:
    blob = _blob(job)
    for key, demo in LIVE_DEMOS.items():
        if key in blob:
            return demo
    return None


def looks_like_guide_stub(path: Path | None) -> bool:
    if path is None or not Path(path).is_file():
        return True
    try:
        size = Path(path).stat().st_size
    except OSError:
        return True
    return size < _MIN_LIVE_BYTES


def request_clip(
    title: str,
    prompt: str,
    kind: str = "gif",
    slug: str | None = None,
    run: str | None = None,
    live: bool | None = None,
    callback_url: str | None = None,
    wait: int | float | None = None,
) -> dict[str, Any]:
    title = str(title or "").strip() or "Studio feature"
    prompt = str(prompt or "").strip() or title
    kind = str(kind or "gif").strip().lower()
    if kind not in {"gif", "mp4", "webm"}:
        kind = "gif"
    slug = slugify(slug or title)
    job = {
        "id": str(uuid.uuid4())[:12],
        "kind": kind,
        "title": title,
        "prompt": prompt,
        "slug": slug,
        "run": str(run or "").strip(),
        "status": "pending",
        "url": None,
        "path": None,
        "error": None,
        "created_at": _now(),
        "updated_at": _now(),
        "paid_generate": False,
        "grabbed": False,
        "grabbed_at": None,
        "grabbed_by": None,
        "live": bool(live) if live is not None else None,
        "callback_url": str(callback_url or "").strip() or None,
        "harness_inbox": str(INBOX),
    }
    if job["live"] is None:
        job["live"] = wants_live(job)
    job["harness_prompt"] = harness_prompt(job)
    write_job(job)
    _write_inbox(job)
    out = process_job(job["id"])
    seconds = int(wait or 0)
    if seconds > 0:
        return wait_for_job(str(out.get("id") or job["id"]), seconds)
    return out


def clip_status(job_id: str) -> dict[str, Any]:
    job = read_job(str(job_id or "").strip())
    if not job:
        return {"ok": False, "error": "unknown_job"}
    return {"ok": True, **job_public(job)}


def wait_for_job(job_id: str, timeout: int | float = 90) -> dict[str, Any]:
    """Block until status is done/error, or timeout. Bot should call this instead of rapid polls."""
    jid = str(job_id or "").strip()
    seconds = max(0, min(int(timeout or 0), 120))
    deadline = time.time() + seconds
    last: dict[str, Any] | None = None
    while True:
        job = read_job(jid)
        if not job:
            return {"ok": False, "error": "unknown_job"}
        last = job
        if job.get("status") in {"done", "error"}:
            return {"ok": job.get("status") == "done", "waited": True, "timeout": False, **job_public(job)}
        if time.time() >= deadline:
            pub = job_public(job)
            return {
                "ok": False,
                "waited": True,
                "timeout": True,
                "retry_wait_url": pub["wait_url"],
                **pub,
            }
        time.sleep(0.5)


def _notify_callback(job: dict[str, Any]) -> None:
    url = str(job.get("callback_url") or "").strip()
    if not url:
        return
    if not (url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        return
    try:
        payload = json.dumps(job_public(job)).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req, timeout=8)
    except Exception:
        pass


def _finish_job(job: dict[str, Any], **fields: Any) -> dict[str, Any]:
    job.update(fields)
    job["updated_at"] = _now()
    write_job(job)
    _notify_callback(job)
    return {"ok": job.get("status") in {"done", "needs_harness", "recording"}, **job}


def job_public(job: dict[str, Any]) -> dict[str, Any]:
    jid = str(job.get("id") or "")
    url = job.get("url")
    path = job.get("path")
    return {
        "id": jid,
        "title": job.get("title"),
        "prompt": job.get("prompt"),
        "kind": job.get("kind") or "gif",
        "status": job.get("status"),
        "slug": job.get("slug"),
        "path": path,
        "url": url,
        "board": f"{PUBLIC}/mcp/clips",
        "job_url": f"{PUBLIC}/mcp/clips/{jid}",
        "grab_url": f"{PUBLIC}/mcp/clips/{jid}/grab",
        "grabbed": bool(job.get("grabbed")),
        "grabbed_at": job.get("grabbed_at"),
        "grabbed_by": job.get("grabbed_by"),
        "error": job.get("error"),
        "note": job.get("note"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "harness_inbox": "https://render3d.app/mcp/harness.md",
        "wait_url": f"{PUBLIC}/mcp/clips/{jid}?wait=90",
        "poll": "Prefer GET wait_url (long-poll up to 90s). Do not poll faster than every 15s. Optional callback_url on create.",
        "live": bool(job.get("live")),
        "source": job.get("source"),
        "callback_url": job.get("callback_url"),
    }


def clips_board(*, ungrabbed: bool = False, limit: int = 80) -> dict[str, Any]:
    rows = [job_public(job) for job in list_jobs(limit)]
    if ungrabbed:
        rows = [row for row in rows if not row["grabbed"]]
    ready = [
        {"id": row["id"], "url": row["url"], "path": row["path"], "grab_url": row["grab_url"], "title": row["title"]}
        for row in rows
        if row.get("status") == "done"
        and row.get("url")
        and not row["grabbed"]
        and not (row.get("live") and looks_like_guide_stub(REPO_ROOT / str(row["path"] or "")))
    ]
    return {
        "ok": True,
        "board": f"{PUBLIC}/mcp/clips",
        "create": f"POST {PUBLIC}/mcp/clips",
        "grab": f"POST {PUBLIC}/mcp/clips/{{id}}/grab",
        "clips": rows,
        "ready": ready,
        "count": len(rows),
        "ready_count": len(ready),
    }


def mark_grabbed(job_id: str, *, grabbed_by: str = "grok-bot") -> dict[str, Any]:
    job = read_job(str(job_id or "").strip())
    if not job:
        return {"ok": False, "error": "unknown_job"}
    job["grabbed"] = True
    job["grabbed_at"] = _now()
    job["grabbed_by"] = str(grabbed_by or "grok-bot")[:80]
    job["updated_at"] = _now()
    write_job(job)
    return {"ok": True, **job_public(job)}


def mark_grabbed_from_body(body: dict[str, Any] | None) -> dict[str, Any]:
    data = body or {}
    jid = str(data.get("id") or data.get("job_id") or "").strip()
    if not jid:
        needle = str(data.get("url") or data.get("path") or "").strip()
        if needle:
            for job in list_jobs(80):
                if needle in {str(job.get("url") or ""), str(job.get("path") or ""), str(job.get("slug") or "")}:
                    jid = str(job["id"])
                    break
    if not jid:
        return {"ok": False, "error": "missing_id"}
    return mark_grabbed(jid, grabbed_by=str(data.get("by") or data.get("grabbed_by") or "grok-bot"))


def http_clips(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    query: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    """REST board for Grok: create GIFs, list URLs/paths, POST grab."""
    parts = [p for p in str(path or "").split("/") if p]
    if parts and parts[0] == "mcp":
        parts = parts[1:]
    if not parts or parts[0] != "clips":
        return 404, {"ok": False, "error": "not_found"}
    rest = parts[1:]
    method = str(method or "GET").upper()
    query = query or {}
    body = body if isinstance(body, dict) else {}
    if method == "GET" and not rest:
        ungrabbed = str(query.get("ungrabbed") or "").lower() in {"1", "true", "yes"}
        return 200, clips_board(ungrabbed=ungrabbed)
    if method == "POST" and not rest:
        out = request_clip(
            str(body.get("title") or ""),
            str(body.get("prompt") or body.get("title") or ""),
            kind=str(body.get("kind") or "gif"),
            slug=body.get("slug"),
            run=body.get("run"),
            live=body.get("live"),
            callback_url=body.get("callback_url"),
            wait=body.get("wait"),
        )
        jid = str(out.get("id") or "")
        job = read_job(jid) if jid else None
        if job:
            return 200, {"ok": bool(out.get("ok")), **job_public(job)}
        return 200, out
    if method == "POST" and rest == ["grab"]:
        return 200, mark_grabbed_from_body(body)
    if len(rest) == 1:
        job = read_job(rest[0])
        if not job:
            return 404, {"ok": False, "error": "unknown_job"}
        if method == "GET":
            wait = int(query.get("wait") or 0)
            if wait > 0:
                return 200, wait_for_job(rest[0], wait)
            return 200, {"ok": True, **job_public(job)}
        if method == "POST":
            if body.get("grabbed") is False:
                job["grabbed"] = False
                job["grabbed_at"] = None
                job["grabbed_by"] = None
                job["updated_at"] = _now()
                write_job(job)
                return 200, {"ok": True, **job_public(job)}
            return 200, mark_grabbed(rest[0], grabbed_by=str(body.get("by") or "grok-bot"))
    if len(rest) == 2 and rest[1] == "grab" and method == "POST":
        code = 200
        out = mark_grabbed(rest[0], grabbed_by=str(body.get("by") or "grok-bot"))
        if not out.get("ok"):
            return 404, out
        return code, out
    return 404, {"ok": False, "error": "not_found"}


def _split_lines(prompt: str) -> list[str]:
    parts = [ln.strip(" -•") for ln in re.split(r"[\n.;]+", prompt) if ln.strip()]
    if not parts:
        parts = [prompt]
    return parts[:6]


def render_guide_gif(title: str, prompt: str, dest: Path) -> Path:
    from PIL import Image, ImageDraw, ImageFont

    def font(size: int, bold: bool = False):
        names = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
        for name in names:
            try:
                return ImageFont.truetype(name, size)
            except Exception:
                continue
        return ImageFont.load_default()

    f_title = font(16, True)
    f_small = font(13)
    f_tiny = font(11)
    lines = _split_lines(prompt)
    captions = [
        "Open Render Studio",
        title,
        lines[0][:72] if lines else title,
        "Loop — ready for docs / X",
    ]
    frames: list[Any] = []
    for i, caption in enumerate(captions):
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((10, 10, W - 10, H - 10), radius=14, fill=PANEL)
        d.rectangle((10, 10, W - 10, 48), fill=(30, 36, 44))
        d.text((22, 20), "Render Studio", fill=TEXT, font=f_title)
        d.rounded_rectangle((200, 16, 270, 42), radius=8, outline=ACCENT, fill=(15, 23, 42))
        d.text((214, 22), "Guide", fill=ACCENT, font=f_tiny)
        d.rounded_rectangle((40, 70, W - 40, H - 56), radius=10, fill=(17, 21, 27), outline=LINE)
        d.text((56, 86), title[:48], fill=ACCENT, font=f_title)
        y = 124
        for line in lines[:4]:
            on = i >= 1 and lines.index(line) <= i
            d.text((56, y), ("▸ " if on else "  ") + line[:70], fill=TEXT if on else MUTED, font=f_small)
            y += 28
        d.rectangle((10, H - 38, W - 10, H - 10), fill=(18, 22, 28))
        d.text((22, H - 32), caption[:80], fill=MUTED, font=f_tiny)
        # cursor
        x, y = 520, 160 + i * 18
        d.polygon([(x, y), (x + 16, y + 12), (x + 8, y + 14), (x + 12, y + 28), (x + 6, y + 16), (x, y + 22)], fill=ORANGE)
        frames.append(img)
    dest.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        dest,
        save_all=True,
        append_images=frames[1:],
        duration=900,
        loop=0,
        optimize=True,
    )
    return dest


def _run_known_script(key: str) -> tuple[bool, str]:
    rel = KNOWN_SCRIPTS.get(key)
    if not rel:
        return False, "unknown_script"
    script = REPO_ROOT / rel
    if not script.is_file():
        return False, "missing_script"
    py = str(VENV_PY if VENV_PY.is_file() else "python3")
    proc = subprocess.run(
        [py, str(script)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if proc.returncode != 0:
        return False, (proc.stderr or proc.stdout or "script_failed")[:400]
    return True, (proc.stdout or "")[-400:]


def _set_media(job: dict[str, Any], dest: Path, source: str) -> None:
    try:
        job["path"] = str(dest.relative_to(REPO_ROOT))
    except ValueError:
        job["path"] = str(dest)
    ext = dest.suffix.lstrip(".") or (job.get("kind") or "gif")
    job["url"] = f"{PUBLIC}/docs/media/{job['slug']}.{ext}"
    job["source"] = source


def _run_live_playwright(job: dict[str, Any]) -> tuple[bool, str]:
    demo = infer_live_demo(job)
    dest = MEDIA_DIR / f"{job['slug']}.gif"
    if not demo:
        return False, "no_mapped_live_demo"
    if not GETTING_STARTED.is_file():
        return False, "missing_getting_started_recorder"
    py = str(VENV_PY if VENV_PY.is_file() else "python3")
    env = os.environ.copy()
    env["GIF_DEMO_OUT"] = str(MEDIA_DIR)
    env["GIF_DEMO_RAW"] = str(REPO_ROOT / "scripts" / "gif-demos" / "raw-live")
    proc = subprocess.run(
        [py, str(GETTING_STARTED), demo],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=240,
        env=env,
    )
    produced = MEDIA_DIR / f"{demo}.gif"
    if produced.is_file() and produced.resolve() != dest.resolve():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(produced, dest)
    if dest.is_file() and not looks_like_guide_stub(dest):
        return True, (proc.stdout or "")[-200:]
    return False, (proc.stderr or proc.stdout or "live_record_failed")[:400]


def _live_worker(job_id: str) -> None:
    job = read_job(job_id)
    if not job:
        return
    try:
        ok, detail = _run_live_playwright(job)
        dest = MEDIA_DIR / f"{job['slug']}.gif"
        if ok:
            _set_media(job, dest, "live")
            _finish_job(
                job,
                status="done",
                error=None,
                note="Live Playwright capture on this Mac.",
            )
            return
        _finish_job(
            job,
            status="needs_harness",
            error=detail,
            note="Live recorder did not produce a real GIF yet. Inbox still has the prompt.",
        )
    except Exception as exc:
        job = read_job(job_id) or job
        _finish_job(job, status="error", error=str(exc)[:400])


def process_job(job_id: str) -> dict[str, Any]:
    with _lock:
        job = read_job(job_id)
        if not job:
            return {"ok": False, "error": "unknown_job"}
        kind = str(job.get("kind") or "gif")
        run = str(job.get("run") or "").strip().lower()
        live = bool(job.get("live")) or wants_live(job)
        job["live"] = live
        if live and run not in KNOWN_SCRIPTS:
            job["status"] = "recording"
            job["note"] = "This Mac is capturing live Studio UI. Long-poll wait_url instead of rapid GET."
            job["updated_at"] = _now()
            write_job(job)
            threading.Thread(target=_live_worker, args=(job_id,), daemon=True, name=f"clip-live-{job_id}").start()
            return {"ok": True, **job}
        job["status"] = "running"
        job["updated_at"] = _now()
        write_job(job)
        try:
            if run in KNOWN_SCRIPTS:
                ok, detail = _run_known_script(run)
                job["status"] = "done" if ok else "error"
                job["error"] = None if ok else detail
                job["note"] = "Ran existing gif-demo script. Check frontend/docs/media/."
                job["source"] = "script"
            elif kind in {"mp4", "webm"}:
                job["status"] = "needs_harness"
                job["note"] = "MP4/WebM needs viewport Rec or promo-record. See harness-inbox.md."
            else:
                dest = MEDIA_DIR / f"{job['slug']}.gif"
                try:
                    render_guide_gif(str(job["title"]), str(job["prompt"]), dest)
                except ImportError:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    rendered = False
                    last_err = "no_pillow"
                    for py in ("/usr/bin/python3", str(VENV_PY), sys.executable):
                        if py.endswith("python") and not Path(py).is_file():
                            continue
                        if py == "/usr/bin/python3" and not Path(py).is_file():
                            continue
                        if py == str(VENV_PY) and not VENV_PY.is_file():
                            continue
                        proc = subprocess.run(
                            [
                                py,
                                str(HERE / "clip_harness.py"),
                                "--render",
                                str(job["title"]),
                                str(job["prompt"]),
                                str(dest),
                            ],
                            capture_output=True,
                            text=True,
                            timeout=60,
                        )
                        if proc.returncode == 0 and dest.is_file():
                            rendered = True
                            break
                        last_err = (proc.stderr or proc.stdout or "render_failed")[:400]
                    if not rendered:
                        raise RuntimeError(last_err)
                _set_media(job, dest, "guide")
                job["status"] = "done"
            return _finish_job(job)
        except Exception as exc:
            return _finish_job(job, status="error", error=str(exc)[:400])


def drain_pending() -> int:
    n = 0
    for job in list_jobs(50):
        if job.get("status") == "pending":
            process_job(str(job["id"]))
            n += 1
    return n


def start_listener() -> None:
    global _listener_started
    if _listener_started:
        return
    _listener_started = True

    def loop() -> None:
        while True:
            try:
                drain_pending()
            except Exception:
                pass
            time.sleep(2)

    threading.Thread(target=loop, name="grok-clip-listener", daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Grok bot clip harness")
    parser.add_argument("--listen", action="store_true")
    parser.add_argument("--render", nargs=3, metavar=("TITLE", "PROMPT", "DEST"))
    args = parser.parse_args(argv)
    if args.render:
        render_guide_gif(args.render[0], args.render[1], Path(args.render[2]))
        return 0
    if args.listen:
        start_listener()
        while True:
            time.sleep(30)
    drain_pending()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
