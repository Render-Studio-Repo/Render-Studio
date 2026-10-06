"""Miniaturized ops / debugger notes. Highly pruned — do not clog disk or RAM."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR

OPS_ROOT = ROOT_DIR / "ai-context" / "ops"

FOLDERS = {
    "vr": "VR-Debuggers",
    "editor": "Editor-debugger",
    "wiring": "Wiring-simulator-logs",
    "activity": "Activity-monitor",
    "activity_logs": "Activity-monitor/logs",
    "pr": "PR-automated-reviews",
    "pr_logs": "PR-automated-reviews/logs",
    "bugs": "Possible-bugs",
    "virus": "Possible-virus-threat-files",
    "debugger": "debugger",
}

TEMP_FOLDERS = {"activity_logs", "pr_logs"}
# Hard caps apply to every folder, including keep: critical — noisy watchdogs
# must not fill disk. Time prune skips critical notes (and human folders).
KEEP_MAX = {
    "activity": 30,
    "activity_logs": 20,
    "pr": 40,
    "pr_logs": 20,
    "vr": 40,
    "editor": 40,
    "wiring": 40,
    "bugs": 80,
    "virus": 40,
    "debugger": 40,
}
KEEP_HOURS = {
    "activity_logs": 48,
    "pr_logs": 48,
    "activity": 24 * 7,
    "vr": 24 * 7,
    "editor": 24 * 7,
    "wiring": 24 * 7,
}
HUMAN_FOLDERS = {"bugs", "virus", "debugger"}
MAX_NOTE_BYTES = 1500
MAX_NOTE_LINES = 8
_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def ops_root() -> Path:
    OPS_ROOT.mkdir(parents=True, exist_ok=True)
    return OPS_ROOT


def folder_path(kind: str) -> Path:
    name = FOLDERS.get(kind) or FOLDERS["activity"]
    path = ops_root() / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _slug(text: str) -> str:
    raw = _SLUG_RE.sub("-", (text or "note").strip().lower())[:40].strip("-")
    return raw or "note"


def miniaturize(text: str) -> str:
    lines = [ln.rstrip() for ln in str(text or "").splitlines() if ln.strip()]
    body = "\n".join(lines[:MAX_NOTE_LINES])
    raw = body.encode("utf-8")
    if len(raw) <= MAX_NOTE_BYTES:
        return body
    return raw[: MAX_NOTE_BYTES - 1].decode("utf-8", errors="ignore").rstrip() + "…"


def write_note(
    kind: str,
    title: str,
    body: str,
    *,
    keep: bool = False,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write one short note. Returns path metadata. Call prune after."""
    now = datetime.now(timezone.utc)
    name = f"{now.strftime('%Y%m%d-%H%M')}-{_slug(title)}.md"
    path = folder_path(kind) / name
    header = [
        f"# {title.strip() or 'note'}",
        f"date: {now.isoformat()}",
        f"keep: {'critical' if keep else 'temp'}",
    ]
    if extra:
        header.append(f"meta: {json.dumps(extra, separators=(',', ':'))[:400]}")
    text = miniaturize("\n".join(header) + "\n\n" + miniaturize(body) + "\n")
    path.write_text(text, encoding="utf-8")
    prune(kind)
    return {"ok": True, "kind": kind, "path": str(path.relative_to(ops_root())), "keep": keep}


def list_notes(kind: str | None = None, *, limit: int = 40) -> list[dict[str, Any]]:
    kinds = [kind] if kind and kind in FOLDERS else list(FOLDERS)
    out: list[dict[str, Any]] = []
    for k in kinds:
        path = folder_path(k)
        files = sorted(path.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        for fp in files[:limit]:
            if fp.name.lower() == "readme.md":
                continue
            try:
                preview = miniaturize(fp.read_text(encoding="utf-8"))
            except OSError:
                preview = ""
            out.append(
                {
                    "kind": k,
                    "name": fp.name,
                    "path": str(fp.relative_to(ops_root())),
                    "mtime": datetime.fromtimestamp(fp.stat().st_mtime, timezone.utc).isoformat(),
                    "preview": preview[:280],
                }
            )
    out.sort(key=lambda row: row.get("mtime") or "", reverse=True)
    return out[:limit]


def tree_summary() -> dict[str, Any]:
    counts = {}
    for kind, name in FOLDERS.items():
        path = ops_root() / name
        n = len([p for p in path.glob("*.md") if p.name.lower() != "readme.md"]) if path.is_dir() else 0
        counts[kind] = n
    return {"root": str(ops_root()), "counts": counts, "notes": list_notes(limit=24)}


def prune(kind: str | None = None) -> dict[str, int]:
    kinds = [kind] if kind and kind in FOLDERS else list(FOLDERS)
    removed = 0
    now = datetime.now(timezone.utc)
    for k in kinds:
        path = folder_path(k)
        files = [p for p in path.glob("*.md") if p.name.lower() != "readme.md"]
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        max_keep = KEEP_MAX.get(k)
        hours = KEEP_HOURS.get(k)
        kept = 0
        for fp in files:
            try:
                text = fp.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                text = ""
            critical = "keep: critical" in text[:240] or k in HUMAN_FOLDERS
            stale = False
            if hours and not critical:
                stale = datetime.fromtimestamp(fp.stat().st_mtime, timezone.utc) < now - timedelta(hours=hours)
            overflow = max_keep is not None and kept >= max_keep
            if stale or overflow:
                try:
                    fp.unlink()
                    removed += 1
                except OSError:
                    pass
                continue
            kept += 1
    return {"removed": removed}


def prune_all() -> dict[str, int]:
    return prune(None)


def route_kind(prompt: str, email_chip: str | None = None) -> str:
    text = f"{prompt or ''} {email_chip or ''}".lower()
    if any(w in text for w in ("virus", "malware", "threat")):
        return "virus"
    if any(w in text for w in ("bug", "crash", "leak", "error", "exception")):
        return "bugs"
    if any(w in text for w in ("vr", "quest", "webxr", "headset")):
        return "vr"
    if any(w in text for w in ("wiring", "schematic", "circuit")):
        return "wiring"
    if any(w in text for w in ("editor", "design mode")):
        return "editor"
    if "pr" in text or "pull request" in text:
        return "pr"
    return "activity"
